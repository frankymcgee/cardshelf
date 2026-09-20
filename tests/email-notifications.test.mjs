import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationMail,deliveryMessageId } from '../lib/email-outbox.mjs';

const origin='https://cardshelf.cloud',conversation_id='01234567-89ab-4cde-8fab-0123456789ab';
test('marketplace emails contain a trusted authenticated inbox link without private message content',()=>{
  for(const kind of ['marketplace_enquiry','marketplace_reply']){
    const mail=notificationMail(kind,{conversation_id,body:'PRIVATE USER MESSAGE',name:'PRIVATE PERSON',url:'https://untrusted.example'},origin);
    assert.deepEqual(Object.keys(mail).sort(),['subject','text']);
    assert.ok(mail.text.includes(origin+'/marketplace/inbox?thread='+conversation_id));
    for(const privateText of ['PRIVATE USER MESSAGE','PRIVATE PERSON','untrusted.example'])assert.ok(!JSON.stringify(mail).includes(privateText));
  }
});
test('password-change notifications contain no password or reset token and link to recovery',()=>{
  const mail=notificationMail('password_changed',{password:'SECRET-PASSWORD',token:'SECRET-TOKEN'},origin);
  assert.ok(mail.text.includes(origin+'/forgot-password'));
  assert.ok(!JSON.stringify(mail).includes('SECRET-'));assert.ok(!mail.text.includes('#token='));
});
test('membership emails disclose no assignment reason or recipient data',()=>{
  const mail=notificationMail('membership_changed',{revision:4,reason:'PRIVATE ADMIN REASON',email:'private@example.test'},origin);
  assert.ok(mail.text.includes(origin+'/membership'));
  assert.ok(!JSON.stringify(mail).includes('PRIVATE'));assert.ok(!JSON.stringify(mail).includes('private@example.test'));
});
test('notification links reject unsafe configured origins and invalid conversation identifiers',()=>{
  for(const value of ['https://cardshelf.cloud@evil.example/path','javascript:alert(1)','http://public.example','https://cardshelf.cloud?redirect=evil'])
    assert.throws(()=>notificationMail('test',{},value));
  assert.throws(()=>notificationMail('marketplace_reply',{conversation_id:'../../admin'},origin));
  assert.throws(()=>notificationMail('arbitrary',{},origin));
});
test('delivery IDs are stable across attempts and use the configured application hostname',()=>{
  assert.equal(deliveryMessageId('outbox',conversation_id,origin),`<cardshelf.outbox.${conversation_id}@cardshelf.cloud>`);
  assert.equal(deliveryMessageId('outbox',conversation_id,origin),deliveryMessageId('outbox',conversation_id,origin));
  assert.notEqual(deliveryMessageId('outbox',conversation_id,origin),deliveryMessageId('recovery',conversation_id,origin));
});
