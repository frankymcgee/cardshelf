import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, generateSecret, verify } from 'otplib';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { softwareAuthenticator } from './helpers/account-security-fixtures.mjs';
import { newRecoveryCodes, recoveryCodeHash, newTotp, encryptTotp, decryptTotp, verifyTotpSecret, webauthnConfiguration, emailVerified } from '../lib/account-security-logic.mjs';

test('TOTP encryption authenticates the account, credential and encryption key', () => {
  const env = { CARDSHELF_INTEGRATION_KEY: '01'.repeat(32) }, setup = newTotp('synthetic@example.test');
  const a = encryptTotp(setup.secret, 'account-a', 'factor-a', env), b = encryptTotp(setup.secret, 'account-a', 'factor-a', env);
  assert.notEqual(a, b); assert.ok(!a.includes(setup.secret));
  assert.equal(decryptTotp(a, 'account-a', 'factor-a', env), setup.secret);
  for (const operation of [() => decryptTotp(a, 'account-b', 'factor-a', env), () => decryptTotp(a, 'account-a', 'factor-b', env),
    () => decryptTotp(a, 'account-a', 'factor-a', { CARDSHELF_INTEGRATION_KEY: '02'.repeat(32) }),
    () => decryptTotp(a.slice(0, -4) + 'AAAA', 'account-a', 'factor-a', env), () => encryptTotp(setup.secret, 'a', 'b', {})]) {
    assert.throws(operation, error => error.status === 503 && !error.message.includes(setup.secret));
  }
  const uri = new URL(setup.uri); assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.searchParams.get('issuer'), 'CardShelf'); assert.equal(uri.searchParams.get('secret'), setup.secret);
});

test('application TOTP validation rejects replays, stale codes and malformed input', async () => {
  const { secret } = newTotp('synthetic@example.test'), epoch = 1700000010;
  const code = await generate({ secret, epoch });
  const step = await verifyTotpSecret(secret, code, -1, epoch); assert.equal(step, Math.floor(epoch / 30));
  assert.equal(await verifyTotpSecret(secret, code, step, epoch), null);
  assert.equal(await verifyTotpSecret(secret, code, -1, epoch + 120), null);
  for (const value of [null, undefined, 123456, '12345', '1234567', '123 456', 'abcdef']) assert.equal(await verifyTotpSecret(secret, value, -1, epoch), null);
});

test('recovery codes are high entropy and account-bound, with display-only formatting', () => {
  const codes = newRecoveryCodes(); assert.equal(codes.length, 10); assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    assert.match(code, /^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
    const hash = recoveryCodeHash('account-a', code); assert.match(hash, /^[a-f0-9]{64}$/);
    assert.notEqual(hash, recoveryCodeHash('account-b', code));
    assert.equal(hash, recoveryCodeHash('account-a', code.toLowerCase().replaceAll('-', ' ')));
  }
});

test('WebAuthn RP configuration fails closed and email verification preserves only legacy access', () => {
  assert.equal(webauthnConfiguration('https://cards.example.test', {}).rpID, 'cards.example.test');
  assert.equal(webauthnConfiguration('http://localhost:3000', {}).rpID, 'localhost');
  assert.throws(() => webauthnConfiguration('http://cards.example.test', {}), error => error.status === 503);
  assert.throws(() => webauthnConfiguration('https://cards.example.test', { CARDSHELF_WEBAUTHN_RP_ID: 'example.test' }), error => error.status === 503);
  assert.equal(emailVerified({ email_verification_required: false, email_verified_at: null }), true);
  assert.equal(emailVerified({ email_verification_required: true, email_verified_at: null }), false);
  assert.equal(emailVerified({ email_verification_required: true, email_verified_at: new Date() }), true);
});

test('TOTP uses the RFC 6238 SHA-1 vectors and explicit replay boundaries', async () => {
  const secret = new TextEncoder().encode('12345678901234567890');
  for (const [epoch, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(await generate({ secret, epoch, digits: 8, algorithm: 'sha1', period: 30 }), expected);
  }
  const randomSecret = generateSecret(), epoch = 1700000010;
  const token = await generate({ secret: randomSecret, epoch });
  const result = await verify({ secret: randomSecret, token, epoch, epochTolerance: 30 });
  assert.equal(result.valid, true);
  assert.equal((await verify({ secret: randomSecret, token, epoch, epochTolerance: 30, afterTimeStep: result.timeStep })).valid, false);
  assert.equal((await verify({ secret: randomSecret, token, epoch: epoch + 120, epochTolerance: 30 })).valid, false);
});

test('software WebAuthn fixture passes genuine registration and signed authentication', async t => {
  const origin = 'https://cardshelf.example.test', rpID = new URL(origin).hostname;
  const authenticator = softwareAuthenticator();
  const options = await generateRegistrationOptions({ rpName: 'CardShelf test', rpID, userName: 'synthetic@example.test',
    userID: new TextEncoder().encode('synthetic-user'), authenticatorSelection: { userVerification: 'required' } });
  const registration = await verifyRegistrationResponse({ response: authenticator.registration(options, origin), expectedChallenge: options.challenge,
    expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  assert.equal(registration.verified, true);
  assert.equal(registration.registrationInfo.credential.id, authenticator.id);
  const credential = registration.registrationInfo.credential;
  const authenticationOptions = await generateAuthenticationOptions({ rpID, allowCredentials: [{ id: authenticator.id }], userVerification: 'required' });
  const verifyAssertion = overrides => verifyAuthenticationResponse({ response: authenticator.assertion(authenticationOptions, origin, overrides),
    expectedChallenge: authenticationOptions.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, credential });
  assert.equal((await verifyAssertion({})).verified, true);
  for (const [name, overrides] of Object.entries({ challenge: { challenge: 'wrong-challenge' }, origin: { origin: 'https://evil.example.test' },
    relying_party: { rpId: 'evil.example.test' }, user_verification: { uv: false }, signature: { badSignature: true } })) {
    await t.test('rejects incorrect ' + name, async () => {
      try { assert.equal((await verifyAssertion(overrides)).verified, false); }
      catch (error) { if (error.code === 'ERR_ASSERTION') throw error; }
    });
  }
});
