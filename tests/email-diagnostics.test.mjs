import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { EMAIL_DNS_NOTICE,emailDnsDiagnostics,inspectSpf,inspectDkim,inspectDmarc } from '../lib/email-diagnostics.mjs';
const key=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'der',type:'spki'}).toString('base64');
const dkim='v=DKIM1; k=rsa; p='+key;
const txt=value=>[[value]];
test('SMTP diagnostics ignore even a saved Postal origin and inspect the selected sender only',async()=>{
  const queried=[],resolver={resolveTxt:async name=>{queried.push(name);return name.startsWith('_dmarc')?txt('v=DMARC1; p=reject'):name.includes('_domainkey')?txt(dkim):txt('v=spf1 include:mail.example.com -all');},resolve4:()=>assert.fail('SMTP diagnostics queried Postal A records'),resolve6:()=>assert.fail('SMTP diagnostics queried Postal AAAA records'),resolveCname:()=>assert.fail('SMTP diagnostics queried Postal return path')};
  const result=await emailDnsDiagnostics({provider:'smtp',origin:'https://postal.cardshelf.cloud',dkim_selector:'selected-smtp',dkim_public_key:dkim},{resolver});
  assert.deepEqual(queried.sort(),['_dmarc.cardshelf.cloud','cardshelf.cloud','selected-smtp._domainkey.cardshelf.cloud'].sort());
  assert.equal(result.checks.length,3);assert.ok(result.checks.every(c=>c.status==='pass'));
});
test('SPF recognizes a single constrained record with expected include without promising authorization',()=>{
 const r=inspectSpf(txt('v=spf1 ip4:203.0.113.4 include:spf.postal.cardshelf.cloud -all'),{expectedInclude:'spf.postal.cardshelf.cloud'});assert.equal(r.status,'pass');assert.match(r.detail,/not evaluated/);
});
test('SPF joins DNS TXT chunks but rejects duplicate policies and invalid addresses',()=>{
 assert.equal(inspectSpf([['v=spf1 ','ip4:203.0.113.4 -all']]).status,'pass');
 for(const value of [[['v=spf1 -all'],['v=spf1 ~all']],txt('v=spf1 ip4:999.1.1.1 -all'),txt('v=spf1 ip6:203.0.113.1 -all'),txt('v=spf1 ip4:203.0.113.1/99 -all'),txt('v=spf1 +all')])assert.equal(inspectSpf(value).status,'fail');
 assert.equal(inspectSpf(txt('v=spf1 include:other.example -all'),{expectedInclude:'spf.postal.cardshelf.cloud'}).status,'warn');
 assert.equal(inspectSpf(txt('v=spf1 exists:%{i}.example -all')).status,'unknown');
 assert.equal(inspectSpf(txt('v=spf1 '+Array.from({length:11},(_,i)=>'include:s'+i+'.example').join(' ')+' -all')).status,'fail');
});
test('DKIM must parse actual RSA public key; expected key mismatch does not pass',()=>{
 assert.equal(inspectDkim(txt(dkim),{expected:dkim}).status,'pass');assert.equal(inspectDkim(txt(dkim)).status,'warn');
 for(const value of ['v=DKIM1; p=','v=DKIM1; p=YWJj','v=DKIM1; p='+key+'; p='+key,'v=DKIM1; k=ed25519; p='+key])assert.equal(inspectDkim(txt(value)).status,'fail');
 const other=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'der',type:'spki'}).toString('base64');assert.equal(inspectDkim(txt(dkim),{expected:'v=DKIM1; k=rsa; p='+other}).status,'fail');
 assert.equal(inspectDkim(txt(dkim),{expected:dkim+'; h=sha256'}).status,'warn');
 assert.equal(inspectDkim([...[...txt(dkim)],...[...txt(dkim)]]).status,'fail');
});
test('DMARC validates duplicate/malformed tags and distinguishes monitoring from enforcement',()=>{
 assert.equal(inspectDmarc(txt('v=DMARC1; p=reject; adkim=r; aspf=r')).status,'pass');
 for(const value of ['v=DMARC1; p=none','v=DMARC1; p=quarantine; pct=50'])assert.equal(inspectDmarc(txt(value)).status,'warn');
 for(const value of ['v=DMARC1; p=reject; p=none','v=DMARC1; p=bogus','v=DMARC1; p=reject; adkim=bad'])assert.equal(inspectDmarc(txt(value)).status,'fail');
 assert.equal(inspectDmarc([['v=DMARC1; p=reject'],['v=DMARC1; p=none']]).status,'fail');
});
test('diagnostics query only fixed domain and trusted origin derived DNS names',async()=>{
 const queried=[];const resolver={
  resolveTxt:async name=>{queried.push(name);return name.startsWith('_dmarc')?txt('v=DMARC1; p=reject'):name.includes('_domainkey')?txt(dkim):txt('v=spf1 include:spf.postal.cardshelf.cloud -all');},
  resolve4:async name=>{queried.push(name);return ['203.0.113.4'];},resolve6:async name=>{queried.push(name);return [];},resolveCname:async name=>{queried.push(name);return ['rp.postal.cardshelf.cloud.'];}
 };
 const r=await emailDnsDiagnostics({origin:'https://postal.cardshelf.cloud',dkim_selector:'postal-demo',dkim_public_key:dkim},{resolver,now:0});
 assert.equal(r.domain,'cardshelf.cloud');assert.equal(r.notice,EMAIL_DNS_NOTICE);assert.equal(r.checked_at,'1970-01-01T00:00:00.000Z');assert.equal(r.checks.length,6);
 assert.ok(queried.every(x=>x==='cardshelf.cloud'||x.endsWith('.cardshelf.cloud')));assert.equal(r.checks.find(x=>x.id==='dkim').status,'pass');
 assert.ok(!JSON.stringify(r).includes(key));assert.match(r.notice,/do not prove/);
});
test('untrusted selectors never become DNS targets and failed DNS is unknown',async()=>{
 const queried=[],resolver={resolveTxt:async n=>{queried.push(n);throw Object.assign(Error('secret server error'),{code:'ETIMEOUT'});}};
 const r=await emailDnsDiagnostics({origin:'http://private.local',dkim_selector:'../../secret.example'},{resolver});
 assert.deepEqual(queried.sort(),['_dmarc.cardshelf.cloud','cardshelf.cloud'].sort());assert.equal(r.checks[0].status,'unknown');assert.ok(!JSON.stringify(r).includes('secret server error'));
});
test('missing records and malformed or oversized DNS replies remain explicit',()=>{
 assert.equal(inspectSpf([]).status,'fail');assert.equal(inspectDkim([]).status,'fail');assert.equal(inspectDmarc([]).status,'fail');
 assert.equal(inspectSpf([['x'.repeat(9000)]]).status,'unknown');assert.equal(inspectDkim([{}]).status,'unknown');
});

test('current DMARC test/PSD/subdomain tags and retired percentage tags are described truthfully',()=>{
 assert.equal(inspectDmarc(txt('v=DMARC1; p=reject; t=n; psd=n; np=reject')).status,'pass');
 assert.equal(inspectDmarc(txt('v=DMARC1; p=reject; t=y')).status,'warn');
 assert.equal(inspectDmarc(txt('v=DMARC1')).status,'warn');
 assert.equal(inspectDmarc(txt('v=DMARC1; p=reject; pct=101')).status,'warn');
 assert.match(inspectDmarc(txt('v=DMARC1; p=reject; pct=100')).detail,/retired/);
 assert.equal(inspectDmarc(txt('v=DMARC1; p=reject; np=invalid')).status,'fail');
});
test('a matching 1024-bit DKIM key is a warning, not a production readiness pass',()=>{
 const small=generateKeyPairSync('rsa',{modulusLength:1024}).publicKey.export({format:'der',type:'spki'}).toString('base64');
 const value='v=DKIM1; k=rsa; p='+small;assert.equal(inspectDkim(txt(value),{expected:value}).status,'warn');
});
