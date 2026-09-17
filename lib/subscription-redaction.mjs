// Remove premium provider prices from catalogue payloads, not from marketplace asking prices.
export function catalogueForAccess(value,features) {
  if(!Array.isArray(features)||features.includes('prices'))return value;
  if(Array.isArray(value))return value.map(item=>catalogueForAccess(item,features));
  if(value&&typeof value==='object'&&!(value instanceof Date))return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!['price_from','pricing','reference_prices','price_history'].includes(key))
    .map(([key,item])=>[key,catalogueForAccess(item,features)]));
  return value;
}
