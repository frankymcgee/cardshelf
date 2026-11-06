import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
export function costDate(value,name='Date') {
  const date=v.text(value,name,10,10);
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date&&date<=new Date().toISOString().slice(0,10)&&date>='1900-01-01',400,`${name} must be a valid date up to today.`);
  return date;
}
export function costMoney(input,sale=false) {
  const o=v.object(input),currency=v.oneOf(o.currency??'AUD','Currency',['AUD','USD','EUR']);
  const rate=currency==='AUD'?1:Number(o.aud_rate);
  ensure(Number.isFinite(rate)&&rate>0&&rate<=1000&&Math.abs(rate*1e8-Math.round(rate*1e8))<.001,400,'Enter the purchase/sale date AUD exchange rate, up to eight decimal places.');
  const goods=v.integer(sale?o.gross_minor:o.goods_minor,sale?'Sale total':'Purchase total',0,100000000);
  const postage=v.integer(o.postage_minor??0,'Postage',0,100000000);
  const fees=sale?v.integer(o.fees_minor??0,'Fees',0,100000000):0;
  return {currency,aud_rate:rate,postage_minor:postage,...(sale?{gross_minor:goods,fees_minor:fees,net_aud_minor:Math.round((goods-fees-postage)*rate)}:{goods_minor:goods,cost_aud_minor:Math.round((goods+postage)*rate)})};
}
export function remainingCost(lot, remaining=lot.remaining_quantity) {
  const cost=Number(lot.cost_aud_minor);
  return cost-Math.round(cost*(lot.quantity-remaining)/lot.quantity);
}
