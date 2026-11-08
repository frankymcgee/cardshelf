import { db, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import { providerPrintings, providerPrintingEvidence } from './variants.mjs';
import * as v from './validate.mjs';
import { reconcilePrintingDistribution } from './printing-distribution.mjs';

export async function reconcileProviderPrintings(sql, cardId, flags, raw = {}) {
  const language=cardId.split(':')[0];
  const variants=providerPrintings(flags,raw,language);
  const {flags:effective,retired}=providerPrintingEvidence(flags,raw,language);
  for(const p of variants.filter(p=>p.key!=='unspecified')) await sql`INSERT INTO printings(card_id,key,label,source,verified,metadata)
    VALUES(${cardId},${p.key},${p.label},'tcgdex',false,${sql.json(p.metadata)})
    ON CONFLICT(card_id,key) DO UPDATE SET metadata=excluded.metadata,provider_active=true WHERE printings.source='tcgdex'
      AND (printings.metadata->>'basis' IS DISTINCT FROM 'generated_placeholder' OR excluded.metadata->>'basis'<>'provider_flag')`;
  if(retired.length) await sql`UPDATE printings SET provider_active=false,metadata=metadata || '{"basis":"generated_placeholder"}'::jsonb
    WHERE card_id=${cardId} AND source='tcgdex' AND key IN ${sql(retired)}
      AND coalesce(metadata->>'basis','provider_flag') IN ('provider_flag','generated_placeholder')`;
  // Missing or partial provider data must not erase known choices. An explicit
  // false flag can retire a flag-only choice, but cannot undo detailed/market
  // evidence during a feed omission. Admin overrides survive every import.
  const disabled=Object.entries(effective).filter(([,value])=>value===false).map(([key])=>key);
  if(variants.some(p=>p.key!=='unspecified')) disabled.push('unspecified');
  if(disabled.length) await sql`UPDATE printings SET provider_active=false WHERE card_id=${cardId} AND source='tcgdex' AND key IN ${sql(disabled)}
    AND coalesce(metadata->>'basis','provider_flag') NOT IN ('tcgplayer_finish','detailed_variant')`;
  if(!variants.some(p=>p.key!=='unspecified')) {
    const known=await sql`SELECT id FROM printings WHERE card_id=${cardId} AND key<>'unspecified' AND catalogue_available LIMIT 1`;
    if(!known.length) await sql`INSERT INTO printings(card_id,key,label,source,verified,metadata) VALUES(${cardId},'unspecified','Unspecified printing','tcgdex',false,'{"basis":"missing_provider_flags"}'::jsonb)
      ON CONFLICT(card_id,key) DO UPDATE SET provider_active=true WHERE printings.source='tcgdex'
      AND (printings.metadata->>'basis' IS DISTINCT FROM 'generated_placeholder' OR excluded.metadata->>'basis'<>'provider_flag')`;
  }
  await reconcilePrintingDistribution(sql,cardId);
}

export async function correctPrinting(actorId, cardInput, printingInput, input) {
  const cardId=v.cardId(cardInput), id=v.uuid(printingInput), o=v.object(input);
  const available=o.available===null ? null : v.bool(o.available,'Catalogue availability');
  const revision=v.integer(o.revision,'Revision',1,2147483647);
  return db().begin(async sql=>{
    ensure((await sql`SELECT id FROM cards WHERE id=${cardId} FOR UPDATE`).length,404,'Card not found.');
    const [printing]=await sql`SELECT * FROM printings WHERE id=${id} AND card_id=${cardId} FOR UPDATE`;
    ensure(printing,404,'Printing not found.');
    ensure(printing.availability_revision===revision,409,'The printing changed. Reload before correcting it.');
    if(!(available??printing.provider_active)) ensure((await sql`SELECT id FROM printings WHERE card_id=${cardId} AND id<>${id} AND catalogue_available`).length,400,'Keep at least one available printing.');
    const [updated]=await sql`UPDATE printings SET availability_override=${available},availability_revision=availability_revision+1 WHERE id=${id} RETURNING *`;
    await audit(sql,actorId,'catalogue.printing_availability',{card_id:cardId,printing_id:id,available});
    return updated;
  });
}
