// Pokémon-specific assisted state transitions. Add another table adapter, not game branches in the API.
import { randomInt, randomUUID } from 'node:crypto';
import { ensure } from '../../errors.mjs';
import { battleAdapter } from './index.mjs';
import { object, integer } from '../input.mjs';
import { BATTLE_CONDITIONS } from '../../../shared/battle.mjs';
export const SEATS = Object.freeze(['host', 'guest']);
const ZONES = Object.freeze(['deck','hand','prizes','active','bench','stadium','discard','lost']);
const FIELD = Object.freeze(['active','bench','stadium']);
const other = seat => seat === 'host' ? 'guest' : 'host';
function seatCheck(seat) { ensure(SEATS.includes(seat), 403, 'Only seated players can use this table.'); }
export function shuffle(items, rng = randomInt) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng(i + 1); integer(j, 0, i); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function resetCard(card) { return { token: randomUUID(), card: structuredClone(card.card), damage: 0, conditions: [], attachments: [] }; }
function pack(rows) {
  return rows.flatMap(r => Array.from({length:r.quantity}, () => ({ token:randomUUID(),card:structuredClone(r.card),damage:0,conditions:[],attachments:[] })));
}
function message(state, seat, text, cards = []) {
  state.log.push({ n: (state.log.at(-1)?.n ?? -1) + 1, seat, text, ...(cards.length ? {cards:cards.map(card=>({id:card.id,name:card.name,number:card.number,set_name:card.set_name}))} : {}) });
  state.log = state.log.slice(-150);
}
export function newBattle(game, decks, rng = randomInt) {
  const adapter = battleAdapter(game), players = {};
  for (const seat of SEATS) {
    ensure(adapter.validateDeck(decks[seat]).playable, 400, 'A playable saved deck is required for each player.');
    const deck = shuffle(pack(decks[seat]), rng);
    players[seat] = { deck:deck.slice(adapter.openingHand),hand:deck.slice(0,adapter.openingHand),prizes:[],active:[],bench:[],stadium:[],discard:[],lost:[],setup_ready:false,mulligans:0,bonus_remaining:0,searching:false };
  }
  const flip = rng(2); integer(flip,0,1);
  return { game, adapter_version:adapter.version, phase:'setup', setup_complete:false, players, coin_winner:SEATS[flip], first_chosen:false,
    turn:SEATS[flip], turn_number:1, actions:0, result:null, result_offer:null,
    log:[{n:0,seat:SEATS[flip],text:'Won the starting coin toss. Choose to go first or second. Opening hands were shuffled and dealt privately.'}] };
}
function locate(player, token) {
  ensure(typeof token === 'string', 400, 'Select a card.');
  for (const zone of ZONES) for (let i=0;i<player[zone].length;i++) {
    const item = player[zone][i];
    if (item.token === token) return {zone,index:i,item,parent:null};
    const child = item.attachments.findIndex(a => a.token === token);
    if (child >= 0) return {zone,index:child,item:item.attachments[child],parent:item};
  }
  ensure(false,409,'The selected card moved. Refresh the table.');
}
function remove(player, from) { if(from.parent) from.parent.attachments.splice(from.index,1); else player[from.zone].splice(from.index,1); }
function deal(player, count) {
  integer(count,1,10); ensure(!player.searching,409,'Finish searching and shuffle your deck first.');
  ensure(player.deck.length>=count,409,'Not enough cards remain. Resolve deck-out with your opponent; no result is declared automatically.');
  player.hand.push(...player.deck.splice(0,count).map(resetCard));
}
function finish(state, result, seat, label) {
  state.phase='finished'; state.result=result; state.result_offer=null;
  for(const s of SEATS) state.players[s].searching=false;
  message(state,seat,label);
}
export function applyBattleAction(original, seat, input, rng = randomInt) {
  seatCheck(seat); const adapter=battleAdapter(original.game,original.adapter_version);
  ensure(original.phase!=='finished',409,'This match has ended. Start a new match for a rematch.');
  const a=object(input,['type','token','to','target','count','index','damage','conditions','target_seat','first','result']);
  const allowed={choose_first:['first'],mulligan:[],reset_setup:[],setup_ready:[],draw:['count'],bonus:['count'],shuffle:[],search:[],end_search:[],
    move:['token','to','target'],evolve:['token','target'],swap:['token'],reveal:['token'],take_prize:['index'],
    counters:['token','target_seat','damage','conditions'],coin:[],die:[],end_turn:[],concede:[],offer_result:['result'],accept_result:[],decline_result:[]};
  ensure(Object.hasOwn(allowed,a.type)&&Object.keys(a).every(k=>k==='type'||allowed[a.type].includes(k)),400,'Unsupported table action or field.');
  // A bounded table cannot accumulate unbounded receipts; ending it is always possible.
  ensure(original.actions<2000||a.type==='concede',409,'This beta table reached its action limit. Concede and start another match.');
  const s=structuredClone(original),p=s.players[seat],op=s.players[other(seat)];s.actions++;
  const setup=s.phase==='setup';
  if(a.type==='concede'){finish(s,other(seat),seat,'Conceded the match.');return s;}
  if(a.type==='offer_result'){
    ensure(!setup&&['host','guest','draw'].includes(a.result),400,'Choose an agreed result during play.');
    s.result_offer={by:seat,result:a.result}; message(s,seat,`Proposed result: ${a.result}. Opponent confirmation is required.`);return s;
  }
  if(a.type==='accept_result'){
    ensure(s.result_offer&&s.result_offer.by!==seat,409,'There is no opponent result proposal to accept.');
    finish(s,s.result_offer.result,seat,'Accepted the proposed match result.');return s;
  }
  if(a.type==='decline_result'){
    ensure(s.result_offer,409,'No result proposal is pending.');s.result_offer=null;message(s,seat,'Cleared the proposed result.');return s;
  }
  if(a.type==='choose_first'){
    ensure(setup&&!s.first_chosen&&s.coin_winner===seat&&SEATS.includes(a.first),409,'Only the toss winner can choose who starts, once.');
    s.first_chosen=true;s.turn=a.first;message(s,seat,`Chose ${a.first} to go first.`);return s;
  }
  if(a.type==='mulligan'){
    ensure(setup&&!p.setup_ready&&p.active.length===0&&p.bench.length===0&&p.hand.length===adapter.openingHand&&!p.hand.some(c=>adapter.isBasic(c.card)),409,'Mulligan requires an opening hand with no Basic Pokémon and no cards placed.');
    const revealed=p.hand.map(c=>c.card);p.deck=shuffle([...p.deck,...p.hand].map(resetCard),rng);p.hand=p.deck.splice(0,adapter.openingHand);p.mulligans++;
    message(s,seat,'Revealed a no-Basic opening hand and took a mulligan.',revealed);return s;
  }
  if(a.type==='reset_setup'){
    ensure(setup&&!p.setup_ready,409,'The opening field is already locked.');
    p.hand.push(...p.active,...p.bench);p.active=[];p.bench=[];message(s,seat,'Returned their unconfirmed opening field to hand.');return s;
  }
  if(a.type==='setup_ready'){
    ensure(setup&&!p.setup_ready&&p.active.length===1&&s.first_chosen,409,'Choose who starts and place a Basic Active Pokémon before finishing setup.');
    p.setup_ready=true;message(s,seat,'Locked their face-down opening field.');
    if(op.setup_ready){
      for(const player of SEATS){const who=s.players[player];ensure(who.deck.length>=adapter.prizeCount,409,'Not enough cards for Prize cards.');who.prizes=who.deck.splice(0,adapter.prizeCount).map(resetCard);who.bonus_remaining=Math.max(0,s.players[other(player)].mulligans-who.mulligans);}
      s.phase='playing';s.setup_complete=true;message(s,seat,'Both opening fields are revealed. Six Prize cards each were placed face down. Resolve effects and turn actions manually.');
    }
    return s;
  }
  if(a.type==='coin'||a.type==='die'){
    const sides=a.type==='coin'?2:6,value=rng(sides);integer(value,0,sides-1);
    message(s,seat,a.type==='coin'?`Flipped ${value===0?'heads':'tails'}.`:`Rolled ${value+1}.`);return s;
  }
  if(a.type==='move'){
    const from=locate(p,a.token); ensure(a.to!==from.zone||a.target,400,'Choose a different zone or an attachment target.');
    ensure(['hand','deck','active','bench','stadium','discard','lost','attach'].includes(a.to),400,'Unsupported destination.');
    ensure(from.zone!=='prizes'&&(from.zone!=='deck'||p.searching),403,'Hidden cards are not selectable. Use Draw, Take prize or Search deck.');
    if(setup){
      ensure(!p.setup_ready&&from.zone==='hand'&&['active','bench'].includes(a.to)&&adapter.isBasic(from.item.card),409,'During setup, place Basic Pokémon from your hand before locking the field.');
    }
    let target=null;
    if(a.to==='attach'){
      target=locate(p,a.target);ensure(!setup&&['active','bench'].includes(target.zone)&&!target.parent&&target.item.token!==from.item.token&&!from.item.attachments.length,400,'Attach a single card to one of your field Pokémon.');
    }else ensure(a.target===undefined,400,'An attachment target is only used for Attach.');
    if(a.to==='active')ensure(p.active.length===0,409,'The Active spot is occupied. Use Switch active/bench.');
    if(a.to==='bench')ensure(p.bench.length<adapter.benchSize,409,'The five-card bench is full in this beta.');
    if(a.to==='stadium')ensure(p.stadium.length<8,409,'The resolving area is full. Move resolved cards to discard.');
    if(['active','bench'].includes(a.to))ensure(from.item.card.category==='Pokemon',400,'Only a Pokémon can occupy the Active spot or bench.');
    remove(p,from);
    if(target)target.item.attachments.push(resetCard(from.item));
    else if(FIELD.includes(a.to))p[a.to].push(from.item);
    else {
      const flattened=[from.item,...from.item.attachments].map(resetCard);
      // Returning a stack to a hidden/public pile explicitly moves every attached card too.
      if(a.to==='deck')p.deck.unshift(...flattened);else p[a.to].push(...flattened);
    }
    message(s,seat,`Moved ${from.parent?'an attached card':'a card/stack'} from ${from.zone} to ${a.to==='deck'?'top of deck':a.to}.`);return s;
  }
  ensure(!setup,409,'Finish opening setup before using this action.');
  if(a.type==='draw'||a.type==='bonus'){
    const count=integer(a.count,1,10);if(a.type==='bonus')ensure(count<=p.bonus_remaining,409,'That exceeds the remaining mulligan bonus.');
    deal(p,count);if(a.type==='bonus')p.bonus_remaining-=count;message(s,seat,`Drew ${count} ${a.type==='bonus'?'mulligan bonus ':''}card${count===1?'':'s'}.`);
  }else if(a.type==='take_prize'){
    integer(a.index,0,p.prizes.length-1);p.hand.push(resetCard(p.prizes.splice(a.index,1)[0]));message(s,seat,'Took one face-down Prize card into their hand.');
  }else if(a.type==='shuffle'||a.type==='end_search'){
    if(a.type==='end_search')ensure(p.searching,409,'No deck search is open.');
    p.deck=shuffle(p.deck.map(resetCard),rng);p.searching=false;message(s,seat,'Shuffled their deck; any search view is closed.');
  }else if(a.type==='search'){
    ensure(!p.searching,409,'A deck search is already open.');p.searching=true;message(s,seat,'Opened a private deck search. Resolve its permission/effect with your opponent.');
  }else if(a.type==='reveal'){
    const found=locate(p,a.token);ensure(found.zone==='hand'||(p.searching&&found.zone==='deck'),400,'Select a hand card or a card in your open deck search.');
    message(s,seat,'Revealed a card to their opponent.',[found.item.card]);
  }else if(a.type==='swap'){
    const found=locate(p,a.token);ensure(found.zone==='bench'&&!found.parent&&p.active.length===1,400,'Select a benched Pokémon to switch with your Active stack.');
    const current=p.active[0];p.active=[found.item];p.bench[found.index]=current;message(s,seat,'Switched their Active and benched stacks. Resolve retreat costs and conditions manually.');
  }else if(a.type==='evolve'){
    const from=locate(p,a.token),target=locate(p,a.target);
    ensure(from.zone==='hand'&&from.item.card.category==='Pokemon'&&['active','bench'].includes(target.zone)&&!target.parent,400,'Choose a hand Pokémon and one of your field Pokémon.');
    remove(p,from);const previous=target.item;
    from.item.attachments=[resetCard(previous),...previous.attachments];from.item.damage=previous.damage;from.item.conditions=[...previous.conditions];
    p[target.zone][target.index]=from.item;message(s,seat,'Placed a Pokémon over a field stack. Evolution legality and condition changes are player-resolved.');
  }else if(a.type==='counters'){
    seatCheck(a.target_seat);const target=locate(s.players[a.target_seat],a.token);
    ensure(['active','bench'].includes(target.zone)&&!target.parent,400,'Counters belong on public field Pokémon.');integer(a.damage,0,9990);
    ensure(a.damage%10===0&&Array.isArray(a.conditions)&&a.conditions.length<=5&&new Set(a.conditions).size===a.conditions.length&&a.conditions.every(c=>BATTLE_CONDITIONS.includes(c)),400,'Choose damage in multiples of 10 and supported condition markers.');
    target.item.damage=a.damage;target.item.conditions=[...a.conditions];
    message(s,seat,`Set ${a.target_seat}'s ${target.item.card.name} to ${a.damage} damage; conditions: ${a.conditions.join(', ')||'none'}.`);
  }else if(a.type==='end_turn'){
    ensure(s.turn===seat&&!p.searching&&!op.searching,409,'Only the indicated player may end a turn, after all searches are closed.');
    s.turn=other(seat);s.turn_number++;message(s,seat,'Ended their turn. Resolve between-turn checks and draw manually.');
  }
  return s;
}
function publicStack(item) {
  return {token:item.token,card:structuredClone(item.card),damage:item.damage,conditions:[...item.conditions],attachments:item.attachments.map(publicStack)};
}
export function battleView(state, seat) {
  seatCheck(seat);battleAdapter(state.game,state.adapter_version);
  const players={};
  for(const who of SEATS){
    const p=state.players[who],self=who===seat;
    const field=zone=>!state.setup_complete&&!self?p[zone].map(()=>({hidden:true})):p[zone].map(publicStack);
    players[who]={deck_count:p.deck.length,hand_count:p.hand.length,prize_count:p.prizes.length,
      hand:self?p.hand.map(publicStack):[],active:field('active'),bench:field('bench'),stadium:field('stadium'),
      discard:p.discard.map(publicStack),lost:p.lost.map(publicStack),setup_ready:p.setup_ready,mulligans:p.mulligans,
      searching:p.searching,bonus_remaining:self?p.bonus_remaining:0,
      // Even an authorized search sees a sorted list, never the hidden draw order.
      search:self&&p.searching?p.deck.map(publicStack).sort((a,b)=>a.card.name.localeCompare(b.card.name)||a.token.localeCompare(b.token)):[]};
  }
  return {game:state.game,adapter_version:state.adapter_version,phase:state.phase,seat,players,turn:state.turn,
    turn_number:state.turn_number,coin_winner:state.coin_winner,first_chosen:state.first_chosen,result:state.result,
    result_offer:state.result_offer?{...state.result_offer}:null,actions:state.actions,log:structuredClone(state.log)};
}
