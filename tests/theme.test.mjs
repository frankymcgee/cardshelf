import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { themeMode,resolvedTheme,THEME_STORAGE_KEY } from '../shared/theme.mjs';
const script=await readFile(new URL('../public/theme-init.js',import.meta.url),'utf8');
for(const value of ['light','dark','system']) test('theme preference is retained: '+value,()=>assert.equal(themeMode(value),value));
for(const value of [null,undefined,{},[],false,'DARK','auto','<script>','__proto__']) test('invalid preference falls back to System: '+String(value),()=>assert.equal(themeMode(value),'system'));
for(const mode of ['light','dark','system']) for(const dark of [true,false]) test(`theme resolution ${mode}, device dark=${dark}`,()=>assert.equal(resolvedTheme(mode,dark),mode==='system'?(dark?'dark':'light'):mode));
function bootstrap(saved,dark,brokenStorage=false,brokenMedia=false) {
  const root={dataset:{},style:{}};let writes=0;
  vm.runInNewContext(script,{window:{localStorage:{getItem(key){assert.equal(key,THEME_STORAGE_KEY);if(brokenStorage)throw Error('Storage blocked');return saved;},setItem(){writes++}},matchMedia(){if(brokenMedia)throw Error('No media support');return {matches:dark}}},document:{documentElement:root}});
  return {root,writes};
}
for(const saved of [null,'invalid','system','light','dark']) for(const dark of [true,false]) test(`pre-paint script applies saved=${saved} dark=${dark}`,()=>{const {root,writes}=bootstrap(saved,dark);assert.equal(root.dataset.theme,resolvedTheme(saved,dark));assert.equal(root.dataset.themeMode,themeMode(saved));assert.equal(root.style.colorScheme,root.dataset.theme);assert.equal(writes,0)});
test('blocked storage follows the device without throwing or writing',()=>assert.equal(bootstrap('light',true,true).root.dataset.theme,'dark'));
test('unavailable matchMedia safely paints light when in System',()=>assert.equal(bootstrap(null,false,false,true).root.dataset.theme,'light'));
test('explicit dark does not depend on matchMedia',()=>assert.equal(bootstrap('dark',false,false,true).root.dataset.theme,'dark'));
test('pre-paint asset cannot carry account data or make remote requests',()=>{assert.doesNotMatch(script,/\b(?:fetch|XMLHttpRequest|cookie|eval)\s*\(/);assert.doesNotMatch(script,/https?:\/\//)});
test('Nuxt loads the theme asset and CSS without disabling strict checks or SSR',async()=>{const s=await readFile(new URL('../nuxt.config.ts',import.meta.url),'utf8');assert.match(s,/\/theme-init\.js\?v=0\.12\.0/);assert.match(s,/themes\.css/);assert.match(s,/strict:\s*true/);assert.match(s,/ssr:\s*true/)});
test('all three choices are available without premium or administrative gating',async()=>{const s=await readFile(new URL('../app/components/ThemePicker.vue',import.meta.url),'utf8');for(const mode of ['light','dark','system'])assert.match(s,new RegExp('value="'+mode+'"'));assert.doesNotMatch(s,/membership|requireCapability/)});
test('theme lifecycle follows OS changes and other tabs, then removes listeners',async()=>{const s=await readFile(new URL('../app/plugins/theme.client.ts',import.meta.url),'utf8');assert.match(s,/app:mounted/);assert.match(s,/addEventListener\('storage'/);assert.match(s,/addEventListener\('change'/);assert.match(s,/removeEventListener\('storage'/);assert.match(s,/removeEventListener\('change'/)});
