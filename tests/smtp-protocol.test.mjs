// Real Nodemailer and local SMTP/TLS sockets. The factory routes only these
// tests to localhost; production DNS/address/TLS guards are never relaxed.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import nodemailer from 'nodemailer';
import { smtpSend, smtpVerify } from '../lib/smtp-client.mjs';

const config={provider:'smtp',enabled:true,configured:true,smtp_preset:'custom',smtp_host:'smtp.example.com',smtp_port:587,smtp_security:'starttls',smtp_user:'synthetic-user',smtp_password:'synthetic-password',smtp_rate_limit:10,sender_name:'CardShelf',from_address:'noreply@cardshelf.cloud',reply_to:''};
const messageId='<cardshelf.outbox.01234567-89ab-4cde-8fab-0123456789ab@cardshelf.cloud>';
async function fixture({implicit=false,starttls=true,rejectAuth=false,dropAfterData=false,trust=true}={},run){
  const dir=mkdtempSync(join(tmpdir(),'cardshelf-smtp-tls-'));
  try{
    execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','2','-subj','/CN=smtp.example.com','-addext','subjectAltName=DNS:smtp.example.com','-addext','basicConstraints=critical,CA:TRUE'],{stdio:'ignore'});
    const key=readFileSync(join(dir,'key.pem')),cert=readFileSync(join(dir,'cert.pem')),context=tls.createSecureContext({key,cert});
    const sockets=new Set(),record={auth:[],mail:[],recipients:[],messages:[],plainAuth:0};
    function session(socket,secure=false,greeting=true){
      sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
      if(greeting)socket.write('220 smtp.example.com synthetic fixture\r\n');
      let buffer='',data=null;
      socket.on('data',chunk=>{
        buffer+=chunk.toString('utf8');
        while(buffer.includes('\r\n')){
          const at=buffer.indexOf('\r\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+2);
          if(data!==null){
            if(line!=='.'){data.push(line);continue;}
            record.messages.push(data.join('\r\n'));data=null;
            if(dropAfterData){socket.destroy();return;}
            socket.write('250 2.0.0 accepted synthetic message\r\n');continue;
          }
          if(/^EHLO /i.test(line)){socket.write('250-smtp.example.com\r\n'+(!secure&&starttls?'250-STARTTLS\r\n':'')+'250 AUTH PLAIN\r\n');continue;}
          if(line==='STARTTLS'){
            if(!starttls){socket.write('454 4.7.0 TLS unavailable\r\n');continue;}
            socket.write('220 2.0.0 ready for TLS\r\n');socket.removeAllListeners('data');
            const upgraded=new tls.TLSSocket(socket,{isServer:true,secureContext:context});session(upgraded,true,false);return;
          }
          if(/^AUTH PLAIN /i.test(line)){
            if(!secure)record.plainAuth++;
            record.auth.push(Buffer.from(line.slice(11),'base64').toString('utf8'));
            socket.write(rejectAuth?'535 5.7.8 invalid credentials\r\n':'235 2.7.0 authenticated\r\n');continue;
          }
          if(/^MAIL FROM:/i.test(line)){record.mail.push(line);socket.write('250 2.1.0 sender accepted\r\n');continue;}
          if(/^RCPT TO:/i.test(line)){record.recipients.push(line);socket.write('250 2.1.5 recipient accepted\r\n');continue;}
          if(line==='DATA'){data=[];socket.write('354 send message\r\n');continue;}
          if(line==='QUIT'){socket.end('221 goodbye\r\n');continue;}
          if(line==='RSET'){socket.write('250 reset\r\n');continue;}
          socket.write('500 unsupported fixture command\r\n');
        }
      });
    }
    const server=implicit?tls.createServer({key,cert},socket=>session(socket,true)):net.createServer(socket=>session(socket));
    server.on('tlsClientError',()=>{});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const options={env:{APP_ORIGIN:'https://cardshelf.cloud'},resolver:{resolve4:async()=>['93.184.216.34'],resolve6:async()=>[]},createTransport:original=>{
      assert.equal(original.host,'93.184.216.34');assert.equal(original.tls.rejectUnauthorized,true);
      return nodemailer.createTransport({...original,tls:{...original.tls,...(trust?{ca:cert}:{})},getSocket(_options,callback){
        const socket=net.connect({host:'127.0.0.1',port:server.address().port});sockets.add(socket);let returned=false;
        socket.once('error',error=>{if(!returned){returned=true;callback(error);}});
        socket.once('connect',()=>{returned=true;callback(null,{connection:socket});});
      }});
    }};
    try{await run({options,record,config:implicit?{...config,smtp_port:465,smtp_security:'tls'}:config});}
    finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test('real SMTP STARTTLS and implicit TLS verify login without MAIL, RCPT or DATA',async()=>{
  for(const implicit of [false,true])await fixture({implicit},async({options,record,config})=>{
    assert.deepEqual(await smtpVerify(config,options),{verified:true});assert.deepEqual(record.auth,['\0synthetic-user\0synthetic-password']);assert.equal(record.plainAuth,0);
    assert.equal(record.mail.length,0);assert.equal(record.recipients.length,0);assert.equal(record.messages.length,0);
  });
});
test('real SMTP requires a verified certificate and hostname before sending credentials',async()=>{
  for(const trust of [false,true])await fixture({trust},async({options,record,config})=>{
    await assert.rejects(smtpVerify(trust?{...config,smtp_host:'different.example.com'}:config,options));
    assert.equal(record.auth.length,0);assert.equal(record.messages.length,0);
  });
});
test('real SMTP refuses missing STARTTLS and incorrect authentication without sending a message',async()=>{
  for(const settings of [{starttls:false},{rejectAuth:true}])await fixture(settings,async({options,record,config})=>{
    await assert.rejects(smtpSend(config,'member@example.com',{subject:'Synthetic test',text:'No real recipient'},{...options,messageId}),error=>error.emailDelivery==='rejected');
    assert.equal(record.plainAuth,0);assert.equal(record.messages.length,0);assert.equal(record.mail.length,0);
    if(settings.starttls===false)assert.equal(record.auth.length,0);
  });
});
test('real SMTP records one accepted message with the stable ID and retains uncertainty after lost DATA acknowledgment',async()=>{
  for(const dropAfterData of [false,true])await fixture({dropAfterData},async({options,record,config})=>{
    const send=smtpSend(config,'member@example.com',{subject:'Synthetic test',text:'Synthetic message only'},{...options,messageId});
    if(dropAfterData)await assert.rejects(send,error=>error.emailDelivery==='uncertain');
    else assert.deepEqual(await send,{provider:'smtp',provider_id:null,message_id:messageId});
    assert.equal(record.messages.length,1);assert.equal(record.recipients.length,1);assert.ok(record.messages[0].replace(/\r\n[ \t]+/g,' ').includes('Message-ID: '+messageId));assert.equal(record.plainAuth,0);
  });
});
