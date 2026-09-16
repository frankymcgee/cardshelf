<script setup lang="ts">
const props = withDefaults(defineProps<{ open: boolean; title: string; wide?: boolean }>(), { wide: false })
const emit = defineEmits(['close'])
const dialog = ref<HTMLDialogElement>()
function syncBody() { document.body.classList.toggle('has-modal', !!document.querySelector('dialog[open]')) }
watch(() => props.open, async value => {
  await nextTick()
  if (value && dialog.value && !dialog.value.open) dialog.value.showModal()
  if (!value && dialog.value?.open) dialog.value.close()
  syncBody()
}, { immediate: true })
function close() { dialog.value?.close(); syncBody(); emit('close') }
onBeforeUnmount(() => { dialog.value?.close(); syncBody() })
</script>
<template><Teleport to="body"><dialog ref="dialog" class="modal" :class="{ wide }" :aria-label="title" @cancel.prevent="close" @click="($event.target === dialog) && close()"><header class="modal-header"><h2>{{ title }}</h2><button class="icon-button" aria-label="Close dialog" autofocus @click="close"><AppIcon name="close" /></button></header><div class="modal-body"><slot /></div></dialog></Teleport></template>
