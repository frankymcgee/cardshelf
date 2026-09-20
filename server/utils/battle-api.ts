import { createError } from 'h3'
import { AppError } from '../../lib/errors.mjs'
// Database errors can include bound parameters. Never log a full match state,
// private hand, deck snapshot, request body or invitation during error reporting.
export async function battleResult<T>(run: () => Promise<T>) {
  try { return await run() }
  catch (error: any) {
    if (error instanceof AppError) throw createError({ statusCode: error.status, message: error.message })
    console.error('CardShelf battle: the request failed; inspect database health without exposing match payloads.')
    throw createError({ statusCode: 500, message: 'Battle request could not be completed. Refresh or retry the original action.' })
  }
}
