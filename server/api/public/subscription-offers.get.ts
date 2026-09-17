import { defineEventHandler } from 'h3'
import { platformResult } from '../../utils/platform-api'
import { publicSubscriptionOffers } from '../../../lib/public-subscriptions.mjs'
export default defineEventHandler(() => platformResult(() => publicSubscriptionOffers()))
