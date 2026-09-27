import { batchHasWork, batchSnapshot, batchSummary, restoreBatchSnapshot, runScanBatch, SCAN_BATCH_IMAGE_LIMIT, SCAN_BATCH_LIMIT } from '../../shared/scan-batch.mjs'
import { prepareCardScanPhoto, cardScanPhotoFingerprint } from '../utils/scan-photo'
export function useScanBatch() {
  const api = useApi(), auth = useAuth()
  const items = ref<any[]>([]), running = ref(false), preparing = ref(false), restoring = ref(false), pauseRequested = ref(false), consent = ref(false)
  const error = ref(''), notice = ref(''), storageWarning = ref('')
  const summary = computed(() => batchSummary(items.value)), hasWork = computed(() => items.value.some(batchHasWork))
  const locked = computed(() => running.value || preparing.value || restoring.value)
  let alive = true, owner = '', cancelWait: (() => void) | undefined
  const key = () => 'cardshelf.scan-batch.v1:' + owner
  function persist() {
    if (!owner || !alive) return
    try { sessionStorage.setItem(key(), batchSnapshot(owner, items.value)) }
    catch { storageWarning.value = 'This browser cannot retain queue IDs. Keep this tab open; submitted scans are still available in Recent scans.' }
  }
  function update(item: any, patch: any) {
    if (!alive) return
    Object.assign(item, patch)
    if (['added', 'undone'].includes(item.receipt?.status)) item.image = ''
    persist()
  }
  function syncReceipt(receipt: any) {
    const item = items.value.find(i => i.id === receipt.id)
    if (item) update(item, { receipt, submitted: true, error: '' })
  }
  async function restore() {
    if (owner || !alive) return
    owner = auth.state.value.user?.id || ''
    if (!owner) return
    restoring.value = true
    try {
      items.value = restoreBatchSnapshot(sessionStorage.getItem(key()), owner)
      for (const item of items.value.filter(i => i.submitted)) {
        try {
          const receipt = await api('/api/scans/' + item.id)
          if (!alive) return
          if (receipt.id !== item.id) throw new Error('This scan could not be verified.')
          update(item, { receipt })
        } catch (e) { if (alive) item.error = errorMessage(e) }
      }
      if (alive && items.value.length) notice.value = 'Queue restored. Submitted results were checked without sending photos again. Reselect any unprocessed original photos to continue.'
    } catch { storageWarning.value = 'Queue recovery is unavailable in this browser. Submitted scans remain in Recent scans.' }
    finally { if (alive) restoring.value = false }
  }
  async function addFiles(files: File[]) {
    if (!alive || !owner || locked.value || !files.length) return
    if (files.length > SCAN_BATCH_LIMIT) { error.value = 'Choose no more than 20 photos at once.'; return }
    preparing.value = true; error.value = ''; notice.value = ''; consent.value = false
    let duplicates = 0, accepted = 0
    try {
      for (const file of files) {
        const image = await prepareCardScanPhoto(file)
        if (!alive) return
        const fingerprint = await cardScanPhotoFingerprint(image)
        if (!alive) return
        const existing = items.value.find(i => i.fingerprint === fingerprint)
        if (existing?.image || existing && ['added', 'undone', 'failed'].includes(existing.receipt?.status)) { duplicates++; continue }
        if (!existing && items.value.length >= SCAN_BATCH_LIMIT) throw new Error('This queue is limited to 20 photos. Finish or clear it before starting another batch.')
        if (items.value.reduce((n, i) => n + i.image.length, 0) + image.length > SCAN_BATCH_IMAGE_LIMIT) throw new Error('The queue reached its photo-memory limit. Use smaller photos or finish this batch first.')
        if (existing) update(existing, { image, error: '' })
        else { items.value.push({ id: crypto.randomUUID(), fingerprint, image, submitted: false, skipped: false, receipt: null, error: '' }); persist() }
        accepted++
      }
    } catch (e) { if (alive) error.value = errorMessage(e) }
    finally {
      if (alive) { preparing.value = false; notice.value = `${accepted} photo${accepted === 1 ? '' : 's'} queued${duplicates ? `; ${duplicates} duplicate${duplicates === 1 ? '' : 's'} ignored. For multiple copies, change the quantity during review` : ''}.` }
    }
  }
  async function start(availability: () => Promise<any>) {
    if (!alive || !owner || locked.value || !consent.value || !hasWork.value) return
    running.value = true; pauseRequested.value = false; error.value = ''; notice.value = ''
    try {
      const result = await runScanBatch(items.value, { api, availability, update, alive: () => alive, paused: () => pauseRequested.value,
        wait: (ms: number) => new Promise<void>(resolve => { const timer = setTimeout(() => { cancelWait = undefined; resolve() }, ms); cancelWait = () => { clearTimeout(timer); resolve() } }) })
      if (alive) { error.value = result.error || ''; notice.value = result.status === 'paused' ? 'Queue paused. Review completed scans or continue when ready.' : result.status === 'stopped' ? 'Queue stopped. No remaining photos were sent. Resolve the issue before continuing.' : 'Recognition finished. Review each match before adding cards.' }
    } finally { if (alive) running.value = false }
  }
  function skip(item: any) { if (!locked.value) { update(item, { skipped: !item.skipped }); consent.value = false } }
  function clear() {
    if (locked.value) return
    items.value = []; consent.value = false; error.value = ''; notice.value = 'Queue cleared. Saved scan receipts and collection additions are unchanged.'; persist()
  }
  watch(() => auth.state.value.user?.id, id => {
    if (owner && id !== owner) {
      alive = false; cancelWait?.(); for (const item of items.value) item.image = ''
      items.value = []; running.value = false; preparing.value = false; restoring.value = false; consent.value = false
    }
  })
  onBeforeUnmount(() => { alive = false; cancelWait?.(); for (const item of items.value) item.image = '' })
  return { items, summary, hasWork, running, preparing, restoring, locked, pauseRequested, consent, error, notice, storageWarning, restore, addFiles, start, skip, clear, syncReceipt }
}
