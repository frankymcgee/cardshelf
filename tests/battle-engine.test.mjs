import test from 'node:test';
import assert from 'node:assert/strict';
import { newBattle,applyBattleAction,battleView,shuffle } from '../lib/battle/engine.mjs';
import { syntheticDeck,allCards,identityRng } from './helpers/battle-fixtures.mjs';
const fresh=()=>newBattle('pokemon',{host:syntheticDeck('host-private'),guest:syntheticDeck('guest-private')},identityRng);
const act=(s,seat,a)=>applyBattleAction(s,seat,a,identityRng);
function playing() {
  let s=fresh();s=act(s,'guest',{type:'choose_first',first:'host'});
  for(const seat of ['host','guest']){s=act(s,seat,{type:'move',token:s.players[seat].hand[0].token,to:'active'});s=act(s,seat,{type:'setup_ready'});}
  return s;
}
function inventory(s) { return Object.fromEntries(['host','guest'].map(seat=>[seat,allCards(s.players[seat]).map(c=>c.card.id).sort()])); }
function conserved(before,after){assert.deepEqual(inventory(after),inventory(before));for(const seat of ['host','guest'])assert.equal(new Set(allCards(after.players[seat]).map(c=>c.token)).size,60);}
const rejects=(fn,status)=>assert.throws(fn,e=>e.status===status);
test('new table conserves both 60-card snapshots and seven-card private hands',()=>{
  const s=fresh();for(const seat of ['host','guest']){assert.equal(allCards(s.players[seat]).length,60);assert.equal(s.players[seat].hand.length,7);assert.equal(s.players[seat].deck.length,53);assert.equal(s.players[seat].prizes.length,0);}assert.equal(s.phase,'setup');assert.equal(s.coin_winner,'guest');
});
test('shuffle uses bounded integer choices and preserves elements without changing input',()=>{
  const input=[1,2,3,4],calls=[];assert.deepEqual(shuffle(input,n=>{calls.push(n);return 0;}),[2,3,4,1]);assert.deepEqual(input,[1,2,3,4]);assert.deepEqual(calls,[4,3,2]);assert.deepEqual(shuffle([]),[]);
});
for(const bad of [-1,1.2,Infinity,99,'1'])test('invalid injected RNG cannot bias index through '+bad,()=>rejects(()=>shuffle([1,2],()=>bad),400));
for(const seat of ['admin','spectator','__proto__','constructor','',null])test('non-player seat rejected '+seat,()=>{rejects(()=>battleView(fresh(),seat),403);rejects(()=>act(fresh(),seat,{type:'coin'}),403);});
test('opponent projection has counts only for hands, prizes and draw order',()=>{
  const s=fresh(),v=battleView(s,'guest'),encoded=JSON.stringify(v);
  assert.deepEqual(v.players.host.hand,[]);assert.equal(v.players.host.hand_count,7);assert.equal('deck' in v.players.host,false);assert.equal('prizes' in v.players.host,false);
  for(const c of [...s.players.host.hand,...s.players.host.deck])assert.ok(!encoded.includes(c.token));
  assert.ok(!encoded.includes('host-private'));assert.ok(encoded.includes('guest-private'));
});
test('view is a copy; browser-side edits cannot mutate the authoritative state',()=>{
  const s=fresh(),v=battleView(s,'host');v.players.host.hand[0].card.name='Injected';assert.notEqual(s.players.host.hand[0].card.name,'Injected');
});
test('successful and rejected actions do not mutate their input state',()=>{
  const s=fresh(),old=structuredClone(s),next=act(s,'guest',{type:'choose_first',first:'host'});assert.deepEqual(s,old);assert.equal(next.first_chosen,true);
  rejects(()=>act(s,'host',{type:'choose_first',first:'host'}),409);assert.deepEqual(s,old);
});
test('only coin winner chooses starter, exactly once',()=>{
  let s=fresh();rejects(()=>act(s,'host',{type:'choose_first',first:'host'}),409);s=act(s,'guest',{type:'choose_first',first:'guest'});assert.equal(s.turn,'guest');rejects(()=>act(s,'guest',{type:'choose_first',first:'host'}),409);
});
test('opening field stays redacted until both players lock it',()=>{
  let s=fresh();s=act(s,'guest',{type:'choose_first',first:'host'});s=act(s,'host',{type:'move',token:s.players.host.hand[0].token,to:'active'});s=act(s,'host',{type:'setup_ready'});
  assert.deepEqual(battleView(s,'guest').players.host.active,[{hidden:true}]);assert.ok(battleView(s,'host').players.host.active[0].card);
  s=act(s,'guest',{type:'move',token:s.players.guest.hand[0].token,to:'active'});s=act(s,'guest',{type:'setup_ready'});
  assert.equal(s.phase,'playing');assert.equal(s.players.host.prizes.length,6);assert.equal(s.players.guest.prizes.length,6);assert.ok(battleView(s,'guest').players.host.active[0].card);
});
test('setup cannot be completed without an active Basic and first-player decision',()=>{
  let s=fresh();rejects(()=>act(s,'host',{type:'setup_ready'}),409);
  rejects(()=>act(s,'host',{type:'move',token:s.players.host.hand[4].token,to:'active'}),409);
  s=act(s,'host',{type:'move',token:s.players.host.hand[0].token,to:'active'});rejects(()=>act(s,'host',{type:'setup_ready'}),409);
});
test('unconfirmed setup reset returns selected field cards to hand without revealing them',()=>{
  let s=fresh();const initial=structuredClone(s);s=act(s,'host',{type:'move',token:s.players.host.hand[0].token,to:'active'});s=act(s,'host',{type:'move',token:s.players.host.hand[0].token,to:'bench'});s=act(s,'host',{type:'reset_setup'});assert.equal(s.players.host.hand.length,7);assert.equal(s.players.host.active.length,0);conserved(initial,s);assert.ok(!JSON.stringify(battleView(s,'guest')).includes('host-private'));
});
test('a legitimate mulligan reveals only the old hand, never the replacement',()=>{
  let s=fresh();[s.players.host.hand[0],s.players.host.deck[10]]=[s.players.host.deck[10],s.players.host.hand[0]];
  for(let i=1;i<4;i++)[s.players.host.hand[i],s.players.host.deck[10+i]]=[s.players.host.deck[10+i],s.players.host.hand[i]];
  const original=structuredClone(s),old=s.players.host.hand.map(c=>c.card.name);s=act(s,'host',{type:'mulligan'});conserved(original,s);assert.equal(s.players.host.mulligans,1);assert.deepEqual(s.log.at(-1).cards.map(c=>c.name),old);
  const v=JSON.stringify(battleView(s,'guest'));for(const c of s.players.host.hand)assert.ok(!v.includes(c.token));
});
test('mulligan is rejected when a Basic is present',()=>rejects(()=>act(fresh(),'host',{type:'mulligan'}),409));
for(const type of ['draw','take_prize','search','evolve','counters','end_turn'])test('opening setup rejects playing action '+type,()=>rejects(()=>act(fresh(),'host',{type}),409));
test('draw does not reveal drawn card identity to the opponent',()=>{
  const s=playing(),hidden=s.players.host.deck[0],n=act(s,'host',{type:'draw',count:1});conserved(s,n);assert.equal(n.players.host.hand.length,s.players.host.hand.length+1);assert.equal(n.players.host.deck.length,s.players.host.deck.length-1);
  const v=JSON.stringify(battleView(n,'guest'));assert.ok(!v.includes(hidden.token));assert.ok(!v.includes(n.players.host.hand.at(-1).token));assert.match(n.log.at(-1).text,/Drew 1/);
});
for(const count of [0,-1,11,'1',1.5,null,Infinity])test('draw count rejected '+count,()=>rejects(()=>act(playing(),'host',{type:'draw',count}),400));
test('insufficient deck is an explicit conflict, not a fabricated zero card or automatic win',()=>{
  let s=playing();s.players.host.hand.push(...s.players.host.deck);s.players.host.deck=[];rejects(()=>act(s,'host',{type:'draw',count:1}),409);assert.equal(s.phase,'playing');
});
test('prize pickup uses only a position and remains private even to other player after pickup',()=>{
  const s=playing(),n=act(s,'host',{type:'take_prize',index:2});conserved(s,n);assert.equal(n.players.host.prizes.length,5);const v=JSON.stringify(battleView(n,'guest'));assert.ok(!v.includes(n.players.host.hand.at(-1).token));assert.equal('prizes' in battleView(n,'host').players.host,false);
});
for(const index of [-1,6,'1',0.5])test('invalid prize slot '+index,()=>rejects(()=>act(playing(),'host',{type:'take_prize',index}),400));
test('hidden deck and prize tokens cannot be used directly in move actions',()=>{
  const s=playing();for(const zone of ['deck','prizes'])rejects(()=>act(s,'host',{type:'move',token:s.players.host[zone][0].token,to:'hand'}),403);
});
test('own deck search is logged, sorted, private and must be closed before drawing',()=>{
  let s=playing();s=act(s,'host',{type:'search'});assert.equal(battleView(s,'host').players.host.search.length,s.players.host.deck.length);assert.deepEqual(battleView(s,'guest').players.host.search,[]);assert.equal(battleView(s,'guest').players.host.searching,true);
  rejects(()=>act(s,'host',{type:'draw',count:1}),409);rejects(()=>act(s,'host',{type:'end_turn'}),409);
  const oldTokens=s.players.host.deck.map(c=>c.token);s=act(s,'host',{type:'end_search'});assert.equal(s.players.host.searching,false);assert.ok(s.players.host.deck.every(c=>!oldTokens.includes(c.token)));
});
test('searching a card into hand conserves counts and exposes no hidden identifiers',()=>{
  const s=act(playing(),'host',{type:'search'}),n=act(s,'host',{type:'move',token:s.players.host.deck[0].token,to:'hand'});conserved(s,n);const v=JSON.stringify(battleView(n,'guest'));assert.ok(!v.includes(n.players.host.hand.at(-1).token));
});
test('moving back to deck rekeys identity and never supplies the new deck token',()=>{
  const s=playing(),token=s.players.host.hand[0].token,n=act(s,'host',{type:'move',token,to:'deck'});conserved(s,n);assert.notEqual(n.players.host.deck[0].token,token);assert.ok(!JSON.stringify(battleView(n,'host')).includes(n.players.host.deck[0].token));
});
test('cannot move opponent cards or arbitrary tokens',()=>{
  const s=playing();rejects(()=>act(s,'host',{type:'move',token:s.players.guest.active[0].token,to:'discard'}),409);rejects(()=>act(s,'host',{type:'move',token:'guessed',to:'hand'}),409);
});
test('attaching, evolving, moving a stack and switching active conserve every card',()=>{
  let s=playing();const before=structuredClone(s),root=s.players.host.active[0].token;
  s=act(s,'host',{type:'move',token:s.players.host.hand[0].token,to:'bench'});
  s=act(s,'host',{type:'move',token:s.players.host.hand[0].token,to:'attach',target:root});
  assert.equal(s.players.host.active[0].attachments.length,1);
  s=act(s,'host',{type:'evolve',token:s.players.host.hand.find(c=>c.card.stage==='Stage1').token,target:root});assert.equal(s.players.host.active[0].attachments.length,2);
  s=act(s,'host',{type:'swap',token:s.players.host.bench[0].token});assert.equal(s.players.host.bench[0].attachments.length,2);
  s=act(s,'host',{type:'move',token:s.players.host.bench[0].token,to:'discard'});assert.equal(s.players.host.discard.length,3);conserved(before,s);
});
test('moving an attachment does not discard its parent or other cards',()=>{
  let s=playing();s=act(s,'host',{type:'move',token:s.players.host.hand[0].token,to:'attach',target:s.players.host.active[0].token});const before=structuredClone(s);
  s=act(s,'host',{type:'move',token:s.players.host.active[0].attachments[0].token,to:'discard'});assert.equal(s.players.host.active.length,1);assert.equal(s.players.host.active[0].attachments.length,0);assert.equal(s.players.host.discard.length,1);conserved(before,s);
});
test('cannot attach a complete stack, overwrite an active card or self-attach',()=>{
  let s=playing();rejects(()=>act(s,'host',{type:'move',token:s.players.host.hand[0].token,to:'active'}),409);rejects(()=>act(s,'host',{type:'move',token:s.players.host.active[0].token,to:'attach',target:s.players.host.active[0].token}),400);
});
test('damage and conditions are public, logged and never apply automatic knockouts',()=>{
  const s=playing(),n=act(s,'host',{type:'counters',target_seat:'guest',token:s.players.guest.active[0].token,damage:200,conditions:['poisoned']});assert.equal(n.players.guest.active[0].damage,200);assert.deepEqual(n.players.guest.active[0].conditions,['poisoned']);assert.equal(n.phase,'playing');assert.equal(battleView(n,'host').players.guest.active[0].damage,200);conserved(s,n);
});
for(const patch of [{damage:15},{damage:-10},{damage:'10'},{conditions:['admin']},{conditions:['asleep','asleep']},{conditions:'poisoned'},{target_seat:'spectator'}])test('counter validation '+JSON.stringify(patch),()=>{
  const s=playing();assert.throws(()=>act(s,'host',{type:'counters',target_seat:'host',token:s.players.host.active[0].token,damage:10,conditions:[],...patch}));
});
test('cannot change hidden-hand counters',()=>{const s=playing();rejects(()=>act(s,'host',{type:'counters',target_seat:'guest',token:s.players.guest.hand[0].token,damage:10,conditions:[]}),400);});
test('manual reveal is deliberate and reveals one card rather than the entire hand',()=>{
  const s=playing(),n=act(s,'host',{type:'reveal',token:s.players.host.hand[0].token});assert.equal(n.log.at(-1).cards.length,1);assert.deepEqual(battleView(n,'guest').players.host.hand,[]);
});
test('only indicated player can end turn; no implicit draw occurs',()=>{
  const s=playing();rejects(()=>act(s,'guest',{type:'end_turn'}),409);const n=act(s,'host',{type:'end_turn'});assert.equal(n.turn,'guest');assert.equal(n.turn_number,2);assert.equal(n.players.guest.hand.length,s.players.guest.hand.length);conserved(s,n);
});
test('coin and die outcomes come from the server RNG, not request data',()=>{
  const s=playing();assert.match(applyBattleAction(s,'host',{type:'coin'},()=>0).log.at(-1).text,/heads/);assert.match(applyBattleAction(s,'host',{type:'die'},()=>5).log.at(-1).text,/6/);rejects(()=>act(s,'host',{type:'coin',result:'heads'}),400);
});
test('reported wins and draws require the other player to accept',()=>{
  let s=playing();s=act(s,'host',{type:'offer_result',result:'host'});assert.equal(s.phase,'playing');rejects(()=>act(s,'host',{type:'accept_result'}),409);s=act(s,'guest',{type:'accept_result'});assert.equal(s.phase,'finished');assert.equal(s.result,'host');assert.deepEqual(battleView(s,'guest').players.host.hand,[]);
});
test('result proposal can be declined without ending the match',()=>{let s=act(playing(),'host',{type:'offer_result',result:'draw'});s=act(s,'guest',{type:'decline_result'});assert.equal(s.phase,'playing');assert.equal(s.result_offer,null);});
test('concession ends play but does not reveal hidden cards',()=>{const s=act(playing(),'host',{type:'concede'});assert.equal(s.result,'guest');assert.equal(s.phase,'finished');assert.deepEqual(battleView(s,'guest').players.host.hand,[]);rejects(()=>act(s,'guest',{type:'draw',count:1}),409);});
test('action bound leaves a concession path and log history stays bounded',()=>{let s=playing();s.actions=2000;rejects(()=>act(s,'host',{type:'coin'}),409);s=act(s,'host',{type:'concede'});assert.equal(s.phase,'finished');let t=playing();for(let i=0;i<160;i++)t=act(t,'host',{type:'coin'});assert.equal(t.log.length,150);});
for(const action of [{},{type:'unknown'},{type:'constructor'},{type:'__proto__'},{type:'draw',count:1,seat:'guest'},{type:'move',token:'x',to:'__proto__'},{type:'coin',state:{}},{type:'concede',winner:'host'},{type:'shuffle',seed:0}])test('forged action rejected '+JSON.stringify(action),()=>assert.throws(()=>act(playing(),'host',action)));
test('mixed replay-like sequences conserve cards and all concealed zones stay redacted',()=>{
  let s=playing(),baseline=inventory(s);
  for(let i=0;i<80;i++){
    const who=i%2?'host':'guest',p=s.players[who];
    if(p.deck.length&&i%3===0)s=act(s,who,{type:'draw',count:1});
    else if(p.hand.length)s=act(s,who,{type:'move',token:p.hand[0].token,to:i%2?'discard':'deck'});
    else s=act(s,who,{type:'shuffle'});
    assert.deepEqual(inventory(s),baseline);
    for(const reader of ['host','guest']){const hidden=reader==='host'?'guest':'host',view=JSON.stringify(battleView(s,reader));for(const c of [...s.players[hidden].deck,...s.players[hidden].hand,...s.players[hidden].prizes])assert.ok(!view.includes(c.token));}
  }
});

