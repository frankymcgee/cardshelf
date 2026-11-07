import { collectionBinderHandler } from '../../../../utils/collection-binder-api'
import { applyBinderExclusives } from '../../../../../lib/binder-exclusives.mjs'
export default collectionBinderHandler(applyBinderExclusives, true)
