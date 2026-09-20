import { randomBytes, createHash } from 'node:crypto';
import { db } from '../db.mjs';
import { requireArena, arenaEntitlement } from './access.mjs';
import { arenaUserLock, snapshotArenaDeck } from './decks.mjs';
import { newArena, applyArenaAction, arenaView, assertArena } from './engine.mjs';
import { driveCpu } from './bot.mjs';
import { trainingDeck } from './training.mjs';
import { ARENA_VERSION, ARENA_LIMITS } from '../../shared/arena.mjs';
import * as v from './input.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const activeStatus=['waiting','approval','ready','active'];
const seatFor=(row,userId)=>row.host_id===userId?0:row.guest_id===userId?1:null;
function requireSeat(row,userId){const seat=row&&seatFor(row,userId);v.check(seat===0||seat===1,'Match not found.',404);return seat;}
async function quota(sql,userId) {
  const [counts]=await sql`SELECT count(*) AS total,count(*) FILTER(WHERE status IN ('waiting','approval','ready','active')) AS active FROM arena_matches WHERE host_id=${userId} OR guest_id=${userId}`;
  v.check(Number(counts.active)<ARENA_LIMITS.activeMatches,'Finish or cancel an open match first. At most five active matches are allowed.',409);
  v.check(Number(counts.total)<2000,'The match archive limit has been reached. Contact the administrator before starting more matches.',409);
}
function matchView(row,userId,extra={}) {
  const seat=requireSeat(row,userId),own=seat===0?row.host_deck:row.guest_deck;
  return {id:row.id,mode:row.mode,difficulty:row.difficulty,version:row.engine_version,status:row.status,seat,
    host_alias:row.host_alias,guest_alias:row.guest_alias||'',revision:row.revision,host_ready:row.host_ready,guest_ready:row.guest_ready,
    own_deck:{title:own?.title||'',training:!!own?.training},updated_at:row.updated_at,
    table:row.state?.version?arenaView(row.state,seat):null,...extra};
}
async function checkBoth(sql,row) {
  v.check(await arenaEntitlement(row.host_id,sql),'The host needs active Collector or Collector Plus access. Saved matches are retained.',403);
  if(row.guest_id)v.check(await arenaEntitlement(row.guest_id,sql),'The opponent needs active Collector or Collector Plus access. Saved matches are retained.',403);
}
function snapshotTraining(theme='ember'){return {title:theme==='ember'?'Ember training deck':'Tide training deck',training:true,cards:trainingDeck(theme)};}
function drive(row,state) { return row.mode==='pvp'?state:driveCpu(state,{seat:1,difficulty:row.difficulty,max:32}).state; }
function statusOf(state) {return state.phase==='finished'?'finished':'active';}
async function saveRow(sql,row) {
  const [saved]=await sql`UPDATE arena_matches SET guest_id=${row.guest_id},guest_alias=${row.guest_alias},guest_deck=${row.guest_deck?sql.json(row.guest_deck):null},
    host_ready=${row.host_ready},guest_ready=${row.guest_ready},status=${row.status},invite_hash=${row.invite_hash},invite_expires_at=${row.invite_expires_at},
    state=${sql.json(row.state)},revision=revision+1,updated_at=now() WHERE id=${row.id} RETURNING *`;
  return saved;
}
export async function arenaMatchList(userId) {
  await requireArena(userId);
  const rows=await db()`SELECT id,host_id,guest_id,host_alias,guest_alias,mode,difficulty,status,revision,updated_at,state->'result' AS result,state->>'result_reason' AS result_reason
    FROM arena_matches WHERE host_id=${userId} OR guest_id=${userId} ORDER BY updated_at DESC LIMIT 100`;
  return {matches:rows.map(({host_id,guest_id,...row})=>({...row,seat:host_id===userId?0:1}))};
}
export async function getArenaMatch(userId,id) {
  v.uuid(id);await requireArena(userId);const [row]=await db()`SELECT * FROM arena_matches WHERE id=${id} AND (host_id=${userId} OR guest_id=${userId})`;
  return matchView(row,userId);
}
export async function createArenaMatch(userId,value) {
  const o=v.object(value,['mode','deck_id','deck_revision','training','alias','difficulty','request_id']);
  const mode=v.oneOf(o.mode,['pvp','practice','tutorial']),alias=v.text(o.alias,1,40),difficulty=v.oneOf(o.difficulty||'normal',['easy','normal']),requestId=v.uuid(o.request_id);
  v.check(o.training===undefined||typeof o.training==='boolean','Choose whether to use a training deck.');
  const training=mode==='tutorial'||o.training===true;
  v.check(!training||mode!=='pvp','Original training cards are for the tutorial and computer practice only.');
  v.check(!training||o.deck_id===undefined&&o.deck_revision===undefined,'Choose a saved deck or a training deck, not both.');
  if(!training){v.uuid(o.deck_id);v.integer(o.deck_revision,1);}
  const requestHash=hash(o);
  return db().begin(async sql=>{
    await requireArena(userId,sql,true);await arenaUserLock(sql,userId);
    const [old]=await sql`SELECT * FROM arena_matches WHERE host_id=${userId} AND request_id=${requestId}`;
    if(old){v.check(old.request_hash===requestHash,'This request ID was used for another match.',409);return matchView(old,userId);}
    await quota(sql,userId);
    const own=training?snapshotTraining():await snapshotArenaDeck(sql,userId,o.deck_id,o.deck_revision);
    const guest=mode==='pvp'?null:snapshotTraining('tide');
    let state={};if(guest)state=drive({mode,difficulty},newArena([own.cards,guest.cards],{mode}));
    const [row]=await sql`INSERT INTO arena_matches(host_id,host_alias,guest_alias,mode,difficulty,status,host_deck,guest_deck,state,request_id,request_hash,engine_version)
      VALUES(${userId},${alias},${guest?'Training partner':null},${mode},${difficulty},${guest?statusOf(state):'waiting'},${sql.json(own)},${guest?sql.json(guest):null},${sql.json(state)},${requestId},${requestHash},${ARENA_VERSION}) RETURNING *`;
    return matchView(row,userId);
  });
}
export async function joinArenaMatch(userId,value) {
  const o=v.object(value,['code','deck_id','deck_revision','alias','request_id']);
  v.check(typeof o.code==='string'&&/^[a-f0-9]{48}$/i.test(o.code.trim()),'Enter the invitation code.');
  const code=o.code.trim().toLowerCase(),alias=v.text(o.alias,1,40),requestId=v.uuid(o.request_id);v.uuid(o.deck_id);v.integer(o.deck_revision,1);
  const requestHash=hash({...o,code});
  return db().begin(async sql=>{
    await requireArena(userId,sql,true);await arenaUserLock(sql,userId);
    const [receipt]=await sql`SELECT match_id,request_hash FROM arena_receipts WHERE user_id=${userId} AND request_id=${requestId}`;
    if(receipt){v.check(receipt.request_hash===requestHash,'This request ID was used for a different action.',409);const [r]=await sql`SELECT * FROM arena_matches WHERE id=${receipt.match_id}`;return matchView(r,userId);}
    await quota(sql,userId);
    const [row]=await sql`SELECT * FROM arena_matches WHERE invite_hash=${digest(code)} AND invite_expires_at>now() FOR UPDATE`;
    v.check(row&&row.mode==='pvp'&&row.status==='waiting'&&row.host_id!==userId,'This invitation is unavailable or expired.',404);
    await checkBoth(sql,row);
    row.guest_deck=await snapshotArenaDeck(sql,userId,o.deck_id,o.deck_revision);row.guest_id=userId;row.guest_alias=alias;
    row.status='approval';row.invite_hash=null;row.invite_expires_at=null;row.host_ready=false;row.guest_ready=false;
    const saved=await saveRow(sql,row);
    await sql`INSERT INTO arena_receipts(match_id,user_id,request_id,request_hash) VALUES(${row.id},${userId},${requestId},${requestHash})`;
    return matchView(saved,userId);
  });
}
export async function actArenaMatch(userId,id,value) {
  v.uuid(id);const o=v.object(value,['revision','request_id','action']);v.integer(o.revision,1);const requestId=v.uuid(o.request_id);
  const a=v.object(o.action,['type','seat','card','zone','target','index','choices']);v.check(typeof a.type==='string','Choose an action.');
  const requestHash=hash({id,...o});
  return db().begin(async sql=>{
    await requireArena(userId,sql,true);
    const [row]=await sql`SELECT * FROM arena_matches WHERE id=${id} AND (host_id=${userId} OR guest_id=${userId}) FOR UPDATE`;
    const seat=requireSeat(row,userId);
    const [receipt]=await sql`SELECT request_hash FROM arena_receipts WHERE user_id=${userId} AND request_id=${requestId}`;
    if(receipt){v.check(receipt.request_hash===requestHash,'This request ID was used for a different action.',409);return matchView(row,userId,{replayed:true});}
    v.check(row.revision===o.revision,'The table changed. Review the refreshed table before acting.',409);
    v.check(!['finished','cancelled'].includes(row.status),'This match has ended.',409);
    v.check(row.engine_version===ARENA_VERSION,'This engine version must remain installed to resume the match.',409);
    const extra={};
    const lobby=['invite','approve','reject','leave','ready','unready','start','cancel'];
    if(lobby.includes(a.type)&&row.status!=='active') {
      v.check(Object.keys(a).length===1,'Unexpected lobby action fields.');
      if(a.type==='cancel') {v.check(seat===0,'Only the host can cancel this lobby.',403);row.status='cancelled';row.invite_hash=null;row.invite_expires_at=null;}
      else if(a.type==='invite') {
        v.check(seat===0&&row.status==='waiting','An invitation can be issued only by a waiting host.',409);
        extra.invite_code=randomBytes(24).toString('hex');row.invite_hash=digest(extra.invite_code);row.invite_expires_at=new Date(Date.now()+86400000);
      } else if(a.type==='approve') {v.check(seat===0&&row.status==='approval','No opponent is awaiting approval.',409);await checkBoth(sql,row);row.status='ready';}
      else if(a.type==='reject'||a.type==='leave') {
        v.check(a.type==='reject'?seat===0&&row.status==='approval':seat===1,'This lobby action is unavailable.',409);
        row.guest_id=null;row.guest_alias=null;row.guest_deck=null;row.host_ready=false;row.guest_ready=false;row.status='waiting';row.invite_hash=null;row.invite_expires_at=null;
        if(seat===1)extra.left=true;
      } else if(['ready','unready'].includes(a.type)) {
        v.check(row.status==='ready','Wait for host approval.',409);await checkBoth(sql,row);row[seat===0?'host_ready':'guest_ready']=a.type==='ready';
      } else if(a.type==='start') {
        v.check(seat===0&&row.status==='ready'&&row.host_ready&&row.guest_ready,'Both players must be ready before starting.',409);await checkBoth(sql,row);
        row.state=newArena([row.host_deck.cards,row.guest_deck.cards],{mode:'pvp'});row.status='active';
      }
    } else {
      v.check(row.status==='active','Start the match before using game actions.',409);
      // A player can concede even when the opponent's paid period has expired.
      if(a.type!=='concede')await checkBoth(sql,row);
      if(a.type==='cpu_step'||a.type==='autoplay') {
        v.check(Object.keys(a).length===1&&row.mode!=='pvp'&&seat===0,'Computer controls are only available in solo practice.',403);
        row.state=a.type==='autoplay'?driveCpu(row.state,{seat:0,difficulty:row.difficulty,max:32}).state:row.state;
        row.state=drive(row,row.state);
      } else row.state=drive(row,applyArenaAction(row.state,seat,a));
      assertArena(row.state);row.status=statusOf(row.state);
    }
    const saved=await saveRow(sql,row);
    await sql`INSERT INTO arena_receipts(match_id,user_id,request_id,request_hash) VALUES(${id},${userId},${requestId},${requestHash})`;
    return extra.left?{left:true}:matchView(saved,userId,extra);
  });
}
