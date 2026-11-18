'use strict';

const { OUTCOME, ProviderResult, classifyFailure } = require('../providerResult');
const { buildVoiceMessage } = require('../voiceMessage');

// Status values a Webex Connect flow may return in its (optional) webhook response.
// Connect result codes meaning the request was accepted (1002 = Queued).
const ACCEPTED_CODES = new Set(['1001', '1002']);
const SUCCESS = new Set(['ACCEPTED', 'QUEUED', 'SUCCESS', 'SENT', 'PENDING']);
const BLOCKED = new Set(['BLOCKED', 'DENIED', 'FRAUD']);
const REJECTED = new Set(['FAILED', 'REJECTED', 'ERROR', 'UNDELIVERABLE']);

const E164 = /^\+[1-9][0-9]{1,14}$/;

/**
 * Webex Connect adapter.
 *
 * Posts the OTP to an inbound Custom API (webhook) trigger of a Webex Connect flow.
 * The flow sends the SMS (SMS node) or places the call (Voice/TTS node).
 * Auth: Connect API key, sent in the `key` header, read from Key Vault.
 *
 * Endpoints: Function app settings WEBEXCONNECT_SMS_URL / WEBEXCONNECT_VOICE_URL
 * (the customer's flow trigger URLs) override the route endpoints in the profile.
 */
const provider = Object.freeze({
    name: 'webexconnect',
    authenticationMode: 'apiKey',
    credentialSpec: Object.freeze({
        mode: 'apiKey',
        keyVaultSecretName: 'webexconnect-api-key',
    }),

    createRequest({ channel, endpoint, delivery, credential, env = {} }) {
        if (!['sms', 'voice'].includes(channel)) throw new Error('unsupported channel');
        if (typeof delivery.phoneNumber !== 'string' || !E164.test(delivery.phoneNumber)) {
            throw new Error('invalid recipient');
        }
        const override = (channel === 'voice' ? env.WEBEXCONNECT_VOICE_URL : env.WEBEXCONNECT_SMS_URL)?.trim();
        const language = (typeof delivery.locale === 'string' && delivery.locale.trim()) || 'en-US';
        return {
            url: override || endpoint,
            method: 'POST',
            headers: {
                key: credential.secret,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                channel,
                to: delivery.phoneNumber,
                text: channel === 'voice' ? buildVoiceMessage(delivery.message, delivery.otp) : delivery.message,
                locale: language,
                correlationId: delivery.correlationId || delivery.messageId,
            }),
        };
    },

    interpretResponse(response) {
        // Connect replies {"response":[{"code":"1002","description":"Queued","transid":"..."}]}
        // (an object instead of an array on errors, e.g. code 7001 "Authentication failed").
        const raw = response.json?.response;
        const item = Array.isArray(raw) ? raw[0] : raw;
        const entry = item && typeof item === 'object' ? item : null;
        const code = typeof entry?.code === 'string' ? entry.code.trim() : null;
        const description = typeof entry?.description === 'string' ? entry.description : null;
        const transactionId = typeof entry?.transid === 'string' ? entry.transid : null;
        const status = typeof response.json?.status === 'string' ? response.json.status.trim().toUpperCase() : null;

        let outcome = OUTCOME.FAIL;
        let recognized = false;
        if (BLOCKED.has(status)) { outcome = OUTCOME.BLOCK; recognized = true; }
        else if (code !== null) {
            recognized = true;
            if (ACCEPTED_CODES.has(code)) outcome = OUTCOME.CONTINUE;
        } else if (status !== null) {
            recognized = SUCCESS.has(status) || REJECTED.has(status);
            if (SUCCESS.has(status)) outcome = OUTCOME.CONTINUE;
        }
        if (!response.ok && outcome === OUTCOME.CONTINUE) outcome = OUTCOME.FAIL;

        return new ProviderResult({
            outcome,
            statusRecognized: recognized,
            providerHttpStatus: response.providerHttpStatus,
            providerMessageId: transactionId,
            providerStatusName: code ?? status,
            providerStatusCode: code,
            providerStatusDescription: description,
            failureReason: classifyFailure({
                providerHttpStatus: response.providerHttpStatus,
                outcome,
                statusRecognized: recognized,
                validJson: response.validJson,
            }),
        });
    },
});

module.exports = provider;
