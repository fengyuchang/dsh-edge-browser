import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const classic = text => text.replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\};?\r?$/gm, '').replace(/^export /gm, '');

const manifest=JSON.parse(read('extension/manifest.json'));
assert.equal(manifest.name,'DeepSeek Harness');assert.equal(manifest.version,'0.4.2');
assert(!manifest.permissions.includes('cookies'));assert(manifest.permissions.includes('debugger'));
assert.equal(manifest.commands['dsh-annotate'].suggested_key.default,'Alt+Shift+A');
for(const f of fs.readdirSync(path.join(root,'source/extension')).filter(f=>f.endsWith('.js')))new vm.Script(classic(read('source/extension/'+f)));
for(const f of ['content-scripts/dsh-controls.js','content-scripts/dsh-pointer.js','background.js'])new vm.Script(read('extension/'+f));
const calls=[], events={}, tabs=new Map();
const event=name=>({addListener:fn=>events[name]=fn});
const group=vm.createContext({console,chrome:{runtime:{id:'ours'},tabs:{
 group:async args=>{if(args.groupId===undefined)assert.equal(args.createProperties.windowId,4);calls.push(args);return 9;},
 update:async(id,change)=>{const tab=tabs.get(id);tab.mutedInfo={muted:change.muted,reason:'extension',extensionId:'ours'};return tab;},
 get:async id=>tabs.get(id),onCreated:event('created'),onAttached:event('attached'),onUpdated:event('updated'),onRemoved:event('removed')
},windows:{onRemoved:event('windowRemoved')},tabGroups:{update:async()=>{},onRemoved:event('groupRemoved')}}});
vm.runInContext(classic(read('source/extension/dsh-task-groups.js'))+'\ndshInstallTaskGroups();',group);
tabs.set(7,{id:7,windowId:4});group.win={id:4,tabs:[tabs.get(7)]};await vm.runInContext('dshGroupAgentWindow(win)',group);
assert(tabs.get(7).mutedInfo.muted);assert.equal(calls.length,1);
tabs.get(7).windowId=88;await events.attached(7);assert.equal(tabs.get(7).mutedInfo.muted,false);
tabs.set(8,{id:8,windowId:88,mutedInfo:{muted:false}});await events.created(tabs.get(8));assert.equal(tabs.get(8).mutedInfo.muted,false);
tabs.set(9,{id:9,windowId:4});await events.attached(9);tabs.get(9).windowId=88;tabs.get(9).mutedInfo={muted:true,reason:'extension',extensionId:'other'};await events.attached(9);assert(tabs.get(9).mutedInfo.muted);
const pointerMessages=[], nativeCommands=[];let detach,ready,removed,blockVisual=false;
const pointer=vm.createContext({console,setTimeout,clearTimeout,chrome:{runtime:{id:'ours',onMessage:{addListener:fn=>ready=fn}},
 tabs:{sendMessage:async(tabId,message)=>{pointerMessages.push({tabId,message});if(blockVisual)return new Promise(()=>{});return{dshVisual:true};},get:async id=>({id,windowId:id===99?88:4}),query:async()=>[{id:7,windowId:4}],onRemoved:{addListener:fn=>removed=fn}},
 scripting:{executeScript:async()=>{}},debugger:{sendCommand:async(target,method,params)=>{nativeCommands.push({target,method,params});return{native:true}},onDetach:{addListener:fn=>detach=fn}}}});
