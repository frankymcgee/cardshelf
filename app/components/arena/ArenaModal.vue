<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
const props = defineProps<{ open: boolean; label: string; closeLabel?: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let opener: HTMLElement | null = null
function restoreFocus() {
  const target = opener
  void nextTick(() => {
    if (typeof document === 'undefined' || document.querySelector('dialog.arena-modal[open]')) return
    if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true })
  })
}
function syncOpen() {
  if (!dialog.value) return
  if (props.open && !dialog.value.open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.value.showModal()
  } else if (!props.open && dialog.value.open) {
    dialog.value.close()
    restoreFocus()
  }
}
onMounted(syncOpen)
watch(() => props.open, syncOpen, { flush: 'post' })
onBeforeUnmount(() => { dialog.value?.close(); restoreFocus() })
</script>
<template>
  <dialog ref="dialog" class="arena-modal" :aria-label="label" aria-modal="true" @cancel.prevent="emit('close')">
    <header class="arena-modal-header"><strong>{{ label }}</strong><button type="button" class="arena-button quiet" autofocus @click="emit('close')">{{ closeLabel || 'Close' }}</button></header>
    <div class="arena-modal-body"><slot /></div>
  </dialog>
</template>
