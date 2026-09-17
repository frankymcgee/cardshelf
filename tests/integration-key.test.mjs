// Keep credential-key protection coverage after retiring the Square connector tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,copyFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const source=new URL('../scripts/configure-integrations.sh',import.meta.url);
async function fixture(run){const dir=await mkdtemp(join(tmpdir(),'cardshelf-key-'));try{await mkdir(join(dir,'scripts'));await copyFile(source,join(dir,'scripts/configure-integrations.sh'));await run(dir)}finally{await rm(dir,{recursive:true,force:true})}}
const configure=dir=>spawnSync('sh',[join(dir,'scripts/configure-integrations.sh')],{encoding:'utf8'});
test('integration-key setup is private and preserves billing defaults',()=>fixture(async dir=>{
 const content='STRIPE_BILLING_ENABLED=false\nMEMBERSHIP_ENFORCEMENT_ENABLED=false\nEXISTING_SECRET=preserve-me\n';
 await writeFile(join(dir,'.env'),content);const first=configure(dir);assert.equal(first.status,0,first.stderr);
 const saved=await readFile(join(dir,'.env'),'utf8');assert.ok(saved.startsWith(content));
 const key=saved.match(/^CARDSHELF_INTEGRATION_KEY=([a-f0-9]{64})$/m)?.[1];assert.ok(key);
 assert.equal((await stat(join(dir,'.env'))).mode&0o777,0o600);assert.ok(!first.stdout.includes(key));
 assert.equal(configure(dir).status,0);assert.equal(await readFile(join(dir,'.env'),'utf8'),saved);
}));
test('invalid or duplicate existing keys cannot be silently regenerated',()=>fixture(async dir=>{
 for(const content of ['CARDSHELF_INTEGRATION_KEY=broken\n',`CARDSHELF_INTEGRATION_KEY=${'ab'.repeat(32)}\nCARDSHELF_INTEGRATION_KEY=${'cd'.repeat(32)}\n`]){
   await writeFile(join(dir,'.env'),content);assert.notEqual(configure(dir).status,0);assert.equal(await readFile(join(dir,'.env'),'utf8'),content);
 }
}));
test('key setup never creates a replacement environment when the original is missing',()=>fixture(async dir=>{assert.notEqual(configure(dir).status,0);await assert.rejects(()=>stat(join(dir,'.env')))}));
