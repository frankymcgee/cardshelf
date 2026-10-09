/** September 2026 rulebook engine. Card-specific effects still require complete,
 * reviewed programs. Frozen v1/v2/v3 retain unfinished saved-match semantics.
 * See docs/ARENA_RULES.md for sources, reviewed scope and remaining exclusions.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { check, object, integer, oneOf } from './input.mjs';
import { deckValidation } from './cards.mjs';
import { ARENA_VERSION } from '../../shared/arena.mjs';
import { arenaPokemonName as canonicalName } from '../../shared/arena-card-name.mjs';
export const opponent = seat => seat === 0 ? 1 : 0;
const copy = value => structuredClone(value);
const sameName = (a,b) => canonicalName(a)===canonicalName(b);
const field = p => [p.active,...p.bench].filter(Boolean);
const fieldLabel = (p,u) => `${p.active?.id===u.id?'Active':'Bench '+(p.bench.findIndex(c=>c.id===u.id)+1)} · ${u.card.name}`;
const blankConditions = () => ({special:null,poison:false,burn:false});
function fresh(card,owner=null) { return {id:randomUUID(),card:copy(card),owner,damage:0,conditions:blankConditions(),energy:[],tools:[],under:[],parts:[],abilityUses:{},entered:0,evolved:0}; }
function rekey(item) { return fresh(item.baseCard||item.card,item.owner); }
function flat(item) { return [item,...item.under.flatMap(flat),...(item.parts||[]).flatMap(flat),...item.energy.flatMap(flat),...(item.tools||[]).flatMap(flat)].map(rekey); }
function discard(s,seat,items) {
  for(const item of items){const owner=item.owner??seat,c=rekey(item),zone=c.card.prism_star?'lostZone':'discard';s.players[owner][zone].push(c);
    if(zone==='lostZone')log(s,owner,'lost_zone',`${c.card.name} went to the Lost Zone instead of the discard pile.`,{card:publicCard(c.card)});}
}
export function shuffled(items,rng=randomInt) {
  const out=[...items];for(let i=out.length-1;i>0;i--){const j=integer(rng(i+1),0,i);[out[i],out[j]]=[out[j],out[i]];}return out;
}
function log(s,seat,kind,text,detail={}) { s.events.push({n:++s.event,seat,kind,text,...detail});s.events=s.events.slice(-120); }
function mark(s,seat,id) { if(seat===0&&s.mode==='tutorial')s.progress[id]=true; }
function coin(s,seat,label,rng) { const heads=integer(rng(2),0,1)===1;log(s,seat,'coin',`${label}: ${heads?'heads':'tails'}.`,{heads});return heads; }
function draw(p,n) { const cards=p.deck.splice(0,Math.min(n,p.deck.length));p.hand.push(...cards.map(rekey));return cards.length; }
function find(p,id,zone='hand') { const x=p[zone].find(c=>c.id===id);check(x,'That card is no longer available.',409);return x; }
function creature(p,id) { const c=field(p).find(x=>x.id===id);check(c,'Select one of your Pokémon in play.',409);return c; }
function pop(list,id) { const i=list.findIndex(c=>c.id===id);check(i>=0,'The selected card moved.',409);return list.splice(i,1)[0]; }
function matches(card,filter) { return filter==='any'?true:filter==='energy_card'?card.kind==='energy':filter?.startsWith('provided:')?card.kind==='energy'&&(card.provides?.types||[card.type]).includes(filter.slice(9)):filter?.startsWith('energy:')?card.kind==='energy'&&card.basic_energy&&card.type===filter.slice(7):filter==='basic'?card.kind==='pokemon'&&card.stage==='Basic':filter==='pokemon'?card.kind==='pokemon':filter==='energy'?card.kind==='energy'&&card.basic_energy:filter==='pokemon_or_energy'?card.kind==='pokemon'||card.kind==='energy'&&card.basic_energy:false; }
function finish(s,winner,reason) { s.phase='finished';s.result=winner;s.result_reason=reason;s.pending=null;s.queue=[];log(s,winner==='draw'?null:winner,'result',reason);mark(s,0,'finish'); }
export function energySatisfied(unit,cost) {
  const pool=unit.energy.flatMap(c=>Array.from({length:energyValue(c)},()=>c.card.provides?.types||[c.card.type]));
  const typed=cost.filter(t=>t!=='Colorless'),any=cost.length-typed.length;
  typed.sort((a,b)=>pool.filter(t=>t.includes(a)).length-pool.filter(t=>t.includes(b)).length);
  const pay=(index,remaining)=>{
    if(index===typed.length)return remaining.length>=any;
    const tried=new Set();
    for(let i=0;i<remaining.length;i++){const key=remaining[i].join('|');if(tried.has(key)||!remaining[i].includes(typed[index]))continue;tried.add(key);
      if(pay(index+1,remaining.filter((_,j)=>j!==i)))return true;}
    return false;
  };return pay(0,pool);
}
const energyValue=c=>c.card.provides?.count||1;
const hasType=(unit,type)=>(unit.card.types||[unit.card.type]).includes(type);
function accepts(unit,filter) {
  return !filter || filter==='basic'&&unit.card.stage==='Basic' || filter==='evolved'&&['Stage1','Stage2'].includes(unit.card.stage) || filter==='V'&&['V','VMAX','VSTAR','V-UNION'].includes(unit.card.rule_box) || unit.card.rule_box===filter;
}
function toolPrograms(unit) { return (unit.tools||[]).map(c=>c.card.program).filter(a=>accepts(unit,a.filter)); }
function attacksFor(unit){return [...unit.card.attacks,...toolPrograms(unit).flatMap(a=>a.grantedAttacks||[])];}
function heal(unit,amount){const multiplier=(unit.card.abilities||[]).filter(a=>a.kind==='trait').reduce((n,a)=>n*(a.modifier.healMultiplier||1),1);unit.damage=Math.max(0,unit.damage-amount*multiplier);}
function effectiveHP(s,unit) {
  const stadium=s.stadium?.unit.card.program.modifiers;
  return unit.card.hp+toolPrograms(unit).reduce((n,a)=>n+(a.hp||0),0)+(stadium&&accepts(unit,stadium.filter)?stadium.hp||0:0);
}
function effectiveRetreat(unit) {
  const modifiers=toolPrograms(unit);
  return modifiers.some(a=>a.retreat==='free')?0:Math.max(0,unit.card.retreat-modifiers.reduce((n,a)=>n+(typeof a.retreat==='number'?a.retreat:0),0));
}
export function attackDamage(attack,attacker,defender,rawDamage=attack.damage,benched=false) {
  if(benched&&defender.card.tera)return 0;
  if(rawDamage<=0)return 0;
  let damage=Math.max(0,rawDamage+toolPrograms(attacker).reduce((n,a)=>n+(!benched||a.damageScope==='all'?a.damage||0:0),0));
  if(!benched){
    for(const w of defender.card.weakness||[])if(hasType(attacker,w.type))damage=w.value==='x2'?damage*2:damage+Number(w.value);
    for(const r of defender.card.resistance||[])if(hasType(attacker,r.type))damage+=Number(r.value);
  }
  return Math.max(0,damage);
}
function newPlayer(rows,rng,mode,seat) {
  const all=rows.flatMap(r=>Array.from({length:r.quantity},()=>fresh(r.card,seat))),deck=shuffled(all,rng);
  if(mode==='tutorial') {
    // A disclosed, scripted opening only in the training scenario. PvP/practice are never stacked.
    const kinds=seat===0?['basic','basic','energy','trainer-draw','energy','evolution','trainer-search']:['basic','basic','energy','energy','trainer-draw','energy','energy'];
    const opening=[];
    for(const kind of kinds){const index=deck.findIndex(x=>kind==='basic'?x.card.kind==='pokemon'&&x.card.stage==='Basic':kind==='evolution'?x.card.kind==='pokemon'&&x.card.stage!=='Basic':kind==='energy'?x.card.kind==='energy':x.card.kind==='trainer'&&x.card.program.kind===(kind==='trainer-draw'?'draw':'search'));if(index>=0)opening.push(...deck.splice(index,1));}
    deck.unshift(...opening);
  }
  return {deck,hand:[],prizes:[],active:null,bench:[],discard:[],lostZone:[],resolving:[],ready:false,mulligans:0,bonus:0,turns:0,gxUsed:false,vstarUsed:false,unionPlayed:[],energyAttached:false,supporterPlayed:false,stadiumPlayed:false,stadiumUsed:false,retreated:false};
}
export function newArena(decks,{mode='pvp',rng=randomInt,round=1,prizes=6,tiebreaker=false}={}) {
  check(['pvp','practice','tutorial'].includes(mode),'Unknown game mode.');
  check(Array.isArray(decks)&&decks.length===2,'Two decks are required.');
  for(const rows of decks)check(deckValidation(rows).playable,'A supported 60-card deck with a Basic Pokémon is required.');
  check(decks.length===2,'Two decks are required.');
  check(prizes===6,'Current rules require six Prize cards, including tiebreaker games.');
  const s={version:ARENA_VERSION,game:'pokemon',mode,phase:'setup',setup_complete:false,round,prizeGoal:prizes,first:null,turn:null,turnNumber:0,
    players:decks.map((rows,i)=>newPlayer(rows,rng,mode,i)),originalDecks:copy(decks),toss:mode==='tutorial'?0:integer(rng(2),0,1),
    stadium:null,pending:null,queue:[],event:0,events:[],actions:0,result:null,result_reason:'',progress:{},bonusDone:[false,false],tiebreaker:tiebreaker===true};
  for(const p of s.players)draw(p,7);
  // Shared mulligans happen before either field is prepared. A sole mulligan
  // waits until the other player locks their field and sets aside their Prizes.
  while(s.players.every(p=>!p.hand.some(c=>c.card.kind==='pokemon'&&c.card.stage==='Basic')))
    for(const seat of [0,1])redeal(s,seat,rng);
  log(s,s.toss,'setup','Won the starting toss. Both players prepare their fields privately.');assertArena(s);return s;
}
function redeal(s,seat,rng) {
  const p=s.players[seat];
  check(p.mulligans<80,'Unable to deal a Basic Pokémon within the safety limit. Start a fresh match.',409);
  log(s,seat,'mulligan','Revealed a no-Basic hand and automatically reshuffled.',{revealed:p.hand.map(c=>publicCard(c.card))});
  p.deck=shuffled([...p.deck,...p.hand].map(rekey),rng);p.hand=[];draw(p,7);p.mulligans++;
}
function startTurn(s,seat) {
  s.phase='playing';s.turn=seat;s.turnNumber++;const p=s.players[seat];p.turns++;p.energyAttached=false;p.supporterPlayed=false;p.stadiumPlayed=false;p.stadiumUsed=false;p.retreated=false;
  if(!p.deck.length){finish(s,opponent(seat),'The opponent could not draw a card at the start of their turn.');return;}
  draw(p,1);log(s,seat,'turn','Turn started. Drew one card privately.',{turn:s.turnNumber});mark(s,seat,'start');
}
function ready(s,rng) {
  for(const p of s.players)if(p.ready&&!p.prizes.length)p.prizes=p.deck.splice(0,s.prizeGoal).map(rekey);
  for(const seat of [0,1]){
    const p=s.players[seat];
    if(!p.ready&&!p.active&&s.players[opponent(seat)].ready)
      while(!p.hand.some(c=>c.card.kind==='pokemon'&&c.card.stage==='Basic'))redeal(s,seat,rng);
  }
  if(!s.players.every(p=>p.ready)||s.first===null)return;
  for(let seat=0;seat<2;seat++){const p=s.players[seat];p.bonus=Math.max(0,s.players[opponent(seat)].mulligans-p.mulligans);if(p.bonus)s.queue.push({kind:'bonus',seat,max:p.bonus});}
  s.phase='resolution';s.queue.push({kind:'reveal'},{kind:'begin',seat:s.first});advance(s,rng);
}
function setCondition(unit,condition) {
  if(unit.card.fossil)return;
  if(condition==='poisoned')unit.conditions.poison=true;
  else if(condition==='burned')unit.conditions.burn=true;
  else unit.conditions.special=condition;
}
function removeKnockouts(s) {
  const awards=[0,0];
  for(let seat=0;seat<2;seat++){
    const p=s.players[seat];for(const unit of field(p))if(unit.damage>=effectiveHP(s,unit)){
      if(p.active?.id===unit.id)p.active=null;else pop(p.bench,unit.id);
      discard(s,seat,flat(unit));awards[opponent(seat)]+=unit.card.prizes??1;
      log(s,seat,'knockout',`${unit.card.name} was Knocked Out.`,{card:publicCard(unit.card)});
    }
  }
  for(let seat=0;seat<2;seat++)if(awards[seat])s.queue.push({kind:'prize',seat,count:Math.min(awards[seat],s.players[seat].prizes.length)});
  s.queue.push({kind:'settle'});
}
function settle(s,rng) {
  const wins=s.players.map((p,i)=>Number(s.tiebreaker?p.prizes.length<s.players[opponent(i)].prizes.length:p.prizes.length===0)+Number(field(s.players[opponent(i)]).length===0));
  if(wins[0]||wins[1]){
    if(wins[0]===wins[1]){
      // February 2026: fresh six-Prize setup; the first Prize advantage wins.
      const replacement=newArena(s.originalDecks,{mode:s.mode,rng,round:s.round+1,tiebreaker:true});
      replacement.progress={...s.progress};replacement.actions=s.actions;replacement.event=s.event;replacement.events=s.events;
      Object.assign(s,replacement);log(s,null,'tiebreaker','Both players met the same number of win conditions. A six-Prize tiebreaker game begins; the first Prize advantage wins.');
    }else finish(s,wins[0]>wins[1]?0:1,s.tiebreaker?'Won the tiebreaker by gaining a Prize advantage or leaving the opponent without a Pokémon in play.':'Won by taking all Prize cards or leaving the opponent without a Pokémon in play.');
    return;
  }
  // Replacement choices precede the queued continuation; only public field choices are exposed.
  const order=[s.turn??0,opponent(s.turn??0)];
  for(const seat of order.reverse())if(!s.players[seat].active)s.queue.unshift({kind:'promote',seat});
}
function conditionGroup(s,ending,rng) {
  for(let seat=0;seat<2;seat++){
    const u=s.players[seat].active;if(!u)continue;
    if(u.conditions.poison){u.damage+=10;log(s,seat,'condition','Poison placed 10 damage.',{target:u.id,damage:10});}
    if(u.conditions.burn){u.damage+=20;log(s,seat,'condition','Burn placed 20 damage.',{target:u.id,damage:20});if(coin(s,seat,'Burn recovery',rng))u.conditions.burn=false;}
    if(u.conditions.special==='asleep'&&coin(s,seat,'Sleep recovery',rng))u.conditions.special=null;
    if(seat===ending&&u.conditions.special==='paralyzed')u.conditions.special=null;
  }
}
function checkup(s,ending,rng) {
  for(const u of field(s.players[ending])){const expired=u.tools.filter(c=>c.card.program.expires==='end_turn');u.tools=u.tools.filter(c=>!expired.includes(c));discard(s,ending,expired);}
  const steps=[{id:'conditions',label:'Resolve all Special Conditions together',kind:'conditions'}];
  for(const seat of [0,1])for(const u of field(s.players[seat]))for(const [index,a]of (u.card.abilities||[]).entries())if(a.kind==='triggered'&&a.timing==='checkup')
    steps.push({id:`checkup:${seat}:${u.id}:${index}`,label:`${u.card.name} · ${a.name}`,kind:'ability',seat,source:u.id,program:a.program});
  if(steps.length>1)pending(s,{kind:'checkup_order',seat:opponent(ending),ending,steps});
  else{conditionGroup(s,ending,rng);removeKnockouts(s);s.queue.push({kind:'begin',seat:opponent(ending)});}
}
function pending(s,prompt) { s.pending=prompt;s.phase='resolution'; }
function advance(s,rng) {
  while(!s.pending&&s.queue.length&&s.phase!=='finished'){
    const step=s.queue.shift();
    if(step.kind==='reveal'){s.setup_complete=true;log(s,null,'reveal','Both opening fields are revealed. Prize cards remain face down.');}
    else if(step.kind==='begin')startTurn(s,step.seat);
    else if(step.kind==='checkup')checkup(s,step.seat,rng);
    else if(step.kind==='settle'){const round=s.round;settle(s,rng);if(s.round!==round)return;}
    else if(step.kind==='prize'){if(step.count>0)pending(s,step);}
    else if(step.kind==='promote'){if(!s.players[step.seat].active)pending(s,step);}
    else if(step.kind==='bonus'||step.kind==='bonus_bench')pending(s,step);
    else if(step.kind==='effect')resolveEffect(s,step,rng);
    else if(step.kind==='finish_effects'){
      if(step.card){const p=s.players[step.seat];discard(s,step.seat,[pop(p.resolving,step.card)]);}
      const remaining=s.queue.splice(0);removeKnockouts(s);s.queue.push(...remaining);
    }
    else if(step.kind==='discard_trainer'){
      const p=s.players[step.seat],c=pop(p.resolving,step.card);discard(s,step.seat,[c]);
    }
    else if(step.kind==='finish_attack')finishAttack(s,step.seat,rng);
    else if(step.kind==='checkup_resume'){
      if(step.steps.length)pending(s,{kind:'checkup_order',seat:opponent(step.ending),ending:step.ending,steps:step.steps});
      else{removeKnockouts(s);s.queue.push({kind:'begin',seat:opponent(step.ending)});}
    }
    else if(step.kind==='shuffle_deck'){const p=s.players[step.seat];p.deck=shuffled(p.deck.map(rekey),rng);log(s,step.seat,'shuffle','Finished searching and shuffled the deck.');}
    else throw Error('Unknown arena continuation.');
  }
  if(!s.pending&&!s.queue.length&&s.phase==='resolution')s.phase='playing';
}
function finishAttack(s,seat,rng) { removeKnockouts(s);s.queue.push({kind:'checkup',seat});s.phase='resolution';advance(s,rng); }
function resolveAttack(s,seat,index,rng,targets=[],rawDamage=null) {
  const p=s.players[seat],u=p.active,d=s.players[opponent(seat)].active,attack=attacksFor(u)[index];
  let amount=attack.damage;
  for(const effect of attack.effects){
    if(effect.kind==='coin_gate'&&!coin(s,seat,attack.name,rng)){log(s,seat,'attack_miss','The attack did nothing.');finishAttack(s,seat,rng);return;}
    if(effect.kind==='coin_damage'){amount=0;for(let i=0;i<effect.coins;i++)if(coin(s,seat,attack.name,rng))amount+=effect.per;}
    if(effect.kind==='coin_bonus'&&coin(s,seat,attack.name,rng))amount+=effect.amount;
    if(effect.kind==='energy_bonus')amount+=effect.amount*u.energy.reduce((n,c)=>n+(!effect.type||(c.card.provides?.types||[c.card.type]).includes(effect.type)?energyValue(c):0),0);
    if(effect.kind==='counter_bonus')amount+=effect.amount*(effect.once?Number(u.damage>0):u.damage/10);
    if(effect.kind==='evolution_bonus'&&['Stage1','Stage2','MegaEvolution','VMAX','VSTAR','BREAK'].includes(d.card.stage))amount+=effect.amount;
  }
  const targeted=attack.effects.find(e=>e.kind==='target_damage'),defenders=targeted?targets.map(id=>creature(s.players[opponent(seat)],id)):[d];
  for(const [i,defender] of defenders.entries()){
    const damage=attackDamage(attack,u,defender,targeted?targeted.amount:rawDamage??amount,defender.id!==d.id);defender.damage+=damage;
    log(s,seat,i?'attack_damage':'attack',`${u.card.name} used ${attack.name} for ${damage} damage.`,{attacker:u.id,target:defender.id,damage,attack:attack.name});
  }mark(s,seat,'attack');
  for(const effect of attack.effects){
    if(effect.kind==='condition'&&!preventsAttackEffects(d))setCondition(d,effect.condition);
    else if(effect.kind==='coin_condition'&&coin(s,seat,'Special Condition',rng)&&!preventsAttackEffects(d))setCondition(d,effect.condition);
    else if(effect.kind==='recoil'){u.damage+=effect.amount;log(s,seat,'recoil',`Recoil placed ${effect.amount} damage.`,{target:u.id,damage:effect.amount});}
    else if(effect.kind==='heal_self'){heal(u,effect.amount);}
    else if(effect.kind==='draw'){const n=draw(p,effect.count);log(s,seat,'draw',`The attack drew ${n} card(s) privately.`);}
    else if(effect.kind==='discard_deck'){const cards=p.deck.splice(0,Math.min(effect.count,p.deck.length));discard(s,seat,cards);log(s,seat,'discard_deck',`The attack discarded ${cards.length} card(s) from the top of the deck.`,{revealed:cards.map(c=>publicCard(c.card))});}
    else if(effect.kind==='bench_damage')for(const b of s.players[effect.side==='own'?seat:opponent(seat)].bench){const n=attackDamage(attack,u,b,effect.amount,true);b.damage+=n;log(s,seat,'attack_damage',`The attack dealt ${n} Bench damage.`,{attacker:u.id,target:b.id,damage:n});}
    else if(effect.kind==='program')queueProgram(s,seat,effect.program,{source:u.id});
    else if(effect.kind==='extra_energy_bonus'&&energySatisfied(u,[...effectiveAttackCost(u,attack),...Array.from({length:effect.extra},()=> 'Colorless')]))queueProgram(s,seat,effect.program,{source:u.id});
  }
  if(s.queue.length){s.queue.push({kind:'finish_attack',seat});s.phase='resolution';advance(s,rng);}
  else finishAttack(s,seat,rng);
}
function preventsAttackEffects(unit){return (unit.card.abilities||[]).some(a=>a.kind==='passive'&&a.modifier?.prevent_attack_effects);}
function startAttack(s,seat,index,rng) {
  const u=s.players[seat].active,attack=attacksFor(u)[index];
  if(u.conditions.special==='confused'&&!coin(s,seat,'Confusion',rng)){
    u.damage+=30;log(s,seat,'confusion','The attack failed; Confusion placed 30 damage.',{target:u.id,damage:30});mark(s,seat,'attack');finishAttack(s,seat,rng);return;
  }
  // A failed Confusion check means the attack never happened. Only an actual
  // attack consumes the shared marker, even if its own coin/effect then fails.
  if(attack.power){s.players[seat][attack.power==='gx'?'gxUsed':'vstarUsed']=true;log(s,seat,'power',`Used the once-per-game ${attack.power==='gx'?'GX attack':'VSTAR Power'}.`);}
  const targeted=attack.effects.find(e=>e.kind==='target_damage');
  if(targeted){pending(s,{kind:'attack_target',seat,attack:index,count:Math.min(targeted.count||1,field(s.players[opponent(seat)]).length),options:field(s.players[opponent(seat)]).map(c=>c.id)});return;}
  continueAttack(s,seat,index,rng);
}
function continueAttack(s,seat,index,rng,targets=[]) {
  const p=s.players[seat],u=p.active,attack=attacksFor(u)[index];
  const variable=attack.effects.find(e=>e.kind==='energy_discard_damage');
  if(variable){pending(s,{kind:'attack_energy_amount',seat,attack:index,per:variable.per,options:field(p).flatMap(c=>c.energy.filter(e=>(e.card.provides?.types||[e.card.type]).includes(variable.type)).map(e=>e.id))});return;}
  const effect=attack.effects.find(e=>e.kind==='discard_energy');
  if(effect){const available=u.energy.filter(e=>!effect.type||(e.card.provides?.types||[e.card.type]).includes(effect.type)),n=effect.count==='all'?available.length:Math.min(available.length,effect.count);
    if(n){pending(s,{kind:'attack_discard',seat,attack:index,count:n,targets,options:available.map(c=>c.id)});return;}}
  resolveAttack(s,seat,index,rng,targets);
}
function programTargets(s,seat,program,context={}) {
  const p=s.players[seat],op=s.players[opponent(seat)];
  if(program.kind==='heal')return field(p).filter(c=>c.damage>0).map(c=>c.id);
  if(program.kind==='switch')return p.active?p.bench.map(c=>c.id):[];
  if(program.kind==='gust')return op.active?op.bench.map(c=>c.id):[];
  if(program.kind==='heal_self')return field(p).some(c=>c.id===context.source&&c.damage>0)?[null]:[];
  if(program.kind==='heal_all')return field(p).some(c=>c.damage>0&&(!program.types||program.types.some(t=>hasType(c,t))))?[null]:[];
  if(program.kind==='damage')return (program.target==='opponent_active'?op.active:p.active)?[null]:[];
  if(program.kind==='draw_until')return p.deck.length&&p.hand.length<program.count?[null]:[];
  if(program.kind==='draw'&&!p.deck.length)return [];
  if(program.kind==='discard_draw'&&!p.deck.length&&p.hand.length<=(context.source?0:1))return [];
  if(program.kind==='shuffle_draw'&&!p.deck.length&&p.hand.length<=1)return [];
  if(program.kind==='search'&&!p.deck.length)return [];
  if(program.kind==='recover'&&!p.discard.some(c=>matches(c.card,program.filter)))return [];
  if(program.kind==='attach_discard')return field(p).some(c=>c.id===context.source)&&p.discard.some(c=>matches(c.card,program.filter))?[null]:[];
  if(program.kind==='attach_hand')return p.hand.some(c=>c.card.kind==='energy')&&field(p).length?[null]:[];
  if(program.kind==='allocate_damage')return field(op).length?[null]:[];
  if(program.kind==='fossil'||program.kind==='fossil_search')return p.bench.length<5&&(program.kind==='fossil'||p.deck.length)?[null]:[];
  if(program.kind==='tag_team')return programTargets(s,seat,program.base,context);
  if(program.kind==='evolve_search')return p.bench.length&&p.deck.length?[null]:[];
  if(program.kind==='discard_tools')return (program.side==='both'?[p,op]:[program.side==='own'?p:op]).some(q=>field(q).some(u=>u.tools?.length))?[null]:[];
  if(program.kind==='sequence'){
    if(program.requires_switch&&(!p.active||!p.bench.length))return [];
    return program.steps.some(step=>programTargets(s,seat,step,context).length)?[null]:[];
  }
  return [null];
}
function swap(p,id){const next=pop(p.bench,id),old=p.active;check(old,'There is no Active Pokémon.');old.conditions=blankConditions();p.active=next;p.bench.push(old);}
function queueProgram(s,seat,program,context={},target=null) {
  const steps=program.kind==='sequence'?program.steps:[program];
  s.queue.push(...steps.flatMap(step=>step.kind==='sequence'?step.steps:[step]).map(a=>({kind:'effect',seat,program:a,context,target})));
}
function beginProgram(s,seat,program,context,target,rng) {
  s.phase='resolution';queueProgram(s,seat,program,context,target);
  s.queue.push({kind:'finish_effects',seat,card:context.card||null});advance(s,rng);
}
function resolveEffect(s,step,rng) {
  const {seat,program:a,context={}}=step,p=s.players[seat],op=s.players[opponent(seat)];
  let target=step.target;
  if(['heal','switch','gust'].includes(a.kind)){
    const options=programTargets(s,seat,a,context);
    if(!options.length)return;
    if(!options.includes(target)){pending(s,{kind:'effect_target',seat,step,options});return;}
  }
  if(a.kind==='draw'||a.kind==='draw_until'){
    const amount=a.kind==='draw_until'?Math.max(0,a.count-p.hand.length):a.count;
    log(s,seat,'draw',`Drew ${draw(p,amount)} card(s) privately.`);
  }else if(a.kind==='discard_draw'){
    discard(s,seat,p.hand);p.hand=[];log(s,seat,'draw',`Discarded the hand and drew ${draw(p,a.count)} card(s) privately.`);
  }else if(a.kind==='shuffle_draw'){
    if(p.hand.length){p.deck=shuffled([...p.deck,...p.hand].map(rekey),rng);p.hand=[];}
    log(s,seat,'draw',`Shuffled the hand into the deck and drew ${draw(p,a.count)} card(s) privately.`);
  }else if(a.kind==='heal'||a.kind==='heal_self'||a.kind==='heal_previous'){
    const u=field(p).find(c=>c.id===(a.kind==='heal'?target:a.kind==='heal_previous'?context.previous:context.source));
    if(u){heal(u,a.amount);log(s,seat,'heal',`Healed ${u.card.name}.`,{target:u.id});}
  }else if(a.kind==='heal_all'){
    for(const u of field(p))if(u.damage>0&&(!a.types||a.types.some(t=>hasType(u,t)))){heal(u,a.amount);log(s,seat,'heal',`Healed ${u.card.name}.`,{target:u.id});}
  }else if(a.kind==='damage'){
    const u=a.target==='opponent_active'?op.active:p.active;
    if(u){u.damage+=a.amount;log(s,seat,'effect_damage',`Placed ${a.amount} damage on ${u.card.name}.`,{target:u.id,damage:a.amount});}
  }else if(a.kind==='switch'){swap(p,target);log(s,seat,'switch','Switched the Active and Benched Pokémon.');}
  else if(a.kind==='gust'){swap(op,target);log(s,seat,'switch',"Switched the opponent's Active and Benched Pokémon.");}
  else if(a.kind==='search'){
    if(p.deck.length)pending(s,{kind:'search',seat,max:a.count,min:a.filter==='any'?(a.choice==='attack'&&a.optional?0:1):0,filter:a.filter,continuation:true});
    else log(s,seat,'shuffle','The deck was empty; the search completed.');
  }else if(a.kind==='recover'){
    const n=p.discard.filter(x=>matches(x.card,a.filter)).length;
    if(n)pending(s,{kind:'recover',seat,max:Math.min(n,a.count),min:a.optional?(a.choice==='attack'?0:1):Math.min(n,a.count),filter:a.filter,destination:a.destination||'hand',continuation:true});
  }else if(a.kind==='attach_discard'){
    const n=p.discard.filter(x=>matches(x.card,a.filter)).length;if(n)pending(s,{kind:'attach_discard',seat,source:context.source,max:Math.min(n,a.count),min:a.optional&&a.choice==='attack'?0:a.optional?1:Math.min(n,a.count),filter:a.filter});
  }else if(a.kind==='attach_hand'){
    if(p.hand.some(c=>c.card.kind==='energy')&&field(p).length)pending(s,{kind:'attach_hand_energy',seat,options:p.hand.filter(c=>c.card.kind==='energy').map(c=>c.id)});
  }else if(a.kind==='devolve_opponent'){
    for(const u of field(op))if(u.under.length&&!preventsAttackEffects(u)){
      const stack=[...u.under],previous=stack.pop();previous.under=stack;previous.energy=u.energy;previous.tools=u.tools;previous.damage=u.damage;previous.conditions=blankConditions();previous.entered=u.entered;previous.evolved=op.turns;
      op.hand.push(rekey(u));if(op.active?.id===u.id)op.active=previous;else op.bench[op.bench.findIndex(c=>c.id===u.id)]=previous;
      log(s,seat,'devolve',`Devolved ${u.card.name} into ${previous.card.name}.`,{target:previous.id,card:publicCard(previous.card)});
    }
  }else if(a.kind==='allocate_damage'){
    // One counter at a time permits exact distributions without allowing the
    // client to submit damage amounts. All counters resolve before any KO.
    const options=field(op).map(c=>c.id);if(options.length)pending(s,{kind:'damage_counter',seat,count:a.count,options,protected:field(op).filter(preventsAttackEffects).map(c=>c.id)});
  }else if(a.kind==='fossil_search'){
    const cards=p.deck.slice(-Math.min(a.count,p.deck.length)),source=find(p,context.card,'resolving').card.name;
    pending(s,{kind:'fossil_search',seat,name:a.name,source,options:cards.filter(c=>c.card.kind==='pokemon'&&sameName(c.card.name,a.name)&&(!c.card.restored_source||sameName(c.card.restored_source,source))).map(c=>c.id),looked:cards.map(c=>c.id)});
  }else if(a.kind==='evolve_search'){
    if(p.bench.length)pending(s,{kind:'evolve_targets',seat,max:Math.min(a.count,p.bench.length),options:p.bench.filter(u=>!u.card.radiant).map(u=>u.id)});
  }else if(a.kind==='evolve_from_deck'){
    const u=field(p).find(c=>c.id===a.target);if(u)pending(s,{kind:'evolve_deck',seat,target:u.id,options:p.deck.filter(c=>c.card.kind==='pokemon'&&canEvolve(c.card,u.card)&&c.card.stage!=='MegaEvolution').map(c=>c.id)});
  }else if(a.kind==='discard_tools'){
    for(const owner of (a.side==='both'?[seat,opponent(seat)]:[a.side==='own'?seat:opponent(seat)])){
      const q=s.players[owner];for(const u of field(q)){discard(s,owner,(u.tools||[]).flatMap(flat));u.tools=[];}
    }
    log(s,seat,'discard_tools','Discarded the affected attached Pokémon Tools.');
  }else throw Error('Unimplemented effect program.');
}
function resolveTrainer(s,seat,cardId,target,rng,bonus=false) {
  const card=find(s.players[seat],cardId,'resolving');
  if(card.card.program.kind==='tag_team'){
    const a=card.card.program;beginProgram(s,seat,{kind:'sequence',steps:[a.base,...(bonus?[a.bonus]:[])]},{card:cardId,previous:s.players[seat].active.id},target,rng);return;
  }
  beginProgram(s,seat,card.card.program,{card:cardId},target,rng);
}
function startTrainer(s,seat,id,target,rng) {
  const p=s.players[seat],card=pop(p.hand,id),a=card.card.program;
  log(s,seat,'trainer',`Played ${card.card.name}.`,{card:publicCard(card.card)});mark(s,seat,'trainer');
  if(a.kind==='tool'){
    creature(s.players[a.side==='opponent'?opponent(seat):seat],target).tools.push(card);s.phase='resolution';removeKnockouts(s);advance(s,rng);return;
  }
  if(a.kind==='fossil'){
    card.baseCard=copy(card.card);card.card={...card.card,kind:'pokemon',fossil:true,stage:'Basic',type:'Colorless',types:['Colorless'],hp:a.hp,retreat:0,prizes:1,attacks:[],abilities:a.abilities,weakness:[],resistance:[]};card.entered=p.turns;p.bench.push(card);return;
  }
  if(a.kind==='stadium'){
    if(s.stadium)discard(s,s.stadium.seat,[s.stadium.unit]);
    s.stadium={seat,unit:card};p.stadiumPlayed=true;
    for(const player of s.players)player.stadiumUsed=false;
    // Replacing the shared Stadium can reduce multiple Pokémon's maximum HP.
    s.phase='resolution';removeKnockouts(s);advance(s,rng);return;
  }
  p.resolving.push(card);if(a.trainerType==='Supporter')p.supporterPlayed=true;
  if(a.kind==='tag_team'){pending(s,{kind:'tag_team_cost',seat,card:id,count:a.optional_discard,target,options:p.hand.map(c=>c.id)});return;}
  if(a.discard){pending(s,{kind:'trainer_discard',seat,card:id,count:a.discard,target,options:p.hand.map(c=>c.id)});return;}
  resolveTrainer(s,seat,id,target,rng);
}
function canUseAbility(s,seat,unit,index) {
  const a=unit.card.abilities?.[index],used=unit.abilityUses?.[index];
  if(!a||a.kind!=='activated'||!['turn','instance','game'].includes(a.limit))return false;
  if(a.power==='vstar'&&s.players[seat].vstarUsed)return false;
  if(a.position==='active'&&s.players[seat].active?.id!==unit.id)return false;
  if(a.conditionBlocked&&(unit.conditions.special||unit.conditions.poison||unit.conditions.burn))return false;
  if(a.cost&&s.players[seat].hand.filter(c=>matches(c.card,a.cost.filter)).length<a.cost.count)return false;
  if(a.limit==='turn'&&used===s.turnNumber||a.limit==='instance'&&used!=null)return false;
  return programTargets(s,seat,a.program,{source:unit.id}).length>0;
}
function attackBlock(s,seat,index) {
  const p=s.players[seat],u=p.active,attack=u?attacksFor(u)[index]:null;
  if(!attack)return 'Attack unavailable.';
  if(s.turnNumber===1)return 'The first player cannot attack on the opening turn.';
  if(['asleep','paralyzed'].includes(u.conditions.special))return `Cannot attack while ${u.conditions.special}.`;
  if(attack.power==='gx'&&p.gxUsed)return 'Your GX attack has already been used this game.';
  if(attack.power==='vstar'&&p.vstarUsed)return 'Your VSTAR Power has already been used this game.';
  if(!energySatisfied(u,effectiveAttackCost(u,attack)))return 'Not enough matching Energy.';
  if(!s.players[opponent(seat)].active)return 'Wait for an opponent Active Pokémon.';
  return '';
}
function effectiveAttackCost(unit,attack){return [...attack.cost,...Array.from({length:toolPrograms(unit).reduce((n,a)=>n+(a.attackCost||0),0)},()=> 'Colorless')];}
function blocksStadium(p){return field(p).some(u=>(u.card.abilities||[]).some(a=>a.kind==='passive'&&a.modifier?.block_stadium&&(!a.modifier.position||a.modifier.position==='active'&&u.id===p.active?.id)));}
function canEvolve(card,target) {
  if(!card.evolves_from||!sameName(card.evolves_from,target.name)||target.radiant)return false;
  if(['VMAX','VSTAR'].includes(card.stage))return target.rule_box==='V'&&target.stage==='Basic';
  if(card.stage==='MegaEvolution')return target.rule_box==='EX'&&target.stage==='Basic';
  // Printed predecessor names, not assumed stage numbers, govern cross-era
  // Fossil evolution (rulebook p41). BREAK follows the normal timing rules.
  return ['Stage1','Stage2','BREAK'].includes(card.stage);
}
function evolveUnit(s,seat,evolution,previous){
  const p=s.players[seat];evolution.energy=previous.energy;evolution.tools=previous.tools||[];evolution.under=[...previous.under,{...previous,energy:[],tools:[],under:[]}];
  if(evolution.card.stage==='BREAK'){
    evolution.baseCard=copy(evolution.card);evolution.card.attacks=[...evolution.card.attacks,...previous.card.attacks];evolution.card.abilities=[...(evolution.card.abilities||[]),...(previous.card.abilities||[])];
    evolution.card.weakness=copy(previous.card.weakness);evolution.card.resistance=copy(previous.card.resistance);evolution.card.retreat=previous.card.retreat;
  }
  evolution.damage=previous.damage;evolution.entered=previous.entered;evolution.evolved=p.turns;evolution.conditions=blankConditions();
  if(p.active?.id===previous.id)p.active=evolution;else p.bench[p.bench.findIndex(c=>c.id===previous.id)]=evolution;
}
function unionParts(p,group){
  const pieces=p.discard.filter(c=>c.card.union?.group===group),byPiece=new Map();
  for(const c of pieces)if(!byPiece.has(c.card.union.piece))byPiece.set(c.card.union.piece,c);
  return byPiece.size===4?[1,2,3,4].map(n=>byPiece.get(n)):[];
}
export function legalArenaActions(s,seat) {
  check(seat===0||seat===1,'Invalid player.',403);
  if(s.phase==='finished')return [];
  if(s.pending)return []; // Decisions use a typed prompt, not arbitrary gameplay commands.
  const p=s.players[seat],op=s.players[opponent(seat)],moves=[];
  const add=(label,action,card=null,target=null)=>moves.push({label,action,card,target});
  if(s.phase==='setup'){
    if(s.first===null&&s.toss===seat){add('Go first',{type:'first',seat});add('Go second',{type:'first',seat:opponent(seat)});}
    if(!p.ready){
      for(const c of p.hand)if(c.card.kind==='pokemon'&&c.card.stage==='Basic'){
        if(!p.active)add('Place Active',{type:'setup',card:c.id,zone:'active'},c.id);
        if(p.bench.length<5)add('Place on Bench',{type:'setup',card:c.id,zone:'bench'},c.id);
      }
      if(p.active&&s.first!==null)add('Lock opening field',{type:'ready'});
      if(p.active||p.bench.length)add('Reset opening field',{type:'reset_setup'});
    }
    return moves;
  }
  if(s.phase!=='playing'||s.turn!==seat)return moves;
  if(p.bench.length<5){const groups=new Set(p.discard.filter(c=>c.card.union).map(c=>c.card.union.group));
    for(const group of groups){const parts=unionParts(p,group),name=parts[0]?.card.name;if(parts.length&&!p.unionPlayed.includes(canonicalName(name)))add(`Assemble ${name} from four discarded pieces`,{type:'union',card:parts[0].id},parts[0].id);}}
  for(const c of p.hand){
    if(c.card.kind==='pokemon'){
      if(c.card.stage==='Basic'&&p.bench.length<5)add('Play to Bench',{type:'bench',card:c.id},c.id);
      if(c.card.stage!=='Basic'&&p.turns>1)for(const target of field(p))if(canEvolve(c.card,target.card)&&target.entered<p.turns&&target.evolved<p.turns)
        add(`Evolve ${fieldLabel(p,target)}`,{type:'evolve',card:c.id,target:target.id},c.id,target.id);
    }
    if(c.card.kind==='energy'&&!p.energyAttached)for(const target of field(p))add(`Attach to ${fieldLabel(p,target)}`,{type:'energy',card:c.id,target:target.id},c.id,target.id);
    if(c.card.kind==='trainer'){
      const a=c.card.program;if(a.trainerType==='Supporter'&&(p.supporterPlayed||s.turnNumber===1))continue;
      if(a.discard&&p.hand.length-1<a.discard)continue;
      if(a.kind==='tool'){const owner=a.side==='opponent'?op:p;for(const target of field(owner).filter(u=>!(u.tools||[]).length&&(!a.attachFilter||u.card.rule_box===a.attachFilter)))add(`Attach Tool to ${a.side==='opponent'?'opponent ':''}${fieldLabel(owner,target)}`,{type:'trainer',card:c.id,target:target.id},c.id,target.id);continue;}
      if(a.kind==='stadium'){if(!p.stadiumPlayed&&!blocksStadium(op)&&!sameName(c.card.name,s.stadium?.unit.card.name||''))add('Play Stadium',{type:'trainer',card:c.id},c.id);continue;}
      for(const target of programTargets(s,seat,a))add(target?`Use on ${fieldLabel(a.kind==='gust'?op:p,field(p).concat(field(op)).find(x=>x.id===target))}`:'Play Trainer',
        {type:'trainer',card:c.id,...(target?{target}:{})},c.id,target);
    }
  }
  if(p.active){
    for(let i=0;i<attacksFor(p.active).length;i++)if(!attackBlock(s,seat,i))add(`Attack: ${attacksFor(p.active)[i].name}`,{type:'attack',index:i},p.active.id,op.active?.id);
    if(!p.active.card.fossil&&!p.retreated&&!['asleep','paralyzed'].includes(p.active.conditions.special)&&p.active.energy.reduce((n,c)=>n+energyValue(c),0)>=effectiveRetreat(p.active))
      for(const target of p.bench)add(`Retreat to ${fieldLabel(p,target)}`,{type:'retreat',target:target.id},p.active.id,target.id);
  }
  for(const unit of field(p))for(let index=0;index<(unit.card.abilities||[]).length;index++)if(canUseAbility(s,seat,unit,index))add(`Ability: ${unit.card.abilities[index].name}`,{type:'ability',card:unit.id,index},unit.id);
  for(const unit of field(p))if(unit.card.fossil)add(`Discard ${fieldLabel(p,unit)} from play`,{type:'discard_fossil',card:unit.id},unit.id);
  if(s.stadium?.unit.card.program.activation&&!p.stadiumUsed&&programTargets(s,seat,s.stadium.unit.card.program.activation).length)add(`Use Stadium: ${s.stadium.unit.card.name}`,{type:'stadium'},s.stadium.unit.id);
  add('End turn',{type:'end_turn'});return moves;
}
function promptOptions(s,seat) {
  const a=s.pending;if(!a||a.seat!==seat)return null;const p=s.players[seat];
  let options=[],min=1,max=1,title='Choose a card',kind=a.kind;
  if(kind==='prize'){title=`Choose ${a.count} Prize card${a.count===1?'':'s'}`;options=p.prizes.map((_,i)=>({id:String(i),label:`Prize ${i+1}`,hidden:true}));min=max=a.count;}
  else if(kind==='promote'){title='Choose your new Active Pokémon';options=p.bench.map(c=>({id:c.id,label:c.card.name,card:publicUnit(c,s)}));}
  else if(kind==='bonus'){title='Choose how many mulligan bonus cards to draw';options=Array.from({length:Math.min(a.max, p.deck.length)+1},(_,i)=>({id:String(i),label:String(i)}));}
  else if(kind==='bonus_bench'){title='Optionally Bench Basic Pokémon drawn from the mulligan bonus';options=p.hand.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c,s)}));min=0;max=Math.min(5-p.bench.length,options.length);}
  else if(kind==='attack_target'){title='Choose the Pokémon to attack';options=field(s.players[opponent(seat)]).filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c,s)}));min=max=a.count;}
  else if(kind==='attack_energy_amount'){title='Choose any number of Energy cards to discard for attack damage';options=field(p).flatMap(u=>u.energy.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:`${c.card.name} · ${u.card.name}`,card:publicUnit(c)})));min=0;max=options.length;}
  else if(kind==='ability_discard'){title='Discard to pay the Ability cost';options=p.hand.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)}));min=max=a.count;}
  else if(kind==='attach_discard'){title='Choose discarded Energy to attach';options=p.discard.filter(c=>matches(c.card,a.filter)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)}));min=a.min;max=a.max;}
  else if(kind==='damage_counter'){title=`Place a damage counter (${a.count} remaining)`;options=field(s.players[opponent(seat)]).filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c,s),protected:a.protected.includes(c.id)}));}
  else if(kind==='checkup_order'){title='Choose the next Pokémon Checkup step';options=a.steps.map(step=>({id:step.id,label:step.label}));}
  else if(kind==='fossil_search'){title=`Optionally Bench ${a.name} from the bottom of your deck`;options=p.deck.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)}));min=0;max=Math.min(1,options.length);}
  else if(kind==='evolve_targets'){title='Choose Benched Pokémon for the evolution attack';options=p.bench.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c,s)}));min=0;max=Math.min(a.max,options.length);}
  else if(kind==='evolve_deck'){title='Optionally choose a matching evolution from your deck';options=p.deck.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)}));min=0;max=Math.min(1,options.length);}
  else if(kind==='tag_team_cost'){title=`Optionally discard ${a.count} cards for the TAG TEAM bonus`;options=p.hand.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)}));min=0;max=options.length>=a.count?a.count:0;}
  else if(kind==='alpha_energy'){title='Optionally attach a second Energy with α Growth';options=p.hand.filter(c=>c.card.kind==='energy').map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)}));min=0;max=Math.min(1,options.length);}
  else if(kind==='attach_hand_energy'){title='Choose an Energy from your hand for the attack';options=p.hand.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)}));}
  else if(kind==='attach_hand_target'){title='Choose your Pokémon to receive the attack attachment';options=field(p).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c,s)}));}
  else if(['attack_discard','retreat_discard'].includes(kind)){title=kind==='retreat_discard'?`Discard Energy providing ${a.count} Energy for Retreat`:'Choose Energy cards to discard';options=p.active.energy.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c),energy_value:energyValue(c)}));min=max=a.count;
    if(kind==='retreat_discard'&&options.some(c=>c.energy_value>1)){min=1;max=Math.min(a.count,options.length);}}
  else if(kind==='trainer_discard'){title='Choose cards to discard for this Trainer';options=p.hand.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)}));min=max=a.count;}
  else if(kind==='effect_target'){
    title=a.step.program.kind==='heal'?'Choose a Pokémon to heal':a.step.program.kind==='gust'?"Choose the opponent's new Active Pokémon":'Choose your new Active Pokémon';
    options=field(p).concat(field(s.players[opponent(seat)])).filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c,s)}));
  }
  else if(kind==='search'||kind==='recover'){
    title=kind==='search'?(a.filter==='any'?'Search your deck privately, then shuffle':'Search your deck — reveal selected cards, then shuffle'):'Recover from your discard pile';
    options=p[kind==='search'?'deck':'discard'].filter(c=>matches(c.card,a.filter)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)})).sort((x,y)=>x.label.localeCompare(y.label)||x.id.localeCompare(y.id));
    min=kind==='search'?(a.min||0):a.min;max=Math.min(a.max,options.length);
  }else throw Error('Unknown decision type.');
  return {kind,title,min,max,options,...(kind==='effect_target'?{effect_kind:a.step.program.kind}:{}),...(kind==='retreat_discard'?{retreat_cost:a.count}:{}),...(kind==='fossil_search'?{looked_at:a.looked.map(id=>publicUnit(find(p,id,'deck')))}:{}),...(kind==='tag_team_cost'?{allowed_counts:max?[0,max]:[0],bonus_damage:p.active.damage}:{})};
}
function choose(s,seat,ids,rng) {
  const a=s.pending;check(a?.seat===seat,'Wait for the other player to finish choosing.',409);
  const prompt=promptOptions(s,seat);check(Array.isArray(ids)&&new Set(ids).size===ids.length&&ids.length>=prompt.min&&ids.length<=prompt.max&&ids.every(id=>typeof id==='string'&&prompt.options.some(o=>o.id===id)), 'Choose the required number of valid cards.');
  check(!prompt.allowed_counts||prompt.allowed_counts.includes(ids.length),'Choose either the full optional cost or no cards.');
  const p=s.players[seat];s.pending=null;
  if(a.kind==='prize'){
    const picked=ids.map(Number).sort((x,y)=>y-x);for(const i of picked)p.hand.push(rekey(p.prizes.splice(i,1)[0]));
    log(s,seat,'prize',`Took ${picked.length} Prize card(s) privately.`);mark(s,seat,'prize');advance(s,rng);
  }else if(a.kind==='promote'){p.active=pop(p.bench,ids[0]);log(s,seat,'promote',`Promoted ${p.active.card.name}.`);advance(s,rng);}
  else if(a.kind==='bonus'){
    const before=p.hand.length,n=draw(p,Number(ids[0]));p.bonus=0;log(s,seat,'draw',`Drew ${n} mulligan bonus card(s).`);
    const options=p.hand.slice(before).filter(c=>c.card.kind==='pokemon'&&c.card.stage==='Basic').map(c=>c.id);
    if(options.length&&p.bench.length<5)s.queue.unshift({kind:'bonus_bench',seat,options});advance(s,rng);
  }
  else if(a.kind==='bonus_bench'){for(const id of ids)p.bench.push(pop(p.hand,id));log(s,seat,'setup','Finished the private mulligan bonus Bench choice.');advance(s,rng);}
  else if(a.kind==='attack_target'){continueAttack(s,seat,a.attack,rng,ids);}
  else if(a.kind==='attack_discard'){discard(s,seat,ids.map(id=>pop(p.active.energy,id)));resolveAttack(s,seat,a.attack,rng,a.targets);}
  else if(a.kind==='attack_energy_amount'){discard(s,seat,ids.map(id=>{const unit=field(p).find(u=>u.energy.some(e=>e.id===id));return pop(unit.energy,id);}));resolveAttack(s,seat,a.attack,rng,[],ids.length*a.per);}
  else if(a.kind==='ability_discard'){discard(s,seat,ids.map(id=>pop(p.hand,id)));const u=creature(p,a.card);beginProgram(s,seat,u.card.abilities[a.index].program,{source:u.id},null,rng);}
  else if(a.kind==='attach_discard'){const u=creature(p,a.source);u.energy.push(...ids.map(id=>rekey(pop(p.discard,id))));log(s,seat,'energy',`Attached ${ids.length} discarded Energy card(s).`,{target:u.id});advance(s,rng);}
  else if(a.kind==='damage_counter'){
    const u=creature(s.players[opponent(seat)],ids[0]);if(!a.protected.includes(u.id)){u.damage+=10;log(s,seat,'effect_damage','Placed one attack damage counter.',{target:u.id,damage:10});}
    if(a.count>1)pending(s,{...a,count:a.count-1});else advance(s,rng);
  }
  else if(a.kind==='checkup_order'){
    const step=a.steps.find(x=>x.id===ids[0]),remaining=a.steps.filter(x=>x.id!==ids[0]),continuation=s.queue.splice(0);
    if(step.kind==='conditions')conditionGroup(s,a.ending,rng);else queueProgram(s,step.seat,step.program,{source:step.source});
    s.queue.push({kind:'checkup_resume',ending:a.ending,steps:remaining},...continuation);advance(s,rng);
  }
  else if(a.kind==='fossil_search'){
    if(ids.length){const u=rekey(pop(p.deck,ids[0]));u.entered=p.turns;p.bench.push(u);log(s,seat,'bench',`The Fossil effect put ${u.card.name} onto the Bench.`,{card:publicCard(u.card)});}
    p.deck=shuffled(p.deck.map(rekey),rng);log(s,seat,'shuffle','Finished the Fossil search and shuffled the deck.');advance(s,rng);
  }
  else if(a.kind==='evolve_targets'){
    s.queue.unshift(...ids.map(id=>({kind:'effect',seat,program:{kind:'evolve_from_deck',target:id}})),{kind:'shuffle_deck',seat});advance(s,rng);
  }
  else if(a.kind==='evolve_deck'){
    if(ids.length){const evolution=rekey(pop(p.deck,ids[0])),previous=creature(p,a.target);evolveUnit(s,seat,evolution,previous);log(s,seat,'evolve',`The attack evolved ${previous.card.name} into ${evolution.card.name}.`,{target:evolution.id,card:publicCard(evolution.card)});}
    advance(s,rng);
  }
  else if(a.kind==='tag_team_cost'){discard(s,seat,ids.map(id=>pop(p.hand,id)));resolveTrainer(s,seat,a.card,a.target,rng,ids.length>0);}
  else if(a.kind==='alpha_energy'){if(ids.length){const u=creature(p,a.target),c=pop(p.hand,ids[0]);u.energy.push(c);log(s,seat,'energy',`Attached the optional α Growth Energy to ${u.card.name}.`,{target:u.id});}s.phase='playing';}
  else if(a.kind==='attach_hand_energy'){pending(s,{kind:'attach_hand_target',seat,energy:ids[0]});}
  else if(a.kind==='attach_hand_target'){const u=creature(p,ids[0]);u.energy.push(pop(p.hand,a.energy));log(s,seat,'energy',`The attack attached Energy to ${u.card.name}.`,{target:u.id});advance(s,rng);}
  else if(a.kind==='retreat_discard'){
    const values=ids.map(id=>energyValue(find(p.active,id,'energy'))),total=values.reduce((n,v)=>n+v,0);
    check(total>=a.count&&values.every(v=>total-v<a.count),'Select sufficient Energy without discarding an unnecessary card.');
    discard(s,seat,ids.map(id=>pop(p.active.energy,id)));swap(p,a.target);p.retreated=true;s.phase='playing';mark(s,seat,'retreat');log(s,seat,'retreat','Paid retreat cost and switched the Active Pokémon.');}
  else if(a.kind==='effect_target'){s.queue.unshift({...a.step,target:ids[0]});advance(s,rng);}
  else if(a.kind==='trainer_discard'){discard(s,seat,ids.map(id=>pop(p.hand,id)));resolveTrainer(s,seat,a.card,a.target,rng);}
  else if(a.kind==='search'||a.kind==='recover'){
    const zone=a.kind==='search'?'deck':'discard',cards=ids.map(id=>pop(p[zone],id));p[a.destination==='deck'?'deck':'hand'].push(...cards.map(rekey));
    log(s,seat,a.kind,`Selected ${cards.length} card(s).`,a.kind==='search'&&a.filter==='any'?{}:{revealed:cards.map(c=>publicCard(c.card))});
    if(a.kind==='search'){p.deck=shuffled(p.deck.map(rekey),rng);log(s,seat,'shuffle','Finished searching and shuffled the deck.');}
    if(a.destination==='deck'&&cards.length){p.deck=shuffled(p.deck.map(rekey),rng);log(s,seat,'shuffle','Shuffled the recovered cards into the deck.');}
    if(a.continuation)advance(s,rng);else{discard(s,seat,[pop(p.resolving,a.card)]);s.phase='playing';}
  }
}
export function applyArenaAction(original,seat,value,{rng=randomInt}={}) {
  check(original?.version===ARENA_VERSION,'This match needs its original engine version.',409);integer(seat,0,1);
  check(original.phase!=='finished','This match has finished.',409);
  const a=object(value,['type','card','target','index','zone','seat','choices']);
  const fields={concede:[],first:['seat'],setup:['card','zone'],ready:[],reset_setup:[],bench:['card'],union:['card'],discard_fossil:['card'],energy:['card','target'],evolve:['card','target'],trainer:['card','target'],ability:['card','index'],stadium:[],attack:['index'],retreat:['target'],end_turn:[],choose:['choices']};
  check(Object.hasOwn(fields,a.type)&&Object.keys(a).every(k=>k==='type'||fields[a.type].includes(k)),'Unsupported action.');
  check(original.actions<4000||a.type==='concede','This match reached its safety action limit; concede and start a fresh one.',409);
  const s=copy(original),p=s.players[seat];s.actions++;
  if(a.type==='concede'){finish(s,opponent(seat),'The game ended by concession.');assertArena(s);return s;}
  if(a.type==='choose'){choose(s,seat,a.choices,rng);assertArena(s);return s;}
  const key=JSON.stringify(Object.entries(a).sort());
  check(legalArenaActions(s,seat).some(m=>JSON.stringify(Object.entries(m.action).sort())===key),'That action is not legal now. Refresh the table.',409);
  if(a.type==='first'){s.first=oneOf(a.seat,[0,1]);log(s,seat,'first',`${s.first===seat?'Chose to go first':'Chose to go second'}.`);ready(s,rng);}
  else if(a.type==='setup'){const c=pop(p.hand,a.card);if(a.zone==='active')p.active=c;else p.bench.push(c);}
  else if(a.type==='reset_setup'){p.hand.push(...field(p));p.active=null;p.bench=[];}
  else if(a.type==='ready'){p.ready=true;mark(s,seat,'setup');if(p.bench.length)mark(s,seat,'bench');log(s,seat,'ready','Locked the opening field.');ready(s,rng);}
  else if(a.type==='bench'){const c=pop(p.hand,a.card);c.entered=p.turns;p.bench.push(c);mark(s,seat,'bench');log(s,seat,'bench',`Benched ${c.card.name}.`,{card:publicCard(c.card)});}
  else if(a.type==='union'){
    const c=find(p,a.card,'discard'),parts=unionParts(p,c.card.union.group).map(u=>pop(p.discard,u.id)),unit=parts.shift();unit.parts=parts;unit.entered=p.turns;p.bench.push(unit);p.unionPlayed.push(canonicalName(unit.card.name));
    log(s,seat,'union',`Assembled ${unit.card.name} from all four discarded pieces.`,{target:unit.id,card:publicCard(unit.card,true)});
  }
  else if(a.type==='discard_fossil'){
    const unit=creature(p,a.card);if(p.active?.id===unit.id)p.active=null;else pop(p.bench,unit.id);discard(s,seat,flat(unit));log(s,seat,'discard_fossil','Discarded the Fossil from play without a Knock Out.');s.phase='resolution';s.queue.push({kind:'settle'});advance(s,rng);
  }
  else if(a.type==='energy'){const c=pop(p.hand,a.card),u=creature(p,a.target);u.energy.push(c);p.energyAttached=true;mark(s,seat,'attach');log(s,seat,'energy',`Attached ${c.card.name} to ${u.card.name}.`,{target:u.id});
    if((u.card.abilities||[]).some(a=>a.kind==='trait'&&a.modifier.extraEnergy)&&p.hand.some(c=>c.card.kind==='energy'))pending(s,{kind:'alpha_energy',seat,target:u.id});}
  else if(a.type==='evolve'){
    const evolution=pop(p.hand,a.card),previous=creature(p,a.target);evolveUnit(s,seat,evolution,previous);
    mark(s,seat,'evolve');log(s,seat,'evolve',`Evolved ${previous.card.name} into ${evolution.card.name}.`,{target:evolution.id,card:publicCard(evolution.card)});
    const mega=evolution.card.stage==='MegaEvolution'&&!toolPrograms(evolution).some(a=>a.spiritLink&&sameName(a.spiritLink,evolution.card.name));
    if(mega||evolution.damage>=effectiveHP(s,evolution)){s.phase='resolution';removeKnockouts(s);if(mega){log(s,seat,'mega_turn_end','Mega Evolution ended the turn.');s.queue.push({kind:'checkup',seat});}advance(s,rng);}
  }else if(a.type==='trainer')startTrainer(s,seat,a.card,a.target,rng);
  else if(a.type==='ability'){
    const unit=creature(p,a.card),ability=unit.card.abilities[a.index];unit.abilityUses??={};unit.abilityUses[a.index]=s.turnNumber;if(ability.power==='vstar')p.vstarUsed=true;log(s,seat,'ability',`${unit.card.name} used ${ability.name}.`,{target:unit.id});
    if(ability.cost)pending(s,{kind:'ability_discard',seat,card:unit.id,index:a.index,count:ability.cost.count,options:p.hand.filter(c=>matches(c.card,ability.cost.filter)).map(c=>c.id)});
    else beginProgram(s,seat,ability.program,{source:unit.id},null,rng);
  }
  else if(a.type==='stadium'){p.stadiumUsed=true;log(s,seat,'stadium',`Used ${s.stadium.unit.card.name}.`);beginProgram(s,seat,s.stadium.unit.card.program.activation,{},null,rng);}
  else if(a.type==='attack')startAttack(s,seat,a.index,rng);
  else if(a.type==='retreat'){
    const n=effectiveRetreat(p.active);if(n)pending(s,{kind:'retreat_discard',seat,target:a.target,count:n,options:p.active.energy.map(c=>c.id)});
    else{swap(p,a.target);p.retreated=true;mark(s,seat,'retreat');log(s,seat,'retreat','Retreated without an Energy cost.');}
  }else if(a.type==='end_turn'){s.phase='resolution';s.queue.push({kind:'checkup',seat});log(s,seat,'end_turn','Ended the turn.');advance(s,rng);}
  assertArena(s);return s;
}
export function publicCard(card,inPlay=false) {
  const {id,name,image_url,set_name,number,kind,type,types,stage,hp,retreat,evolves_from,restored_source,prizes,weakness,resistance,attacks,program,basic_energy,provides,rule_box,abilities,ace_spec,radiant,prism_star,tera,union,fossil}=card;
  if(union&&!inPlay)return copy({id,name,image_url,set_name,number,kind,type,types,union,stage:'V-UNION',rule_box:null});
  return copy({id,name,image_url,set_name,number,kind,type,types,stage,hp,retreat,evolves_from,restored_source,prizes,weakness,resistance,attacks,program,basic_energy,provides,rule_box,abilities,ace_spec,radiant,prism_star,tera,union,fossil});
}
function publicUnit(unit,s=null) {
  const card=publicCard(unit.card,!!unit.parts?.length);
  if(card.attacks)card.attacks=attacksFor(unit).map(a=>({...a,cost:effectiveAttackCost(unit,a),printed_cost:a.cost}));
  return {id:unit.id,card,damage:unit.damage,conditions:{...unit.conditions},energy:unit.energy.map(c=>publicUnit(c)),tools:(unit.tools||[]).map(c=>publicUnit(c)),under:unit.under.map(c=>publicUnit(c)),parts:(unit.parts||[]).map(c=>publicUnit(c)),
    ...(unit.card.kind==='pokemon'&&(!unit.card.union||unit.parts?.length)?{effective_hp:s?effectiveHP(s,unit):unit.card.hp+toolPrograms(unit).reduce((n,a)=>n+(a.hp||0),0),effective_retreat:effectiveRetreat(unit)}:{})};
}
export function arenaView(s,seat) {
  integer(seat,0,1);check(s.version===ARENA_VERSION,'Unsupported engine version.',409);
  const reveal=s.setup_complete===true,players=s.players.map((p,i)=>({
    deck_count:p.deck.length,hand_count:p.hand.length,prize_count:p.prizes.length,hand:i===seat?p.hand.map(c=>publicUnit(c)):[],
    active:p.active?(reveal||i===seat?publicUnit(p.active,s):{hidden:true}):null,
    bench:p.bench.map(c=>reveal||i===seat?publicUnit(c,s):{hidden:true}),discard:p.discard.map(c=>publicUnit(c)),lost_zone:p.lostZone.map(c=>publicUnit(c)),resolving:p.resolving.map(c=>publicUnit(c)),gx_used:p.gxUsed,vstar_used:p.vstarUsed,union_played:[...p.unionPlayed],
    ready:p.ready,mulligan_waiting:s.phase==='setup'&&!p.active&&!p.hand.some(c=>c.card.kind==='pokemon'&&c.card.stage==='Basic'),turns:p.turns,energy_attached:p.energyAttached,supporter_played:p.supporterPlayed,stadium_played:p.stadiumPlayed,stadium_used:p.stadiumUsed,retreated:p.retreated
  }));
  const block=s.phase==='playing'&&s.turn===seat&&s.players[seat].active?attacksFor(s.players[seat].active).map((a,i)=>({name:a.name,reason:attackBlock(s,seat,i)})):[];
  return {version:s.version,game:s.game,mode:s.mode,phase:s.phase,round:s.round,tiebreaker:s.tiebreaker===true,seat,toss:s.toss,first:s.first,turn:s.turn,turn_number:s.turnNumber,
    players,stadium:s.stadium?{seat:s.stadium.seat,unit:publicUnit(s.stadium.unit,s)}:null,result:s.result,result_reason:s.result_reason,progress:{...s.progress},events:copy(s.events),
    legal:legalArenaActions(s,seat),attack_blocks:block,prompt:promptOptions(s,seat),waiting_for:s.pending?.seat??null};
}
export function assertArena(s) {
  check(s?.version===ARENA_VERSION&&Array.isArray(s.players)&&s.players.length===2,'Invalid arena state.',500);
  check(s.prizeGoal===6&&typeof s.tiebreaker==='boolean','Invalid current Prize/tiebreaker rules.',500);
  const ids=new Set(),counts=[0,0];
  for(const [seat,p] of s.players.entries()){
    const visit=u=>{check(u&&typeof u.id==='string'&&!ids.has(u.id),'Duplicate/missing card instance.',500);ids.add(u.id);check(u.owner===0||u.owner===1,'Missing card ownership.',500);counts[u.owner]++;check(u.card?.compiler===ARENA_VERSION,'Unknown card snapshot.',500);for(const c of [...u.energy,...u.under,...(u.parts||[]),...(u.tools||[])])visit(c);};
    for(const u of [...p.deck,...p.hand,...p.prizes,...p.discard,...p.lostZone,...p.resolving,...field(p),...(s.stadium?.seat===seat?[s.stadium.unit]:[])])visit(u);
    check(p.bench.length<=5&&typeof p.gxUsed==='boolean'&&typeof p.vstarUsed==='boolean','Bench or power marker invariant failed.',500);
    for(const u of field(p))check(u.card.kind==='pokemon'&&Number.isInteger(u.damage)&&u.damage>=0&&u.damage%10===0&&(u.tools||[]).length<=1,'Invalid field Pokémon.',500);
  }
  check(counts.every(n=>n===60),'Card conservation failed.',500);
  return true;
}
