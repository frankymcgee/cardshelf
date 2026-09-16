import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceDefaults, resolvedAppearance, contrastingText, wallpaperUrl } from '../shared/appearance.mjs';
import { appearanceInput, decodeWallpaper } from '../lib/appearance-validation.mjs';
import { printingVisual, namedCardClass, singlePrinting } from '../shared/variant-visuals.mjs';
const defaults=appearanceDefaults();
const png=Buffer.from([137,80,78,71,13,10,26,10]);
const input={content_type:'image/png',data_base64:png.toString('base64')};
test('old binders inherit their existing cover colour with a static effect default',()=>{
  assert.equal(resolvedAppearance({},'#123456').background_color,'#123456');assert.equal(defaults.effects_mode,'subtle');assert.equal(defaults.print_background,false);
});
test('saved appearance resolves consistently without mutating the input',()=>{
  const v={...defaults,mode:'image',pocket_opacity:45};assert.deepEqual(resolvedAppearance(v),v);assert.deepEqual(appearanceInput(v),v);
});
test('invalid saved CSS values are replaced with safe defaults',()=>{
  const v=resolvedAppearance({background_color:'url(https://bad.invalid)',wallpaper_fit:'url(x)',wallpaper_dim:999,effects_mode:'flash'});
  assert.deepEqual(v,defaults);
});
for(const [name,setting] of Object.entries({colour:{pocket_color:'red;display:none'},mode:{mode:'url'},opacity:{wallpaper_opacity:101},blur:{wallpaper_blur:13},fraction:{pocket_opacity:0.5},boolean:{print_background:'true'},url:{image_url:'https://bad.invalid'},effect:{effects_mode:'strobe'}}))
  test('appearance rejects invalid '+name,()=>assert.throws(()=>appearanceInput({...defaults,...setting})));
test('legitimate zero opacity and full dim values are retained',()=>{
  const v=appearanceInput({...defaults,wallpaper_opacity:0,pocket_opacity:0,wallpaper_dim:100});assert.equal(v.wallpaper_opacity,0);assert.equal(v.wallpaper_dim,100);
});
test('text contrast adapts for dark and light pocket colours',()=>{
  assert.equal(contrastingText('#000000'),'#ffffff');assert.equal(contrastingText('#ffffff'),'#172032');
});
test('wallpaper URLs use authenticated or token-scoped routes, never saved URLs',()=>{
  const b={id:'10000000-0000-0000-0000-000000000001',wallpaper_version:'a'.repeat(64)};
  assert.match(wallpaperUrl(b),/^\/api\/binders\//);assert.match(wallpaperUrl(b,'b'.repeat(64)),/^\/api\/shared\/b+\/wallpaper/);
  assert.equal(wallpaperUrl(b,'bad" url'), '');assert.equal(wallpaperUrl({...b,wallpaper_version:'url(foo)'}),'');
});
test('wallpaper payload accepts image magic bytes only for its matching MIME type',()=>{
  assert.deepEqual(decodeWallpaper(input).bytes,png);
  assert.throws(()=>decodeWallpaper({...input,content_type:'image/jpeg'}));
});
test('wallpaper payload rejects non-images and SVG even if renamed PNG',()=>{
  assert.throws(()=>decodeWallpaper({content_type:'image/svg+xml',data_base64:'PHN2Zz4='}));
  assert.throws(()=>decodeWallpaper({content_type:'image/png',data_base64:Buffer.from('<svg onload="alert(1)"/>').toString('base64')}));
});
test('wallpaper payload bounds size before decoding and rejects malformed base64',()=>{
  assert.throws(()=>decodeWallpaper({...input,data_base64:'A'.repeat(6_666_672)}));
  for(const b of ['', '==not base64', 'AAAA%', 'data:image/png;base64,AAAA']) assert.throws(()=>decodeWallpaper({...input,data_base64:b}));
});
test('known finish keys get distinct styles without using rarity or card name',()=>{
  assert.equal(printingVisual({key:'normal',label:'Normal'}).type,'normal');
  assert.equal(printingVisual({key:'holo'}).type,'holo');assert.equal(printingVisual({key:'reverse'}).type,'reverse');
  assert.equal(printingVisual({key:'unspecified',rarity:'Secret Rare',name:'Charizard ex'}).type,'unknown');
});
test('edition and arbitrary manual labels never imply a finish',()=>{
  for(const p of [{key:'firstEdition',label:'First Edition — finish unspecified'},{key:'shadowless'},
    {key:'manual-foil',source:'manual',verified:true,label:'Possibly Holo'},{key:'manual-holo',source:'manual',verified:false,label:'Holo'}]) assert.equal(printingVisual(p).type,'unknown');
});
test('verified manual canonical finish labels are supported conservatively',()=>{
  assert.equal(printingVisual({source:'manual',verified:true,label:'Reverse Holo'}).type,'reverse');
});
test('inherited JavaScript property names cannot become variant styles',()=>{
  for(const key of ['__proto__','constructor','toString']) assert.equal(printingVisual({key}).type,'unknown');
});
test('named card mechanics distinguish ex and EX without claiming a finish',()=>{
  for(const [name,label] of [['Charizard ex','ex'],['Charizard-EX','EX'],['Pikachu V','V'],['Eevee VMAX','VMAX'],['Mewtwo GX','GX'],['リザードンex','ex'],['レックウザVMAX','VMAX']]) assert.equal(namedCardClass(name)?.label,label);
});
test('normal names, rarity descriptors and unsupported suffixes do not receive mechanic badges',()=>{
  for(const name of ['Calyrex','Snorlax','Vaporeon','Alex','EXAMPLE','Gold Pikachu','Secret Rare','Pikachu V-UNION','full art']) assert.equal(namedCardClass(name),null,name);
});
test('generic catalogue artwork has no assumed finish when printings are ambiguous',()=>{
  const p={key:'holo'};assert.equal(singlePrinting({visual_printings:[p]}),p);assert.equal(singlePrinting({visual_printings:[p,{key:'normal'}]}),null);assert.equal(singlePrinting({}),null);
});
