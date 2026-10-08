import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// simple-git 4 fixes the unsafe-operation advisories and uses a named ESM
// factory. The pinned Nuxt DevTools consumer still imports the old default.
// Adapt that one import, retaining upstream Git safety checks unchanged.
const devtools = JSON.parse(await readFile(resolve('node_modules/@nuxt/devtools/package.json'), 'utf8'));
const git = JSON.parse(await readFile(resolve('node_modules/simple-git/package.json'), 'utf8'));
if (devtools.version !== '3.4.2' || git.version !== '4.0.2') {
  throw new Error('Review the Nuxt DevTools Git compatibility patch when changing dependency versions.');
}
const path = resolve('node_modules/@nuxt/devtools/dist/chunks/module-main.mjs');
const original = "import Git from 'simple-git';";
const replacement = "import { simpleGit as Git } from 'simple-git';";
const content = await readFile(path, 'utf8');
if (content.split(original).length === 2 && !content.includes(replacement)) {
  await writeFile(path, content.replace(original, replacement));
} else if (content.includes(original) || content.split(replacement).length !== 2) {
  throw new Error('The pinned Nuxt DevTools Git import changed; review compatibility before building.');
}
console.log('Prepared the pinned Nuxt DevTools import for patched simple-git.');
