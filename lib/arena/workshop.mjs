import { arenaGame, arenaVersionForGame } from '../../shared/arena-games.mjs';
import { GAME_CODES, gameFromCardId } from '../../shared/games.mjs';
import { db } from '../db.mjs';
import { requireArena } from './access.mjs';
import { compileArenaCard, deckValidation } from './cards.mjs';
import { ENERGY_TYPES } from '../../shared/arena.mjs';
import * as v from './input.mjs';

export async function arenaCatalogueFilters(userId,query={}) {
  await requireArena(userId);const game=v.oneOf(query.game??'pokemon',GAME_CODES);
  const sets = await db()`SELECT s.id,s.name FROM card_sets s WHERE s.game=${game} AND s.language='en'
    AND EXISTS(SELECT 1 FROM cards c WHERE c.set_id=s.id) ORDER BY lower(s.name),s.id`;
  return { sets, types: game==='pokemon'?ENERGY_TYPES:[], game, format:arenaGame(game) };
}

export async function arenaCatalogue(userId, query = {}) {
  await requireArena(userId);const game=v.oneOf(query.game??'pokemon',GAME_CODES);
  const q = v.text(query.q || '', 0, 100), page = v.integer(Number(query.page || 1), 1, 5000);
  const kind = v.oneOf(query.kind || '', ['', ...arenaGame(game).kinds]);
  const type = v.oneOf(query.type || '', ['', ...ENERGY_TYPES]);
  const stage = v.oneOf(query.stage || '', ['', 'Basic', 'Stage1', 'Stage2', 'MegaEvolution', 'VMAX', 'VSTAR', 'V-UNION', 'BREAK', 'RESTORED']);
  const set = query.set ? v.cardId(query.set) : '';
  const owned = v.oneOf(query.owned || '0', ['0', '1']) === '1';
  const supported = v.oneOf(query.supported || '0', ['0', '1']) === '1', sql = db();
  const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  const category = { pokemon: 'Pokemon', trainer: 'Trainer', energy: 'Energy' }[kind];
  const queryRows = sql`SELECT c.*,s.name AS set_name,coalesce(o.quantity,0)::integer AS owned_quantity
    FROM cards c JOIN card_sets s ON s.id=c.set_id
    LEFT JOIN (SELECT p.card_id,sum(e.quantity) AS quantity FROM printings p JOIN collection_entries e ON e.printing_id=p.id
      WHERE e.user_id=${userId} GROUP BY p.card_id) o ON o.card_id=c.id
    WHERE c.game=${game} AND c.language='en'
    ${q ? sql`AND (c.name ILIKE ${pattern} OR c.local_id=${q} OR c.id=${q})` : sql``}
    ${owned ? sql`AND o.quantity>0` : sql``} ${set ? sql`AND c.set_id=${set}` : sql``}
    ${kind&&game==='pokemon' ? sql`AND c.raw_data->>'category'=${category}` : kind&&game==='mtg' ? sql`AND (c.raw_data->'arena_data'->'types' ? ${kind[0].toUpperCase()+kind.slice(1)})` : kind ? sql`AND lower(c.category) LIKE ${kind==='monster'?'%monster':'spell card'}` : sql``}
    ${type ? sql`AND (c.raw_data->'types' ? ${type} OR lower(c.name) IN ${sql([type.toLowerCase() + ' energy', 'basic ' + type.toLowerCase() + ' energy'])})` : sql``}
    ${stage ? sql`AND c.raw_data->>'stage' IN ${sql(stage === 'MegaEvolution' ? ['MegaEvolution', 'MEGA'] : [stage])}` : sql``}
    ORDER BY lower(c.name),c.id
    ${supported ? sql`` : sql`LIMIT 61 OFFSET ${(page - 1) * 60}`}`;
  if (!supported) {
    const rows = await queryRows;
    return { items: rows.slice(0, 60).map(r => ({ ...compileArenaCard(r,arenaVersionForGame(game)), owned_quantity: r.owned_quantity })), page, has_more: rows.length > 60 };
  }
  // Compile before pagination. Stream bounded batches and close as soon as the
  // next page is known; raw catalogue rows never accumulate in application memory.
  // No persistent support cache can go stale after a catalogue/rules update.
  const items = []; let matched = 0;
  scan: for await (const batch of queryRows.cursor(200)) {
    for (const row of batch) {
      const compiled = compileArenaCard(row,arenaVersionForGame(game));
      if (!compiled.supported) continue;
      if (matched++ < (page - 1) * 60) continue;
      items.push({ ...compiled, owned_quantity: row.owned_quantity });
      if (items.length === 61) break scan;
    }
  }
  return { items: items.slice(0, 60), page, has_more: items.length > 60 };
}

