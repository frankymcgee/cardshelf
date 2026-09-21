import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,existsSync,statSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile,spawnSync } from 'node:child_process';
import { createPrivateKey,createPublicKey } from 'node:crypto';
import { createServer } from 'node:http';
const root=fileURLToPath(new URL('../',import.meta.url));
const openssl=spawnSync('openssl',['version'],{encoding:'utf8'}).status===0;
const key='a'.repeat(64);
const baseEnv=`APP_ORIGIN=https://cardshelf.cloud\nAPP_DOMAIN=cardshelf.cloud\nCARDSHELF_INTEGRATION_KEY=${key}\n`;
function fixture(run){
  const dir=mkdtempSync(join(tmpdir(),'cardshelf-postal-'));
  mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'deploy/postal'),{recursive:true});mkdirSync(join(dir,'bin'));
  for(const name of ['scripts/configure-postal.sh','scripts/compose.sh','scripts/restore.sh','deploy/postal/sync-certificates.sh'])copyFileSync(join(root,name),join(dir,name));
  writeFileSync(join(dir,'.env'),baseEnv,{mode:0o600});
  const invoke=(script,...args)=>spawnSync('sh',[script,...args],{cwd:dir,encoding:'utf8',timeout:10000,env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH}});
  try{run({dir,invoke});}finally{rmSync(dir,{recursive:true,force:true});}
}
test('Postal bootstrap generates private independent secrets and a matching 2048-bit signing key without changing app config',{skip:!openssl},()=>fixture(({dir,invoke})=>{
  const before=readFileSync(join(dir,'.env'),'utf8'),result=invoke('scripts/configure-postal.sh');assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(join(dir,'.env'),'utf8'),before);const env=readFileSync(join(dir,'deploy/postal/.env'),'utf8'),password=env.match(/^POSTAL_DB_PASSWORD=([a-f0-9]{64})$/m)?.[1];assert.ok(password);assert.notEqual(password,key);
  const config=readFileSync(join(dir,'deploy/postal/config/postal.yml'),'utf8');assert.match(config,new RegExp(`password: "${password}"`));assert.match(config,/secret_key: "[a-f0-9]{128}"/);assert.match(config,/ssl_version: TLSv1_2/);
  const privateKey=createPrivateKey(readFileSync(join(dir,'deploy/postal/config/signing.key'))),publicKey=createPublicKey(readFileSync(join(dir,'deploy/postal/config/signing-public.pem')));
  assert.equal(privateKey.asymmetricKeyDetails.modulusLength,2048);assert.equal(createPublicKey(privateKey).export({type:'spki',format:'pem'}),publicKey.export({type:'spki',format:'pem'}));
  for(const path of ['deploy/postal/.env','deploy/postal/config/postal.yml','deploy/postal/config/signing.key'])assert.equal(statSync(join(dir,path)).mode&0o777,0o600);
  assert.equal(result.stdout.includes(password),false);assert.equal(result.stdout.includes(key),false);assert.equal(invoke('scripts/configure-postal.sh').status,1);assert.equal(readFileSync(join(dir,'deploy/postal/.env'),'utf8'),env);
}));
test('Postal bootstrap never sources dotenv and refuses a mismatched live domain',{skip:!openssl},()=>fixture(({dir,invoke})=>{
  writeFileSync(join(dir,'.env'),baseEnv.replace('https://cardshelf.cloud','https://previous.example.test')+'UNTRUSTED=$(touch unsafe-dotenv-executed)\n');
  const before=readFileSync(join(dir,'.env'),'utf8'),r=invoke('scripts/configure-postal.sh');assert.equal(r.status,1);assert.match(r.stderr,/APP_ORIGIN=https:\/\/cardshelf.cloud/);assert.equal(existsSync(join(dir,'deploy/postal/config')),false);assert.equal(existsSync(join(dir,'unsafe-dotenv-executed')),false);assert.equal(readFileSync(join(dir,'.env'),'utf8'),before);
}));
test('Postal bootstrap fails safely for missing encryption key and existing/symlinked configuration',{skip:!openssl},()=>fixture(({dir,invoke})=>{
  writeFileSync(join(dir,'.env'),baseEnv.replace(key,''));assert.equal(invoke('scripts/configure-postal.sh').status,1);assert.equal(existsSync(join(dir,'deploy/postal/.env')),false);
  writeFileSync(join(dir,'.env'),baseEnv);
  // A dangling config symlink must be rejected before any generated files exist.
  symlinkSync(join(dir,'unrelated'),join(dir,'deploy/postal/config'));const r=invoke('scripts/configure-postal.sh');assert.equal(r.status,1);assert.match(r.stderr,/Refusing to overwrite/);assert.equal(existsSync(join(dir,'deploy/postal/.env')),false);
}));
test('Compose wrapper retains legacy arguments and selects all Postal files only when configured',()=>fixture(({dir,invoke})=>{
  writeFileSync(join(dir,'bin/docker'),'#!/bin/sh\nprintf "%s\\n" "$@"\n',{mode:0o755});
  assert.equal(invoke('scripts/compose.sh','ps').stdout,'compose\nps\n');writeFileSync(join(dir,'deploy/postal/.enabled'),'postal-3.3.7\n');
  assert.equal(invoke('scripts/compose.sh','ps').status,1);writeFileSync(join(dir,'deploy/postal/.env'),'POSTAL_DB_PASSWORD=fixture\n');
  assert.deepEqual(invoke('scripts/compose.sh','ps').stdout.trim().split('\n'),['compose','--env-file','.env','--env-file','deploy/postal/.env','-f','compose.yaml','-f','compose.https.yaml','-f','deploy/postal/compose.postal.yaml','ps']);
}));
test('Postal web health probe uses the configured Host, accepts login redirects without following them, and rejects HTTP failures',{skip:!openssl},async()=>{
  let hostname;
  fixture(({dir,invoke})=>{
    const result=invoke('scripts/configure-postal.sh');assert.equal(result.status,0,result.stderr);
    hostname=readFileSync(join(dir,'deploy/postal/config/postal.yml'),'utf8').match(/^  web_hostname: (\S+)$/m)?.[1];assert.ok(hostname);
  });
  const compose=readFileSync(join(root,'deploy/postal/compose.postal.yaml'),'utf8');
  const web=compose.match(/^  postal-web:\r?\n((?: {4}.*(?:\r?\n|$))*)/m)?.[1];assert.ok(web,'postal-web service must exist');
  const probe=JSON.parse(web.match(/^      test: (\[.*\])$/m)?.[1]||'null');
  assert.ok(Array.isArray(probe),'web health probe must be an exec-form JSON array');assert.deepEqual(probe.slice(0,2),['CMD','curl']);
  assert.equal(probe.at(-1),'http://127.0.0.1:5000/');
  const requests=[];let healthyStatus=302;
  const server=createServer((request,response)=>{
    const status=request.headers.host===hostname?healthyStatus:403;
    requests.push({host:request.headers.host,path:request.url,status});
    // An inaccessible redirect target makes following redirects fail the probe.
    response.writeHead(status,status===302?{Location:'http://127.0.0.1:1/unreachable-login'}:{});response.end();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const args=probe.slice(2,-1).concat(`http://127.0.0.1:${server.address().port}/`);
    const run=argv=>new Promise(resolve=>execFile(probe[1],argv,{timeout:7000,env:{...process.env,NO_PROXY:'127.0.0.1',no_proxy:'127.0.0.1'}},(error,stdout,stderr)=>resolve({status:error?.code??0,stderr})));
    const healthy=await run(args);assert.equal(healthy.status,0,healthy.stderr);assert.deepEqual(requests,[{host:hostname,path:'/',status:302}]);
    const header=args.findIndex((arg,index)=>arg==='--header'&&/^Host:/i.test(args[index+1]||''));assert.ok(header>=0,'probe must send an explicit Host header');
    const blocked=await run(args.filter((_,index)=>index!==header&&index!==header+1));assert.equal(blocked.status,22,blocked.stderr);assert.equal(requests.at(-1).status,403);assert.notEqual(requests.at(-1).host,hostname);
    healthyStatus=500;
    const failed=await run(args);assert.equal(failed.status,22,failed.stderr);assert.match(failed.stderr,/500/);assert.deepEqual(requests.at(-1),{host:hostname,path:'/',status:500});
  }finally{await new Promise(resolve=>server.close(resolve));}
});
function cert(dir,name,days,ca=null){
  const call=args=>{const r=spawnSync('openssl',args,{cwd:dir,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
  const common=['-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',name+'.key','-subj','/CN=smtp.cardshelf.cloud','-addext','subjectAltName=DNS:smtp.cardshelf.cloud'];
  if(ca){call(['req','-new',...common,'-out',name+'.csr']);call(['x509','-req','-in',name+'.csr','-CA',ca+'.cert','-CAkey',ca+'.key','-CAcreateserial','-days',String(days),'-copy_extensions','copy','-out',name+'.cert']);}
  else call(['req','-x509',...common,'-days',String(days),'-out',name+'.cert']);
}
test('SMTP certificate sync rejects untrusted staging certificates, copies newest trusted chain, and reloads only on change',{skip:!openssl},()=>fixture(({dir,invoke})=>{
  writeFileSync(join(dir,'deploy/postal/.enabled'),'postal-3.3.7\n');writeFileSync(join(dir,'deploy/postal/.env'),'POSTAL_DB_PASSWORD=fixture\n');mkdirSync(join(dir,'deploy/postal/config'));
  cert(dir,'ca',30);cert(dir,'older',3,'ca');cert(dir,'newer',5,'ca');cert(dir,'untrusted',90);
  const paths={};for(const name of ['older','newer','untrusted']){const base=`/data/caddy/certificates/${name}/smtp.cardshelf.cloud/smtp.cardshelf.cloud`;paths[base+'.crt']=join(dir,name+'.cert');paths[base+'.key']=join(dir,name+'.key');}
  writeFileSync(join(dir,'paths.json'),JSON.stringify(paths));
  writeFileSync(join(dir,'bin/docker'),`#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2),base=${JSON.stringify(dir)},paths=JSON.parse(fs.readFileSync(base+'/paths.json'));
if(args[0]==='compose'){
 if(args.includes('find'))process.stdout.write(Object.keys(paths).filter(p=>p.endsWith('.crt')).join('\\n')+'\\n');
 else if(args.includes('cat'))process.stdout.write(fs.readFileSync(paths[args.at(-1)]));
 else if(args.includes('ps'))process.stdout.write('smtp-instance\\n');
 else if(args.includes('restart'))fs.appendFileSync(base+'/restarts',args.at(-1)+'\\n');
 else process.exit(2);
}else if(args[0]==='run'){
 const volumes=args.flatMap((arg,i)=>arg==='--volume'?[args[i+1]]:[]),incoming=volumes.find(v=>v.endsWith(':/incoming:rw')).slice(0,-13),config=volumes.find(v=>v.endsWith(':/config:rw')).slice(0,-11);
 const changed=['smtp.cert','smtp.key'].some(name=>!fs.existsSync(config+'/'+name)||!fs.readFileSync(config+'/'+name).equals(fs.readFileSync(incoming+'/'+name)));
 if(changed)for(const name of ['smtp.cert','smtp.key'])fs.copyFileSync(incoming+'/'+name,config+'/'+name);
 fs.writeFileSync(incoming+'/status',changed?'changed\\n':'unchanged\\n');
}else process.exit(2);
`,{mode:0o755});
  // The fixture CA is trusted only by this child process, never added to system trust.
  const run=()=>spawnSync('sh',['deploy/postal/sync-certificates.sh'],{cwd:dir,encoding:'utf8',timeout:15000,env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,SSL_CERT_FILE:join(dir,'ca.cert')}});
  let r=run();assert.equal(r.status,0,r.stderr);assert.equal(readFileSync(join(dir,'deploy/postal/config/smtp.cert'),'utf8'),readFileSync(join(dir,'newer.cert'),'utf8'));assert.equal(readFileSync(join(dir,'restarts'),'utf8'),'postal-smtp\n');
  r=run();assert.equal(r.status,0,r.stderr);assert.equal(readFileSync(join(dir,'restarts'),'utf8'),'postal-smtp\n');assert.match(r.stdout,/unchanged/);
  const before=readFileSync(join(dir,'deploy/postal/config/smtp.cert'),'utf8');writeFileSync(join(dir,'paths.json'),JSON.stringify(Object.fromEntries(Object.entries(paths).filter(([p])=>p.includes('/untrusted/')))));
  r=run();assert.equal(r.status,1);assert.match(r.stderr,/No valid Caddy certificate/);assert.equal(readFileSync(join(dir,'deploy/postal/config/smtp.cert'),'utf8'),before);assert.equal(existsSync(join(dir,'deploy/postal/.smtp-sync.lock')),false);
}));
test('database restore migrates and expires pending mail/reset credentials before application restart',()=>fixture(({dir,invoke})=>{
  writeFileSync(join(dir,'backup.dump'),'fixture');writeFileSync(join(dir,'scripts/backup.sh'),'#!/bin/sh\nexit 0\n');
  writeFileSync(join(dir,'bin/docker'),`#!/usr/bin/env node
import fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(join(dir,'calls'))},JSON.stringify(args)+'\\n');
if(args.includes('psql'))fs.writeFileSync(${JSON.stringify(join(dir,'restore.sql'))},fs.readFileSync(0));
`,{mode:0o755});
  const r=invoke('scripts/restore.sh','backup.dump','--confirm-restore');assert.equal(r.status,0,r.stderr);const calls=readFileSync(join(dir,'calls'),'utf8').trim().split('\n').map(line=>JSON.parse(line).join(' '));
  const migrate=calls.findIndex(x=>x.includes('run --rm migrate')),cleanup=calls.findIndex(x=>x.includes('psql')),start=calls.findIndex(x=>x.includes('up -d app worker'));assert.ok(migrate<cleanup&&cleanup<start);
  const sql=readFileSync(join(dir,'restore.sql'),'utf8');assert.match(sql,/DELETE FROM password_recovery_tokens/);assert.match(sql,/UPDATE password_recovery_mail SET status='expired'/);assert.match(sql,/UPDATE email_outbox SET status='expired'/);assert.equal((sql.match(/WHERE status IN \('queued','sending'\)/g)||[]).length,2);assert.equal(sql.includes('DELETE FROM email_suppressions'),false);assert.equal(sql.includes('email_settings'),false);
}));
