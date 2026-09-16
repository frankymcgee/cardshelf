import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,safeEqual,digest,randomToken,isAllowedMutation} from '../lib/security.mjs';
test('scrypt passwords verify without storing plaintext',async()=>{
  const password='  a secure collector password  ',hash=await hashPassword(password);
  assert.ok(hash.startsWith('scrypt-v1$'));assert.ok(!hash.includes(password));
  assert.equal(await verifyPassword(password,hash),true);
  assert.equal(await verifyPassword(password.trim(),hash),false);
  assert.equal(await verifyPassword('wrong password',hash),false);
});
test('identical passwords receive different salts',async()=>assert.notEqual(await hashPassword('same password 123'),await hashPassword('same password 123')));
test('malformed password records fail closed',async()=>{
  for(const value of [null,'','scrypt$bad$bad','scrypt-v1$aa$bb','scrypt-v1$'+ 'a'.repeat(32)+'$'+'a'.repeat(128)+'$extra']) assert.equal(await verifyPassword('password',value),false);
});
test('tokens have 256 bits of random output',()=>{
  const token=randomToken();assert.match(token,/^[a-f0-9]{64}$/);assert.notEqual(token,randomToken());assert.notEqual(token,digest(token));
});
test('secret comparisons handle different lengths',()=>{assert.ok(safeEqual('same','same'));assert.ok(!safeEqual('same','different'));assert.ok(!safeEqual('same',''));});
test('writes require the exact configured origin and application header',()=>{
  const valid={origin:'https://cards.example.com',expectedOrigin:'https://cards.example.com',requestedWith:'cardshelf',fetchSite:'same-origin'};
  assert.ok(isAllowedMutation(valid));
  for(const origin of ['https://evil.test','https://cards.example.com.evil.test','http://cards.example.com',undefined,'null']) assert.ok(!isAllowedMutation({...valid,origin}));
  assert.ok(!isAllowedMutation({...valid,requestedWith:undefined}));assert.ok(!isAllowedMutation({...valid,fetchSite:'cross-site'}));
});
