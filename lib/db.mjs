import postgres from 'postgres';
import { configuration } from './config.mjs';
let client;
export function db() {
  if (!client) client = postgres(configuration().databaseUrl, {
    max: 8, idle_timeout: 20, connect_timeout: 10,
    connection: { application_name: 'cardshelf', statement_timeout: 30000 },
    onnotice: () => {}
  });
  return client;
}
export async function closeDatabase() { if (client) { await client.end({ timeout: 5 }); client = undefined; } }
export async function audit(sql, userId, action, detail = {}) {
  await sql`INSERT INTO audit_log (user_id, action, detail) VALUES (${userId}, ${action}, ${sql.json(detail)})`;
}
export async function collectionLock(sql, userId) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'collection:' + userId}, 0))`;
}
