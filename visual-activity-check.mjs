import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('./source/extension/dsh-visual-activity.js',import.meta.url),'utf8').replace(/^export \{.*\};?\s*$/m,'');
const messages=[],held=[];
const sandbox=vm.createContext({setTimeout,clearTimeout,console,chrome:{tabs:{
 get:async id=>({id,windowId:4}),sendMessage:async(_id,message)=>{messages.push(message);await new Promise(resolve=>held.push(resolve));return{dshVisual:true}},
},scripting:{executeScript:async()=>[]}}});
vm.runInContext(source+'\nglobalThis.api={dshVisualOperation,dshVisualStates,visualQueues};',sandbox);
const {api}=sandbox,dispatcher={sessions:new Map([['owned',{agentWindowId:4}]])};
let calls=0;
const request=id=>({id,method:'tool.click',params:{session_id:'owned',tab_id:7}});
const first=api.dshVisualOperation(dispatcher,request('first'),async()=>{calls++;return{ok:true}});
assert.deepEqual(await first,{ok:true});assert.equal(calls,1,'Action must finish while UI acknowledgement is blocked');
assert.equal(messages.length,1);assert.equal(messages[0].phase,'running');
await api.dshVisualOperation(dispatcher,request('second'),async()=>{calls++;return{ok:true}});
assert.equal(calls,2);assert.equal(messages.length,1,'Messages must remain ordered, with one pending latest state');
held.shift()();await new Promise(resolve=>setImmediate(resolve));
assert.equal(messages.length,2);assert.equal(messages[1].id,'second');assert.equal(messages[1].phase,'complete');
held.shift()();await new Promise(resolve=>setImmediate(resolve));assert.equal(api.visualQueues.size,0);
await assert.rejects(api.dshVisualOperation(dispatcher,request('error'),async()=>{throw Error('original action failure')}),/original action failure/);
api.dshVisualStates.delete(7);held.shift()();await new Promise(resolve=>setImmediate(resolve));
assert.equal(messages.length,3,'Cleanup must suppress a queued stale state');assert.equal(api.visualQueues.size,0);
const before=messages.length;await api.dshVisualOperation({sessions:new Map()},request('foreign'),async()=>({ok:true}));assert.equal(messages.length,before);
console.log('PASS: delayed visual acknowledgement never blocks input; pending updates coalesce, remain ordered, preserve errors and expire at cleanup');
