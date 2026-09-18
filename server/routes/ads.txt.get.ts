import { defineEventHandler, setHeader } from 'h3'
import { adsenseSettings } from '../../lib/adsense.mjs'
import { adsenseDeclaration } from '../../lib/adsense-logic.mjs'
export default defineEventHandler(async event => {
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-store')
  return adsenseDeclaration(await adsenseSettings())
})
