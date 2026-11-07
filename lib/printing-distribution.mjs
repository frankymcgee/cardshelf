import { db, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { DISTRIBUTIONS } from '../shared/printing-distribution.mjs';
import { GAME_CODES } from '../shared/games.mjs';

// Provider details help identify the exact printing; none establish exclusivity.
export function distributionSignals(raw, printing, language) {
  return (Array.isArray(raw?.variants_detailed) ? raw.variants_detailed : [])
    .filter(row=>row && row.type===printing.key && (!Array.isArray(row.languages) || row.languages.includes(language)))
    .map(row=>({ finish: row.type, subtype: typeof row.subtype==='string' ? row.subtype : '',
      foil: typeof row.foil==='string' ? row.foil : '', size: typeof row.size==='string' ? row.size : '',
      stamps: Array.isArray(row.stamp) ? row.stamp.filter(s=>typeof s==='string') : [],
      tcgplayer: Number.isSafeInteger(row.thirdParty?.tcgplayer) && row.thirdParty.tcgplayer>0 ? row.thirdParty.tcgplayer : null,
      cardmarket: Number.isSafeInteger(row.thirdParty?.cardmarket) && row.thirdParty.cardmarket>0 ? row.thirdParty.cardmarket : null }));
}

export async function distributionReview(query = {}) {
  const sql=db(),page=v.integer(Number(query.page??1),'Page',1,100000);
  const game=query.game ? v.oneOf(query.game,'Card game',GAME_CODES) : '';
  const set=query.set ? v.cardId(query.set) : '';
  const mode=v.oneOf(query.mode??'ambiguous','Review mode',['ambiguous','unknown']);
  const where=sql`WHERE EXISTS(SELECT 1 FROM printings p WHERE p.card_id=c.id AND p.catalogue_available AND p.distribution='unknown')
    ${game ? sql`AND c.game=${game}` : sql``} ${set ? sql`AND c.set_id=${set}` : sql``}
    ${mode==='ambiguous' ? sql`AND (SELECT count(*) FROM printings p WHERE p.card_id=c.id AND p.catalogue_available)>=3` : sql``}`;
  return sql.begin('isolation level repeatable read, read only',async tx=>{
    const items=await tx`SELECT c.id,c.name,c.local_id,c.language,c.game,c.raw_data,cs.name AS set_name,
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.label,p.id) FROM printings p WHERE p.card_id=c.id AND p.catalogue_available) AS printings
      FROM cards c JOIN card_sets cs ON cs.id=c.set_id ${where} ORDER BY cs.release_date DESC NULLS LAST,c.set_id,c.local_id,c.id LIMIT 12 OFFSET ${(page-1)*12}`;
    const [count]=await tx`SELECT count(*)::integer AS total FROM cards c ${where}`;
    return {page,limit:12,total:count.total,items:items.map(({raw_data,...card})=>({...card,
      printings:card.printings.map(p=>({...p,distribution_signals:distributionSignals(raw_data,p,card.language)}))}))};
  });
}

export async function reconcilePrintingDistribution(sql, cardId) {
  await sql`UPDATE printings p SET distribution_base=r.distribution,distribution_base_note=r.note,distribution_base_url=r.evidence_url
    FROM cards c JOIN printing_distribution_rules r ON r.game=c.game AND r.language=c.language AND r.provider_card_id=c.provider_id
    WHERE p.card_id=${cardId} AND c.id=p.card_id AND p.key=r.printing_key AND p.source='tcgdex'`;
}
export function distributionInput(input) {
  const o=v.object(input);
  ensure(Object.keys(o).every(key=>['distribution','note','evidence_url','revision'].includes(key)),400,'Unsupported distribution field.');
  const distribution=o.distribution===null ? null : v.oneOf(o.distribution,'Distribution',Object.keys(DISTRIBUTIONS));
  const revision=v.integer(o.revision,'Revision',1,2147483647);
  const note=distribution===null ? '' : v.text(o.note??'','Distribution evidence',distribution==='unknown'?0:1,1000);
  let evidence_url=distribution===null ? '' : v.text(o.evidence_url??'','Evidence URL',distribution==='unknown'?0:1,1000);
  if(evidence_url) {
    let url;try { url=new URL(evidence_url); } catch { ensure(false,400,'Use an HTTPS evidence URL.'); }
    ensure(url.protocol==='https:' && !url.username && !url.password,400,'Use an HTTPS evidence URL without credentials.');
    evidence_url=url.href;
  }
  return {distribution,revision,note,evidence_url};
}
export async function correctPrintingDistribution(actorId, cardInput, printingInput, input) {
  const cardId=v.cardId(cardInput),id=v.uuid(printingInput),change=distributionInput(input);
  return db().begin(async sql=>{
    ensure((await sql`SELECT id FROM cards WHERE id=${cardId} FOR UPDATE`).length,404,'Card not found.');
    const [printing]=await sql`SELECT * FROM printings WHERE id=${id} AND card_id=${cardId} FOR UPDATE`;
    ensure(printing,404,'Printing not found.');
    ensure(printing.distribution_revision===change.revision,409,'The distribution changed. Reload before correcting it.');
    const [updated]=await sql`UPDATE printings SET distribution_override=${change.distribution},distribution_override_note=${change.note},
      distribution_override_url=${change.evidence_url},distribution_revision=distribution_revision+1 WHERE id=${id} RETURNING *`;
    await audit(sql,actorId,'catalogue.printing_distribution',{card_id:cardId,printing_id:id,before:printing.distribution,...change});
    return updated;
  });
}
