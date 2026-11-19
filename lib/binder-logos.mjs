import { ensure } from './errors.mjs';
import { fetchProvider } from './provider.mjs';

export function binderLogoSource(sets) {
  const [first] = sets;
  if (!first || sets.some(set => set.game !== 'pokemon' || set.language !== first.language)) return null;
  if (sets.length === 1) return { set: first, title: first.name };
  if (!first.series || sets.some(set => set.series !== first.series)) return null;
  return { set: first, title: first.series, series: true };
}

export function binderLogoUrl(value) {
  if (typeof value !== 'string' ||
    !/^https:\/\/assets\.tcgdex\.net\/(?:[a-z0-9_-][a-z0-9_.+-]*\/)+logo(?:\.(?:png|webp|jpg))?$/i.test(value)) return null;
  return /\.(?:png|webp|jpg)$/i.test(value) ? value : value + '.webp';
}

export async function resolveBinderLogo(source, fetchCatalogue = fetchProvider) {
  ensure(source, 400, 'Choose a Pokémon set or sets from the same Pokémon series to use a logo.');
  const { set, series } = source;
  const options = { attempts: 1, timeout: 5000 };
  let logo;
  try {
    const details = await fetchCatalogue(set.language, 'sets/' + set.provider_id, options);
    logo = details?.logo;
    if (series) {
      const id = details?.serie?.id;
      logo = id ? (await fetchCatalogue(set.language, 'series/' + id, options))?.logo : null;
    }
  } catch {
    ensure(false, 502, 'TCGdex could not load the logo. Try again or choose the text name.');
  }
  const url = binderLogoUrl(logo);
  ensure(url, 400, 'TCGdex has no logo for this set or series. Choose the text name.');
  return url;
}

export async function existingBinderLogoSource(sql, binder) {
  if (binder.game !== 'pokemon') return null;
  const generated = binder.generation?.options?.set_ids;
  const sets = Array.isArray(generated) && generated.length
    ? await sql`SELECT id,provider_id,language,game,name,series FROM card_sets WHERE id IN ${sql(generated)} ORDER BY id`
    : await sql`SELECT DISTINCT cs.id,cs.provider_id,cs.language,cs.game,cs.name,cs.series
        FROM binder_slots s JOIN printings p ON p.id=s.printing_id JOIN cards c ON c.id=p.card_id JOIN card_sets cs ON cs.id=c.set_id
        WHERE s.binder_id=${binder.id} ORDER BY cs.id`;
  if (generated?.length && sets.length !== generated.length) return null;
  return binderLogoSource(sets);
}
