import test from 'node:test';
import assert from 'node:assert/strict';
import {probeCardShelfContinuation} from '../scripts/probe-arena-engine.mjs';

test('CardShelf comparison control resumes a real private decision after JSON persistence', () => {
  const result = probeCardShelfContinuation();
  for (const [name, value] of Object.entries(result)) {
    if (name !== 'scenario') assert.equal(value, true, name);
  }
});
