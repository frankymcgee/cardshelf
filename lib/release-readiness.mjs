import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import release from '../package.json' with { type: 'json' };
import { db } from './db.mjs';
import { configuration } from './config.mjs';
import { subscriptionControls } from './subscription-controls.mjs';
import { emailSettings } from './email-settings.mjs';
import { scanningSettings, scanTotals } from './card-scan-settings.mjs';
import { adsenseSettings } from './adsense.mjs';
import { adsenseReady } from './adsense-logic.mjs';
import { releaseChecks } from '../shared/release-readiness.mjs';

/** Read only. Never contacts a provider, changes settings, creates keys or sends notifications. */
export async function productionReadiness(actorId) {
  // Also validates the actor when called outside the HTTP handler.
  const billing = await subscriptionControls(actorId);
  const sql = db();
  const [filenames, applied, heartbeat, free, email, scanning, usage, ads, arena, counts, push, delivery, plans] = await Promise.all([
    readdir(resolve(process.cwd(), 'migrations')),
    sql`SELECT version FROM schema_migrations`,
    sql`SELECT updated_at FROM app_state WHERE key='worker_heartbeat'`,
    sql`SELECT registration_enabled FROM free_platform_settings WHERE singleton`,
    emailSettings(sql), scanningSettings(sql), scanTotals(sql), adsenseSettings(sql),
    sql`SELECT enabled FROM arena_settings WHERE singleton`,
    sql`SELECT count(*)::integer AS cards FROM cards`,
    sql`SELECT EXISTS(SELECT 1 FROM push_identity) AS present`,
    sql`SELECT max(delivered_at) AS latest FROM (SELECT delivered_at FROM email_outbox UNION ALL SELECT delivered_at FROM password_recovery_mail) deliveries`,
    sql`SELECT DISTINCT plan_code FROM stripe_offers WHERE published AND environment='production'`
  ]);
  const expected = filenames.filter(name => /^\d+_.+\.sql$/.test(name));
  const known = new Set(applied.map(row => row.version));
  const live = billing.environments.find(row => row.environment === 'production');
  const snapshot = {
    https: configuration().secureCookies,
    appliedMigrations: expected.filter(name => known.has(name)).length,
    missingMigrations: expected.filter(name => !known.has(name)).length,
    workerSeenAt: heartbeat[0]?.updated_at,
    registration: free[0]?.registration_enabled === true,
    stripe: { live: billing.policy.environment === 'production', enabled: billing.policy.enabled, accepting: live?.accepting_new, configured: live?.configured, portal: live?.portal_configured, plans: plans.map(row => row.plan_code), webhookSeenAt: live?.webhook_seen_at, workerSeenAt: billing.worker_seen_at },
    email: { enabled: email.enabled, configured: email.configured, workerEnabled: email.worker_enabled, signedEvents: Boolean(email.webhook_public_key), dkim: Boolean(email.dkim_selector && email.dkim_public_key), deliveredAt: delivery[0]?.latest },
    scanning: { enabled: scanning.enabled, configured: scanning.configured, reservation: scanning.reservation_micros, remaining: scanning.monthly_budget_micros - usage.accounted_micros },
    cards: counts[0].cards, arena: arena[0]?.enabled === true, pushIdentity: push[0].present,
    advertising: { enabled: ads.enabled, ready: adsenseReady(ads), placeholders: ads.placeholders_enabled }
  };
  // Return only derived evidence. Never serialize settings, account rows, credentials or destinations.
  return { version: release.version, checked_at: new Date().toISOString(), ...releaseChecks(snapshot) };
}
