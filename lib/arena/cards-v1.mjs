/**
 * Conservative executable card contract. Every gameplay clause must be understood.
 * This is NOT a fuzzy English rules interpreter and never silently drops an effect.
 * Extend with reviewed profiles + tests before widening the playable card pool.
 */
import { createHash } from 'node:crypto';
import { ENERGY_TYPES, ARENA_LIMITS, LEGACY_ARENA_VERSION as ARENA_VERSION } from '../../shared/arena.mjs';
const norm = value => typeof value === 'string' ? value.replace(/[’‘]/g,"'").replace(/Pokémon/gi,'Pokemon').replace(/\s+/g,' ').trim() : '';
const number = value => { const n=typeof value==='string' && /^\d+$/.test(value)?Number(value):value; return Number.isSafeInteger(n)&&n>=0&&n<=10000?n:null; };
const amounts = Object.freeze({ a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6, seven:7 });
const count = value => amounts[value.toLowerCase()] ?? Number(value);
const meaningful = value => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
const image = value => typeof value === 'string' && (/^https:\/\/assets\.tcgdex\.net\/[a-zA-Z0-9/_\-.]+$/.test(value)||/^\/api\/public\/catalogue\/artwork\/[a-f0-9]+$/.test(value)) ? value : null;
function modifier(values, resistance=false) {
  if(values==null) return [];
  if(!Array.isArray(values)||values.length>2||new Set(values.map(v=>v?.type)).size!==values.length)throw Error('Weakness/resistance is incomplete.');
  return values.map(v=>{
    if(!ENERGY_TYPES.includes(v.type))throw Error('Unsupported Weakness/resistance type.');
    const s=String(v.value??'').replace('×','x');
    if(!/^(?:x2|\+[1234]0|-[1234]0)$/.test(s)||(resistance&&!s.startsWith('-')))throw Error('Unsupported Weakness/resistance modifier.');
    return {type:v.type,value:s};
  });
}
export function attackProgram(attack) {
  if(!attack || !Array.isArray(attack.cost)||attack.cost.length>8||!attack.cost.every(t=>ENERGY_TYPES.includes(t)))throw Error('Attack Energy cost is missing or unsupported.');
  const name=norm(attack.name);if(!name||name.length>150)throw Error('Attack name is missing.');
  const printed=attack.damage==null?'':String(attack.damage).replace('×','x');
  const match=printed.match(/^(\d+)([+x]?)$/);let damage=match?Number(match[1]):0;
  if((printed&&!match)||damage>1000||damage%10)throw Error('Attack has a damage formula that is not implemented.');
  let effect=norm(attack.effect),effects=[],formula=match?.[2]||'';
  const whole=(re,build)=>{const m=effect.match(re);if(!m)return false;effects.push(build(m));effect='';return true;};
  if(effect) {
    whole(/^Flip (?:a|1) coin\. If (?:it is |it's )?heads, (?:your opponent's Active Pokemon|the Defending Pokemon) is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\.$/i,m=>({kind:'coin_condition',condition:m[1].toLowerCase()})) ||
    whole(/^Flip (?:a|1) coin\. If (?:it is |it's )?tails, this attack does nothing\.$/i,()=>({kind:'coin_gate'})) ||
    whole(/^Flip (\d+|two|three|four) coins?\. This attack does (\d+) damage (?:times|for) (?:the number of |each )heads\.$/i,m=>({kind:'coin_damage',coins:count(m[1]),per:Number(m[2])})) ||
    whole(/^Flip (?:a|1) coin\. If (?:it is |it's )?heads, this attack does (\d+) more damage\.$/i,m=>({kind:'coin_bonus',amount:Number(m[1])}));
  }
  if(effect) {
    // Match complete sentences one at a time. Unconsumed punctuation/text rejects the whole card.
    const clauses=effect.split(/(?<=\.)\s+/);
    for(const clause of clauses){let m;
      if((m=clause.match(/^(?:Your opponent's Active Pokemon|The Defending Pokemon) is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\.$/i))) effects.push({kind:'condition',condition:m[1].toLowerCase()});
      else if((m=clause.match(/^Flip (?:a|1) coin\. If (?:it is |it's )?heads, (?:your opponent's Active Pokemon|the Defending Pokemon) is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\.$/i))) effects.push({kind:'coin_condition',condition:m[1].toLowerCase()});
      else if((m=clause.match(/^This Pokemon also does (\d+) damage to itself\.$/i)))effects.push({kind:'recoil',amount:Number(m[1])});
      else if((m=clause.match(/^Heal (\d+) damage from this Pokemon\.$/i)))effects.push({kind:'heal_self',amount:Number(m[1])});
      else if((m=clause.match(/^Draw (a|one|two|three|\d+) cards?\.$/i)))effects.push({kind:'draw',count:count(m[1])});
      else if((m=clause.match(/^Discard (a|an|one|two|three|\d+) (Fire |Water |Grass |Lightning |Psychic |Fighting |Darkness |Metal )?Energy (?:cards? )?(?:attached to|from) this Pokemon\.$/i)))effects.push({kind:'discard_energy',count:count(m[1]),type:m[2]?.trim()||null});
      else throw Error('An attack effect is not implemented: '+clause.slice(0,110));
    }
  }
  // Coin-condition clauses contain two sentences; handle the entire phrase explicitly.
  if(formula==='x'&&!effects.some(e=>e.kind==='coin_damage'))throw Error('Multiplying damage requires an implemented formula.');
  if(formula==='+'&&!effects.some(e=>e.kind==='coin_bonus'))throw Error('Additional damage formula is not implemented.');
  if(effects.some(e=>e.amount!=null&&(e.amount<0||e.amount>1000||e.amount%10)||e.count!=null&&(!Number.isInteger(e.count)||e.count<1||e.count>10)||e.coins!=null&&(e.coins<1||e.coins>8)))throw Error('Attack effect exceeds the supported bound.');
  if(effects.some(e=>e.kind==='coin_damage'&&(!Number.isInteger(e.per)||e.per<0||e.per>1000||e.per%10)))throw Error('Invalid coin damage.');
  if(effects.filter(e=>e.kind==='discard_energy').length>1)throw Error('Multiple Energy discard clauses require a reviewed implementation.');
  if(effects.some(e=>e.kind==='coin_damage'))damage=0;
  return {name,cost:[...attack.cost],damage,printed:printed||'—',text:norm(attack.effect),effects};
}
function trainerProgram(raw) {
  const kind=raw.trainerType;if(!['Item','Supporter'].includes(kind))throw Error('Tools, Stadiums and other Trainer classes need individual implementations.');
  const effect=norm(raw.effect);let m,program;
  if((m=effect.match(/^Draw (\d+|two|three) cards\.$/i)))program={kind:'draw',count:count(m[1])};
  else if((m=effect.match(/^Discard your hand and draw (\d+|seven) cards\.$/i)))program={kind:'discard_draw',count:count(m[1])};
  else if((m=effect.match(/^Shuffle your hand into your deck\. Then,? draw (\d+|six) cards\.$/i)))program={kind:'shuffle_draw',count:count(m[1])};
  else if((m=effect.match(/^Heal (\d+) damage from (?:1|one) of your Pokemon\.$/i)))program={kind:'heal',amount:Number(m[1])};
  else if(/^Switch your Active Pokemon with (?:1|one) of your Benched Pokemon\.$/i.test(effect))program={kind:'switch'};
  else if(/^Switch (?:1|one) of your opponent's Benched Pokemon with their Active Pokemon\.$/i.test(effect))program={kind:'gust'};
  else if((m=effect.match(/^Search your deck for (?:a|1) (Basic Pokemon|basic Energy card|Pokemon), reveal it,? and put it into your hand\. Then,? shuffle your deck\.$/i)))program={kind:'search',filter:m[1].toLowerCase()==='basic pokemon'?'basic':m[1].toLowerCase()==='pokemon'?'pokemon':'energy',count:1};
  else if((m=effect.match(/^You can (?:use|play) this card only if you discard (?:2|two) other cards from your hand\. Search your deck for (?:a|1) Pokemon, reveal it,? and put it into your hand\. Then,? shuffle your deck\.$/i)))program={kind:'search',filter:'pokemon',count:1,discard:2};
  else if((m=effect.match(/^Put (?:up to )?(\d+|two) basic Energy cards from your discard pile into your hand\.$/i)))program={kind:'recover',filter:'energy',count:count(m[1]),optional:/up to /i.test(effect)};
  else throw Error('This Trainer effect is not implemented.');
  if(program.count!=null&&(!Number.isInteger(program.count)||program.count<1||program.count>7))throw Error('Trainer count is unsupported.');
  if(program.amount!=null&&(program.amount%10||program.amount<10||program.amount>200))throw Error('Healing amount is unsupported.');
  return {...program,trainerType:kind,text:effect};
}
export function compileArenaCard(row) {
  const raw=row?.raw_data || {},name=norm(row?.name || raw.name);
  const out={id:row?.id,name,image_url:image(row?.image_url),set_name:norm(row?.set_name),number:String(row?.local_id||''),game:'pokemon',language:'en',compiler:ARENA_VERSION};
  try {
    if(row?.game!=='pokemon'||row?.language!=='en'||!row?.id||!name)throw Error('Use a local English Pokémon record.');
    if(['item','rule','rules','abilities','ability','ancientTrait','ancient_trait','tera','teraType'].some(key=>meaningful(raw[key]))||raw.level==='X'||raw.retreatCost)throw Error('This card has an ability, special rule or mechanic requiring its own implementation.');
    if(raw.category==='Energy') {
      if(raw.energyType!=='Normal'&&raw.energyType!=='Basic')throw Error('Special Energy is not implemented.');
      const type=ENERGY_TYPES.find(t=>['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Fairy'].includes(t)&&new RegExp('^(?:Basic )?'+t+' Energy$','i').test(name));
      if(!type)throw Error('The Basic Energy type is not verified.');
      // Basic Energy commonly has a printed rules reminder; never use Special Energy here.
      return {supported:true,card:{...out,kind:'energy',type,basic_energy:true}};
    }
    if(raw.category==='Trainer') {
      if(raw.suffix||raw.regulationMark==='ACE SPEC')throw Error('This Trainer has an unimplemented special rule.');
      return {supported:true,card:{...out,kind:'trainer',program:trainerProgram(raw)}};
    }
    if(raw.category!=='Pokemon')throw Error('Unknown gameplay category.');
    if(raw.suffix || /(?:^Radiant |(?:^|\s)(?:ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.?X)\s*$|[★◇])/i.test(name) || meaningful(raw.effect))throw Error('Rule-box Pokémon and additional Pokémon effects need a reviewed implementation; this card is not in Casual Core yet.');
    if(!['Basic','Stage1','Stage2'].includes(raw.stage))throw Error('This evolution stage is not implemented.');
    const hp=number(raw.hp),retreat=number(raw.retreat);
    if(!hp||hp>500||hp%10||retreat===null||retreat>5||!Array.isArray(raw.types)||raw.types.length!==1||!ENERGY_TYPES.includes(raw.types[0]))throw Error('HP, type or retreat information is incomplete.');
    if(!Array.isArray(raw.attacks)||raw.attacks.length<1||raw.attacks.length>3)throw Error('Attack data is incomplete.');
    const evolves_from=raw.stage==='Basic'?null:norm(raw.evolveFrom);if(raw.stage!=='Basic'&&!evolves_from)throw Error('Evolution predecessor is missing.');
    return {supported:true,card:{...out,kind:'pokemon',type:raw.types[0],stage:raw.stage,hp,retreat,evolves_from,prizes:1,
      weakness:modifier(raw.weaknesses),resistance:modifier(raw.resistances,true),attacks:raw.attacks.map(attackProgram)}};
  }catch(error){return {supported:false,card:out,reason:String(error.message)};}
}
export function deckValidation(rows) {
  const errors=[],names=new Map();let total=0,basics=0;
  if(!Array.isArray(rows)||rows.length>60)return {playable:false,total:0,errors:['A deck may contain at most 60 different cards.']};
  for(const row of rows){
    if(!row?.card||row.card.compiler!==ARENA_VERSION||!['pokemon','energy','trainer'].includes(row.card.kind)||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>60){errors.push('Every deck entry must be a supported card and a positive quantity.');continue;}
    total+=row.quantity;if(row.card.kind==='pokemon'&&row.card.stage==='Basic')basics+=row.quantity;
    if(!row.card.basic_energy){const name=norm(row.card.name).toLowerCase();names.set(name,(names.get(name)||0)+row.quantity);}
  }
  if(total!==ARENA_LIMITS.deck)errors.push('Use exactly 60 cards.');
  if(!basics)errors.push('Include at least one Basic Pokémon.');
  for(const [name,n]of names)if(n>4)errors.push(`More than four copies of ${name}, including artwork variants.`);
  return {playable:errors.length===0,total,basics,errors,format:ARENA_VERSION};
}
export function cardFingerprint(raw) { return createHash('sha256').update(JSON.stringify(raw)).digest('hex'); }
