/** Stable, client-safe arena contract. Never put hidden match state in this module. */
export const ARENA_VERSION = 'pokemon-core-v1';
export const ARENA_FORMAT = 'Automated Casual Core';
export const ARENA_LIMITS = Object.freeze({ deck: 60, copies: 4, hand: 7, prizes: 6, bench: 5, decks: 40, activeMatches: 5, actions: 4000 });
export const ENERGY_TYPES = Object.freeze(['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Fairy','Dragon','Colorless']);
export const ARENA_MODES = Object.freeze(['pvp','practice','tutorial']);
export const ARENA_NOTICE = 'Automatic rules apply to the supported card pool. This is a casual format, not a Standard/Expanded legality certificate. Unsupported effects cannot enter an automated match.';
export const LESSONS = Object.freeze([
  { id:'setup', title:'Build your opening field', zone:'hand', text:'Choose a Basic Pokémon from your seven-card hand, place it in the Active spot and add other Basics to your Bench. Your opponent cannot see the opening field until both players finish.' },
  { id:'start', title:'Your turn begins automatically', zone:'turn', text:'The starting coin toss and turn draw are handled by the server. The first player cannot attack or play a Supporter on the first turn. Watch the highlighted turn badge.' },
  { id:'bench', title:'Prepare another Pokémon', zone:'hand', text:'Select a Basic in your hand and choose Bench. You can have up to five Benched Pokémon. Keep one ready in case your Active is Knocked Out.' },
  { id:'attach', title:'Power an attack', zone:'hand', text:'Select an Energy card, then choose your Active or a Benched Pokémon. You can normally attach one Energy from your hand per turn. Energy pays a requirement; it is not discarded merely for attacking.' },
  { id:'trainer', title:'Use a Trainer', zone:'hand', text:'Choose a supported Trainer in your hand. The game presents any required targets or selections. Items can be played as allowed; Supporters are limited to one per turn.' },
  { id:'attack', title:'Choose an attack', zone:'active', text:'Select your Active Pokémon. Available attacks show the required Energy and damage. Choose an attack: damage, supported effects, Knock Outs and the end of the turn resolve automatically.' },
  { id:'prize', title:'Collect your Prize', zone:'prizes', text:'After a Knock Out, choose one of your face-down Prize cards when prompted. Its identity is hidden until you take it into your hand. Taking your last Prize wins.' },
  { id:'evolve', title:'Evolve when eligible', zone:'hand', text:'On a later turn, select an evolution in your hand and choose the matching Pokémon in play. A Pokémon cannot normally evolve on its first turn in play or on your first turn. Damage and Energy remain; Special Conditions clear.' },
  { id:'retreat', title:'Switch your Active Pokémon', zone:'active', text:'Select your Active and choose Retreat. Select a replacement and pay the Energy cost when prompted. You can retreat once per turn; Asleep and Paralyzed Pokémon cannot retreat.' },
  { id:'finish', title:'Play to a result', zone:'turn', text:'Win by taking all Prize cards, leaving the opponent without a Pokémon in play, or when they cannot draw at the start of their turn. No collection cards or subscription payments change when a match ends.' }
]);
export function nextLesson(progress = {}) { return LESSONS.find(step => !progress[step.id]) || null; }
export function arenaPaidTier({ override = null, subscriptions = [] } = {}, now = Date.now()) {
  // Explicit administrative tier assignments remain a controlled testing path.
  // General beta grants, Complimentary and enforcement-off fallback are NOT entitlements.
  if (override && (!override.expires_at || Date.parse(override.expires_at) > now)) {
    if (['collector','plus'].includes(override.tier)) return { tier:override.tier, reason:'administrator_assignment' };
    if (override.tier === 'complimentary') return null;
  }
  const valid = subscriptions.filter(s => s.environment === 'production' && ['collector','plus'].includes(s.offer_snapshot?.plan_code)
    && Number.isFinite(Date.parse(s.paid_through)) && Date.parse(s.paid_through) > now);
  const paid = valid.find(s => s.offer_snapshot.plan_code === 'plus') || valid[0];
  return paid ? { tier:paid.offer_snapshot.plan_code, reason:'stripe_subscription' } : null;
}
export function arenaConflict(error) { return Number(error?.statusCode || error?.status || error?.response?.status) === 409; }
export function arenaMoneylessResult(result, seat) { return result === null ? '' : result === 'draw' ? 'Draw' : result === seat ? 'Victory' : 'Defeat'; }
export function energySymbol(type) {
  return ({ Grass:'G', Fire:'F', Water:'W', Lightning:'L', Psychic:'P', Fighting:'R', Darkness:'D', Metal:'M', Fairy:'Y', Dragon:'N', Colorless:'C' })[type] || '?';
}
