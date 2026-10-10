import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { randomToken, digest } from '../lib/security.mjs';
import { verificationRequestInput, verificationCompleteInput, verificationLink, verificationTokenIsCurrent,
  verificationMail, VERIFICATION_HOURS, VERIFICATION_MESSAGE, VERIFICATION_ERROR } from '../lib/email-verification-logic.mjs';
const raw = randomToken(), now = Date.parse('2026-10-10T00:00:00Z');
const user = {id:randomUUID(),email:'user@example.test',password_hash:'synthetic-password-hash',security_version:'4',email_verified_at:null};
const token = {token_hash:digest(raw),user_id:user.id,email:user.email,password_fingerprint:digest(user.password_hash),
  security_version:'4',expires_at:new Date(now + 86400000),consumed_at:null};
const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('verification requests normalize a single mailbox and use an account-blind message', () => {
  assert.deepEqual(verificationRequestInput({email:' USER@Example.test '}), {email:user.email});
  assert.match(VERIFICATION_MESSAGE, /^If an unverified account matches/);
  for (const email of ['User <user@example.test>','a@example.test,b@example.test','a@example.test\r\nBcc:b@example.test']) {
    assert.throws(() => verificationRequestInput({email}));
  }
  for (const key of ['user_id','callback','url','token','verified','force']) {
    assert.throws(() => verificationRequestInput({email:user.email,[key]:'injected'}), error => error.status === 400);
  }
});
test('verification requires an explicit token and current password, preserving password whitespace', () => {
  assert.deepEqual(verificationCompleteInput({token:raw,password:'  existing password  '}), {token:raw,password:'  existing password  '});
  for (const password of [undefined,'',123,'p'.repeat(129)]) {
    assert.throws(() => verificationCompleteInput({token:raw,password}), error => error.status === 400 && error.message === VERIFICATION_ERROR);
  }
  for (const token of [null,'','a'.repeat(63),'A'.repeat(64),'a'.repeat(65)]) {
    assert.throws(() => verificationCompleteInput({token,password:'password'}), error => error.status === 400);
  }
  for (const extra of ['email','user_id','security_version','email_verified_at']) {
    assert.throws(() => verificationCompleteInput({token:raw,password:'password',[extra]:'forged'}));
  }
});
test('random verification links contain 256 bits and keep the secret in a fragment on the trusted origin', () => {
  assert.match(raw,/^[a-f0-9]{64}$/);assert.notEqual(raw,randomToken());
  for (const origin of ['https://cardshelf.example.test','http://localhost:3000']) {
    const link = new URL(verificationLink(origin,raw));
    assert.equal(link.origin,origin);assert.equal(link.pathname,'/verify-email');assert.equal(link.search,'');assert.equal(link.hash,'#token='+raw);
    assert.notEqual(token.token_hash,raw);
  }
  for (const origin of ['http://public.example.test','https://evil.test/path','https://name:pass@evil.test','https://evil.test?token=x']) {
    assert.throws(() => verificationLink(origin,raw));
  }
});
test('verification tokens bind account, email, password, security revision, expiry and consumed state', () => {
  assert.equal(VERIFICATION_HOURS,24);assert.equal(verificationTokenIsCurrent(token,user,now),true);
  for (const change of [{id:randomUUID()},{email:'changed@example.test'},{password_hash:'changed'},
    {security_version:'5'},{email_verified_at:new Date(now)}]) {
    assert.equal(verificationTokenIsCurrent(token,{...user,...change},now),false);
  }
  for (const change of [{user_id:randomUUID()},{email:'other@example.test'},{consumed_at:new Date(now)},
    {expires_at:new Date(now)},{expires_at:'bad'},{security_version:'5'},{password_fingerprint:'bad'}]) {
    assert.equal(verificationTokenIsCurrent({...token,...change},user,now),false);
  }
  assert.equal(verificationTokenIsCurrent(null,user,now),false);assert.equal(verificationTokenIsCurrent(token,null,now),false);
});
test('verification email discloses expiry, deliberate confirmation, and unsolicited-request handling', () => {
  const origin = 'https://cardshelf.example.test', link = verificationLink(origin,raw), mail = verificationMail(origin,link);
  assert.deepEqual(Object.keys(mail).sort(),['subject','text']);assert.ok(mail.text.includes(link));
  assert.match(mail.text,/24 hours/);assert.match(mail.text,/current CardShelf password/);assert.match(mail.text,/alone does not verify/);
  assert.match(mail.text,/did not create this account/);assert.ok(!mail.text.includes(user.password_hash));
  assert.throws(() => verificationMail(origin,link+'&anything=1'));assert.throws(() => verificationMail(origin,link.replace('cardshelf.','evil.')));
});
test('migration explicitly preserves legacy access and creates a secret-free outbox', async () => {
  const migration = await source('migrations/034_email_verification.sql');
  assert.match(migration,/ADD COLUMN email_verified_at timestamptz;/);
  assert.match(migration,/ADD COLUMN email_verification_grandfathered_at timestamptz DEFAULT now\(\)/);
  assert.ok(!/SET email_verified_at|DELETE FROM app_users|UPDATE (?:account_memberships|account_access_grants|stripe_subscriptions|collection_entries)/i.test(migration));
  const queue = migration.split('CREATE TABLE email_verification_mail')[1].split('CREATE INDEX')[0];
  assert.ok(!/token_hash|password_hash|payload|message_body|url/.test(queue));
});
test('public request never queries accounts or creates/sends a token synchronously', async () => {
  const request = (await source('lib/email-verification.mjs')).split('export async function requestEmailVerification')[1].split('export async function completeEmailVerification')[0];
  assert.ok(!request.includes('FROM app_users'));assert.ok(!request.includes('sendRecoveryEmail('));assert.ok(!request.includes('issueVerificationToken('));
  for (const key of ['email-verification-ip:','email-verification-email:','email-verification-global','email-verification-cooldown:']) assert.ok(request.includes(key));
  assert.match(request,/60 seconds/);
});
test('every non-auth application registration requires email verification and queues it transactionally', async () => {
  for (const path of ['lib/free-accounts.mjs','lib/membership.mjs']) {
    const code = await source(path);assert.match(code,/INSERT INTO app_users\([^)]*email_verification_required,email_verification_grandfathered_at\)/);
    assert.match(code,/true,NULL\)/);assert.match(code,/queueEmailVerification\(sql,user.id,email\)/);
  }
});
