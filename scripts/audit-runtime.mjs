import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Nuxt's generated manifest includes Sharp binaries for several platforms as
// direct dependencies. Audit all of them in a separate lockfile, marking them
// optional only to permit platform-specific resolution. npm audit includes
// optional dependencies; nothing is omitted and the shipped server is untouched.
const server = JSON.parse(await readFile(resolve('.output/server/package.json'), 'utf8'));
if (!server.dependencies || !Object.keys(server.dependencies).length) {
  throw new Error('Build the production server before auditing its dependencies.');
}
const directory = await mkdtemp(join(tmpdir(), 'cardshelf-runtime-audit-'));
try {
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: 'cardshelf-runtime-audit', version: server.version, private: true,
    optionalDependencies: server.dependencies
  }, null, 2));
  console.log(`Auditing ${Object.keys(server.dependencies).length} generated server dependencies, including all native platforms.`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (const args of [
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    ['audit', '--omit=dev', '--audit-level=high']
  ]) {
    const result = spawnSync(npm, args, { cwd: directory, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      break;
    }
    if (args[0] === 'install') {
      const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
      for (const [name, version] of Object.entries(server.dependencies)) {
        if (lock.packages?.[`node_modules/${name}`]?.version !== version) {
          throw new Error(`Runtime audit did not resolve the exact generated dependency ${name}@${version}.`);
        }
      }
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
