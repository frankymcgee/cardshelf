// Local synthetic fixture for actual components. Never a production Nuxt route.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { parse, compileScript } from '@vue/compiler-sfc';
const root = fileURLToPath(new URL('../../', import.meta.url)), require = createRequire(import.meta.url);
const components = fs.readdirSync(path.join(root, 'app/components/arena')).filter(name => name.endsWith('.vue')).map(name => 'app/components/arena/' + name);
const files = new Map([
  ['/vue.js', path.join(path.dirname(require.resolve('vue/package.json')), 'dist/vue.esm-browser.prod.js')],
  ...[...components, 'app/components/CardImage.vue', 'app/composables/useCardImage.mjs', 'shared/card-images.mjs', 'shared/arena.mjs', 'shared/arena-art.mjs', 'shared/arena-match-ui.mjs', 'lib/arena/training.mjs', 'tests/helpers/arena-table-fixtures.mjs',
    'app/assets/css/main.css', 'app/assets/css/arena.css', 'app/assets/css/arena-table.css', 'app/assets/css/arena-interactions.css', 'app/assets/css/arena-perspective.css', 'app/assets/css/arena-card-art.css', 'app/assets/css/arena-scene.css']
    .map(file => ['/' + file, path.join(root, file)])
]);
const entry = `import { createApp, reactive, computed, h, ref } from '/vue.js';
import ArenaBoard from '/app/components/arena/ArenaBoard.vue';
import ArenaShell from '/app/components/arena/ArenaShell.vue';
import ArenaTurnActions from '/app/components/arena/ArenaTurnActions.vue';
import ArenaCard from '/app/components/arena/ArenaCard.vue';
import ArenaActionTray from '/app/components/arena/ArenaActionTray.vue';
import ArenaCardPreview from '/app/components/arena/ArenaCardPreview.vue';
import ArenaModal from '/app/components/arena/ArenaModal.vue';
import ArenaPromptModal from '/app/components/arena/ArenaPromptModal.vue';
import { tableFixture, tableUnit } from '/tests/helpers/arena-table-fixtures.mjs';
import { trainingDeck } from '/lib/arena/training.mjs';
const query = new URLSearchParams(location.search);
const options = { seat: query.get('seat') === '1' ? 1 : 0, legacy: query.has('legacy'), empty: query.has('empty'), setup: query.has('setup'), longHand: query.has('longHand'), locked: query.has('locked') };
const props = reactive(tableFixture(options)), events = [], preview = ref(false), discard = ref(null), revision = ref(1);
if (query.has('rules')) {
  props.table.version = 'pokemon-expanded-v4';
  props.table.players.forEach((p, seat) => { p.gx_used = seat === 0; p.vstar_used = seat === 1;
    p.lost_zone = [tableUnit('Public Prism-' + seat), { hidden: true, card: { name: 'SECRET-LOST-ZONE' } }]; });
}
if (query.has('art')) {
  props.table.players.forEach((p, seat) => {
    const cards = trainingDeck(seat === props.table.seat ? 'ember' : 'tide').map(entry => entry.card);
    if (p.active && !p.active.hidden) p.active.card = cards[0];
    p.bench.forEach((unit, i) => { if (!unit.hidden) unit.card = cards[(i + 1) % 4]; });
    p.discard.forEach(unit => { unit.card = cards[4]; });
    if (seat === props.table.seat) p.hand.forEach((unit, i) => { unit.card = cards[[6, 1, 0, 3, 8, 4, 7][i % 7]]; });
  });
}
props.table.legal = props.table.players[props.table.seat].hand.map(unit => ({ card: unit.id, label: 'Play ' + unit.card.name, action: { type: 'bench', card: unit.id } }));
if (query.has('art')) { props.table.version = 'pokemon-expanded-v2'; props.table.legal.push({ label: 'End turn', action: { type: 'end_turn' } }); }
function publicCards(units) { return units.filter(unit => unit && !unit.hidden && unit.card).flatMap(unit => [unit, ...publicCards([...(unit.tools || []), ...(unit.energy || []), ...(unit.under || []), ...(unit.parts || [])])]); }
const cards = computed(() => publicCards([...props.table.players.flatMap((p, seat) => [...(seat === props.table.seat ? p.hand : []), p.active, ...p.bench, ...p.discard, ...(p.lost_zone || [])]), props.table.stadium?.unit]));
const current = computed(() => cards.value.find(unit => unit.id === props.selected));
const parent = computed(() => cards.value.find(unit => [...(unit.tools || []), ...(unit.energy || []), ...(unit.under || []), ...(unit.parts || [])].some(child => child.id === props.selected)));
const moves = computed(() => props.table.legal.filter(move => move.card === props.selected));
const select = unit => { props.selected = unit.id; discard.value = null; events.push(['select', unit.id]); };
const action = value => events.push(['action', value]);
window.arenaFixture = { events, props, setPrompt(value) { props.table.prompt = value; revision.value++; }, clearSelection() { props.selected = ''; preview.value = false; } };
createApp({ setup() { return () => h(query.has('art') ? ArenaShell : 'div', query.has('art') ? { table: true, title: 'Ember vs Tide' } : { class: 'arena-root' }, h('main', { class: ['arena-main', 'arena-match-view', current.value ? 'arena-match-has-selection' : ''] }, [
  h('div', { class: 'arena-table-top' }, h('div', [h('span', { class: 'arena-kicker' }, 'COMPONENT REVIEW · ORIGINAL TRAINING CARDS'), h('h1', query.has('art') ? 'Ember vs Tide · Illustrated training table' : 'Arena · Across the table')])),
  h(ArenaPromptModal, { prompt: props.table.prompt, revision: revision.value, locked: props.locked, onChoose: ids => events.push(['choose', ids]) }),
  h('div', { class: 'arena-play-layout' }, [
    h('div', { class: 'arena-board-wrap' }, h(ArenaBoard, { ...props, onSelect: select,
      onDiscard: seat => { preview.value = false; discard.value = seat; events.push(['discard', seat]); }, onAction: action }, {
      actions: () => h('aside', { class: 'arena-inspector arena-table-actions' }, [query.has('art') ? h('div', { class: 'arena-turn-bar arena-match-controls' }, h(ArenaTurnActions, { table: props.table, moves: [{ label: 'End turn', action: { type: 'end_turn' } }], matchId: 'visual-fixture', revision: revision.value, locked: props.locked, onAction: action })) : null, current.value ?
        h(ArenaActionTray, { unit: current.value, moves: moves.value, locked: props.locked, onAction: action, onInspect: () => { preview.value = true; }, onClear: () => { props.selected = ''; preview.value = false; } })
        : h('section', { class: 'arena-table-instructions' }, [h('strong', 'Select a card'), h('p', 'Select a hand or field card. Inspect it or choose an available move.')])])
    }))
  ]),
  h(ArenaModal, { open: preview.value && !!current.value, label: 'Card preview', onClose: () => { preview.value = false; } }, { default: () => current.value ? h(ArenaCardPreview, { unit: current.value, parent: parent.value, selected: props.selected, onSelect: select }) : null }),
  h(ArenaModal, { open: discard.value !== null, label: 'Discard pile', onClose: () => { discard.value = null; } }, { default: () => discard.value === null ? null : h('div', { class: 'arena-discard-grid' }, props.table.players[discard.value].discard.map(unit => h(ArenaCard, { unit, onSelect: unit => { select(unit); preview.value = true; } }))) })
])); } }).component('NuxtLink', { props: ['to'], setup: (p, { slots }) => () => h('a', { href: p.to }, slots.default?.()) }).mount('#app');`;
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Arena table fixture</title>'
  + [...files.keys()].filter(name => name.endsWith('.css')).map(name => `<link rel="stylesheet" href="${name}">`).join('')
  + '</head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>';
