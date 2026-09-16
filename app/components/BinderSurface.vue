<script setup lang="ts">
import { resolvedAppearance, colourChannels, contrastingText } from '../../shared/appearance.mjs'
const props = defineProps<{ binder: any; shareToken?: string; previewWallpaper?: string; hideWallpaper?: boolean }>()
const theme = computed(() => resolvedAppearance(props.binder?.appearance, props.binder?.color))
const styles = computed(() => ({
  '--binder-color': props.binder?.color || '#5546d8',
  '--pocket-rgb': colourChannels(theme.value.pocket_color).join(', '),
  '--pocket-alpha': Number(theme.value.pocket_opacity) / 100,
  '--pocket-text': contrastingText(theme.value.pocket_color),
  '--pocket-mat': String(theme.value.pocket_color)
}))
</script>
<template>
  <div class="binder-stage themed-stage" :style="styles">
    <BinderWallpaper :binder="binder" :share-token="shareToken" :preview-wallpaper="previewWallpaper" :hide-wallpaper="hideWallpaper" />
    <slot />
  </div>
</template>
