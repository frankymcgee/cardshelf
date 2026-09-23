// Localhost-only actual-SFC fixture. Fixed allowlist: no production data or arbitrary filesystem access.
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
  ...[...fs.readdirSync(path.join(root, 'app/components/arena')).filter(n => n.endsWith('.vue')).map(n => 'app/components/arena/' + n),
    'shared/arena.mjs', 'shared/arena-effects.mjs', 'tests/helpers/arena-table-fixtures.mjs', 'tests/browser/arena-effects-app.mjs',
    ...['main', 'arena', 'arena-table', 'arena-interactions', 'arena-effects', 'arena-perspective'].map(n => 'app/assets/css/' + n + '.css')].map(file => ['/' + file, path.join(root, file)])
]);
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arena effects fixture</title>'
  + [...files.keys()].filter(n => n.endsWith('.css')).map(n => `<link rel="stylesheet" href="${n}">`).join('')
  + '</head><body><div id="app"></div><script type="module" src="/tests/browser/arena-effects-app.mjs"></script></body></html>';
const server = http.createServer((req, res) => {
  try {
    const name = new URL(req.url, 'http://127.0.0.1').pathname; res.setHeader('Cache-Control', 'no-store');
    if (name === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    const file = files.get(name); if (!file) { res.writeHead(404); res.end('Not found'); return; }
    let content = fs.readFileSync(file, 'utf8');
    if (name.endsWith('.vue')) {
      const { descriptor, errors } = parse(content, { filename: file }); if (errors.length) throw errors[0];
      content = ts.transpileModule(compileScript(descriptor, { id: name, inlineTemplate: true }).content,
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
      const ast = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), imported = new Set();
      for (const node of ast.statements) if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) for (const item of node.importClause.namedBindings.elements) imported.add(item.name.text);
      const missing = ['ref','computed','watch','onMounted','onBeforeUnmount','nextTick'].filter(n => !imported.has(n));
      content = (missing.length ? 'import { ' + missing.join(', ') + ' } from "/vue.js";\n' : '') + content.replace(/from (['"])vue\1/g, 'from "/vue.js"');
    }
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(content);
  } catch (error) { console.error(error); res.writeHead(500); res.end('Fixture compilation failed'); }
});
server.listen(4180, '127.0.0.1', () => console.log('Arena effects fixture: http://127.0.0.1:4180'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
