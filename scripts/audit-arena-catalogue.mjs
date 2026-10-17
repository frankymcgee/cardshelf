#!/usr/bin/env node
/** Audit local catalogue rows, never fetch or infer unsupported card rules.
 * Usage: node scripts/audit-arena-catalogue.mjs rows.json [report.json]
 * Input: JSON array (or {rows:[...]}) of English catalogue rows with raw_data. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {compileArenaCard} from '../lib/arena/cards.mjs';
import {ARENA_VERSION,LEGACY_EFFECTS_ARENA_VERSION} from '../shared/arena.mjs';
export function auditArenaCatalogue(rows) {
  if(!Array.isArray(rows)||!rows.length)throw Error('Provide a non-empty array of catalogue rows.');
  const ids=new Set(),reasons=new Map(),added=[],regressions=[];
  const counts={records:0,baseline_supported:0,supported:0,regulation_H_I_J_records:0,regulation_H_I_J_supported:0};
  for(const row of rows){
    if(!row||typeof row.id!=='string'||ids.has(row.id)||row.game!=='pokemon'||row.language!=='en'||!row.raw_data||typeof row.raw_data!=='object'||Array.isArray(row.raw_data))throw Error('Every input row must be a unique local English Pokémon card record with raw_data.');
    ids.add(row.id);counts.records++;
    const before=compileArenaCard(row,LEGACY_EFFECTS_ARENA_VERSION),now=compileArenaCard(row,ARENA_VERSION);
    if(before.supported)counts.baseline_supported++;
    if(now.supported)counts.supported++;else reasons.set(now.reason,(reasons.get(now.reason)||0)+1);
    if(!before.supported&&now.supported)added.push(row.id);
    if(before.supported&&!now.supported)regressions.push({id:row.id,name:row.name,reason:now.reason});
    if(['H','I','J'].includes(row.raw_data.regulationMark)){counts.regulation_H_I_J_records++;if(now.supported)counts.regulation_H_I_J_supported++;}
  }
  return {engine:ARENA_VERSION,baseline:LEGACY_EFFECTS_ARENA_VERSION,notice:'Compiler coverage, not format legality or full historical rules parity.',...counts,added:added.length,added_ids:added,regressions,rejection_reasons:[...reasons].sort((a,b)=>b[1]-a[1]).map(([reason,count])=>({reason,count}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const [input,output,...extra]=process.argv.slice(2);if(!input||extra.length)throw Error('Usage: node scripts/audit-arena-catalogue.mjs rows.json [report.json]');const value=JSON.parse(fs.readFileSync(input,'utf8')),report=auditArenaCatalogue(Array.isArray(value)?value:value.rows),json=JSON.stringify(report,null,2)+'\n';if(output)fs.writeFileSync(output,json);const {added_ids,rejection_reasons,...summary}=report;console.log(JSON.stringify({...summary,rejection_reasons:rejection_reasons.slice(0,10)},null,2));if(report.regressions.length)process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=1;}
}
