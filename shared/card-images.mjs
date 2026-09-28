// Explicit identity mappings only: never select another printing by card name.
// Source identities and URL examples are documented in docs/card-images.md.
const ENGLISH_SETS = Object.freeze({
  mee: { code: 'MEE', total: 8 },
  sve: { code: 'SVE', total: 24 },
  me01: { code: 'MEG', total: 188 }
});
const OFFICIAL = 'https://www.pokemon.com/static-assets/content-assets/cms2/img/cards/web/';
const LIMITLESS = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/';
export const CARD_ARTWORK_CSP_SOURCES = `https://assets.tcgdex.net ${OFFICIAL} ${LIMITLESS}`;

function primaryUrl(value) {
  if (typeof value !== 'string' || value !== value.trim() || /[\\\s]/.test(value)) return null;
  // Existing local artwork (other games and the built-in preview) stays local.
  if (/^\/(?!\/)[A-Za-z0-9/_.,-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (url.hostname === 'assets.tcgdex.net' || url.href.startsWith(OFFICIAL) || url.href.startsWith(LIMITLESS)) return url.href;
  } catch { /* Invalid artwork is handled by the normal placeholder. */ }
  return null;
}

function englishIdentity(card) {
  if (!card || (card.game && card.game !== 'pokemon')) return null;
  const id = card.card_id || card.id;
  const match = typeof id === 'string' && /^en:([a-z0-9]+)-(\d{1,3})$/.exec(id);
  if (!match || (card.language && card.language !== 'en')) return null;
  const [, set, local] = match, mapping = Object.hasOwn(ENGLISH_SETS, set) ? ENGLISH_SETS[set] : null, number = Number(local);
  if (!mapping || number < 1 || number > mapping.total) return null;
  // A contradictory row must not silently display the wrong card.
  if (card.set_id && card.set_id !== `en:${set}`) return null;
  const displayed = card.local_id ?? card.number;
  if (displayed != null && (!/^\d{1,3}$/.test(String(displayed)) || Number(displayed) !== number)) return null;
  return { ...mapping, number };
}

export function cardImageSources(card, { low = true } = {}) {
  if (!card || card.hidden) return [];
  const sources = [], seen = new Set();
  const add = (url, source) => {
    if (url && !seen.has(url)) { seen.add(url); sources.push({ url, source }); }
  };
  const primary = primaryUrl(card.image_url);
  if (primary) {
    if (/^https:\/\/assets\.tcgdex\.net\/.+\/(?:high|low)\.(?:webp|png|jpg)$/.test(primary)) {
      const base = primary.replace(/\/(?:high|low)\.(?:webp|png|jpg)$/, '');
      add(`${base}/${low ? 'low' : 'high'}.webp`, 'TCGdex');
      // A missing thumbnail must not hide a working full-size image.
      add(`${base}/high.webp`, 'TCGdex');
      add(`${base}/high.png`, 'TCGdex');
    } else add(primary, primary.startsWith(OFFICIAL) ? 'Pokémon' : primary.startsWith(LIMITLESS) ? 'Limitless TCG' : 'Catalogue');
  }
  const identity = englishIdentity(card);
  if (identity) {
    const { code, number } = identity;
    add(`${OFFICIAL}${code}/${code}_EN_${number}.png`, 'Pokémon');
    add(`${LIMITLESS}${code}/${code}_${String(number).padStart(3, '0')}_R_EN.png`, 'Limitless TCG');
  }
  return sources;
}
