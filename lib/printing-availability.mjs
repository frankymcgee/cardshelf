import { db, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import { providerPrintings } from './variants.mjs';
import * as v from './validate.mjs';

export async function reconcileProviderPrintings(sql, cardId, flags) {
  const variants=providerPrintings(flags);
  for(const p of variants.filter(p=>p.key!=='unspecified')) await sql`INSERT INTO printings(card_id,key,label,source,verified,metadata)
    VALUES(${cardId},${p.key},${p.label},'tcgdex',false,${sql.json(p.metadata)})
    ON CONFLICT(card_id,key) DO UPDATE SET metadata=excluded.metadata,provider_active=true WHERE printings.source='tcgdex'`;
  // Missing or partial provider data must not erase known choices. Only an explicit
  // false flag retires a finish; overrides survive every import.
  const disabled=Object.entries(flags && typeof flags==='object' ? flags : {}).filter(([,value])=>value===false).map(([key])=>key);
  if(variants.some(p=>p.key!=='unspecified')) disabled.push('unspecified');
  if(disabled.length) await sql`UPDATE printings SET provider_active=false WHERE card_id=${cardId} AND source='tcgdex' AND key IN ${sql(disabled)}`;
  if(!variants.some(p=>p.key!=='unspecified')) {
    const known=await sql`SELECT id FROM printings WHERE card_id=${cardId} AND key<>'unspecified' AND catalogue_available LIMIT 1`;
    if(!known.length) await sql`INSERT INTO printings(card_id,key,label,source,verified,metadata) VALUES(${cardId},'unspecified','Unspecified printing','tcgdex',false,'{"basis":"missing_provider_flags"}'::jsonb)
      ON CONFLICT(card_id,key) DO UPDATE SET provider_active=true WHERE printings.source='tcgdex'`;
  }
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
