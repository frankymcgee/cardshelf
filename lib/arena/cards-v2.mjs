/** Reviewed expanded effect families. Every gameplay clause must compile in full.
 * TCGdex schema: https://github.com/tcgdex/cards-database/blob/master/interfaces.d.ts
 * Unsupported interactions stay unavailable; this is not an English rules interpreter.
 */
import { ENERGY_TYPES, ARENA_LIMITS, LEGACY_EXPANDED_ARENA_VERSION as ARENA_VERSION } from '../../shared/arena.mjs';
import { attackProgram as coreAttack, compileArenaCard as coreCompile } from './cards-v1.mjs';
const norm=value=>typeof value==='string'?value.replace(/[’‘]/g,"'").replace(/Pokémon/gi,'Pokemon').replace(/\s+/g,' ').trim():'';
const meaningful=value=>value!==undefined&&value!==null&&value!==''&&(!Array.isArray(value)||value.length>0);
const number=value=>{const n=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;return Number.isSafeInteger(n)&&n>=0&&n<=10000?n:null;};
const words={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7};
const count=value=>words[String(value).toLowerCase()]??Number(value);
const amount=(n,max=200)=>{if(!Number.isInteger(n)||n<10||n>max||n%10)throw Error('Effect amount is outside the reviewed bounds.');return n;};
const bounded=n=>{if(!Number.isInteger(n)||n<1||n>7)throw Error('Effect count is outside the reviewed bounds.');return n;};
const text=value=>{if(meaningful(value)&&typeof value!=='string')throw Error('Gameplay text is malformed.');return norm(value);};
const image=value=>typeof value==='string'&&(/^https:\/\/assets\.tcgdex\.net\/[a-zA-Z0-9/_\-.]+$/.test(value)||/^\/api\/public\/catalogue\/artwork\/[a-f0-9]+$/.test(value))?value:null;
function modifier(values,resistance=false){
  if(values==null)return [];
  if(!Array.isArray(values)||values.length>2||new Set(values.map(v=>v?.type)).size!==values.length)throw Error('Weakness/resistance is incomplete.');
  return values.map(v=>{if(!ENERGY_TYPES.includes(v?.type))throw Error('Unsupported Weakness/resistance type.');const value=String(v.value??'').replace('×','x');if(!/^(?:x2|\+[1234]0|-[1234]0)$/.test(value)||(resistance&&!value.startsWith('-')))throw Error('Unsupported Weakness/resistance modifier.');return {type:v.type,value};});
}
export function attackProgram(attack){
  const effect=text(attack?.effect);
  const discard=effect.match(/^Discard the top (\d+) cards of your deck\.$/i);
  if(discard){const result=coreAttack({...attack,effect:''});return {...result,text:effect,effects:[{kind:'discard_deck',count:bounded(Number(discard[1]))}]};}
  // Combined Special Conditions are simultaneous; the existing engine stores
  // Poison/Burn independently from Asleep/Confused/Paralyzed.
  const combined=effect.match(/^(Your opponent's Active Pokemon|The Defending Pokemon) is now (Asleep|Burned|Confused|Paralyzed|Poisoned) and (Asleep|Burned|Confused|Paralyzed|Poisoned)\.$/i);
  if(combined){
    const conditions=[combined[2].toLowerCase(),combined[3].toLowerCase()];
    if(new Set(conditions).size!==2||conditions.filter(c=>!['burned','poisoned'].includes(c)).length>1)throw Error('These Special Conditions cannot coexist.');
    const result=coreAttack({...attack,effect:''});return {...result,text:effect,effects:conditions.map(condition=>({kind:'condition',condition}))};
  }
  return coreAttack({...attack,effect});
}
function abilityProgram(raw){
  if(!raw||raw.type!=='Ability'||!norm(raw.name))throw Error('This Ability type or name is not implemented.');
  const effect=text(raw.effect);let m,program;
  const prefix='^Once during your turn(?: \\(before your attack\\))?, you may ';
  if((m=effect.match(new RegExp(prefix+'draw (a|one|two|three|\\d+) cards?\\.$','i'))))program={kind:'draw',count:bounded(count(m[1]))};
  else if((m=effect.match(new RegExp(prefix+'draw cards until you have (\\d+) cards in your hand\\.$','i'))))program={kind:'draw_until',count:bounded(Number(m[1]))};
  else if((m=effect.match(new RegExp(prefix+'heal (\\d+) damage from this Pokemon\\.$','i'))))program={kind:'heal_self',amount:amount(Number(m[1]))};
  else if((m=effect.match(new RegExp(prefix+'put (a|one|two|three|\\d+) damage counters? on your opponent\'s Active Pokemon\\.$','i'))))program={kind:'damage',amount:amount(count(m[1])*10),target:'opponent_active'};
  else throw Error('The complete Ability effect is not implemented.');
  return {name:norm(raw.name),text:effect,kind:'activated',limit:'turn',program};
}
function toolProgram(effect){let m,program;
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
function trainerProgram(raw){
  let trainerType=raw.trainerType,effect=text(raw.effect);
  if(trainerType==='Tool')return toolProgram(effect);
  if(trainerType==='Stadium')return stadiumProgram(effect);
  if(trainerType==='Ace Spec')trainerType='Item';
  if(!['Item','Supporter'].includes(trainerType))throw Error('This Trainer class is not implemented.');
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
      atom(/^Put (up to )?(a|one|two|three|\d+) (basic Energy cards?|Pokemon) from your discard pile into your hand\.(?: |$)/i,m=>({kind:'recover',filter:m[3].toLowerCase()==='pokemon'?'pokemon':'energy',count:bounded(count(m[2])),optional:!!m[1]}))||
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
function validateRules(raw,{ruleBox=null,mega=false,aceSpec=false,trainerType=null}={}){
  for(const rule of ruleTexts(raw)){
    if(aceSpec&&/^You (?:can|may) (?:not have|have no) more than 1 ACE SPEC card in your deck\.$/i.test(rule))continue;
    if(aceSpec&&/^You can't have more than 1 ACE SPEC card in your deck\.$/i.test(rule))continue;
    if(ruleBox&&new RegExp('^When (?:your|a) Pokemon[- ]'+ruleBox+' is Knocked Out, your opponent takes (?:2|two) Prize cards\\.$').test(rule))continue;
    if(mega&&/^When (?:1|one) of your Pokemon becomes a Mega Evolution Pokemon, your turn ends\.$/i.test(rule))continue;
    if(trainerType==='Supporter'&&/^You may play only 1 Supporter card during your turn(?: \(before your attack\))?\.$/i.test(rule))continue;
    if(trainerType==='Item'&&/^You may play any number of Item cards during your turn(?: \(before your attack\))?\.$/i.test(rule))continue;
    throw Error('An additional card rule is not implemented: '+rule.slice(0,110));
  }
}
export function compileArenaCard(row){
  const raw=row?.raw_data||{},name=norm(row?.name||raw.name),out={id:row?.id,name,image_url:image(row?.image_url),set_name:norm(row?.set_name),number:String(row?.local_id||''),game:'pokemon',language:'en',compiler:ARENA_VERSION};
  try{
    if(row?.game!=='pokemon'||row?.language!=='en'||!row?.id||!name||!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Use a local English Pokemon record.');
    if(['item','ability','ancientTrait','ancient_trait','tera','teraType'].some(key=>meaningful(raw[key]))||raw.level==='X'||meaningful(raw.retreatCost))throw Error('This special mechanic requires its own implementation.');
    if(raw.category==='Energy'){
      if(meaningful(raw.abilities)||ruleTexts(raw).length)throw Error('This Energy has additional rules.');
      const effect=text(raw.effect);
      const energyType=name.match(/^(?:Basic )?(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/i)?.[1];
      if(effect&&effect!=='Basic Energy'&&(!energyType||!new RegExp('^This card provides (?:1 )?'+energyType+' Energy\\.$','i').test(effect)))throw Error('This Basic Energy has additional effect text requiring a reviewed implementation.');
      // Basic Energy rules text is the provider's standard reminder. Special
      // Energy can never enter through this path, regardless of its name.
      const result=coreCompile({...row,raw_data:{...raw,rule:undefined,rules:undefined}});
      if(!result.supported)throw Error(result.reason);return {supported:true,card:{...result.card,compiler:ARENA_VERSION}};
    }
    if(raw.category==='Trainer'){
      if(meaningful(raw.abilities)||meaningful(raw.suffix))throw Error('This Trainer has an unimplemented special mechanic.');
      // TCGdex's older Master Ball record (bw10-94) omits ACE SPEC
      // metadata. Match its complete reviewed effect as well as its name;
      // earlier, non-ACE Master Ball printings have a different effect.
      const masterBall=name==='Master Ball'&&/^Search your deck for a Pokemon, reveal it, and put it into your hand\. (?:Then,? shuffle your deck|Shuffle your deck afterward)\.$/.test(text(raw.effect));
      const aceSpec=masterBall||raw.trainerType==='Ace Spec'||/^ACE SPEC(?: Rare)?$/i.test(String(raw.rarity||''))||raw.regulationMark==='ACE SPEC';
      const program=trainerProgram(raw);validateRules(raw,{aceSpec,trainerType:program.trainerType});
      return {supported:true,card:{...out,kind:'trainer',program,ace_spec:aceSpec}};
    }
    if(raw.category!=='Pokemon')throw Error('Unknown gameplay category.');
    const suffix=raw.suffix||null,stage=raw.stage==='MEGA'?'MegaEvolution':raw.stage;
    if(suffix&&!['EX','ex'].includes(suffix))throw Error('This Pokemon rule box is not implemented.');
    if(/^(?:Radiant |Mega )|(?:^|\s)(?:GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.?X)\s*$|[★◇]/i.test(name))throw Error('This Pokemon special rule is not implemented.');
    if(!suffix&&/(?:-|\s)(?:ex|EX)\s*$/.test(name))throw Error('The provider suffix is required to distinguish Pokemon EX from Pokemon ex.');
    if(suffix&&!new RegExp('(?:-|\\s)'+suffix+'$').test(name))throw Error('The Pokemon name and provider suffix disagree.');
    if(stage==='MegaEvolution'&&(suffix!=='EX'||!/^M /.test(name)))throw Error('Only legacy Mega Evolution Pokemon EX are implemented; modern Mega Pokemon ex need their three-Prize rule.');
    if(/^M /.test(name)&&stage!=='MegaEvolution')throw Error('The Mega Evolution stage is missing.');
    if(suffix==='EX'&&!['Basic','MegaEvolution'].includes(stage))throw Error('Legacy Pokemon EX require Basic or Mega Evolution stage.');
    if(!['Basic','Stage1','Stage2','MegaEvolution'].includes(stage))throw Error('This evolution stage is not implemented.');
    if(meaningful(raw.effect))throw Error('Additional Pokemon text is not implemented.');
    validateRules(raw,{ruleBox:suffix,mega:stage==='MegaEvolution'});
    const hp=number(raw.hp),retreat=number(raw.retreat);
    if(!hp||hp>500||hp%10||retreat===null||retreat>5||!Array.isArray(raw.types)||raw.types.length!==1||!ENERGY_TYPES.includes(raw.types[0]))throw Error('HP, type or retreat information is incomplete.');
    if(!Array.isArray(raw.attacks)||raw.attacks.length<1||raw.attacks.length>3)throw Error('Attack data is incomplete.');
    if(meaningful(raw.abilities)&&(!Array.isArray(raw.abilities)||raw.abilities.length>3))throw Error('Ability data is incomplete.');
    const abilities=(raw.abilities||[]).map(abilityProgram),evolves_from=stage==='Basic'?null:text(raw.evolveFrom);
    if(stage!=='Basic'&&!evolves_from)throw Error('Evolution predecessor is missing.');
    if(stage==='MegaEvolution'&&!/(?:-| )EX$/.test(evolves_from))throw Error('Legacy Mega Evolution requires a Pokemon EX predecessor.');
    return {supported:true,card:{...out,kind:'pokemon',type:raw.types[0],stage,hp,retreat,evolves_from,rule_box:suffix,prizes:suffix?2:1,abilities,weakness:modifier(raw.weaknesses),resistance:modifier(raw.resistances,true),attacks:raw.attacks.map(attackProgram)}};
  }catch(error){return {supported:false,card:out,reason:String(error.message)};}
}
// Pokémon EX and Pokémon ex have distinct names. Hyphen/space provider spelling
// must not permit an artwork variant to bypass the four-copy rule.
function nameKey(card){const suffix=card.rule_box;if(suffix)return norm(card.name).replace(new RegExp('(?:-|\\s)'+suffix+'$'),'').toLowerCase()+' ['+suffix+']';return norm(card.name).toLowerCase();}
export function deckValidation(rows){
  const errors=[],names=new Map();let total=0,basics=0,aceSpecs=0;
  if(!Array.isArray(rows)||rows.length>60)return {playable:false,total:0,errors:['A deck may contain at most 60 different cards.']};
  for(const row of rows){
    if(!row?.card||row.card.compiler!==ARENA_VERSION||!['pokemon','energy','trainer'].includes(row.card.kind)||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>60){errors.push('Every deck entry must be a supported card and a positive quantity.');continue;}
    total+=row.quantity;if(row.card.kind==='pokemon'&&row.card.stage==='Basic')basics+=row.quantity;
    if(row.card.ace_spec)aceSpecs+=row.quantity;
    if(!row.card.basic_energy){const name=nameKey(row.card);names.set(name,(names.get(name)||0)+row.quantity);}
  }
  if(total!==ARENA_LIMITS.deck)errors.push('Use exactly 60 cards.');
  if(!basics)errors.push('Include at least one Basic Pokemon.');
  if(aceSpecs>1)errors.push('Use at most one ACE SPEC card in the entire deck.');
  for(const [name,n]of names)if(n>4)errors.push(`More than four copies of ${name}, including artwork variants.`);
  return {playable:errors.length===0,total,basics,aceSpecs,errors,format:ARENA_VERSION};
}
