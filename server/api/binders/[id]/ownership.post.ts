import { collectionBinderHandler } from '../../../utils/collection-binder-api'
import { quickBinderOwnership } from '../../../../lib/collection-binders.mjs'
export default collectionBinderHandler((userId, id, input) => quickBinderOwnership(userId, id, input), true)
