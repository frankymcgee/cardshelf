import test from 'node:test';
import assert from 'node:assert/strict';
import {GAMES,GAME_CODES,gameFromCardId,gameAccess,canManageGame,freeAccountAccess} from '../shared/games.mjs';
import {freeSettingsInput,sponsorEligible,publicSponsor,sponsorUrl} from '../lib/free-settings-logic.mjs';
import {membershipAccess} from '../lib/subscription-logic.mjs';
import {CURRENT_FEATURES} from '../shared/platform.mjs';
import {PLAN_FEATURES} from '../shared/binder-types.mjs';
import * as v from '../lib/validate.mjs';
import {generationInput} from '../lib/binder-generation-logic.mjs';
import {parseImport,exportCSV} from '../lib/portability.mjs';
const state=(tier,reason='administrator_assignment')=>({allowed:true,tier,reason,features:[]});
const free=state('free','free_account');
const config={registration_enabled:false,ads_enabled:false,revision:0,reason:'Synthetic test settings',password:' spaced password '};

test('supported game IDs are fixed and old Pokémon identities are unchanged',()=>{
  assert.deepEqual(GAME_CODES,['pokemon','yugioh','mtg']);assert.equal(GAMES.length,3);
  for(const [id,game] of [['en:base1-4','pokemon'],['ja:base1-4','pokemon'],['yugioh:en:ygo-123-code','yugioh'],['mtg:en:mtg-123-uuid','mtg']]) {
    assert.equal(gameFromCardId(id),game);assert.equal(v.cardId(id),id);
  }
});
for(const id of ['mtg:ja:abc','yugioh:ja:abc','pokemon:en:abc','en:a/b','mtg:en:../x','mtg:en:x:y','http://evil.test','en:'+('x'.repeat(101))])test('rejects unsupported or unsafe card identity '+id,()=>{
  assert.equal(gameFromCardId(id),null);assert.throws(()=>v.cardId(id));
});
test('Collector can edit only its selected game, not a name claiming Pro',()=>{
  for(const game of GAME_CODES)assert.equal(canManageGame(state('collector'),game,'yugioh'),game==='yugioh');
  assert.equal(canManageGame({...state('collector'),name:'Collector Pro'},'mtg'),false);
  assert.equal(canManageGame(state('pro'),'mtg'),false);assert.equal(canManageGame(state('plus'),'unknown'),false);
});
for(const reason of ['administrator','legacy_tester','beta_tester','complimentary','testing_policy'])test('all games retained for protected '+reason,()=>{
  for(const game of GAME_CODES)assert.equal(canManageGame(state('complimentary',reason),game),true);
});
test('Pro uses the established plus identity with no numeric game limit',()=>{
  assert.deepEqual(gameAccess(state('plus')),{mode:'unlimited',limit:null,ad_free:true});
  for(const game of GAME_CODES)assert.equal(canManageGame(state('plus'),game),true);
});
test('unresolved or invalid membership cannot become a Free ad recipient',()=>{
  for(const access of [null,{},state(null),{...free,allowed:false},{...free,allowed:'true'}])assert.equal(sponsorEligible({user:{role:'user'},access,enabled:true}),false);
  assert.equal(gameAccess({tier:'plus',features:[]}).limit,0);
});
test('Free is explicit and does not exploit the old unenforced tester fallback',()=>{
  const inherited=membershipAccess({user:{role:'user'},features:CURRENT_FEATURES,collectorFeatures:PLAN_FEATURES.collector,enforce:false});
  assert.equal(inherited.reason,'testing_policy');
  const actual=freeAccountAccess(inherited,true);assert.equal(actual.tier,'free');assert.deepEqual(actual.features,[]);
  assert.equal(actual.payment_required,false);assert.equal(canManageGame(actual,'pokemon'),false);
  assert.equal(freeAccountAccess(inherited,false),inherited);
});
for(const reason of ['administrator','legacy_tester','beta_tester','complimentary','administrator_assignment','stripe_subscription'])test('a Free marker never replaces '+reason,()=>{
  const a=state('plus',reason);assert.equal(freeAccountAccess(a,true),a);
});
test('ads need an explicit current Free account and enabled configuration',()=>{
  assert.equal(sponsorEligible({user:{role:'user'},access:free,enabled:true}),true);
  for(const override of [{user:null},{user:{role:'admin'}},{enabled:false},{enabled:'true'},{grant:{kind:'beta_tester'}},{pendingBilling:true}])
    assert.equal(sponsorEligible({user:{role:'user'},access:free,enabled:true,...override}),false);
});
for(const tier of ['collector','plus','complimentary',null,undefined])test('ads never returned for tier '+tier,()=>{
  assert.equal(sponsorEligible({user:{role:'user'},access:state(tier),enabled:true}),false);
});
test('only public creative fields leave the settings record',()=>{
  const creative=publicSponsor({sponsor_name:'Test sponsor',sponsor_text:'Test',sponsor_url:'https://example.com/',sponsor_cta:'Read',sponsor_image_alt:'Banner',has_image:true,revision:7,
    updated_by:'private',password:'secret',sponsor_image:Buffer.from('private')});
  assert.deepEqual(Object.keys(creative).sort(),['sponsor','text','url','cta','image_alt','image','revision'].sort());
  assert.equal(creative.image,'/api/ads/image?revision=7');
});
test('sponsor opt-in does not activate registration or platform billing implicitly',()=>{
  const off=freeSettingsInput(config);assert.equal(off.ads_enabled,false);assert.equal(off.registration_enabled,false);assert.equal(off.password,' spaced password ');
  assert.throws(()=>freeSettingsInput({...config,ads_enabled:true}));
  const on=freeSettingsInput({...config,ads_enabled:true,sponsor_name:'Sponsor',sponsor_text:'An advertisement',sponsor_url:'https://example.com/',confirm_sponsor:true});
  assert.equal(on.ads_enabled,true);assert.equal(on.registration_enabled,false);assert.equal('billing_enabled' in on,false);
});
for(const field of ['role','tier','user_id','script','html','stripe_key','billing_enabled'])test('ad settings reject privilege and script field '+field,()=>assert.throws(()=>freeSettingsInput({...config,[field]:'malicious'})));
for(const url of ['javascript:alert(1)','http://example.com','https://user:pass@example.com','https://example.com:8443','https://127.0.0.1','https://localhost','https://10.0.0.1','https://[::1]','//example.com'])test('sponsor URL rejects '+url,()=>assert.throws(()=>sponsorUrl(url)));
test('ordinary sponsor HTTPS URL retained and empty disabled destination is allowed',()=>{
  assert.equal(sponsorUrl('https://example.com/path?campaign=cardshelf'),'https://example.com/path?campaign=cardshelf');assert.equal(sponsorUrl(''),'');
});
test('new namespaces work in generation while cross-game selections are rejected',()=>{
  const base={title:'Test',columns:3,rows:3,binder_type:'tracking',set_ids:['mtg:en:DEMO']};
  assert.deepEqual(generationInput(base).set_ids,['mtg:en:DEMO']);
  assert.throws(()=>generationInput({...base,set_ids:['en:base1','mtg:en:DEMO']}));
});
test('multi-game exports add a game discriminator; Pokémon-only CSV shape is preserved',()=>{
  const base={language:'en',card_id:'demo',printing:'normal',condition:'UNKNOWN',quantity:1,wishlist:false,notes:'notes'};
  const old=exportCSV([base]);assert.equal(old.startsWith('game,'),false);
  const text=exportCSV([{...base,game:'pokemon'},{...base,game:'mtg'}]);assert.equal(text.startsWith('game,'),true);
  const parsed=parseImport('csv',text);assert.equal(parsed.errors.length,0);assert.deepEqual(parsed.rows.map(r=>r.game),['pokemon','mtg']);
});
test('same provider identifier in two games does not become a duplicate import',()=>{
  const row={language:'en',card_id:'123',printing:'normal',condition:'NM',quantity:1,wishlist:false,notes:''};
  const run=entries=>parseImport('json',JSON.stringify({format:'cardshelf-collection',version:1,entries}));
  assert.equal(run([{...row,game:'pokemon'},{...row,game:'mtg'}]).errors.length,0);
  assert.equal(run([{...row,game:'mtg'},{...row,game:'mtg'}]).errors.length,1);
  assert.equal(run([{...row,game:'unknown'}]).rows.length,0);
});
