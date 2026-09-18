// Stable internal identities; display names never grant permissions.
export const GAMES = Object.freeze([
  Object.freeze({code:'pokemon',name:'Pokémon',provider:'TCGdex',languages:['en','ja']}),
  Object.freeze({code:'yugioh',name:'Yu-Gi-Oh!',provider:'YGOPRODeck',languages:['en']}),
  Object.freeze({code:'mtg',name:'Magic: The Gathering',provider:'MTGJSON',languages:['en']})
]);
export const GAME_CODES = Object.freeze(GAMES.map(game=>game.code));
export function gameName(code) { return GAMES.find(game=>game.code===code)?.name || 'Unknown game'; }
export function gameFromCardId(id) {
  if(typeof id!=='string') return null;
  if(/^(en|ja):[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id)) return 'pokemon';
  const [game,language,provider,...extra]=id.split(':');
  return !extra.length && ['yugioh','mtg'].includes(game) && language==='en' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(provider||'') ? game : null;
}
/** @param {any} state */
export function gameAccess(state) {
  const a=state?.access ?? state;
  if(!a || a.allowed!==true || !Array.isArray(a.features)) return {mode:'none',limit:0,ad_free:true};
  if(a.tier==='free') return {mode:'read_only',limit:0,ad_free:false};
  const protectedAccess=['administrator','legacy_tester','beta_tester','complimentary','testing_policy'].includes(a.reason);
  if(protectedAccess || a.tier==='plus' || a.tier==='complimentary') return {mode:'unlimited',limit:null,ad_free:true};
  if(a.tier==='collector' && a.allowed===true) return {mode:'single',limit:1,ad_free:true};
  return {mode:'read_only',limit:0,ad_free:true};
}
export function canManageGame(state,game,selected='pokemon') {
  if(!GAME_CODES.includes(game)) return false;
  const access=gameAccess(state);
  return access.mode==='unlimited' || (access.mode==='single' && game===selected);
}
// An explicit Free account is not a protected tester grant. A paid/manual grant
// takes precedence, so paying never leaves a customer eligible for Free ads.
export function freeAccountAccess(access,registeredFree) {
  if(!registeredFree || !['testing_policy','subscription_required'].includes(access.reason)) return access;
  return {...access,tier:'free',allowed:true,reason:'free_account',payment_required:false,expires_at:null,features:[]};
}
