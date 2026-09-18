import { defineEventHandler } from 'h3'
import { platformResult } from '../../utils/platform-api'
import { freeSettings } from '../../../lib/free-accounts.mjs'
export default defineEventHandler(() => platformResult(async () => ({ enabled: (await freeSettings()).registration_enabled })))
