#!/usr/bin/env node
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {auditArenaMoves} from '../lib/arena/move-coverage.mjs';

export function main(args) {
  const [input, output, ...extra] = args;
  if (!input || extra.length) throw Error('Usage: node scripts/audit-arena-moves.mjs rows.json [report.json]');
  const value = JSON.parse(fs.readFileSync(input, 'utf8'));
  const report = auditArenaMoves(Array.isArray(value) ? value : value.rows);
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  const {families, priorities, metadata_priorities, mechanic_priorities, same_name_different_effects, ...summary} = report;
  console.log(JSON.stringify({...summary, same_name_collision_count: same_name_different_effects.length,
    mechanic_priorities: mechanic_priorities.slice(0, 10), priorities: priorities.slice(0, 15)}, null, 2));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
