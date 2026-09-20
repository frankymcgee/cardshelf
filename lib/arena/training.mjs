/** Original synthetic cards for learning and automated tests. Never inserted into collections. */
import { ARENA_VERSION } from '../../shared/arena.mjs';
const base=(id,name)=>({id:'training:'+id,name,image_url:null,set_name:'CardShelf Training Lab',number:id,game:'pokemon',language:'en',compiler:ARENA_VERSION,training:true});
const attack=(name,cost,damage,effects=[])=>({name,cost,damage,printed:String(damage),text:'Training card: '+name,effects});
export function trainingDeck(theme='ember') {
  const fire=theme==='ember',type=fire?'Fire':'Water',name=fire?'Ember':'Tide',evolve=fire?'Ember Lynx':'Tide Otter';
  const pokemon=(id,label,hp,attacks,stage='Basic',from=null)=>({...base(theme+'-'+id,label),kind:'pokemon',type,stage,hp,retreat:1,evolves_from:from,prizes:1,weakness:[],resistance:[],attacks});
  const cards=[
    [pokemon('cub',name+' Cub',80,[attack('Quick Strike',[type],30),attack('Power Strike',[type,'Colorless'],50)]),4],
    [pokemon('fox',name+' Fox',90,[attack('Nudge',['Colorless'],10),attack('Bright Burst',[type,'Colorless'],60)]),4],
    [pokemon('whelp',name+' Whelp',60,[attack('Restful Tap',[type],10,[{kind:'condition',condition:'asleep'}])]),4],
    [pokemon('evolution',evolve,130,[attack('Focused Strike',[type,'Colorless'],80)],'Stage1',name+' Cub'),4],
    [{...base('potion','Training Potion'),kind:'trainer',program:{kind:'heal',amount:30,trainerType:'Item',text:'Heal 30 damage from 1 of your Pokémon.'}},4],
    [{...base('switch','Training Switch'),kind:'trainer',program:{kind:'switch',trainerType:'Item',text:'Switch your Active Pokémon with 1 of your Benched Pokémon.'}},4],
    [{...base('draw','Training Guide'),kind:'trainer',program:{kind:'draw',count:3,trainerType:'Supporter',text:'Draw 3 cards.'}},4],
    [{...base('search','Training Search'),kind:'trainer',program:{kind:'search',filter:'basic',count:1,trainerType:'Item',text:'Search your deck for a Basic Pokémon, reveal it and put it into your hand. Then shuffle your deck.'}},4],
    [{...base(theme+'-energy',type+' Training Energy'),kind:'energy',type,basic_energy:true},28]
  ];
  return cards.map(([card,quantity])=>({card,quantity}));
}
