import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { db, closeDatabase } from '../lib/db.mjs';
const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
try {
  // One transaction and advisory lock keep concurrent app starts safe.
  await db().begin(async sql => {
    await sql`SELECT pg_advisory_xact_lock(72490318)`;
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set((await sql`SELECT version FROM schema_migrations`).map(row => row.version));
    for (const filename of (await readdir(directory)).filter(name => /^\d+_.+\.(sql|mjs)$/.test(name)).sort()) {
      if (applied.has(filename)) continue;
      if (filename.endsWith('.sql')) await sql.unsafe(await readFile(directory + '/' + filename, 'utf8'));
      else await (await import(pathToFileURL(directory + '/' + filename).href)).migrate(sql);
      await sql`INSERT INTO schema_migrations(version) VALUES (${filename})`;
      console.log(`Applied ${filename}`);
    }
  });
  console.log('Database migrations complete.');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await closeDatabase(); }
