import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArenaImport } from '../lib/arena/workshop.mjs';
const json = patch => JSON.stringify({ format: 'cardshelf-arena-deck', version: 1, game: 'pokemon', title: 'My deck', cards: [{ card_id: 'en:demo-1', name: 'Example', quantity: 4 }], ...patch });
test('CardShelf export is importable without trusting names or effects', () => {
  const parsed = parseArenaImport(json());
  assert.equal(parsed.title, 'My deck'); assert.equal(parsed.total, 4); assert.equal(parsed.entries[0].card_id, 'en:demo-1');
});
test('text imports preserve line numbers and exact names or catalogue IDs', () => {
  const parsed = parseArenaImport('# My deck\nPokémon: 4\n2 Exact Name\n2 Exact Name | en:sv03.5-001\nEnergy: 56\n56 en:base1-98\nTotal Cards: 60');
  assert.equal(parsed.total, 60); assert.deepEqual(parsed.entries.map(e => e.line), [3, 4, 6]);
  assert.equal(parsed.entries[0].name, 'Exact Name'); assert.equal(parsed.entries[1].card_id, 'en:sv03.5-001');
});
for (const text of ['', '1\u0000 card', '61 Example', '4 A\n57 B', '0 Example', '-1 Example', 'one Example', '[]', '{oops', '1 en:../one', '1 Example | ja:demo-1', 'a'.repeat(32001)]) {
  test('invalid import fails without partial acceptance: ' + JSON.stringify(text.slice(0, 30)), () => assert.throws(() => parseArenaImport(text)));
}
test('foreign JSON formats and client-defined effects cannot enter a draft', () => {
  for (const input of [json({ game: 'mtg' }), json({ version: 2 }), json({ cards: [{ card_id: 'en:demo-1', quantity: 1, program: { cheat: true } }] }), json({ cards: [{ card_id: 'https://example.com/card', quantity: 1 }] }), json({ cards: [{ card_id: 'ja:demo-1', quantity: 1 }] }), json({ cards: [] })]) assert.throws(() => parseArenaImport(input));
});
test('draft-sized lists preserve repeated entries for server aggregation', () => {
  const parsed = parseArenaImport('2 en:demo-1\n2 en:demo-1');
  assert.equal(parsed.entries.length, 2); assert.equal(parsed.total, 4);
});
