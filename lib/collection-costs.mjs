import { db, collectionLock, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import { digest } from './security.mjs';
import { requirePrintingGame } from './game-access.mjs';
import { requireCapability, membershipState } from './membership.mjs';
import { costDate, costMoney, remainingCost } from './cost-logic.mjs';
import { valueRows } from './price-logic.mjs';
import * as v from './validate.mjs';

async function access(sql,userId,printingId) {
  const {access}=await membershipState(userId,sql);
  ensure(['collection','prices'].every(code=>access.features.some(f=>f.code===code)),403,'Purchase tracking requires collection and price access.');
  await requirePrintingGame(sql,userId,printingId);
}
async function entry(sql,userId,printingId,condition,revision) {
  const [row]=await sql`SELECT * FROM collection_entries WHERE user_id=${userId} AND printing_id=${printingId} AND condition=${condition} FOR UPDATE`;
  ensure((row?.revision??0)===revision,409,'Ownership changed. Reload before recording this transaction.');
  return row;
}
async function request(userId,input,run) {
  const o=v.object(input),requestId=v.uuid(o.request_id,'Request ID'),hash=digest(JSON.stringify(o));
  return db().begin(async sql=>{
    await collectionLock(sql,userId);
    const [previous]=await sql`SELECT * FROM collection_cost_requests WHERE user_id=${userId} AND request_id=${requestId}`;
    if(previous) {ensure(previous.input_hash===hash,409,'This request ID was used for different purchase details.');return {...previous.result,replayed:true};}
    const result=await run(sql,o);
    await sql`INSERT INTO collection_cost_requests(user_id,request_id,input_hash,result) VALUES(${userId},${requestId},${hash},${sql.json(result)})`;
    return result;
  });
}
export async function recordPurchase(userId,input) {
  return request(userId,input,async(sql,o)=>{
    const printingId=v.uuid(o.printing_id),condition=v.oneOf(o.condition,'Condition',v.CONDITIONS),quantity=v.integer(o.quantity,'Copies',1,9999);
    const date=costDate(o.acquired_on,'Purchase date'),money=costMoney(o),add=v.bool(o.add_to_collection??false,'Add copies');
    await access(sql,userId,printingId);
    const current=await entry(sql,userId,printingId,condition,v.integer(o.entry_revision,'Ownership revision',0,2147483647));
    const [{tracked}]=await sql`SELECT coalesce(sum(remaining_quantity),0)::integer AS tracked FROM collection_cost_lots WHERE user_id=${userId} AND printing_id=${printingId} AND condition=${condition}`;
    ensure(add?((current?.quantity??0)+quantity<=9999):((current?.quantity??0)-tracked>=quantity),409,add?'This purchase exceeds the quantity limit.':'These copies are not available for cost tracking. Reload ownership or add the purchased copies.');
    if(add) await sql`INSERT INTO collection_entries(user_id,printing_id,condition,quantity) VALUES(${userId},${printingId},${condition},${quantity})
      ON CONFLICT(user_id,printing_id,condition) DO UPDATE SET quantity=collection_entries.quantity+excluded.quantity,revision=collection_entries.revision+1,updated_at=now()`;
    const [lot]=await sql`INSERT INTO collection_cost_lots ${sql({user_id:userId,printing_id:printingId,condition,quantity,remaining_quantity:quantity,acquired_on:date,...money})} RETURNING *`;
    await audit(sql,userId,'collection.purchase_recorded',{lot_id:lot.id,quantity,added_copies:add});
    return {lot};
  });
}
export async function changeCostLot(userId,idInput,input) {
  const id=v.uuid(idInput,'Purchase lot');
  return request(userId,{...v.object(input),lot_id:id},async(sql,o)=>{
    const action=v.oneOf(o.action,'Action',['sale','release']);
    const [lot]=await sql`SELECT * FROM collection_cost_lots WHERE id=${id} AND user_id=${userId} FOR UPDATE`;
    ensure(lot,404,'Purchase lot not found.');await access(sql,userId,lot.printing_id);
    ensure(lot.revision===v.integer(o.revision,'Revision',1,2147483647),409,'Purchase lot changed. Reload before saving.');
    ensure(lot.remaining_quantity>0,409,'This purchase lot has no tracked copies remaining.');
    if(action==='release') {
      const [updated]=await sql`UPDATE collection_cost_lots SET remaining_quantity=0,revision=revision+1 WHERE id=${id} RETURNING *`;
      await audit(sql,userId,'collection.cost_tracking_released',{lot_id:id,quantity:lot.remaining_quantity});
      return {lot:updated};
    }
    const quantity=v.integer(o.quantity,'Sold copies',1,lot.remaining_quantity),date=costDate(o.sold_on,'Sale date'),money=costMoney(o,true);
    const acquired=new Date(lot.acquired_on).toISOString().slice(0,10);
    ensure(date>=acquired,400,'Sale date must be on or after the purchase date.');
    const current=await entry(sql,userId,lot.printing_id,lot.condition,v.integer(o.entry_revision,'Ownership revision',1,2147483647));
    ensure(current?.quantity>=quantity,409,'Not enough owned copies remain.');
    const cost=remainingCost(lot)-remainingCost(lot,lot.remaining_quantity-quantity);
    const [sale]=await sql`INSERT INTO collection_cost_sales ${sql({lot_id:id,user_id:userId,sold_on:date,quantity,...money,cost_aud_minor:cost})} RETURNING *`;
    const [updated]=await sql`UPDATE collection_cost_lots SET remaining_quantity=remaining_quantity-${quantity},revision=revision+1 WHERE id=${id} RETURNING *`;
    await sql`UPDATE collection_entries SET quantity=quantity-${quantity},revision=revision+1,updated_at=now() WHERE user_id=${userId} AND printing_id=${lot.printing_id} AND condition=${lot.condition}`;
    await audit(sql,userId,'collection.sale_recorded',{lot_id:id,sale_id:sale.id,quantity});
    return {lot:updated,sale};
  });
}
export async function purchaseLedger(userId,printingInput,pageInput=1) {
  const page=v.integer(pageInput,'Page',1,100000);
  const printingId=v.uuid(printingInput);
  await requireCapability(userId,'prices');
  return db().begin('isolation level repeatable read, read only',async sql=>{
    const lots=await sql`SELECT * FROM collection_cost_lots WHERE user_id=${userId} AND printing_id=${printingId} ORDER BY acquired_on DESC,created_at DESC,id DESC LIMIT 50 OFFSET ${(page-1)*50}`;
    const sales=await sql`SELECT s.* FROM collection_cost_sales s JOIN collection_cost_lots l ON l.id=s.lot_id WHERE s.user_id=${userId} AND l.printing_id=${printingId} ORDER BY s.sold_on DESC,s.created_at DESC LIMIT 100`;
    const entries=await sql`SELECT condition,quantity,revision FROM collection_entries WHERE user_id=${userId} AND printing_id=${printingId}`;
    const [{total}]=await sql`SELECT count(*)::integer AS total FROM collection_cost_lots WHERE user_id=${userId} AND printing_id=${printingId}`;
    return {lots,sales,entries,page,total};
  });
}
export async function costSummary(userId) {
  await requireCapability(userId,'prices');
  return db().begin('isolation level repeatable read, read only',async sql=>{
    const rows=await sql`SELECT l.*,p.key,p.source,pc.quotes,pc.reference_prices,pc.fetched_at,pc.last_error FROM collection_cost_lots l JOIN printings p ON p.id=l.printing_id LEFT JOIN card_price_cache pc ON pc.card_id=p.card_id WHERE l.user_id=${userId} AND l.remaining_quantity>0`;
    const rates=await sql`SELECT * FROM price_fx_rates`;
    let cost=0,matchedCost=0,value=0,covered=0,tracked=0,approximate=0;
    for(const row of rows) {
      const basis=remainingCost(row),valuation=valueRows([{...row,quantity:row.remaining_quantity}],rates);
      cost+=basis;tracked+=row.remaining_quantity;
      if(valuation.aud_total!==null){matchedCost+=basis;value+=Math.round(valuation.aud_total*100);covered+=row.remaining_quantity;approximate+=valuation.approximate_quantity;}
    }
    const [{owned}]=await sql`SELECT coalesce(sum(quantity),0)::integer AS owned FROM collection_entries WHERE user_id=${userId}`;
    const [{profit,sold}]=await sql`SELECT coalesce(sum(net_aud_minor-cost_aud_minor),0) AS profit,coalesce(sum(quantity),0)::integer AS sold FROM collection_cost_sales WHERE user_id=${userId}`;
    return {currency:'AUD',cost_aud_minor:cost,tracked_quantity:tracked,unknown_cost_quantity:owned-tracked,valued_quantity:covered,unpriced_quantity:tracked-covered,approximate_quantity:approximate,valued_cost_aud_minor:matchedCost,market_aud_minor:covered?value:null,unrealized_aud_minor:covered?value-matchedCost:null,realized_aud_minor:Number(profit),sold_quantity:sold};
  });
}
