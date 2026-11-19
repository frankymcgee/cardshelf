<script setup lang="ts">
withDefaults(defineProps<{ card: any; printing?: any; effectsMode?: string; low?: boolean; badges?: boolean }>(),
  { effectsMode: 'subtle', low: true, badges: true })

const trigger = ref<HTMLButtonElement>()
const preview = ref<HTMLDialogElement>()
const expanded = ref(false)

function open() {
  if (preview.value && !preview.value.open) {
    preview.value.showModal()
    expanded.value = true
  }
}
function close() {
  preview.value?.close()
  expanded.value = false
  trigger.value?.focus({ preventScroll: true })
}
onBeforeUnmount(() => preview.value?.close())
</script>

<template>
  <button ref="trigger" type="button" class="artwork-trigger" :aria-label="'Expand ' + card.name + ' artwork'"
    aria-haspopup="dialog" @click="open">
    <CardArtwork :card="card" :printing="printing" :effects-mode="effectsMode" :low="low" :badges="badges" />
    <span class="artwork-expand-label">Expand artwork</span>
  </button>
  <dialog ref="preview" class="artwork-preview" :aria-label="card.name + ' expanded artwork'" @cancel.prevent="close">
    <div class="artwork-preview-layout">
      <header class="artwork-preview-header">
        <h2>{{ card.name }}</h2>
        <button type="button" class="button secondary" autofocus aria-label="Close expanded artwork" @click="close">
          <AppIcon name="close" :size="18" />Close
        </button>
      </header>
      <div class="artwork-preview-stage">
        <CardArtwork v-if="expanded" :card="card" :printing="printing" :effects-mode="effectsMode" :low="false" :badges="badges" />
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.artwork-trigger {
  display: block;
  min-width: 0;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  cursor: zoom-in;
}
.artwork-trigger:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.artwork-expand-label { display: block; margin-top: 5px; font-size: 12px; }
.artwork-preview {
  position: fixed;
  inset: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: #131725;
  color: #fff;
}
.artwork-preview-layout {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  box-sizing: border-box;
  height: 100%;
  padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
    max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
}
.artwork-preview-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.artwork-preview-header h2 { margin: 0; font-size: 18px; overflow-wrap: anywhere; }
.artwork-preview-header button { min-height: 44px; flex-shrink: 0; }
.artwork-preview-stage { display: grid; place-items: center; container-type: size; }
.artwork-preview-stage :deep(.card-artwork) { width: min(100cqw, 71.59cqh); }
</style>
