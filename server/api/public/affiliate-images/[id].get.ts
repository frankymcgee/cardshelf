import {defineEventHandler,getRouterParam,setHeader} from 'h3'
import {platformResult} from '../../../utils/platform-api'
import {affiliateProductImage} from '../../../../lib/affiliate-product-images.mjs'
export default defineEventHandler(event=>platformResult(async()=>{
  const content=await affiliateProductImage(getRouterParam(event,'id'))
  setHeader(event,'Content-Type','image/webp');setHeader(event,'Cache-Control','no-store')
  return content
}))
