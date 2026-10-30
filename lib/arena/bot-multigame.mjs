/** Receives only the same disclosed view as a human player. */
export function gameCpuAction(view) {
  if(view.phase==='finished')return null;
  const p=view.players[view.seat],op=view.players[1-view.seat],field=p.field||[];
  const value=u=>(u?.card?.power||0)*2+(u?.card?.toughness||0)+(u?.card?.atk||0)/200+(u?.card?.def||0)/400;
  const ranked=view.legal.map(move=>{
    const a=move.action,u=[...p.hand,...field].find(u=>u.id===a.card);let score=-100;
    if(a.type==='first')score=a.seat===view.seat?10:0;
    if(a.type==='keep')score=20;
    if(a.type==='bottom'||a.type==='discard')score=10-value(u);
    if(a.type==='pass')score=0;
    if(a.type==='land')score=100;
    if(a.type==='mana')score=60;
    if(a.type==='pay')score=60;
    if(a.type==='cast'){
      score=80+value(u);
      const program=u?.card.program,target=op.field.find(u=>u.id===a.target&&!u.hidden);
      if(program?.kind==='damage')score=a.target===`player:${1-view.seat}`?85:target?90+value(target):-30;
      if(program?.kind==='destroy')score=target?100+value(target):-30;
    }
    if(a.type==='attacker')score=view.combat?.attackers.includes(a.card)?-50:20+value(u);
    if(a.type==='declare_attackers')score=5;
    if(a.type==='block')score=view.combat?.blocks[a.card]?-20:20+value(u);
    if(a.type==='declare_blockers')score=5;
    if(a.type==='assign_damage')score=10+a.amount;
    if(a.type==='summon')score=60+value(u)-(a.position==='set'?8:0);
    if(a.type==='spell'){
      const program=u?.card.program;score=80;
      if(program?.kind==='destroy_all')score=op.field.filter(u=>u.hidden||u.card?.kind==='monster').length*20-(program.side==='both'?field.filter(u=>u.card.kind==='monster').length*20:0);
    }
    if(a.type==='position')score=u?.face_down||u?.position==='defense'?30:-20;
    if(a.type==='battle')score=10;
    if(a.type==='main2')score=0;
    if(a.type==='end_turn')score=-5;
    if(a.type==='attack'){
      const target=op.field.find(u=>u.id===a.target);
      score=!target?50:target.hidden?20:u.card.atk>(target.position==='attack'?target.card.atk:target.card.def)?40:-20;
    }
    return {action:a,score};
  }).sort((a,b)=>b.score-a.score);
  return ranked[0]?.action||null;
}
