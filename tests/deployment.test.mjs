import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const expectedVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'cardshelf-configure-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(root, 'scripts/configure.sh'), join(dir, 'scripts/configure.sh'));
  try {
    const invoke = (...args) => spawnSync('sh', ['scripts/configure.sh', ...args], {
      cwd: dir, encoding: 'utf8', timeout: 5000,
    });
    const readEnv = () => Object.fromEntries(readFileSync(join(dir, '.env'), 'utf8')
      .trim().split('\n').map(line => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1)];
      }));
    run({ dir, invoke, readEnv });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('default deployment origin is tcg.webwire.cloud with matching release and proxy settings', () => {
  fixture(({ invoke, readEnv }) => {
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    const env = readEnv();
    assert.equal(env.APP_ORIGIN, 'https://tcg.webwire.cloud');
    assert.equal(env.APP_DOMAIN, 'tcg.webwire.cloud');
    assert.equal(env.APP_VERSION, expectedVersion);
    assert.equal(env.TRUST_PROXY, 'true');
    assert.equal(env.APP_BIND, '127.0.0.1');
    assert.equal(env.APP_PORT, '3000');
  });
});

test('configuration creates distinct random credentials with private file permissions', () => {
  fixture(({ dir, invoke, readEnv }) => {
    assert.equal(invoke().status, 0);
    const env = readEnv();
    assert.match(env.POSTGRES_PASSWORD, /^[a-f0-9]{64}$/);
    assert.match(env.BOOTSTRAP_TOKEN, /^[a-f0-9]{64}$/);
    assert.notEqual(env.POSTGRES_PASSWORD, env.BOOTSTRAP_TOKEN);
    assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
  });
});

test('configuration refuses to overwrite existing credentials', () => {
  fixture(({ dir, invoke }) => {
    assert.equal(invoke().status, 0);
    const before = readFileSync(join(dir, '.env'), 'utf8');
    const result = invoke('https://different.example.com');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to overwrite/);
    assert.equal(readFileSync(join(dir, '.env'), 'utf8'), before);
  });
});

test('explicit localhost evaluation remains available', () => {
  fixture(({ invoke, readEnv }) => {
    assert.equal(invoke('http://localhost:3000').status, 0);
    const env = readEnv();
    assert.equal(env.APP_ORIGIN, 'http://localhost:3000');
    assert.equal(env.APP_DOMAIN, 'localhost');
    assert.equal(env.TRUST_PROXY, 'false');
  });
});

test('standard HTTPS port is canonicalized for origin checks', () => {
  fixture(({ invoke, readEnv }) => {
    assert.equal(invoke('https://tcg.webwire.cloud:443').status, 0);
    assert.equal(readEnv().APP_ORIGIN, 'https://tcg.webwire.cloud');
  });
});
