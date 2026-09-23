import test from 'node:test';
import assert from 'node:assert/strict';
import { openTableTools } from './browser/arena-match-controls.mjs';

function fixture(open = false, directSummaries = 1) {
  const state = { open, audioOpen: false, clicks: 0, selectors: [] };
  const menu = {
    evaluate: async read => read({ open: state.open }),
    locator: selector => {
      state.selectors.push(selector);
      const count = selector === ':scope > summary' ? directSummaries : directSummaries + 1;
      return { async click() {
        // Like Playwright's strict locator, never silently choose the first of two summaries.
        if (count !== 1) throw new Error('strict mode violation');
        state.open = !state.open; state.clicks++;
      } };
    }
  };
  return { state, page: { locator: selector => { assert.equal(selector, '.arena-table-tools'); return menu; } } };
}

test('closed Table tools opens its direct summary without targeting nested Audio credits', async () => {
  const { state, page } = fixture();
  await openTableTools(page);
  assert.equal(state.open, true); assert.equal(state.audioOpen, false);
  assert.equal(state.clicks, 1); assert.deepEqual(state.selectors, [':scope > summary']);
});
test('opening an already-open tools menu preserves its state without another click', async () => {
  const { state, page } = fixture(true);
  await openTableTools(page);
  assert.equal(state.open, true); assert.equal(state.clicks, 0); assert.deepEqual(state.selectors, []);
});
test('ambiguous direct summaries still fail instead of weakening strict selection', async () => {
  const { state, page } = fixture(false, 2);
  await assert.rejects(openTableTools(page), /strict mode violation/);
  assert.equal(state.open, false); assert.equal(state.clicks, 0);
});
test('a missing tools toggle fails without retries or opening another disclosure', async () => {
  const { state, page } = fixture(false, 0);
  await assert.rejects(openTableTools(page), /strict mode violation/);
  assert.equal(state.clicks, 0); assert.equal(state.audioOpen, false);
});
