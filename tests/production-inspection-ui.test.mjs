import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ADMIN_LINKS } from '../shared/navigation.mjs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('the privacy page owns exactly one complete sponsor and advertising notice', () => {
  assert.equal((read('app/pages/privacy.vue').match(/<FreePrivacyNotice\b/g) || []).length, 1);
  assert.doesNotMatch(read('app/layouts/marketing.vue'), /FreePrivacyNotice/);
  assert.match(read('app/components/FreePrivacyNotice.vue'), /Adsterra’s privacy policy/);
});
test('binder and email navigation copy reflects shipped plan and provider names', () => {
  assert.match(read('app/pages/binders/index.vue'), /Collector Plus can manage all supported games/);
  assert.doesNotMatch(read('app/pages/binders/index.vue'), /Collector Pro/);
  assert.match(ADMIN_LINKS.find(link => link.to === '/admin/emails').description, /Postal or external SMTP/);
});
test('collection pages retain persistent retry errors and ignore stale or unmounted reads', () => {
  for (const file of ['app/pages/app.vue', 'app/pages/binders/index.vue']) {
    const source = read(file);
    assert.match(source, /v-if="loadError"[^>]*role="alert"/);
    assert.match(source, /@click="load">Retry/);
    assert.match(source, /alive && current === sequence/);
    assert.match(source, /onBeforeUnmount\(\(\) => \{ alive = false; sequence\+\+ \}\)/);
  }
  assert.match(read('app/pages/app.vue'), /<template v-if="data">/);
  assert.match(read('app/pages/app.vue'), /!data \? '—' : stat.value/);
  assert.match(read('app/pages/binders/index.vue'), /v-else-if="!loadError" class="empty-state/);
});
test('registration distinguishes checking, unavailable and paused without retaining a password on unmount', () => {
  const source = read('app/pages/register.vue');
  assert.match(source, /Checking account registration…/);
  assert.match(source, /v-else-if="checked && !error"/);
  assert.match(source, /Could not check account registration/);
  assert.match(source, /sequence\+\+; form.password = ''/);
});
test('inspection changes compile the actual Vue scripts and templates', () => {
  for (const file of ['app/pages/app.vue', 'app/pages/binders/index.vue', 'app/pages/register.vue', 'app/layouts/marketing.vue']) {
    const { descriptor, errors } = parse(read(file), { filename: file });
    assert.deepEqual(errors, [], file);
    assert.doesNotThrow(() => compileScript(descriptor, { id: file, inlineTemplate: true }), file);
  }
});
