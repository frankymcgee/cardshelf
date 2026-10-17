import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { encryptSmtpSecret, decryptSmtpSecret } from '../../lib/smtp-settings.mjs';

const url=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!new URL(url||'http://invalid').pathname.endsWith('_test'))throw Error('Use a disposable _test database.');
// This fixture changes result columns while reusing the same connection.
// Production upgrades stop app/worker before applying these schema changes.
const sql=postgres(url,{max:1,prepare:false});
const migration=name=>readFileSync(new URL('../../migrations/'+name,import.meta.url),'utf8');
try {
  for(const preset of ['postal','wpmu','wpmu_pro_tls','wpmu_pro_starttls','custom']) {
    await test('mail retirement migration preserves '+preset+' state safely',async()=>{
      await sql.begin(async tx=>{
        const schema='retire_mail_'+randomUUID().replaceAll('-',''),id=randomUUID();
        await tx`CREATE SCHEMA ${tx(schema)}`;
        await tx`SET LOCAL search_path TO ${tx(schema)},public`;
        await tx`CREATE TABLE app_users(id uuid PRIMARY KEY)`;
        await tx`INSERT INTO app_users(id) VALUES(${id})`;
        await tx`CREATE TABLE password_recovery_mail(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,kind text,
          status text CONSTRAINT password_recovery_mail_status_check CHECK(status IN ('queued','sending','failed','sent')),
          attempts integer DEFAULT 0,lease_token text,lease_until timestamptz,created_at timestamptz DEFAULT now(),finished_at timestamptz,last_error text DEFAULT '')`;
        for(const name of ['018_postal_email.sql','031_email_providers.sql','032_wpmu_pro_email.sql'])await tx.unsafe(migration(name),[],{prepare:false});
        const config={smtp_preset:preset.startsWith('wpmu_pro')?'wpmu_pro':preset==='wpmu'?'wpmu':'custom',
          smtp_host:preset.startsWith('wpmu_pro')?'mail.mailconfig.net':preset==='wpmu'?'mailu.wpmudev.host':'smtp.example.com',
          smtp_port:preset==='wpmu_pro_tls'?465:587,smtp_security:preset==='wpmu_pro_tls'?'tls':'starttls',smtp_user:'noreply@cardshelf.cloud',smtp_rate_limit:10};
        const password='Synthetic retained SMTP secret',encrypted=encryptSmtpSecret(password,config);
        await tx`INSERT INTO email_settings(enabled,provider,api_secret,webhook_public_key,revision,sender_name,reply_to,dkim_selector,dkim_public_key,
          smtp_preset,smtp_host,smtp_port,smtp_security,smtp_user,smtp_secret,smtp_rate_limit,smtp_verified_at,smtp_verified_revision)
          VALUES(true,${preset==='postal'?'postal':'smtp'},'obsolete-api-credential','obsolete-public-key',7,'Retained identity','support@cardshelf.cloud','mail','v=DKIM1; p=YWJjZA==',
          ${config.smtp_preset},${config.smtp_host},${config.smtp_port},${config.smtp_security},${config.smtp_user},${encrypted},10,now(),7)`;
        for(const status of ['accepted','delivered','failed','uncertain'])await tx`INSERT INTO email_outbox(event_key,kind,user_id,status,provider,provider_id)
          VALUES(${randomUUID()},'password_changed',${id},${status},'postal','historical-provider-id')`;
        await tx`INSERT INTO email_suppressions(email,reason,source) VALUES('suppressed@example.test','Postal bounce','postal')`;
        await tx`INSERT INTO email_webhook_receipts(event_key,provider_id) VALUES('historical-event','historical-provider-id')`;
        const [before]=await tx`SELECT * FROM email_settings`,history=await tx`SELECT * FROM email_outbox ORDER BY id`,suppressions=await tx`SELECT * FROM email_suppressions`;
        await tx.unsafe(migration('035_remove_postal.sql'),[],{prepare:false});
        const [after]=await tx`SELECT * FROM email_settings`;
        assert.equal(after.api_secret,undefined);assert.equal(after.webhook_public_key,undefined);
        assert.equal(after.provider,'smtp');assert.equal(after.smtp_secret,encrypted);assert.equal(decryptSmtpSecret(after.smtp_secret,after),password);
        if(preset==='postal') {
          assert.equal(after.enabled,false);assert.equal(after.revision,8);assert.equal(after.smtp_verified_at,null);assert.equal(after.smtp_verified_revision,null);assert.equal(after.dkim_selector,'');assert.equal(after.dkim_public_key,'');
        } else {
          const {api_secret,webhook_public_key,...retained}=before;
          assert.deepEqual(after,retained,'An active SMTP connection and its verification must remain unchanged.');
        }
        assert.deepEqual(await tx`SELECT * FROM email_outbox ORDER BY id`,history);
        assert.deepEqual(await tx`SELECT * FROM email_suppressions`,suppressions);
        assert.equal((await tx`SELECT to_regclass(${schema+'.email_webhook_receipts'}) AS relation`)[0].relation,null);
        await tx.savepoint(async savepoint=>{
          await assert.rejects(savepoint`UPDATE email_settings SET provider='postal'`,/email_settings_provider_check/);
          // Roll back the aborted savepoint before leaving the test transaction.
          throw new Error('rollback-invalid-provider');
        }).catch(error=>{assert.equal(error.message,'rollback-invalid-provider');});
        await tx`DROP SCHEMA ${tx(schema)} CASCADE`;
      });
    });
  }
} finally {await sql.end();}
