import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,statSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const repository='ghcr.io/frankymcgee/cardshelf';
const digest='a'.repeat(64);
const pin=`${repository}@sha256:${digest}`;
const imageId=`sha256:${'b'.repeat(64)}`;
const initialEnv='APP_VERSION=0.1.1\nCARDSHELF_IMAGE=cardshelf:0.1.1\nPOSTGRES_PASSWORD=fixture-secret\nAPP_ORIGIN=https://tcg.example.test\n';
const migration='compose run --rm --no-deps --pull never -T migrate';
const start='compose up -d --no-build --pull never --no-deps --wait --wait-timeout 180 app worker';
const contractFiles=spawnSync('sh',['scripts/deployment-contract.sh','--files'],{cwd:root,encoding:'utf8'}).stdout.trim().split('\n');
function fixture(options,run) {
  const dir=mkdtempSync(join(tmpdir(),'cardshelf-upgrade-'));
  for(const file of contractFiles){mkdirSync(dirname(join(dir,file)),{recursive:true});copyFileSync(join(root,file),join(dir,file));}
  mkdirSync(join(dir,'bin'));
  writeFileSync(join(dir,'package.json'),'{"name":"cardshelf","version":"0.2.0"}\n');
  writeFileSync(join(dir,'.env'),initialEnv,{mode:0o600});
  writeFileSync(join(dir,'bin/docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
[ "$*" != "$FAILURE" ] && [ "$1" != "$FAILURE" ] || exit 42
if [ "$1" = image ]; then
  case "$4" in
    *version*) printf '%s\\n' "$IMAGE_VERSION" ;;
    *deployment-contract*) if [ "$BAD_CONTRACT" = yes ]; then echo bad; else sh scripts/deployment-contract.sh; fi ;;
    *RepoDigests*) printf '%s\\n' "$REPO_DIGESTS" ;;
    *) echo '${imageId}' ;;
  esac
