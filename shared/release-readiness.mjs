/** Configuration checks are evidence, not a production or feature-parity certificate. */
export function recentTimestamp(value, now, maximumAge) {
  const time = typeof value === 'string' || value instanceof Date ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) && time <= now + 30_000 && now - time <= maximumAge;
}

export const RELEASE_ACCEPTANCE = Object.freeze([
  { id: 'payments', label: 'Live subscription acceptance', detail: 'Verify a new member checkout, signed invoice, correct tier, portal cancellation and renewal behavior using the operator’s payment test process.' },
  { id: 'mail', label: 'Email and recovery acceptance', detail: 'Receive a real recovery/test email and verify sender signing. For Postal, check a correlated signed delivery event; for SMTP, inspect the inbox and provider bounce reports. Provider acceptance alone does not establish delivery.' },
  { id: 'devices', label: 'Physical phone acceptance', detail: 'Install on iPhone and Android and receive an opted-in test push. Browser emulation does not verify device delivery.' },
  { id: 'arena', label: 'Two-member Arena acceptance', detail: 'Complete a private match and tournament advancement, reconnect both seats and check administrator commentary. The current engine supports a subset of Pokémon card effects; full official rules parity remains outside the implemented card pool.' },
  { id: 'recovery', label: 'Production backup restoration', detail: 'Restore a current backup into an isolated installation and verify collection records, binder covers, memberships and retained push identity.' },
  { id: 'advertising', label: 'Live advertising acceptance', detail: 'Check real creative fill and consent behavior for a signed-out visitor and eligible Free member. Verify private and paid pages remain excluded.' }
]);

export function releaseChecks(snapshot, now = Date.now()) {
  const checks = [];
  const add = (id, label, status, detail, to) => checks.push({ id, label, status, detail, to });
  add('origin', 'Public HTTPS origin', snapshot.https ? 'pass' : 'blocked', snapshot.https ? 'HTTPS is configured. External TLS and DNS still require deployment acceptance.' : 'Configure the public HTTPS origin before accepting accounts.', '/admin');
  add('schema', 'Database migrations', snapshot.missingMigrations === 0 ? 'pass' : 'blocked', `${snapshot.appliedMigrations} release migrations applied; ${snapshot.missingMigrations} missing.`, '/settings#catalogue');
  add('worker', 'Background worker', recentTimestamp(snapshot.workerSeenAt, now, 120_000) ? 'pass' : 'blocked', 'Imports, prices, notifications and queued work need a worker heartbeat within two minutes.', '/settings#catalogue');
  add('registration', 'Public Free registration', snapshot.registration ? 'pass' : 'blocked', snapshot.registration ? 'New Free accounts can register; existing tester grants are preserved.' : 'Self-registration is closed. Public browsing works, but new members cannot independently create an account for checkout.', '/admin/free-platform');
  const stripe = snapshot.stripe;
  const paidReady = stripe?.live && stripe?.enabled && stripe?.accepting && stripe?.configured && stripe?.portal && stripe?.plans?.includes('collector') && stripe?.plans?.includes('plus');
  add('stripe', 'Live membership configuration', paidReady ? 'pass' : 'blocked', paidReady ? 'Live checkout, customer portal and both paid tiers are configured. This does not verify a new purchase.' : 'Live checkout needs valid credentials, a portal and published Collector and Collector Plus offers.', '/admin/integrations/stripe');
  add('stripe-webhook', 'Signed Live Stripe webhook', recentTimestamp(stripe?.webhookSeenAt, now, 7 * 86400_000) ? 'pass' : 'review', 'Confirm a signed Live webhook received within seven days. A missing recent event needs review, not an invented payment test.', '/admin/integrations/stripe');
  add('stripe-worker', 'Payment reconciliation', recentTimestamp(stripe?.workerSeenAt, now, 120_000) ? 'pass' : 'review', 'Check the reconciliation worker and its recent heartbeat.', '/admin/integrations/stripe');
  const email = snapshot.email;
  const smtp = email?.provider === 'smtp';
  add('email', 'Recovery email configuration', email?.enabled && email?.configured && email?.workerEnabled ? 'pass' : 'blocked', 'Recovery needs enabled, decryptable credentials for the selected provider and the email worker. Stored credentials alone are insufficient.', '/admin/emails');
  if(smtp) add('smtp-connection', 'SMTP connection verification', recentTimestamp(email?.verifiedAt, now, 7 * 86400_000) ? 'pass' : 'review', 'Check the saved SMTP connection to verify DNS, TLS and login without sending a message. Sender acceptance and delivery require a separate test.', '/admin/emails#email-setup');
  else add('postal-webhook', 'Postal event verification', email?.signedEvents ? 'pass' : 'blocked', 'A trusted Postal signing public key is required to verify delivery events.', '/admin/emails#email-connection');
  add('dkim', 'Sender signing diagnostics', email?.dkim ? 'pass' : 'review', 'Save the exact selected provider DKIM selector and public TXT value, then run DNS checks. Saved values do not establish DNS correctness or message signing.', '/admin/emails#email-diagnostics');
  add('email-delivery', 'Observed email delivery', !smtp && recentTimestamp(email?.deliveredAt, now, 30 * 86400_000) ? 'pass' : 'review', smtp ? 'SMTP acceptance is not inbox delivery. Receive a test and recovery email and inspect provider bounce reports. Historical Postal events do not verify the current SMTP connection.' : 'A recent correlated delivery event is useful evidence; inspect the receiving inbox separately.', '/admin/emails#email-delivery');
  const scanning = snapshot.scanning;
  add('scanning', 'Photo recognition configuration', scanning?.enabled && scanning?.configured ? 'pass' : 'blocked', 'The advertised scanner needs an enabled, decryptable OpenAI connection. Recognition is limited to imported English/Japanese Pokémon cards.', '/admin/scanning');
  add('scan-budget', 'Photo recognition budget', scanning?.remaining >= scanning?.reservation && scanning?.reservation > 0 ? 'pass' : 'review', 'The current shared monthly budget must cover at least one scan reservation; zero member limits mean unlimited scans, not an unlimited shared budget.', '/admin/scanning');
  add('catalogue', 'Imported catalogue', snapshot.cards > 0 ? 'pass' : 'blocked', `${snapshot.cards} cards imported. This is not an audit of every set, language or printing.`, '/settings#catalogue');
  add('arena', 'Arena availability', snapshot.arena ? 'pass' : 'blocked', 'Arena requires its enabled setting and an eligible member tier. Administrator or legacy tester access alone is not a player entitlement.', '/admin/arena');
  add('push', 'Persisted push identity', snapshot.pushIdentity ? 'pass' : 'review', 'The push identity is persisted after first use. Verify delivery on physical opted-in devices; do not create keys from this inspection.', '/notifications');
  add('advertising', 'Advertising configuration', snapshot.advertising?.enabled && !snapshot.advertising?.ready ? 'blocked' : snapshot.advertising?.placeholders ? 'review' : 'pass', snapshot.advertising?.enabled ? 'An enabled provider needs valid unit settings and a separate live fill/consent check.' : 'Advertising is disabled; it is optional for platform operation.', '/admin/adsense');
  return { checks, status: checks.some(c => c.status === 'blocked') ? 'blocked' : checks.some(c => c.status === 'review') ? 'review' : 'configured', acceptance: RELEASE_ACCEPTANCE };
}
