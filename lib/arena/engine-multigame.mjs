/** Persistable game reducers. Only server-issued actions can mutate a snapshot. */
import { randomInt } from 'node:crypto';
import { check } from './input.mjs';
import { validateGameDeck } from './cards-multigame.mjs';
import { arenaGame, arenaGameForVersion } from '../../shared/arena-games.mjs';
const other=seat=>1-seat, colors=['W','U','B','R','G','C'];
const keyword=(u,k)=>u.card.keywords?.includes(k);
const creatures=p=>p.field.filter(u=>u.card.kind==='creature');
const monsters=p=>p.field.filter(u=>u.card.kind==='monster');
const moveKey=a=>JSON.stringify(Object.fromEntries(Object.entries(a).sort(([a],[b])=>a.localeCompare(b))));
const log=(s,seat,text)=>{s.events.push({n:s.steps,seat,kind:'game',text});s.events=s.events.slice(-100);};
function finish(s,result,reason){s.phase='finished';s.result=result;s.result_reason=reason;s.prompt=null;}
function shuffle(cards,rng){const out=[...cards];for(let i=out.length-1;i>0;i--){const j=rng(i+1);[out[i],out[j]]=[out[j],out[i]];}return out;}
function draw(s,seat,n){const p=s.players[seat];for(let i=0;i<n&&s.phase!=='finished';i++){if(!p.deck.length){finish(s,other(seat),'A required draw could not be completed.');break;}p.hand.push(p.deck.shift());}}
function discard(p,id,from=p.field){const i=from.findIndex(u=>u.id===id);if(i<0)return;const [u]=from.splice(i,1);u.face_down=false;p.discard.push(u);return u;}
function stateBased(s){
  const dead=s.players.map(p=>p.life<=0);
  if(dead.some(Boolean)){finish(s,dead.every(Boolean)?'draw':dead[0]?1:0,'Life total reached zero.');return;}
  if(s.game==='mtg')for(const p of s.players)for(const u of [...creatures(p)])if(u.damage>=u.card.toughness)discard(p,u.id);
}
function startTurn(s,seat){
  s.turn=seat;s.turn_number++;s.priority=seat;s.passes=0;s.step='main1';s.combat=null;
  const p=s.players[seat];p.turns++;p.land_played=false;p.summoned=false;
  for(const u of p.field){u.tapped=false;u.attacked=false;u.changed=false;}
  if(s.game==='mtg')for(const player of s.players)player.mana=Object.fromEntries(colors.map(c=>[c,0]));
  if(s.game==='yugioh'&&s.turn_number>1)draw(s,seat,1);
  if(s.game==='mtg')s.step='upkeep';
  log(s,seat,`Turn ${s.turn_number} begins.`);
}
export function newArena(decks,{version,game=arenaGameForVersion(version),mode='pvp',rng=randomInt}={}){
  check(['mtg','yugioh'].includes(game),'Choose an installed game engine.');
  const config=arenaGame(game);check(!version||version===config.version,'Game and engine do not match.');
  check(Array.isArray(decks)&&decks.length===2&&decks.every(rows=>validateGameDeck(rows,game).playable),'Both decks must be playable in the same game.',422);
  const s={version:config.version,game,mode,phase:'setup',step:'first',first:null,toss:rng(2),turn:0,turn_number:0,priority:0,passes:0,steps:0,
    result:null,result_reason:'',events:[],stack:[],combat:null,payment:null,players:decks.map((rows,seat)=>{
      let i=0;const deck=shuffle(rows.flatMap(({card,quantity})=>Array.from({length:quantity},()=>({id:`${seat}-${++i}`,owner:seat,card:structuredClone(card),tapped:false,damage:0,entered:0,face_down:false}))),rng);
      return {deck,hand:[],field:[],discard:[],inventory:deck.map(u=>u.id).sort(),life:game==='mtg'?20:8000,turns:0,ready:false,mulligans:0,bottom:0,mana:Object.fromEntries(colors.map(c=>[c,0]))};
    })};
  for(const seat of [0,1])draw(s,seat,game==='mtg'?7:5);
  log(s,s.toss,'Won the starting toss; choose who takes the first turn.');assertArena(s);return s;
}
function payment(cost,mana){
  const pool={...mana};let generic=0;
  for(const c of cost)if(/^\d+$/.test(c))generic+=Number(c);else if(pool[c]>0)pool[c]--;else return null;
  return Object.values(pool).reduce((n,v)=>n+v,0)>=generic?{pool,generic}:null;
}
function targets(s,seat,program){
  if(!program?.target)return [undefined];
  if(program.target==='opponent')return [`player:${other(seat)}`];
  const players=program.target==='creature'?[]:['player:0','player:1'];
  return program.target==='player'?players:[...players,...s.players.flatMap(p=>creatures(p).map(u=>u.id))];
}
function resolveEffect(s,seat,program,target){
  const p=s.players[seat];
  if(program.kind==='draw')draw(s,seat,program.amount);
  if(program.kind==='heal')p.life+=program.amount;
  if(program.kind==='destroy_all')for(const index of (program.side==='both'?[0,1]:[other(seat)]))for(const u of [...monsters(s.players[index])])discard(s.players[index],u.id);
  if(program.kind==='damage'){
    if(/^player:[01]$/.test(target))s.players[Number(target.slice(-1))].life-=program.amount;
    else {const u=s.players.flatMap(p=>p.field).find(u=>u.id===target&&u.card.kind==='creature');if(u)u.damage+=program.amount;}
  }
  if(program.kind==='destroy')for(const player of s.players){const u=creatures(player).find(u=>u.id===target);if(u)discard(player,u.id);}
  stateBased(s);
}
function resolveStack(s){
  const entry=s.stack.pop();if(!entry)return;const p=s.players[entry.seat],u=entry.unit;
  if(u.card.kind==='creature'){u.entered=p.turns;u.damage=0;p.field.push(u);}
  else {resolveEffect(s,entry.seat,u.card.program,entry.target);p.discard.push(u);}
  log(s,entry.seat,`${u.card.name} resolved.`);s.priority=s.turn;s.passes=0;stateBased(s);
}
function putSpell(s,paymentState){
  const {seat,unit,target}=paymentState;s.stack.push({unit,seat,...(target?{target}:{})});s.payment=null;s.priority=seat;s.passes=0;
  log(s,seat,`Cast ${unit.card.name}.`);
}
function clearMana(s){for(const p of s.players)for(const c of colors)p.mana[c]=0;}
function combatDamage(s){
  const c=s.combat,attacker=s.players[s.turn],defender=s.players[other(s.turn)],damage=[];
  for(const id of c.attackers){
    const u=creatures(attacker).find(u=>u.id===id);if(!u)continue;
    const blockers=creatures(defender).filter(b=>c.blocks[b.id]===id);
    if(!c.blocked.includes(id)){defender.life-=u.card.power;continue;}
    for(const b of blockers)damage.push([u,b.card.power]);
    for(const b of blockers)damage.push([b,blockers.length===1?u.card.power:(c.allocations[id]?.[b.id]||0)]);
  }
  for(const [u,n] of damage)u.damage+=n;
  s.step='damage';s.priority=s.turn;s.passes=0;stateBased(s);log(s,s.turn,'Combat damage resolved simultaneously.');
}
function damageDecision(s){
  const c=s.combat,defender=s.players[other(s.turn)];
  for(const id of c.attackers){
    const u=creatures(s.players[s.turn]).find(u=>u.id===id),blocks=creatures(defender).filter(b=>c.blocks[b.id]===id);
    if(!u||blocks.length<=1)continue;
    const left=u.card.power-Object.values(c.allocations[id]||{}).reduce((a,b)=>a+b,0);
    if(left>0)return {id,blocks,left};
  }
  return null;
}
function advanceMagic(s){
  clearMana(s);
  if(s.step==='upkeep'){s.step='draw';if(s.turn_number>1)draw(s,s.turn,1);}
  else if(s.step==='draw')s.step='main1';
  else if(s.step==='main1')s.step='begin_combat';
  else if(s.step==='begin_combat'){s.step='declare_attackers';s.combat={attackers:[],blocks:{},blocked:[],allocations:{}};}
  else if(s.step==='attackers')s.step='declare_blockers';
  else if(s.step==='blockers'){s.step='assign_damage';if(!damageDecision(s))combatDamage(s);}
  else if(s.step==='damage')s.step='end_combat';
  else if(s.step==='end_combat')s.step='main2';
  else if(s.step==='main2')s.step='end';
  else if(s.step==='end'){
    s.step='cleanup';if(s.players[s.turn].hand.length<=7)cleanupMagic(s);
  }
  s.priority=s.turn;s.passes=0;
}
function cleanupMagic(s){for(const p of s.players)for(const u of p.field)u.damage=0;clearMana(s);startTurn(s,other(s.turn));}
function legalMagic(s,seat,add){
  const p=s.players[seat],op=s.players[other(seat)],active=s.turn===seat;
  if(s.payment){if(s.payment.seat===seat)for(const color of colors)if(p.mana[color]>0)add({type:'pay',color},`Pay one generic mana with ${color}`);return;}
  if(s.step==='cleanup'){if(active)for(const u of p.hand)add({type:'discard',card:u.id},`Discard ${u.card.name}`,u.id);return;}
  if(s.step==='assign_damage'){
    const d=damageDecision(s);if(active&&d)for(const b of d.blocks)for(let n=1;n<=d.left;n++)add({type:'assign_damage',target:b.id,amount:n},`Assign ${n} damage from ${s.players[s.turn].field.find(u=>u.id===d.id).card.name} to ${b.card.name}`);
    return;
  }
  if(s.step==='declare_attackers'){
    if(active){for(const u of creatures(p))if(!u.tapped&&!keyword(u,'defender')&&(u.entered<p.turns||keyword(u,'haste')))add({type:'attacker',card:u.id},`${s.combat.attackers.includes(u.id)?'Remove':'Select'} attacker: ${u.card.name}`,u.id);add({type:'declare_attackers'},'Confirm attackers');}return;
  }
  if(s.step==='declare_blockers'){
    if(!active){for(const u of creatures(p).filter(u=>!u.tapped)){
      if(s.combat.blocks[u.id])add({type:'unblock',card:u.id},`Remove blocker: ${u.card.name}`,u.id);
      for(const id of s.combat.attackers){const at=creatures(op).find(u=>u.id===id);if(at&&(!keyword(at,'flying')||keyword(u,'flying')||keyword(u,'reach')))add({type:'block',card:u.id,target:id},`${u.card.name} blocks ${at.card.name}`,u.id);}
    }add({type:'declare_blockers'},'Confirm blockers');}return;
  }
  if(s.priority!==seat)return;
  add({type:'pass'},s.stack.length?'Pass priority / resolve top spell':'Pass priority / advance step');
  for(const u of p.field)if(u.card.kind==='land'&&!u.tapped)add({type:'mana',card:u.id},`Tap ${u.card.name} for ${u.card.mana_color}`,u.id);
  for(const u of p.hand){
    const main=active&&['main1','main2'].includes(s.step)&&!s.stack.length;
    if(u.card.kind==='land'){if(main&&!p.land_played)add({type:'land',card:u.id},`Play ${u.card.name}`,u.id);continue;}
    if((u.card.kind==='instant'||main)&&payment(u.card.cost,p.mana))for(const target of targets(s,seat,u.card.program))add({type:'cast',card:u.id,...(target?{target}:{})},`Cast ${u.card.name}${target?' → '+(target.startsWith('player:')?(target===`player:${seat}`?'your life total':'opponent life total'):((unit)=>`${unit?.owner===seat?'your':'opponent'} ${unit?.card.name}`)(s.players.flatMap(p=>p.field).find(u=>u.id===target))):''}`,u.id);
  }
}
function actionMagic(s,seat,a){
  const p=s.players[seat],u=p.hand.find(u=>u.id===a.card),field=p.field.find(u=>u.id===a.card);
  if(a.type==='land'){p.hand.splice(p.hand.indexOf(u),1);p.field.push(u);p.land_played=true;s.passes=0;log(s,seat,`Played ${u.card.name}.`);}
  else if(a.type==='mana'){field.tapped=true;p.mana[field.card.mana_color]++;s.passes=0;}
  else if(a.type==='cast'){
    const paid=payment(u.card.cost,p.mana);p.mana=paid.pool;p.hand.splice(p.hand.indexOf(u),1);s.passes=0;
    s.payment={seat,unit:u,...(a.target?{target:a.target}:{}),remaining:paid.generic};
    if(!paid.generic)putSpell(s,s.payment);
  } else if(a.type==='pay'){p.mana[a.color]--;s.payment.remaining--;if(!s.payment.remaining)putSpell(s,s.payment);}
  else if(a.type==='pass'){s.passes++;if(s.passes===2){if(s.stack.length)resolveStack(s);else advanceMagic(s);}else s.priority=other(seat);}
  else if(a.type==='attacker'){const list=s.combat.attackers,i=list.indexOf(a.card);if(i<0)list.push(a.card);else list.splice(i,1);}
  else if(a.type==='declare_attackers'){
    for(const id of s.combat.attackers){const u=p.field.find(u=>u.id===id);if(!keyword(u,'vigilance'))u.tapped=true;}
    s.step=s.combat.attackers.length?'attackers':'end_combat';s.priority=s.turn;s.passes=0;
  } else if(a.type==='block')s.combat.blocks[a.card]=a.target;
  else if(a.type==='unblock')delete s.combat.blocks[a.card];
  else if(a.type==='declare_blockers'){s.combat.blocked=[...new Set(Object.values(s.combat.blocks))];s.step='blockers';s.priority=s.turn;s.passes=0;}
  else if(a.type==='assign_damage'){const d=damageDecision(s);s.combat.allocations[d.id]||={};s.combat.allocations[d.id][a.target]=(s.combat.allocations[d.id][a.target]||0)+a.amount;if(!damageDecision(s))combatDamage(s);}
  else if(a.type==='discard'){discard(p,a.card,p.hand);if(p.hand.length<=7)cleanupMagic(s);}
}
const spellAllowed=(s,seat,program)=>program.kind==='draw'?s.players[seat].deck.length>=program.amount:program.kind!=='destroy_all'||(program.side==='both'?s.players.flatMap(monsters):monsters(s.players[other(seat)])).length>0;
const tributes=u=>u.card.level>=7?2:u.card.level>=5?1:0;
function combinations(items,n){if(!n)return [[]];return items.flatMap((v,i)=>combinations(items.slice(i+1),n-1).map(rest=>[v,...rest]));}
function legalYugioh(s,seat,add){
  if(s.turn!==seat)return;const p=s.players[seat],op=s.players[other(seat)],main=['main1','main2'].includes(s.step);
  if(s.step==='end'){for(const u of p.hand)add({type:'discard',card:u.id},`Discard ${u.card.name}`,u.id);return;}
  if(main){
    for(const u of p.hand){
      if(u.card.kind==='monster'&&!p.summoned&&monsters(p).length>=tributes(u)&&monsters(p).length-tributes(u)<5){
        for(const set of combinations(monsters(p).map(u=>u.id),tributes(u)))for(const position of ['attack','set'])add({type:'summon',card:u.id,position,tributes:set.join(',')},`${position==='set'?'Set':'Summon'} ${u.card.name}${set.length?' (tribute '+set.map(id=>p.field.find(u=>u.id===id).card.name).join(' + ')+')':''}`,u.id);
      }
      if(u.card.kind==='spell'&&p.field.filter(u=>u.card.kind==='spell').length<5){
        if(spellAllowed(s,seat,u.card.program))add({type:'spell',card:u.id},`Activate ${u.card.name}`,u.id);
        add({type:'set_spell',card:u.id},`Set ${u.card.name}`,u.id);
      }
    }
    for(const u of p.field){
      if(u.card.kind==='spell'){if(spellAllowed(s,seat,u.card.program))add({type:'spell',card:u.id},`Activate set ${u.card.name}`,u.id);}
      else if(u.entered<p.turns&&!u.changed&&!u.attacked)add({type:'position',card:u.id},u.face_down?`Flip Summon ${u.card.name}`:`Change position: ${u.card.name}`,u.id);
    }
    if(s.step==='main1'&&s.turn_number>1)add({type:'battle'},'Enter Battle Phase');
    add({type:'end_turn'},'End turn');
  } else if(s.step==='battle'){
    for(const u of monsters(p).filter(u=>u.position==='attack'&&!u.attacked&&!u.face_down)){
      if(!monsters(op).length)add({type:'attack',card:u.id,target:`player:${other(seat)}`},`Direct attack: ${u.card.name}`,u.id);
      else for(const target of monsters(op))add({type:'attack',card:u.id,target:target.id},`${u.card.name} attacks ${target.face_down?'a set monster':target.card.name}`,u.id);
    }
    add({type:'main2'},'Enter Main Phase 2');add({type:'end_turn'},'End turn');
  }
}
function actionYugioh(s,seat,a){
  const p=s.players[seat],op=s.players[other(seat)],u=p.hand.find(u=>u.id===a.card),field=p.field.find(u=>u.id===a.card);
  if(a.type==='summon'){
    for(const id of a.tributes.split(',').filter(Boolean))discard(p,id);
    p.hand.splice(p.hand.indexOf(u),1);Object.assign(u,{position:a.position==='set'?'defense':'attack',face_down:a.position==='set',entered:p.turns,changed:true,attacked:false});p.field.push(u);p.summoned=true;
    log(s,seat,a.position==='set'?'Set a monster.':`Summoned ${u.card.name}.`);
  } else if(a.type==='set_spell'){p.hand.splice(p.hand.indexOf(u),1);u.face_down=true;p.field.push(u);log(s,seat,'Set a Spell.');}
  else if(a.type==='spell'){
    const card=u||field;discard(p,card.id,u?p.hand:p.field);resolveEffect(s,seat,card.card.program,`player:${other(seat)}`);log(s,seat,`Activated ${card.card.name}.`);
  } else if(a.type==='position'){field.position=field.position==='attack'?'defense':'attack';field.face_down=false;field.changed=true;log(s,seat,`Changed ${field.card.name} to ${field.position}.`);}
  else if(a.type==='battle')s.step='battle';
  else if(a.type==='main2')s.step='main2';
  else if(a.type==='attack'){
    field.attacked=true;const target=op.field.find(u=>u.id===a.target);
    if(!target)op.life-=field.card.atk;
    else {
      target.face_down=false;const attack=field.card.atk,defense=target.position==='attack'?target.card.atk:target.card.def,difference=attack-defense;
      if(target.position==='attack'){
        if(difference>0){discard(op,target.id);op.life-=difference;}
        else if(difference<0){discard(p,field.id);p.life+=difference;}
        else if(attack>0){discard(op,target.id);discard(p,field.id);}
      } else if(difference>0)discard(op,target.id);else if(difference<0)p.life+=difference;
    }
    log(s,seat,`${field.card.name} attacked${target?' '+target.card.name:''}.`);stateBased(s);
  } else if(a.type==='end_turn'){if(p.hand.length>6)s.step='end';else startTurn(s,other(seat));}
  else if(a.type==='discard'){discard(p,a.card,p.hand);if(p.hand.length<=6)startTurn(s,other(seat));}
}
export function legalArenaActions(s,seat){
  check([0,1].includes(seat),'Invalid seat.');const out=[],add=(action,label,card)=>out.push({action,label,...(card?{card}:{})});
  if(s.phase==='finished')return out;
  if(s.phase==='setup'){
    if(s.first===null){if(seat===s.toss)for(const index of [0,1])add({type:'first',seat:index},index===seat?'Take the first turn':'Take the second turn');return out;}
    const p=s.players[seat];if(p.ready)return out;
    if(p.bottom>0){for(const u of p.hand)add({type:'bottom',card:u.id},`Put ${u.card.name} on the bottom`,u.id);return out;}
    add({type:'keep'},'Keep opening hand');if(p.mulligans<7)add({type:'mulligan'},'Mulligan: shuffle and draw seven');return out;
  }
  if(s.game==='mtg')legalMagic(s,seat,add);else legalYugioh(s,seat,add);return out;
}
export function applyArenaAction(state,seat,action,{rng=randomInt}={}){
  check(state?.phase!=='finished','This game has finished.',409);check([0,1].includes(seat),'Invalid seat.');
  check(action&&typeof action==='object'&&!Array.isArray(action)&&Object.keys(action).length<=6&&Object.values(action).every(v=>typeof v==='string'||Number.isSafeInteger(v)),'Invalid action.');
  const concede=moveKey(action)===moveKey({type:'concede'});
  check(concede||legalArenaActions(state,seat).some(m=>moveKey(m.action)===moveKey(action)),'This move is not legal. Refresh the table.',409);
  const s=structuredClone(state);s.steps++;
  if(concede)finish(s,other(seat),'The game ended by concession.');
  else if(s.phase==='setup'){
    const p=s.players[seat];
    if(action.type==='first'){
      s.first=action.seat;
      if(s.game==='yugioh'){s.players.forEach(p=>p.ready=true);s.phase='playing';startTurn(s,s.first);}
    } else if(action.type==='mulligan'){p.deck=shuffle([...p.deck,...p.hand],rng);p.hand=[];p.mulligans++;draw(s,seat,7);}
    else if(action.type==='keep'){p.bottom=p.mulligans;if(!p.bottom)p.ready=true;}
    else if(action.type==='bottom'){const i=p.hand.findIndex(u=>u.id===action.card);p.deck.push(...p.hand.splice(i,1));p.bottom--;if(!p.bottom)p.ready=true;}
    if(s.first!==null&&s.players.every(p=>p.ready)&&s.phase==='setup'){s.phase='playing';startTurn(s,s.first);}
  } else if(s.game==='mtg')actionMagic(s,seat,action);else actionYugioh(s,seat,action);
  if(s.steps>=4000&&s.phase!=='finished')finish(s,'draw','The casual match action limit was reached.');
  assertArena(s);return s;
}
function disclosed(u,seat){return u.face_down&&u.owner!==seat?{id:u.id,hidden:true,position:u.position||'set'}:structuredClone(u);}
export function arenaView(s,seat){
  const legal=legalArenaActions(s,seat),waiting=s.phase==='setup'?s.first===null?s.toss:null:s.game==='yugioh'?s.turn:s.payment?.seat??(['declare_blockers'].includes(s.step)?other(s.turn):['declare_attackers','assign_damage','cleanup'].includes(s.step)?s.turn:s.priority);
  return {version:s.version,game:s.game,mode:s.mode,seat,phase:s.phase,step:s.step,first:s.first,toss:s.toss,turn:s.turn,turn_number:s.turn_number,priority:s.priority,
    result:s.result,result_reason:s.result_reason,events:structuredClone(s.events),waiting_for:waiting,legal,prompt:null,
    stack:s.stack.map(e=>({seat:e.seat,unit:structuredClone(e.unit),target:e.target})),combat:structuredClone(s.combat),
    payment:s.payment?{seat:s.payment.seat,remaining:s.payment.remaining,unit:structuredClone(s.payment.unit)}:null,
    players:s.players.map((p,index)=>({life:p.life,mana:{...p.mana},ready:p.ready,mulligans:p.mulligans,bottom:p.bottom,turns:p.turns,
      hand:index===seat?structuredClone(p.hand):[],hand_count:p.hand.length,deck_count:p.deck.length,field:p.field.map(u=>disclosed(u,seat)),discard:structuredClone(p.discard),active:null,bench:[],prize_count:0}))};
}
export function assertArena(s){
  check(arenaGame(s.game)?.version===s.version&&['setup','playing','finished'].includes(s.phase)&&s.players.length===2,'Corrupt game snapshot.',409);
  const ids=new Set();
  for(const [seat,p] of s.players.entries()){
    check(Number.isFinite(p.life)&&Math.abs(p.life)<1000000,'Invalid life total.',409);
    const all=[...p.deck,...p.hand,...p.field,...p.discard,...s.stack.filter(e=>e.seat===seat).map(e=>e.unit),...(s.payment?.seat===seat?[s.payment.unit]:[])];
    check(JSON.stringify(all.map(u=>u.id).sort())===JSON.stringify(p.inventory),'Card conservation failed.',409);
    for(const u of all){check(u.owner===seat&&!ids.has(u.id)&&u.card.game===s.game&&u.card.compiler===s.version,'Card identity or engine mismatch.',409);ids.add(u.id);}
    if(s.game==='yugioh')check(monsters(p).length<=5&&p.field.filter(u=>u.card.kind==='spell').length<=5,'Zone capacity exceeded.',409);
    for(const c of colors)check(Number.isInteger(p.mana[c])&&p.mana[c]>=0&&p.mana[c]<=60,'Invalid mana pool.',409);
  }
  return true;
}
export const publicCard=card=>structuredClone(card);
