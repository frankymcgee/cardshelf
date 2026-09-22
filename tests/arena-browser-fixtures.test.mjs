import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./browser/arena-fixtures.mjs', import.meta.url), 'utf8');
// Capture the actual fixture definition without starting Playwright inside node:test.
const fixtures = vm.runInNewContext(source
  .replace(/^import .*$/mg, '')
  .replace(/^export \{.*$/mg, '')
  .replace('export const test', 'const test') + '\n;test;', {
    base: { extend: value => value }
  });
const [createPage, options] = fixtures.page;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

test('only page setup has a separate bounded timeout; UI checks and retries remain strict', () => {
  assert.deepEqual(Object.keys(fixtures), ['page']);
  assert.equal(options.timeout, 60_000);
  assert.equal(options.scope, undefined); // Remains test-scoped, never a shared page.
  const config = fs.readFileSync(new URL('./browser/arena.config.mjs', import.meta.url), 'utf8');
  assert.match(config, /timeout:\s*30000, retries:\s*0/);
  assert.doesNotMatch(config, /expect:\s*\{|actionTimeout/);
  const spec = fs.readFileSync(new URL('./browser/arena-table.spec.mjs', import.meta.url), 'utf8');
  assert.match(spec, /^import \{ test, expect \} from '\.\/arena-fixtures\.mjs';/);
  assert.doesNotMatch(spec, /test\.skip\(|test\.fixme\(|test\.setTimeout\(|test\.slow\(/);
});

test('page setup finishes before handing the fresh page to a test, then awaits that test', async () => {
  const setup = deferred(), body = deferred(), page = {}, seen = [];
  let finished = false;
  const running = createPage({ context: { newPage: () => setup.promise } }, async value => {
    seen.push(value);
    await body.promise;
  }).then(() => { finished = true; });
  await Promise.resolve(); assert.equal(seen.length, 0);
  setup.resolve(page);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(seen[0], page); assert.equal(finished, false);
  body.resolve(); await running; assert.equal(finished, true);
});

test('setup and test failures propagate instead of being retried or swallowed', async () => {
  const startupError = new Error('browser startup failed');
  let entered = false;
  await assert.rejects(createPage({ context: { newPage: async () => { throw startupError; } } }, async () => { entered = true; }), error => error === startupError);
  assert.equal(entered, false);
  const testError = new Error('UI assertion failed');
  await assert.rejects(createPage({ context: { newPage: async () => ({}) } }, async () => { throw testError; }), error => error === testError);
});

test('each test receives its own context page and normal context teardown retains ownership', async () => {
  const pages = [{}, {}], seen = [];
  for (const page of pages) {
    let creates = 0;
    await createPage({ context: { newPage: async () => { creates++; return page; } } }, async value => { seen.push(value); });
    assert.equal(creates, 1);
  }
  assert.equal(seen[0], pages[0]); assert.equal(seen[1], pages[1]);
  assert.notEqual(seen[0], seen[1]);
  assert.doesNotMatch(source, /\.close\s*\(/); // Do not close before failure evidence is captured.
});
