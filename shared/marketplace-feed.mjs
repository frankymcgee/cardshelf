// A per-visit seed keeps the mix steady during reactive updates. Only affiliates
// are shuffled: collector sort order, pagination and the keyed ad remain intact.
export function marketplaceAffiliateRows(rows, links, seed = 0) {
  const base = Array.isArray(rows) ? rows : [];
  const affiliates = Array.isArray(links) ? links : [];
  if (!affiliates.length) return base.slice();
  let state = Number(seed) >>> 0;
  const random = () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const shuffle = items => {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const gaps = shuffle(Array.from({ length: base.length + 1 }, (_, i) => i));
  const buckets = Array.from({ length: gaps.length }, () => []);
  shuffle(affiliates).forEach((item, i) => buckets[gaps[i % gaps.length]].push({ key: 'affiliate:' + item.id, kind: 'affiliate', item }));
  return buckets.flatMap((bucket, i) => i < base.length ? [...bucket, base[i]] : bucket);
}
