import { collectionBinderHandler } from '../../../utils/collection-binder-api'
import { convertTrackingBinder } from '../../../../lib/collection-binders.mjs'
export default collectionBinderHandler((userId, id, input) => convertTrackingBinder(userId, id, input), true)
