import { cardSnapshot } from '../../lib/battle/adapters/pokemon.mjs';
export const identityRng = upper => upper - 1;
export function syntheticCard(id='basic', changes={}) {
  return cardSnapshot({ id:'en:battle-'+id, game:'pokemon',language:'en',name:'Practice '+id,set_name:'Synthetic test set',local_id:'1',image_url:null,
    category:'Pokemon',raw_data:{category:'Pokemon',stage:'Basic',hp:100,attacks:[{name:'Practice attack',damage:'10',cost:['Colorless'],effect:'Synthetic rules text, resolved manually.'}]},...changes });
}
export function syntheticDeck(prefix='demo') {
  return [{card:syntheticCard(prefix+'-basic'),quantity:4},
    {card:syntheticCard(prefix+'-evolution',{name:'Practice evolution',raw_data:{category:'Pokemon',stage:'Stage1'}}),quantity:4},
    {card:syntheticCard(prefix+'-energy',{name:'Practice Energy',category:'Energy',raw_data:{category:'Energy',energyType:'Basic'}}),quantity:52}];
}
export function allCards(player) {
  return ['deck','hand','prizes','active','bench','stadium','discard','lost'].flatMap(z=>player[z].flatMap(c=>[c,...c.attachments]));
}