const server = http.createServer((req, res) => {
  try {
    const name = new URL(req.url, 'http://127.0.0.1').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (name === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    if (name === '/entry.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(entry); return; }
    if (/^\/arena\/(collector-room|walnut|card-back|training-art|navy-fabric)\.webp$/.test(name)) { res.setHeader('Content-Type', 'image/webp'); res.end(fs.readFileSync(path.join(root, 'public', name))); return; }
    const file = files.get(name);
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    let content = fs.readFileSync(file, 'utf8');
    if (name.endsWith('.vue')) {
      const { descriptor, errors } = parse(content, { filename: file });
      if (errors.length) throw errors[0];
      content = compileScript(descriptor, { id: name, inlineTemplate: true }).content;
      content = ts.transpileModule(content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
      const ast = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), imported = new Set();
      for (const node of ast.statements) if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) for (const item of node.importClause.namedBindings.elements) imported.add(item.name.text);
      const missing = ['ref', 'computed', 'watch', 'onMounted', 'onBeforeUnmount', 'nextTick'].filter(name => !imported.has(name));
      content = (missing.length ? 'import { ' + missing.join(', ') + ' } from "/vue.js";\n' : '') + content.replace(/from (['"])vue\1/g, 'from "/vue.js"');
    }
    content = content.replace(/from (['"])vue\1/g, 'from "/vue.js"');
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(content);
  } catch (error) { console.error(error); res.writeHead(500); res.end('Fixture compilation failed'); }
});
server.listen(4179, '127.0.0.1', () => console.log('Arena component fixture: http://127.0.0.1:4179'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
