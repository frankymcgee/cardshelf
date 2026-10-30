/** Strict, whole-text templates. Never infer effects from a card's name. */
import { createHash } from 'node:crypto';
import { arenaGame } from '../../shared/arena-games.mjs';
import { gameFromCardId } from '../../shared/games.mjs';
const norm = value => typeof value==='string'?value.replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim():'';
const count = value => ({a:1,one:1,two:2,three:3,four:4})[value] ?? Number(value);
const integer = (value,min,max) => (typeof value==='number'||typeof value==='string'&&/^\d+$/.test(value))&&Number.isInteger(Number(value))&&Number(value)>=min&&Number(value)<=max;
const need = (ok,message) => { if(!ok)throw Error(message); };
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function sharedEffect(game,kind,text,name) {
  const t=norm(text), self=t.split(norm(name)).join('~'); let m,program;
  if(game==='mtg') {
    if((m=self.match(/^~ deals ([1-9]\d?) damage to (any target|target creature|target player|target opponent)\.$/)))program={kind:'damage',amount:Number(m[1]),target:({'any target':'any','target creature':'creature','target player':'player','target opponent':'opponent'})[m[2]]};
    else if((m=t.match(/^Draw (a|one|two|three|four|[1-9]) cards?\.$/)))program={kind:'draw',amount:count(m[1])};
    else if((m=t.match(/^You gain ([1-9]\d?) life\.$/)))program={kind:'heal',amount:Number(m[1])};
    else if(t==='Destroy target creature.')program={kind:'destroy',target:'creature'};
  } else if(game==='yugioh'&&kind==='spell') {
    if((m=t.match(/^Draw ([1-3]) cards?\.$/)))program={kind:'draw',amount:Number(m[1])};
    else if((m=t.match(/^(?:Inflict|Inflicts) ([1-9]\d{0,3}) (?:points of )?damage to your opponent(?:'s (?:LP|Life Points))?\.$/)))program={kind:'damage',amount:Number(m[1]),target:'opponent'};
    else if((m=t.match(/^(?:Increase your Life Points|Gain|You gain) (?:by )?([1-9]\d{0,3})(?: LP| Life Points)?\.$/)))program={kind:'heal',amount:Number(m[1])};
    else if(t==='Destroy all monsters your opponent controls.')program={kind:'destroy_all',side:'opponent'};
    else if(t==='Destroy all monsters on the field.')program={kind:'destroy_all',side:'both'};
  }
  need(program,'This complete effect text does not have a reviewed executable template yet.');
  return {...program,template:fingerprint({game,kind,text:self,program})};
}
export function compileGameCard(row,game) {
  const config=arenaGame(game),r=row?.raw_data||{},d=r.arena_data;
  const card={id:row?.id,name:row?.name,game,compiler:config?.version,number:row?.local_id,set_name:row?.set_name||'',
    image:typeof row?.image_url==='string'&&/^\/api\/public\/catalogue\/artwork\/[a-f0-9]+$/.test(row.image_url)?row.image_url:null,
    text:norm(r.public_text)};
  try {
    need(row?.game===game&&row.language==='en'&&gameFromCardId(row.id)===game,'Use an imported English card from this game.');
    need(d?.version===1,'Rules metadata is missing. Re-import this set through Game imports to update its stats.');
    need(typeof card.name==='string'&&card.name.length>0&&card.name.length<=200,'Card name is missing.');
    if(game==='yugioh') {
      if(d.type==='Normal Monster') {
        need(integer(d.level,1,12)&&integer(d.atk,0,9999)&&integer(d.def,0,9999),'Monster Level, ATK or DEF is missing.');
        Object.assign(card,{kind:'monster',level:Number(d.level),atk:Number(d.atk),def:Number(d.def),attribute:d.attribute,race:d.race});
      } else {
        need(d.type==='Spell Card'&&d.race==='Normal','Only Normal Monsters and reviewed Normal Spells are supported in this version.');
        card.kind='spell';card.program=sharedEffect(game,card.kind,card.text,card.name);
      }
    } else {
      need(d.layout==='normal'&&!d.is_funny&&!d.is_alternative&&(r.faces?.length??1)===1,'This layout or special card treatment is not supported.');
      need(Array.isArray(d.types)&&d.types.length===1&&['Land','Creature','Instant','Sorcery'].includes(d.types[0]),'This card type combination is not implemented.');
      need(Array.isArray(d.supertypes)&&d.supertypes.every(t=>t==='Basic'),'Legendary, snow and other special supertypes are not implemented.');
      card.kind=d.types[0].toLowerCase();
      if(card.kind==='land') {
        const colors={Plains:'W',Island:'U',Swamp:'B',Mountain:'R',Forest:'G',Wastes:'C'};
        need(d.supertypes.includes('Basic')&&Object.hasOwn(colors,card.name),'Only the six ordinary basic lands are supported.');
        need(!card.text||card.text===`{T}: Add {${colors[card.name]}}.`||/^\(.*\)$/.test(card.text),'This land has an additional effect.');
        Object.assign(card,{basic_land:true,mana_color:colors[card.name]});
      } else {
        need(!d.supertypes.length,'Unsupported supertype.');
        need(typeof d.mana_cost==='string'&&/^(?:\{(?:\d{1,2}|[WUBRGC])\})+$/.test(d.mana_cost),'Variable, hybrid, Phyrexian and missing mana costs are not implemented.');
        card.mana_cost=d.mana_cost;card.cost=d.mana_cost.match(/\{[^}]+\}/g).map(t=>t.slice(1,-1));
        if(card.kind==='creature') {
          need(integer(d.power,0,99)&&integer(d.toughness,1,99),'Variable power/toughness is not implemented.');
          // Reminder text must describe one of the admitted keywords, never hide a clause.
          const keywords=card.text?card.text.split(/,\s*|\n/).map(t=>t.toLowerCase()):[];
          need(keywords.every(k=>['flying','reach','haste','vigilance','defender'].includes(k)),'This creature has an ability outside the supported keyword pool.');
          Object.assign(card,{power:Number(d.power),toughness:Number(d.toughness),keywords});
        } else card.program=sharedEffect(game,card.kind,card.text,card.name);
      }
    }
    card.fingerprint=fingerprint({...card,source:r});
    return {supported:true,card,reason:''};
  } catch(error) {return {supported:false,card,reason:error.message};}
}
export function validateGameDeck(rows,game) {
  const config=arenaGame(game),errors=[],names=new Map();let total=0;
  if(!Array.isArray(rows)||rows.length>60)return {playable:false,total:0,errors:['Use a deck of at most 60 entries.']};
  for(const row of rows) {
    const {card,quantity}=row||{};
    if(!card||card.game!==game||card.compiler!==config.version||row.supported===false||!Number.isInteger(quantity)||quantity<1||quantity>60){errors.push('Every entry must be a supported card from the selected game.');continue;}
    total+=quantity;const name=norm(card.name).toLowerCase(),n=(names.get(name)||0)+quantity;names.set(name,n);
    if(!card.basic_land&&n>config.copies)errors.push(`Use no more than ${config.copies} copies of ${card.name}, across all printings.`);
  }
  if(total<config.min||total>config.max)errors.push(config.min===config.max?`This format requires exactly ${config.min} cards.`:`Use ${config.min}–${config.max} cards.`);
  return {playable:errors.length===0,total,errors:[...new Set(errors)]};
}