fi
if [ "$1" = compose ]; then printf '%s\\n' "$CARDSHELF_IMAGE" >> "$PINS"; fi
`,{mode:0o755});
  writeFileSync(join(dir,'scripts/backup.sh'),'#!/bin/sh\necho backup >> "$CALLS"\n[ "$FAILURE" != "backup" ] || exit 42\n');
  try {
    const calls=join(dir,'calls'),pins=join(dir,'pins');
    const env={...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,CALLS:calls,PINS:pins,
      FAILURE:options.failure??'',BAD_CONTRACT:options.badContract?'yes':'no',IMAGE_VERSION:options.version??'0.2.0',
      REPO_DIGESTS:options.digests??`unrelated.example/image@sha256:${digest}\n${pin}`};
    delete env.CARDSHELF_IMAGE_REPOSITORY;
    const command=options.locked?'flock':'sh';
    const args=options.locked?['.cardshelf-upgrade.lock','sh','scripts/upgrade.sh']:['scripts/upgrade.sh',...(options.args??[])];
    const result=spawnSync(command,args,{cwd:dir,encoding:'utf8',timeout:5000,env});
    const readLines=path=>existsSync(path)?readFileSync(path,'utf8').trim().split('\n'):[];
    run(result,readLines(calls),readFileSync(join(dir,'.env'),'utf8'),{
      mode:statSync(join(dir,'.env')).mode&0o777,pins:readLines(pins),
      temporary:readdirSync(dir).filter(x=>x.startsWith('.env.upgrade.')),
      invokeAgain:()=>spawnSync('sh',['scripts/upgrade.sh'],{cwd:dir,encoding:'utf8',timeout:5000,env})
    });
  } finally {rmSync(dir,{recursive:true,force:true});}
}
function beforeStop(r,calls,env){
  assert.notEqual(r.status,0,r.stderr);
  assert.ok(!calls.some(x=>x.startsWith('compose stop')||x===migration||x===start),calls.join('\n'));
  assert.equal(env,initialEnv);
}
test('pull upgrade pins the matching repository digest for migration and restart, retaining private configuration',()=>fixture({},(r,calls,env,details)=>{
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(calls.filter(x=>!x.startsWith('image inspect')),['pull '+repository+':stable','compose config --quiet','backup','compose stop app worker',migration,start,'compose ps -a']);
  assert.match(env,/APP_VERSION=0.2.0/);assert.ok(env.includes(`CARDSHELF_IMAGE=${pin}\n`));
  assert.match(env,/POSTGRES_PASSWORD=fixture-secret/);assert.match(env,/APP_ORIGIN=https:\/\/tcg.example.test/);
  assert.equal(details.mode,0o600);assert.deepEqual(details.temporary,[]);
  assert.ok(details.pins.length>=4);assert.ok(details.pins.every(x=>x===pin));
  assert.equal(details.invokeAgain().status,0,'upgrade lock must be released after success');
}));
for(const [label,failure] of [['pull','pull '+repository+':stable'],['Compose validation','compose config --quiet'],['backup','backup']]){
  test(`a failed ${label} leaves the running site and .env unchanged`,()=>fixture({failure},(r,calls,env,details)=>{
    beforeStop(r,calls,env);assert.deepEqual(details.temporary,[]);
    if(label==='pull')assert.equal(calls.length,1);
  }));
}
test('migration failure leaves app/worker stopped and retains the previous image configuration',()=>fixture({failure:migration},(r,calls,env,details)=>{
  assert.notEqual(r.status,0);assert.ok(calls.includes('compose stop app worker'));assert.ok(!calls.includes(start));
  assert.equal(env,initialEnv);assert.deepEqual(details.temporary,[]);assert.match(r.stderr,/Migration failed/);
}));
test('health failure reports failure and retains the new image after successful migration',()=>fixture({failure:start},(r,calls,env)=>{
  assert.notEqual(r.status,0);assert.ok(calls.includes(migration));assert.ok(env.includes(pin));
  assert.ok(!calls.includes('compose ps -a'));assert.match(r.stderr,/new image remains pinned/);
}));
test('deployment mismatch fails before the backup or stop',()=>fixture({badContract:true},(r,calls,env)=>{
  beforeStop(r,calls,env);assert.ok(!calls.includes('backup'));assert.match(r.stderr,/different server deployment files/);
}));
for(const version of ['', '<no value>', 'latest', '0.2.0\nmalformed']){
  test(`invalid image version ${JSON.stringify(version)} cannot reach the database`,()=>fixture({version},beforeStop));
}
for(const digests of ['',`other/repository@sha256:${digest}`,`${repository}@sha256:too-short`,`${repository}@sha256:${'z'.repeat(64)}`]){
  test(`missing or invalid matching digest is rejected: ${digests.slice(0,65)}`,()=>fixture({digests},beforeStop));
}
test('an explicit version pulls that release and verifies its metadata',()=>fixture({args:['0.2.0']},(r,calls)=>{
  assert.equal(r.status,0,r.stderr);assert.equal(calls[0],'pull '+repository+':0.2.0');
}));
test('mislabeled version tag cannot run migrations',()=>fixture({args:['0.3.0']},beforeStop));
test('invalid release arguments cannot reach Docker',()=>fixture({args:['stable;echo bad']},(r,calls,env)=>{
  beforeStop(r,calls,env);assert.deepEqual(calls,[]);
}));
test('a concurrent upgrade is rejected before Docker or backup',()=>fixture({locked:true},(r,calls,env)=>{
  beforeStop(r,calls,env);assert.deepEqual(calls,[]);assert.match(r.stderr,/already running/);
}));
test('explicit source fallback builds before backup and pins its local image ID',()=>fixture({args:['--build']},(r,calls,env,details)=>{
  assert.equal(r.status,0,r.stderr);assert.match(calls[0],/^build --target runtime --build-arg APP_VERSION=0.2.0 /);
  assert.ok(!calls.some(x=>x.startsWith('pull ')));assert.ok(env.includes(`CARDSHELF_IMAGE=${imageId}`));
  assert.ok(details.pins.every(x=>x===imageId));
}));
test('a failed fallback build leaves the site running',()=>fixture({args:['--build'],failure:'build'},beforeStop));

test('deployment contract ignores app versions and rejects a missing host file',()=>{
  const dir=mkdtempSync(join(tmpdir(),'cardshelf-contract-'));
  try {
    for(const file of contractFiles){mkdirSync(dirname(join(dir,file)),{recursive:true});copyFileSync(join(root,file),join(dir,file));}
    const invoke=()=>spawnSync('sh',['scripts/deployment-contract.sh'],{cwd:dir,encoding:'utf8'});
    const before=invoke();assert.equal(before.status,0,before.stderr);assert.match(before.stdout,/^[a-f0-9]{64}\n$/);
    writeFileSync(join(dir,'package.json'),'{"version":"99.0.0"}');writeFileSync(join(dir,'.env'),'PRIVATE=value');
    assert.equal(invoke().stdout,before.stdout);
    writeFileSync(join(dir,'compose.yaml'),'changed host configuration');assert.notEqual(invoke().stdout,before.stdout);
    rmSync(join(dir,'Caddyfile'));assert.notEqual(invoke().status,0);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
