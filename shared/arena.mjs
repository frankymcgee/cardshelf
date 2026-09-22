/** Stable, client-safe arena contract. Never put hidden match state in this module. */
export const LEGACY_ARENA_VERSION = 'pokemon-core-v1';
export const ARENA_VERSION = 'pokemon-expanded-v2';
export const ARENA_VERSIONS = Object.freeze([LEGACY_ARENA_VERSION, ARENA_VERSION]);
export const ARENA_FORMAT = 'Automated Casual Expanded';
export const ARENA_LIMITS = Object.freeze({ deck: 60, copies: 4, hand: 7, prizes: 6, bench: 5, decks: 40, activeMatches: 5, actions: 4000 });
export const ENERGY_TYPES = Object.freeze(['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Fairy','Dragon','Colorless']);
export const ARENA_MODES = Object.freeze(['pvp','practice','tutorial']);
export const ARENA_NOTICE = 'Automatic rules apply to the supported card pool. This is a casual format, not a Standard/Expanded legality certificate. Unsupported effects cannot enter an automated match.';
export const LESSONS = Object.freeze([
  { id:'setup', title:'Build your opening field', zone:'hand', text:'Choose a Basic Pokémon from your seven-card hand, place it in the Active spot and add other Basics to your Bench. Your opponent cannot see the opening field until both players finish.' },
  { id:'start', title:'Your turn begins automatically', zone:'turn', text:'The starting coin toss and turn draw are handled by the server. The first player cannot attack or play a Supporter on the first turn. Watch the highlighted turn badge.' },
  { id:'bench', title:'Prepare another Pokémon', zone:'hand', text:'Select a Basic in your hand and choose Bench. You can have up to five Benched Pokémon. Keep one ready in case your Active is Knocked Out.' },
  { id:'attach', title:'Power an attack', zone:'hand', text:'Select an Energy card, then choose your Active or a Benched Pokémon. You can normally attach one Energy from your hand per turn. Energy pays a requirement; it is not discarded merely for attacking.' },
  { id:'trainer', title:'Use a Trainer', zone:'hand', text:'Choose a supported Trainer in your hand. Complete its targets and costs when prompted. Supporters are limited to one per turn; Tools stay attached and Stadiums affect the shared table.' },
  { id:'attack', title:'Choose an attack', zone:'active', text:'Select your Active Pokémon. Available attacks show the required Energy and damage. Choose an attack: damage, supported effects, Knock Outs and the end of the turn resolve automatically.' },
  { id:'prize', title:'Collect your Prizes', zone:'prizes', text:'After a Knock Out, choose the prompted number of face-down Prize cards. Their identities stay hidden until taken. Pokémon EX and ex usually award two Prizes; the card profile identifies any different rule. Taking your last Prize wins.' },
  { id:'evolve', title:'Evolve when eligible', zone:'hand', text:'On a later turn, select an evolution in your hand and choose the matching Pokémon in play. A Pokémon cannot normally evolve on its first turn in play or on your first turn. Damage and Energy remain; Special Conditions clear.' },
  { id:'retreat', title:'Switch your Active Pokémon', zone:'active', text:'Select your Active and choose Retreat. Select a replacement and pay the Energy cost when prompted. You can retreat once per turn; Asleep and Paralyzed Pokémon cannot retreat.' },
  { id:'finish', title:'Play to a result', zone:'turn', text:'Win by taking all Prize cards, leaving the opponent without a Pokémon in play, or when they cannot draw at the start of their turn. No collection cards or subscription payments change when a match ends.' }
]);
export function nextLesson(progress = {}) { return LESSONS.find(step => !progress[step.id]) || null; }
export function arenaPaidTier({ override = null, subscriptions = [] } = {}, now = Date.now()) {
  // Explicit administrative tier assignments remain a controlled testing path.
  // Explicit Complimentary assignments also include Arena. General beta grants
  // and enforcement-off fallback are not entitlements.
  if (override && (!override.expires_at || Date.parse(override.expires_at) > now)) {
    if (['collector','plus'].includes(override.tier)) return { tier:override.tier, reason:'administrator_assignment' };
    if (override.tier === 'complimentary') return { tier:'complimentary', reason:'complimentary' };
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

// Presentation routing only: every option retains an exact server-issued action.
// This does not determine game legality, calculate costs or mutate a player view.
export function arenaActionKey(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return '';
  const entries = Object.entries(action);
  if (entries.some(([, value]) => !['string', 'number'].includes(typeof value))) return '';
  return JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)));
}
export function arenaHandOptions(table, locked = false) {
  if (locked || !ARENA_VERSIONS.includes(table?.version) || ![0, 1].includes(table?.seat)
    || !Array.isArray(table.players) || table.players.length !== 2 || !Array.isArray(table.legal)
    || table.prompt || table.waiting_for != null || !['setup', 'playing'].includes(table.phase)
    || table.phase === 'playing' && table.turn !== table.seat) return [];
  const own = table.players[table.seat];
  if (!Array.isArray(own?.hand)) return [];
  const visible = unit => unit && !unit.hidden && typeof unit.id === 'string' && !!unit.card;
  const hand = new Map(own.hand.filter(visible).map(unit => [unit.id, unit]));
  const fields = table.players.flatMap((p, seat) => [p?.active, ...(p?.bench || [])].filter(visible).map(unit => ({ unit, seat })));
  const fieldsById = new Map(fields.map(value => [value.unit.id, value]));
  const allowed = { setup: ['type', 'card', 'zone'], bench: ['type', 'card'], energy: ['type', 'card', 'target'], evolve: ['type', 'card', 'target'], trainer: ['type', 'card', 'target'] };
  const seen = new Set(), result = [];
  for (const move of table.legal) {
    const action = move?.action, unit = hand.get(move?.card);
    if (!unit || action?.card !== unit.id || !Object.hasOwn(allowed, action?.type)
      || Object.keys(action).some(key => !allowed[action.type].includes(key))
      || typeof move.label !== 'string' || !move.label.trim()) continue;
    let target = '', targetLabel = '';
    if (action.type === 'setup' && ['active', 'bench'].includes(action.zone)) {
      target = `zone:${table.seat}:${action.zone}`; targetLabel = action.zone === 'active' ? 'Your Active spot' : 'Your Bench';
    } else if (action.type === 'bench') {
      target = `zone:${table.seat}:bench`; targetLabel = 'Your Bench';
    } else if (['energy', 'evolve', 'trainer'].includes(action.type) && typeof action.target === 'string') {
      const field = fieldsById.get(action.target);
      if (!field || action.type !== 'trainer' && field.seat !== table.seat) continue;
      target = 'card:' + field.unit.id;
      targetLabel = `${field.seat === table.seat ? 'Your' : 'Opponent'} ${field.unit.card.name}`;
    } else if (action.type === 'trainer' && action.target === undefined) {
      const stadium = unit.card.program?.kind === 'stadium';
      if (stadium && table.stadium === undefined) continue;
      target = stadium ? 'stadium' : 'trainer'; targetLabel = stadium ? 'Shared Stadium' : 'Trainer play area';
    }
    const key = arenaActionKey(action);
    if (target && key && !seen.has(key)) { seen.add(key); result.push({ key, card: unit.id, target, targetLabel, label: move.label, action }); }
  }
  return result;
}
// The match revision and server writer remain authoritative. This local stamp
// cancels gestures/reviews on a changed disclosed table, not identical polling.
// Never traverse an opponent hand, a deck/prize list, or a face-down unit's fields.
export function arenaInteractionStamp(table) {
  if (!table || ![0, 1].includes(table.seat)) return '';
  const unit = value => !value ? null : value.hidden ? 'hidden' : [value.id, value.damage, value.effective_hp,
    value.conditions, (value.energy || []).map(c => c.hidden ? 'hidden' : c.id), (value.tools || []).map(c => c.hidden ? 'hidden' : c.id), (value.under || []).map(c => c.hidden ? 'hidden' : c.id)];
  return JSON.stringify([table.version, table.seat, table.round, table.phase, table.turn, table.turn_number,
    table.waiting_for, !!table.prompt, table.events?.at(-1)?.n, table.result,
    table.players?.map((p, seat) => [p?.ready, p?.hand_count, p?.deck_count, p?.prize_count, p?.discard?.length,
      unit(p?.active), p?.bench?.map(unit), seat === table.seat ? p?.hand?.map(unit) : null]),
    unit(table.stadium?.unit), table.legal?.map(move => arenaActionKey(move.action))]);
}
