import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPreviewTransport} from './harness/dsh-preview.mjs';

const socket=process.platform==='win32'?'\\\\.\\pipe\\bsk-daemon-preview-test-'+randomUUID():path.join(os.tmpdir(),'bsk-preview-'+randomUUID()+'.sock');
const pending=new Map(),requests=[];
const server=net.createServer(peer=>{
  peer.setEncoding('utf8');let input='';
  peer.on('data',text=>{input+=text;const end=input.indexOf('\n');if(end<0)return;const frame=JSON.parse(input.slice(0,end));requests.push(frame);
    const reply=value=>peer.end(JSON.stringify({id:frame.id,result:value})+'\n');
    if(frame.method==='cancel'){const waiting=pending.get(frame.params.rpc_id);reply({cancelled:!!waiting});waiting?.();pending.delete(frame.params.rpc_id);return;}
    if(frame.params.session_id==='wait'){pending.set(frame.id,()=>peer.end(JSON.stringify({id:frame.id,error:{code:'cancelled',message:'cancelled'}})+'\n'));return;}
    reply({dsh_preview:frame.params.session_id!=='bad',image_base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',format:'png',tab_id:7,width:1,height:1});
  });
});
await new Promise(resolve=>server.listen(socket,resolve));
const preview=createPreviewTransport(async()=>({protocol_version:'1.8',sock_path:socket}));
try{
  const image=await preview.capture('owned',{tag:'observation:owned'});assert.equal(image.code,0);assert.equal(JSON.parse(image.stdout).dsh_preview,true);
  assert.equal((await preview.capture('bad')).code,3,'A model-style screenshot must not be mistaken for a human preview');
  const controller=new AbortController();controller.abort();const before=requests.length;
  assert((await preview.capture('owned',{signal:controller.signal})).aborted);assert.equal(requests.length,before,'Cancelled work must not reach the daemon');
  const waiting=preview.capture('wait',{tag:'observation:wait'});
  for(let i=0;i<50&&!pending.size;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert(pending.size);assert.equal(preview.killFor('another-session'),0);assert.equal(preview.killFor('observation:wait'),1);
  assert((await waiting).aborted);assert.equal(pending.size,0,'Cancellation must reach the original RPC and settle before releasing the lane');
  const old=createPreviewTransport(async()=>({protocol_version:'1.3',sock_path:socket}));assert.equal((await old.capture('owned')).code,3);
  assert(requests.filter(r=>r.method==='tool.screenshot').every(r=>r.params.dsh_preview===true));
  console.log('PASS: explicit human preview, local protocol compatibility, response validation, pre-dispatch abort, per-session cancellation and cleanup');
}finally{preview.dispose();await new Promise(resolve=>server.close(resolve));}
