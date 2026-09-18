import { defineEventHandler, getQuery, setHeader } from 'h3'
import type { TransactionSql } from 'postgres'
import { platformUser, platformResult } from '../../../../../utils/platform-api'
import { db } from '../../../../../../lib/db.mjs'
import { ensure } from '../../../../../../lib/errors.mjs'
import { stripePricingPreview } from '../../../../../../lib/stripe-pricing-preview.mjs'
export default defineEventHandler(event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Vary', 'Cookie')
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  return platformResult(async () => {
    const user = await platformUser(event, true)
    ensure(Object.keys(getQuery(event)).length === 0, 400, 'This preview only supports the saved Test / Sandbox catalogue.')
    return db().begin('isolation level repeatable read, read only', (sql: TransactionSql) => stripePricingPreview(sql, user.id))
  })
})
