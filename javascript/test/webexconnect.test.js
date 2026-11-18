'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OtpDelivery } = require('../src/functions/delivery');
const { OUTCOME } = require('../src/functions/providerResult');
const { selectProvider } = require('../src/functions/providers');

const provider = selectProvider(' WebexConnect ');
const delivery = new OtpDelivery({
    phoneNumber: '+15551234567',
    message: 'Your code is 012345.',
    otp: '012345',
    channel: 'sms',
    messageId: 'm1',
    correlationId: 'c1',
    locale: 'en-US',
});
const base = {
    channel: 'sms',
    endpoint: 'https://hooks.us.webexconnect.io/events/profile',
    delivery,
    credential: { mode: 'apiKey', secret: 'k-secret', identity: '' },
    env: {},
};
const res = (json, status = 200, validJson = true) => ({
    json, providerHttpStatus: status, ok: status >= 200 && status < 300, validJson, elapsedMs: 1,
});

test('registered with apiKey auth and fixed secret name', () => {
    assert.equal(provider.name, 'webexconnect');
    assert.equal(provider.authenticationMode, 'apiKey');
    assert.equal(provider.credentialSpec.keyVaultSecretName, 'webexconnect-api-key');
});

test('SMS request: key header, exact message, leading-zero OTP preserved', () => {
    const r = provider.createRequest(base);
    assert.equal(r.url, base.endpoint);
    assert.equal(r.headers.key, 'k-secret');
    assert.equal(r.headers.Authorization, undefined);
    const body = JSON.parse(r.body);
    assert.deepEqual(body, {
        channel: 'sms', to: '+15551234567', text: 'Your code is 012345.', locale: 'en-US', correlationId: 'c1',
    });
});

test('voice request spells digits, repeats, and uses voice URL override', () => {
    const r = provider.createRequest({
        ...base, channel: 'voice',
        env: { WEBEXCONNECT_VOICE_URL: 'https://hooks.us.webexconnect.io/events/voice', WEBEXCONNECT_SMS_URL: 'https://x/sms' },
    });
    assert.equal(r.url, 'https://hooks.us.webexconnect.io/events/voice');
    const body = JSON.parse(r.body);
    assert.equal(body.channel, 'voice');
    assert.equal(body.text, 'Your code is 0, 1, 2, 3, 4, 5. Your code is 0, 1, 2, 3, 4, 5.');
});

test('rejects non-E.164 recipient and unsupported channel', () => {
    const bad = new OtpDelivery({ ...delivery, phoneNumber: '5551234567' });
    assert.throws(() => provider.createRequest({ ...base, delivery: bad }), /invalid recipient/);
    assert.throws(() => provider.createRequest({ ...base, channel: 'fax' }), /unsupported channel/);
});

test('real Connect replies: 1002 Queued continues, 7001 fails', () => {
    const queued = provider.interpretResponse(res({ response: [{ code: '1002', description: 'Queued', transid: 't-1' }] }));
    assert.deepEqual([queued.outcome, queued.httpStatus, queued.providerMessageId], [OUTCOME.CONTINUE, 200, 't-1']);
    const auth = provider.interpretResponse(res({ response: { code: '7001', description: 'Authentication failed.', transid: 'x' } }));
    assert.deepEqual([auth.outcome, auth.httpStatus, auth.failureReason], [OUTCOME.FAIL, 502, 'provider_rejected']);
    const http = provider.interpretResponse(res({ response: [{ code: '1002', transid: 't' }] }, 500));
    assert.equal(http.httpStatus, 502);
});

test('simple status bodies still supported', () => {
    for (const json of [{ status: 'queued' }, { status: 'Accepted' }]) {
        const r = provider.interpretResponse(res(json, 202));
        assert.equal(r.outcome, OUTCOME.CONTINUE);
        assert.equal(r.httpStatus, 200);
        assert.equal(r.failureReason, null);
    }
});

test('blocked maps to 422, failed maps to 502', () => {
    const blocked = provider.interpretResponse(res({ status: 'blocked' }));
    assert.deepEqual([blocked.outcome, blocked.httpStatus, blocked.failureReason], [OUTCOME.BLOCK, 422, 'provider_blocked']);
    const failed = provider.interpretResponse(res({ status: 'failed' }));
    assert.deepEqual([failed.outcome, failed.httpStatus, failed.failureReason], [OUTCOME.FAIL, 502, 'provider_rejected']);
});

test('unrecognized body, HTTP errors, and invalid JSON fail safely', () => {
    assert.equal(provider.interpretResponse(res({})).httpStatus, 502);
    assert.equal(provider.interpretResponse(res({}, 429)).httpStatus, 429);
    assert.equal(provider.interpretResponse(res({ status: 'queued' }, 401)).httpStatus, 400);
    const invalid = provider.interpretResponse(res(null, 200, false));
    assert.deepEqual([invalid.httpStatus, invalid.failureReason], [502, 'invalid_provider_json']);
});
