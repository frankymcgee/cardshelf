/** September 2026 rulebook profiles. Every gameplay clause must compile in full.
 * TCGdex schema: https://github.com/tcgdex/cards-database/blob/master/interfaces.d.ts
 * Unsupported interactions stay unavailable; this is not an English rules interpreter.
 */
import { ENERGY_TYPES, ARENA_LIMITS, ARENA_VERSION } from '../../shared/arena.mjs';
import { arenaPokemonName } from '../../shared/arena-card-name.mjs';
import { attackProgram as coreAttack, compileArenaCard as coreCompile } from './cards-v1.mjs';
const norm=value=>typeof value==='string'?value.replace(/[’‘]/g,"'").replace(/Pokémon/gi,'Pokemon').replace(/\s+/g,' ').trim():'';
const meaningful=value=>value!==undefined&&value!==null&&value!==''&&(!Array.isArray(value)||value.length>0);
const number=value=>{const n=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;return Number.isSafeInteger(n)&&n>=0&&n<=10000?n:null;};
const words={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7};
const count=value=>words[String(value).toLowerCase()]??Number(value);
const amount=(n,max=200)=>{if(!Number.isInteger(n)||n<10||n>max||n%10)throw Error('Effect amount is outside the reviewed bounds.');return n;};
const bounded=n=>{if(!Number.isInteger(n)||n<1||n>7)throw Error('Effect count is outside the reviewed bounds.');return n;};
const text=value=>{if(meaningful(value)&&typeof value!=='string')throw Error('Gameplay text is malformed.');return norm(value).replace(/\{([GRWLPFDMYNC])\}/g,(_,symbol)=>({G:'Grass',R:'Fire',W:'Water',L:'Lightning',P:'Psychic',F:'Fighting',D:'Darkness',M:'Metal',Y:'Fairy',N:'Dragon',C:'Colorless'})[symbol]);};
const image=value=>typeof value==='string'&&(/^https:\/\/assets\.tcgdex\.net\/[a-zA-Z0-9/_\-.]+$/.test(value)||/^\/api\/public\/catalogue\/artwork\/[a-f0-9]+$/.test(value))?value:null;
function modifier(values,resistance=false){
  if(values==null)return [];
  if(!Array.isArray(values)||values.length>2||new Set(values.map(v=>v?.type)).size!==values.length)throw Error('Weakness/resistance is incomplete.');
  return values.map(v=>{if(!ENERGY_TYPES.includes(v?.type))throw Error('Unsupported Weakness/resistance type.');const value=String(v.value??'').replace('×','x');if(!/^(?:x2|\+[1234]0|-[1234]0)$/.test(value)||(resistance&&!value.startsWith('-')))throw Error('Unsupported Weakness/resistance modifier.');return {type:v.type,value};});
}
export function attackProgram(attack){
  const original=text(attack?.effect);
  const powerReminder=/\s*\(?(?:You can't|You cannot) use more than (?:1|one) (GX attack|VSTAR Power) (?:in|during) a game\.?\)?$/i;
  const reminder=original.match(powerReminder),power=reminder?.[1].toUpperCase().startsWith('GX')?'gx':reminder?'vstar':/(?:-| )GX$/i.test(norm(attack?.name))?'gx':null;
  let effect=original.replace(powerReminder,'');
  const finish=result=>({...result,text:original,...(power?{power}:{})});
  let m;const before=[];
  if((m=effect.match(/^If this Pokemon has at least (\d+) extra Energy attached to it \(in addition to this attack's cost\), draw cards until you have (\d+) cards in your hand\.$/i))){
    const extra=bounded(Number(m[1])),hand=Number(m[2]);if(power!=='gx'||!Number.isInteger(hand)||hand<1||hand>20)throw Error('The complete GX bonus requirement is not implemented.');
    return finish({...coreAttack({...attack,effect:''}),effects:[{kind:'extra_energy_bonus',extra,program:{kind:'draw_until',count:hand}}]});
  }
  if((m=effect.match(/^If your opponent's Active Pokemon is an Evolution Pokemon, this attack does (\d+) more damage\.$/i))){
    if(!/^\d+\+$/.test(String(attack.damage)))throw Error('Evolution bonus requires matching printed additional damage.');
    return finish({...coreAttack({...attack,damage:String(attack.damage).slice(0,-1),effect:''}),effects:[{kind:'evolution_bonus',amount:amount(Number(m[1]),1000)}]});
  }
  if(/^Attach an Energy card from your hand to 1 of your Pokemon\.$/i.test(effect))
    return finish({...coreAttack({...attack,effect:''}),effects:[{kind:'program',program:{kind:'attach_hand',count:1}}]});
  if(/^Devolve each of your opponent's evolved Pokemon by putting the highest Stage Evolution card on it into your opponent's hand\.$/i.test(effect))
    return finish({...coreAttack({...attack,effect:''}),effects:[{kind:'program',program:{kind:'devolve_opponent'}}]});
  if((m=effect.match(/^Choose up to (\d+) of your Benched Pokemon\. For each of those Pokemon, search your deck for a card that evolves from that Pokemon and put it onto that Pokemon to evolve it\. Then, shuffle your deck\.$/i)))
    return finish({...coreAttack({...attack,effect:''}),effects:[{kind:'program',program:{kind:'evolve_search',count:bounded(Number(m[1]))}}]});
  if((m=effect.match(/^Discard (a|one|two|three|\d+) Energy from this Pokemon\. /i))){before.push({kind:'discard_energy',count:bounded(count(m[1])),type:null});effect=effect.slice(m[0].length);}
  if((m=effect.match(/^This attack does (\d+) damage to (a|one|two|three|\d+) of your opponent's Pokemon\. \(Don't apply Weakness and Resistance for Benched Pokemon\.\)$/i)))
    return finish({...coreAttack({...attack,damage:0,effect:''}),effects:[...before,{kind:'target_damage',amount:amount(Number(m[1]),1000),count:bounded(count(m[2])),side:'opponent'}]});
  if(before.length)return finish({...coreAttack({...attack,effect}),effects:[...before,...coreAttack({...attack,effect}).effects]});
  if((m=effect.match(/^Discard all Energy attached to this Pokemon\.$/i)))return finish({...coreAttack({...attack,effect:''}),effects:[{kind:'discard_energy',count:'all',type:null}]});
  if((m=effect.match(/^This attack does (\d+) more damage for each (?:(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless) )?Energy attached to this Pokemon\.$/i))){
    if(!/^\d+\+$/.test(String(attack.damage).replace('×','x')))throw Error('Energy bonus requires matching printed additional damage.');
    return finish({...coreAttack({...attack,damage:String(attack.damage).slice(0,-1),effect:''}),effects:[{kind:'energy_bonus',amount:amount(Number(m[1]),1000),type:m[2]||null}]});
  }
  if((m=effect.match(/^This attack does (\d+) more damage for each damage counter on this Pokemon\.$/i))||
    (m=effect.match(/^If this Pokemon has any damage counters on it, this attack does (\d+) more damage\.$/i))){
    if(!/^\d+\+$/.test(String(attack.damage)))throw Error('Damage-counter bonus requires matching printed additional damage.');
    return finish({...coreAttack({...attack,damage:String(attack.damage).slice(0,-1),effect:''}),effects:[{kind:'counter_bonus',amount:amount(Number(m[1]),1000),once:/^If /i.test(effect)}]});
  }
  if((m=effect.match(/^Attach (up to )?(a|one|two|three|\d+) (Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless) Energy cards from your discard pile to this Pokemon\.$/i)))
    return finish({...coreAttack({...attack,effect:''}),effects:[{kind:'program',program:{kind:'attach_discard',filter:'energy:'+m[3],count:bounded(count(m[2])),optional:!!m[1],choice:'attack'}}]});
  if((m=effect.match(/^Put (\d+) damage counters on your opponent's Pokemon in any way you like\.$/i))){
    const counters=Number(m[1]);if(!Number.isInteger(counters)||counters<1||counters>20)throw Error('Damage-counter allocation exceeds the reviewed limit.');
    return finish({...coreAttack({...attack,effect:''}),effects:[{kind:'program',program:{kind:'allocate_damage',count:counters,side:'opponent'}}]});
  }
  if((m=effect.match(/^You may discard any (?:amount|number) of (Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless) Energy from your Pokemon\. This attack does (\d+) damage for each card you discarded in this way\.$/i))){
    if(!/^\d+[x×]$/.test(String(attack.damage)))throw Error('Energy discard formula requires matching printed multiplying damage.');
    return finish({...coreAttack({...attack,damage:0,effect:''}),effects:[{kind:'energy_discard_damage',type:m[1],per:amount(Number(m[2]),1000)}]});
  }
  if((m=effect.match(/^This attack does (\d+) damage to each of (your|your opponent's) Benched Pokemon\. \(Don't apply Weakness and Resistance for Benched Pokemon\.\)$/i)))
    return finish({...coreAttack({...attack,effect:''}),effects:[{kind:'bench_damage',amount:amount(Number(m[1]),1000),side:m[2].toLowerCase()==='your'?'own':'opponent'}]});
  if((m=effect.match(/^Put (up to )?(a|one|two|three|\d+) (basic Energy cards?|Pokemon|cards?) from your discard pile into your hand\.$/i)))
    return finish({...coreAttack({...attack,effect:''}),effects:[{kind:'program',program:{kind:'recover',filter:/^basic/i.test(m[3])?'energy':/^Pokemon$/i.test(m[3])?'pokemon':'any',count:bounded(count(m[2])),optional:!!m[1],choice:'attack'}}]});
  const discard=effect.match(/^Discard the top (\d+) cards of your deck\.$/i);
  if(discard){const result=coreAttack({...attack,effect:''});return finish({...result,effects:[{kind:'discard_deck',count:bounded(Number(discard[1]))}]});}
  // Combined Special Conditions are simultaneous; the existing engine stores
  // Poison/Burn independently from Asleep/Confused/Paralyzed.
  const combined=effect.match(/^(Your opponent's Active Pokemon|The Defending Pokemon) is now (Asleep|Burned|Confused|Paralyzed|Poisoned) and (Asleep|Burned|Confused|Paralyzed|Poisoned)\.$/i);
  if(combined){
    const conditions=[combined[2].toLowerCase(),combined[3].toLowerCase()];
    if(new Set(conditions).size!==2||conditions.filter(c=>!['burned','poisoned'].includes(c)).length>1)throw Error('These Special Conditions cannot coexist.');
    const result=coreAttack({...attack,effect:''});return finish({...result,effects:conditions.map(condition=>({kind:'condition',condition}))});
  }
  return finish(coreAttack({...attack,effect}));
}
function abilityProgram(raw){
  if(!raw||!['Ability','Poke-POWER','Poke-BODY','Pokemon Power','Ancient Trait'].includes(raw.type)||!norm(raw.name))throw Error('This Ability type or name is not implemented.');
  const original=text(raw.effect),reminder=/\s*\(?(?:You can't|You cannot) use more than (?:1|one) VSTAR Power (?:in|during) a game\.?\)?$/i;
  if(raw.type==='Ancient Trait'){
    let modifier;
    if(original==='When this Pokemon is healed, double the amount healed.')modifier={healMultiplier:2};
    else if(original==='When you attach an Energy card from your hand to this Pokemon (except with an attack, Ability, or Trainer card), you may attach 2 Energy cards.')modifier={extraEnergy:1};
    else throw Error('The complete Ancient Trait is not implemented.');
    return {name:norm(raw.name),text:original,kind:'trait',type:raw.type,modifier};
  }
  if(/^Prevent all effects of attacks from your opponent's Pokemon done to this Pokemon\. \(Damage is not an effect\.\)$/i.test(original)){
    if(raw.type==='Poke-POWER')throw Error('The activated Poke-POWER type disagrees with this passive effect.');
    return {name:norm(raw.name),text:original,kind:'passive',type:raw.type,modifier:{prevent_attack_effects:true}};
  }
  if(/^As long as this Pokemon is in the Active Spot, your opponent can't play any Stadium cards from their hand\.$/i.test(original)){
    if(raw.type==='Poke-POWER')throw Error('The activated Poke-POWER type disagrees with this passive effect.');
    return {name:norm(raw.name),text:original,kind:'passive',type:raw.type,modifier:{block_stadium:true,position:'active'}};
  }
  let trigger;
  if((trigger=original.match(/^During Pokemon Checkup, heal (\d+) damage from this Pokemon\.$/i)))return {name:norm(raw.name),text:original,kind:'triggered',type:raw.type,timing:'checkup',program:{kind:'heal_self',amount:amount(Number(trigger[1]))}};
  if((trigger=original.match(/^During Pokemon Checkup, put (\d+) damage counters? on your opponent's Active Pokemon\.$/i)))return {name:norm(raw.name),text:original,kind:'triggered',type:raw.type,timing:'checkup',program:{kind:'damage',amount:amount(Number(trigger[1])*10),target:'opponent_active'}};
  const vstar=reminder.test(original);let effect=original.replace(reminder,''),m,program,cost=null,position=null;
  const conditionRule=/ This power can't be used if this Pokemon is affected by a Special Condition\.$/i,conditionBlocked=raw.type==='Poke-POWER'&&conditionRule.test(effect);
  if(conditionBlocked)effect=effect.replace(conditionRule,'');
  if(/^You must discard an Energy card from your hand in order to use this Ability\. /i.test(effect)){cost={filter:'energy_card',count:1};effect=effect.replace(/^You must discard an Energy card from your hand in order to use this Ability\. /i,'');}
  if(/^(Once during|During) your turn, if this Pokemon is in the Active Spot, you may /i.test(effect)){position='active';effect=effect.replace(', if this Pokemon is in the Active Spot,',',');}
  const prefix='^(?:Once during|During) your turn(?: \\(before your attack\\))?, you may ';
  if((m=effect.match(new RegExp(prefix+'draw (a|one|two|three|\\d+) cards?\\.$','i'))))program={kind:'draw',count:bounded(count(m[1]))};
  else if((m=effect.match(new RegExp(prefix+'draw cards until you have (\\d+) cards in your hand\\.$','i'))))program={kind:'draw_until',count:bounded(Number(m[1]))};
  else if((m=effect.match(new RegExp(prefix+'heal (\\d+) damage from this Pokemon\\.$','i'))))program={kind:'heal_self',amount:amount(Number(m[1]))};
  else if((m=effect.match(new RegExp(prefix+'put (a|one|two|three|\\d+) damage counters? on your opponent\'s Active Pokemon\\.$','i'))))program={kind:'damage',amount:amount(count(m[1])*10),target:'opponent_active'};
  else if((m=effect.match(new RegExp(prefix+'search your deck for up to (\\d+) Basic (Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy cards, reveal them, and put them into your hand\\. Then, shuffle your deck\\.$','i'))))program={kind:'search',filter:'energy:'+m[2],count:bounded(Number(m[1]))};
  else if((m=effect.match(new RegExp(prefix+'search your deck for up to (\\d+) cards and put them into your hand\\. Then, shuffle your deck\\.$','i'))))program={kind:'search',filter:'any',count:bounded(Number(m[1])),optional:true};
  else throw Error('The complete Ability effect is not implemented.');
  // "During your turn" without a once-per-turn or game limit must not be
  // silently downgraded to a once-per-turn Ability.
  if(!vstar&&!/^Once during /i.test(effect))throw Error('The Ability usage limit is not implemented.');
  if(raw.type==='Poke-BODY')throw Error('A Poke-BODY must be a reviewed passive effect.');
  return {name:norm(raw.name),text:original,kind:'activated',type:raw.type,limit:vstar?'game':'turn',...(vstar?{power:'vstar'}:{}),...(cost?{cost}:{}),...(position?{position}:{}),...(conditionBlocked?{conditionBlocked:true}:{}),program};
}
function toolProgram(effect,name=''){let m,program;
  const hyper=/ Team Flare Hyper Gear$/.test(name),ownerRule=" When this card is removed from a Pokemon for any reason, put this card in its owner's discard pile.";
  if(hyper){
    if(effect==="The attacks of the Pokemon this card is attached to cost Colorless more."+ownerRule)program={attackCost:1};
    else if(effect==="The attacks of the Pokemon this card is attached to do 20 less damage to all Defending Pokemon (before applying Weakness and Resistance). (Don't apply Weakness and Resistance for Benched Pokemon.)"+ownerRule)program={damage:-20,damageScope:'all'};
    else throw Error('The complete Team Flare Hyper Gear effect is not implemented.');
    return {kind:'tool',trainerType:'Tool',side:'opponent',attachFilter:'EX',...program,text:effect};
  }
  if((m=effect.match(/^The attacks of the Pokemon this card is attached to do (\d+) more damage to your opponent's Active Pokemon \(before applying Weakness and Resistance\)\.$/i)))program={damage:amount(Number(m[1]),100)};
  else if((m=effect.match(/^The (Basic )?Pokemon this card is attached to gets \+(\d+) HP\.$/i)))program={hp:amount(Number(m[2])),...(m[1]?{filter:'basic'}:{})};
  else if((m=effect.match(/^The Basic Pokemon this card is attached to gets \+(\d+) HP and its attacks do (\d+) more damage to your opponent's Active Pokemon \(before applying Weakness and Resistance\)\.$/i)))program={filter:'basic',hp:amount(Number(m[1])),damage:amount(Number(m[2]),100)};
  else if(/^The Pokemon this card is attached to has no Retreat Cost\.$/i.test(effect))program={retreat:'free'};
  else if((m=effect.match(/^Your turn does not end if the Pokemon this card is attached to becomes (M [A-Za-z0-9 .'’-]+(?:-| )EX)\.$/)))program={spiritLink:m[1].replace(/-EX$/,' EX')};
  else throw Error('The complete Pokemon Tool effect is not implemented.');
  return {kind:'tool',trainerType:'Tool',...program,text:effect};
}
function stadiumProgram(effect){let m,program;
  if((m=effect.match(/^Each Stage 1 and Stage 2 Pokemon in play \(both yours and your opponent's\) gets \+(\d+) HP\.$/i)))program={modifiers:{hp:amount(Number(m[1]),100),filter:'evolved'}};
  else if((m=effect.match(/^Once during each player's turn, that player may heal (\d+) damage from each of (?:his or her|their) (Water|Lightning|Grass|Fire|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless) Pokemon and (Water|Lightning|Grass|Fire|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless) Pokemon\.$/)))program={activation:{kind:'heal_all',amount:amount(Number(m[1]),100),types:[m[2],m[3]]}};
  else throw Error('The complete Stadium effect is not implemented.');
  return {kind:'stadium',trainerType:'Stadium',...program,text:effect};
}
function trainerProgram(raw,name=''){
  let trainerType=raw.trainerType,effect=text(raw.effect);
  const machine=/^The Pokemon this card is attached to can use the attack on this card\. \(You still need the necessary Energy to use this attack\.\)( If this card is attached to 1 of your Pokemon, discard it at the end of your turn\.)?$/i;
  if(['Tool','Technical Machine'].includes(trainerType)&&machine.test(effect)){
    if(!Array.isArray(raw.attacks)||raw.attacks.length!==1)throw Error('The complete Technical Machine attack is required.');
    return {kind:'tool',trainerType:'Tool',grantedAttacks:raw.attacks.map(attackProgram),...(machine.exec(effect)[1]?{expires:'end_turn'}:{}),text:effect};
  }
  if(meaningful(raw.attacks))throw Error('Trainer attack data requires a reviewed Technical Machine rule.');
  if(trainerType==='Tool')return toolProgram(effect,name);
  if(trainerType==='Stadium')return stadiumProgram(effect);
  if(trainerType==='Ace Spec')trainerType='Item';
  if(!['Item','Supporter'].includes(trainerType))throw Error('This Trainer class is not implemented.');
  const tagTeam=effect.match(/^Switch your Active Pokemon with 1 of your Benched Pokemon\. When you play this card, you may discard (\d+) other cards from your hand\. If you do, heal (\d+) damage from the Pokemon you moved to your Bench\.$/i);
  if(tagTeam){if(trainerType!=='Supporter')throw Error('This TAG TEAM profile must be a Supporter.');return {kind:'tag_team',trainerType:'Supporter',base:{kind:'switch'},bonus:{kind:'heal_previous',amount:amount(Number(tagTeam[2]))},optional_discard:bounded(Number(tagTeam[1])),text:effect};}
  let fossil=effect.match(/^Play this card as if it were a (\d+)-HP Basic Colorless Pokemon\. (.+)$/i);
  if(fossil){
    if(trainerType!=='Item')throw Error('Fossil Pokemon must be Item cards.');
    const remainder=fossil[2],discard="At any time during your turn, you may discard this card from play.",conditions="This card can't be affected by any Special Conditions, and it can't retreat.",conditionsAlt="This card can't be affected by any Special Conditions and can't retreat.";
    if(![discard+' '+conditions,conditionsAlt+' '+discard,conditions+' '+discard].includes(remainder))throw Error('The complete Fossil Item rule is not implemented.');
    const hp=amount(Number(fossil[1]),200);if(raw.hp!==undefined&&number(raw.hp)!==hp)throw Error('Fossil HP metadata disagrees with its rule.');
    if(meaningful(raw.abilities)&&(!Array.isArray(raw.abilities)||raw.abilities.length>3))throw Error('Fossil Ability data is incomplete.');
    return {kind:'fossil',trainerType:'Item',hp,abilities:(raw.abilities||[]).map(abilityProgram),text:effect};
  }
  const restored=effect.match(/^Look at the bottom (\d+) cards of your deck\. You may reveal an? ([A-Za-z0-9 .'’:-]+) you find there and put it onto your Bench\. Shuffle the other cards back into your deck\.$/i);
  if(restored)return {kind:'fossil_search',trainerType,text:effect,count:bounded(Number(restored[1])),name:restored[2]};
  const birdKeeper=effect.match(/^Switch your Active Pokemon with (?:1|one) of your Benched Pokemon\. If you do, draw (\d+) cards\.$/i);
  if(birdKeeper)return {kind:'sequence',requires_switch:true,steps:[{kind:'switch'},{kind:'draw',count:bounded(Number(birdKeeper[1]))}],trainerType,text:effect};
  const original=effect,steps=[];let discard=0,m;
  if((m=effect.match(/^You can (?:use|play) this card only if you discard (a|one|two|three|\d+) other cards? from your hand\. /i))){discard=bounded(count(m[1]));effect=effect.slice(m[0].length);}
  // Consume complete, reviewed atoms, including their own search/shuffle clauses.
  // There is no split-on-period fallback that could omit a conditional sentence.
  const atom=(re,build)=>{const match=effect.match(re);if(!match)return false;steps.push(build(match));effect=effect.slice(match[0].length).trim();return true;};
  while(effect){
    const matched=atom(/^Draw (a|one|two|three|\d+) cards?\.(?: |$)/i,m=>({kind:'draw',count:bounded(count(m[1]))}))||
      atom(/^Discard your hand and draw (\d+|seven) cards\.(?: |$)/i,m=>({kind:'discard_draw',count:bounded(count(m[1]))}))||
      atom(/^Shuffle your hand into your deck\. Then,? draw (\d+|six) cards\.(?: |$)/i,m=>({kind:'shuffle_draw',count:bounded(count(m[1]))}))||
      atom(/^Heal (\d+) damage from (?:1|one) of your Pokemon\.(?: |$)/i,m=>({kind:'heal',amount:amount(Number(m[1]))}))||
      atom(/^Switch your Active Pokemon with (?:1|one) of your Benched Pokemon\.(?: |$)/i,()=>({kind:'switch'}))||
      atom(/^Switch (?:1|one) of your opponent's Benched Pokemon with their Active Pokemon\.(?: |$)/i,()=>({kind:'gust'}))||
      atom(/^Search your deck for (?:up to )?(a|an|one|two|three|\d+) (Basic Pokemon|basic Energy cards?|Pokemon), reveal (?:it|them),? and put (?:it|them) into your hand\. (?:Then,? shuffle your deck|Shuffle your deck afterward)\.(?: |$)/i,m=>({kind:'search',filter:m[2].toLowerCase()==='basic pokemon'?'basic':m[2].toLowerCase()==='pokemon'?'pokemon':'energy',count:bounded(count(m[1]))}))||
      atom(/^Search your deck for (up to )?(a|an|one|two|three|\d+) cards? and put (?:it|them) into your hand\. (?:Then,? shuffle your deck|Shuffle your deck afterward)\.(?: |$)/i,m=>({kind:'search',filter:'any',count:bounded(count(m[2])),optional:!!m[1]}))||
      atom(/^Put (up to )?(a|one|two|three|\d+) (basic Energy cards?|Pokemon|cards?) from your discard pile into your hand\.(?: |$)/i,m=>({kind:'recover',filter:m[3].toLowerCase()==='pokemon'?'pokemon':/^basic/i.test(m[3])?'energy':'any',count:bounded(count(m[2])),optional:!!m[1]}))||
      atom(/^Shuffle (up to )?(a|one|two|three|\d+) (?:in any combination of Pokemon and basic Energy cards|Pokemon and basic Energy cards in any combination) from your discard pile into your deck\.(?: |$)/i,m=>({kind:'recover',filter:'pokemon_or_energy',count:bounded(count(m[2])),optional:!!m[1],destination:'deck'}))||
      atom(/^Discard all Pokemon Tool cards attached to each of your opponent's Pokemon\.(?: |$)/i,()=>({kind:'discard_tools',side:'opponent',count:'all'}));
    if(!matched)throw Error('A Trainer clause is not implemented: '+effect.slice(0,110));
    if(steps.length>6)throw Error('This Trainer has too many sequential effects.');
  }
  if(!steps.length)throw Error('Trainer effect text is missing.');
  return {...(steps.length===1?steps[0]:{kind:'sequence',steps}),...(discard?{discard}:{}),trainerType,text:original};
}
function ruleTexts(raw){
  const result=[];
  for(const key of ['rule','rules'])if(meaningful(raw[key])){
    if(typeof raw[key]==='string')result.push(text(raw[key]));
    else if(Array.isArray(raw[key])&&raw[key].every(x=>typeof x==='string'))result.push(...raw[key].map(text));
    else throw Error('Card rule text is malformed.');
  }
  return result;
}
const teraRule=/^As long as this Pokemon is on your Bench, prevent all damage done to this Pokemon by attacks \(both yours and your opponent's\)\.$/i;
// The provider schema omits Tera on some records. Verified printed identities,
// never damage/HP/name heuristics, can supply that missing characteristic.
// https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/series/sv01/224/
// https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/series/sv03/42/
const teraPrintings=new Map([['en:sv01-032','Arcanine ex'],['en:sv01-224','Arcanine ex'],['en:sv03-042','Eiscue ex']]);
function validateRules(raw,{ruleBox=null,prizes=2,mega=false,radiant=false,prism=false,tera=false,breakStage=false,restored=null,aceSpec=false,trainerType=null}={}){
  for(const rule of ruleTexts(raw)){
    if(aceSpec&&/^You (?:can|may) (?:not have|have no) more than 1 ACE SPEC card in your deck\.$/i.test(rule))continue;
    if(aceSpec&&/^You can't have more than 1 ACE SPEC card in your deck\.$/i.test(rule))continue;
    if(ruleBox&&new RegExp('^When (?:your|a) (?:Mega )?Pokemon[- ]'+ruleBox+' is Knocked Out, your opponent takes (?:'+prizes+'|'+({1:'one',2:'two',3:'three'}[prizes])+') Prize cards\\.$').test(rule))continue;
    if(mega&&/^When (?:1|one) of your Pokemon becomes a Mega Evolution Pokemon, your turn ends\.$/i.test(rule))continue;
    if(radiant&&/^You can't have more than 1 Radiant Pokemon in your deck\.$/i.test(rule))continue;
    if(prism&&/^You can't have more than 1 Prism Star card with the same name in your deck\. If a Prism Star card would go to the discard pile, put it in the Lost Zone instead\.$/i.test(rule))continue;
    if(tera&&teraRule.test(rule))continue;
    if(breakStage&&/^[A-Za-z0-9 .'’:-]+ BREAK retains the attacks, Abilities, Weakness, Resistance, and Retreat Cost of its previous Evolution\.$/i.test(rule))continue;
    if(restored&&rule===`Put this card on your Bench only with the effect of ${restored}.`)continue;
    if(trainerType==='Supporter'&&/^You may play only 1 Supporter card during your turn(?: \(before your attack\))?\.$/i.test(rule))continue;
    if(trainerType==='Item'&&/^You may play any number of Item cards during your turn(?: \(before your attack\))?\.$/i.test(rule))continue;
    throw Error('An additional card rule is not implemented: '+rule.slice(0,110));
  }
}
export function compileArenaCard(row){
  const raw=row?.raw_data||{},name=norm(row?.name||raw.name),out={id:row?.id,name,image_url:image(row?.image_url),set_name:norm(row?.set_name),number:String(row?.local_id||''),game:'pokemon',language:'en',compiler:ARENA_VERSION};
  try{
    if(row?.game!=='pokemon'||row?.language!=='en'||!row?.id||!name||!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Use a local English Pokemon record.');
    if(['item','ability','ancientTrait','ancient_trait','teraType'].some(key=>meaningful(raw[key]))||raw.level==='X'||meaningful(raw.retreatCost))throw Error('This special mechanic requires its own implementation.');
    const prism=/◇/.test(name),radiant=/^Radiant /.test(name),aceSpec=raw.trainerType==='Ace Spec'||/^ACE SPEC(?: Rare)?$/i.test(String(raw.rarity||''))||raw.regulationMark==='ACE SPEC';
    if(/^Radiant Rare$/i.test(String(raw.rarity||''))&&!radiant||/\bPrism Star\b/i.test(String(raw.rarity||''))&&!prism)throw Error('Special-family rarity disagrees with the printed name; missing family data cannot remove its deck limit.');
    if(raw.category!=='Pokemon'&&meaningful(raw.tera))throw Error('Tera metadata is only valid on a Pokemon ex.');
    if(raw.category==='Energy'){
      if(meaningful(raw.abilities))throw Error('This Energy has additional rules.');
      if(raw.energyType==='Special'){
        const effect=text(raw.effect);let m,provides;
        if((m=effect.match(/^This card provides (?:2|two) Colorless Energy\.$/i)))provides={types:['Colorless'],count:2};
        else if((m=effect.match(/^This card provides (?:1 )?(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless) Energy\.$/i)))provides={types:[m[1]],count:1};
        else if(/^This card provides every type of Energy but provides only (?:1|one) Energy at a time\.$/i.test(effect))provides={types:[...ENERGY_TYPES],count:1};
        else throw Error('The complete Special Energy effect is not implemented.');
        validateRules(raw,{prism,aceSpec});return {supported:true,card:{...out,kind:'energy',type:provides.types[0],basic_energy:false,provides,prism_star:prism,ace_spec:aceSpec}};
      }
      if(prism||aceSpec||ruleTexts(raw).length)throw Error('This Basic Energy has additional rules.');
      const effect=text(raw.effect);
      const energyType=name.match(/^(?:Basic )?(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/i)?.[1];
      if(effect&&effect!=='Basic Energy'&&(!energyType||!new RegExp('^This card provides (?:1 )?'+energyType+' Energy\\.$','i').test(effect)))throw Error('This Basic Energy has additional effect text requiring a reviewed implementation.');
      // Basic Energy rules text is the provider's standard reminder. Special
      // Energy can never enter through this path, regardless of its name.
      const result=coreCompile({...row,raw_data:{...raw,rule:undefined,rules:undefined}});
      if(!result.supported)throw Error(result.reason);return {supported:true,card:{...result.card,compiler:ARENA_VERSION}};
    }
    if(raw.category==='Trainer'){
      if(meaningful(raw.suffix))throw Error('This Trainer has an unimplemented special mechanic.');
      // TCGdex's older Master Ball record (bw10-94) omits ACE SPEC
      // metadata. Match its complete reviewed effect as well as its name;
      // earlier, non-ACE Master Ball printings have a different effect.
      const masterBall=name==='Master Ball'&&/^Search your deck for a Pokemon, reveal it, and put it into your hand\. (?:Then,? shuffle your deck|Shuffle your deck afterward)\.$/.test(text(raw.effect));
      const trainerAceSpec=masterBall||aceSpec;
      const program=trainerProgram(raw,name);if(meaningful(raw.abilities)&&program.kind!=='fossil')throw Error('This Trainer has an unimplemented Ability.');validateRules(raw,{aceSpec:trainerAceSpec,prism,trainerType:program.trainerType});
      return {supported:true,card:{...out,kind:'trainer',program,ace_spec:trainerAceSpec,prism_star:prism}};
    }
    if(raw.category!=='Pokemon')throw Error('Unknown gameplay category.');
    if(aceSpec)throw Error('ACE SPEC Pokemon metadata is not implemented.');
    const suffix=raw.suffix||null,stage=raw.stage==='MEGA'?'MegaEvolution':raw.stage;
    if(suffix&&!['EX','ex','GX','TAG TEAM-GX','V'].includes(suffix))throw Error('This Pokemon rule box is not implemented.');
    if(/[★]/.test(name)||/(?:^|\s)(?:LV\.?X|LEGEND)\s*$/i.test(name))throw Error('This Pokemon special rule is not implemented.');
    let union=null;
    if(stage==='V-UNION'){
      // TCGdex exposes the complete combined profile on every piece, but not
      // piece positions. Only reviewed catalogue identities can establish four
      // distinct quarters; arbitrary artworks must not masquerade as a set.
      const n=String(row.id).match(/^en:swshp-SWSH(159|160|161|162)$/)?.[1];
      if(!n||name!=='Mewtwo V-UNION'||raw.illustrator!=='AKIRA EGAWA'||row.set_id&&row.set_id!=='en:swshp')throw Error('V-UNION piece identity, set or illustrator has not been reviewed.');
      union={group:'swshp:mewtwo:AKIRA EGAWA',piece:Number(n)-158,set:'en:swshp',artist:'AKIRA EGAWA'};
    }
    if(/ V-UNION$/.test(name)&&!union)throw Error('The V-UNION stage and reviewed piece identity are required.');
    const ruleBox=['VMAX','VSTAR','V-UNION'].includes(stage)?stage:suffix==='TAG TEAM-GX'?'GX':suffix;
    if(!ruleBox&&/(?:-|\s)(?:ex|EX|GX|V|VMAX|VSTAR)\s*$/.test(name))throw Error('The provider suffix or special stage is required.');
    if(ruleBox&&!new RegExp('(?:-|\\s)'+ruleBox+'$').test(name))throw Error('The Pokemon name and provider suffix disagree.');
    if(stage==='MegaEvolution'&&(suffix!=='EX'||!(/^(?:M |Mega |Primal )/.test(name))))throw Error('Legacy Mega Evolution requires Pokemon EX metadata.');
    if(/^(?:M |Primal )/.test(name)&&stage!=='MegaEvolution')throw Error('The Mega Evolution stage is missing.');
    const modernMega=/^Mega /.test(name)&&suffix==='ex';
    if(/^Mega /.test(name)&&!modernMega&&stage!=='MegaEvolution')throw Error('The modern Mega Pokemon ex suffix is missing.');
    if(suffix==='EX'&&!['Basic','MegaEvolution'].includes(stage))throw Error('Legacy Pokemon EX require Basic or Mega Evolution stage.');
    if(suffix==='V'&&!['Basic','VMAX','VSTAR','V-UNION'].includes(stage)||['VMAX','VSTAR','V-UNION'].includes(stage)&&suffix&&suffix!=='V')throw Error('Pokemon V stage and suffix disagree.');
    if(suffix==='TAG TEAM-GX'&&stage!=='Basic')throw Error('TAG TEAM Pokemon must be Basic.');
    if(!['Basic','Stage1','Stage2','MegaEvolution','VMAX','VSTAR','V-UNION','BREAK','RESTORED'].includes(stage))throw Error('This evolution stage is not implemented.');
    if(stage==='BREAK'&&!/ BREAK$/.test(name)||/ BREAK$/.test(name)&&stage!=='BREAK')throw Error('The BREAK name and stage disagree.');
    if(radiant&&(stage!=='Basic'||suffix||!(/^Radiant Rare$/i.test(String(raw.rarity||''))||ruleTexts(raw).some(r=>/^You can't have more than 1 Radiant Pokemon/.test(r)))))throw Error('Radiant metadata or Basic stage is missing.');
    if(teraPrintings.has(row.id)&&teraPrintings.get(row.id)!==name)throw Error('The verified Tera printing name disagrees with its catalogue identity.');
    const effect=text(raw.effect),tera=raw.tera===true||teraPrintings.has(row.id)||teraRule.test(effect)||ruleTexts(raw).some(r=>teraRule.test(r)),restored=stage==='RESTORED'?text(raw.evolveFrom)||effect.match(/^Put this card on your Bench only with the effect of (.+)\.$/)?.[1]:null;
    if(stage==='RESTORED'&&(!restored||suffix))throw Error('The Restored Pokemon fossil source is missing or unsupported.');
    if(raw.tera!==undefined&&typeof raw.tera!=='boolean'||tera&&suffix!=='ex')throw Error('Verified Tera metadata is required on Pokemon ex.');
    if(suffix==='ex'&&/^en:sv/.test(row.id)&&!tera&&raw.tera!==false)throw Error('This Tera-era printing needs a verified Tera/non-Tera classification; missing metadata cannot be treated as no protection.');
    if(effect&&!(tera&&teraRule.test(effect))&&!(restored&&effect===`Put this card on your Bench only with the effect of ${restored}.`))throw Error('Additional Pokemon text is not implemented.');
    const prizes=modernMega||['VMAX','V-UNION'].includes(stage)||suffix==='TAG TEAM-GX'?3:ruleBox?2:1;
    validateRules(raw,{ruleBox,prizes,mega:stage==='MegaEvolution',radiant,prism,tera,breakStage:stage==='BREAK',restored});
    const hp=number(raw.hp),retreat=number(raw.retreat);
    if(!hp||hp>500||hp%10||(stage!=='BREAK'&&(retreat===null||retreat>5))||!Array.isArray(raw.types)||raw.types.length<1||raw.types.length>2||new Set(raw.types).size!==raw.types.length||!raw.types.every(t=>ENERGY_TYPES.includes(t)))throw Error('HP, type or retreat information is incomplete.');
    if(!Array.isArray(raw.attacks)||raw.attacks.length<1||raw.attacks.length>(union?4:3))throw Error('Attack data is incomplete.');
    if(meaningful(raw.abilities)&&(!Array.isArray(raw.abilities)||raw.abilities.length>3))throw Error('Ability data is incomplete.');
    const abilities=(raw.abilities||[]).map(abilityProgram),evolves_from=['Basic','V-UNION','RESTORED'].includes(stage)?null:text(raw.evolveFrom);
    if(!['Basic','V-UNION','RESTORED'].includes(stage)&&!evolves_from)throw Error('Evolution predecessor is missing.');
    if(stage==='MegaEvolution'&&!/(?:-| )EX$/.test(evolves_from))throw Error('Legacy Mega Evolution requires a Pokemon EX predecessor.');
    if(['VMAX','VSTAR'].includes(stage)&&!/(?:-| )V$/.test(evolves_from))throw Error('VMAX and VSTAR require a Pokemon V predecessor.');
    const attacks=raw.attacks.map(attackProgram);
    if(attacks.some(a=>a.power==='gx'&&ruleBox!=='GX'||a.power==='vstar'&&stage!=='VSTAR')||abilities.some(a=>a.power==='vstar'&&stage!=='VSTAR'))throw Error('The once-per-game power does not match the Pokemon family.');
    if(stage==='VSTAR'&&!attacks.some(a=>a.power==='vstar')&&!abilities.some(a=>a.power==='vstar'))throw Error('The VSTAR Power and its shared usage reminder are missing.');
    return {supported:true,card:{...out,kind:'pokemon',type:raw.types[0],types:[...raw.types],stage,hp,retreat:retreat??0,evolves_from,restored_source:restored,rule_box:radiant?'Radiant':prism?'Prism Star':ruleBox,prizes,radiant,prism_star:prism,tera,union,abilities,weakness:modifier(raw.weaknesses),resistance:modifier(raw.resistances,true),attacks}};
  }catch(error){return {supported:false,card:out,reason:String(error.message)};}
}
// Pokémon EX and Pokémon ex have distinct names. Hyphen/space provider spelling
// must not permit an artwork variant to bypass the four-copy rule.
function nameKey(card){return card.kind==='pokemon'?arenaPokemonName(card.name):norm(card.name).toLowerCase();}
export function deckValidation(rows){
  const errors=[],names=new Map(),prismNames=new Map(),unionGroups=new Map();let total=0,basics=0,aceSpecs=0,radiants=0;
  if(!Array.isArray(rows)||rows.length>60)return {playable:false,total:0,errors:['A deck may contain at most 60 different cards.']};
  for(const row of rows){
    if(!row?.card||row.card.compiler!==ARENA_VERSION||!['pokemon','energy','trainer'].includes(row.card.kind)||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>60){errors.push('Every deck entry must be a supported card and a positive quantity.');continue;}
    total+=row.quantity;if(row.card.kind==='pokemon'&&row.card.stage==='Basic')basics+=row.quantity;
    if(row.card.ace_spec)aceSpecs+=row.quantity;
    if(row.card.radiant)radiants+=row.quantity;
    if(row.card.prism_star){const name=nameKey(row.card);prismNames.set(name,(prismNames.get(name)||0)+row.quantity);}
    if(row.card.union){const name=nameKey(row.card),groups=unionGroups.get(name)||new Set();groups.add(row.card.union.group);unionGroups.set(name,groups);}
    if(!row.card.basic_energy){const name=nameKey(row.card);names.set(name,(names.get(name)||0)+row.quantity);}
  }
  if(total!==ARENA_LIMITS.deck)errors.push('Use exactly 60 cards.');
  if(!basics)errors.push('Include at least one Basic Pokemon.');
  if(aceSpecs>1)errors.push('Use at most one ACE SPEC card in the entire deck.');
  if(radiants>1)errors.push('Use at most one Radiant Pokemon in the entire deck.');
  for(const [name,n]of prismNames)if(n>1)errors.push(`Use at most one Prism Star card named ${name}.`);
  for(const [name,groups]of unionGroups)if(groups.size>1)errors.push(`All ${name} pieces must share a set and illustrator.`);
  for(const [name,n]of names)if(n>4)errors.push(`More than four copies of ${name}, including artwork variants.`);
  return {playable:errors.length===0,total,basics,aceSpecs,radiants,errors,format:ARENA_VERSION};
}

