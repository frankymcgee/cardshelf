import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {ARENA_AUDIO,ARENA_EFFECT_CHOICES,ARENA_TRACKS,audioPreferences,arenaEventCue,createArenaAudio} from '../shared/arena-audio.mjs';
function mock(){const all=[],errors=[];class Audio{constructor(){this.paused=true;this.playCount=0;this.pauseCount=0;all.push(this);}play(){this.paused=false;this.playCount++;return Promise.resolve();}pause(){this.paused=true;this.pauseCount++;}load(){}removeAttribute(k){if(k==='src')this.src='';}}return {all,errors,Audio,controller:createArenaAudio({Audio},s=>errors.push(s))};}
test('audio is off by default and settings only accept supported values',()=>{assert.deepEqual(audioPreferences(),{effects:false,music:false,track:'quiet',effectsVolume:.45,musicVolume:.25});assert.deepEqual(audioPreferences({effects:'true',music:1,track:'https://evil.test',effectsVolume:Infinity,musicVolume:-1}),{effects:false,music:false,track:'quiet',effectsVolume:.45,musicVolume:0});});
test('remembered preferences cannot autoplay until an explicit activation',()=>{const h=mock();h.controller.configure({effects:true,music:true});assert.equal(h.all.length,0);assert.equal(h.controller.cue('attack'),false);h.controller.activate();assert.equal(h.all.length,1);assert.equal(h.all[0].playCount,1);});
test('effects-only operation never downloads music',()=>{const h=mock();h.controller.configure({effects:true});h.controller.activate();h.controller.cue('select');assert.equal(h.all.length,1);assert.match(h.all[0].src,/kenney-click.wav$/);assert.equal(h.all[0].loop,undefined);});
test('missing/unknown effect identifiers are ignored',()=>{const h=mock();h.controller.configure({effects:true});h.controller.activate();assert.equal(h.controller.cue('__proto__'),false);assert.equal(h.all.length,0);});
test('short effect polyphony is bounded and completion releases an instance',()=>{const h=mock();h.controller.configure({effects:true});h.controller.activate();for(let i=0;i<4;i++)h.controller.cue('attack');assert.equal(h.all.length,3);h.all[0].onended();assert.equal(h.controller.cue('select'),true);});
test('music volume changes do not restart the loop',()=>{const h=mock();h.controller.configure({music:true});h.controller.activate();h.controller.configure({music:true,musicVolume:.1});assert.equal(h.all.length,1);assert.equal(h.all[0].playCount,1);assert.equal(h.all[0].volume,.1);});
test('changing tracks stops and releases the previous source',()=>{const h=mock();h.controller.configure({music:true});h.controller.activate();const first=h.all[0];h.controller.configure({music:true,track:'pulse'});assert.equal(first.src,'');assert.ok(first.pauseCount);assert.equal(h.all.length,2);assert.match(h.all[1].src,/pulse-table.mp3$/);});
for(const action of ['setVisible','setAvailable'])test(action+' pauses music and effects and can safely resume',()=>{const h=mock();h.controller.configure({effects:true,music:true});h.controller.activate();h.controller.cue('select');h.controller[action](false);assert.ok(h.all.every(m=>m.paused));assert.equal(h.controller.cue('select'),false);h.controller[action](true);assert.match(h.all.at(-1).src,/quiet-table/);});
test('mute never auto-resumes when visibility returns',()=>{const h=mock();h.controller.configure({music:true});h.controller.activate();h.controller.stop();h.controller.setVisible(false);h.controller.setVisible(true);assert.equal(h.all.length,1);assert.ok(h.all[0].paused);});
test('disposal closes all media and prevents late reuse',()=>{const h=mock();h.controller.configure({music:true,effects:true});h.controller.activate();h.controller.cue('attack');h.controller.dispose();h.controller.activate();h.controller.configure({music:true});assert.equal(h.all.length,2);assert.ok(h.all.every(m=>m.src===''));});
test('rejected playback is handled without rejecting game actions',async()=>{const h=mock();h.Audio.prototype.play=function(){return Promise.reject(Error('blocked'));};h.controller.configure({music:true,effects:true});h.controller.activate();h.controller.cue('attack');await Promise.resolve();assert.equal(h.errors.length,1);h.controller.dispose();});
test('audio does not replay initial or duplicated match history',()=>{assert.equal(arenaEventCue([{n:1,kind:'attack'}],-1),null);assert.equal(arenaEventCue([{n:1,kind:'attack'}],1),null);});
for(const [kind,cue] of [['attack','attack'],['knockout','knockout'],['coin','coin'],['turn','turn'],
 ['draw','draw'],['attach','energy'],['energy','energy'],['bench','bench'],['evolve','evolve'],
 ['trainer','trainer'],['switch','switch'],['retreat','switch'],['promote','switch'],['prize','prize'],
 ['ability','ability'],['stadium','ability'],['heal','heal'],['condition','damage'],['recoil','damage'],
 ['confusion','damage'],['effect_damage','damage'],['attack_miss','miss'],['shuffle','shuffle'],['mulligan','shuffle']])
 test('public '+kind+' event maps to '+cue,()=>assert.equal(arenaEventCue([{n:2,kind}],1),cue));
