import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as Vue from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as ads from '../shared/adsense-policy.mjs';
import * as games from '../shared/games.mjs';

// Execute the actual page setup with Vue lifecycle/watchers and controlled API
// responses. A memory renderer avoids needing Chromium for loading-state checks.
const renderer = Vue.createRenderer({
  createElement: type => ({ type, children: [] }),
  createText: text => ({ text }), createComment: text => ({ text }),
  insert(node, parent) { node.parent = parent; parent.children.push(node); },
  remove(node) { node.parent.children = node.parent.children.filter(child => child !== node); },
  setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
  parentNode: node => node.parent, nextSibling: () => null, patchProp() {}
});
function mountPage(path) {
  const filename = new URL('../app/pages/' + path, import.meta.url);
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname });
  assert.deepEqual(errors, []);
  const compiled = compileScript(descriptor, { id: path });
  const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [], notices = [], module = { exports: {} }, nativeRequire = createRequire(filename);
  const api = (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject }));
  runInNewContext(code, {
    ...Vue, module, exports: module.exports,
    require: id => id.endsWith('adsense-policy.mjs') ? ads : id.endsWith('games.mjs') ? games : nativeRequire(id),
    useApi: () => api, useNotice: () => ({ show: (...args) => notices.push(args) }),
    useRoute: () => ({ query: {} }), definePageMeta() {}, useMarketingSeo() {},
    errorMessage: error => error.message, setTimeout, clearTimeout
  }, { filename: filename.pathname });
  const component = module.exports.default;
  component.render = () => null;
  const app = renderer.createApp(component);
  app.mount({ children: [] });
  return { app, state: app._instance.setupState, calls, notices };
}
const tick = async () => { await Promise.resolve(); await Vue.nextTick(); };
const result = { items: [{ id: 'en:mee-001', name: 'Grass Energy' }], total: 1, limit: 30 };
const filters = [
  { path: 'cards.vue', cards: '/api/catalogue', filters: '/api/catalogue/facets', value: { sets: [{ id: 'en:mee' }], rarities: [] }, state: 'result' },
  { path: 'explore/index.vue', cards: '/api/public/catalogue', filters: '/api/public/catalogue/sets', value: [{ id: 'en:mee' }], state: 'data' }
];

for (const view of filters) {
  test(`${view.path}: card response is visible before filters complete`, async () => {
    const page = mountPage(view.path);
    try {
      assert.equal(page.calls.length, 2);
      page.calls.find(c => c.url === view.cards).resolve(result);
      await tick();
      assert.deepEqual(page.state[view.state], result);
      assert.equal(page.state.loading, false);
      page.calls.find(c => c.url === view.filters).resolve(view.value);
      await tick();
      assert.deepEqual(page.state[view.path === 'cards.vue' ? 'facets' : 'sets'], view.value);
    } finally { page.app.unmount(); }
  });

  test(`${view.path}: late filter failures after navigation do not update the page or show a notice`, async () => {
    const page = mountPage(view.path);
    page.app.unmount();
    page.calls.find(c => c.url === view.cards).resolve(result);
    page.calls.find(c => c.url === view.filters).reject(new Error('Late failure'));
    await tick();
    assert.deepEqual(page.notices, []);
    assert.equal(page.state[view.state]?.items.length ?? 0, 0);
    if (view.path !== 'cards.vue') assert.equal(page.state.setsError, '');
  });
}

test('public cards survive failed filters, retry independently, and reuse choices for searches', async () => {
  const page = mountPage('explore/index.vue');
  try {
    page.calls.find(c => c.url === '/api/public/catalogue').resolve(result);
    page.calls.find(c => c.url === '/api/public/catalogue/sets').reject(new Error('Filters unavailable'));
    await tick();
    assert.deepEqual(page.state.data, result);
    assert.match(page.state.setsError, /still browse and search/);
    const retry = page.state.loadSets(), choices = [{ id: 'en:mee' }];
    page.calls.at(-1).resolve(choices);
    await retry;
    assert.deepEqual(page.state.sets, choices);
    assert.equal(page.state.setsError, '');
    page.state.searchCards();
    assert.equal(page.calls.at(-1).url, '/api/public/catalogue');
    assert.equal(page.calls.filter(c => c.url === '/api/public/catalogue/sets').length, 2);
    page.calls.at(-1).resolve(result);
    await tick();
  } finally { page.app.unmount(); }
});

test('public language changes cannot be overwritten by an older filter response', async () => {
  const page = mountPage('explore/index.vue');
  try {
    const original = page.calls.find(c => c.url === '/api/public/catalogue/sets');
    page.state.language = 'ja';
    await Vue.nextTick();
    const latest = page.calls.filter(c => c.url === '/api/public/catalogue/sets').at(-1);
    assert.notEqual(latest, original);
    assert.equal(latest.options.query.language, 'ja');
    const choices = [{ id: 'ja:mee' }];
    latest.resolve(choices);
    await tick();
    original.resolve([{ id: 'en:mee' }]);
    await tick();
    assert.deepEqual(page.state.sets, choices);
    for (const call of page.calls.filter(c => c.url === '/api/public/catalogue')) call.resolve(result);
    await tick();
  } finally { page.app.unmount(); }
});
