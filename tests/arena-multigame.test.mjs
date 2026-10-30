import test from 'node:test';
import assert from 'node:assert/strict';
import { compileArenaCard, deckValidation } from '../lib/arena/cards.mjs';
import { sharedEffect } from '../lib/arena/cards-multigame.mjs';
import { newArena, applyArenaAction, legalArenaActions, arenaView, assertArena } from '../lib/arena/engine.mjs';
import { cpuAction } from '../lib/arena/bot.mjs';
import { chooseMatchedOpponent } from '../lib/arena/opponents.mjs';
import { parseArenaImport } from '../lib/arena/workshop.mjs';
import { arenaVersionForGame } from '../shared/arena-games.mjs';
import { arenaSpectatorView } from '../lib/arena/spectator.mjs';
import { normaliseYugiohSet, normaliseMtgSet } from '../lib/game-provider-logic.mjs';
import { ygoFixture, mtgFixture } from './helpers/game-fixtures.mjs';
import { gameRow, gameCard, gameDeck, seeded } from './helpers/arena-multigame-fixtures.mjs';

function start(game){const decks=[gameDeck(game),gameDeck(game)];let s=newArena(decks,{version:arenaVersionForGame(game),rng:seeded()});s=applyArenaAction(s,s.toss,{type:'first',seat:0});if(game==='mtg')for(const seat of [0,1])s=applyArenaAction(s,seat,{type:'keep'});return s;}
const act=(s,seat,type,match=()=>true)=>{const move=legalArenaActions(s,seat).find(m=>m.action.type===type&&match(m.action));assert.ok(move,`${type} must be available in ${s.step}`);return applyArenaAction(s,seat,move.action);};
function emptyField(s){for(const p of s.players){p.deck.push(...p.hand,...p.field);p.hand=[];p.field=[];p.discard=[];}}
function put(s,seat,kind,zone='field',changes={}){const p=s.players[seat],i=p.deck.findIndex(u=>u.card.kind===kind);assert.ok(i>=0);const [u]=p.deck.splice(i,1);Object.assign(u,{entered:0,...changes});p[zone].push(u);return u;}
function passes(s){s=act(s,s.priority,'pass');return act(s,s.priority,'pass');}

