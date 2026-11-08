// Exact synthetic card data only; no provider downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db,closeDatabase } from '../../lib/db.mjs';
import { reconcileProviderPrintings } from '../../lib/printing-availability.mjs';
import { saveAutomaticDistribution } from '../../lib/automatic-distribution.mjs';
import { migrate } from '../../migrations/044_provider_finish_evidence.mjs';
if(process.env.ALLOW_TEST_DATABASE!=='yes'||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.endsWith('_test'))throw Error('Use a disposable _test database.');
const sql=db(),user=randomUUID(),provider='finish-'+randomUUID(),set='en:'+provider,card=set+'-001';
const raw={variants:{normal:true,holo:false,reverse:false},variants_detailed:[{type:'normal',variantId:'generated'}],
  pricing:{tcgplayer:{unit:'USD',holofoil:{marketPrice:1},'reverse-holofoil':{marketPrice:2}}}};
await test('stored-data backfill and refreshes preserve printing IDs, inventory, pockets and corrections',async()=>{
  try {
    await sql`INSERT INTO app_users(id,email,name,password_hash,role) VALUES(${user},${user+'@example.test'},'Finish fixture','unused hash','admin')`;
    await sql`INSERT INTO card_sets(id,provider_id,language,name) VALUES(${set},${provider},'en','Finish fixture')`;
    await sql`INSERT INTO cards(id,provider_id,set_id,language,local_id,name,raw_data) VALUES(${card},${provider+'-001'},${set},'en','001','Finish fixture',${sql.json(raw)})`;
    await sql.begin(tx=>reconcileProviderPrintings(tx,card,raw.variants));
    const [normal]=await sql`SELECT * FROM printings WHERE card_id=${card} AND key='normal'`;
    const [manual]=await sql`INSERT INTO printings(card_id,key,label,source,metadata) VALUES(${card},'reverse','Custom reverse','manual','{"custom":true}') RETURNING *`;
    const [binder]=await sql`INSERT INTO binders(user_id,title,columns,rows,page_count) VALUES(${user},'Finish fixture',3,3,1) RETURNING *`;
    await sql`INSERT INTO binder_slots(binder_id,position,printing_id) VALUES(${binder.id},0,${normal.id})`;
    await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity) VALUES(${user},${normal.id},'NM',3)`;
    await sql.begin(tx=>migrate(tx));
    const first=await sql`SELECT * FROM printings WHERE card_id=${card} ORDER BY key`;
    assert.equal(first.length,3);const holo=first.find(p=>p.key==='holo');
    assert.equal(holo.catalogue_available,true);assert.equal(holo.metadata.basis,'tcgplayer_finish');
    assert.deepEqual(first.find(p=>p.id===manual.id).metadata,{custom:true});
    const observed={...raw,name:'Fixture',id:provider+'-001',localId:'001',set:{name:'Fixture Set'},pricing:{tcgplayer:{unit:'USD',holofoil:{productId:123,marketPrice:1}}}};
    const products=[{group:{name:'Fixture Set',groupId:456},product:{name:'Fixture',productId:123,categoryId:3,groupId:456,extendedData:[{name:'Number',value:'001/100'}]}}];
    await sql.begin(tx=>saveAutomaticDistribution(tx,observed,'en',products));
    const [rule]=await sql`SELECT * FROM printing_distribution_rules WHERE provider_card_id=${observed.id}`;
    assert.equal(rule.automatic,true);assert.equal(rule.distribution,'regular');
    await sql`UPDATE printing_distribution_rules SET automatic=false,distribution='promo' WHERE provider_card_id=${observed.id}`;
    await sql.begin(tx=>saveAutomaticDistribution(tx,observed,'en',products));
    assert.equal((await sql`SELECT distribution FROM printing_distribution_rules WHERE provider_card_id=${observed.id}`)[0].distribution,'promo');
    await sql`DELETE FROM printing_distribution_rules WHERE provider_card_id=${observed.id}`;
    await sql`UPDATE printings SET availability_override=false,distribution_override='product_exclusive',distribution_override_note='Fixture' WHERE id=${holo.id}`;
    await sql.begin(tx=>migrate(tx));
    // A partial later feed must not suppress a previously sourced finish.
    await sql.begin(tx=>reconcileProviderPrintings(tx,card,raw.variants,{}));
    const fresh=await sql`SELECT * FROM printings WHERE card_id=${card} ORDER BY key`;
    assert.deepEqual(fresh.map(p=>p.id),first.map(p=>p.id));
    assert.equal(fresh.find(p=>p.id===normal.id).provider_active,false,'Generated Normal stays retired when later data is incomplete');
    const h=fresh.find(p=>p.id===holo.id);assert.equal(h.provider_active,true);assert.equal(h.catalogue_available,false);assert.equal(h.distribution,'product_exclusive');
    const [entry]=await sql`SELECT * FROM collection_entries WHERE user_id=${user}`;assert.equal(entry.quantity,3);assert.equal(entry.printing_id,normal.id);
    const slots=await sql`SELECT * FROM binder_slots WHERE binder_id=${binder.id}`;assert.equal(slots.length,1);assert.equal(slots[0].printing_id,normal.id);
    assert.equal(fresh.find(p=>p.id===manual.id).source,'manual');
  } finally {
    await sql`DELETE FROM printing_distribution_rules WHERE provider_card_id=${provider+'-001'}`;
    await sql`DELETE FROM app_users WHERE id=${user}`;
    await sql`DELETE FROM printings WHERE card_id=${card}`;
    await sql`DELETE FROM cards WHERE id=${card}`;
    await sql`DELETE FROM card_sets WHERE id=${set}`;
    await closeDatabase();
  }
});
