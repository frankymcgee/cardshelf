/**
 * Feature-based gating survives marketing renames (Plus / Pro) without inventing
 * a billable tier or trusting Stripe product descriptions as authorisation.
 * @param {{features?: Array<{code:string}>}|null|undefined} access
 * @returns {boolean}
 */
export function collectionSyncAllowed(access) {
  const codes = new Set((access?.features || []).map(feature => feature.code));
  return ['collection', 'binders', 'prices'].every(code => codes.has(code));
}
