import { db,collectionLock,audit } from './db.mjs';
import { membershipState } from './membership.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { GAME_CODES,GAMES,gameAccess,canManageGame } from '../shared/games.mjs';
export async function accountGames(userId,sql=db()) {
  const state=await membershipState(userId,sql);
  const [choice]=await sql`SELECT game,revision FROM account_game_choices WHERE user_id=${userId}`;
  return {...gameAccess(state),tier:state.access.tier,selected:choice?.game??'pokemon',revision:choice?.revision??0,
    games:GAMES.map(game=>({...game,manageable:canManageGame(state,game.code,choice?.game??'pokemon')}))};
}
// Call inside the write transaction after acquiring collectionLock(userId).
// The selection endpoint uses the same per-user lock, preventing a concurrent
// switch from authorising writes to two different games at once.
export async function requireGame(sql,userId,game) {
  v.oneOf(game,'Card game',GAME_CODES);
  const state=await membershipState(userId,sql);
  const [choice]=await sql`SELECT game FROM account_game_choices WHERE user_id=${userId}`;
  ensure(canManageGame(state,game,choice?.game??'pokemon'),403,
    state.access.tier==='free'?'Free includes the public catalogue. A Collector membership is required to manage binders.':
    'Collector manages one selected game. Choose it under Account → Card games, or use Collector Pro. Existing records remain readable.');
}
export async function requirePrintingGame(sql,userId,printingId) {
  const [p]=await sql`SELECT c.game FROM printings p JOIN cards c ON c.id=p.card_id WHERE p.id=${printingId}`;
  ensure(p,404,'Printing not found.');await requireGame(sql,userId,p.game);return p.game;
}
export async function chooseGame(userId,input) {
  const o=v.object(input);
  ensure(Object.keys(o).every(key=>['game','revision','confirm_read_only'].includes(key)),400,'Unsupported game selection field.');
  const game=v.oneOf(o.game,'Card game',GAME_CODES),revision=v.integer(o.revision,'Revision',0,Number.MAX_SAFE_INTEGER);
  ensure(o.confirm_read_only===true,400,'Confirm that other games will become read-only on Collector. No data will be deleted.');
  return db().begin(async sql=>{
    await collectionLock(sql,userId);
    const state=await accountGames(userId,sql);
    ensure(['single','unlimited'].includes(state.mode),403,'An active Collector membership is required to select a managed game.');
    ensure(state.revision===revision,409,'Your selected game changed. Reload before saving.');
    await sql`INSERT INTO account_game_choices(user_id,game) VALUES(${userId},${game})
      ON CONFLICT(user_id) DO UPDATE SET game=excluded.game,revision=account_game_choices.revision+1,updated_at=now()`;
    await audit(sql,userId,'collection.game_selected',{game});return accountGames(userId,sql);
  });
}
