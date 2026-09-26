import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const version = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;

// Package metadata is the release authority. Check the standalone installer as
// well as its companion defaults; do not rewrite or relax the deployment test.
const stamps = [
  ['scripts/configure.sh', /^APP_VERSION=([^\r\n]+)$/gm, 1],
  ['.env.example', /^APP_VERSION=([^\r\n]+)$/gm, 1],
  ['README.md', /^# CardShelf ([^\r\n]+)$/gm, 1],
  ['CHANGELOG.md', /^## (\S+) —/g, 1],
  ['app/layouts/default.vue', /\bv(\d+\.\d+\.\d+)\b/g, 2]
];

for (const [path, pattern, count] of stamps) {
  test(`release version matches package.json in ${path}`, () => {
    const source = readFileSync(new URL(path, root), 'utf8');
    const actual = [...source.matchAll(pattern)].map(match => match[1]);
    assert.deepEqual(actual, Array(count).fill(version),
      `${path} must contain ${count} release stamp(s) matching package.json (${version})`);
  });
}


test('the committed lockfile matches the release manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
});
