import { test, expect } from '@playwright/test';
const user = { id: 'synthetic-user', name: 'Security tester', email: 'security@example.test', role: 'admin', email_verified_at: null, email_verification_required: false };
const factor = { id: 'synthetic-factor', label: 'Phone authenticator', created_at: '2026-10-01T00:00:00Z', last_used_at: null };
const pending = scope => ({ scope, methods: ['totp', 'passkey'], expires_at: new Date(Date.now() + 600000).toISOString(), recovery_mode: false });
const codes = ['1122-3344-5566-7788-99AA-BBCC-DDEE-FF00', 'AABB-CCDD-EEFF-0011-2233-4455-6677-8899'];
async function fixtures(page, options = {}) {
  const errors = [], calls = [], state = { user: options.signedIn ? { ...user } : null, pending: options.scope ? pending(options.scope) : null, totp: options.scope === 'enrollment' ? [] : [{ ...factor }], recent: false, verificationComplete: false };
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, body = request.method() === 'POST' ? request.postDataJSON() : null;
    calls.push({ path, body });
    let data;
    const fail = message => route.fulfill({ status: 403, json: { statusCode: 403, message } });
    if (path === '/api/session') data = { user: state.user, pending: state.pending, setup_required: false };
    else if (path === '/api/login') { if (options.unverified) data = { user: null, pending: { scope: 'email_verification' } }; else { state.pending = pending(options.loginScope || 'mfa'); data = { user: null, pending: state.pending }; } }
    else if (path === '/api/logout') { state.user = null; state.pending = null; data = { ok: true }; }
    else if (path === '/api/security/status') data = { user: state.user, pending: state.pending, totp: state.totp, passkeys: [], recovery_codes_remaining: 8, require_admin_mfa: true, recent_strong_auth: state.recent };
    else if (path === '/api/security/totp/begin') { if (!body.password) return fail('Your password is incorrect.'); data = { challenge_token: 'synthetic-enrollment', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/CardShelf:security%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=CardShelf', expires_at: new Date(Date.now() + 300000).toISOString() }; }
    else if (path === '/api/security/totp/verify') { if (body.code !== '654321') return fail('The authenticator code is incorrect or expired.'); state.user = { ...user }; state.pending = null; state.totp = [{ ...factor }]; state.recent = true; data = { user: state.user, recovery_codes: codes }; }
    else if (path === '/api/security/totp/login') { if (body.code !== '654321') return fail('The authenticator code is incorrect, expired, or already used.'); state.user = { ...user }; state.pending = null; data = { user: state.user }; }
    else if (path === '/api/security/recovery/redeem') { state.pending = { ...pending('enrollment'), recovery_mode: true }; data = { user: null, pending: state.pending }; }
    else if (path === '/api/security/reauthenticate') { state.recent = true; data = { proof_token: 'synthetic-single-use-proof' }; }
    else if (path === '/api/security/recovery/regenerate') data = { recovery_codes: codes };
    else if (path === '/api/security/passkeys/begin') data = { challenge_token: 'synthetic-registration', options: { challenge: 'dGVzdC1jaGFsbGVuZ2U', rp: { id: '127.0.0.1', name: 'CardShelf' }, user: { id: 'dGVzdC11c2Vy', name: user.email, displayName: user.name }, pubKeyCredParams: [{ alg: -7, type: 'public-key' }], timeout: 60000, attestation: 'none' } };
    else if (path === '/api/public/email-verification/complete') { if (body.password !== 'correct password') return fail('The link or password could not be verified.'); state.verificationComplete = true; data = { verified: true, message: 'Your email address is verified. Sign in to continue.' }; }
    else if (path === '/api/public/email-verification/request') data = { message: 'If an unverified account matches that email, a verification link will be sent when email delivery is available.' };
    else if (path === '/api/account/membership') data = { access: { tier: 'complimentary', features: [], allowed: true }, message: 'Your existing account access is preserved.' };
    else if (path === '/api/account/games') data = { tier: 'complimentary' };
    else if (path === '/api/public/free-registration') data = { enabled: true };
    else if (path === '/api/public/register') data = { created: true, verification_required: true };
    else if (path.startsWith('/api/ads/')) data = { eligible: false };
    else data = {};
    return route.fulfill({ json: data });
  });
  return { errors, calls, state };
}
async function noOverflow(page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
async function passwordLogin(page) {
  await page.getByLabel('Email address', { exact: true }).fill(user.email); await page.getByLabel('Password', { exact: true }).fill('current password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
test('password login, pending reload, invalid TOTP retry and cancellation keep private UI closed', async ({ page }, info) => {
  const h = await fixtures(page); await page.goto('/login?next=/account'); await passwordLogin(page);
  await expect(page.getByRole('heading', { name: 'One more check.' })).toBeVisible(); await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByLabel('Authenticator code', { exact: true })).toBeVisible();
  await page.getByLabel('Authenticator code', { exact: true }).fill('111111'); await page.getByRole('button', { name: 'Verify and sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect, expired'); await expect(page.getByLabel('Authenticator code', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click(); await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to authenticator or passkey' }).click();
  const recoveryAction = await page.getByRole('button', { name: 'Use a recovery code instead', exact: true }).boundingBox();
  const cancelAction = await page.getByRole('button', { name: 'Cancel sign-in', exact: true }).boundingBox();
  expect(recoveryAction).not.toBeNull(); expect(cancelAction).not.toBeNull();
  expect(Math.max(cancelAction.x - (recoveryAction.x + recoveryAction.width), cancelAction.y - (recoveryAction.y + recoveryAction.height))).toBeGreaterThanOrEqual(12);
  expect(recoveryAction.height).toBeGreaterThanOrEqual(44); expect(cancelAction.height).toBeGreaterThanOrEqual(44);
  await noOverflow(page); await page.screenshot({ path: info.outputPath('pending-mfa.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cancel sign-in', exact: true }).click(); await expect(page).toHaveURL(/\/$/); expect(h.state.pending).toBeNull();
  await page.goto('/account'); await expect(page).toHaveURL(/\/login\?next=/); expect(h.errors).toEqual([]);
});
test('enrollment needs a password, generates local QR, survives invalid code and gates one-time code dismissal', async ({ page }, info) => {
  const h = await fixtures(page, { scope: 'enrollment' }); await page.goto('/admin'); await expect(page).toHaveURL(/\/security/);
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toHaveCount(0); await page.getByRole('button', { name: 'Add an authenticator app', exact: true }).click();
  await expect(page.getByLabel('Current password', { exact: true })).toBeVisible(); await page.getByLabel('Current password', { exact: true }).fill('current password'); await page.getByRole('button', { name: 'Continue to setup', exact: true }).click();
  await expect(page.getByLabel('Manual authenticator setup key', { exact: true })).toHaveValue('JBSWY3DPEHPK3PXP'); await expect(page.locator('img.totp-qr')).toHaveAttribute('src', /^data:image\/png/);
  await page.getByLabel('Authenticator code', { exact: true }).fill('111111'); await page.getByRole('button', { name: 'Verify and enable authenticator' }).click(); await expect(page.getByRole('alert')).toContainText('incorrect or expired');
  await page.getByLabel('Authenticator code', { exact: true }).fill('654321'); await page.getByRole('button', { name: 'Verify and enable authenticator' }).click();
  await expect(page.getByRole('heading', { name: 'Save these recovery codes now.' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Done, hide recovery codes' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Continue to your account' })).toHaveCount(0); await noOverflow(page); await page.screenshot({ path: info.outputPath('offline-recovery-codes.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'I have saved these codes somewhere safe offline.' }).check(); await page.getByRole('button', { name: 'Done, hide recovery codes' }).click();
  await expect(page.getByText(codes[0], { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Remove Phone authenticator', exact: true })).toBeDisabled();
  const begin = h.calls.find(call => call.path === '/api/security/totp/begin'); expect(begin.body.password).toBe('current password'); expect(h.errors).toEqual([]);
});
test('cancelled setup clears secret and browser Back does not reopen an old setup', async ({ page }) => {
  const h = await fixtures(page, { signedIn: true }); await page.goto('/account'); await page.getByRole('link', { name: 'Account security', exact: true }).click();
  await page.getByRole('button', { name: 'Add an authenticator app', exact: true }).click(); await page.getByLabel('Current password', { exact: true }).fill('current password'); await page.getByLabel('Current authenticator code', { exact: false }).fill('123456'); await page.getByRole('button', { name: 'Continue to setup' }).click();
  await expect(page.getByLabel('Manual authenticator setup key')).toBeVisible(); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByLabel('Manual authenticator setup key')).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to account', exact: true }).click();
  // NuxtLink navigation is asynchronous; wait for its history entry before Back.
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Your space. Your access.', exact: true })).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/\/security$/);
  await expect(page.getByRole('button', { name: 'Add an authenticator app', exact: true })).toBeVisible(); await expect(page.getByLabel('Manual authenticator setup key')).toHaveCount(0); expect(h.errors).toEqual([]);
});
test('sensitive-action reauthentication is explicit and keeps the return path', async ({ page }) => {
  const h = await fixtures(page, { signedIn: true }); await page.goto('/security?next=/account'); await page.getByRole('button', { name: 'Verify for sensitive actions' }).click();
  await page.getByLabel('Current password', { exact: true }).fill('current password'); await page.getByLabel('Current authenticator code', { exact: false }).fill('123456'); await page.getByRole('button', { name: 'Verify identity', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Identity confirmed'); await expect(page.getByText('Identity recently confirmed', { exact: true })).toBeVisible();
  expect(h.calls.filter(call => call.path === '/api/security/reauthenticate')).toHaveLength(1); await page.getByRole('link', { name: 'Continue to your account' }).click(); await expect(page).toHaveURL(/\/account$/); await expect(page.getByText('Email: Not verified · existing account access is preserved')).toBeVisible(); expect(h.errors).toEqual([]);
});
test('passkey browser cancellation returns to an editable factor form', async ({ page }) => {
  const h = await fixtures(page, { scope: 'enrollment' });
  await page.addInitScript(() => { Object.defineProperty(navigator.credentials, 'create', { configurable: true, value: async () => { throw new DOMException('Cancelled by test', 'NotAllowedError'); } }); });
  await page.goto('/security'); await page.getByRole('button', { name: 'Add a passkey or security key', exact: true }).click(); await page.getByLabel('Current password', { exact: true }).fill('current password'); await page.getByRole('button', { name: 'Create passkey or security key', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('cancelled or timed out'); await expect(page.getByLabel('Current password', { exact: true })).toHaveValue(''); await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  expect(h.calls.filter(call => call.path === '/api/security/passkeys/verify')).toHaveLength(0); expect(h.errors).toEqual([]);
});
test('verification strips fragment and requires explicit matching password; resend remains generic', async ({ page }, info) => {
  const h = await fixtures(page); await page.goto('/verify-email#token=' + 'a'.repeat(64)); await expect(page).toHaveURL(/\/verify-email$/);
  expect(h.calls.filter(call => call.path === '/api/public/email-verification/complete')).toHaveLength(0); await page.getByLabel('Current password', { exact: true }).fill('incorrect password'); await page.getByRole('button', { name: 'Verify email address', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be verified'); await expect(page.getByLabel('Current password', { exact: true })).toHaveValue(''); await page.getByLabel('Current password', { exact: true }).fill('correct password'); await page.getByRole('button', { name: 'Verify email address', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Email verified.' })).toBeVisible(); expect(h.state.user).toBeNull(); await noOverflow(page); await page.screenshot({ path: info.outputPath('verified-email.png'), fullPage: true });
  await page.reload(); await expect(page.getByRole('alert')).toContainText('Open the link'); await page.getByText('Need a new verification link?', { exact: true }).click(); await page.getByLabel('Email address', { exact: true }).fill(user.email); await page.getByRole('button', { name: 'Request a new link', exact: true }).click(); await expect(page.getByRole('status')).toContainText('If an unverified account matches'); expect(h.errors).toEqual([]);
});
test('new registration tells the collector to verify before sign-in', async ({ page }) => {
  const h = await fixtures(page); await page.goto('/register'); await page.getByLabel('Name', { exact: true }).fill('Security tester'); await page.getByLabel('Email', { exact: true }).fill(user.email); await page.getByLabel('Password', { exact: true }).fill('new long password'); await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Create Free account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email.' })).toBeVisible(); await expect(page.getByText('Verify your email address before your first sign-in.', { exact: false })).toBeVisible(); expect(h.state.user).toBeNull(); expect(h.errors).toEqual([]);
});
