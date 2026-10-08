import test from 'node:test';
import assert from 'node:assert/strict';

test('Nuxt DevTools consumer loads with the patched Git factory and required APIs', async () => {
  const devtools = await import('../node_modules/@nuxt/devtools/dist/chunks/module-main.mjs');
  assert.equal(typeof devtools.m.enableModule, 'function');
  const { simpleGit } = await import('simple-git');
  const git = simpleGit();
  for (const method of ['branch', 'revparse', 'status']) assert.equal(typeof git[method], 'function');
});
