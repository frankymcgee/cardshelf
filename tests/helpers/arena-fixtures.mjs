import { newArena, assertArena } from '../../lib/arena/engine.mjs';
import { trainingDeck } from '../../lib/arena/training.mjs';
export const rngFor=seed=>{let n=seed>>>0;return max=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n%max;};};
export function readyFixture({bench=true,turn=0}={}) {
  const s=newArena([trainingDeck(),trainingDeck('tide')],{rng:rngFor(123)});
  s.phase='playing';s.setup_complete=true;s.first=0;s.turn=turn;s.turnNumber=turn===0?3:4;
  s.queue=[];s.pending=null;s.events=[];s.event=0;
  for(const p of s.players){
    const pool=[...p.deck,...p.hand];p.hand=[];p.deck=pool;p.prizes=[];p.active=null;p.bench=[];p.resolving=[];p.discard=[];
    const take=predicate=>{const i=p.deck.findIndex(predicate);if(i<0)throw Error('Fixture lacks card');return p.deck.splice(i,1)[0];};
    p.active=take(c=>c.card.kind==='pokemon'&&c.card.stage==='Basic');
    if(bench)p.bench=[take(c=>c.card.kind==='pokemon'&&c.card.stage==='Basic')];
    p.prizes=p.deck.splice(-6);p.turns=2;p.ready=true;p.active.entered=0;p.energyAttached=false;p.supporterPlayed=false;p.retreated=false;
  }
  assertArena(s);return s;
}
export function take(s,seat,predicate,to='hand'){
  const p=s.players[seat];for(const zone of ['deck','hand','prizes','discard']){const i=p[zone].findIndex(predicate);if(i>=0){const c=p[zone].splice(i,1)[0];if(to)p[to].push(c);return c;}}throw Error('Fixture card not found');
}
export function power(s,seat,n=3,type=null){const p=s.players[seat];for(let i=0;i<n;i++){const c=take(s,seat,c=>c.card.kind==='energy',null);if(type)c.card.type=type;p.active.energy.push(c);}return p.active;}
export function attack(s,seat,{damage=30,cost=[],effects=[]}={}) {s.players[seat].active.card.attacks=[{name:'Synthetic attack',cost,damage,printed:String(damage),text:'Synthetic test profile',effects}];return s;}
export function trainer(s,seat,program) {const c=take(s,seat,c=>c.card.kind==='trainer');c.card.program={trainerType:'Item',text:'Synthetic test profile',...program};return c;}
export function row(raw={}){return {id:'en:arena-demo',name:'Synthetic Pokemon',game:'pokemon',language:'en',local_id:'1',set_name:'Synthetic test set',image_url:'https://assets.tcgdex.net/en/test/high.webp',raw_data:{...(!raw.category||raw.category==='Pokemon'?{category:'Pokemon',stage:'Basic',hp:100,types:['Fire'],retreat:1,attacks:[{name:'Test move',cost:['Fire'],damage:30}]}:{}),...raw}};}