export function parseArenaImport(text,game='pokemon') {
  v.check(typeof text === 'string' && text.trim().length > 0 && text.length <= 32000
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text), 'Paste a deck list of at most 32,000 characters.');
  let title = '', entries;
  if (/^[\[{]/.test(text.trim())) {
    let data; try { data = JSON.parse(text); } catch { v.check(false, 'The deck JSON is invalid.'); }
    v.object(data, ['format', 'version', 'title', 'game', 'cards']);
    v.check(data.format === 'cardshelf-arena-deck' && data.version === 1 && data.game === game, 'Use a CardShelf Arena version 1 export for the selected game.');
    title = v.text(data.title || '', 0, 80);
    v.check(Array.isArray(data.cards), 'The export must contain a cards list.');
    entries = data.cards.map((row, i) => {
      v.object(row, ['card_id', 'quantity', 'name']);
      return { line: i + 1, quantity: v.integer(row.quantity, 1, 60), card_id: v.cardId(row.card_id), label: row.card_id };
    });
  } else {
    entries = [];
    for (const [i, raw] of text.split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || /^(?:Pok[eé]mon|Trainers?|Energy|Total Cards)\s*:\s*\d+$/i.test(line)) continue;
      const match = line.match(/^(\d{1,2})\s*x?\s+(.+)$/i);
      v.check(match, `Line ${i + 1}: use a quantity followed by a card name or English catalogue ID.`);
      const label = v.text(match[2], 1, 160), quantity = v.integer(Number(match[1]), 1, 60);
      const explicit = label.includes('|') ? label.split('|').at(-1).trim() : /^(?:en:|mtg:en:|yugioh:en:)/.test(label) ? label : null;
      entries.push({ line: i + 1, quantity, label, ...(explicit ? { card_id: v.cardId(explicit) } : { name: label }) });
    }
  }
  v.check(entries.length > 0 && entries.length <= 60, 'Use between 1 and 60 card entries.');
  const total = entries.reduce((sum, row) => sum + row.quantity, 0);
  v.check(total <= 60, 'An imported draft cannot contain more than 60 cards.');
  v.check(entries.every(e=>!e.card_id||gameFromCardId(e.card_id)===game),'Every imported card must belong to the selected game.');
  return { title, entries, total, game };
}

export async function previewArenaImport(userId, value) {
  await requireArena(userId);
  const input = v.object(value, ['text', 'selections','game']),game=v.oneOf(value.game??'pokemon',GAME_CODES), parsed = parseArenaImport(input.text,game), sql = db();
  const selections = new Map();
  v.check(input.selections === undefined || (Array.isArray(input.selections) && input.selections.length <= 60), 'Invalid import selections.');
  for (const item of input.selections || []) {
    v.object(item, ['line', 'card_id']); v.integer(item.line, 1, 32000);
    v.check(!selections.has(item.line) && parsed.entries.some(e => e.line === item.line), 'Invalid or repeated import line.');
    selections.set(item.line, v.cardId(item.card_id));
  }
  const rows = await Promise.all(parsed.entries.map(async entry => {
    const chosen = selections.get(entry.line);
    // A supplied choice must still match the original line. It cannot bless an
    // unrelated card, language or unsupported effect.
    const found = await sql`SELECT c.*,s.name AS set_name FROM cards c JOIN card_sets s ON s.id=c.set_id
      WHERE c.game=${game} AND c.language='en'
      ${entry.card_id ? sql`AND c.id=${entry.card_id}` : sql`AND lower(c.name)=lower(${entry.name})`}
      ${chosen ? sql`AND c.id=${chosen}` : sql``} ORDER BY c.id LIMIT 13`;
    const candidates = found.slice(0, 12).map(r => compileArenaCard(r,arenaVersionForGame(game)));
    const status = !found.length ? 'missing' : found.length > 1 ? 'ambiguous' : candidates[0].supported ? 'ready' : 'unsupported';
    return { line: entry.line, label: entry.label, quantity: entry.quantity, status, candidates, more: found.length > 12,
      reason: status === 'missing' ? 'No matching local English card. Use its catalogue ID or import the set first.'
        : status === 'ambiguous' ? 'Choose a printing, or use its catalogue ID for an exact match.'
        : status === 'unsupported' ? candidates[0].reason : '' };
  }));
  const complete = rows.every(row => row.status === 'ready'), combined = new Map();
  if (complete) for (const row of rows) {
    const card = row.candidates[0].card, old = combined.get(card.id);
    combined.set(card.id, { card, quantity: (old?.quantity || 0) + row.quantity });
  }
  const cards = [...combined.values()];
  return { title: parsed.title, game, total: parsed.total, rows, complete, cards, validation: complete ? deckValidation(cards,arenaVersionForGame(game)) : null };
}
