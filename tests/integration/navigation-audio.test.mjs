// Production-build static-asset contract. No external audio/provider request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ARENA_AUDIO,ARENA_TRACKS} from '../../shared/arena-audio.mjs';
const base=process.env.TEST_BASE_URL,url=process.env.DATABASE_URL;
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!base||!new URL(url||'http://invalid').pathname.endsWith('_test'))throw Error('Use the disposable CI environment.');
for(const path of [...Object.values(ARENA_AUDIO),...ARENA_TRACKS.map(t=>t.url)])test('production build serves local arena media '+path,async()=>{
  const r=await fetch(base+path,{redirect:'manual'});
  assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^audio\//);
  const expected=await readFile(new URL('../../public'+path,import.meta.url)),bytes=Buffer.from(await r.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'),createHash('sha256').update(expected).digest('hex'));
});
test('audio source/licence notes and integrity manifest are included in the deployed public files',async()=>{
  const [credits,manifest]=await Promise.all([fetch(base+'/audio/arena/CREDITS.txt'),fetch(base+'/audio/arena/manifest.json')]);
  assert.equal(credits.status,200);assert.equal(manifest.status,200);
  const text=await credits.text();assert.match(text,/Kenney/);assert.match(text,/CC0/);assert.match(text,/ORIGINAL SYNTHESIZED AUDIO/);
  const body=await manifest.json();assert.equal(body.files.length,Object.keys(ARENA_AUDIO).length+ARENA_TRACKS.length);
});
