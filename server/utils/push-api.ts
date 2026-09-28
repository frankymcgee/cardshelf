import { createError } from 'h3'
import { AppError } from '../../lib/errors.mjs'
export async function pushResult<T>(run: () => Promise<T>) {
  try { return await run() }
  catch (error: any) {
    if (error instanceof AppError) throw createError({ statusCode: error.status, message: error.message })
    console.error('CardShelf push request failed. Subscription credentials have been withheld.')
    throw createError({ statusCode: 500, message: 'Notification settings could not be saved. Please try again.' })
  }
}
