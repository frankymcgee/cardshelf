import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parse, compileScript } from '@vue/compiler-sfc';
import { safeReturnTo, publicPage, sharedPage } from '../shared/platform.mjs';
import { recoveryPage } from '../shared/password-recovery.mjs';
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const login = 'app/pages/login.vue', security = 'app/pages/security.vue', verify = 'app/pages/verify-email.vue';
function ui(file, options = {}) {
  const source = read(file), script = (source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1] || source).replace(/^import .*$/mg, '').replace(/export default /, 'const middleware = ').replaceAll('import.meta.server', 'false');
  const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), names = [], mounts = [], unmounts = [], leaves = [], navigations = [], calls = [], history = [], aborts = [];
  const add = node => { if (ts.isIdentifier(node)) names.push(node.text); else if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) for (const entry of node.elements) if (ts.isBindingElement(entry)) add(entry.name); };
  for (const node of ast.statements) { if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) add(declaration.name); if (ts.isFunctionDeclaration(node) && node.name) names.push(node.name.text); }
  const auth = options.auth || { state: { value: { loaded: true, user: null, pending: null } }, async refresh() { return this.state.value; }, async logout() { this.state.value = { loaded: true, user: null, pending: null }; navigations.push('/'); } };
  const route = options.route || { path: '/security', query: {} };
  const scope = { ref: value => ({ value }), reactive: value => value, computed: fn => ({ get value() { return fn(); } }), onMounted: fn => mounts.push(fn), onBeforeUnmount: fn => unmounts.push(fn), onBeforeRouteLeave: fn => leaves.push(fn), useApi: () => async (url, args) => { calls.push({ url, ...(args ? { body: plain(args.body) } : {}) }); return (options.api || (async () => ({})))(url, args); }, useAuth: () => auth, useRoute: () => route, useSeoMeta() {}, definePageMeta() {}, defineNuxtRouteMiddleware: fn => fn, navigateTo: async value => { navigations.push(plain(value)); return value; }, errorMessage: e => e.data?.message || e.message || 'Request failed', setInterval: () => 1, clearInterval() {}, URL, URLSearchParams, Date, Number, console, safeReturnTo, publicPage, sharedPage, recoveryPage, QRCode: { toDataURL: async () => 'data:image/png;base64,synthetic-qr' }, startAuthentication: options.authenticate || (async () => ({ id: 'assertion' })), startRegistration: options.register || (async () => ({ id: 'registration' })), WebAuthnAbortService: { cancelCeremony: () => aborts.push(true) }, window: { location: { hash: options.hash || '' }, history: { state: {}, replaceState: (...args) => history.push(args) }, isSecureContext: true, PublicKeyCredential: class {}, addEventListener() {}, removeEventListener() {}, confirm: options.confirm || (() => true) } };
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return { ...vm.runInNewContext('(function(){' + js + '; return {' + names.join(',') + '};})()', scope), mounts, unmounts, leaves, calls, navigations, history, aborts, auth };
}
const pending = (scope = 'mfa') => ({ scope, methods: ['totp', 'passkey'], expires_at: '2030-01-01T00:00:00Z' });
const factor = { id: 'f1', label: 'My authenticator', created_at: '2026-10-01T00:00:00Z' };
const status = extra => ({ user: { id: 'u1', role: 'user' }, pending: null, totp: [factor], passkeys: [], recovery_codes_remaining: 8, require_admin_mfa: true, recent_strong_auth: false, ...extra });
const flush = () => new Promise(resolve => setImmediate(resolve));
test('password login stays pending until MFA succeeds and clears credentials', async () => {
  const h = ui(login, { api: async () => { h.auth.state.value.pending = pending(); return { user: null, pending: pending() }; } });
  h.form.password = 'current password'; h.form.token = 'bootstrap secret'; await h.submit();
  assert.equal(h.pending.value.scope, 'mfa'); assert.deepEqual(h.navigations, []); assert.equal(h.form.password, ''); assert.equal(h.form.token, '');
});
test('mandatory enrollment routes only to isolated security with a safe return path', async () => {
  const h = ui(login, { route: { query: { next: '//evil.test' } }, api: async () => { h.auth.state.value.pending = pending('enrollment'); return { pending: pending('enrollment') }; } });
  await h.submit(); assert.deepEqual(h.navigations, [{ path: '/security', query: { next: '/app' } }]);
});
test('unverified login gives resend guidance without granting a session', async () => {
  const h = ui(login, { api: async () => ({ pending: { scope: 'email_verification' } }) }); h.form.email = 'test@example.test'; h.form.password = 'password'; await h.submit();
  assert.equal(h.verificationEmail.value, 'test@example.test'); assert.equal(h.showResend.value, true); assert.deepEqual(h.navigations, []); assert.equal(h.auth.state.value.user, null);
});
test('duplicate submit and late unmounted login results cannot cause duplicate requests or navigation', async () => {
  let resolve; const h = ui(login, { api: () => new Promise(r => { resolve = r; }) }); h.form.password = 'secret'; const first = h.submit(); await h.submit(); assert.equal(h.calls.length, 1);
  h.unmounts.forEach(fn => fn()); resolve({ user: { id: 'u1' } }); await first; assert.deepEqual(h.navigations, []); assert.equal(h.form.password, ''); assert.equal(h.aborts.length, 1);
});
test('passkey cancellation is retryable and never sends verification', async () => {
  const h = ui(login, { api: async () => ({ challenge_token: 'challenge', options: {} }), authenticate: async () => { throw { name: 'NotAllowedError' }; } });
  h.auth.state.value.pending = pending(); await h.secondFactor('passkey'); assert.match(h.error.value, /cancelled or timed out/); assert.equal(h.busy.value, false); assert.equal(h.calls.length, 1); assert.deepEqual(h.navigations, []);
});
test('recovery redeems only with a fresh password and routes to replacement enrollment', async () => {
  const h = ui(login, { api: async () => { h.auth.state.value.pending = pending('enrollment'); return { pending: pending('enrollment') }; } });
  h.auth.state.value.pending = pending(); h.recoveryPassword.value = 'fresh password'; h.recoveryCode.value = 'recovery code'; await h.secondFactor('recovery');
  assert.deepEqual(h.calls[0], { url: '/api/security/recovery/redeem', body: { password: 'fresh password', code: 'recovery code' } }); assert.equal(h.recoveryPassword.value, ''); assert.equal(h.recoveryCode.value, ''); assert.equal(h.navigations[0].path, '/security');
});
test('pending enrollment cannot open collection, administrator or data settings UI', async () => {
  for (const path of ['/app', '/admin', '/settings', '/account']) { const h = ui('app/middleware/auth.global.ts'); h.auth.state.value.pending = pending('enrollment'); await h.middleware({ path, fullPath: path, query: {} }); assert.equal(h.navigations[0].path, '/security'); }
  const h = ui('app/middleware/auth.global.ts'); h.auth.state.value.pending = pending('enrollment'); await h.middleware({ path: '/security', fullPath: '/security', query: {} }); assert.deepEqual(h.navigations, []);
});
test('MFA challenge cannot open security management before full sign-in', async () => {
  const h = ui('app/middleware/auth.global.ts'); h.auth.state.value.pending = pending(); await h.middleware({ path: '/security', fullPath: '/security', query: {} }); assert.equal(h.navigations[0].path, '/login');
});
test('email verification route is public without reading a private session', async () => {
  const h = ui('app/middleware/auth.global.ts'); h.auth.refresh = async () => { throw new Error('Must not read session'); }; await h.middleware({ path: '/verify-email/', query: {} }); assert.deepEqual(h.navigations, []);
});
test('bootstrap enrollment still requires the current password and displays a local QR and key', async () => {
  const h = ui(security, { api: async () => ({ challenge_token: 'challenge', secret: 'SYNTHETIC-KEY', uri: 'otpauth://totp/test?secret=SYNTHETIC' }) }); h.status.value = status({ user: null, pending: pending('enrollment'), totp: [] });
  h.choose('totp'); h.credentials.password = 'fresh password'; await h.submitAction();
  assert.deepEqual(h.calls[0].body, { password: 'fresh password', label: 'Authenticator app' }); assert.equal(h.enrollment.value.secret, 'SYNTHETIC-KEY'); assert.match(h.qr.value, /^data:image\/png/); assert.equal(h.credentials.password, '');
  h.cancelAction(); assert.equal(h.enrollment.value, null); assert.equal(h.qr.value, '');
});
test('existing TOTP protects factor enrollment with fresh password and code', async () => {
  const h = ui(security, { api: async () => ({ secret: 'synthetic', uri: 'otpauth://synthetic' }) }); h.status.value = status(); h.choose('totp'); h.credentials.password = 'current'; h.credentials.code = '123456'; await h.submitAction();
  assert.deepEqual(h.calls[0].body, { password: 'current', code: '123456', label: 'Authenticator app' }); assert.equal(h.credentials.code, '');
});
test('passkey proof is obtained freshly and used for exactly the requested management call', async () => {
  const h = ui(security, { api: async url => url.endsWith('/authenticate/begin') ? { challenge_token: 'challenge', options: {} } : url.endsWith('/authenticate/verify') ? { proof_token: 'once-only-proof' } : url.endsWith('/regenerate') ? { recovery_codes: ['code-one'] } : status({ totp: [], passkeys: [factor] }) });
  h.status.value = status({ totp: [], passkeys: [factor] }); h.choose('recovery'); h.confirmation.value = true; h.credentials.password = 'current'; await h.submitAction();
  assert.deepEqual(h.calls[0].body, { purpose: 'reauth', password: 'current' }); assert.equal(h.calls[1].body.purpose, 'reauth'); assert.deepEqual(h.calls[2].body, { password: 'current', proof_token: 'once-only-proof' }); assert.deepEqual(plain(h.recoveryCodes.value), ['code-one']); assert.equal(h.credentials.password, '');
});
test('recovery replacement requires explicit acknowledgment and codes stay until offline-save acknowledgment', async () => {
  const h = ui(security, { api: async url => url.endsWith('/regenerate') ? { recovery_codes: ['one', 'two'] } : status() }); h.status.value = status(); h.choose('recovery'); h.credentials.password = 'current'; h.credentials.code = '123456';
  await h.submitAction(); assert.equal(h.calls.length, 0); h.confirmation.value = true; await h.submitAction(); h.dismissCodes(); assert.equal(h.recoveryCodes.value.length, 2); h.savedCodes.value = true; h.dismissCodes(); assert.deepEqual(plain(h.recoveryCodes.value), []);
});
test('TOTP enrollment verifies only the staged challenge and clears the setup secret after completion', async () => {
  const h = ui(security, { api: async url => url.endsWith('/totp/verify') ? { user: { id: 'u1' }, recovery_codes: ['offline'] } : status() }); h.enrollment.value = { challenge_token: 'challenge', secret: 'secret' }; h.enrollmentCode.value = '123456'; h.qr.value = 'qr'; await h.verifyTotp();
  assert.deepEqual(h.calls[0].body, { challenge_token: 'challenge', code: '123456' }); assert.equal(h.enrollment.value, null); assert.equal(h.enrollmentCode.value, ''); assert.equal(h.qr.value, ''); assert.deepEqual(plain(h.recoveryCodes.value), ['offline']);
});
test('failed authenticator verification retains the staged setup for retry but clears entered code', async () => {
  const h = ui(security, { api: async () => { throw { message: 'Incorrect code' }; } }); h.enrollment.value = { challenge_token: 'challenge', secret: 'secret' }; h.enrollmentCode.value = '123456'; await h.verifyTotp(); assert.equal(h.enrollment.value.challenge_token, 'challenge'); assert.equal(h.enrollmentCode.value, ''); assert.equal(h.busy.value, false);
});
test('sensitive action reauthentication works independently of changing factors', async () => {
  const h = ui(security, { api: async url => url.endsWith('/reauthenticate') ? { proof_token: 'unused' } : status({ recent_strong_auth: true }) }); h.status.value = status(); h.choose('reauth'); h.credentials.password = 'current'; h.credentials.code = '123456'; await h.submitAction();
  assert.deepEqual(h.calls[0], { url: '/api/security/reauthenticate', body: { password: 'current', code: '123456' } }); assert.equal(h.status.value.recent_strong_auth, true); assert.match(h.message.value, /Identity confirmed/); assert.equal(h.action.value, '');
});
test('last factor cannot be removed for any role', () => { const h = ui(security); h.status.value = status(); assert.equal(h.lastRequiredFactor.value, true); h.status.value.totp.push({ ...factor, id: 'f2' }); assert.equal(h.lastRequiredFactor.value, false); });
test('security unmount clears all secrets and ignores a late setup response', async () => {
  let resolve; const h = ui(security, { api: () => new Promise(r => { resolve = r; }) }); h.status.value = status(); h.choose('totp'); h.credentials.password = 'current'; h.credentials.code = '123456'; const request = h.submitAction(); await flush(); h.unmounts.forEach(fn => fn()); resolve({ secret: 'late secret', uri: 'otpauth://late' }); await request;
  assert.equal(h.enrollment.value, null); assert.equal(h.qr.value, ''); assert.equal(h.credentials.password, ''); assert.equal(h.status.value, null);
});
test('verification immediately clears fragment and never activates from opening the link', async () => {
  const token = 'a'.repeat(64), h = ui(verify, { hash: '#token=' + token }); h.mounts.forEach(fn => fn()); assert.equal(h.token.value, token); assert.equal(h.history[0][2], '/verify-email'); assert.deepEqual(h.calls, []);
  h.password.value = 'current'; h.unmounts.forEach(fn => fn()); assert.equal(h.token.value, ''); assert.equal(h.password.value, '');
});
test('verification errors allow explicit retry and successful verification never signs in automatically', async () => {
  let attempts = 0; const h = ui(verify, { hash: '#token=' + 'a'.repeat(64), api: async () => { if (!attempts++) throw { message: 'Incorrect password' }; return { verified: true, message: 'Verified. Sign in to continue.' }; } }); h.mounts.forEach(fn => fn()); h.password.value = 'wrong'; await h.verify(); assert.equal(h.password.value, ''); assert.equal(h.token.value.length, 64);
  h.password.value = 'correct'; await h.verify(); assert.equal(h.verified.value, true); assert.equal(h.token.value, ''); assert.deepEqual(h.navigations, []);
});
test('invalid verification token stays unusable and secrets never enter browser storage', async () => {
  const h = ui(verify, { hash: '#token=invalid' }); h.mounts.forEach(fn => fn()); await h.verify(); assert.equal(h.calls.length, 0); assert.equal(h.token.value, '');
  for (const file of [login, security, verify]) assert.doesNotMatch(read(file), /localStorage|sessionStorage/);
});
test('a failed post-enrollment status read retains one-time codes for an explicit reload', async () => {
  let broken = true; const h = ui(security, { api: async url => { if (url.endsWith('/totp/verify')) return { user: { id: 'u1' }, recovery_codes: ['offline'] }; if (broken) throw { message: 'Network unavailable' }; return status(); } });
  h.status.value = status({ user: null, pending: pending('enrollment'), totp: [] }); h.enrollment.value = { challenge_token: 'challenge', secret: 'secret' }; h.enrollmentCode.value = '123456'; await h.verifyTotp();
  assert.deepEqual(plain(h.recoveryCodes.value), ['offline']); assert.match(h.error.value, /Network unavailable/); broken = false; await h.load(); assert.equal(h.status.value.user.id, 'u1'); assert.deepEqual(plain(h.recoveryCodes.value), ['offline']);
});
test('expired enrollment clears stale auth state before redirecting to sign-in', async () => {
  const h = ui(security, { api: async () => status({ user: null, pending: null, totp: [] }) }); h.auth.state.value.pending = pending('enrollment'); await h.load();
  assert.equal(h.auth.state.value.pending, null); assert.equal(h.auth.state.value.user, null); assert.equal(h.navigations[0].path, '/login');
});
test('expired pending challenge cannot submit a factor or recovery code', async () => {
  const h = ui(login); h.auth.state.value.pending = { ...pending(), expires_at: '2020-01-01T00:00:00Z' }; await h.secondFactor('totp'); await h.secondFactor('recovery'); assert.equal(h.calls.length, 0);
});
test('declining to discard unsaved recovery codes keeps the session and codes', async () => {
  let questions = 0; const h = ui(security, { confirm: () => { questions++; return false; } }); h.recoveryCodes.value = ['offline']; await h.signOut(); assert.equal(questions, 1); assert.deepEqual(h.navigations, []); assert.deepEqual(plain(h.recoveryCodes.value), ['offline']);
});
test('confirmed sign-out from one-time codes does not ask the same question twice', async () => {
  let questions = 0; const h = ui(security, { confirm: () => { questions++; return true; } }); h.recoveryCodes.value = ['offline']; await h.signOut(); assert.equal(h.leaves[0](), true); assert.equal(questions, 1);
});
test('account distinguishes legacy unverified access from verified email', () => { const source = read('app/pages/account.vue'); assert.match(source, /email_verified_at/); assert.match(source, /Not verified · existing account access is preserved/); assert.match(source, /to="\/security"/); });
test('all security pages compile their actual scripts and accessible templates', () => {
  for (const file of [login, security, verify, 'app/pages/register.vue', 'app/pages/account.vue', 'app/pages/settings.vue']) { const { descriptor, errors } = parse(read(file), { filename: file }); assert.deepEqual(errors, [], file); assert.doesNotThrow(() => compileScript(descriptor, { id: file, inlineTemplate: true }), file); }
});
