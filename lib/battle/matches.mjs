import { randomBytes } from 'node:crypto';
import { db } from '../db.mjs';
import { ensure } from '../errors.mjs';
import { requireBattle } from './access.mjs';
import { battleUserLock,matchDeck } from './decks.mjs';
import { newBattle,applyBattleAction,battleView } from './engine.mjs';
import * as input from './input.mjs';
const code=()=>randomBytes(16).toString('hex');
function seatOf(row,userId) { ensure(row&&(row.host_id===userId||row.guest_id===userId),404,'Match not found.');return row.host_id===userId?'host':'guest'; }
function project(row,userId) {
  const seat=seatOf(row,userId),deck=seat==='host'?row.host_deck:row.guest_deck;
  return {id:row.id,game:row.game,status:row.status,revision:row.revision,seat,
    host_alias:row.host_alias,guest_alias:row.guest_alias,host_ready:row.host_ready,guest_ready:row.guest_ready,
    own_deck:deck?{title:deck.title,validation:deck.validation}:null,
    invite_expires_at:seat==='host'?row.invite_expires_at:null,
    table:['active','finished'].includes(row.status)?battleView(row.state,seat):null,updated_at:row.updated_at};
}
async function limitMatches(sql,userId) {
  const [counts]=await sql`SELECT count(*) FILTER (WHERE status NOT IN ('finished','cancelled'))::integer AS active,count(*)::integer AS total
    FROM battle_matches WHERE host_id=${userId} OR guest_id=${userId}`;
  ensure(counts.active<5,409,'Finish or cancel an open match first (five per player in this beta).');
  ensure(counts.total<500,409,'The beta history limit was reached. Ask your administrator before starting more matches.');
}
function joinFields(o) {
  input.uuid(o.deck_id);input.integer(o.deck_revision,1);input.uuid(o.request_id);input.text(o.alias,'player alias',1,40);
  ensure(o.confirm_assisted===true,400,'Confirm casual assisted play and that your player alias will be shared with your opponent.');
}
export async function listMatches(userId) {
  await requireBattle(userId);const rows=await db()`SELECT id,game,status,host_id,guest_id,host_alias,guest_alias,updated_at FROM battle_matches WHERE host_id=${userId} OR guest_id=${userId} ORDER BY updated_at DESC LIMIT 50`;
  return {matches:rows.map(row=>({id:row.id,game:row.game,status:row.status,seat:row.host_id===userId?'host':'guest',host_alias:row.host_alias,guest_alias:row.guest_alias,updated_at:row.updated_at}))};
}
export async function getMatch(userId,id) {
  input.uuid(id);await requireBattle(userId);const [row]=await db()`SELECT * FROM battle_matches WHERE id=${id} AND (host_id=${userId} OR guest_id=${userId})`;
  return project(row,userId);
}
export async function createMatch(userId,value) {
  const o=input.object(value,['deck_id','deck_revision','alias','request_id','confirm_assisted']);joinFields(o);
  return db().begin(async sql=>{
    await requireBattle(userId,sql,true);await battleUserLock(sql,userId);
    const [previous]=await sql`SELECT * FROM battle_matches WHERE host_id=${userId} AND create_request_id=${o.request_id}`;
    if(previous){ensure(previous.create_hash===input.hash(o),409,'This match request ID was already used for different data.');return {...project(previous,userId),replayed:true};}
    await limitMatches(sql,userId);const deck=await matchDeck(sql,userId,o.deck_id,o.deck_revision),invite=code();
    const [row]=await sql`INSERT INTO battle_matches(host_id,game,host_alias,host_deck,invite_hash,create_request_id,create_hash)
      VALUES(${userId},'pokemon',${o.alias.trim()},${sql.json(deck)},${input.hash(invite)},${o.request_id},${input.hash(o)}) RETURNING *`;
    return {...project(row,userId),invite_code:invite};
  });
}
export async function joinMatch(userId,value) {
  const o=input.object(value,['deck_id','deck_revision','alias','request_id','invite_code','confirm_assisted']);joinFields(o);
  const invitation=input.code(o.invite_code),requestHash=input.hash(o);
  return db().begin(async sql=>{
    await requireBattle(userId,sql,true);await battleUserLock(sql,userId);
    const [prior]=await sql`SELECT match_id,request_hash FROM battle_requests WHERE user_id=${userId} AND request_id=${o.request_id}`;
    if(prior){ensure(prior.request_hash===requestHash,409,'This request ID was already used for different match details.');
      const [existing]=await sql`SELECT * FROM battle_matches WHERE id=${prior.match_id}`;return project(existing,userId);}
    await limitMatches(sql,userId);
    const [row]=await sql`SELECT * FROM battle_matches WHERE invite_hash=${input.hash(invitation)} FOR UPDATE`;
    ensure(row&&row.host_id!==userId&&row.status==='waiting'&&Date.parse(row.invite_expires_at)>Date.now(),409,'The invitation is invalid, expired or already in use.');
    await requireBattle(row.host_id,sql);
    const deck=await matchDeck(sql,userId,o.deck_id,o.deck_revision);
    const [saved]=await sql`UPDATE battle_matches SET guest_id=${userId},guest_alias=${o.alias.trim()},guest_deck=${sql.json(deck)},status='approval',
      revision=revision+1,updated_at=now() WHERE id=${row.id} RETURNING *`;
    await sql`INSERT INTO battle_requests(match_id,user_id,request_id,request_hash) VALUES(${row.id},${userId},${o.request_id},${requestHash})`;
    return project(saved,userId);
  });
}
export async function actOnMatch(userId,id,value) {
  input.uuid(id);const o=input.envelope(value),requestHash=input.hash(o);
  return db().begin(async sql=>{
    await requireBattle(userId,sql,true);await battleUserLock(sql,userId);
    const [row]=await sql`SELECT * FROM battle_matches WHERE id=${id} AND (host_id=${userId} OR guest_id=${userId}) FOR UPDATE`;
    const seat=seatOf(row,userId),type=o.action.type;
    const [prior]=await sql`SELECT match_id,request_hash FROM battle_requests WHERE user_id=${userId} AND request_id=${o.request_id}`;
    if(prior){ensure(prior.match_id===id&&prior.request_hash===requestHash,409,'This action ID was already used for different data.');return {...project(row,userId),replayed:true};}
    ensure(row.revision===o.revision,409,'The table changed. Refresh and review before acting again.');
    ensure(!['finished','cancelled'].includes(row.status),409,'This match is closed.');
    const [count]=await sql`SELECT count(*)::integer AS n FROM battle_requests WHERE match_id=${id}`;
    ensure(count.n<2200||['concede','cancel','leave'].includes(type),409,'This beta match reached its request limit. End it and create a new match.');
    let invitation=null,left=false;
    if(row.status==='active'){
      if(type!=='concede')await requireBattle(seat==='host'?row.guest_id:row.host_id,sql);
      row.state=applyBattleAction(row.state,seat,o.action);if(row.state.phase==='finished')row.status='finished';
    }else{
      input.object(o.action,['type']);
      if(type==='cancel'){ensure(seat==='host',403,'Only the host can cancel the lobby.');row.status='cancelled';row.invite_hash=null;}
      else if(type==='leave'||type==='reject'){
        ensure(type==='leave'?seat==='guest':seat==='host'&&row.status==='approval',403,'That lobby action is not available.');
        row.guest_id=null;row.guest_alias=null;row.guest_deck=null;row.host_ready=false;row.guest_ready=false;row.status='waiting';row.invite_hash=null;left=type==='leave';
      }else if(type==='invite'){
        ensure(seat==='host'&&row.status==='waiting',409,'Invitations can be renewed only for an empty lobby.');
        invitation=code();row.invite_hash=input.hash(invitation);row.invite_expires_at=new Date(Date.now()+86400000);
      }else if(type==='approve'){
        ensure(seat==='host'&&row.status==='approval',409,'No opponent is waiting for approval.');await requireBattle(row.guest_id,sql);row.status='lobby';row.invite_hash=null;
      }else if(type==='ready'||type==='unready'){
        ensure(row.status==='lobby',409,'The host must approve the opponent first.');row[seat+'_ready']=type==='ready';
      }else if(type==='start'){
        ensure(seat==='host'&&row.status==='lobby'&&row.host_ready&&row.guest_ready,409,'Both approved players must be ready before the host starts.');
        await requireBattle(row.guest_id,sql);row.state=newBattle(row.game,{host:row.host_deck.cards,guest:row.guest_deck.cards});row.status='active';row.invite_hash=null;
      }else ensure(false,400,'Unsupported lobby action.');
    }
    const [saved]=await sql`UPDATE battle_matches SET guest_id=${row.guest_id},guest_alias=${row.guest_alias},guest_deck=${row.guest_deck?sql.json(row.guest_deck):null},
      status=${row.status},host_ready=${row.host_ready},guest_ready=${row.guest_ready},state=${sql.json(row.state)},
      invite_hash=${row.invite_hash},invite_expires_at=${row.invite_expires_at},revision=revision+1,updated_at=now() WHERE id=${id} RETURNING *`;
    await sql`INSERT INTO battle_requests(match_id,user_id,request_id,request_hash) VALUES(${id},${userId},${o.request_id},${requestHash})`;
    return left?{left:true,id}:{...project(saved,userId),...(invitation?{invite_code:invitation}:{})};
  });
}
