import { ensure, AppError } from './errors.mjs';
import * as v from './validate.mjs';
import { GAME_CODES } from '../shared/games.mjs';
export const CSV_COLUMNS = ['language','card_id','printing','condition','quantity','wishlist','notes'];
// RFC-4180-style parser: quoted commas, escaped quotes and quoted newlines.
export function parseCSV(input) {
  ensure(typeof input==='string' && Buffer.byteLength(input,'utf8')<=2_000_000,400,'Import files must be smaller than 2 MB.');
  const rows=[], text=input.replace(/^\uFEFF/, ''); let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(quoted) {
      if(ch==='"') { if(text[i+1]==='"') {cell+='"'; i++;} else {quoted=false;closed=true;} }
      else cell+=ch;
    } else if(ch==='"') {
      ensure(cell==='' && !closed,400,'Invalid quote in CSV.'); quoted=true;
    } else if(ch===',') { row.push(cell);cell='';closed=false; }
    else if(ch==='\n' || ch==='\r') {
      if(ch==='\r' && text[i+1]==='\n') i++;
      row.push(cell); if(row.some(c=>c!=='')) rows.push(row);row=[];cell='';closed=false;
      ensure(rows.length<=5001,400,'Import at most 5,000 rows at a time.');
    } else { ensure(!closed,400,'Unexpected character after closing CSV quote.');cell+=ch; }
  }
  ensure(!quoted,400,'The CSV contains an unclosed quote.');
  if(cell!=='' || row.length || closed) {row.push(cell);rows.push(row);}
  return rows;
}
function csvCell(value) {
  let s=String(value ?? '');
  // Neutralise spreadsheet formulas. JSON is the lossless text export.
  if(/^[=+@\-\t\r]/.test(s)) s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
export function exportCSV(rows) {
  const columns=rows.some(row=>row.game&&row.game!=='pokemon')?['game',...CSV_COLUMNS]:CSV_COLUMNS;
  return columns.join(',')+'\r\n'+rows.map(row=>columns.map(key=>csvCell(key==='game'?(row.game||'pokemon'):row[key])).join(',')).join('\r\n')+'\r\n';
}
export function parseImport(format,input) {
  ensure(typeof input==='string' && Buffer.byteLength(input,'utf8')<=2_000_000,400,'Import files must be smaller than 2 MB.');
  let source;
  if(format==='json') {
    let data; try {data=JSON.parse(input);} catch {throw new AppError(400,'This is not valid JSON.');}
    ensure(data?.format==='cardshelf-collection' && data.version===1 && Array.isArray(data.entries),400,
      'Use a CardShelf collection export (format cardshelf-collection, version 1).');
    source=data.entries;
  } else if(format==='csv') {
    const rows=parseCSV(input),header=rows.shift()?.map(h=>h.trim());
    ensure(header && new Set(header).size===header.length && CSV_COLUMNS.every(c=>header.includes(c)),400,
      'CSV requires these columns: '+CSV_COLUMNS.join(', '));
    source=rows.map(row=> {
      if(row.length!==header.length) return {__invalid:'CSV column count does not match the header.'};
      return Object.fromEntries(header.map((h,i)=>[h,row[i]]));
    });
  } else throw new AppError(400,'Choose JSON or CSV.');
  ensure(source.length<=5000,400,'Import at most 5,000 rows at a time.');
  const rows=[],errors=[],seen=new Set();
  source.forEach((raw,index)=> {
    try {
      const o=v.object(raw); ensure(!o.__invalid,400,o.__invalid);
      // CSV accepts exact decimal integers, not empty strings, exponents or signs.
      let quantity=o.quantity;
      if(format==='csv') { ensure(/^\d{1,4}$/.test(quantity),400,'Quantity must be a whole number from 0 to 9999.');quantity=Number(quantity); }
      const wishlist=format==='csv' ? v.oneOf(String(o.wishlist).toLowerCase(),'Wishlist',['true','false','1','0']) : v.bool(o.wishlist,'Wishlist');
      const game=v.oneOf(o.game||'pokemon','Game',GAME_CODES);
      const entry={ row:index+2,...(o.game?{game}:{}),language:v.language(o.language),card_id:v.providerId(o.card_id),
        printing:v.text(o.printing,'Printing key',1,120),condition:v.oneOf(o.condition,'Condition',v.CONDITIONS),
        quantity:v.integer(quantity,'Quantity'),wishlist:format==='csv' ? ['true','1'].includes(wishlist) : wishlist,
        notes:v.text(o.notes??'','Notes') };
      ensure(game==='pokemon'||entry.language==='en',400,'Only English is supported for this additional game.');
      const key=JSON.stringify([game,entry.language,entry.card_id,entry.printing,entry.condition]);
      ensure(!seen.has(key),400,'Duplicate card/printing/condition row. Combine it before importing.');
      seen.add(key);rows.push(entry);
    } catch(error) {errors.push({row:index+2,message:error.message});}
  });
  return {rows,errors};
}
