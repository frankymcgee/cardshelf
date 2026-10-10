// Disposable PostgreSQL only; all email sends use an in-memory recording sender.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { hashPassword, randomToken, digest } from '../../lib/security.mjs';
import { closeDatabase } from '../../lib/db.mjs';
import { requestEmailVerification, completeEmailVerification, queueEmailVerification, processVerificationMail } from '../../lib/email-verification.mjs';
import { VERIFICATION_MESSAGE } from '../../lib/email-verification-logic.mjs';
import { login, sessionUser } from '../../lib/auth.mjs';
import { applyPostalDeliveryEvent } from '../../lib/email-outbox.mjs';
import { reserveEmailDispatch } from '../../lib/email-dispatch.mjs';

const databaseUrl = process.env.DATABASE_URL;
if (process.env.ALLOW_TEST_DATABASE !== 'yes' || !new URL(databaseUrl || 'http://invalid').pathname.endsWith('_test') ||
    process.env.EMAIL_WORKER_ENABLED !== 'false' || process.env.RECOVERY_EMAIL_ENABLED === 'true') {
  throw Error('Use a disposable _test database with automatic and real recovery mail disabled.');
}
const sql = postgres(databaseUrl, {max:6}), origin = process.env.APP_ORIGIN || 'http://localhost:3000';
const suffix = randomUUID(), password = 'Synthetic verification password 123';
let users = [], emails = [];
async function account(kind='pending') {
  const id = randomUUID(), email = kind + '-' + id + '@example.test'; users.push(id);emails.push(email);
  await sql`INSERT INTO app_users(id,name,email,password_hash,email_verification_required,email_verification_grandfathered_at)
    VALUES(${id},'Synthetic verification',${email},${await hashPassword(password)},${kind !== 'legacy'},${kind === 'legacy' ? new Date() : null})`;
  return {id,email};
}
const ip = label => 'verification-' + suffix + '-' + label;
const rawToken = message => {const match=message.text.match(/\/verify-email#token=([a-f0-9]{64})/);assert.ok(match);return match[1];};
const response = {message:VERIFICATION_MESSAGE};
const capture = [];
const send = async (address,message,options) => {capture.push({address,...message,options});return {provider:'smtp',message_id:options.messageId};};
const deliver = (sender=send) => processVerificationMail({sql,origin,send:sender});
async function link(user) {
  await queueEmailVerification(sql,user.id,user.email);
  assert.equal(await deliver(),true);
  const message=capture.at(-1);assert.equal(message.address,user.email);return rawToken(message);
}
await test('email verification is bound, transactional, account-blind, and safely delivered', async t => {
  const settings = await sql`SELECT * FROM email_settings`;
  const dispatch = await sql`SELECT * FROM email_dispatch_state`;
  const queued = await sql`SELECT id,available_at FROM email_verification_mail WHERE status='queued'`;
  try {
    await sql`DELETE FROM email_settings`;
    await sql`UPDATE email_verification_mail SET available_at=now()+interval '7 days' WHERE status='queued'`;
    await t.test('additive migration keeps legacy account and data while accurately recording grandfathered status', async () => {
      const schema='verification_migration_'+randomUUID().replaceAll('-','');
      await sql.begin(async tx=>{
        await tx`CREATE SCHEMA ${tx(schema)}`;
        await tx`SET LOCAL search_path TO ${tx(schema)},public`;
        await tx`CREATE TABLE app_users(id uuid PRIMARY KEY,email text,password_hash text)`;
        await tx`CREATE TABLE preserved_collections(user_id uuid PRIMARY KEY REFERENCES app_users,data jsonb)`;
        await tx`CREATE TABLE email_dispatch_state(singleton boolean PRIMARY KEY,last_queue text CHECK(last_queue IN ('notification','recovery')),next_send_at timestamptz)`;
        const id=randomUUID();await tx`INSERT INTO app_users VALUES(${id},'legacy@example.test','same-password-hash')`;
        await tx`INSERT INTO preserved_collections VALUES(${id},'{"cards":17,"subscription":"unchanged"}')`;
        await tx.unsafe(await readFile(new URL('../../migrations/034_email_verification.sql',import.meta.url),'utf8'));
        const [row]=await tx`SELECT * FROM app_users WHERE id=${id}`;
        assert.equal(row.password_hash,'same-password-hash');assert.equal(row.email_verified_at,null);
        assert.equal(row.email_verification_required,false);assert.ok(row.email_verification_grandfathered_at);
        assert.deepEqual((await tx`SELECT data FROM preserved_collections WHERE user_id=${id}`)[0].data,{cards:17,subscription:'unchanged'});
        await tx`DROP SCHEMA ${tx(schema)} CASCADE`;
      });
    });
    await t.test('legacy users are not falsely verified and new users cannot get a full session', async () => {
      const legacy = await account('legacy'), pending = await account();
      const [row] = await sql`SELECT email_verified_at,email_verification_required,email_verification_grandfathered_at FROM app_users WHERE id=${legacy.id}`;
      assert.equal(row.email_verified_at,null);assert.equal(row.email_verification_required,false);assert.ok(row.email_verification_grandfathered_at);
      assert.ok((await login({email:legacy.email,password},ip('legacy-login'))).token);
      const result = await login({email:pending.email,password},ip('pending-login'));
      assert.equal(result.token,undefined);assert.equal(result.pending?.scope,'email_verification');
      const session = randomToken();await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(session)},${pending.id},now()+interval '1 hour')`;
      assert.equal(await sessionUser(session),null);
    });
    await t.test('resend has identical responses, a per-mailbox cooldown, and no synchronous tokens', async () => {
      const user=await account(), unknown='missing-'+suffix+'@example.test';emails.push(unknown);
      for (const email of [user.email,unknown]) {
        assert.deepEqual(await requestEmailVerification({email},ip(email)),response);
        assert.deepEqual(await requestEmailVerification({email},ip(email)),response);
        assert.equal((await sql`SELECT id FROM email_verification_mail WHERE email=${email}`).length,1);
      }
      assert.equal((await sql`SELECT token_hash FROM email_verification_tokens WHERE user_id=${user.id}`).length,0);
      assert.equal(await deliver(),true);assert.equal(capture.at(-1).address,user.email);
      assert.equal((await sql`SELECT status FROM email_verification_mail WHERE email=${unknown}`)[0].status,'ignored');
      for(let n=0;n<3;n++) assert.deepEqual(await requestEmailVerification({email:user.email},ip('other-'+n)),response);
      assert.equal((await sql`SELECT id FROM email_verification_mail WHERE email=${user.email}`).length,1);
    });
    await t.test('issued mail contains an actual high-entropy link and storage contains only the hash', async () => {
      const user=await account(), token=await link(user);
      const [stored]=await sql`SELECT * FROM email_verification_tokens WHERE token_hash=${digest(token)}`;
      assert.equal(stored.user_id,user.id);assert.equal(stored.email,user.email);assert.match(stored.password_fingerprint,/^[a-f0-9]{64}$/);
      assert.ok(Date.parse(stored.expires_at)>Date.now()+23*3600000);assert.ok(!JSON.stringify(stored).includes(token));
      const [job]=await sql`SELECT * FROM email_verification_mail WHERE user_id=${user.id}`;
      assert.equal(job.status,'accepted');assert.equal(job.delivered_at,null);assert.ok(!JSON.stringify(job).includes(token));
      await assert.rejects(completeEmailVerification({token,password:'wrong'},ip('wrong')),error=>error.status===400);
      assert.equal((await sql`SELECT email_verified_at FROM app_users WHERE id=${user.id}`)[0].email_verified_at,null);
      const settled=await Promise.allSettled([completeEmailVerification({token,password},ip('race1')),completeEmailVerification({token,password},ip('race2'))]);
      assert.equal(settled.filter(result=>result.status==='fulfilled').length,1);
      assert.equal(settled.filter(result=>result.status==='rejected'&&result.reason.status===400).length,1);
      const [verified]=await sql`SELECT email_verified_at,email_verification_required,security_version FROM app_users WHERE id=${user.id}`;
      assert.ok(verified.email_verified_at);assert.equal(verified.email_verification_required,false);assert.equal(String(verified.security_version),'1');
      await assert.rejects(completeEmailVerification({token,password},ip('replay')),error=>error.status===400);
      assert.equal((await sql`SELECT token_hash FROM email_verification_tokens WHERE user_id=${user.id}`).length,0);
      assert.equal((await sql`SELECT token_hash FROM sessions WHERE user_id=${user.id}`).length,0);
      assert.ok((await login({email:user.email,password},ip('verified-login'))).token);
    });
    await t.test('expiry, changed email, changed password, and changed security revision reject links', async () => {
      for(const changed of ['expiry','email','password','revision']) {
        const user=await account(),token=await link(user);
        if(changed==='expiry')await sql`UPDATE email_verification_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=${digest(token)}`;
        if(changed==='email'){const next='changed-'+user.email;emails.push(next);await sql`UPDATE app_users SET email=${next} WHERE id=${user.id}`;}
        if(changed==='password')await sql`UPDATE app_users SET password_hash=${await hashPassword(password)} WHERE id=${user.id}`;
        if(changed==='revision')await sql`UPDATE app_users SET security_version=security_version+1 WHERE id=${user.id}`;
        await assert.rejects(completeEmailVerification({token,password},ip(changed)),error=>error.status===400);
        assert.equal((await sql`SELECT email_verified_at FROM app_users WHERE id=${user.id}`)[0].email_verified_at,null);
      }
    });
    await t.test('verification cancels all sessions and pending authentication without removing MFA factors', async () => {
      const user=await account(),token=await link(user),session=randomToken();
      await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${digest(session)},${user.id},now()+interval '1 hour')`;
      await sql`INSERT INTO account_pending_auth(token_hash,user_id,security_version,scope,expires_at) VALUES(${digest(randomToken())},${user.id},0,'mfa',now()+interval '10 minutes')`;
      await sql`INSERT INTO account_security_challenges(token_hash,user_id,context_hash,security_version,kind,expires_at) VALUES(${digest(randomToken())},${user.id},${digest(session)},0,'passkey-login',now()+interval '10 minutes')`;
      await sql`INSERT INTO account_security_proofs(token_hash,user_id,session_hash,security_version,expires_at) VALUES(${digest(randomToken())},${user.id},${digest(session)},0,now()+interval '10 minutes')`;
      await sql`INSERT INTO account_totp_credentials(user_id,label,secret_ciphertext) VALUES(${user.id},'Synthetic retained factor','synthetic-ciphertext')`;
      await completeEmailVerification({token,password},ip('revoke'));
      for(const table of ['sessions','account_pending_auth','account_security_challenges','account_security_proofs']) assert.equal((await sql`SELECT * FROM ${sql(table)} WHERE user_id=${user.id}`).length,0);
      assert.equal((await sql`SELECT id FROM account_totp_credentials WHERE user_id=${user.id}`).length,1);
    });
    await t.test('suppression sends nothing and a rebound queued mailbox cannot target a different account', async () => {
      const user=await account(),other=await account();await queueEmailVerification(sql,user.id,other.email);
      const before=capture.length;assert.equal(await deliver(),true);assert.equal(capture.length,before);
      await sql`INSERT INTO email_suppressions(email,reason,source) VALUES(${user.email},'Synthetic suppression','manual')`;
      await queueEmailVerification(sql,user.id,user.email);assert.equal(await deliver(),true);assert.equal(capture.length,before);
      assert.equal((await sql`SELECT token_hash FROM email_verification_tokens WHERE user_id=${user.id}`).length,0);
      assert.equal((await sql`SELECT status FROM email_verification_mail WHERE user_id=${user.id} AND email=${user.email}`)[0].status,'suppressed');
    });
    await t.test('ambiguous provider acceptance never retries and its potentially delivered token remains usable', async () => {
      const user=await account();await queueEmailVerification(sql,user.id,user.email);let token,calls=0;
      assert.equal(await deliver(async(address,message)=>{calls++;token=rawToken(message);throw Error('Sensitive SMTP detail must never persist');}),true);
      const [row]=await sql`SELECT * FROM email_verification_mail WHERE user_id=${user.id}`;
      assert.equal(row.status,'uncertain');assert.equal(row.last_error,'DELIVERY_UNCERTAIN');assert.ok(!JSON.stringify(row).includes('Sensitive SMTP'));assert.ok(!JSON.stringify(row).includes(token));
      assert.equal(await deliver(async()=>{calls++;}),false);assert.equal(calls,1);
      assert.equal((await completeEmailVerification({token,password},ip('uncertain'))).verified,true);
    });
    await t.test('known transport rejection destroys that token and uses a bounded secret-free retry', async () => {
      const user=await account();await queueEmailVerification(sql,user.id,user.email);const tokens=[];
      for(let attempt=1;attempt<=3;attempt++) {
        assert.equal(await deliver(async(address,message)=>{tokens.push(rawToken(message));throw Object.assign(Error('secret response'),{emailDelivery:'rejected'});}),true);
        const [row]=await sql`SELECT * FROM email_verification_mail WHERE user_id=${user.id}`;
        assert.equal(row.attempts,attempt);assert.equal(row.status,attempt<3?'queued':'failed');assert.ok(!JSON.stringify(row).includes('secret response'));
        assert.equal((await sql`SELECT token_hash FROM email_verification_tokens WHERE user_id=${user.id}`).length,0);
        if(attempt<3)await sql`UPDATE email_verification_mail SET available_at=now() WHERE id=${row.id}`;
      }
      assert.equal(new Set(tokens).size,3);
    });
    await t.test('SMTP pacing alternates fairly across notification, recovery, and verification queues', async () => {
      const user=await account();
      await sql`INSERT INTO email_settings(singleton,enabled,provider,revision,smtp_rate_limit) VALUES(true,true,'smtp',1,10)`;
      const [notification]=await sql`INSERT INTO email_outbox(event_key,kind,user_id) VALUES(${'verification-pacing-'+suffix},'test',${user.id}) RETURNING id`;
      const [recovery]=await sql`INSERT INTO password_recovery_mail(email,kind) VALUES(${user.email},'test') RETURNING id`;
      await queueEmailVerification(sql,user.id,user.email);
      await sql`DELETE FROM email_dispatch_state`;
      const config={provider:'smtp',exists:true,revision:1,smtp_rate_limit:10};
      const reserve=queue=>sql.begin(tx=>reserveEmailDispatch(tx,config,queue));
      try {
        assert.equal(await reserve('notification'),true);
        assert.equal(await reserve('recovery'),false,'One durable rate limit covers all queues.');
        await sql`UPDATE email_dispatch_state SET next_send_at=now()-interval '1 second' WHERE singleton`;
        assert.equal(await reserve('verification'),false,'Recovery follows notification when all three are queued.');
        assert.equal(await reserve('recovery'),true);
        await sql`UPDATE email_dispatch_state SET next_send_at=now()-interval '1 second' WHERE singleton`;
        assert.equal(await reserve('notification'),false,'Verification gets a turn ahead of notification.');
        assert.equal(await reserve('verification'),true);
        await sql`UPDATE email_dispatch_state SET next_send_at=now()-interval '1 second' WHERE singleton`;
        assert.equal(await reserve('notification'),true);
      } finally {
        await sql`DELETE FROM email_settings`;
        await sql`DELETE FROM email_outbox WHERE id=${notification.id}`;
        await sql`DELETE FROM password_recovery_mail WHERE id=${recovery.id}`;
        await sql`DELETE FROM email_verification_mail WHERE user_id=${user.id}`;
      }
    });
    await t.test('Postal events update verification history and cannot label acceptance as delivery', async () => {
      const user=await account();await queueEmailVerification(sql,user.id,user.email);
      await deliver(async(address,message,options)=>({provider:'postal',provider_id:'synthetic-verification-'+suffix,message_id:options.messageId}));
      const [job]=await sql`SELECT * FROM email_verification_mail WHERE user_id=${user.id}`;
      assert.equal(job.status,'accepted');assert.equal(job.delivered_at,null);
      await sql.begin(tx=>applyPostalDeliveryEvent({providerId:job.provider_id,messageId:job.message_id,recipient:user.email,event:'delivered',at:new Date(),sentWithSsl:true},tx));
      const [delivered]=await sql`SELECT status,delivered_at FROM email_verification_mail WHERE id=${job.id}`;
      assert.equal(delivered.status,'delivered');assert.ok(delivered.delivered_at);
    });
  } finally {
    await sql`DELETE FROM email_settings`;if(settings.length)await sql`INSERT INTO email_settings ${sql(settings)}`;
    await sql`DELETE FROM email_dispatch_state`;if(dispatch.length)await sql`INSERT INTO email_dispatch_state ${sql(dispatch)}`;
    for(const row of queued)await sql`UPDATE email_verification_mail SET available_at=${row.available_at} WHERE id=${row.id}`;
    if(emails.length){await sql`DELETE FROM email_verification_mail WHERE email IN ${sql(emails)}`;await sql`DELETE FROM email_suppressions WHERE email IN ${sql(emails)}`;}
    if(users.length)await sql`DELETE FROM app_users WHERE id IN ${sql(users)}`;
    await closeDatabase();await sql.end();
  }
});
