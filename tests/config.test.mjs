import test from 'node:test';
import assert from 'node:assert/strict';
import {configuration} from '../lib/config.mjs';
process.env.DATABASE_URL='postgresql://localhost/cardshelf_test';
test('secure cookies follow the configured origin, not user-controlled headers',()=>{
  process.env.APP_ORIGIN='https://cards.example.com';assert.equal(configuration().secureCookies,true);
  process.env.APP_ORIGIN='http://localhost:3000';assert.equal(configuration().secureCookies,false);
});
test('origins cannot contain credentials or application paths',()=>{
  for(const origin of ['https://user:pass@example.com','https://example.com/path','https://example.com?x=y','file:///tmp']) {
    process.env.APP_ORIGIN=origin;assert.throws(()=>configuration());
  }
  process.env.APP_ORIGIN='http://localhost:3000';
});
test('provider request interval is bounded',()=>{
  process.env.CATALOGUE_REQUEST_INTERVAL_MS='1';assert.equal(configuration().requestInterval,100);
  process.env.CATALOGUE_REQUEST_INTERVAL_MS='100000';assert.equal(configuration().requestInterval,10000);
});
