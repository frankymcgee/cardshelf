import { adsensePageKind, adsensePagePlan } from '../shared/adsense-policy.mjs';
import { db, audit } from './db.mjs';
import { ensure } from './errors.mjs';
import { rateLimit } from './auth.mjs';
import { verifyPassword } from './security.mjs';
import { membershipState } from './membership.mjs';
import { sponsorEligible } from './free-settings-logic.mjs';
import { adsenseInput, ADSENSE_DEFAULTS, adsenseReady } from './adsense-logic.mjs';
export async function adsenseSettings(sql = db()) {
  const [row] = await sql`SELECT provider,adsterra_units,placeholders_enabled,enabled,verification_enabled,publisher_id,slot_id,auto_ads_enabled,marketplace_enabled,marketplace_slot_id,revision,updated_at FROM adsense_settings WHERE singleton`;
  return row || { ...ADSENSE_DEFAULTS };
}
export async function saveAdsenseSettings(actorId, input) {
  const data = adsenseInput(input);
  await rateLimit('adsense-admin:' + actorId, 10);
  const [actor] = await db()`SELECT role,password_hash FROM app_users WHERE id=${actorId}`;
  ensure(actor?.role === 'admin' && await verifyPassword(data.password, actor.password_hash), 403, 'Administrator password is incorrect or access is unavailable.');
  return db().begin(async sql => {
    await sql`SELECT pg_advisory_xact_lock(72491402)`;
    const [currentActor] = await sql`SELECT role,password_hash FROM app_users WHERE id=${actorId} FOR UPDATE`;
    ensure(currentActor?.role === 'admin' && currentActor.password_hash === actor.password_hash, 403, 'Administrator credentials changed. Sign in again.');
    const old = await adsenseSettings(sql);
    ensure(old.revision === data.revision, 409, 'Advertising settings changed. Reload before saving.');
    const { password, revision, reason, ...values } = data;
    await sql`INSERT INTO adsense_settings ${sql({ ...values, singleton: true, updated_by: actorId })}
      ON CONFLICT(singleton) DO UPDATE SET ${sql(values)},revision=adsense_settings.revision+1,updated_at=now(),updated_by=${actorId}`;
    await audit(sql, actorId, 'platform.adsense_settings', { provider: data.provider, adsterra_formats: Object.keys(data.adsterra_units), placeholders_enabled: data.placeholders_enabled, enabled: data.enabled, verification_enabled: data.verification_enabled, auto_ads_enabled: data.auto_ads_enabled, marketplace_enabled: data.marketplace_enabled, reason });
    return adsenseSettings(sql);
  });
}
// This preference is scoped to the signed-in administrator and this browser.
export function adminAdView(user, cookie) {
  if (user?.role !== 'admin') return 'hidden';
  const prefix = user.id + ':';
  const value = typeof cookie === 'string' && cookie.startsWith(prefix) ? cookie.slice(prefix.length) : '';
  return ['preview', 'live'].includes(value) ? value : 'hidden';
}
export async function adsensePlacement(user, path, preference) {
  const kind = adsensePageKind(path);
  if (!kind || !user || !['user', 'admin'].includes(user.role)) return { eligible: false };
  const settings = await adsenseSettings();
  const view = adminAdView(user, preference);
  if (user.role === 'admin' && view === 'hidden') return { eligible: false };
  const plan = adsensePagePlan(settings, path);
  if (view !== 'preview' && !settings.placeholders_enabled && (!adsenseReady(settings) || !plan)) return { eligible: false };
  if (user.role !== 'admin') {
    const [state, billing] = await Promise.all([membershipState(user.id),
      db()`SELECT 1 FROM stripe_subscriptions WHERE user_id=${user.id} AND (current OR paid_through>now()) LIMIT 1`]);
    if (!sponsorEligible({ user, access: state.access, grant: state.grant, pendingBilling: billing.length > 0, enabled: true })) return { eligible: false };
  }
  // Placeholder mode takes precedence over live advertising and needs no Google IDs.
  if (view === 'preview' || (user.role !== 'admin' && settings.placeholders_enabled))
    return { eligible: false, placeholder: true, page_kind: kind, revision: settings.revision,
      ...(settings.provider === 'adsterra' ? { provider: 'adsterra', adsterra_units: settings.adsterra_units } : {}) };
  if (!adsenseReady(settings) || !plan) return { eligible: false };
  return { eligible: true, publisher_id: settings.publisher_id, ...plan, revision: settings.revision };
}
