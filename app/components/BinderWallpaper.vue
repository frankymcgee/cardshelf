<script setup lang="ts">
import { resolvedAppearance, wallpaperUrl } from '../../shared/appearance.mjs'
const props = withDefaults(defineProps<{ binder: any; shareToken?: string; previewWallpaper?: string; hideWallpaper?: boolean }>(),
  { shareToken: '', previewWallpaper: '', hideWallpaper: false })
const theme = computed(() => resolvedAppearance(props.binder?.appearance, props.binder?.color))
const image = computed(() => !props.hideWallpaper && theme.value.mode === 'image' ? props.previewWallpaper || wallpaperUrl(props.binder, props.shareToken) : '')
const imageStyle = computed(() => ({
  backgroundImage: image.value ? `url("${image.value}")` : 'none',
  backgroundSize: theme.value.wallpaper_fit === 'tile' ? '320px auto' : theme.value.wallpaper_fit === 'center' ? 'auto' : String(theme.value.wallpaper_fit),
  backgroundRepeat: theme.value.wallpaper_fit === 'tile' ? 'repeat' : 'no-repeat',
  backgroundPosition: 'center', opacity: Number(theme.value.wallpaper_opacity) / 100,
  filter: `blur(${theme.value.wallpaper_blur}px)`
}))
</script>
<template>
  <div class="binder-wallpaper-layer" aria-hidden="true" :style="{ backgroundColor: String(theme.background_color) }">
    <div v-if="image" class="binder-wallpaper-image" :style="imageStyle" />
    <div v-if="image" class="binder-wallpaper-dimmer" :style="{ opacity: Number(theme.wallpaper_dim) / 100 }" />
  </div>
</template>
