import { collectionBinderHandler } from '../../../utils/collection-binder-api'
import { previewCollectionConversion } from '../../../../lib/collection-binders.mjs'
export default collectionBinderHandler((userId, id) => previewCollectionConversion(userId, id))