test('imports retain essential game stats and older catalogue rows explicitly require re-import',()=>{
  const y=ygoFixture();Object.assign(y.payload.data[0],{level:4,atk:1500,def:1000,race:'Dragon',attribute:'FIRE'});
  const card=normaliseYugiohSet(y.set,y.payload)[0];assert.equal(compileArenaCard(card).card.atk,1500);assert.equal(card.raw_data.arena_data.def,1000);
  delete card.raw_data.arena_data;assert.match(compileArenaCard(card).reason,/Re-import/);
  const m=mtgFixture();Object.assign(m.payload.data.cards[0],{layout:'normal',types:['Creature'],supertypes:[],manaCost:'{1}{G}',power:'2',toughness:'2'});
  assert.equal(normaliseMtgSet(m.set,m.payload)[0].raw_data.arena_data.mana_cost,'{1}{G}');
});
test('whole-effect templates reuse identical programs and preserve each printing’s costs',()=>{
  const a=gameCard('mtg','Bolt A',{arena_data:{types:['Instant'],mana_cost:'{R}'},raw_data:{public_text:'Bolt A deals 3 damage to any target.'}});
  const b=gameCard('mtg','Bolt B',{arena_data:{types:['Sorcery'],mana_cost:'{2}{R}'},raw_data:{public_text:'Bolt B deals 3 damage to any target.'}});
  assert.equal(a.program.kind,b.program.kind);assert.deepEqual(a.cost,['R']);assert.deepEqual(b.cost,['2','R']);
  assert.throws(()=>sharedEffect('mtg','instant','Bolt A deals 3 damage to any target. Draw a card.','Bolt A'));
  assert.notEqual(sharedEffect('mtg','instant','Bolt A deals 3 damage to any target.','Bolt A').template,sharedEffect('mtg','instant','Bolt A deals 4 damage to any target.','Bolt A').template);
  const changed=compileArenaCard(gameRow('yugioh','Same name',{arena_data:{type:'Effect Monster'}}));assert.equal(changed.supported,false);
});
for(const overrides of [{arena_data:{types:['Creature','Artifact']}},{arena_data:{mana_cost:'{X}{G}'}},{arena_data:{supertypes:['Legendary']}},{raw_data:{public_text:'Flying. Draw a card.'}},{arena_data:{layout:'transform'}},{arena_data:{power:'*'}},{arena_data:{power:true}},{arena_data:{power:' '}}])test('Magic rejects unimplemented mechanics '+JSON.stringify(overrides),()=>assert.equal(compileArenaCard(gameRow('mtg','Unsupported',overrides)).supported,false));
test('game decks use different size and copy limits across printings, and cannot mix games',()=>{
  for(const game of ['mtg','yugioh'])assert.equal(deckValidation(gameDeck(game)).playable,true);
  const deck=gameDeck('yugioh');deck[0].quantity=4;assert.match(deckValidation(deck).errors.join(' '),/3 copies/);
  const land=gameDeck('mtg')[0];assert.equal(deckValidation([{...land,quantity:60}]).playable,true);
  const a=gameCard('mtg','Same'),b={...a,id:'mtg:en:other-printing'};
  assert.equal(deckValidation([{card:a,quantity:3},{card:b,quantity:2},{...land,quantity:55}]).playable,false);
  assert.throws(()=>newArena([gameDeck('mtg'),gameDeck('yugioh')],{version:'mtg-casual-v1'}));
  assert.throws(()=>parseArenaImport('1 mtg:en:one','yugioh'));assert.equal(parseArenaImport('1 mtg:en:one','mtg').game,'mtg');
});
test('game-specific practice matching rejects decks from other games',()=>{
  const own={title:'Own',cards:gameDeck('yugioh')},foreign={title:'Foreign',cards:gameDeck('mtg')};
  assert.equal(chooseMatchedOpponent(own,[foreign],'yugioh-casual-v1').source,'mirror');
  assert.equal(chooseMatchedOpponent(own,[{...own,title:'Same game'}],'yugioh-casual-v1').source,'saved');
});
test('Yu-Gi-Oh starts at 8000 LP, skips the first draw and Battle Phase',()=>{
  let s=start('yugioh');assert.equal(s.players[0].life,8000);assert.equal(s.players[0].hand.length,5);assert.ok(!legalArenaActions(s,0).some(m=>m.action.type==='battle'));
  s=act(s,0,'end_turn');assert.equal(s.players[1].hand.length,6);assert.ok(legalArenaActions(s,1).some(m=>m.action.type==='battle'));assert.equal(arenaView(s,0).players[1].hand.length,0);
});
test('Yu-Gi-Oh tribute costs are chosen from actual field cards and enforce one summon',()=>{
  let s=start('yugioh');emptyField(s);const high=put(s,0,'monster','hand');high.card={...high.card,level:7};const one=put(s,0,'monster'),two=put(s,0,'monster');
  assert.ok(legalArenaActions(s,0).filter(m=>m.action.type==='summon').every(m=>m.action.tributes.split(',').length===2));
  s=act(s,0,'summon',a=>a.position==='attack');assert.equal(s.players[0].field.length,1);assert.deepEqual(s.players[0].discard.map(u=>u.id).sort(),[one.id,two.id].sort());
  assert.ok(!legalArenaActions(s,0).some(m=>m.action.type==='summon'));assertArena(s);
});
test('face-down monsters never disclose their card to opponents and flip only on a later turn',()=>{
  let s=start('yugioh');emptyField(s);put(s,0,'monster','hand');s=act(s,0,'summon',a=>a.position==='set');
  const view=arenaView(s,1),hidden=view.players[0].field[0];assert.equal(hidden.hidden,true);assert.equal(hidden.card,undefined);assert.ok(!JSON.stringify(view).includes(s.players[0].field[0].card.name));
  const spectator=arenaSpectatorView(s);assert.equal(spectator.players[0].field[0].card,undefined);assert.equal(spectator.players[0].life,8000);assert.ok(spectator.players.every(p=>p.hand.length===0));assert.deepEqual(spectator.legal,[]);
  assert.ok(!legalArenaActions(s,0).some(m=>m.action.type==='position'));
  s=act(s,0,'end_turn');s=act(s,1,'end_turn');s=act(s,0,'position');assert.equal(s.players[0].field[0].face_down,false);assert.equal(s.players[0].field[0].position,'attack');
});
test('Yu-Gi-Oh selected Normal Spells resolve only complete effects and require payable mandatory draws',()=>{
  let s=start('yugioh');emptyField(s);const spell=put(s,0,'monster','hand');spell.card=gameCard('yugioh','Draw spell',{arena_data:{type:'Spell Card',race:'Normal'},raw_data:{public_text:'Draw 2 cards.'}});
  const before=s.players[0].hand.length;s=act(s,0,'spell');assert.equal(s.players[0].hand.length,before+1);assert.equal(s.players[0].discard[0].id,spell.id);
  const second=put(s,0,'monster','hand');second.card=spell.card;s.players[0].hand.push(...s.players[0].deck.splice(1));assert.ok(!legalArenaActions(s,0).some(m=>m.action.type==='spell'&&m.action.card===second.id));
});
test('Yu-Gi-Oh battle applies ATK/DEF damage, simultaneous equal-ATK destruction and no defence piercing',()=>{
  let s=start('yugioh');emptyField(s);s.turn_number=3;s.step='battle';const a=put(s,0,'monster','field',{position:'attack'}),b=put(s,1,'monster','field',{position:'defense',face_down:true});a.card={...a.card,atk:2000};b.card={...b.card,def:1000};
  s=act(s,0,'attack');assert.equal(s.players[1].life,8000);assert.equal(s.players[1].discard.length,1);
  s.players[0].field[0].attacked=false;const target=put(s,1,'monster','field',{position:'attack'});target.card={...target.card,atk:2000};
  s=act(s,0,'attack');assert.equal(s.players[0].field.length,0);assert.equal(s.players[1].field.length,0);assert.equal(s.players[0].life,8000);
});
test('Magic has opening mulligans, bottom choices, upkeep/draw priority and a skipped first draw',()=>{
  let s=newArena([gameDeck('mtg'),gameDeck('mtg')],{version:'mtg-casual-v1',rng:seeded()});s=act(s,s.toss,'first',a=>a.seat===0);s=act(s,0,'mulligan');s=act(s,0,'keep');assert.equal(s.players[0].bottom,1);s=act(s,0,'bottom');s=act(s,1,'keep');
  assert.equal(s.step,'upkeep');assert.equal(s.players[0].hand.length,6);s=passes(s);assert.equal(s.step,'draw');assert.equal(s.players[0].hand.length,6);s=passes(s);assert.equal(s.step,'main1');
});
test('Magic mana payments preserve choices, spells use the stack, and illegal actions are atomic',()=>{
  let s=start('mtg');emptyField(s);s.step='main1';const u=put(s,0,'creature','hand');u.card={...u.card,cost:['1','G']};s.players[0].mana={W:1,U:0,B:0,R:1,G:1,C:0};
  const original=JSON.stringify(s);assert.throws(()=>applyArenaAction(s,1,{type:'cast',card:u.id}));assert.equal(JSON.stringify(s),original);
  s=act(s,0,'cast');assert.equal(s.payment.remaining,1);assert.equal(s.stack.length,0);s=act(s,0,'pay',a=>a.color==='R');assert.equal(s.stack.length,1);assert.equal(s.players[0].mana.W,1);assert.equal(s.players[0].field.length,0);
  s=passes(s);assert.equal(s.players[0].field[0].id,u.id);assertArena(s);
});
test('Magic instants can respond and stack resolves last-in-first-out with target rechecking',()=>{
  let s=start('mtg');emptyField(s);s.step='main1';const victim=put(s,0,'creature'),spell=put(s,0,'creature','hand'),reply=put(s,1,'creature','hand');
  spell.card=gameCard('mtg','Bolt',{arena_data:{types:['Instant']},raw_data:{public_text:'Bolt deals 3 damage to target creature.'}});
  reply.card=gameCard('mtg','Removal',{arena_data:{types:['Instant']},raw_data:{public_text:'Destroy target creature.'}});
  s.players[0].mana.G=1;s.players[1].mana.G=1;s=act(s,0,'cast',a=>a.target===victim.id);s=act(s,0,'pass');s=act(s,1,'cast',a=>a.target===victim.id);assert.equal(s.stack.length,2);
  s=passes(s);assert.equal(s.players[0].field.length,0);assert.equal(s.stack.length,1);s=passes(s);assert.equal(s.stack.length,0);assert.equal(s.players[0].discard.length,2);assertArena(s);
});
test('Magic land limits, summoning sickness and flying/reach blocking are enforced',()=>{
  let s=start('mtg');emptyField(s);s.step='main1';put(s,0,'land','hand');put(s,0,'land','hand');s=act(s,0,'land');assert.ok(!legalArenaActions(s,0).some(m=>m.action.type==='land'));
  const fresh=put(s,0,'creature','field',{entered:s.players[0].turns}),flyer=put(s,0,'creature');flyer.card={...flyer.card,keywords:['flying']};const blocker=put(s,1,'creature');
  s.step='declare_attackers';s.combat={attackers:[],blocks:{},blocked:[],allocations:{}};assert.ok(!legalArenaActions(s,0).some(m=>m.action.card===fresh.id));s=act(s,0,'attacker',a=>a.card===flyer.id);s=act(s,0,'declare_attackers');s=passes(s);assert.equal(s.step,'declare_blockers');assert.ok(!legalArenaActions(s,1).some(m=>m.action.type==='block'));
  s.players[1].field.find(u=>u.id===blocker.id).card.keywords=['reach'];assert.ok(legalArenaActions(s,1).some(m=>m.action.type==='block'));
});
test('Magic multiple blockers require explicit allocation and damage is simultaneous',()=>{
  let s=start('mtg');emptyField(s);s.step='declare_attackers';s.combat={attackers:[],blocks:{},blocked:[],allocations:{}};
  const attacker=put(s,0,'creature');attacker.card={...attacker.card,power:4,toughness:4};const b1=put(s,1,'creature'),b2=put(s,1,'creature');
  s=act(s,0,'attacker');s=act(s,0,'declare_attackers');s=passes(s);s=act(s,1,'block',a=>a.card===b1.id);s=act(s,1,'block',a=>a.card===b2.id);s=act(s,1,'declare_blockers');s=passes(s);assert.equal(s.step,'assign_damage');
  s=act(s,0,'assign_damage',a=>a.target===b1.id&&a.amount===2);s=act(s,0,'assign_damage',a=>a.target===b2.id&&a.amount===2);
  assert.equal(s.players[0].field.length,0);assert.equal(s.players[1].field.length,0);assert.equal(s.players[0].discard.length,1);assert.equal(s.players[1].discard.length,2);assert.equal(s.players[1].life,20);assertArena(s);
});
test('Magic cleanup discards to seven and clears all creature damage',()=>{
  let s=start('mtg');emptyField(s);s.step='end';for(let i=0;i<8;i++)put(s,0,'creature','hand');put(s,0,'creature','field',{damage:1});s=passes(s);assert.equal(s.step,'cleanup');s=act(s,0,'discard');assert.equal(s.turn,1);assert.equal(s.players[0].hand.length,7);assert.equal(s.players[0].field[0].damage,0);assertArena(s);
});
for(const game of ['mtg','yugioh'])test(`${game} redacted CPU can finish a serialized match while conserving every card`,()=>{
  let s=start(game);const rng=seeded(17);
  for(let i=0;i<4000&&s.phase!=='finished';i++){
    const candidates=[0,1].map(seat=>({seat,view:arenaView(s,seat)}));const actor=candidates.find(({view})=>view.legal.length);assert.ok(actor,`No available actor in ${s.step}`);
    const a=cpuAction(actor.view,{rng});assert.ok(a);s=applyArenaAction(JSON.parse(JSON.stringify(s)),actor.seat,a,{rng});
    for(const seat of [0,1]){const v=arenaView(s,seat);assert.deepEqual(v.players[1-seat].hand,[]);assert.equal(v.players[1-seat].deck,undefined);}
  }
  assert.equal(s.phase,'finished');assertArena(s);
});
