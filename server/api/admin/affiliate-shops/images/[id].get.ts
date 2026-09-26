import {defineEventHandler,getRouterParam,setHeader} from 'h3'
import {platformResult,platformUser} from '../../../../utils/platform-api'
import {affiliateProductImage} from '../../../../../lib/affiliate-product-images.mjs'
export default defineEventHandler(event=>platformResult(async()=>{
  await platformUser(event,true)
  const content=await affiliateProductImage(getRouterParam(event,'id'),true)
  setHeader(event,'Content-Type','image/webp');setHeader(event,'Cache-Control','private, no-store');setHeader(event,'Vary','Cookie')
  return content
}))
