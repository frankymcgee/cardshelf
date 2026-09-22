// Local, synthetic component fixture only. Not a Nuxt route and never part of the production app.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { parse, compileScript } from '@vue/compiler-sfc';
const root = fileURLToPath(new URL('../../', import.meta.url)), require = createRequire(import.meta.url);
const files = new Map([
  ['/vue.js', path.join(path.dirname(require.resolve('vue/package.json')), 'dist/vue.esm-browser.prod.js')],
  ...['app/components/arena/ArenaBoard.vue', 'app/components/arena/ArenaCard.vue', 'shared/arena.mjs',
    'tests/helpers/arena-table-fixtures.mjs', 'app/assets/css/main.css', 'app/assets/css/arena.css', 'app/assets/css/arena-table.css']
    .map(file => ['/' + file, path.join(root, file)])
]);
const entry = `import { createApp, reactive, h, ref } from '/vue.js';
import ArenaBoard from '/app/components/arena/ArenaBoard.vue';
import { tableFixture } from '/tests/helpers/arena-table-fixtures.mjs';
const query = new URLSearchParams(location.search);
const options = { seat: query.get('seat') === '1' ? 1 : 0, legacy: query.has('legacy'), empty: query.has('empty'), setup: query.has('setup'), longHand: query.has('longHand'), locked: query.has('locked') };
const props = reactive(tableFixture(options)), events = [], inspected = ref('Select a card or discard pile');
window.arenaFixture = { events, props };
createApp({ setup() { return () => h('div', { class: 'arena-root' }, h('main', { class: 'arena-main' }, [
  h('div', { class: 'arena-table-top' }, h('div', [h('span', { class: 'arena-kicker' }, 'COMPONENT REVIEW · ORIGINAL TRAINING CARDS'), h('h1', 'Arena · Across the table')])),
  h('div', { class: 'arena-play-layout' }, [
    h('div', { class: 'arena-board-wrap' }, h(ArenaBoard, { ...props,
      onSelect: unit => { props.selected = unit.id; events.push(['select', unit.id]); inspected.value = unit.card.name; },
      onDiscard: seat => { events.push(['discard', seat]); inspected.value = props.aliases[seat] + ' discard'; },
      onAction: action => { events.push(['action', action]); }
    })),
    h('aside', { class: 'arena-inspector' }, h('div', { class: 'arena-panel' }, [h('span', { class: 'arena-kicker' }, 'CARD INSPECTOR'), h('h2', inspected.value), h('p', 'Presentation fixture only. Match actions and decisions remain in the existing match page.')]))
  ])
])); } }).mount('#app');`;
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Arena table fixture</title>'
  + [...files.keys()].filter(name => name.endsWith('.css')).map(name => `<link rel="stylesheet" href="${name}">`).join('')
  + '</head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>';
const server = http.createServer((req, res) => {
  try {
    const name = new URL(req.url, 'http://127.0.0.1').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (name === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    if (name === '/entry.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(entry); return; }
    const file = files.get(name);
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    let content = fs.readFileSync(file, 'utf8');
    if (name.endsWith('.vue')) {
      const { descriptor, errors } = parse(content, { filename: file });
      if (errors.length) throw errors[0];
      content = compileScript(descriptor, { id: name, inlineTemplate: true }).content;
      content = ts.transpileModule(content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
      content = 'import { ref, computed, watch } from "/vue.js";\n' + content.replace(/from (['"])vue\1/g, 'from "/vue.js"');
    }
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(content);
  } catch (error) { console.error(error); res.writeHead(500); res.end('Fixture compilation failed'); }
});
server.listen(4179, '127.0.0.1', () => console.log('Arena component fixture: http://127.0.0.1:4179'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
