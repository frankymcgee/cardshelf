/** Rulebook p21: Levels and Delta Species are not part of a Pokémon name.
 * Keep owner/form labels and suffix case (EX and ex are distinct).
 */
export function arenaPokemonName(value) {
  const name=String(value??'').normalize('NFKC').replace(/[’‘]/g,"'")
    .replace(/\s+LV\.?\s*(?:\d{1,3}|X)(?=\s|$)/gi,'')
    .replace(/\s*δ(?:\s*\(Delta Species\))?/gi,'')
    .replace(/\s*\(Delta Species\)/gi,'').replace(/\s+/g,' ').trim();
  const suffix=name.match(/[-\s](EX|ex)$/)?.[1];
  return suffix?name.slice(0,-suffix.length).replace(/[-\s]+$/,'').toLowerCase()+' '+suffix:name.toLowerCase();
}
