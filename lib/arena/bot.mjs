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
export function cpuAction(view,{difficulty='normal',rng=randomInt}={}) {
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
export function driveCpu(state,{seat=1,difficulty='normal',max=32,rng=randomInt}={}) {
  let next=state,steps=0;
  for(;steps<max&&next.phase!=='finished';steps++){
    // This is the only input the decision function receives. It has no reference to next.
    const action=cpuAction(arenaView(next,seat),{difficulty,rng});if(!action)break;
    next=applyArenaAction(next,seat,action,{rng});
  }
  return {state:next,steps};
}
