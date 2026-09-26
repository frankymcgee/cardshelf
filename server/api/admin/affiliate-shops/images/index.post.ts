import {defineEventHandler} from 'h3'
import {platformBody,platformResult,platformUser} from '../../../../utils/platform-api'
import {uploadAffiliateImage} from '../../../../../lib/affiliate-product-images.mjs'
export default defineEventHandler(event=>platformResult(async()=>{
  const user=await platformUser(event,true)
  return uploadAffiliateImage(user.id,await platformBody(event,1500000))
}))
