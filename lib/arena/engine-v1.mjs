/** Authoritative, serialisable automated Casual Core engine. No database or browser dependency. */
import { randomInt, randomUUID } from 'node:crypto';
import { check, object, integer, oneOf } from './input.mjs';
import { deckValidation } from './cards.mjs';
import { LEGACY_ARENA_VERSION as ARENA_VERSION } from '../../shared/arena.mjs';
export const opponent = seat => seat === 0 ? 1 : 0;
const copy = value => structuredClone(value);
const sameName = (a,b) => String(a).normalize('NFKC').toLowerCase() === String(b).normalize('NFKC').toLowerCase();
const field = p => [p.active,...p.bench].filter(Boolean);
const fieldLabel = (p,u) => `${p.active?.id===u.id?'Active':'Bench '+(p.bench.findIndex(c=>c.id===u.id)+1)} · ${u.card.name}`;
const blankConditions = () => ({special:null,poison:false,burn:false});
function fresh(card) { return {id:randomUUID(),card:copy(card),damage:0,conditions:blankConditions(),energy:[],under:[],entered:0,evolved:0}; }
function rekey(item) { return fresh(item.card); }
function flat(item) { return [item,...item.under.flatMap(flat),...item.energy.flatMap(flat)].map(rekey); }
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
function matches(card,filter) { return filter==='basic'?card.kind==='pokemon'&&card.stage==='Basic':filter==='pokemon'?card.kind==='pokemon':filter==='energy'?card.kind==='energy'&&card.basic_energy:false; }
function finish(s,winner,reason) { s.phase='finished';s.result=winner;s.result_reason=reason;s.pending=null;s.queue=[];log(s,winner==='draw'?null:winner,'result',reason);mark(s,0,'finish'); }
export function energySatisfied(unit,cost) {
  const pool=unit.energy.map(c=>c.card.type);let any=0;
  for(const type of cost){if(type==='Colorless'){any++;continue;}const i=pool.indexOf(type);if(i<0)return false;pool.splice(i,1);}
  return pool.length>=any;
}
export function attackDamage(attack,attacker,defender,rawDamage=attack.damage) {
  if(rawDamage<=0)return 0;
  let damage=rawDamage;
  for(const w of defender.card.weakness||[])if(w.type===attacker.card.type)damage=w.value==='x2'?damage*2:damage+Number(w.value);
  for(const r of defender.card.resistance||[])if(r.type===attacker.card.type)damage+=Number(r.value);
  return Math.max(0,damage);
}
function newPlayer(rows,rng,mode,seat) {
  const all=rows.flatMap(r=>Array.from({length:r.quantity},()=>fresh(r.card))),deck=shuffled(all,rng);
  if(mode==='tutorial') {
    // A disclosed, scripted opening only in the training scenario. PvP/practice are never stacked.
    const kinds=seat===0?['basic','basic','energy','trainer-draw','energy','evolution','trainer-search']:['basic','basic','energy','energy','trainer-draw','energy','energy'];
    const opening=[];
    for(const kind of kinds){const index=deck.findIndex(x=>kind==='basic'?x.card.kind==='pokemon'&&x.card.stage==='Basic':kind==='evolution'?x.card.kind==='pokemon'&&x.card.stage!=='Basic':kind==='energy'?x.card.kind==='energy':x.card.kind==='trainer'&&x.card.program.kind===(kind==='trainer-draw'?'draw':'search'));if(index>=0)opening.push(...deck.splice(index,1));}
    deck.unshift(...opening);
  }
  return {deck,hand:[],prizes:[],active:null,bench:[],discard:[],resolving:[],ready:false,mulligans:0,bonus:0,turns:0,energyAttached:false,supporterPlayed:false,retreated:false};
}
export function newArena(decks,{mode='pvp',rng=randomInt,round=1,prizes=6}={}) {
  check(['pvp','practice','tutorial'].includes(mode),'Unknown game mode.');
  check(Array.isArray(decks)&&decks.length===2,'Two decks are required.');
  for(const rows of decks)check(deckValidation(rows,ARENA_VERSION).playable,'A supported 60-card deck with a Basic Pokémon is required.');
  check(decks.length===2,'Two decks are required.');
  const s={version:ARENA_VERSION,game:'pokemon',mode,phase:'setup',setup_complete:false,round,prizeGoal:prizes,first:null,turn:null,turnNumber:0,
    players:decks.map((rows,i)=>newPlayer(rows,rng,mode,i)),originalDecks:copy(decks),toss:mode==='tutorial'?0:integer(rng(2),0,1),
    pending:null,queue:[],event:0,events:[],actions:0,result:null,result_reason:'',progress:{},bonusDone:[false,false]};
  for(let seat=0;seat<2;seat++) {
    const p=s.players[seat];draw(p,7);
    while(!p.hand.some(c=>c.card.kind==='pokemon'&&c.card.stage==='Basic')){
      check(p.mulligans<80,'Unable to deal a Basic Pokémon within the safety limit. Start a fresh match.',409);
      log(s,seat,'mulligan','Revealed a no-Basic hand and automatically reshuffled.',{revealed:p.hand.map(c=>publicCard(c.card))});
      p.deck=shuffled([...p.deck,...p.hand].map(rekey),rng);p.hand=[];draw(p,7);p.mulligans++;
    }
  }
  log(s,s.toss,'setup','Won the starting toss. Both players prepare their fields privately.');assertArena(s);return s;
}
function startTurn(s,seat) {
  s.phase='playing';s.turn=seat;s.turnNumber++;const p=s.players[seat];p.turns++;p.energyAttached=false;p.supporterPlayed=false;p.retreated=false;
  if(!p.deck.length){finish(s,opponent(seat),'The opponent could not draw a card at the start of their turn.');return;}
  draw(p,1);log(s,seat,'turn','Turn started. Drew one card privately.',{turn:s.turnNumber});mark(s,seat,'start');
}
function ready(s,rng) {
  if(!s.players.every(p=>p.ready)||s.first===null)return;
  for(let seat=0;seat<2;seat++){const p=s.players[seat];p.prizes=p.deck.splice(0,s.prizeGoal).map(rekey);p.bonus=Math.max(0,s.players[opponent(seat)].mulligans-p.mulligans);if(p.bonus)s.queue.push({kind:'bonus',seat,max:p.bonus});}
  s.setup_complete=true;log(s,null,'reveal','Both opening fields are revealed. Prize cards remain face down.');
  s.phase='resolution';s.queue.push({kind:'begin',seat:s.first});advance(s,rng);
}
function setCondition(unit,condition) {
  if(condition==='poisoned')unit.conditions.poison=true;
  else if(condition==='burned')unit.conditions.burn=true;
  else unit.conditions.special=condition;
}
function removeKnockouts(s) {
  const awards=[0,0];
  for(let seat=0;seat<2;seat++){
    const p=s.players[seat];for(const unit of field(p))if(unit.damage>=unit.card.hp){
      if(p.active?.id===unit.id)p.active=null;else pop(p.bench,unit.id);
      p.discard.push(...flat(unit));awards[opponent(seat)]+=unit.card.prizes||1;
      log(s,seat,'knockout',`${unit.card.name} was Knocked Out.`,{card:publicCard(unit.card)});
    }
  }
  for(let seat=0;seat<2;seat++)if(awards[seat])s.queue.push({kind:'prize',seat,count:Math.min(awards[seat],s.players[seat].prizes.length)});
  s.queue.push({kind:'settle'});
}
function settle(s,rng) {
  const wins=s.players.map((p,i)=>Number(p.prizes.length===0)+Number(field(s.players[opponent(i)]).length===0));
  if(wins[0]||wins[1]){
    if(wins[0]===wins[1]){
      // Equal simultaneous win conditions use a one-Prize sudden-death game, not an arbitrary winner.
      const replacement=newArena(s.originalDecks,{mode:s.mode,rng,round:s.round+1,prizes:1});
      replacement.progress={...s.progress};replacement.actions=s.actions;replacement.event=s.event;replacement.events=s.events;
      Object.assign(s,replacement);log(s,null,'sudden_death','Both players met the same number of win conditions. A one-Prize sudden-death game begins.');
    }else finish(s,wins[0]>wins[1]?0:1,'Won by taking all Prize cards or leaving the opponent without a Pokémon in play.');
    return;
  }
  // Replacement choices precede the queued continuation; only public field choices are exposed.
  const order=[s.turn??0,opponent(s.turn??0)];
  for(const seat of order.reverse())if(!s.players[seat].active)s.queue.unshift({kind:'promote',seat});
}
function checkup(s,ending,rng) {
  for(let seat=0;seat<2;seat++){
    const u=s.players[seat].active;if(!u)continue;
    if(u.conditions.poison){u.damage+=10;log(s,seat,'condition','Poison placed 10 damage.',{target:u.id,damage:10});}
    if(u.conditions.burn){u.damage+=20;log(s,seat,'condition','Burn placed 20 damage.',{target:u.id,damage:20});if(coin(s,seat,'Burn recovery',rng))u.conditions.burn=false;}
    if(u.conditions.special==='asleep'&&coin(s,seat,'Sleep recovery',rng))u.conditions.special=null;
    if(seat===ending&&u.conditions.special==='paralyzed')u.conditions.special=null;
  }
  removeKnockouts(s);s.queue.push({kind:'begin',seat:opponent(ending)});
}
function pending(s,prompt) { s.pending=prompt;s.phase='resolution'; }
function advance(s,rng) {
  while(!s.pending&&s.queue.length&&s.phase!=='finished'){
    const step=s.queue.shift();
    if(step.kind==='begin')startTurn(s,step.seat);
    else if(step.kind==='checkup')checkup(s,step.seat,rng);
    else if(step.kind==='settle'){const round=s.round;settle(s,rng);if(s.round!==round)return;}
    else if(step.kind==='prize'){if(step.count>0)pending(s,step);}
    else if(step.kind==='promote'){if(!s.players[step.seat].active)pending(s,step);}
    else if(step.kind==='bonus')pending(s,step);
    else if(step.kind==='discard_trainer'){
      const p=s.players[step.seat],c=pop(p.resolving,step.card);p.discard.push(rekey(c));
    }
    else throw Error('Unknown arena continuation.');
  }
  if(!s.pending&&!s.queue.length&&s.phase==='resolution')s.phase='playing';
}
function finishAttack(s,seat,rng) { removeKnockouts(s);s.queue.push({kind:'checkup',seat});s.phase='resolution';advance(s,rng); }
function resolveAttack(s,seat,index,rng) {
  const p=s.players[seat],u=p.active,d=s.players[opponent(seat)].active,attack=u.card.attacks[index];
  let amount=attack.damage;
  for(const effect of attack.effects){
    if(effect.kind==='coin_gate'&&!coin(s,seat,attack.name,rng)){log(s,seat,'attack_miss','The attack did nothing.');finishAttack(s,seat,rng);return;}
    if(effect.kind==='coin_damage'){amount=0;for(let i=0;i<effect.coins;i++)if(coin(s,seat,attack.name,rng))amount+=effect.per;}
    if(effect.kind==='coin_bonus'&&coin(s,seat,attack.name,rng))amount+=effect.amount;
  }
  const damage=attackDamage(attack,u,d,amount);d.damage+=damage;
  log(s,seat,'attack',`${u.card.name} used ${attack.name} for ${damage} damage.`,{attacker:u.id,target:d.id,damage,attack:attack.name});mark(s,seat,'attack');
  for(const effect of attack.effects){
    if(effect.kind==='condition')setCondition(d,effect.condition);
    else if(effect.kind==='coin_condition'&&coin(s,seat,'Special Condition',rng))setCondition(d,effect.condition);
    else if(effect.kind==='recoil'){u.damage+=effect.amount;log(s,seat,'recoil',`Recoil placed ${effect.amount} damage.`,{target:u.id,damage:effect.amount});}
    else if(effect.kind==='heal_self'){u.damage=Math.max(0,u.damage-effect.amount);}
    else if(effect.kind==='draw'){const n=draw(p,effect.count);log(s,seat,'draw',`The attack drew ${n} card(s) privately.`);}
  }
  finishAttack(s,seat,rng);
}
function startAttack(s,seat,index,rng) {
  const u=s.players[seat].active,attack=u.card.attacks[index];
  if(u.conditions.special==='confused'&&!coin(s,seat,'Confusion',rng)){
    u.damage+=30;log(s,seat,'confusion','The attack failed; Confusion placed 30 damage.',{target:u.id,damage:30});mark(s,seat,'attack');finishAttack(s,seat,rng);return;
  }
  const effect=attack.effects.find(e=>e.kind==='discard_energy');
  if(effect){const available=u.energy.filter(e=>!effect.type||e.card.type===effect.type),n=Math.min(available.length,effect.count);
    if(n){pending(s,{kind:'attack_discard',seat,attack:index,count:n,options:available.map(c=>c.id)});return;}}
  resolveAttack(s,seat,index,rng);
}
function trainerTargets(p,op,program) {
  if(program.kind==='heal')return field(p).filter(c=>c.damage>0).map(c=>c.id);
  if(program.kind==='switch')return p.active?p.bench.map(c=>c.id):[];
  if(program.kind==='gust')return op.active?op.bench.map(c=>c.id):[];
  if(program.kind==='draw'&&!p.deck.length)return [];
  if(program.kind==='discard_draw'&&!p.deck.length)return [];
  if(program.kind==='shuffle_draw'&&!p.deck.length&&p.hand.length<=1)return [];
  if(program.kind==='search'&&!p.deck.length)return [];
  if(program.kind==='recover'&&!p.discard.some(c=>matches(c.card,program.filter)))return [];
  return [null];
}
function swap(p,id){const next=pop(p.bench,id),old=p.active;check(old,'There is no Active Pokémon.');old.conditions=blankConditions();p.active=next;p.bench.push(old);}
function resolveTrainer(s,seat,cardId,target,rng) {
  const p=s.players[seat],op=s.players[opponent(seat)],card=find(p,cardId,'resolving'),a=card.card.program;
  if(a.kind==='draw'){log(s,seat,'draw',`Drew ${draw(p,a.count)} card(s) privately.`);}
  else if(a.kind==='discard_draw'){p.discard.push(...p.hand.map(rekey));p.hand=[];log(s,seat,'draw',`Discarded the hand and drew ${draw(p,a.count)} card(s) privately.`);}
  else if(a.kind==='shuffle_draw'){p.deck=shuffled([...p.deck,...p.hand].map(rekey),rng);p.hand=[];log(s,seat,'draw',`Shuffled the hand into the deck and drew ${draw(p,a.count)} card(s) privately.`);}
  else if(a.kind==='heal'){const u=creature(p,target);u.damage=Math.max(0,u.damage-a.amount);log(s,seat,'heal',`Healed ${u.card.name}.`,{target:u.id});}
  else if(a.kind==='switch'){swap(p,target);log(s,seat,'switch','Switched the Active and Benched Pokémon.');}
  else if(a.kind==='gust'){swap(op,target);log(s,seat,'switch',"Switched the opponent's Active and Benched Pokémon.");}
  else if(a.kind==='search'){
    pending(s,{kind:'search',seat,card:cardId,max:a.count,filter:a.filter});return;
  }else if(a.kind==='recover'){
    const n=p.discard.filter(x=>matches(x.card,a.filter)).length;
    if(n){pending(s,{kind:'recover',seat,card:cardId,max:Math.min(n,a.count),min:a.optional?0:Math.min(n,a.count),filter:a.filter});return;}
  }else throw Error('Unimplemented Trainer program.');
  p.discard.push(rekey(pop(p.resolving,cardId)));s.phase='playing';
}
function startTrainer(s,seat,id,target,rng) {
  const p=s.players[seat],card=pop(p.hand,id),a=card.card.program;p.resolving.push(card);
  if(a.trainerType==='Supporter')p.supporterPlayed=true;
  log(s,seat,'trainer',`Played ${card.card.name}.`,{card:publicCard(card.card)});mark(s,seat,'trainer');
  if(a.discard){pending(s,{kind:'trainer_discard',seat,card:id,count:a.discard,target,options:p.hand.map(c=>c.id)});return;}
  resolveTrainer(s,seat,id,target,rng);
}
function attackBlock(s,seat,index) {
  const p=s.players[seat],u=p.active,attack=u?.card.attacks?.[index];
  if(!attack)return 'Attack unavailable.';
  if(s.turnNumber===1)return 'The first player cannot attack on the opening turn.';
  if(['asleep','paralyzed'].includes(u.conditions.special))return `Cannot attack while ${u.conditions.special}.`;
  if(!energySatisfied(u,attack.cost))return 'Not enough matching Energy.';
  if(!s.players[opponent(seat)].active)return 'Wait for an opponent Active Pokémon.';
  return '';
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
      if(p.active&&s.first!==null)add('Ready — reveal field',{type:'ready'});
      if(p.active||p.bench.length)add('Reset opening field',{type:'reset_setup'});
    }
    return moves;
  }
  if(s.phase!=='playing'||s.turn!==seat)return moves;
  for(const c of p.hand){
    if(c.card.kind==='pokemon'){
      if(c.card.stage==='Basic'&&p.bench.length<5)add('Play to Bench',{type:'bench',card:c.id},c.id);
      if(c.card.stage!=='Basic'&&p.turns>1)for(const target of field(p))if(sameName(c.card.evolves_from,target.card.name)&&
        (c.card.stage==='Stage1'&&target.card.stage==='Basic'||c.card.stage==='Stage2'&&target.card.stage==='Stage1')&&target.entered<p.turns&&target.evolved<p.turns)
        add(`Evolve ${fieldLabel(p,target)}`,{type:'evolve',card:c.id,target:target.id},c.id,target.id);
    }
    if(c.card.kind==='energy'&&!p.energyAttached)for(const target of field(p))add(`Attach to ${fieldLabel(p,target)}`,{type:'energy',card:c.id,target:target.id},c.id,target.id);
    if(c.card.kind==='trainer'){
      const a=c.card.program;if(a.trainerType==='Supporter'&&(p.supporterPlayed||s.turnNumber===1))continue;
      if(a.discard&&p.hand.length-1<a.discard)continue;
      for(const target of trainerTargets(p,op,a))add(target?`Use on ${fieldLabel(a.kind==='gust'?op:p,field(p).concat(field(op)).find(x=>x.id===target))}`:'Play Trainer',
        {type:'trainer',card:c.id,...(target?{target}:{})},c.id,target);
    }
  }
  if(p.active){
    for(let i=0;i<p.active.card.attacks.length;i++)if(!attackBlock(s,seat,i))add(`Attack: ${p.active.card.attacks[i].name}`,{type:'attack',index:i},p.active.id,op.active?.id);
    if(!p.retreated&&!['asleep','paralyzed'].includes(p.active.conditions.special)&&p.active.energy.length>=p.active.card.retreat)
      for(const target of p.bench)add(`Retreat to ${fieldLabel(p,target)}`,{type:'retreat',target:target.id},p.active.id,target.id);
  }
  add('End turn',{type:'end_turn'});return moves;
}
function promptOptions(s,seat) {
  const a=s.pending;if(!a||a.seat!==seat)return null;const p=s.players[seat];
  let options=[],min=1,max=1,title='Choose a card',kind=a.kind;
  if(kind==='prize'){title=`Choose ${a.count} Prize card${a.count===1?'':'s'}`;options=p.prizes.map((_,i)=>({id:String(i),label:`Prize ${i+1}`,hidden:true}));min=max=a.count;}
  else if(kind==='promote'){title='Choose your new Active Pokémon';options=p.bench.map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)}));}
  else if(kind==='bonus'){title='Choose how many mulligan bonus cards to draw';options=Array.from({length:Math.min(a.max, p.deck.length)+1},(_,i)=>({id:String(i),label:String(i)}));}
  else if(['attack_discard','retreat_discard'].includes(kind)){title='Choose Energy to discard';options=p.active.energy.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)}));min=max=a.count;}
  else if(kind==='trainer_discard'){title='Choose cards to discard for this Trainer';options=p.hand.filter(c=>a.options.includes(c.id)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)}));min=max=a.count;}
  else if(kind==='search'||kind==='recover'){
    title=kind==='search'?'Search your deck — reveal selected cards, then shuffle':'Recover from your discard pile';
    options=p[kind==='search'?'deck':'discard'].filter(c=>matches(c.card,a.filter)).map(c=>({id:c.id,label:c.card.name,card:publicUnit(c)})).sort((x,y)=>x.label.localeCompare(y.label)||x.id.localeCompare(y.id));
    min=kind==='search'?0:a.min;max=Math.min(a.max,options.length);
  }else throw Error('Unknown decision type.');
  return {kind,title,min,max,options};
}
function choose(s,seat,ids,rng) {
  const a=s.pending;check(a?.seat===seat,'Wait for the other player to finish choosing.',409);
  const prompt=promptOptions(s,seat);check(Array.isArray(ids)&&new Set(ids).size===ids.length&&ids.length>=prompt.min&&ids.length<=prompt.max&&ids.every(id=>typeof id==='string'&&prompt.options.some(o=>o.id===id)), 'Choose the required number of valid cards.');
  const p=s.players[seat];s.pending=null;
  if(a.kind==='prize'){
    const picked=ids.map(Number).sort((x,y)=>y-x);for(const i of picked)p.hand.push(rekey(p.prizes.splice(i,1)[0]));
    log(s,seat,'prize',`Took ${picked.length} Prize card(s) privately.`);mark(s,seat,'prize');advance(s,rng);
  }else if(a.kind==='promote'){p.active=pop(p.bench,ids[0]);log(s,seat,'promote',`Promoted ${p.active.card.name}.`);advance(s,rng);}
  else if(a.kind==='bonus'){const n=draw(p,Number(ids[0]));p.bonus=0;log(s,seat,'draw',`Drew ${n} mulligan bonus card(s).`);advance(s,rng);}
  else if(a.kind==='attack_discard'){for(const id of ids)p.discard.push(rekey(pop(p.active.energy,id)));resolveAttack(s,seat,a.attack,rng);}
  else if(a.kind==='retreat_discard'){for(const id of ids)p.discard.push(rekey(pop(p.active.energy,id)));swap(p,a.target);p.retreated=true;s.phase='playing';mark(s,seat,'retreat');log(s,seat,'retreat','Paid retreat cost and switched the Active Pokémon.');}
  else if(a.kind==='trainer_discard'){for(const id of ids)p.discard.push(rekey(pop(p.hand,id)));resolveTrainer(s,seat,a.card,a.target,rng);}
  else if(a.kind==='search'||a.kind==='recover'){
    const zone=a.kind==='search'?'deck':'discard',cards=ids.map(id=>pop(p[zone],id));p.hand.push(...cards.map(rekey));
    log(s,seat,a.kind,`Selected ${cards.length} card(s).`,{revealed:cards.map(c=>publicCard(c.card))});
    if(a.kind==='search'){p.deck=shuffled(p.deck.map(rekey),rng);log(s,seat,'shuffle','Finished searching and shuffled the deck.');}
    p.discard.push(rekey(pop(p.resolving,a.card)));s.phase='playing';
  }
}
export function applyArenaAction(original,seat,value,{rng=randomInt}={}) {
  check(original?.version===ARENA_VERSION,'This match needs its original engine version.',409);integer(seat,0,1);
  check(original.phase!=='finished','This match has finished.',409);
  const a=object(value,['type','card','target','index','zone','seat','choices']);
  const fields={concede:[],first:['seat'],setup:['card','zone'],ready:[],reset_setup:[],bench:['card'],energy:['card','target'],evolve:['card','target'],trainer:['card','target'],attack:['index'],retreat:['target'],end_turn:[],choose:['choices']};
  check(Object.hasOwn(fields,a.type)&&Object.keys(a).every(k=>k==='type'||fields[a.type].includes(k)),'Unsupported action.');
  check(original.actions<4000||a.type==='concede','This match reached its safety action limit; concede and start a fresh one.',409);
  const s=copy(original),p=s.players[seat];s.actions++;
  if(a.type==='concede'){finish(s,opponent(seat),'The opponent conceded.');assertArena(s);return s;}
  if(a.type==='choose'){choose(s,seat,a.choices,rng);assertArena(s);return s;}
  const key=JSON.stringify(Object.entries(a).sort());
  check(legalArenaActions(s,seat).some(m=>JSON.stringify(Object.entries(m.action).sort())===key),'That action is not legal now. Refresh the table.',409);
  if(a.type==='first'){s.first=oneOf(a.seat,[0,1]);log(s,seat,'first',`${s.first===seat?'Chose to go first':'Chose to go second'}.`);ready(s,rng);}
  else if(a.type==='setup'){const c=pop(p.hand,a.card);if(a.zone==='active')p.active=c;else p.bench.push(c);}
  else if(a.type==='reset_setup'){p.hand.push(...field(p));p.active=null;p.bench=[];}
  else if(a.type==='ready'){p.ready=true;mark(s,seat,'setup');if(p.bench.length)mark(s,seat,'bench');log(s,seat,'ready','Locked the opening field.');ready(s,rng);}
  else if(a.type==='bench'){const c=pop(p.hand,a.card);c.entered=p.turns;p.bench.push(c);mark(s,seat,'bench');log(s,seat,'bench',`Benched ${c.card.name}.`,{card:publicCard(c.card)});}
  else if(a.type==='energy'){const c=pop(p.hand,a.card),u=creature(p,a.target);u.energy.push(c);p.energyAttached=true;mark(s,seat,'attach');log(s,seat,'energy',`Attached ${c.card.name} to ${u.card.name}.`,{target:u.id});}
  else if(a.type==='evolve'){
    const evolution=pop(p.hand,a.card),previous=creature(p,a.target);evolution.energy=previous.energy;evolution.under=[...previous.under,{...previous,energy:[],under:[]}];
    evolution.damage=previous.damage;evolution.entered=previous.entered;evolution.evolved=p.turns;evolution.conditions=blankConditions();
    if(p.active?.id===previous.id)p.active=evolution;else p.bench[p.bench.findIndex(c=>c.id===previous.id)]=evolution;
    mark(s,seat,'evolve');log(s,seat,'evolve',`Evolved ${previous.card.name} into ${evolution.card.name}.`,{target:evolution.id,card:publicCard(evolution.card)});
    if(evolution.damage>=evolution.card.hp){s.phase='resolution';removeKnockouts(s);advance(s,rng);}
  }else if(a.type==='trainer')startTrainer(s,seat,a.card,a.target,rng);
  else if(a.type==='attack')startAttack(s,seat,a.index,rng);
  else if(a.type==='retreat'){
    const n=p.active.card.retreat;if(n)pending(s,{kind:'retreat_discard',seat,target:a.target,count:n,options:p.active.energy.map(c=>c.id)});
    else{swap(p,a.target);p.retreated=true;mark(s,seat,'retreat');log(s,seat,'retreat','Retreated without an Energy cost.');}
  }else if(a.type==='end_turn'){s.phase='resolution';s.queue.push({kind:'checkup',seat});log(s,seat,'end_turn','Ended the turn.');advance(s,rng);}
  assertArena(s);return s;
}
export function publicCard(card) {
  const {id,name,image_url,set_name,number,kind,type,stage,hp,retreat,evolves_from,prizes,weakness,resistance,attacks,program,basic_energy}=card;
  return copy({id,name,image_url,set_name,number,kind,type,stage,hp,retreat,evolves_from,prizes,weakness,resistance,attacks,program,basic_energy});
}
function publicUnit(unit) { return {id:unit.id,card:publicCard(unit.card),damage:unit.damage,conditions:{...unit.conditions},energy:unit.energy.map(publicUnit),under:unit.under.map(publicUnit)}; }
export function arenaView(s,seat) {
  integer(seat,0,1);check(s.version===ARENA_VERSION,'Unsupported engine version.',409);
  const reveal=s.setup_complete===true,players=s.players.map((p,i)=>({
    deck_count:p.deck.length,hand_count:p.hand.length,prize_count:p.prizes.length,hand:i===seat?p.hand.map(publicUnit):[],
    active:p.active?(reveal||i===seat?publicUnit(p.active):{hidden:true}):null,
    bench:p.bench.map(c=>reveal||i===seat?publicUnit(c):{hidden:true}),discard:p.discard.map(publicUnit),resolving:p.resolving.map(publicUnit),
    ready:p.ready,turns:p.turns,energy_attached:p.energyAttached,supporter_played:p.supporterPlayed,retreated:p.retreated
  }));
  const block=s.phase==='playing'&&s.turn===seat&&s.players[seat].active?s.players[seat].active.card.attacks.map((a,i)=>({name:a.name,reason:attackBlock(s,seat,i)})):[];
  return {version:s.version,game:s.game,mode:s.mode,phase:s.phase,round:s.round,seat,toss:s.toss,first:s.first,turn:s.turn,turn_number:s.turnNumber,
    players,result:s.result,result_reason:s.result_reason,progress:{...s.progress},events:copy(s.events),
    legal:legalArenaActions(s,seat),attack_blocks:block,prompt:promptOptions(s,seat),waiting_for:s.pending?.seat??null};
}
export function assertArena(s) {
  check(s?.version===ARENA_VERSION&&Array.isArray(s.players)&&s.players.length===2,'Invalid arena state.',500);
  const ids=new Set();
  for(const p of s.players){let n=0;
    const visit=u=>{check(u&&typeof u.id==='string'&&!ids.has(u.id),'Duplicate/missing card instance.',500);ids.add(u.id);n++;check(u.card?.compiler===ARENA_VERSION,'Unknown card snapshot.',500);for(const c of [...u.energy,...u.under])visit(c);};
    for(const u of [...p.deck,...p.hand,...p.prizes,...p.discard,...p.resolving,...field(p)])visit(u);
    check(n===60&&p.bench.length<=5,'Card conservation or Bench limit failed.',500);
    for(const u of field(p))check(u.card.kind==='pokemon'&&Number.isInteger(u.damage)&&u.damage>=0&&u.damage%10===0,'Invalid field Pokémon.',500);
  }
  return true;
}
