// Validate a .env file without importing it into a shell or executing its content.
import { readFile } from 'node:fs/promises';
const text=await readFile(new URL('../.env',import.meta.url),'utf8');
const pairs=Object.fromEntries(text.split(/\r?\n/).filter(l=>l && !l.startsWith('#')).map(line=> {
  const at=line.indexOf('=');if(at<1) throw new Error('Invalid .env line.');return [line.slice(0,at),line.slice(at+1)];
}));
const origin=new URL(pairs.APP_ORIGIN);
if(origin.pathname!=='/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('APP_ORIGIN must not have a path, query or credentials.');
if(!['http:','https:'].includes(origin.protocol)) throw new Error('Use HTTP or HTTPS.');
for(const name of ['POSTGRES_PASSWORD','BOOTSTRAP_TOKEN']) if(!/^[0-9a-f]{64}$/.test(pairs[name]||'')) throw new Error(`${name} must be 64 random hexadecimal characters.`);
if(pairs.APP_BIND!=='127.0.0.1') console.warn('Warning: the app port is exposed beyond loopback. Prefer the HTTPS proxy.');
if(origin.protocol==='https:' && origin.hostname!==pairs.APP_DOMAIN) throw new Error('APP_DOMAIN and APP_ORIGIN disagree.');
console.log('Configuration format and secret lengths are valid.');
