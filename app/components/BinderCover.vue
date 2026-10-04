<script setup lang="ts">
import { coverAppearance, contrastingText, wallpaperUrl } from '../../shared/appearance.mjs'
import { binderTypeLabel } from '../../shared/binder-types.mjs'
const props = defineProps<{ binder: any; shareToken?: string; previewWallpaper?: string; hideWallpaper?: boolean }>()
const cover = computed(() => coverAppearance(props.binder))
const hasImage = computed(() => !props.hideWallpaper && cover.value.mode === 'image' &&
  !!(props.previewWallpaper || wallpaperUrl(props.binder, props.shareToken, 'cover')))
const styles = computed(() => ({ '--binder-color': cover.value.background_color,
  '--cover-text': hasImage.value ? '#ffffff' : contrastingText(cover.value.background_color) }))
</script>
<template>
  <div class="binder-cover custom-binder-cover" :class="{ 'has-cover-image': hasImage }" :style="styles">
    <BinderWallpaper :binder="binder" surface="cover" :share-token="shareToken" :preview-wallpaper="previewWallpaper" :hide-wallpaper="hideWallpaper" />
    <div class="binder-rings" aria-hidden="true"><i /><i /><i /></div>
    <div class="binder-cover-caption">
      <AppIcon :name="binder.binder_type === 'tracking' ? 'check' : 'binder'" :size="28" />
      <span>{{ binder.title }}</span>
      <small>{{ binderTypeLabel(binder).toUpperCase() }}</small>
    </div>
  </div>
</template>
