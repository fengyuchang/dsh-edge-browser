import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import {finishBrowserTask,registerTaskCleanupRoutes} from './harness/dsh-task-finish.mjs';
const extensionId='a'.repeat(32),routes=new Map(),owners=new Map([['owned','request-owned']]);
const pages=new Map([[11,{}],[12,{}],[13,{}],[14,{}],[16,{earlierResult:true}],[99,{foreign:true}]]);
const session={sessionId:'owned',agentWindowId:4,agentCreatedTabs:new Set([11,12]),observedTabs:new Set([14]),borrowedTabs:new Map()};
const manager=new Map([['owned',session]]),headers={'content-type':'application/json','x-dsh-browser-extension':extensionId,origin:'chrome-extension://'+extensionId};
let lastTicket,validatedBoundaries=false;
const server=http.createServer((req,res)=>{const route=routes.get(req.url);if(route)void route(req,res);else{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const post=(body,extra={})=>fetch(base+'/bsk-observation/task-cleanup',{method:'POST',headers:{...headers,...extra},body:JSON.stringify({sessionId:'owned',...body})});
const deps={registry:{resolveForStop:id=>id,requestFor:id=>owners.get(id),markForCleanup(){}},config:{defaultTimeoutMs:1000},queue:{run:async(_id,fn)=>fn()},
runner:{run:async words=>words[0]==='debug'?{capabilities:{extension:{runtime_id:extensionId,features:{dsh_cleanup_receipt:1}}}}:words[1]==='list'?{tabs:[11,12,13,14,15,16].map(tab_id=>({tab_id}))}:{tab_id:Number(words[2])}},
starts:{stop:async()=>{
  assert.equal((await post({action:'begin'},{origin:'https://untrusted.example'})).status,403);
  assert.equal((await post({action:'begin'},{'x-dsh-browser-extension':'b'.repeat(32),origin:'chrome-extension://'+'b'.repeat(32)})).status,409);
  lastTicket=await(await post({action:'begin'})).json();assert(lastTicket.token);
  const invalid={action:'complete',token:lastTicket.token,requestId:lastTicket.requestId,controlReleased:true,windowState:'retained',entries:[11,12,13,14,15,99].map(tabId=>({tabId,state:'closed',reason:'tab_absent'}))};
  assert.equal((await post(invalid)).status,400,'Foreign tab IDs cannot become receipt evidence');
  assert.equal((await post({...invalid,entries:[11,12,13,14,15,15].map(tabId=>({tabId,state:'closed',reason:'tab_absent'}))})).status,400,'Duplicate outcomes cannot hide a missing page');
  assert.equal((await post({...invalid,entries:[],token:'forged'})).status,400);
  owners.set('owned','another-request');assert.equal((await post({action:'begin'})).status,409);owners.set('owned','request-owned');validatedBoundaries=true;
  await sandbox.api.dshWithCleanupReceipt(manager,{session_id:'owned'},async()=>{pages.delete(11);session.agentCreatedTabs.delete(12);session.observedTabs.add(12);manager.delete('owned');owners.delete('owned');return{}});
  return{stopped:'owned'};
}}};
const sandbox=vm.createContext({fetch,AbortSignal,setTimeout,clearTimeout,console,__DSH_HARNESS_URL__:base,chrome:{runtime:{id:extensionId},tabs:{get:async id=>{if(id===15)throw Error('query unavailable');if(!pages.has(id))throw Error('No tab with id: '+id);return{id}}},windows:{get:async()=>({id:4})}}});
const classic=fs.readFileSync(new URL('./source/extension/dsh-task-finish.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*\};?\s*$/m,'');
vm.runInContext(classic+'\nglobalThis.api={dshWithCleanupReceipt};',sandbox);
const dispose=registerTaskCleanupRoutes({get:()=>({register:({path,handler})=>{routes.set(path,handler);return()=>routes.delete(path)}})},deps);
try{
 for(const remoteAddress of ['192.0.2.1',undefined]){
   let status,read=false;
   await routes.get('/bsk-observation/task-cleanup')({method:'POST',headers:{...headers,host:'127.0.0.1:3080'},socket:{remoteAddress},async *[Symbol.asyncIterator](){read=true;yield '{}'}},{writeHead:value=>{status=value},end(){}});
   assert.equal(status,403,'Cleanup evidence requires an actual loopback peer');assert.equal(read,false,'Untrusted peers are rejected before reading data');
 }
 assert.equal((await post({action:'begin'})).status,409,'Only an armed native finish can receive a challenge');
 const result=await finishBrowserTask(deps,{session:'owned',keepTabIds:[13]},{signal:new AbortController().signal},value=>value);
 assert(validatedBoundaries);assert(result.cleanup.confirmed);assert.deepEqual(result.closedTabIds,[11]);assert.deepEqual(result.retainedTabIds,[12,13,14,16]);assert.deepEqual(result.unknownTabIds,[15]);
 assert.equal(result.cleanup.entries.find(row=>row.tabId===12).reason,'form_or_uncertain_content');assert.equal(result.cleanup.entries.find(row=>row.tabId===13).reason,'requested');assert.equal(result.cleanup.entries.find(row=>row.tabId===14).reason,'human_or_user');
 assert.equal(result.cleanup.entries.find(row=>row.tabId===16).reason,'previous_result_or_user');assert(pages.get(16).earlierResult);
 assert(pages.get(99).foreign);assert.equal(result.cleanup.windowState,'retained');assert.equal((await post({action:'begin'})).status,409,'Receipt slots must expire after finish');
 owners.set('owned','request-owned');manager.set('owned',session);session.agentCreatedTabs=new Set([11,12]);pages.set(11,{});
 deps.starts.stop=async()=>sandbox.api.dshWithCleanupReceipt(manager,{session_id:'owned'},async()=>{throw Error('durable stop failed')});
 await assert.rejects(finishBrowserTask(deps,{session:'owned',keepTabIds:[]},{signal:new AbortController().signal},value=>value),error=>{
   assert.match(error.message,/^durable stop failed/);assert.match(error.message,/Browser cleanup evidence/);assert.equal(error.browserCleanup.confirmed,true);
   assert(error.browserCleanup.entries.some(row=>row.tabId===11&&row.state==='failed'));assert.equal(error.browserCleanup.controlReleased,false);return true;
 });
 assert(manager.has('owned'),'Failed cleanup must not pretend control was released');
 await assert.rejects(sandbox.api.dshWithCleanupReceipt(new Map([['owned',session]]),{session_id:'owned'},async()=>{throw Error('actual stop failure')}),/actual stop failure/);
 console.log('PASS: real HTTP cleanup receipts bind extension, native request, challenge and task IDs; actual closure/protection/unknown states stay distinct and evidence cannot mask stop errors');
}finally{dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
