import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseChecks, recentTimestamp } from '../shared/release-readiness.mjs';

const now = Date.parse('2026-10-08T17:00:00Z');
function configured() {
  return { https: true, appliedMigrations: 30, missingMigrations: 0, workerSeenAt: new Date(now), registration: true,
    stripe: { live: true, enabled: true, accepting: true, configured: true, portal: true, plans: ['collector', 'plus'], webhookSeenAt: new Date(now), workerSeenAt: new Date(now) },
    email: { enabled: true, configured: true, workerEnabled: true, signedEvents: true, dkim: true, deliveredAt: new Date(now) },
    scanning: { enabled: true, configured: true, remaining: 500, reservation: 100 }, cards: 20, arena: true, pushIdentity: true,
    advertising: { enabled: false, ready: false, placeholders: false } };
}
test('configured services still require deployment and parity acceptance', () => {
  const result = releaseChecks(configured(), now);
  assert.equal(result.status, 'configured');
  assert.ok(result.checks.every(check => check.status === 'pass'));
  assert.equal(result.acceptance.length, 6);
  assert.match(result.acceptance.find(check => check.id === 'arena').detail, /subset.*full official rules parity/);
  assert.equal(result.ready, undefined);
});
test('SMTP readiness checks the selected connection without requiring Postal or reusing its delivery evidence', () => {
  const snapshot=configured();snapshot.email={...snapshot.email,provider:'smtp',signedEvents:false,verifiedAt:new Date(now)};
  const result=releaseChecks(snapshot,now);
  assert.equal(result.checks.length,17);assert.equal(result.status,'review');
  assert.equal(result.checks.find(c=>c.id==='email').status,'pass');
  assert.equal(result.checks.find(c=>c.id==='smtp-connection').status,'pass');
  assert.equal(result.checks.find(c=>c.id==='postal-webhook'),undefined);
  assert.equal(result.checks.find(c=>c.id==='email-delivery').status,'review');
  for(const verifiedAt of [null,new Date(now-8*86400_000),new Date(now+60_000)]){
    assert.equal(releaseChecks({...snapshot,email:{...snapshot.email,verifiedAt}},now).checks.find(c=>c.id==='smtp-connection').status,'review');
  }
  snapshot.email.configured=false;assert.equal(releaseChecks(snapshot,now).status,'blocked');
});
test('closed registration prevents a self-service public release', () => {
  const result = releaseChecks({ ...configured(), registration: false }, now);
  assert.equal(result.status, 'blocked');
  assert.equal(result.checks.find(check => check.id === 'registration').status, 'blocked');
});
test('stored or disabled credentials do not imply a usable email service', () => {
  for (const field of ['enabled', 'configured', 'workerEnabled', 'signedEvents']) {
    const snapshot = configured(); snapshot.email[field] = false;
    assert.equal(releaseChecks(snapshot, now).status, 'blocked', field);
  }
  const snapshot = configured(); snapshot.email.deliveredAt = null;
  const result = releaseChecks(snapshot, now);
  assert.equal(result.status, 'review');
  assert.equal(result.checks.find(check => check.id === 'email-delivery').status, 'review');
});
test('both Live tiers and a portal are needed even with a recent webhook', () => {
  for (const field of ['live', 'enabled', 'accepting', 'configured', 'portal']) {
    const snapshot = configured(); snapshot.stripe[field] = false;
    assert.equal(releaseChecks(snapshot, now).checks.find(check => check.id === 'stripe').status, 'blocked', field);
  }
  const snapshot = configured(); snapshot.stripe.plans = ['collector'];
  assert.equal(releaseChecks(snapshot, now).status, 'blocked');
});
test('expired, absent and future timestamps cannot establish worker freshness', () => {
  for (const value of [null, undefined, '', 'invalid', new Date(now - 120_001), new Date(now + 30_001)]) {
    assert.equal(recentTimestamp(value, now, 120_000), false, String(value));
  }
  assert.equal(recentTimestamp(new Date(now - 120_000), now, 120_000), true);
  const snapshot = configured(); snapshot.workerSeenAt = new Date(now - 120_001);
  assert.equal(releaseChecks(snapshot, now).status, 'blocked');
});
test('exhausted or uncertain scan accounting requires review', () => {
  for (const remaining of [99, -1, NaN, undefined]) {
    const snapshot = configured(); snapshot.scanning.remaining = remaining;
    assert.equal(releaseChecks(snapshot, now).checks.find(check => check.id === 'scan-budget').status, 'review');
  }
  const snapshot = configured(); snapshot.scanning.configured = false;
  assert.equal(releaseChecks(snapshot, now).status, 'blocked');
});
test('missing migrations and a paused advertised Arena block release', () => {
  for (const [field, value] of [['missingMigrations', 1], ['arena', false], ['cards', 0]]) {
    assert.equal(releaseChecks({ ...configured(), [field]: value }, now).status, 'blocked');
  }
});
test('optional disabled advertising is permitted; invalid live units are blocked', () => {
  const snapshot = configured(); snapshot.advertising = { enabled: true, ready: false, placeholders: false };
  assert.equal(releaseChecks(snapshot, now).status, 'blocked');
  snapshot.advertising = { enabled: true, ready: true, placeholders: true };
  assert.equal(releaseChecks(snapshot, now).status, 'review');
});
