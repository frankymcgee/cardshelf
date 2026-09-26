import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const text=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('recovery migration is additive and does not change existing account or subscription rows',async()=>{
  const sql=await text('migrations/014_password_recovery_adsense.sql');
  assert.match(sql,/CREATE TABLE password_recovery_tokens/);assert.match(sql,/token_hash text PRIMARY KEY/);
  assert.match(sql,/password_fingerprint text NOT NULL/);assert.match(sql,/expires_at timestamptz NOT NULL/);
  for(const table of ['app_users','account_memberships','account_access_grants','stripe_subscriptions','collection_entries','binders','free_platform_settings'])assert.ok(!new RegExp('(?:UPDATE|DELETE FROM|INSERT INTO|DROP TABLE)\\s+'+table,'i').test(sql));
  const queue=sql.split('CREATE TABLE password_recovery_mail')[1].split('CREATE INDEX')[0];assert.ok(!/token_hash|password_hash|message_body|smtp_password/.test(queue));
});
test('public initiation does not look up accounts or synchronously deliver email',async()=>{
  const source=(await text('lib/password-recovery.mjs')).split('export async function requestPasswordRecovery')[1].split('async function administratorSnapshot')[0];
  assert.ok(!source.includes('FROM app_users'));assert.ok(!source.includes('sendRecoveryEmail('));assert.ok(!source.includes('issueToken('));
  assert.match(source,/password-recovery-email:/);assert.match(source,/password-recovery-ip:/);assert.match(source,/password-recovery-global/);
});
test('redemption checks the current credential snapshot under the user lock and signs out every session',async()=>{
  const source=(await text('lib/password-recovery.mjs')).split('export async function completePasswordRecovery')[1].split('export async function passwordRecoveryAdminStatus')[0];
  assert.match(source,/SELECT id,email,password_hash FROM app_users[\s\S]*FOR UPDATE/);assert.match(source,/tokenIsCurrent\(token, user\)/);
  assert.match(source,/DELETE FROM sessions WHERE user_id/);assert.match(source,/DELETE FROM password_recovery_tokens WHERE user_id/);assert.match(source,/INSERT INTO password_recovery_mail[\s\S]*'changed'/);
  assert.ok(!source.includes('newSession('));assert.ok(!source.includes('stripe_subscriptions'));assert.ok(!source.includes('account_access_grants'));
});
test('normal password changes also invalidate pre-existing reset links and pending reset mail',async()=>{
  const source=(await text('lib/auth.mjs')).split('export async function changePassword')[1].split('export async function createUser')[0];
  assert.match(source,/DELETE FROM password_recovery_tokens WHERE user_id/);assert.match(source,/DELETE FROM password_recovery_mail/);assert.match(source,/kind='reset'/);
});
test('recovery secrets are fragment-only and not persisted in browser storage or SSR state',async()=>{
  const source=await text('app/pages/reset-password.vue');assert.match(source,/window.location.hash/);assert.match(source,/history.replaceState/);
  assert.ok(!/localStorage|sessionStorage|useState|route\.query|console\./.test(source));assert.match(source,/onBeforeUnmount/);
  assert.ok(!source.includes('AdSense'));assert.match(source,/clearNuxtData\(\)/);
});
test('mail drain is isolated from catalogue jobs and uses an expiring replay-safe database lease',async()=>{
  const source=await text('lib/password-recovery.mjs');assert.match(source,/FOR UPDATE SKIP LOCKED/);assert.match(source,/lease_until=now\(\)\+interval '2 minutes'/);
  assert.match(source,/attempts<3/);assert.match(source,/SMTP_DELIVERY_FAILED/);assert.ok(!/console\.(log|error)\(/.test(source));
  const plugin=await text('server/plugins/password-recovery.ts');assert.match(plugin,/if \(running\) return/);assert.match(plugin,/clearInterval\(timer\)/);
});
test('mail transport dependency is pinned and server configuration never enables recovery email by default',async()=>{
  const pkg=JSON.parse(await text('package.json'));assert.match(pkg.dependencies.nodemailer,/^\d+\.\d+\.\d+$/);
  const env=await text('.env.example');assert.match(env,/^RECOVERY_EMAIL_ENABLED=false$/m);assert.match(env,/^SMTP_PASSWORD=$/m);
  const compose=await text('compose.yaml');assert.match(compose,/RECOVERY_EMAIL_ENABLED: \$\{RECOVERY_EMAIL_ENABLED:-false\}/);
  const code=await text('lib/password-recovery-mail.mjs');assert.match(code,/disableFileAccess: true/);assert.match(code,/disableUrlAccess: true/);assert.match(code,/transport.close\(\)/);
});
test('Google loader stays conditional and sensitive pages never mount an ad controller',async()=>{
  for(const path of ['nuxt.config.ts','app/layouts/default.vue','app/layouts/marketing.vue','app/pages/login.vue','app/pages/reset-password.vue']){
    const source=await text(path);assert.ok(!source.includes('adsbygoogle.js'),path);
    if(path!=='app/layouts/marketing.vue')assert.ok(!source.includes('<AdSenseSlot'),path);
  }
  assert.match(await text('app/layouts/marketing.vue'), /v-if="\['\/', '\/features', '\/pricing'\]\.includes\(route\.path\)"/);
  for(const path of ['app/pages/explore/index.vue','app/pages/explore/[id].vue','app/pages/cards.vue','app/pages/app.vue'])assert.match(await text(path),/<AdSenseSlot\b[^>]*:content-ready=/);
  assert.match(await text('app/pages/marketplace/index.vue'),/:content-ready="!!data\?\.items\.length && !failure && !mine"/);
});
test('Google payload is issued only after effective membership and pending billing are checked',async()=>{
  const source=await text('lib/adsense.mjs');assert.match(source,/membershipState\(user.id\)/);assert.match(source,/pendingBilling: billing.length > 0/);assert.match(source,/sponsorEligible\(/);
  assert.match(source,/const kind = adsensePageKind\(path\)/);assert.match(source,/!kind/);assert.match(source,/user.role === 'admin' && view === 'hidden'/);
});
test('nonce CSP scope and cache policy prevent advertising context leaking between users',async()=>{
  const code=await text('server/middleware/security.ts');assert.match(code,/adsensePageKind\(event.path\) && event.method === 'GET'/);assert.match(code,/randomBytes\(16\)/);
  assert.match(code,/setHeader\(event, 'Cache-Control', 'private, no-store'\)/);assert.match(code,/setHeader\(event, 'Vary', 'Cookie'\)/);
  assert.ok(code.indexOf('if (placement.eligible)')<code.indexOf('adsenseCsp(nonce)'));
  assert.match(code,/isAllowedMutation/);assert.match(code,/default-src 'self'/);
});
test('ad entitlement is rechecked but Google units are never refreshed by a timer',async()=>{
  const component=await text('app/components/AdSenseSlot.vue');assert.match(component,/setInterval\(visibleCheck, 60000\)/);assert.match(component,/pageshow/);assert.match(component,/observer\?\.disconnect/);
  assert.match(component,/if \(requested\) freshDocument\(\)/);assert.match(component,/String\(value.revision\) !== revision/);
  const loader=await text('shared/adsense-browser.mjs');assert.ok(!/setInterval|setTimeout/.test(loader));assert.ok(!/requestNonPersonalizedAds|gtag\(|__tcfapi\([^)]*set/.test(loader));
});
test('post-AdSense navigation uses a new document, not just removal of a script node',async()=>{
  const code=await text('app/middleware/00-adsense-boundary.global.ts');assert.match(code,/adDocumentNeedsReload/);assert.match(code,/navigateTo\(to.fullPath, \{ external: true \}\)/);
});

test('document nonces are read through the hidden script property, not CSS-readable metadata',async()=>{
  const plugin=await text('server/plugins/adsense-document.ts');assert.ok(!plugin.includes('cardshelf-adsense-nonce'));
  const component=await text('app/components/AdSenseSlot.vue');assert.match(component,/querySelector<HTMLScriptElement>\('script\[nonce\]'\)\?\.nonce/);
  assert.ok(!component.includes("getAttribute('nonce')"));
});
