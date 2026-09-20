import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(failure,run) {
  const dir=mkdtempSync(join(tmpdir(),'cardshelf-upgrade-'));
  mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'bin'));
  copyFileSync(join(root,'scripts/upgrade.sh'),join(dir,'scripts/upgrade.sh'));
  copyFileSync(join(root,'scripts/compose.sh'),join(dir,'scripts/compose.sh'));
  writeFileSync(join(dir,'package.json'),'{"name":"cardshelf","version":"0.2.0"}\n');
  writeFileSync(join(dir,'.env'),'APP_VERSION=0.1.1\nPOSTGRES_PASSWORD=fixture-secret\nAPP_ORIGIN=https://tcg.example.test\n',{mode:0o600});
  writeFileSync(join(dir,'bin/docker'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n[ "$*" != "$FAILURE" ] || exit 42\n',{mode:0o755});
  writeFileSync(join(dir,'scripts/backup.sh'),'#!/bin/sh\necho backup >> "$CALLS"\n[ "$FAILURE" != "backup" ] || exit 42\n');
  try {
    const calls=join(dir,'calls');
    const result=spawnSync('sh',['scripts/upgrade.sh'],{cwd:dir,encoding:'utf8',timeout:5000,
      env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,CALLS:calls,FAILURE:failure}});
    run(result,readFileSync(calls,'utf8').trim().split('\n'),readFileSync(join(dir,'.env'),'utf8'),statSync(join(dir,'.env')).mode&0o777);
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('upgrade builds, backs up and migrates before restarting; preserves secrets',()=>fixture('',(r,calls,env,mode)=>{
  assert.equal(r.status,0,r.stderr);assert.deepEqual(calls,['compose build','backup','compose stop app worker','compose run --rm migrate','compose up -d --no-deps --wait --wait-timeout 180 app worker','compose ps -a']);
  assert.match(env,/APP_VERSION=0.2.0/);assert.match(env,/POSTGRES_PASSWORD=fixture-secret/);assert.match(env,/APP_ORIGIN=https:\/\/tcg.example.test/);assert.equal(mode,0o600);
}));
test('a failed build does not stop services or modify configuration',()=>fixture('compose build',(r,calls,env)=>{assert.notEqual(r.status,0);assert.deepEqual(calls,['compose build']);assert.match(env,/APP_VERSION=0.1.1/);}));
test('a failed automatic backup does not stop the running site',()=>fixture('backup',(r,calls,env)=>{assert.notEqual(r.status,0);assert.deepEqual(calls,['compose build','backup']);assert.match(env,/APP_VERSION=0.1.1/);}));
test('a failed migration leaves services stopped for investigation',()=>fixture('compose run --rm migrate',(r,calls,env)=>{assert.notEqual(r.status,0);assert.deepEqual(calls,['compose build','backup','compose stop app worker','compose run --rm migrate']);assert.match(env,/APP_VERSION=0.1.1/);}));
