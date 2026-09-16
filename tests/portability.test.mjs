import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,exportCSV,parseImport,CSV_COLUMNS} from '../lib/portability.mjs';
const entry={language:'en',card_id:'base1-4',printing:'holo',condition:'NM',quantity:2,wishlist:false,notes:'Bought, then stored in "Binder A".\nTop shelf.'};
const json=(entries)=>JSON.stringify({format:'cardshelf-collection',version:1,entries});
test('CSV round-trip handles quotes, commas and embedded newlines',()=>{
  const parsed=parseImport('csv',exportCSV([entry]));assert.equal(parsed.errors.length,0);assert.equal(parsed.rows.length,1);
  const {row,...actual}=parsed.rows[0];assert.deepEqual(actual,entry);
});
test('accepts CRLF and a UTF-8 BOM',()=>assert.deepEqual(parseCSV('\uFEFFa,b\r\n1,2\r\n'),[['a','b'],['1','2']]));
test('CSV parser rejects unterminated or misplaced quotes',()=>{
  for(const text of ['a,"unterminated','a,b"x','"a"x,b']) assert.throws(()=>parseCSV(text));
});
test('CSV exports neutralise spreadsheet formulas',()=>{
  const rows=parseCSV(exportCSV([{...entry,notes:'=HYPERLINK("evil")'}]));
  assert.equal(rows[1][6],"'=HYPERLINK(\"evil\")");
});
test('CardShelf JSON uses an explicit versioned schema',()=>{
  const result=parseImport('json',json([entry]));assert.equal(result.rows[0].quantity,2);
  assert.throws(()=>parseImport('json',JSON.stringify({entries:[entry]})),/CardShelf/);
  assert.throws(()=>parseImport('json',JSON.stringify({format:'cardshelf-collection',version:9,entries:[]})),/CardShelf/);
});
test('malformed JSON reports a readable error',()=>assert.throws(()=>parseImport('json','{broken'),/valid JSON/));
test('duplicate printing-condition rows are reported, not added twice',()=>{
  const result=parseImport('json',json([entry,entry]));assert.equal(result.rows.length,1);assert.equal(result.errors.length,1);assert.match(result.errors[0].message,/Duplicate/);
});
test('invalid quantities do not become zero',()=>{
  const result=parseImport('json',json([{...entry,quantity:'2'}, {...entry,quantity:-1}]));assert.equal(result.rows.length,0);assert.equal(result.errors.length,2);
});
test('CSV requires all documented columns',()=>assert.throws(()=>parseImport('csv','name,number\nCard,1'),/requires these columns/));
test('CSV quantities cannot be empty, exponents or signed values',()=>{
  for(const q of ['','1e2','+2','-1','2.5']) {
    const csv=CSV_COLUMNS.join(',')+'\n'+`en,base1-4,holo,NM,${q},false,`;
    assert.equal(parseImport('csv',csv).errors.length,1);
  }
});
test('columns with missing cells are reported as row errors',()=>{
  const result=parseImport('csv',CSV_COLUMNS.join(',')+'\nen,base1-4');assert.equal(result.errors.length,1);assert.equal(result.rows.length,0);
});
test('oversized imports are rejected before parsing',()=>assert.throws(()=>parseImport('json',' '.repeat(2_000_001)),/2 MB/));
test('more than 5000 ownership rows are rejected',()=>assert.throws(()=>parseImport('json',json(Array(5001).fill(entry))),/5,000/));
test('JSON exports preserve formula-like notes without CSV escaping',()=>assert.equal(parseImport('json',json([{...entry,notes:'=hello'}])).rows[0].notes,'=hello'));
