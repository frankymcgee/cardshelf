<script setup lang="ts">
import { batchItemState } from '../../shared/scan-batch.mjs'
const props = defineProps<{ state: any, canAnalyse: boolean, selectedId: string, disabled: boolean }>()
const emit = defineEmits<{ files: [files: File[]], start: [], pause: [], review: [id: string], skip: [item: any], clear: [], refresh: [] }>()
const clearing = ref(false)
const locked = computed(() => props.disabled || props.state.locked)
const labels: Record<string, string> = { queued: 'Queued', check: 'Check receipt', processing: 'Analysing', ready: 'Ready to review', added: 'Added', undone: 'Undone', failed: 'Recognition failed', skipped: 'Skipped', photo: 'Reselect original photo' }
function files(event: Event) {
  const input = event.target as HTMLInputElement
  emit('files', Array.from(input.files || [])); input.value = ''
}
</script>
<template>
  <section class="batch-panel panel" aria-label="Batch scanning queue">
    <div class="section-heading"><div><span class="eyebrow">ONE PHOTO PER CARD</span><h2>Your scanning queue</h2><p>Queue up to 20 photos, then review each exact printing before adding it.</p></div><span class="badge purple">{{ state.items.length }} / 20 photos</span></div>
    <p v-if="state.error" class="alert error" role="alert">{{ state.error }}</p>
    <p v-if="state.notice" class="alert info batch-notice" role="status">{{ state.notice }}</p>
    <p v-if="state.storageWarning" class="alert warning">{{ state.storageWarning }}</p>
    <div class="batch-upload">
      <label>Choose card photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple :disabled="locked" @change="files" /></label>
      <label>Take another card photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" :disabled="locked" @change="files" /></label>
    </div>
    <p v-if="state.preparing || state.restoring" role="status">{{ state.preparing ? 'Preparing photos one at a time…' : 'Checking saved scan receipts…' }}</p>
    <template v-if="state.items.length">
      <dl class="batch-stats"><div><dt>To analyse / check</dt><dd>{{ state.summary.queued }}</dd></div><div><dt>Ready to review</dt><dd>{{ state.summary.ready }}</dd></div><div><dt>Added</dt><dd>{{ state.summary.added }}</dd></div><div><dt>Skipped</dt><dd>{{ state.summary.skipped }}</dd></div></dl>
      <label class="batch-consent"><input v-model="state.consent" type="checkbox" :disabled="locked" />Send the queued card photos to OpenAI for recognition.</label>
      <p class="data-note">Each new analysis uses one scan from your allowance, including failed recognition. Photos are processed sequentially; nothing is added automatically. Pause stops after the current photo.</p>
      <div class="button-row batch-actions">
        <button v-if="!state.running" class="button primary" :disabled="locked || !state.consent || !state.hasWork || !canAnalyse" @click="emit('start')">Analyse queued photos</button>
        <button v-else class="button secondary" :disabled="state.pauseRequested" @click="emit('pause')">{{ state.pauseRequested ? 'Pausing after this photo…' : 'Pause after this photo' }}</button>
        <button class="text-button" :disabled="locked" @click="clearing = true">Clear queue</button>
        <button class="text-button" :disabled="locked" @click="emit('refresh')">Refresh scan access</button>
      </div>
      <div class="batch-items">
        <article v-for="(item, index) in state.items" :key="item.id" class="batch-item" :class="{ selected: selectedId === item.id }" :data-scan="item.id">
          <img v-if="item.image" :src="item.image" :alt="'Queued photo ' + (index + 1)" /><div v-else class="batch-photo-icon"><AppIcon name="cards" :size="24" /></div>
          <div class="batch-item-copy"><strong>Photo {{ index + 1 }}</strong><span class="badge" :class="{ green: item.receipt?.status === 'added' }">{{ labels[batchItemState(item)] }}</span><small v-if="item.receipt?.addition">{{ item.receipt.addition.quantity }} × {{ item.receipt.addition.name }} · {{ item.receipt.addition.printing_label }}</small><small v-if="item.error || item.receipt?.error" class="danger-text">{{ item.error || item.receipt.error }}</small></div>
          <div class="batch-item-actions">
            <button v-if="item.submitted && !item.skipped" class="button secondary" :disabled="locked" @click="emit('review', item.id)">{{ ['ready', 'added', 'undone'].includes(item.receipt?.status) ? 'Review photo ' : 'Check photo ' }}{{ index + 1 }}</button>
            <button v-if="!['added', 'undone', 'processing'].includes(item.receipt?.status)" class="text-button" :disabled="locked" @click="emit('skip', item)">{{ item.skipped ? 'Restore photo ' : 'Skip photo ' }}{{ index + 1 }}</button>
          </div>
        </article>
      </div>
    </template>
    <p class="data-note">Photos stay in this tab’s memory, not browser storage or CardShelf’s database. This tab remembers request IDs for recovery; after a reload, reselect unprocessed original photos. Submitted results and saved additions remain on the server.</p>
    <AppModal :open="clearing" title="Clear scanning queue?" @close="clearing = false"><p>This removes this tab’s queue and unsent photos. It does not delete scan receipts, undo additions or change your binder.</p><div class="button-row"><button class="button secondary" @click="clearing = false">Keep queue</button><button class="button primary" :disabled="locked" @click="emit('clear'); clearing = false">Clear this queue</button></div></AppModal>
  </section>
</template>
<style scoped>
.batch-panel{padding:26px;margin-bottom:24px}.batch-panel h2{margin:8px 0}.batch-panel .section-heading{gap:16px;align-items:flex-start;flex-wrap:wrap}.batch-panel .section-heading p{font-size:13px;line-height:1.7;color:var(--muted)}.batch-upload{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:20px 0}.batch-upload label{font-size:12px;display:flex;flex-direction:column;gap:10px;min-width:0}.batch-upload input{max-width:100%;min-width:0;font-size:12px}.batch-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:24px 0}.batch-stats div{border-left:1px solid var(--line);padding-left:15px}.batch-stats dt{font-size:11px;color:var(--muted)}.batch-stats dd{font-size:26px;font-weight:700;margin:8px 0 0}.batch-consent{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.7}.batch-consent input{width:18px;height:18px;flex-shrink:0;margin-top:3px;accent-color:var(--primary)}.batch-actions{margin:18px 0}.batch-items{display:flex;flex-direction:column;gap:10px;max-height:420px;overflow:auto;padding:3px}.batch-item{display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:16px;border:1px solid var(--line);border-radius:12px;padding:13px;background:var(--paper)}.batch-item.selected{border-color:var(--primary);background:var(--accent-soft)}.batch-item>img,.batch-photo-icon{width:44px;height:62px;object-fit:contain;border-radius:5px}.batch-photo-icon{display:grid;place-items:center;color:var(--muted);background:var(--surface-soft)}.batch-item-copy{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;min-width:0}.batch-item-copy small{width:100%;font-size:11px;line-height:1.6;overflow-wrap:anywhere}.batch-item-actions{display:flex;gap:12px;align-items:center}.batch-panel>.data-note{line-height:1.8;margin-top:18px}@media(max-width:700px){.batch-panel{padding:18px}.batch-upload{grid-template-columns:1fr}.batch-stats{grid-template-columns:1fr 1fr;gap:18px}.batch-item{grid-template-columns:44px minmax(0,1fr);gap:12px}.batch-item-actions{grid-column:2;flex-wrap:wrap}.batch-actions>.button{width:100%}.batch-item-actions>.button{font-size:11px;padding:10px}}
</style>
