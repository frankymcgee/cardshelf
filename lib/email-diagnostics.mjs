/** Bounded, read-only DNS observations, never a delivery or RFC certification.
 * Sources: RFC 7208/6376/9989; docs.postalserver.io/features/sending-domains/.
 * Query names come only from the fixed sender domain and trusted configuration.
 */
import { Resolver } from 'node:dns/promises';
import { createPublicKey, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
export const EMAIL_DOMAIN='cardshelf.cloud';
export const EMAIL_DNS_NOTICE='These checks inspect DNS records and configured public keys only. They do not prove SPF authorization, DKIM signing, DMARC alignment, server TLS, IP reputation, or inbox delivery. Verify the exact records with your selected mail provider and inspect a real recipient message separately.';
const hostname=value=>typeof value==='string'&&value.length<=253&&value.split('.').length>=2&&value.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(x));
const finding=(status,detail)=>({status,detail});
function txtRecords(values){if(!Array.isArray(values)||values.length>40)throw Error('DNS result exceeds limits');return values.map(chunks=>{if(!Array.isArray(chunks)||chunks.length>64||chunks.some(c=>typeof c!=='string'))throw Error('DNS response malformed');const s=chunks.join('');if(s.length>8192)throw Error('DNS record too large');return s.trim();});}
function tags(value){const out={};for(const part of value.split(';')){if(!part.trim())continue;const match=part.trim().match(/^([a-z][a-z0-9_]*)\s*=\s*([^\r\n]*)$/i);if(!match||Object.hasOwn(out,match[1].toLowerCase()))throw Error('Invalid or duplicate tag');out[match[1].toLowerCase()]=match[2].trim();}return out;}
export function inspectSpf(values,{expectedInclude=null}={}){
  try{
    const records=txtRecords(values).filter(s=>/^v=spf1(?:\s|$)/i.test(s));
    if(!records.length)return finding('fail','No SPF record was found.');if(records.length!==1)return finding('fail','Multiple SPF records exist; publish a single SPF policy.');
    const terms=records[0].split(/\s+/).slice(1);if(!terms.length)return finding('fail','The SPF record has no policy mechanisms.');
    let all=null,lookups=0,hasInclude=false,unknown=false;const modifiers=new Set();
    for(let i=0;i<terms.length;i++){
      const original=terms[i],term=original.replace(/^[+?~-]/,'');let match;
      if(term==='all'){if(all!==null||i!==terms.length-1)return finding('warn','SPF contains repeated or non-final all; review the complete policy.');all=original.startsWith('-')?'-':original.startsWith('~')?'~':original.startsWith('?')?'?':'+';}
      else if((match=term.match(/^ip([46]):([^/]+)(?:\/(\d+))?$/))){const family=Number(match[1]);if(isIP(match[2])!==family||(match[3]!==undefined&&Number(match[3])>(family===4?32:128)))return finding('fail','An SPF IP mechanism is malformed.');}
      else if((match=term.match(/^(include|exists):(.+)$/))){if(!hostname(match[2])){unknown=true;continue;}lookups++;if(match[1]==='include'&&match[2].toLowerCase()===expectedInclude&&(!/^[?~-]/.test(original)))hasInclude=true;}
      else if(/^(?:a|mx|ptr)(?::[a-z0-9.-]+)?$/i.test(term)){const value=term.split(':')[1];if(value&&!hostname(value))return finding('fail','An SPF hostname is malformed.');lookups++;if(term.startsWith('ptr'))unknown=true;}
      else if((match=term.match(/^([a-z][a-z0-9_.-]*)=(.+)$/i))){if(modifiers.has(match[1]))return finding('fail','An SPF modifier is repeated.');modifiers.add(match[1]);if(!hostname(match[2]))unknown=true;if(match[1]==='redirect')lookups++;else if(match[1]!=='exp')unknown=true;}
      else unknown=true;
    }
    if(lookups>10)return finding('fail','SPF already exceeds ten DNS lookup mechanisms before nested includes.');
    if(all==='+')return finding('fail','SPF +all permits arbitrary senders; review this policy.');
    if(unknown)return finding('unknown','SPF contains advanced or unrecognized syntax; review it with your mail provider or a full SPF evaluator.');
    if(expectedInclude&&!hasInclude)return finding('warn','An SPF record exists but the expected Postal include is missing. Merge it into the existing policy if appropriate.');
    if(all===null||all==='?')return finding('warn','SPF has no restrictive final all mechanism; review the intended policy.');
    return finding('pass','One SPF record has recognized basic syntax'+(expectedInclude?' and the configured Postal include.':'.')+' Nested lookups and sender authorization were not evaluated.');
  }catch{return finding('unknown','The SPF DNS response could not be safely inspected.');}
}
function rsaKey(value){
  const t=tags(value);if(t.v!=='DKIM1'||t.k&&t.k.toLowerCase()!=='rsa'||!t.p)throw Error('Unsupported or revoked DKIM key');
  const p=t.p.replace(/\s+/g,'');if(!/^[A-Za-z0-9+/]+={0,2}$/.test(p))throw Error('Malformed public key');const der=Buffer.from(p,'base64');if(der.toString('base64')!==p)throw Error('Malformed public key');
  const key=createPublicKey({key:der,format:'der',type:'spki'});if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<1024||key.asymmetricKeyDetails.modulusLength>8192)throw Error('Unsupported public key');
  return {der:key.export({format:'der',type:'spki'}),bits:key.asymmetricKeyDetails.modulusLength};
}
export function inspectDkim(values,{expected=''}={}){
  try{
    const records=txtRecords(values);if(!records.length)return finding('fail','No DKIM TXT record exists at the configured selector.');if(records.length!==1)return finding('fail','Multiple TXT records exist at the DKIM selector.');
    let actual;try{actual=rsaKey(records[0]);}catch{return finding('fail','DKIM does not contain a usable RSA public key and valid DKIM1 tags.');}
    if(expected){let configured;try{configured=rsaKey(expected);}catch{return finding('fail','The configured expected DKIM record is invalid.');}
      if(actual.der.length!==configured.der.length||!timingSafeEqual(actual.der,configured.der))return finding('fail','The published DKIM public key differs from the configured expected key.');
      // Postal validates the entire TXT value, not only p=. Make this distinction
      // explicit because altered h=/t= tags can keep Postal from using the key.
      const a=tags(records[0]),b=tags(expected);if(JSON.stringify(Object.entries(a).sort())!==JSON.stringify(Object.entries(b).sort()))return finding('warn','The DKIM key matches, but TXT tags differ from the configured provider record.');
    }
    if(actual.bits<2048)return finding('warn','The DKIM RSA public key parses but is only '+actual.bits+' bits. Prefer a 2048-bit key and update the mail provider plus DNS together.');
    return finding(expected?'pass':'warn',`A ${actual.bits}-bit RSA public key parses${expected?' and matches the configured provider record.':'; configure the expected provider record to compare it.'} This does not prove outgoing messages are signed.`);
  }catch{return finding('unknown','The DKIM DNS response could not be safely inspected.');}
}
export function inspectDmarc(values){
  try{
    const records=txtRecords(values).filter(s=>/^v=DMARC1(?:\s*;|$)/i.test(s));if(!records.length)return finding('fail','No DMARC policy was found.');if(records.length!==1)return finding('fail','Multiple DMARC policies exist.');
    let t;try{t=tags(records[0]);}catch{return finding('fail','DMARC tags are malformed or repeated.');}
    if(t.v!=='DMARC1'||t.p!==undefined&&!['none','quarantine','reject'].includes(t.p)||t.sp!==undefined&&!['none','quarantine','reject'].includes(t.sp)||t.np!==undefined&&!['none','quarantine','reject'].includes(t.np)||t.adkim!==undefined&&!['r','s'].includes(t.adkim)||t.aspf!==undefined&&!['r','s'].includes(t.aspf)||t.psd!==undefined&&!['y','n','u'].includes(t.psd)||t.t!==undefined&&!['y','n'].includes(t.t))return finding('fail','DMARC policy or alignment tags are invalid.');
    if(Object.keys(t).some(k=>!['v','p','sp','np','psd','t','adkim','aspf','rua','ruf','fo','pct','rf','ri'].includes(k)))return finding('unknown','DMARC includes additional tags; only its basic policy was inspected.');
    if(['pct','rf','ri'].some(k=>Object.hasOwn(t,k)))return finding('warn','DMARC contains tags retired by RFC 9989. Their legacy behavior is not an enforcement guarantee; review this policy.');
    if(t.p===undefined||t.p==='none'||t.t==='y')return finding('warn','DMARC requests monitoring or policy testing. Actual recipient treatment and message alignment were not tested.');
    return finding('pass','A DMARC '+t.p+' policy with recognized basic tags is published. Reporting destinations and actual message alignment were not tested.');
  }catch{return finding('unknown','The DMARC DNS response could not be safely inspected.');}
}
async function lookup(resolver,method,name){try{return {values:await resolver[method](name)}}catch(error){return ['ENODATA','ENOTFOUND'].includes(error?.code)?{values:[]}:{error:true};}}
export async function emailDnsDiagnostics(config,{resolver=new Resolver({timeout:2000,tries:1}),now=Date.now()}={}){
  const checks=[],add=(id,label,name,result)=>checks.push({id,label,hostname:name,...result});
  let host=null;if(config.provider!=='smtp')try{const origin=new URL(config.origin);if(origin.protocol==='https:'&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash&&hostname(origin.hostname))host=origin.hostname.toLowerCase();}catch{}
  const selector=typeof config.dkim_selector==='string'&&/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(config.dkim_selector)?config.dkim_selector:null;
  const dkimHost=selector?selector+'._domainkey.'+EMAIL_DOMAIN:null,includeHost=host?'spf.'+host:null;
  // Each input name is fixed or appended to a trusted deployment hostname;
  // user DNS result data is never followed as a URL or query target.
  const jobs=[['spf','resolveTxt',EMAIL_DOMAIN],['dmarc','resolveTxt','_dmarc.'+EMAIL_DOMAIN]];
  if(dkimHost)jobs.push(['dkim','resolveTxt',dkimHost]);
  if(host)jobs.push(['postal4','resolve4',host],['postal6','resolve6',host],['include','resolveTxt',includeHost],['returnpath','resolveCname','psrp.'+EMAIL_DOMAIN]);
  const found=Object.fromEntries(await Promise.all(jobs.map(async([id,method,name])=>[id,await lookup(resolver,method,name)])));
  const observed=(entry,inspect)=>entry.error?finding('unknown','DNS lookup failed or timed out; try again later.'):inspect(entry.values);
  add('spf','Sender SPF',EMAIL_DOMAIN,observed(found.spf,v=>inspectSpf(v,{expectedInclude:includeHost})));
  add('dmarc','DMARC','_dmarc.'+EMAIL_DOMAIN,observed(found.dmarc,inspectDmarc));
  add('dkim','DKIM',dkimHost||'Not configured',dkimHost?observed(found.dkim,v=>inspectDkim(v,{expected:config.dkim_public_key||''})):finding('warn','Copy the exact DKIM selector and TXT record from your mail provider.'));
  if(host){
    const addresses=[...(found.postal4.values||[]),...(found.postal6.values||[])].filter(x=>typeof x==='string'&&isIP(x));
    add('postal_host','Postal hostname',host,addresses.length?finding('pass','The Postal hostname resolves to an IP address. API connectivity, ownership and TLS were not tested.'):(found.postal4.error||found.postal6.error?finding('unknown','Postal hostname lookup failed or timed out.'):finding('fail','No A or AAAA address was found for the Postal hostname.')));
    add('postal_spf','Postal SPF include',includeHost,observed(found.include,v=>inspectSpf(v)));
    add('return_path','Custom return path','psrp.'+EMAIL_DOMAIN,observed(found.returnpath,v=>v.length===1&&String(v[0]).replace(/\.$/,'').toLowerCase()==='rp.'+host?finding('pass','The custom return path points to the configured Postal return-path hostname.'):finding('warn','Expected a single CNAME to rp.'+host+'. Copy the exact return-path instructions from Postal.')));
  }else if(config.provider!=='smtp')add('postal_host','Postal hostname','Not configured',finding('warn','Configure the trusted Postal HTTPS origin before checking its DNS.'));
  return {domain:EMAIL_DOMAIN,checked_at:new Date(now).toISOString(),checks,notice:EMAIL_DNS_NOTICE};
}
