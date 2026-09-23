import { createError } from 'h3'
import { AppError } from '../../lib/errors.mjs'
export async function cardScanResult<T>(run: () => Promise<T>) {
  try { return await run() }
  catch (error: any) {
    if (error instanceof AppError) throw createError({ statusCode: error.status, message: error.message })
    // Never log bound SQL values, provider responses, API keys or photo data.
    console.error('CardShelf scanning: request failed; inspect service health.')
    throw createError({ statusCode: 500, message: 'The scanning request could not finish. Refresh this scan before retrying.' })
  }
}
