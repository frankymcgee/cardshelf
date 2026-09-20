import { createError } from 'h3'
import { AppError } from '../../lib/errors.mjs'
export async function emailResult<T>(run: () => Promise<T>) {
  try { return await run() }
  catch (error: any) {
    if (error instanceof AppError) throw createError({ statusCode: error.status, message: error.message })
    // Database errors can contain bound API credentials or recipient data.
    console.error('CardShelf email: request failed; inspect service health without exposing mail data.')
    throw createError({ statusCode: 500, message: 'The email request could not be completed. Refresh and check the delivery queue.' })
  }
}
