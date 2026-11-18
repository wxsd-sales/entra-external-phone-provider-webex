'use strict';

const { OUTCOME, ProviderResult, classifyFailure } = require('../providerResult');
const { buildVoiceMessage } = require('../voiceMessage');

// Status values a Webex Connect flow may return in its (optional) webhook response.
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
        const json = response.json && typeof response.json === 'object' ? response.json : null;
        const status = typeof json?.status === 'string' ? json.status.trim().toUpperCase() : null;
        const transactionId = typeof json?.transactionId === 'string' ? json.transactionId : null;

        // A 2xx with a transactionId (Connect's default webhook reply) or a known success status is acceptance.
        let outcome = OUTCOME.FAIL;
        let recognized = false;
        if (BLOCKED.has(status)) { outcome = OUTCOME.BLOCK; recognized = true; }
        else if (REJECTED.has(status)) { recognized = true; }
        else if (SUCCESS.has(status) || (status === null && transactionId)) {
            outcome = OUTCOME.CONTINUE; recognized = true;
        }
        if (!response.ok && outcome === OUTCOME.CONTINUE) outcome = OUTCOME.FAIL;

        return new ProviderResult({
            outcome,
            statusRecognized: recognized,
            providerHttpStatus: response.providerHttpStatus,
            providerMessageId: transactionId,
            providerStatusName: status ?? (transactionId ? 'ACCEPTED' : null),
            providerStatusDescription: typeof json?.message === 'string' ? json.message : null,
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
