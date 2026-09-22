<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import ArenaModal from './ArenaModal.vue'
import ArenaDecision from './ArenaDecision.vue'
const props = defineProps<{ prompt: any; revision?: number; locked?: boolean }>()
const emit = defineEmits<{ choose: [ids: string[]] }>()
const minimized = ref(false)
// A new acknowledged revision also separates consecutive prompts with identical options.
// Ordinary polling of the same revision must not discard the user's in-progress choices.
const signature = computed(() => JSON.stringify([props.revision, props.prompt?.kind, props.prompt?.title, props.prompt?.min, props.prompt?.max, props.prompt?.options?.map((option: any) => option.id)]))
watch(signature, () => { minimized.value = false }, { immediate: true })
</script>
<template>
  <div v-if="prompt" class="arena-prompt-controller">
    <div v-if="minimized" class="arena-alert arena-prompt-resume" role="status"><div><strong>{{ prompt.title }}</strong><p>The decision is still pending. Viewing the table does not confirm or cancel it.</p></div><button type="button" class="arena-button primary" aria-haspopup="dialog" @click="minimized = false">Resume decision</button></div>
    <ArenaModal :open="!minimized" label="Required game decision" close-label="Back to table" @close="minimized = true">
      <p v-if="locked" class="arena-alert" role="status">Actions are paused. Use Back to table to check the connection or retry the previous action.</p>
      <ArenaDecision :key="signature" :prompt="prompt" :locked="locked" @choose="emit('choose', $event)" />
    </ArenaModal>
  </div>
</template>