vm.runInContext(classic(read('source/extension/dsh-visual-activity.js'))+'\ndshInstallVisualActivity();'+classic(read('source/extension/dsh-pointer-relay.js'))+'\ndshInstallPointerRelay();',pointer);
pointer.request={id:'test',method:'tool.fill',params:{session_id:'ours',value:'DO-NOT-COPY'}};
pointer.dispatcher={sessions:{get:()=>({agentWindowId:4})}};pointer.operation=async()=>({native:true});
await vm.runInContext('dshVisualOperation(dispatcher,request,operation)',pointer);assert(!JSON.stringify(pointerMessages).includes('DO-NOT-COPY'));
const before=pointerMessages.length;pointer.request.params.tab_id=99;await vm.runInContext('dshVisualOperation(dispatcher,request,operation)',pointer);assert.equal(pointerMessages.length,before);
blockVisual=true;await Promise.race([vm.runInContext("dshCdpCommand({tabId:7},'Input.dispatchMouseEvent',{type:'mousePressed',x:20,y:30})",pointer),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Cosmetic message blocked native input')),200))]);
assert.equal(nativeCommands.at(-1).params.type,'mousePressed');blockVisual=false;detach({tabId:7});await new Promise(r=>setTimeout(r,80));
assert.equal(pointerMessages.at(-1).message.type,'dsh-visual-reset');
// Exercise the client lifecycle, including the important display declaration
// needed to override its isolation reset (all: initial !important).
let receive, storageChanged, pointerHost, shadowNodes;
const timers = new Map(), documentListeners = {};
let timerId = 0, now = 10000;
const element = () => ({
  style: { setProperty(name, value, priority) { this[name] = value; this[name + 'Priority'] = priority; } },
  classList: { toggle() {} },
  dataset: {}, children: [], isConnected: false,
  setAttribute() {},
  replaceChildren() { this.children = []; },
  querySelector: () => element(), getTotalLength: () => 100,
  animate: () => ({ cancel() {}, finished: Promise.resolve() }),
  scrollTop: 400, scrollHeight: 3000, clientHeight: 600,
  scrollBy({ top }) { this.scrollTop += top; },
  getBoundingClientRect: () => ({ left: 20, top: 100, right: 220, bottom: 130, width: 200, height: 30 }),
  append(child) { this.children.push(child); child.parent = this; child.isConnected = true; },
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
  get firstElementChild() { return this.children[0]; },
  attachShadow() { shadowNodes = {}; return { querySelector: selector => shadowNodes[selector] ??= element() }; }
});
const documentElement = element();
documentElement.isConnected = true;
const focusElement = element(); focusElement.isConnected = true; focusElement.parentElement = documentElement;
const fakeDocument = { hidden: false, documentElement, scrollingElement: documentElement, activeElement: focusElement,
  elementFromPoint: () => focusElement,
  createElement: () => { const node = element(); pointerHost ??= node; return node; },
  createElementNS: () => element(),
  addEventListener(name, callback) { documentListeners[name] = callback; }
};
const client = vm.createContext({
  console, innerWidth: 800, innerHeight: 600, Date: { now: () => now },
  getComputedStyle: () => ({ overflowY: 'visible' }),
  setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
  clearTimeout: id => timers.delete(id),
  document: fakeDocument,
  chrome: {
    runtime: { onMessage: { addListener: callback => { receive = callback; } }, sendMessage: async () => ({}) },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener: callback => { storageChanged = callback; } } }
  }
});
vm.runInContext(read('extension/content-scripts/dsh-pointer.js'), client);
await Promise.resolve();
const move = () => receive({ type: 'dsh-automation-pointer', action: 'mouseMoved', x: 50, y: 60 }, {}, () => {});
receive({ type: 'bh-agent-overlay-state', mode: 'control' }, {}, () => {});
move();
assert.equal(pointerHost.style.display, 'block');
assert.equal(pointerHost.style.displayPriority, 'important');
receive({ type: 'bsk-help-request' }, {}, () => {});
assert.equal(pointerHost.style.display, 'none', 'Human takeover must hide the agent pointer');
assert.equal(pointerHost.style.displayPriority, 'important', 'Hide must override the CSS reset');
move(); assert.equal(pointerHost.style.display, 'none', 'Human takeover must suppress new agent markers');
receive({ type: 'bh-agent-overlay-state', mode: 'control' }, {}, () => {});
move(); assert.equal(pointerHost.style.display, 'block', 'Returning control must allow the pointer');
storageChanged({ bsk_control_hints_hidden: { newValue: true } }, 'local');
move(); assert.equal(pointerHost.style.display, 'none', 'Control-hints setting must be respected');
storageChanged({ bsk_control_hints_hidden: { newValue: false } }, 'local');
move();
now += 30000;
assert(![...timers.values()].some(timer => timer.delay === 3000), 'A stationary pointer must remain until the next operation');
assert.equal(pointerHost.style.display, 'block');
fakeDocument.hidden = true; documentListeners.visibilitychange();
assert.equal(pointerHost.style.display, 'none');
fakeDocument.hidden = false; documentListeners.visibilitychange();
assert.equal(pointerHost.style.display, 'block', 'Returning to a tab must restore the last pointer');
receive({ type: 'dsh-visual-activity', action: 'fill', label: '填写输入框', phase: 'running' }, {}, () => {});
assert.equal(shadowNodes['.activity-label'].textContent, 'DeepSeek · 填写输入框');
assert(shadowNodes['.focus-ring'].style.cssText.includes('left:16px'));
receive({ type: 'dsh-visual-activity', action: 'observe', label: '读取页面', phase: 'running' }, {}, () => {});
assert.equal(shadowNodes['.scan'].style.display, 'block');
receive({ type: 'dsh-visual-activity', action: 'observe', label: '读取页面', phase: 'complete' }, {}, () => {});
assert.equal(shadowNodes['.scan'].style.display, 'none');
assert.match(shadowNodes['.activity-detail'].textContent, /等待下一步/);
const point = (x, y, action = 'mouseMoved', edgeScroll = true) => receive({ type: 'dsh-automation-pointer', action, x, y, edgeScroll }, {}, () => {});
const flush = delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } };
point(400, 300);
assert(![...timers.values()].some(timer => timer.delay === 500), 'Central movements must not auto-scroll');
point(400, 590);
flush(500);
assert.equal(documentElement.scrollTop, 640, 'An edge hover scrolls at most 240 pixels');
now += 1000; point(400, 590); flush(500);
assert.equal(documentElement.scrollTop, 640, 'A stationary edge pointer must not scroll indefinitely');
point(420, 590); point(420, 590, 'mousePressed'); flush(500);
assert.equal(documentElement.scrollTop, 640, 'A click must cancel edge scrolling');
point(430, 10); flush(500);
assert.equal(documentElement.scrollTop, 400, 'The upper threshold scrolls upward');
now += 1000; point(450, 590, 'mouseMoved', false); flush(500);
assert.equal(documentElement.scrollTop, 400, 'Inspection movements must not scroll');
point(470, 590);
receive({ type: 'bh-agent-overlay-state', mode: 'paused' }, {}, () => {}); flush(500);
assert.equal(documentElement.scrollTop, 400, 'Human control must cancel pending scrolling');
console.log('PASS: checksum, syntax, task-tab auto mute and borrowed audio restoration, native validation hook, private values excluded, task-window isolation, cursor persistence, lifecycle, action UI and bounded edge scrolling');
