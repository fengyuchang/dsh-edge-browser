import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sent = [], effects = [], timers = new Map(), events = new Map();
let registration;
const sandbox = vm.createContext({
  console, crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
  react: { useEffect: effect => effects.push(effect()) },
  window: { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) },
  setInterval: fn => { const id = timers.size + 1; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id),
  fetch: async (url, init) => { sent.push({ url, ...JSON.parse(init.body), clientId: init.headers['x-dsh-browser-client'] }); return { ok: true }; },
  context: {
    sessions: { list: { getSnapshot: () => ({ byId: { 'selected-chat-a': { displayTitle: '已完成的选中聊天 A' }, 'selected-chat-b': { title: '选中聊天 B' } } }) } },
    slots: { inject: (name, callback) => callback(), register: (config, Component) => { registration = { config, Component }; } }
  }
});
const classic = text => text.replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\};?\r?$/gm, '').replace(/^export /gm, '');
vm.runInContext(classic(fs.readFileSync(new URL('./harness/dsh-annotation-client.js', import.meta.url), 'utf8')), sandbox);
vm.runInContext('dshRegisterAnnotationClient(context)', sandbox);
assert.equal(registration.config.name, 'conversation.input.overlay');
registration.Component(registration.config.inject('selected-chat-a'));
await Promise.resolve();
assert.equal(sent[0].targetId, 'selected-chat-a'); assert.equal(sent[0].title, '已完成的选中聊天 A');
assert.equal(sent[0].active, true);
await [...timers.values()][0]();
assert.equal(sent.at(-1).targetId, 'selected-chat-a', 'Losing focus to Edge must not choose another chat');
effects.pop()();
registration.Component(registration.config.inject('selected-chat-b'));
await Promise.resolve();
assert.equal(sent.at(-2).targetId, 'selected-chat-a'); assert.equal(sent.at(-2).active, false);
assert.equal(sent.at(-1).targetId, 'selected-chat-b'); assert.equal(sent.at(-1).active, true);
for (let i = 1; i < sent.length; i++) assert(sent[i].revision > sent[i - 1].revision);
effects.pop()();
assert.equal(timers.size, 0); assert.equal(events.size, 0);
console.log('PASS: native input slot publishes the selected chat, preserves selection when Edge gains focus, orders switches and cleans up heartbeat/selection');
