import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture({legacy=true,failProxy=false}={}) {
  const directory=mkdtempSync(join(tmpdir(),'cardshelf-retire-')),bin=join(directory,'bin');
  mkdirSync(bin);mkdirSync(join(directory,'scripts'));mkdirSync(join(directory,'deploy/postal/config'),{recursive:true});
  for(const script of ['compose.sh','retire-postal.sh'])copyFileSync(new URL('../scripts/'+script,import.meta.url),join(directory,'scripts',script));
  writeFileSync(join(directory,'.env'),'APP_DOMAIN=cardshelf.example\nPOSTAL_ORIGIN=https://old-mail.example\nSMTP_PASSWORD=keep-this-private\nCARDSHELF_INTEGRATION_KEY=keep-this-too\n');
  if(legacy)writeFileSync(join(directory,'deploy/postal/.enabled'),'legacy');
  writeFileSync(join(directory,'deploy/postal/config/smtp.key'),'private-retired-key');
  writeFileSync(join(directory,'crontab'),'15 * * * * /bin/sh '+directory+'/deploy/postal/sync-certificates.sh\n0 3 * * * /bin/sh '+directory+'/deploy/postal/backup.sh\n0 4 * * * /bin/sh /another-project/backup.sh\n');
  const log=join(directory,'commands.jsonl');
  writeFileSync(join(bin,'docker'),`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='inspect')console.log('custom-cardshelf');
else if(args[0]==='compose'&&args.includes('ps'))console.log('app-database-id');
else if(args[0]==='compose'&&args.includes('up')&&process.env.FAIL_PROXY==='true')process.exit(1);
else if(args[0]==='ps'){const label=args.find(a=>a.startsWith('label=com.docker.compose.service='));console.log(label.split('=').at(-1)+'-id');}
else if(args[1]==='ls'&&['volume','network'].includes(args[0])){const label=args.find(a=>a.startsWith('label=com.docker.compose.'+args[0]+'='));console.log(label.split('=').at(-1)+'-id');}
`,{mode:0o755});
  writeFileSync(join(bin,'crontab'),`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);if(args[0]==='-l')process.stdout.write(fs.readFileSync(process.env.MOCK_CRON));else fs.copyFileSync(args[0],process.env.MOCK_CRON);
`,{mode:0o755});
  const env={...process.env,PATH:bin+':'+process.env.PATH,MOCK_LOG:log,MOCK_CRON:join(directory,'crontab'),FAIL_PROXY:String(failProxy)};
  return {directory,run:(...args)=>spawnSync('sh',['scripts/retire-postal.sh',...args],{cwd:directory,env,encoding:'utf8'}),
    commands:()=>readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line)),cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
test('retirement restores HTTPS, targets this project only and preserves mail data by default',()=>{
  const f=fixture();try {
    const result=f.run();assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout,/keep-this|private-retired/);
    const commands=f.commands(),serialized=JSON.stringify(commands);
    assert.ok(commands.some(args=>args.includes('--force-recreate')&&args.includes('caddy')));
    assert.ok(commands.some(args=>args.includes('validate')&&args.includes('/etc/caddy/Caddyfile')));
    for(const args of commands.filter(args=>args.includes('ls')||args[0]==='ps'))assert.ok(args.includes('label=com.docker.compose.project=custom-cardshelf'));
    assert.equal(commands.filter(args=>args[0]==='stop').length,4);assert.equal(commands.filter(args=>args[0]==='network'&&args[1]==='rm').length,3);
    assert.doesNotMatch(serialized,/prune|down|--volumes|postal\/compose|postal\/\.env/);
    assert.ok(!commands.some(args=>args[0]==='volume'&&args[1]==='rm'));
    assert.ok(existsSync(join(f.directory,'deploy/postal/config/smtp.key')));assert.ok(!existsSync(join(f.directory,'deploy/postal/.enabled')));
    const env=readFileSync(join(f.directory,'.env'),'utf8');assert.match(env,/SMTP_PASSWORD=keep-this-private/);assert.match(env,/CARDSHELF_INTEGRATION_KEY=keep-this-too/);assert.match(env,/COMPOSE_FILE=compose.yaml:compose.https.yaml/);assert.doesNotMatch(env,/POSTAL_ORIGIN/);
    assert.equal(readFileSync(join(f.directory,'crontab'),'utf8'),'0 4 * * * /bin/sh /another-project/backup.sh\n');assert.equal(readdirSync(join(f.directory,'backups')).length,1);
  } finally {f.cleanup();}
});
test('explicit purge removes only the labelled retired volume and its private files and can run twice',()=>{
  const f=fixture({legacy:false});try {
    for(let attempt=0;attempt<2;attempt++){const result=f.run('--purge-data');assert.equal(result.status,0,result.stderr);}
    assert.ok(!existsSync(join(f.directory,'deploy/postal')));
    assert.deepEqual(f.commands().filter(args=>args[0]==='volume'&&args[1]==='rm'),[['volume','rm','postal_database-id'],['volume','rm','postal_database-id']]);
    assert.ok(!f.commands().some(args=>args.includes('caddy')));
  } finally {f.cleanup();}
});
test('proxy failure retains the old marker, environment, data and all containers',()=>{
  const f=fixture({failProxy:true});try {
    const result=f.run('--purge-data');assert.notEqual(result.status,0);
    assert.ok(existsSync(join(f.directory,'deploy/postal/.enabled')));assert.ok(existsSync(join(f.directory,'deploy/postal/config/smtp.key')));
    assert.match(readFileSync(join(f.directory,'.env'),'utf8'),/POSTAL_ORIGIN/);
    assert.ok(!f.commands().some(args=>['stop','rm','volume','network'].includes(args[0])));
  } finally {f.cleanup();}
});
