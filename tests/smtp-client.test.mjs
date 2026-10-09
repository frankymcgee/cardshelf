import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSmtpAddress, smtpDestination, smtpSend, smtpVerify, smtpDeliveryFailure } from '../lib/smtp-client.mjs';
import { smtpSettingsInput, encryptSmtpSecret, decryptSmtpSecret } from '../lib/smtp-settings.mjs';
import { emailConfigurationFromRow, emailSettings, emailSettingsInput } from '../lib/email-settings.mjs';
const env={APP_ORIGIN:'https://cardshelf.cloud',CARDSHELF_INTEGRATION_KEY:'a1'.repeat(32),POSTAL_ORIGIN:'invalid-unused-Postal-setting'};
const smtp={smtp_preset:'wpmu',smtp_host:'mailu.wpmudev.host',smtp_port:587,smtp_security:'starttls',smtp_user:'noreply@cardshelf.cloud',smtp_rate_limit:10};
const secret='SYNTHETIC SMTP PASSWORD', config={...smtp,provider:'smtp',enabled:true,configured:true,smtp_password:secret,sender_name:'CardShelf',from_address:'noreply@cardshelf.cloud',reply_to:'support@cardshelf.cloud'};
const resolver={resolve4:async()=>['93.184.216.34'],resolve6:async()=>[]};
const message={subject:'Synthetic SMTP test',text:'Private synthetic test body'},messageId='<cardshelf.outbox.01234567-89ab-4cde-8fab-0123456789ab@cardshelf.cloud>';
const input={revision:0,enabled:false,sender_name:'CardShelf',from_address:'noreply@cardshelf.cloud',provider:'smtp',...smtp,smtp_password:secret};
test('SMTP secrets are encrypted and bound to the exact server, port, TLS mode and account',()=>{
  const encrypted=encryptSmtpSecret(secret,smtp,env);
  assert.equal(decryptSmtpSecret(encrypted,smtp,env),secret);assert.ok(!encrypted.includes(secret));assert.notEqual(encrypted,encryptSmtpSecret(secret,smtp,env));
  for(const patch of [{smtp_preset:'custom',smtp_host:'another.example.com'},{smtp_user:'other@cardshelf.cloud'},{smtp_preset:'custom',smtp_host:'smtp.example.com',smtp_port:465,smtp_security:'tls'}])assert.throws(()=>decryptSmtpSecret(encrypted,{...smtp,...patch},env),/cannot be unlocked/);
  assert.throws(()=>decryptSmtpSecret(encrypted,smtp,{...env,CARDSHELF_INTEGRATION_KEY:'b2'.repeat(32)}),/cannot be unlocked/);
  assert.throws(()=>decryptSmtpSecret(encrypted.slice(0,-4)+'AAAA',smtp,env),/cannot be unlocked/);
});
test('SMTP is independent of the Postal origin and inactive API secret',async()=>{
  const row={...smtp,provider:'smtp',enabled:true,revision:4,smtp_secret:encryptSmtpSecret(secret,smtp,env),api_secret:'invalid-inactive-Postal-secret',smtp_verified_revision:4,smtp_verified_at:'2026-10-09T00:00:00Z'};
  const c=emailConfigurationFromRow(row,env);assert.equal(c.configured,true);assert.equal(c.origin,'');assert.equal(c.secret,'');assert.equal(c.smtp_password,secret);assert.ok(c.smtp_verified_at);
  const original=process.env.CARDSHELF_INTEGRATION_KEY;process.env.CARDSHELF_INTEGRATION_KEY=env.CARDSHELF_INTEGRATION_KEY;
  try {const visible=await emailSettings(async()=>[row]);assert.equal(visible.smtp_password_set,true);assert.ok(!JSON.stringify(visible).includes(secret));assert.equal(visible.smtp_password,undefined);assert.equal(visible.secret,undefined);assert.equal(visible.smtp_secret,undefined);assert.equal(visible.api_secret,undefined);}
  finally {if(original===undefined)delete process.env.CARDSHELF_INTEGRATION_KEY;else process.env.CARDSHELF_INTEGRATION_KEY=original;}
  assert.equal(emailConfigurationFromRow({...row,revision:5},env).smtp_verified_at,null);
  const locked=emailConfigurationFromRow(row,{...env,CARDSHELF_INTEGRATION_KEY:''});assert.equal(locked.configured,false);assert.equal(locked.smtp_password,'');
  assert.equal(emailConfigurationFromRow(row,{...env,NODE_TLS_REJECT_UNAUTHORIZED:'0'}).configured,false);
});
test('SMTP input rejects unsafe destinations, TLS downgrades, malformed credentials and excessive WPMU rates',()=>{
  assert.equal(emailSettingsInput(input).provider,'smtp');
  for(const patch of [{provider:'unknown'},{smtp_host:'https://mailu.wpmudev.host'},{smtp_host:'127.0.0.1'},{smtp_host:'metadata.internal'},{smtp_host:'smtp..example.com'},
    {smtp_preset:'custom',smtp_host:'localhost'},{smtp_port:25},{smtp_port:465},{smtp_security:'none'},{smtp_rate_limit:11},{smtp_host:'different.example.com'},
    {smtp_user:'user\r\nAUTH attacker'},{smtp_password:'secret\npassword'},{smtp_password:secret,clear_smtp_password:true},{clear_smtp_password:'true'},
    {smtp_host:''},{smtp_user:''},{smtp_rate_limit:0},{smtp_rate_limit:1.5},{tls:{rejectUnauthorized:false}}])assert.throws(()=>emailSettingsInput({...input,...patch}),JSON.stringify(patch));
  assert.equal(smtpSettingsInput({...smtp,smtp_preset:'custom',smtp_host:'smtp.example.com',smtp_port:465,smtp_security:'tls',smtp_rate_limit:60}).smtp_port,465);
});
test('SMTP destinations reject loopback, private, link-local, metadata, documentation, multicast and mapped addresses',()=>{
  for(const address of ['0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','172.31.255.255','192.0.0.1','192.0.2.4','192.168.1.1','198.18.0.1','198.51.100.1','203.0.113.1','224.1.2.3','255.255.255.255',
    '::','::1','::ffff:127.0.0.1','::ffff:7f00:1','fc00::1','fd00::1','fe80::1','ff02::1','2001:db8::1','2001::1','2002:7f00:1::1','3fff::1','invalid'])assert.equal(publicSmtpAddress(address),false,address);
  for(const address of ['93.184.216.34','8.8.8.8','172.32.0.1','100.128.0.1','2001:4860:4860::8888','2606:4700:4700::1111'])assert.equal(publicSmtpAddress(address),true,address);
});
test('SMTP resolves once and rejects mixed public/private or oversized DNS results before creating a connection',async()=>{
  for(const answers of [[],['93.184.216.34','10.0.0.1'],['not-an-IP'],Array(33).fill('93.184.216.34')]){
    let calls=0;await assert.rejects(smtpVerify(config,{env,resolver:{resolve4:async()=>answers,resolve6:async()=>[]},createTransport:()=>{calls++;}}));assert.equal(calls,0);
  }
  await assert.rejects(smtpDestination(smtp.smtp_host,{resolve4:async()=>{throw Error('PRIVATE-DNS-ERROR');},resolve6:async()=>[]}),/public addresses/);
  assert.equal(await smtpDestination(smtp.smtp_host,{resolve4:async()=>[],resolve6:async()=>['2606:4700:4700::1111']}),'2606:4700:4700::1111');
});
test('SMTP verification uses a pinned public address, authenticated verified TLS and never sends a message',async()=>{
  for(const c of [config,{...config,smtp_preset:'custom',smtp_host:'smtp.example.com',smtp_port:465,smtp_security:'tls'}]){
    let close=0,checks=0;const result=await smtpVerify(c,{env,resolver,createTransport:options=>{
      assert.equal(options.host,'93.184.216.34');assert.equal(options.tls.servername,c.smtp_host);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.tls.minVersion,'TLSv1.2');assert.equal(options.secure,c.smtp_port===465);
      assert.equal(options.requireTLS,true);assert.equal(options.ignoreTLS,false);assert.equal(options.opportunisticTLS,false);assert.deepEqual(options.auth,{user:c.smtp_user,pass:secret});
      for(const key of ['logger','debug','transactionLog','pool'])assert.equal(options[key],false);assert.equal(options.disableFileAccess,true);assert.equal(options.disableUrlAccess,true);
      return {verify:async()=>{checks++;return true;},sendMail:()=>assert.fail('Verification sent a message'),close:()=>{close++;}};
    }});assert.equal(result.verified,true);assert.equal(close,1);assert.equal(checks,1);
  }
  let calls=0;await assert.rejects(smtpVerify(config,{env:{...env,NODE_TLS_REJECT_UNAUTHORIZED:'0'},resolver,createTransport:()=>{calls++;}}));assert.equal(calls,0);
  await assert.rejects(smtpVerify(config,{env,resolver,createTransport:()=>({verify:async()=>false,close(){}})}));
});
test('SMTP submission is text-only to one recipient and records acceptance without claiming delivery',async()=>{
  let close=0;const result=await smtpSend(config,'member@example.com',message,{env,resolver,messageId,createTransport:()=>({
    sendMail:async mail=>{assert.deepEqual(mail.to,{address:'member@example.com'});assert.deepEqual(mail.from,{name:'CardShelf',address:config.from_address});assert.deepEqual(mail.replyTo,{address:config.reply_to});assert.equal(mail.messageId,messageId);assert.equal(mail.text,message.text);assert.equal(mail.attachments,undefined);assert.equal(mail.html,undefined);assert.equal(mail.disableUrlAccess,true);return {accepted:['member@example.com'],messageId:'ignored-provider-value'};},close:()=>{close++;}
  })});assert.deepEqual(result,{provider:'smtp',provider_id:null,message_id:messageId});assert.equal(result.delivered_at,undefined);assert.equal(close,1);
});
test('SMTP failures are sanitized and only explicit rejections are safe to retry',async()=>{
  for(const [error,expected] of [[{emailDelivery:'not_sent',code:'ECONNREFUSED'},'not_sent'],[{code:'EAUTH'},'rejected'],[{code:'ETLS'},'rejected'],[{responseCode:451},'rejected'],[{responseCode:550},'rejected'],[{code:'ESOCKET',command:'DATA'},'uncertain'],[{code:'ETIMEDOUT'},'uncertain'],[{},'uncertain']]){
    assert.equal(smtpDeliveryFailure(error),expected);
    await assert.rejects(smtpSend(config,'member@example.com',message,{env,resolver,messageId,createTransport:()=>({sendMail:async()=>{throw Object.assign(Error('SECRET-DIAGNOSTIC '+secret),error);},close(){}})}),failure=>{assert.equal(failure.emailDelivery,expected);assert.equal(failure.emailProvider,'smtp');assert.ok(!failure.message.includes(secret));assert.ok(!failure.message.includes('SECRET-DIAGNOSTIC'));return true;});
  }
});
test('SMTP rejects header injection, arbitrary content, disabled mail and extra recipients before connecting',async()=>{
  let calls=0;const options={env,resolver,messageId,createTransport:()=>{calls++;assert.fail('Unexpected SMTP connection');}};
  for(const [c,recipient,mail,extra] of [[{...config,enabled:false},'member@example.com',message,{}],[config,'a@example.com,b@example.com',message,{}],[config,'member@example.com',{...message,subject:'Subject\r\nBcc: x@y.com'},{}],[config,'member@example.com',{...message,text:'x\0y'},{}],[config,'member@example.com',message,{messageId:'bad\r\nid'}]])await assert.rejects(smtpSend(c,recipient,mail,{...options,...extra}));
  assert.equal(calls,0);
});
