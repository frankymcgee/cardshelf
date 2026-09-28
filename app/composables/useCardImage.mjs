import { computed, ref, watch } from 'vue'
import { cardImageSources } from '../../shared/card-images.mjs'

/** @param {import('vue').Ref<any>} card @param {import('vue').Ref<boolean>} low */
export function useCardImage(card, low = ref(true)) {
  const sources = computed(() => cardImageSources(card.value, { low: low.value }))
  const index = ref(0)
  // Reset for a new card, resolution or saved URL, including recycled Vue rows.
  watch(() => JSON.stringify(sources.value), () => { index.value = 0 }, { flush: 'sync' })
  const current = computed(() => sources.value[index.value])
  const image = computed(() => current.value?.url)
  const imageSource = computed(() => current.value?.source)
  /** @param {Event} event */
  function imageFailed(event) {
    // Ignore a late error from the previous card/image after a prop change.
    if ((/** @type {HTMLImageElement | null} */ (event.target))?.getAttribute('src') === image.value) index.value++
  }
  return { image, imageSource, imageFailed }
}
