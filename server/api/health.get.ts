import { defineEventHandler, createError } from 'h3'
import { db } from '../../lib/db.mjs'
export default defineEventHandler(async () => {
  try { await db()`SELECT version FROM schema_migrations ORDER BY version LIMIT 1`; return { status: 'ok' } }
  catch { throw createError({ statusCode: 503, message: 'Database is not ready.' }) }
})
