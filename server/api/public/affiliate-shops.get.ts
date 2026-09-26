import { defineEventHandler } from 'h3'
import { platformResult } from '../../utils/platform-api'
import { publicAffiliateShops } from '../../../lib/affiliate-shops.mjs'
export default defineEventHandler(() => platformResult(() => publicAffiliateShops()))
