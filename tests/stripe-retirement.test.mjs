import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
// This is a narrow guard for migration 010, not a general SQL parser.
// ON DELETE SET NULL is a foreign-key action, not a DELETE statement.
function assertAdditiveControlsMigration(text) {
 const sql=text.replace(/--[^\n]*/g,'').trim();
 const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);
 assert.equal(statements.length,1,'Activation migration must contain only its CREATE TABLE statement.');
 assert.match(statements[0],/^CREATE\s+TABLE\s+stripe_billing_controls\s*\(/i);
 assert.match(sql,/updated_by\s+uuid\s+REFERENCES\s+app_users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i);
 const withoutForeignKeyAction=sql.replace(/\bREFERENCES\s+app_users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL\b/gi,'REFERENCES app_users(id)');
 assert.doesNotMatch(withoutForeignKeyAction,/\b(?:DELETE|DROP|TRUNCATE|UPDATE|INSERT)\b/i,
  'Activation migration must not mutate existing records or drop schema objects.');
}
async function walk(url){const result=[];for(const item of await readdir(url,{withFileTypes:true})){const child=new URL(item.name+(item.isDirectory()?'/':''),url);if(item.isDirectory())result.push(...await walk(child));else result.push(child)}return result;}
test('runtime contains no Square connector imports, outbound requests or payment handlers',async()=>{
 for(const folder of ['lib/','server/','app/'])for(const file of await walk(new URL(folder,root))){
  if(!/\.(?:mjs|ts|vue)$/.test(file.pathname))continue;
  const text=await readFile(file,'utf8');
  assert.ok(!/from\s*['"][^'"]*square-|import\(['"][^'"]*square-/.test(text),file.pathname);
  assert.ok(!/connect\.square(?:up|upsandbox)\.com|oauth2\/authorize/.test(text),file.pathname);
  if(folder==='app/')assert.ok(!/\/admin\/integrations\/square|\/api\/billing\/square|\bSquare\b/.test(text),file.pathname);
 }
 for(const path of ['lib/square-subscriptions.mjs','lib/square-connector.mjs','lib/billing-worker.mjs','server/plugins/billing.ts','app/pages/admin/integrations/square.vue'])await assert.rejects(()=>access(new URL(path,root)));
});
test('subscription activation migration is additive and never creates charges or modifies grants',async()=>{
 const text=await readFile(new URL('migrations/010_stripe_only_controls.sql',root),'utf8');
 assertAdditiveControlsMigration(text);
 const all=await readdir(new URL('migrations/',root));for(let n=1;n<=9;n++)assert.ok(all.some(name=>name.startsWith(String(n).padStart(3,'0')+'_')));
 const middleware=await readFile(new URL('server/middleware/security.ts',root),'utf8');assert.ok(!middleware.includes('/billing/square'));
});
test('retired-provider history is kept but cannot be approved as a new commission',async()=>{
 const code=await readFile(new URL('lib/subscription-referrals.mjs',root),'utf8');
 assert.ok(code.includes("c.provider==='stripe'"));assert.ok(code.includes('Historical commissions from the retired provider are read-only'));
 assert.ok(code.includes('square_subscriptions')); // Read-only duplicate/referral-history protection.
 const membership=await readFile(new URL('lib/membership.mjs',root),'utf8');assert.ok(membership.includes('square_subscriptions'));
 assert.ok(!/UPDATE\s+square_|DELETE\s+FROM\s+square_/i.test(membership));
});

for(const statement of [
 'DELETE FROM account_access_grants;',
 'UPDATE account_access_grants SET expires_at=now();',
 'INSERT INTO stripe_billing_controls(id) VALUES (1);',
 'DROP TABLE app_users;',
 'TRUNCATE TABLE stripe_subscriptions;',
 'WITH removed AS (DELETE FROM app_users RETURNING id) SELECT * FROM removed;'
])test('activation migration guard rejects appended mutation: '+statement.split(' ')[0],async()=>{
 const text=await readFile(new URL('migrations/010_stripe_only_controls.sql',root),'utf8');
 assert.throws(()=>assertAdditiveControlsMigration(text+'\n'+statement),assert.AssertionError);
});
