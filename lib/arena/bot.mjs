/** Rule-based CPU: input is a redacted player view, never the opponent hand or deck order. */
import { randomInt } from 'node:crypto';
import { arenaView, applyArenaAction, energySatisfied, attackDamage } from './engine.mjs';
const units=p=>[p.active,...p.bench].filter(x=>x&&!x.hidden);
const find=(p,id)=>[...p.hand,...units(p)].find(c=>c.id===id);
function strength(u){return (u?.card.hp||0)-(u?.damage||0)+Math.max(0,...(u?.card.attacks||[]).map(a=>a.damage))*0.6;}
function energyValue(c,p){
  if(c.card.kind!=='energy')return 8;
  return units(p).some(u=>u.card.attacks.some(a=>a.cost.includes(c.card.type)))?30:3;
}
// Keep saved Core v1 matches on their original decision policy.
function cpuActionV1(view,{difficulty='normal',rng=randomInt}={}) {
  const seat=view.seat,p=view.players[seat],op=view.players[seat===0?1:0];
  if(view.phase==='finished')return null;
  if(view.prompt){
    const q=view.prompt;let opts=[...q.options];
    if(q.kind==='prize')opts=opts.map(o=>({...o,score:rng(10000)})).sort((a,b)=>b.score-a.score);
    else if(q.kind==='bonus')return {type:'choose',choices:[opts.at(-1).id]};
    else if(q.kind==='promote')opts.sort((a,b)=>strength(b.card)-strength(a.card));
    else if(q.kind==='search')opts.sort((a,b)=>strength(b.card)-strength(a.card));
    else if(q.kind==='trainer_discard')opts.sort((a,b)=>energyValue(a.card,p)-energyValue(b.card,p));
    else if(['attack_discard','retreat_discard'].includes(q.kind))opts.sort((a,b)=>{
      const need=type=>p.active?.card.attacks.some(x=>x.cost.includes(type))?1:0;return need(a.card.card.type)-need(b.card.card.type);
    });
    const n=q.kind==='search'||q.kind==='recover'?q.max:q.min;
    return {type:'choose',choices:opts.slice(0,n).map(o=>o.id)};
  }
  if(!view.legal.length)return null;
  const scored=view.legal.map(m=>{
    const a=m.action,c=find(p,a.card),target=units(p).find(u=>u.id===a.target);let score=0;
    if(a.type==='first')score=a.seat===seat?2:4;
    if(a.type==='setup')score=(a.zone==='active'?100:65)+strength(c)/10;
    if(a.type==='ready')score=10;
    if(a.type==='reset_setup')score=-1000;
    if(a.type==='bench')score=p.bench.length<3?60+strength(c)/20:15;
    if(a.type==='evolve')score=75+((c?.card.hp||0)-(target?.card.hp||0))/10;
    if(a.type==='energy'){
      const now=target?.card.attacks.some(at=>energySatisfied(target,at.cost));
      const prospective={...target,energy:[...(target?.energy||[]),c]};
      const useful=target?.card.attacks.some(at=>at.cost.includes(c.card.type)||at.cost.includes('Colorless'));
      const unlock=target?.card.attacks.some(at=>energySatisfied(prospective,at.cost)&&!energySatisfied(target,at.cost));
      score=35+(useful?20:-20)+(unlock?30:0)+(target?.id===p.active?.id?15:0)-(now?12:0);
    }
    if(a.type==='trainer'){
      const program=c?.card.program;
      if(program.kind==='heal')score=target?.damage>=20?100:12;
      else if(['draw','discard_draw','shuffle_draw'].includes(program.kind))score=program.kind==='draw'?65:p.hand.length<=3?60:5;
      else if(program.kind==='search')score=p.bench.length<3?70:20;
      else if(program.kind==='recover')score=55;
      else if(program.kind==='switch')score=p.active?.conditions.special||p.active?.damage>=(p.active?.card.hp||0)-30?85:-20;
      else if(program.kind==='gust')score=35;
    }
    if(a.type==='attack'){
      const attack=p.active.card.attacks[a.index],damage=attackDamage(attack,p.active,op.active);
      score=45+damage/3+(damage>=(op.active.card.hp-op.active.damage)?100:0)+attack.effects.filter(e=>e.kind==='condition').length*8;
      if(p.active.conditions.special==='confused')score-=20;
    }
    if(a.type==='retreat')score=(p.active.conditions.special==='confused'||p.active.damage>=p.active.card.hp-30)&&strength(target)>strength(p.active)?80:-30;
    if(a.type==='end_turn')score=-50;
    return {action:a,score:score+(difficulty==='easy'?rng(30):rng(3))};
  }).sort((a,b)=>b.score-a.score);
  return scored[0]?.action||null;
}
const hp = unit => unit?.effective_hp ?? unit?.card.hp ?? 0;
const remaining = unit => hp(unit) - (unit?.damage || 0);
const armed = unit => (unit?.card.attacks || []).some(attack => energySatisfied(unit,attack.cost));
const battleValue = unit => remaining(unit) + (armed(unit)?50:0) + Math.max(0,...(unit?.card.attacks || []).map(attack=>attack.damage))*0.6;
const sameName = (a,b) => String(a).normalize('NFKC').toLowerCase()===String(b).normalize('NFKC').toLowerCase();
function cardValue(unit,p) {
  const card=unit?.card;
  if(!card)return 0;
  if(card.kind==='energy')return units(p).some(u=>(u.card.attacks || []).some(a=>a.cost.includes(card.type)))?45:8;
  if(card.kind==='pokemon') {
    const evolution=units(p).some(u=>sameName(card.evolves_from,u.card.name));
    return (card.stage==='Basic'&&p.bench.length<5?55:15)+(evolution?55:0)+battleValue(unit)/10;
  }
  const program=card.program;
  return program?.kind==='tool'?35:['draw','draw_until','search','sequence'].includes(program?.kind)?45:20;
}
function toolFits(unit,filter) {
  return !filter || filter==='basic'&&unit.card.stage==='Basic' || filter==='evolved'&&['Stage1','Stage2'].includes(unit.card.stage) || unit.card.rule_box===filter;
}
function healingValue(program,p) {
  return units(p).filter(u=>!program.types || program.types.includes(u.card.type)).reduce((sum,u)=>sum+Math.min(u.damage,program.amount),0);
}
function programValue(program,{p,op,target,source,view}) {
  if(!program)return -100;
  const active=p.active;
  if(program.kind==='sequence')return program.steps.reduce((sum,step)=>sum+Math.max(0,programValue(step,{p,op,target,source,view})),0);
  if(program.kind==='draw')return p.deck_count>0?70+Math.min(program.count,p.deck_count)*3:-100;
  if(program.kind==='draw_until')return p.deck_count>0&&p.hand.length<program.count?70+(program.count-p.hand.length)*3:-100;
  if(['discard_draw','shuffle_draw'].includes(program.kind))return p.hand.length<program.count?65:5;
  if(program.kind==='heal_self')return source?.damage>0?65+Math.min(source.damage,program.amount):-100;
  if(program.kind==='heal_all'){const value=healingValue(program,p);return value>0?65+value:-100;}
  if(program.kind==='heal'){
    const value=target?Math.min(target.damage,program.amount):Math.max(0,...units(p).map(u=>Math.min(u.damage,program.amount)));
    return value>0?60+value:0;
  }
  if(program.kind==='damage')return op.active?80+program.amount+(program.amount>=remaining(op.active)?120:0):-100;
  if(program.kind==='search')return p.deck_count>0?(p.bench.length<3?72:45):-100;
  if(program.kind==='recover')return p.discard.length?55:-100;
  if(program.kind==='discard_tools') {
    const count=player=>units(player).reduce((sum,unit)=>sum+(unit.tools?.length||0),0);
    const enemy=program.side==='own'?0:count(op),own=['own','both'].includes(program.side)?count(p):0;
    return enemy>own?65+(enemy-own)*10:-20;
  }
  if(program.kind==='switch')return active&&(active.conditions.special||active.conditions.poison||active.conditions.burn||remaining(active)<=30)?85:target&&armed(target)&&!armed(active)?75:-20;
  if(program.kind==='gust')return target&&remaining(target)<remaining(op.active)?55:25;
  if(program.kind==='tool') {
    if(!target)return -100;
    if(!toolFits(target,program.filter))return -20;
    let value=20+(target.id===active?.id?20:0);
    if(program.hp)value+=program.hp/2;
    if(program.damage)value+=program.damage+(armed(target)?20:0);
    if(program.retreat!==undefined)value+=(target.id===active?.id?10:0);
    if(program.spiritLink)value+=p.hand.some(u=>sameName(u.card.name,program.spiritLink))?80:0;
    return value;
  }
  if(program.kind==='stadium') {
    const current=view.stadium?.unit.card.program.modifiers,modifier=program.modifiers;
    // Losing a Stadium's HP bonus can cause an immediate Knock Out.
    if(current?.hp&&units(p).some(u=>toolFits(u,current.filter)&&remaining(u)-current.hp+(modifier?.hp&&toolFits(u,modifier.filter)?modifier.hp:0)<=0))return -100;
    if(program.activation){const value=healingValue(program.activation,p);return value>0?55+value:5;}
    if(modifier?.hp){
      const ours=units(p).filter(u=>toolFits(u,modifier.filter)).length;
      const theirs=units(op).filter(u=>toolFits(u,modifier.filter)).length;
      return 30+(ours-theirs)*modifier.hp;
    }
  }
  return 0;
}
function expandedChoice(view,p,op,rng) {
  const q=view.prompt;
  let options=[...q.options];
  if(q.kind==='prize')options=options.map(option=>({...option,score:rng(10000)})).sort((a,b)=>b.score-a.score);
  else if(q.kind==='bonus')options.reverse();
  else if(q.kind==='promote')options.sort((a,b)=>battleValue(b.card)-battleValue(a.card));
  else if(['search','recover'].includes(q.kind))options.sort((a,b)=>cardValue(b.card,p)-cardValue(a.card,p));
  else if(q.kind==='trainer_discard')options.sort((a,b)=>cardValue(a.card,p)-cardValue(b.card,p));
  else if(['attack_discard','retreat_discard'].includes(q.kind))options.sort((a,b)=>energyValue(a.card,p)-energyValue(b.card,p));
  else if(q.kind==='effect_target') {
    const enemies=new Set(units(op).map(unit=>unit.id));
    options.sort((a,b)=>{
      if(enemies.has(a.id)&&enemies.has(b.id))return remaining(a.card)-remaining(b.card);
      if(q.effect_kind==='heal')return b.card.damage-a.card.damage;
      return battleValue(b.card)-battleValue(a.card);
    });
  }
  // Only select IDs supplied by the private prompt, within its exact cardinality.
  const maximum=Math.min(q.max,options.length);
  const count=['search','recover'].includes(q.kind)?maximum:Math.min(q.min,maximum);
  return {type:'choose',choices:options.slice(0,count).map(option=>option.id)};
}
export function cpuAction(view,{difficulty='normal',rng=randomInt}={}) {
  if(view.version==='pokemon-core-v1')return cpuActionV1(view,{difficulty,rng});
  if(view.phase==='finished')return null;
  const seat=view.seat,p=view.players[seat],op=view.players[seat===0?1:0];
  if(view.prompt)return expandedChoice(view,p,op,rng);
  if(!view.legal.length)return null;
  const scored=view.legal.map(move=>{
    const action=move.action,card=find(p,action.card),target=units(p).find(u=>u.id===action.target) || units(op).find(u=>u.id===action.target);
    let score=-100;
    if(action.type==='first')score=action.seat===seat?2:4;
    if(action.type==='setup')score=(action.zone==='active'?100:65)+battleValue(card)/10;
    if(action.type==='ready')score=10;
    if(action.type==='reset_setup')score=-1000;
    if(action.type==='bench')score=p.bench.length<3?65+battleValue(card)/20:15;
    if(action.type==='evolve')score=80+(hp(card)-hp(target))/10;
    if(action.type==='energy'){
      const prospective={...target,energy:[...target.energy,card]},useful=target.card.attacks.some(a=>a.cost.includes(card.card.type)||a.cost.includes('Colorless'));
      const unlock=target.card.attacks.some(a=>energySatisfied(prospective,a.cost)&&!energySatisfied(target,a.cost));
      score=35+(useful?20:-20)+(unlock?30:0)+(target.id===p.active?.id?15:0)-(armed(target)?12:0);
    }
    if(action.type==='trainer')score=programValue(card?.card.program,{p,op,target,source:card,view});
    if(action.type==='ability')score=programValue(card?.card.abilities?.[action.index]?.program,{p,op,target,source:card,view});
    if(action.type==='stadium')score=programValue(view.stadium?.unit.card.program.activation,{p,op,target,source:null,view});
    if(action.type==='attack'){
      const attack=p.active.card.attacks[action.index],damage=attackDamage(attack,p.active,op.active);
      score=45+damage/3+(damage>=remaining(op.active)?100:0)+attack.effects.filter(effect=>effect.kind==='condition').length*8;
      if(p.active.conditions.special==='confused')score-=20;
    }
    if(action.type==='retreat')score=(p.active.conditions.special||p.active.conditions.poison||p.active.conditions.burn||remaining(p.active)<=30)&&battleValue(target)>battleValue(p.active)?85:armed(target)&&!armed(p.active)?70:-30;
    if(action.type==='end_turn')score=0;
    return {action,score:score+(difficulty==='easy'?rng(20):rng(3))};
  }).sort((a,b)=>b.score-a.score);
  return scored[0]?.action || null;
}
export function driveCpu(state,{seat=1,difficulty='normal',max=32,rng=randomInt}={}) {
  let next=state,steps=0;
  for(;steps<max&&next.phase!=='finished';steps++){
    // This is the only input the decision function receives. It has no reference to next.
    const action=cpuAction(arenaView(next,seat),{difficulty,rng});if(!action)break;
    next=applyArenaAction(next,seat,action,{rng});
  }
  return {state:next,steps};
}
