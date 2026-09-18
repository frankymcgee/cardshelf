import { ensure } from './errors.mjs';
import * as v from './validate.mjs';
export const FREE_PLACEMENTS = Object.freeze(['overview','catalogue']);
export function sponsorUrl(value) {
  const text=v.text(value,'Sponsor destination',0,2000);
  if(!text) return '';
  let url;try{url=new URL(text);}catch{ensure(false,400,'Use a full HTTPS sponsor URL.');}
  ensure(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
    !/^(localhost|127\.|0\.|169\.254\.|10\.|192\.168\.|\[)/i.test(url.hostname)&&
    !/\.(?:local|internal)$/i.test(url.hostname)&&url.hostname.includes('.'),400,'Use a public HTTPS sponsor URL without credentials or a custom port.');
  return url.href;
}
export function freeSettingsInput(input) {
  const o=v.object(input);
  ensure(Object.keys(o).every(key=>['registration_enabled','ads_enabled','sponsor_name','sponsor_text','sponsor_url','sponsor_cta','sponsor_image_alt','remove_image','password','revision','reason','confirm_sponsor'].includes(key)),400,'Unsupported Free settings field.');
  const result={registration_enabled:v.bool(o.registration_enabled,'Free registration'),ads_enabled:v.bool(o.ads_enabled,'Sponsored placements'),
    sponsor_name:v.text(o.sponsor_name??'','Sponsor name',0,100),sponsor_text:v.text(o.sponsor_text??'','Sponsor message',0,400),
    sponsor_url:sponsorUrl(o.sponsor_url??''),sponsor_cta:v.text(o.sponsor_cta??'Learn more','Button text',1,40),
    sponsor_image_alt:v.text(o.sponsor_image_alt??'','Image description',0,200),
    remove_image:v.bool(o.remove_image??false,'Remove image'),revision:v.integer(o.revision,'Revision',0,Number.MAX_SAFE_INTEGER),
    reason:v.text(o.reason,'Reason',5,500)};
  if(result.ads_enabled) ensure(result.sponsor_name&&result.sponsor_text&&result.sponsor_url&&o.confirm_sponsor===true,400,
    'Review the sponsor, destination and message and confirm permission to publish this advertisement.');
  ensure(typeof o.password==='string'&&o.password.length>=1&&o.password.length<=128,400,'Confirm your administrator password.');
  return {...result,password:o.password};
}
export function sponsorEligible({user,access,grant,pendingBilling=false,enabled=false}={}) {
  return enabled===true && user?.role==='user' && access?.tier==='free' && access?.reason==='free_account' &&
    access?.allowed===true && !grant && !pendingBilling;
}
export function publicSponsor(row) {
  return {sponsor:row.sponsor_name,text:row.sponsor_text,url:row.sponsor_url,cta:row.sponsor_cta,
    image_alt:row.sponsor_image_alt,image:row.has_image?'/api/ads/image?revision='+row.revision:null,revision:row.revision};
}
