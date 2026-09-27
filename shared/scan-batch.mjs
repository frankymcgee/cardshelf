// The queue reuses single-photo receipts. It never confirms inventory or changes
// provider settings, quota admission, or the server's one-at-a-time analysis lock.
export const SCAN_BATCH_LIMIT = 20;
export const SCAN_BATCH_IMAGE_LIMIT = 24_000_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminal = new Set(['ready', 'added', 'undone', 'failed']);
export function batchItemState(item) {
  if (item.skipped) return 'skipped';
  if (item.analysing) return 'processing';
  if (item.receipt) return item.receipt.status;
  if (item.submitted) return 'check';
  return item.image ? 'queued' : 'photo';
}
export function batchSummary(items) {
  const states = items.map(batchItemState);
  return { total: items.length, queued: states.filter(s => ['queued', 'check', 'processing'].includes(s)).length,
    ready: states.filter(s => s === 'ready').length, added: states.filter(s => s === 'added').length,
    skipped: states.filter(s => s === 'skipped').length, missing_photos: states.filter(s => s === 'photo').length };
}
export function batchHasWork(item) {
  return !item.skipped && !terminal.has(item.receipt?.status) && (!!item.image || item.submitted);
}
export function batchSnapshot(owner, items) {
  // No photos, filenames, candidate text, inventory or confirmation bodies in storage.
  return JSON.stringify({ version: 1, owner, items: items.slice(0, SCAN_BATCH_LIMIT).map(i => ({
    id: i.id, fingerprint: i.fingerprint, submitted: !!i.submitted, skipped: !!i.skipped
  })) });
}
export function restoreBatchSnapshot(raw, owner) {
  try {
    if (!owner || typeof raw !== 'string' || raw.length > 20_000) return [];
    const data = JSON.parse(raw);
    if (data.version !== 1 || data.owner !== owner || !Array.isArray(data.items) || data.items.length > SCAN_BATCH_LIMIT) return [];
    const ids = new Set(), hashes = new Set();
    return data.items.map(i => {
      if (!i || typeof i.id !== 'string' || !uuid.test(i.id) || typeof i.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(i.fingerprint) || typeof i.submitted !== 'boolean' || typeof i.skipped !== 'boolean' || ids.has(i.id.toLowerCase()) || hashes.has(i.fingerprint)) throw new Error('Invalid queue');
      ids.add(i.id.toLowerCase()); hashes.add(i.fingerprint);
      return { id: i.id, fingerprint: i.fingerprint, submitted: i.submitted, skipped: i.skipped, image: '', receipt: null, error: '' };
    });
  } catch { return []; }
}
function status(error) { return error?.statusCode || error?.status || error?.response?.status; }
function message(error) { return error?.data?.message || error?.message || 'The queue stopped. Check the scan before retrying.'; }
function validReceipt(receipt, id) {
  if (!receipt || receipt.id !== id || !['processing', ...terminal].includes(receipt.status)) throw new Error('The scan response could not be verified. Check the queue before retrying.');
  return receipt;
}
export async function runScanBatch(items, { api, availability, update, alive = () => true, paused = () => false, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let processed = 0;
  for (const item of items) {
    if (!alive() || paused()) return { status: 'paused', processed };
    if (!batchHasWork(item)) continue;
    try {
      let receipt = item.receipt;
      if (item.submitted) {
        try { receipt = validReceipt(await api('/api/scans/' + item.id), item.id); }
        catch (e) { if (status(e) !== 404) throw e; receipt = null; }
      }
      if (!alive()) return { status: 'paused', processed };
      if (!receipt) {
        if (!item.image) throw new Error('Reselect this original photo to retry the same request, or skip it. No new scan was sent.');
        const access = await availability();
        if (!alive() || paused()) return { status: 'paused', processed };
        if (!access?.available) throw new Error(access?.message || 'Scanning is unavailable. Check your membership, allowance or the shared budget.');
        update(item, { submitted: true, analysing: true, error: '' }); // Persist the ID before dispatch.
        try {
          receipt = validReceipt(await api('/api/scans', { method: 'POST', body: { request_id: item.id, image: item.image, confirm_external_processing: true } }), item.id);
        } catch (original) {
          // Never generate a new ID or blindly repeat a potentially charged call.
          if (!alive()) return { status: 'paused', processed };
          try { receipt = validReceipt(await api('/api/scans/' + item.id), item.id); }
          catch { throw original; }
        }
      }
      if (!alive()) return { status: 'paused', processed };
      update(item, { receipt, analysing: false, error: '' });
      while (receipt.status === 'processing') {
        await wait(2500);
        if (!alive()) return { status: 'paused', processed };
        receipt = validReceipt(await api('/api/scans/' + item.id), item.id);
        if (!alive()) return { status: 'paused', processed };
        update(item, { receipt });
      }
      if (receipt.status === 'failed') throw new Error(receipt.error || 'Recognition failed. Review this photo before continuing with the rest.');
      processed++;
    } catch (error) {
      if (alive()) update(item, { analysing: false, error: message(error) });
      return { status: 'stopped', processed, error: message(error) };
    }
  }
  return { status: paused() ? 'paused' : 'complete', processed };
}
