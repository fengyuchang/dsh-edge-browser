import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const windows=new Map([[1,{id:1,type:'normal',focused:false}],[2,{id:2,type:'normal',focused:true}],[99,{id:99,type:'normal',focused:false}]]);
const tabs=new Map([[10,{id:10,windowId:1,url:'https://example.com/result'}]]),removed=[];let next=20;
const sandbox=vm.createContext({console,chrome:{
 windows:{get:async id=>{if(!windows.has(id))throw Error('gone');return windows.get(id)},remove:async id=>{removed.push(id);windows.delete(id)}},
 tabs:{query:async({windowId})=>[...tabs.values()].filter(t=>t.windowId===windowId),create:async p=>{const tab={...p,id:next++};tabs.set(tab.id,tab);return tab},remove:async id=>tabs.delete(id),ungroup:async()=>{},update:async()=>{}}
}});
vm.runInContext(fs.readFileSync(new URL('./source/extension/dsh-task-groups.js',import.meta.url),'utf8').replace(/^export .*$/gm,''),sandbox);
const run=code=>vm.runInContext(code,sandbox);
run('dshRememberResultWindow(1,"owner-a");dshSyncTaskWindows([{sessionId:"owner-a",agentWindowId:3}])');
assert.equal(await run('dshAcquireIdleTaskWindow("about:blank")'),null,'An unfinished owner still controls its result window');
run('dshSyncTaskWindows([])');
const claimed=await Promise.all([run('dshAcquireIdleTaskWindow("https://example.com/a")'),run('dshAcquireIdleTaskWindow("https://example.com/b")')]);
assert.equal(claimed.filter(Boolean).length,1,'Concurrent sessions must reserve separate windows');
assert.deepEqual([...claimed.find(Boolean).tabs.map(t=>t.id)],[20],'Existing results must not become agent-owned');
assert(run('dshIsRetainedIdleTab(1,10)'), 'Old result tabs stay in place without granting control');
run('dshSyncTaskWindows([])');assert.equal(await run('dshAcquireIdleTaskWindow("about:blank")'),null,'Startup reservation survives unrelated state notifications');
await run('dshRemoveTaskWindow(1)');assert(tabs.has(10));assert(!tabs.has(20));assert.deepEqual(removed,[],'Failed startup must preserve original results');
run('dshRememberResultWindow(2,"finished");dshSyncTaskWindows([])');
const reclaimed=await run('dshAcquireIdleTaskWindow("about:blank")');assert.equal(reclaimed.id,1);assert(windows.has(2));assert(windows.has(99),'Ordinary Edge windows are never candidates');
run('dshSyncTaskWindows([{sessionId:"owner-c",agentWindowId:1}])');
assert.equal(await run('dshAcquireIdleTaskWindow("about:blank")'),null,'Active and focused windows cannot be taken over');
console.log('PASS: idle plugin-window reuse, atomic reservation, original result preservation, busy/focused/ordinary-window exclusion');
