import test from 'node:test';
import assert from 'node:assert/strict';
import { emailConfigurationFromRow,emailSettingsInput } from '../lib/email-settings.mjs';
import { encryptSmtpSecret } from '../lib/smtp-settings.mjs';
import { maskedEmail,retryableEmail } from '../lib/email-admin.mjs';
const env={CARDSHELF_INTEGRATION_KEY:'ab'.repeat(32)},secret='synthetic-smtp-secret-123456';
const settings={revision:0,password:'current administrator password',provider:'smtp',enabled:false,sender_name:'CardShelf',from_address:'noreply@cardshelf.cloud',reply_to:'support@cardshelf.cloud',smtp_preset:'wpmu_pro',smtp_host:'mail.mailconfig.net',smtp_port:465,smtp_security:'tls',smtp_user:'noreply@cardshelf.cloud',smtp_rate_limit:10,smtp_password:'',clear_smtp_password:false,dkim_selector:'',dkim_public_key:''};
test('no saved configuration and intentionally paused SMTP are distinct',()=>{
 const none=emailConfigurationFromRow(null,env),disabled=emailConfigurationFromRow({...settings,revision:1},env);
 assert.equal(none.exists,false);assert.equal(none.provider,'smtp');assert.equal(none.config_error,'');assert.equal(disabled.exists,true);assert.equal(disabled.enabled,false);assert.equal(disabled.configured,false);
 const row={...settings,smtp_secret:encryptSmtpSecret(secret,settings,env)};
 const configured=emailConfigurationFromRow(row,env);assert.equal(configured.configured,true);assert.equal(configured.enabled,false);
 const locked=emailConfigurationFromRow(row,{...env,CARDSHELF_INTEGRATION_KEY:''});assert.equal(locked.configured,false);assert.equal(locked.smtp_password,'');assert.ok(locked.config_error);assert.ok(!JSON.stringify(locked).includes(secret));
 assert.equal(emailConfigurationFromRow({...row,provider:'retired'},env).configured,false);
});
test('settings reject retired provider fields, header injection and client-chosen origins',()=>{
 assert.equal(emailSettingsInput(settings).provider,'smtp');assert.equal(emailSettingsInput({...settings,provider:undefined}).provider,'smtp');
 for(const patch of [{provider:'postal'},{api_key:'retired-key'},{clear_api_key:true},{webhook_public_key:''},{origin:'https://attacker.test'},{from_address:'noreply@example.test'},{reply_to:'a@example.test'},{sender_name:'CardShelf\r\nBcc: a@b.test'},{from_address:'User <noreply@cardshelf.cloud>'},{smtp_password:secret,clear_smtp_password:true},{clear_smtp_password:'true'}])assert.throws(()=>emailSettingsInput({...settings,...patch}));
});
test('DKIM selector and expected record retain bounded validated public formats',()=>{
 assert.equal(emailSettingsInput({...settings,dkim_selector:'mail-2026',dkim_public_key:'v=DKIM1; k=rsa; p=YWJjZA=='}).dkim_selector,'mail-2026');
 for(const patch of [{dkim_selector:'../../evil'},{dkim_selector:'mail',dkim_public_key:'private-key-material'},{dkim_public_key:'v=DKIM1; p=YWJjZA=='},{dkim_selector:'mail',dkim_public_key:'v=DKIM1;\np=YWJjZA=='}])assert.throws(()=>emailSettingsInput({...settings,...patch}));
});
test('administrator metadata masks recipients and never marks resets or accepted mail retryable',()=>{
  assert.equal(maskedEmail('collector@example.test'),'c***@example.test');
  const row={source:'notification',status:'failed',provider_id:null,accepted_at:null,expires_at:'2026-12-31T00:00:00Z'};
  const now=Date.parse('2026-09-20T00:00:00Z');assert.equal(retryableEmail(row,now),true);
  for(const patch of [{source:'recovery'},{status:'accepted'},{provider_id:'123'},{accepted_at:'2026-09-19T00:00:00Z'},{expires_at:'2026-01-01T00:00:00Z'}])assert.equal(retryableEmail({...row,...patch},now),false);
});
