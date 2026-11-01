import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('extension/manifest.json'));
const original = JSON.parse(read('extension-official/manifest.json'));
assert.equal(manifest.name, 'DeepSeek Harness');
assert.deepEqual(manifest.host_permissions, original.host_permissions);
assert.deepEqual(manifest.permissions, [...original.permissions, 'tabGroups']);
if (fs.existsSync(path.join(root, 'BrowserSkill-official-0.3.3.zip'))) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'BrowserSkill-official-0.3.3.zip'))).digest('hex'), '10ef76e68f352893fa22dd4cce2f1b96cb90ed957b815d656e13180d07d3c6ea');
assert(manifest.content_scripts[0].js.includes('content-scripts/dsh-pointer.js'));
for (const filename of ['dsh-background.js', 'dsh-task-groups.js', 'dsh-annotations.js', 'dsh-visual-activity.js', 'dsh-pointer-relay.js', 'content-scripts/dsh-controls.js', 'content-scripts/dsh-pointer.js', 'background.js']) {
  new vm.Script(read('extension/' + filename), { filename });
}
const calls = [];
const audioChanges = [], audioTabs = new Map();
const events = {};
const context = vm.createContext({ console, chrome: {
  runtime: { id: 'test-extension' },
  tabs: { group: async args => {
    // Model the documented current-window default: omitting this field would
    // move the task's only tab into the personal window and close its window.
    if (args.groupId === undefined) assert.equal(args.createProperties?.windowId ?? 88, 4, 'Group creation must stay in the task window');
    calls.push(args); return 9;
  }, update: async (id, changes) => {
    audioChanges.push({ id, ...changes });
    const tab = audioTabs.get(id) ?? { id, windowId: 4 };
    tab.mutedInfo = { muted: changes.muted, reason: 'extension', extensionId: 'test-extension' };
    audioTabs.set(id, tab);
    return tab;
  }, get: async id => audioTabs.get(id),
  onCreated: { addListener: cb => { events.newTab = cb; } },
  onAttached: { addListener: cb => { events.tabAttached = cb; } },
  onUpdated: { addListener: cb => { events.tabUpdated = cb; } },
  onRemoved: { addListener: cb => { events.tabRemoved = cb; } } },
  tabGroups: { update: async (id, args) => { calls.push({ id, ...args }); }, onRemoved: { addListener: cb => { events.groupRemoved = cb; } } },
  windows: { onRemoved: { addListener: cb => { events.windowRemoved = cb; } } }
} });
vm.runInContext(read('extension/dsh-task-groups.js'), context);
await vm.runInContext('dshGroupAgentWindow({id: 4, tabs: [{id: 10}, {id: 11}]})', context);
assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { tabIds: [10, 11], createProperties: { windowId: 4 } });
assert.equal(calls[1].title, 'DeepSeek Harness');
assert.deepEqual(audioChanges, [{ id: 10, muted: true }, { id: 11, muted: true }], 'Initial task tabs must be muted');
await events.newTab({ id: 12, windowId: 4 });
assert.equal(calls.at(-1).groupId, 9);
assert.deepEqual(audioChanges.at(-1), { id: 12, muted: true }, 'New task tabs must be muted');
const count = calls.length;
const audioCount = audioChanges.length;
await events.newTab({ id: 99, windowId: 88 });
assert.equal(calls.length, count, 'Personal windows must not be grouped');
events.tabUpdated(99, { audible: true }, { id: 99, windowId: 88 });
assert.equal(audioChanges.length, audioCount, 'Personal audio must not change');
audioTabs.set(20, { id: 20, windowId: 4, mutedInfo: { muted: false } });
await events.tabAttached(20);
assert.deepEqual(audioChanges.at(-1), { id: 20, muted: true }, 'Borrowed tabs must be muted in the task window');
audioTabs.get(20).windowId = 88;
await events.tabAttached(20);
assert.deepEqual(audioChanges.at(-1), { id: 20, muted: false }, 'Return our own temporary mute when a borrowed tab returns');
audioTabs.set(21, { id: 21, windowId: 4, mutedInfo: { muted: true, reason: 'user' } });
await events.tabAttached(21);
const alreadyMutedCount = audioChanges.length;
audioTabs.get(21).windowId = 88;
await events.tabAttached(21);
assert.equal(audioChanges.length, alreadyMutedCount, 'Previously muted tabs must stay muted after return');
audioTabs.set(22, { id: 22, windowId: 4, mutedInfo: { muted: false } });
await events.tabAttached(22);
audioTabs.get(22).windowId = 88;
audioTabs.get(22).mutedInfo = { muted: true, reason: 'extension', extensionId: 'another-extension' };
const otherExtensionCount = audioChanges.length;
await events.tabAttached(22);
assert.equal(audioChanges.length, otherExtensionCount, 'Do not override another extension audio state');
events.groupRemoved({ id: 9, windowId: 4 });
await events.newTab({ id: 23, windowId: 4 });
assert.deepEqual(audioChanges.at(-1), { id: 23, muted: true }, 'Muting must survive a removed task group');
events.tabUpdated(24, { audible: true }, { id: 24, windowId: 4, mutedInfo: { muted: false } });
assert.deepEqual(audioChanges.at(-1), { id: 24, muted: true }, 'Newly audible task tabs must be muted');
events.windowRemoved(4);
const removedAudioCount = audioChanges.length;
await events.newTab({ id: 13, windowId: 4 });
assert.equal(calls.length, count, 'Removed task windows must be forgotten');
assert.equal(audioChanges.length, removedAudioCount, 'Removed task windows must not mute new tabs');
assert.equal(read('extension/background.js').split('await dshGroupAgentWindow(n);').length - 1, 1);
assert.equal(read('extension/background.js').split('sendCommand:(e,t,n)=>dshCdpCommand(e,t,n)').length - 1, 1);
assert.equal(read('extension/background.js').split('if(i)return i;return dshAnnotationOperation(this,e,t,()=>dshVisualOperation(this,e,()=>this.invokeAction(e,t,n)))').length - 1, 1, 'Annotation gating and activity must follow native permission checks');
const pointerMessages = [], nativeCommands = [], injections = [];
let visualFails = false, needsInjection = false, nativeFails = false, detach, ready, removed;
const pointer = vm.createContext({ Number, chrome: {
  runtime: { id: 'test-extension', onMessage: { addListener: cb => { ready = cb; } } },
  tabs: { sendMessage: async (tabId, message) => {
    pointerMessages.push({ tabId, message });
    if (visualFails || needsInjection) throw new Error('No receiving content script');
    return { dshPointer: true, dshVisual: true };
  }, get: async id => ({ id, windowId: id === 99 ? 88 : 4 }), query: async () => [{ id: 7, windowId: 4 }], onRemoved: { addListener: cb => { removed = cb; } } },
  scripting: { executeScript: async args => { injections.push(args); needsInjection = false; if (visualFails) throw new Error('Restricted page'); } },
  debugger: { sendCommand: async (target, method, params) => {
    nativeCommands.push({ target, method, params });
    if (nativeFails) throw new Error('Native CDP error');
    return { native: true };
  }, onDetach: { addListener: cb => { detach = cb; } } }
} });
vm.runInContext(read('extension/dsh-visual-activity.js'), pointer);
vm.runInContext(read('extension/dsh-pointer-relay.js'), pointer);
await vm.runInContext("dshCdpCommand({tabId: 7}, 'Runtime.enable', {})", pointer);
assert.equal(pointerMessages.length, 0, 'Non-mouse commands must not create a pointer');
await vm.runInContext("dshCdpCommand({tabId: 7}, 'Input.dispatchMouseEvent', {type:'mouseMoved', x:20, y:30})", pointer);
assert.equal(pointerMessages.at(-1).message.x, 20);
assert.equal(nativeCommands.at(-1).params.y, 30);
needsInjection = true;
await vm.runInContext("dshCdpCommand({tabId: 7}, 'Input.dispatchMouseEvent', {type:'mousePressed', x:30, y:40})", pointer);
assert.equal(injections.at(-1).target.tabId, 7);
visualFails = true;
assert.equal((await vm.runInContext("dshCdpCommand({tabId: 7}, 'Input.dispatchMouseEvent', {type:'mouseReleased', x:30, y:40})", pointer)).native, true, 'A visualization failure must not block input');
nativeFails = true;
await assert.rejects(vm.runInContext("dshCdpCommand({tabId: 7}, 'Runtime.enable', {})", pointer), /Native CDP error/);
visualFails = false;
detach({ tabId: 7 });
assert.equal(pointerMessages.at(-1).message.type, 'dsh-visual-reset');
nativeFails = false;
const dispatcher = { sessions: { get: () => ({ agentWindowId: 4 }) } };
pointer.dispatcher = dispatcher;
pointer.request = { id: 'test', method: 'tool.fill', params: { session_id: 'ours', value: 'DO-NOT-COPY' } };
pointer.operation = async () => ({ native: true });
assert.equal((await vm.runInContext('dshVisualOperation(dispatcher, request, operation)', pointer)).native, true);
assert.equal(pointerMessages.at(-1).message.phase, 'complete');
assert(!JSON.stringify(pointerMessages).includes('DO-NOT-COPY'), 'Activity messages must never include field values');
pointer.request = { id: 'foreign', method: 'tool.click', params: { session_id: 'ours', tab_id: 99 } };
const beforeForeign = pointerMessages.length;
await vm.runInContext('dshVisualOperation(dispatcher, request, operation)', pointer);
assert.equal(pointerMessages.length, beforeForeign, 'A personal window must not receive activity UI');
pointer.request = { id: 'hover', method: 'tool.hover', params: { session_id: 'ours' } };
pointer.operation = async () => vm.runInContext("dshCdpCommand({tabId: 7}, 'Input.dispatchMouseEvent', {type:'mouseMoved', x:30, y:590})", pointer);
await vm.runInContext('dshVisualOperation(dispatcher, request, operation)', pointer);
assert.equal(pointerMessages.findLast(item => item.message.type === 'dsh-automation-pointer').message.edgeScroll, true);
pointer.request.method = 'tool.observe';
await vm.runInContext('dshVisualOperation(dispatcher, request, operation)', pointer);
assert.equal(pointerMessages.findLast(item => item.message.type === 'dsh-automation-pointer').message.edgeScroll, false, 'Inspection probes must not auto-scroll');
pointer.operation = async () => { throw new Error('Original operation failure'); };
await assert.rejects(vm.runInContext('dshVisualOperation(dispatcher, request, operation)', pointer), /Original operation failure/);
assert.equal(pointerMessages.at(-1).message.phase, 'error');
let readyResponse;
ready({ kind: 'dsh-visual-ready' }, { id: 'test-extension', tab: { id: 7 } }, value => { readyResponse = value; });
assert.equal(readyResponse.pointer.x, 30);
removed(7);
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
