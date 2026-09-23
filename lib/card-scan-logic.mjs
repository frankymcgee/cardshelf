import { createHash } from 'node:crypto';
import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
import { SCAN_DEFAULTS,SCAN_REASONING_EFFORTS,SCAN_REASONING_MODES } from '../shared/card-scanning.mjs';
export const SCAN_SETTINGS_LOCK = 72492020;
export const SCAN_OUTPUT_LIMIT = 768;
// Default reservation for one bounded image and the administrator's extraction prompt.
export const SCAN_INPUT_CEILING = 16384;
export const SCAN_MAX_BYTES = 4_000_000;
export function scanObject(value,keys) {
  const o=v.object(value);ensure(Object.keys(o).every(k=>keys.includes(k)),400,'Unsupported scanning field.');return o;
}
export function scanHash(value) {return createHash('sha256').update(value).digest('hex');}
export function scanCost(input,output,rates) {
  ensure(Number.isSafeInteger(input)&&input>=0&&Number.isSafeInteger(output)&&output>=0,502,'Recognition usage was invalid.');
  return Math.ceil((input*Number(rates.input_price_micros)+output*Number(rates.output_price_micros))/1000000);
}
export function scanReservation(settings) {return scanCost(settings.input_token_ceiling??SCAN_INPUT_CEILING,settings.max_output_tokens??SCAN_OUTPUT_LIMIT,settings);}
export function scanGenerationSettings(input={},defaults=SCAN_DEFAULTS) {
  const o={...defaults,...input},model=v.text(o.model,'Model name',1,200);
  ensure(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(model),400,'Enter a model ID, not a URL or display name.');
  return {model,reasoning_effort:v.oneOf(o.reasoning_effort,'Reasoning effort',[null,...SCAN_REASONING_EFFORTS]),
    reasoning_mode:v.oneOf(o.reasoning_mode,'Reasoning mode',[null,...SCAN_REASONING_MODES]),
    max_output_tokens:v.integer(o.max_output_tokens,'Maximum output tokens',256,32768),
    input_token_ceiling:v.integer(o.input_token_ceiling,'Input token reservation',16384,131072),
    request_timeout_seconds:v.integer(o.request_timeout_seconds,'Request timeout',15,180),
    image_detail:v.oneOf(o.image_detail,'Image detail',['auto','low','high']),prompt:v.text(o.prompt,'Recognition prompt',1,8000)};
}
export function scanUpload(input) {
  const o=scanObject(input,['request_id','image','confirm_external_processing']);
  ensure(o.confirm_external_processing===true,400,'Confirm sending this card photo to OpenAI for recognition.');
  const id=v.uuid(o.request_id,'Scan request');
  ensure(typeof o.image==='string'&&o.image.length<=Math.ceil(SCAN_MAX_BYTES/3)*4+80,413,'Photo is too large. Use a smaller photo.');
  const match=o.image.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  ensure(match&&match[2].length%4===0,400,'Choose a JPEG, PNG or WebP photo.');
  const bytes=Buffer.from(match[2],'base64');
  ensure(bytes.length>0&&bytes.length<=SCAN_MAX_BYTES&&bytes.toString('base64')===match[2],400,'The image encoding is invalid.');
  return {id,bytes,hash:scanHash(bytes)};
}
export function scanConfirmation(input) {
  const o=scanObject(input,['printing_id','condition','quantity','entry_revision','binder','confirm']);
  ensure(o.confirm===true,400,'Confirm the catalogue card, printing and quantity before adding it.');
  let binder=null;
  if(o.binder){
    const b=scanObject(o.binder,['id','revision','position','mode']);
    const mode=v.oneOf(b.mode??'manual','Pocket selection',['auto','manual']);
    binder={id:v.uuid(b.id,'Binder'),revision:v.integer(b.revision,'Binder revision',1,2147483647)};
    if(mode==='auto'){ensure(b.position===undefined,400,'Automatic placement chooses the pocket.');binder.mode='auto';}
    // Keep the original manual fingerprint so receipts saved by older releases
    // remain idempotent after this upgrade.
    else binder.position=v.integer(b.position,'Pocket',0,959);
  }
  return {printing_id:v.uuid(o.printing_id,'Printing'),condition:v.oneOf(o.condition,'Condition',v.CONDITIONS),
    quantity:v.integer(o.quantity,'Copies to add',1,99),entry_revision:v.integer(o.entry_revision,'Ownership revision',0,2147483647),binder};
}
export function scanObservation(value) {
  const o=scanObject(value,['card_count','readable','card_name','collector_number','printed_total','set_code','set_name','language']);
  const text=key=>o[key]===null?null:v.text(o[key],key,0,160)||null;
  return {card_count:v.integer(o.card_count,'Card count',0,10),readable:v.bool(o.readable,'Readable'),
    card_name:text('card_name'),collector_number:text('collector_number'),printed_total:text('printed_total'),
    set_code:text('set_code'),set_name:text('set_name'),language:v.oneOf(o.language,'Detected language',['en','ja','unknown'])};
}
export function scanText(value) {return String(value??'').normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}+]/gu,'');}
export function scanNumber(value) {
  return scanText(String(value??'').split('/')[0]).replace(/^0+(?=\d)/,'');
}
export function rankScanCandidates(observation,cards) {
  if(!observation.readable||observation.card_count!==1)return [];
  const number=scanNumber(observation.collector_number),name=scanText(observation.card_name),setCode=scanText(observation.set_code),setName=scanText(observation.set_name);
  return cards.filter(c=>c.game==='pokemon'&&['en','ja'].includes(c.language)&&
    (observation.language==='unknown'||c.language===observation.language)).map(card=>{
    const evidence=[];
    if(number&&scanNumber(card.local_id)===number)evidence.push('Card number');
    if(name&&scanText(card.name)===name)evidence.push('Name');
    if((setCode&&scanText(card.set_provider_id)===setCode)||(setName&&scanText(card.set_name)===setName))evidence.push('Set');
    return {...card,match_evidence:evidence,match_strength:evidence.length>=2?'Multiple details match':'Needs close review',score:evidence.length};
  }).filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,6).map(({score,...card})=>card);
}
