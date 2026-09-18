import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { recoveryRequestInput, recoveryCompleteInput, administratorRecoveryInput, recoveryEmail,
  recoveryOrigin, resetLink, credentialFingerprint, tokenIsCurrent, smtpConfiguration, mailStatus,
  recoveryMail, RESET_MINUTES, RESET_ERROR } from '../lib/password-recovery-logic.mjs';
import { recoveryPage, RECOVERY_MESSAGE } from '../shared/password-recovery.mjs';
import { publicPage, safeReturnTo } from '../shared/platform.mjs';
const token = 'a'.repeat(64), password = '  a long new password  ', now = Date.parse('2026-09-01T00:00:00Z');
const user = { id: randomUUID(), password_hash: 'synthetic-original-password-hash' };
const current = { user_id: user.id, password_fingerprint: credentialFingerprint(user.password_hash), expires_at: new Date(now+1800000), consumed_at: null };
const smtp = { RECOVERY_EMAIL_ENABLED:'true', APP_ORIGIN:'https://tcg.webwire.cloud', SMTP_HOST:'smtp.example.test', SMTP_PORT:'587', SMTP_SECURITY:'starttls', SMTP_FROM:'recovery@example.test', SMTP_USER:'account', SMTP_PASSWORD:'  secret spaces  ' };
test('public requests normalise a single email and make no promise that an account exists', () => {
  assert.deepEqual(recoveryRequestInput({email:' USER@Example.test '}), {email:'user@example.test'});
  assert.match(RECOVERY_MESSAGE, /^If an account matches/); assert.match(RECOVERY_MESSAGE,/when email delivery is available/);
});
for (const key of ['role','user_id','delivery','url','callback','force','password','token']) test('public reset request rejects extra '+key,()=>{
  assert.throws(()=>recoveryRequestInput({email:'user@example.test',[key]:'injected'}), e=>e.status===400);
});
for (const email of ['a@example.test,b@example.test','User <a@example.test>','a@example.test\r\nBcc:b@example.test','a@example.test;foo','"foo"@example.test','a\\b@example.test','a b@example.test','']) test('mailbox cannot become a header/address list '+JSON.stringify(email),()=>{
  assert.throws(()=>recoveryEmail(email));
});
test('password reset retains whitespace and requires exact confirmation',()=>{
  assert.deepEqual(recoveryCompleteInput({token,password,confirm_password:password}),{token,password});
  assert.throws(()=>recoveryCompleteInput({token,password,confirm_password:password.trim()}),/do not match/);
});
for(const value of [null,'','b'.repeat(63),'b'.repeat(65),'A'.repeat(64),'../'+token,123]) test('reject malformed recovery token '+JSON.stringify(value),()=>{
  assert.throws(()=>recoveryCompleteInput({token:value,password,confirm_password:password}),e=>e.status===400 && e.message===RESET_ERROR);
});
for(const extra of ['email','user_id','role','sessions','expires_at']) test('redemption cannot choose '+extra,()=>{
  assert.throws(()=>recoveryCompleteInput({token,password,confirm_password:password,[extra]:'forged'}),e=>e.status===400);
});
test('administrator-assisted link requires current password, reason, UUID and identity confirmation',()=>{
  const input={user_id:user.id,delivery:'link',password:' admin spaces ',reason:'Verified identity',confirm_identity:true};
  const out=administratorRecoveryInput(input);assert.equal(out.password,input.password);assert.equal(out.user_id,user.id);
  for(const value of [undefined,false,'true',1])assert.throws(()=>administratorRecoveryInput({...input,confirm_identity:value}),e=>e.status===400);
  assert.throws(()=>administratorRecoveryInput({...input,delivery:'set-password'}));
  assert.throws(()=>administratorRecoveryInput({...input,new_password:password}));
  assert.throws(()=>administratorRecoveryInput({...input,reason:'x'}));
  assert.throws(()=>administratorRecoveryInput({...input,password:''}));
});
test('administrator can send to the registered email, not an arbitrary destination',()=>{
  const input={user_id:user.id,delivery:'email',password:'password',reason:'Account recovery'};
  assert.equal(administratorRecoveryInput(input).delivery,'email');
  assert.throws(()=>administratorRecoveryInput({...input,email:'attacker@example.test'}));
});
for(const origin of ['https://tcg.webwire.cloud','http://localhost:3000','http://127.0.0.1:3000','http://[::1]:3000'])test('trusted recovery origin '+origin,()=>{
  assert.equal(recoveryOrigin(origin),origin);
  const url=new URL(resetLink(origin,token));assert.equal(url.pathname,'/reset-password');assert.equal(url.search,'');assert.equal(url.hash,'#token='+token);
});
for(const origin of ['http://tcg.webwire.cloud','https://evil.test/path','https://u:p@tcg.webwire.cloud','//evil.test','javascript:alert(1)','https://example.test?next=evil','https://example.test#x'])test('reject unsafe origin '+origin,()=>assert.throws(()=>recoveryOrigin(origin)));
test('tokens are bound to one account, password snapshot, and an exclusive expiry',()=>{
  assert.equal(RESET_MINUTES,30);assert.equal(tokenIsCurrent(current,user,now),true);
  assert.equal(tokenIsCurrent({...current,expires_at:current.expires_at.toISOString()},user,now),true);
  assert.equal(tokenIsCurrent(current,{...user,id:randomUUID()},now),false);
  assert.equal(tokenIsCurrent(current,{...user,password_hash:'new-hash'},now),false);
  assert.equal(tokenIsCurrent({...current,expires_at:new Date(now)},user,now),false);
  assert.equal(tokenIsCurrent({...current,consumed_at:new Date(now)},user,now),false);
  assert.equal(tokenIsCurrent({...current,expires_at:'invalid'},user,now),false);
  assert.equal(tokenIsCurrent(null,user,now),false);assert.equal(tokenIsCurrent(current,null,now),false);
  assert.match(current.password_fingerprint,/^[a-f0-9]{64}$/);assert.notEqual(current.password_fingerprint,user.password_hash);
});
test('recovery is reachable without becoming a public indexed marketing route',()=>{
  for(const path of ['/forgot-password','/reset-password','/reset-password/']){assert.equal(recoveryPage(path),true);assert.equal(publicPage(path),false);}
  for(const path of ['/reset-password/extra','/api/public/password-recovery/complete',null,'//reset-password'])assert.equal(recoveryPage(path),false);
  assert.equal(safeReturnTo('/admin/passwords'),'/admin/passwords');assert.equal(safeReturnTo('/admin/adsense'),'/admin/adsense');
});
test('SMTP is disabled unless explicitly enabled; no credentials appear in status',()=>{
  assert.deepEqual(smtpConfiguration({}),{enabled:false});
  assert.deepEqual(smtpConfiguration({...smtp,RECOVERY_EMAIL_ENABLED:'1'}),{enabled:false});
  const status=mailStatus(smtp);assert.equal(status.configured,true);
  for(const secret of [smtp.SMTP_USER,smtp.SMTP_PASSWORD,smtp.SMTP_HOST,smtp.SMTP_FROM])assert.ok(!JSON.stringify(status).includes(secret));
});
test('STARTTLS is mandatory, validated and bounded; arbitrary files/URLs and logs disabled',()=>{
  const cfg=smtpConfiguration(smtp);assert.equal(cfg.transport.secure,false);assert.equal(cfg.transport.requireTLS,true);
  assert.equal(cfg.transport.ignoreTLS,false);assert.equal(cfg.transport.opportunisticTLS,false);assert.equal(cfg.transport.tls.rejectUnauthorized,true);
  assert.equal(cfg.transport.tls.minVersion,'TLSv1.2');assert.equal(cfg.transport.auth.pass,smtp.SMTP_PASSWORD);
  assert.equal(cfg.transport.disableFileAccess,true);assert.equal(cfg.transport.disableUrlAccess,true);assert.equal(cfg.transport.logger,false);assert.equal(cfg.transport.debug,false);
  assert.equal(cfg.transport.socketTimeout,20000);assert.equal(cfg.transport.connectionTimeout,10000);
});
test('implicit TLS and trusted authenticated-by-network TLS relay are supported',()=>{
  const cfg=smtpConfiguration({...smtp,SMTP_SECURITY:'tls',SMTP_PORT:''});assert.equal(cfg.transport.port,465);assert.equal(cfg.transport.secure,true);
  assert.equal('auth' in smtpConfiguration({...smtp,SMTP_USER:'',SMTP_PASSWORD:''}).transport,false);
});
for(const changes of [{SMTP_HOST:''},{SMTP_HOST:'smtp://evil.test'},{SMTP_SECURITY:'none'},{SMTP_SECURITY:'false'},{SMTP_PORT:'0'},{SMTP_PORT:'65536'},{SMTP_PORT:'25junk'},{SMTP_USER:'user',SMTP_PASSWORD:''},{SMTP_PASSWORD:'abc\r\nxyz'},{SMTP_FROM:'A <a@example.test>'},{APP_ORIGIN:'http://public.test'}])test('invalid mail config fails closed '+JSON.stringify(changes),()=>{
  assert.throws(()=>smtpConfiguration({...smtp,...changes}));const status=mailStatus({...smtp,...changes});assert.equal(status.configured,false);assert.equal(status.enabled,true);
});
test('reset email has a fragment link and expires, without an attachment/HTML/password',()=>{
  const link=resetLink(smtp.APP_ORIGIN,token),mail=recoveryMail('reset',smtp.APP_ORIGIN,link);
  assert.match(mail.text,/30 minutes/);assert.match(mail.text,/unchanged until/);assert.ok(mail.text.includes(link));
  assert.deepEqual(Object.keys(mail).sort(),['subject','text']);assert.ok(!mail.text.includes(password));
  assert.throws(()=>recoveryMail('reset',smtp.APP_ORIGIN,link+'&leak=1'));assert.throws(()=>recoveryMail('reset',smtp.APP_ORIGIN,link.replace('tcg.webwire.cloud','evil.test')));
});
test('changed/test notification cannot include the reset secret or authenticate the user',()=>{
  for(const kind of ['changed','test']){const mail=recoveryMail(kind,smtp.APP_ORIGIN,token);assert.ok(!mail.text.includes(token));assert.ok(!('password' in mail));}
  assert.throws(()=>recoveryMail('arbitrary',smtp.APP_ORIGIN));
});
