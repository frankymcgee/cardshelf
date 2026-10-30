// Synthetic catalogue data. No production opponent or invented-card fallback.
import { compileArenaCard } from '../../lib/arena/cards.mjs';
export function gameRow(game,name,overrides={}) {
  const arena_data=game==='mtg'?{version:1,layout:'normal',types:['Creature'],supertypes:[],mana_cost:'{G}',power:'2',toughness:'2'}:{version:1,type:'Normal Monster',race:'Dragon',attribute:'EARTH',level:4,atk:1600,def:1200};
  return {id:`${game}:en:test-${name.replace(/[^a-z0-9]/gi,'-')}`,game,language:'en',name,local_id:'1',category:game==='mtg'?'Creature':'Normal Monster',
    raw_data:{public_text:'',faces:game==='mtg'?[{name,text:''}]:undefined,...overrides.raw_data,arena_data:{...arena_data,...overrides.arena_data}},...overrides.row};
}
export function gameCard(game,name,overrides={}) {const result=compileArenaCard(gameRow(game,name,overrides));if(!result.supported)throw Error(result.reason);return result.card;}
export function gameDeck(game) {
  if(game==='yugioh')return Array.from({length:14},(_,i)=>({card:gameCard(game,'Normal '+i,{arena_data:{atk:1000+i*100,def:1000+i*100}}),quantity:i===13?1:3}));
  return [{card:gameCard(game,'Forest',{arena_data:{types:['Land'],supertypes:['Basic'],mana_cost:''},row:{category:'Basic Land — Forest'}}),quantity:24},
    ...Array.from({length:9},(_,i)=>({card:gameCard(game,'Creature '+i),quantity:4}))];
}
export const seeded = (seed=1) => n => {seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