test('resolved Trainer effects and major battle events win over routine movement',()=>{
 for(const kind of ['draw','heal','switch','shuffle'])assert.equal(arenaEventCue([{n:2,kind:'trainer'},{n:3,kind}],1),kind);
 assert.equal(arenaEventCue([{n:2,kind:'attack'},{n:3,kind:'knockout'},{n:4,kind:'prize'},{n:5,kind:'turn'}],1),'knockout');
 assert.equal(arenaEventCue([{n:2,kind:'coin'},{n:3,kind:'attack_miss'},{n:4,kind:'turn'}],1),'miss');
});
test('unknown results, malformed events, gaps and reordered history are silent',()=>{
 assert.equal(arenaEventCue([null,{n:2,kind:'__proto__'}],1),null);
 assert.equal(arenaEventCue([{n:2,kind:'result'}],1,null,0),null);
 assert.equal(arenaEventCue([{n:2,kind:'result'}],1,0,-1),null);
 assert.equal(arenaEventCue([{n:3,kind:'energy'}],1),null);
 assert.equal(arenaEventCue([{n:3,kind:'energy'},{n:2,kind:'draw'}],1),null);
 assert.equal(arenaEventCue([{n:2,kind:'energy'},{n:2,kind:'draw'}],1),null);
});
test('event audio reads only disclosed sequence and kind, never private event details',()=>{
 const event={n:2,kind:'energy'};for(const key of ['card','target','hand','message'])Object.defineProperty(event,key,{get(){throw Error('Private details accessed');}});
 assert.equal(arenaEventCue([event],1),'energy');
});
test('every preview names a supported local cue exactly once',()=>{
 assert.deepEqual(ARENA_EFFECT_CHOICES.map(c=>c.id).sort(),Object.keys(ARENA_AUDIO).sort());
 assert.equal(new Set(ARENA_EFFECT_CHOICES.map(c=>c.id)).size,ARENA_EFFECT_CHOICES.length);
});
test('result sound is relative to the seated player and has priority',()=>{assert.equal(arenaEventCue([{n:2,kind:'attack'},{n:3,kind:'result'}],1,0,0),'victory');assert.equal(arenaEventCue([{n:3,kind:'result'}],2,1,0),'defeat');assert.equal(arenaEventCue([{n:3,kind:'result'}],2,'draw',0),'turn');});
test('long reconnect backlogs are silent',()=>assert.equal(arenaEventCue(Array.from({length:13},(_,i)=>({n:i+1,kind:'attack'})),0),null));
test('bundled media is local, nonempty and includes explicit source and integrity records',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../public/audio/arena/manifest.json',import.meta.url)));
 for(const url of [...Object.values(ARENA_AUDIO),...ARENA_TRACKS.map(t=>t.url)]){assert.ok(url.startsWith('/audio/arena/'));const data=readFileSync(new URL('../public'+url,import.meta.url));assert.ok(data.length>100);const file=manifest.files.find(f=>url.endsWith('/'+f.file));assert.ok(file);assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256);}
});
