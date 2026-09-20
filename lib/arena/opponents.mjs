/** Private practice opponents use the player's already-imported saved cards only. */
import { compileArenaCard, deckValidation } from './cards.mjs';
import { snapshotArenaDeck } from './decks.mjs';
import { energySatisfied } from './engine.mjs';
import { ARENA_VERSION } from '../../shared/arena.mjs';
import { check, oneOf } from './input.mjs';

const genuineDeck=(deck,version)=>deckValidation(deck?.cards,version).playable && deck.cards.every(({card})=>!card.training&&/^en:/.test(card.id));
// Match the engine's evolution-name comparison without conflating EX and ex.
const canonicalName=value=>{
  const name=String(value).normalize('NFKC'),suffix=name.match(/[-\s](EX|ex)$/)?.[1];
  return suffix?name.slice(0,-suffix.length).replace(/[-\s]+$/,'').toLowerCase()+' '+suffix:name.toLowerCase();
};
export function arenaDeckProfile(rows) {
  const out={pokemon:0,energy:0,trainers:0,basics:0,evolutions:0,hp:0,attackCost:0,damage:0,types:{}};
  for(const {card,quantity} of rows) {
    if(card.kind==='pokemon') {
      out.pokemon+=quantity;out[card.stage==='Basic'?'basics':'evolutions']+=quantity;out.hp+=card.hp*quantity;
      out.types[card.type]=(out.types[card.type]||0)+quantity;
      const attacks=card.attacks||[],n=Math.max(1,attacks.length);
      out.attackCost+=quantity*attacks.reduce((sum,a)=>sum+a.cost.length,0)/n;
      out.damage+=quantity*attacks.reduce((sum,a)=>sum+a.damage,0)/n;
    } else if(card.kind==='energy')out.energy+=quantity;
    else if(card.kind==='trainer')out.trainers+=quantity;
  }
  for(const field of ['hp','attackCost','damage'])out[field]/=Math.max(1,out.pokemon);
  for(const type of Object.keys(out.types))out.types[type]/=Math.max(1,out.pokemon);
  return out;
}
function distance(a,b) {
  const types=new Set([...Object.keys(a.types),...Object.keys(b.types)]);
  return Math.abs(a.pokemon-b.pokemon)/60 + Math.abs(a.energy-b.energy)/60 + Math.abs(a.trainers-b.trainers)/60
    + Math.abs(a.basics-b.basics)/20 + Math.abs(a.evolutions-b.evolutions)/20
    + Math.abs(a.hp-b.hp)/150 + Math.abs(a.attackCost-b.attackCost)/4 + Math.abs(a.damage-b.damage)/150
    + [...types].reduce((sum,type)=>sum+Math.abs((a.types[type]||0)-(b.types[type]||0)),0)/4;
}
function hasEvolutionLines(rows) {
  const pokemon=rows.filter(({card})=>card.kind==='pokemon').map(({card})=>card);
  return pokemon.every(card=>card.stage==='Basic'||pokemon.some(parent=>canonicalName(parent.name)===canonicalName(card.evolves_from)
    && parent.stage===(card.stage==='Stage2'?'Stage1':'Basic') && (card.stage!=='MegaEvolution'||parent.rule_box==='EX')));
}
function hasUsableEnergy(rows) {
  const energy=rows.filter(({card})=>card.kind==='energy').flatMap(({card,quantity})=>Array.from({length:quantity},()=>({card})));
  return rows.filter(({card})=>card.kind==='pokemon').every(({card})=>card.attacks.some(attack=>energySatisfied({energy},attack.cost)));
}
/** A composition heuristic, not a promise of competitive balance or tournament legality. */
export function chooseMatchedOpponent(own,candidates,version=ARENA_VERSION) {
  check(genuineDeck(own,version),'Practice requires a supported saved catalogue deck.',422);
  const profile=arenaDeckProfile(own.cards);
  const ranked=candidates.filter(candidate=>genuineDeck(candidate,version)&&hasEvolutionLines(candidate.cards)&&hasUsableEnergy(candidate.cards))
    .map(candidate=>({candidate,score:distance(profile,arenaDeckProfile(candidate.cards))}))
    .filter(item=>item.score<=1.5)
    .sort((a,b)=>a.score-b.score||String(a.candidate.id||a.candidate.title).localeCompare(String(b.candidate.id||b.candidate.title)));
  if(ranked.length) return {title:ranked[0].candidate.title,cards:structuredClone(ranked[0].candidate.cards),selection:'matched',source:'saved',
    reason:'Closest playable saved deck by Pokémon types, evolution mix and attack costs. Similar strength is not guaranteed.'};
  return mirrorOpponent(own,'matched');
}
function mirrorOpponent(own,selection) {
  return {title:own.title,cards:structuredClone(own.cards),selection,source:'mirror',reason:selection==='matched'
    ?'No comparable supported saved deck was available. The computer uses a separate copy of your deck.'
    :'The computer uses a separate copy of your saved deck.'};
}
export async function snapshotPracticeOpponent(sql,userId,own,request,version=ARENA_VERSION) {
  check(genuineDeck(own,version),'Practice requires a supported saved catalogue deck.',422);
  const selection=oneOf(request.opponent===undefined?'matched':request.opponent,['matched','mirror','saved']);
  if(selection==='mirror')return mirrorOpponent(own,selection);
  if(selection==='saved') {
    const deck=await snapshotArenaDeck(sql,userId,request.opponent_deck_id,request.opponent_deck_revision,version);
    check(genuineDeck(deck,version),'Choose a supported saved catalogue deck.',422);
    return {...deck,selection,source:'saved',reason:'The computer uses the saved opponent deck you selected.'};
  }
  // Both queries are bounded by the account's 40-deck limit. No other player's
  // decks, collection quantities or remote catalogue services are consulted.
  const decks=await sql`SELECT id,title,cards FROM arena_decks WHERE user_id=${userId} AND id<>${request.deck_id} ORDER BY id LIMIT 40`;
  const ids=[...new Set(decks.flatMap(deck=>deck.cards.map(card=>card.card_id)))];
  if(!ids.length)return mirrorOpponent(own,'matched');
  const rows=await sql`SELECT c.*,s.name AS set_name FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE c.id IN ${sql(ids)}`;
  const compiled=new Map(rows.map(row=>[row.id,compileArenaCard(row,version)]));
  const candidates=decks.flatMap(deck=>{
    if(!deck.cards.every(entry=>compiled.get(entry.card_id)?.supported))return [];
    return [{...deck,cards:deck.cards.map(entry=>({card:compiled.get(entry.card_id).card,quantity:entry.quantity}))}];
  });
  return chooseMatchedOpponent(own,candidates,version);
}