test('multiple log entries from one transition have unique increasing event IDs',()=>{
  const s=playing(), numbers=s.log.map(e=>e.n);assert.equal(new Set(numbers).size,numbers.length);assert.deepEqual(numbers,[...numbers].sort((a,b)=>a-b));
});
test('unimplemented games and future table versions cannot execute Pokémon transitions',()=>{
  for(const game of ['mtg','yugioh','__proto__'])assert.throws(()=>newBattle(game,{host:syntheticDeck(),guest:syntheticDeck()}));
  const s=playing();s.adapter_version=999;assert.throws(()=>battleView(s,'host'));assert.throws(()=>act(s,'host',{type:'coin'}));
});

test('a concession before setup finishes does not reveal the opponent face-down opening field',()=>{
  let s=fresh();s=act(s,'host',{type:'move',token:s.players.host.hand[0].token,to:'active'});s=act(s,'guest',{type:'concede'});
  assert.deepEqual(battleView(s,'guest').players.host.active,[{hidden:true}]);assert.equal(battleView(s,'host').players.host.active.length,1);
});

test('shared reveal history stores bounded identity details instead of duplicating full card effects',()=>{
  const initial=playing(),s=act(initial,'host',{type:'reveal',token:initial.players.host.hand[0].token});
  assert.deepEqual(Object.keys(s.log.at(-1).cards[0]).sort(),['id','name','number','set_name']);
});
