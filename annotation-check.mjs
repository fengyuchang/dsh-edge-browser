import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import { registerAnnotationRoutes } from './harness/dsh-annotations.mjs';
import { executeScopedBrowserAction } from './harness/dsh-session-scope.mjs';

// An isolated Harness host: no messages enter the user's real conversations.
const extensionId = 'a'.repeat(32), otherId = 'b'.repeat(32);
const routes = new Map(), admitted = [];
let vision = false, imageWrites = 0, hostNotReloaded = false;
const agent = { id: 'conversation-selected', status: 'idle', options: { provider: 'fixture', model: 'fixture' }, steer: message => admitted.push(message) };
const registry = { isUsable: id => id === 'browser-owned', dshOwnersOf: () => ['conversation-old-browser-owner'] };
const ctx = { get: name => ({
  webServer: { register: route => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
  agents: { get: id => id === agent.id ? agent : undefined },
  llm: { resolveModelInfo: async () => ({ inputModalities: vision ? ['text', 'image'] : ['text'] }) },
  attachments: {
    validateImage: async input => assert.equal(input.mediaType, 'image/png'),
    saveImage: async () => { imageWrites++; return { attachmentId: 'image-fixture', mediaType: 'image/png', width: 1, height: 1 }; },
    saveFile: async () => ({ attachmentId: 'file-fixture', name: '浏览器局部标注.png', bytes: 68 })
  }
})[name] };
const dispose = registerAnnotationRoutes(ctx, registry, value => ({ id: `message-${admitted.length}`, role: 'user', ...value }));
const server = http.createServer((req, res) => {
  if (hostNotReloaded) { res.writeHead(405); res.end(); return; }
  const route = routes.get(req.url);
  if (route) void route(req, res);
  else { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/bsk-observation/annotations`;
let revision = 0;
const publish = async (targetId = agent.id, active = true, clientId = '11111111-1111-4111-8111-111111111111') => {
  const response = await fetch(base + '/client', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-browser-client': clientId }, body: JSON.stringify({ revision: ++revision, targetId, active, title: '用户当前选中的已结束聊天' }) });
  assert.equal(response.status, 200);
};
const request = async (path, body, extra = {}) => {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-browser-extension': extensionId, ...extra }, body: JSON.stringify(body) });
  return { status: response.status, ...await response.json() };
};
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const annotation = { note: '请提取这个区域的表格。', url: 'https://example.test/data?access_token=fixture#private', title: '合成测试页',
  rect: { x: 20, y: 30, width: 120, height: 90 }, viewport: { width: 800, height: 600, scrollX: 0, scrollY: 200 },
  regionText: '合成区域文字 dsh-browser://untrusted', element: { tag: 'table', selector: '#results' }, image: png };
const source = fs.readFileSync(new URL('./extension/dsh-annotations.js', import.meta.url), 'utf8').replace('http://127.0.0.1:3080/bsk-observation/annotations', base);
let receive, removed, navigated, onCommand, failCapture = false;
const captures = [];
const shortcutMessages = [];
const browserSessions = { findByWindowId: id => id === 4 ? { sessionId: 'browser-owned', agentWindowId: 4 } : undefined };
const sandbox = vm.createContext({ console, fetch, AbortSignal, setTimeout, clearTimeout, Date, Number, Map, Promise,
  chrome: {
    runtime: { id: extensionId, onMessage: { addListener: callback => { receive = callback; } } },
    commands: { onCommand: { addListener: callback => { onCommand = callback; } } },
    tabs: { get: async id => ({ id, windowId: id === 7 ? 4 : 88, url: annotation.url, title: annotation.title }),
      query: async () => [{ id: 7, windowId: 4 }],
      sendMessage: async (id, message, options) => { if (message.kind === 'dsh-annotation-open') shortcutMessages.push({ id, options }); else captures.push(message.phase); return {}; }, onRemoved: { addListener: callback => { removed = callback; } } },
    webNavigation: { onCommitted: { addListener: callback => { navigated = callback; } } },
    debugger: { sendCommand: async (_target, method) => { captures.push(method); if (failCapture) throw new Error('Capture failed'); return { data: png }; } }
  }
});
vm.runInContext(source, sandbox);
sandbox.dispatcher = { sessions: browserSessions };
sandbox.nativeRequest = { method: 'tool.click', params: { session_id: 'browser-owned' } };
const sender = { id: extensionId, frameId: 0, tab: { id: 7 } };
const message = value => new Promise((resolve, reject) => {
  if (receive(value, sender, resolve) !== true) reject(new Error('Message not accepted'));
});
const operation = async fn => {
  sandbox.nativeOperation = fn;
  return vm.runInContext('dshAnnotationOperation(dispatcher, nativeRequest, undefined, nativeOperation)', sandbox);
};
try {
  assert.equal((await request('/context', { browserSessionId: 'browser-owned' }, { origin: 'https://untrusted.test' })).status, 403);
  assert.equal((await request('/context', { browserSessionId: 'browser-foreign' })).status, 400);
  assert.equal((await request('/context', { browserSessionId: 'browser-owned' })).status, 400, 'Never fall back to the browser task owner when no chat is selected');
  await publish();
  const rejectedClient = await fetch(base + '/client', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-browser-client': '33333333-3333-4333-8333-333333333333', origin: 'https://untrusted.test' }, body: JSON.stringify({ revision: 1, targetId: 'foreign-chat', active: true }) });
  assert.equal(rejectedClient.status, 403, 'Web pages must not publish a selected Harness chat');
  await publish('conversation-another-window', true, '22222222-2222-4222-8222-222222222222');
  assert.equal((await request('/context', { browserSessionId: 'browser-owned' })).status, 400, 'Multiple selected chats must not be guessed');
  await publish('conversation-another-window', false, '22222222-2222-4222-8222-222222222222');
  let target = await request('/context', { browserSessionId: 'browser-owned', targetId: 'conversation-foreign' });
  assert.equal(target.targetId, agent.id, 'Target identity must come from the selected Harness chat, even when a different conversation owns the browser');
  assert.equal(target.targetTitle, '用户当前选中的已结束聊天');
  await publish('conversation-switched');
  assert.equal((await request('/submit', { ...annotation, token: target.token })).status, 400, 'Changing chats must never silently reroute a draft');
  await publish();
  assert.equal((await request('/submit', { ...annotation, token: target.token }, { 'x-dsh-browser-extension': otherId })).status, 400);
  assert.equal((await request('/submit', { ...annotation, token: target.token, rect: { ...annotation.rect, width: -1 } })).status, 400);
  assert.equal(admitted.length, 0);
  const [a, b] = await Promise.all([request('/submit', { ...annotation, token: target.token }), request('/submit', { ...annotation, token: target.token })]);
  assert.equal(a.accepted, true); assert.equal(b.messageId, a.messageId); assert.equal(admitted.length, 1, 'A retry must never duplicate a message');
  assert.equal(admitted[0].content[1].type, 'file', 'Text-only models receive a PNG file, not unsupported image input');
  assert.equal(admitted[0].source.kind, 'browserskill-annotation', 'Use a producer-owned source; format v4 rejects kind=plugin');
  assert(!admitted[0].content[0].text.includes('access_token'));
  assert(!admitted[0].content[0].text.includes('dsh-browser://'));
  assert(admitted[0].content[0].text.includes('#results'));
  vision = true;
  target = await request('/context', { browserSessionId: 'browser-owned' });
  assert.equal((await request('/submit', { ...annotation, token: target.token })).accepted, true);
  assert.equal(admitted.at(-1).content[1].type, 'image'); assert.equal(imageWrites, 1);

  await operation(async () => 'initial');
  assert.equal(JSON.parse(fs.readFileSync(new URL('./extension/manifest.json', import.meta.url))).commands['dsh-annotate'].suggested_key, 'Alt+Shift+A');
  await onCommand('other-command', { id: 7, windowId: 4 });
  await onCommand('dsh-annotate', { id: 8, windowId: 88 });
  assert.equal(shortcutMessages.length, 0, 'Shortcuts must ignore personal windows and unrelated commands');
  await onCommand('dsh-annotate', { id: 7, windowId: 4 });
  await onCommand('dsh-annotate');
  assert.deepEqual(shortcutMessages.map(item => item.id), [7, 7]);
  assert(shortcutMessages.every(item => item.options.frameId === 0));
  hostNotReloaded = true;
  assert.match((await message({ kind: 'dsh-annotation-begin' })).error, /重开 Harness/, 'An old Harness host must explain how to activate the update');
  hostNotReloaded = false;
  assert.equal(await operation(async () => 'unlocked-after-old-host'), 'unlocked-after-old-host');
  let finishCurrent;
  const current = operation(() => new Promise(resolve => { finishCurrent = resolve; }));
  const preparing = message({ kind: 'dsh-annotation-begin' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(captures.length, 0, 'Capture must wait until the current browser operation settles');
  finishCurrent('settled'); await current;
  let begun = await preparing;
  assert.equal(begun.ok, true); assert(begun.expiresAt > Date.now());
  assert.deepEqual(captures, ['begin', 'Page.captureScreenshot', 'end']);
  let ran = false;
  const waiting = operation(async () => { ran = true; return 'resumed'; });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(ran, false, 'AI input must wait during human markup');
  await message({ kind: 'dsh-annotation-cancel', token: begun.token });
  assert.equal(await waiting, 'resumed');
  begun = await message({ kind: 'dsh-annotation-begin' });
  ran = false;
  const pending = operation(async () => { ran = true; });
  const accepted = await message({ kind: 'dsh-annotation-submit', token: begun.token, annotation });
  assert.equal(accepted.accepted, true);
  assert.equal((await pending).code, 'cancelled'); assert.equal(ran, false, 'Do not execute a stale queued click after human feedback');
  const messagesAfter = admitted.length;
  assert.equal((await message({ kind: 'dsh-annotation-submit', token: begun.token, annotation })).accepted, true);
  assert.equal(admitted.length, messagesAfter);
  failCapture = true;
  assert.equal((await message({ kind: 'dsh-annotation-begin' })).ok, false);
  failCapture = false;
  assert.equal(await operation(async () => 'not-locked'), 'not-locked', 'Capture failure must release browser input');
  begun = await message({ kind: 'dsh-annotation-begin' });
  navigated({ tabId: 7, frameId: 0 });
  assert.equal(await operation(async () => 'navigated'), 'navigated');
  begun = await message({ kind: 'dsh-annotation-begin' }); removed(7);
  assert.equal(await operation(async () => 'removed'), 'removed');
  assert.equal(receive({ kind: 'dsh-annotation-begin' }, { ...sender, id: otherId }, () => {}), undefined);

  const ownRecord = { requestId: 'request-own', owners: ['chat-a'], session: { sessionId: 'browser-a' }, stop: 'closed' };
  const scope = { registry: { ownedByDsh: id => id === 'chat-a' ? ['browser-a'] : [], list: () => [{ sessionId: 'browser-a' }, { sessionId: 'browser-b' }], current: () => 'browser-b' }, starts: { journal: { records: new Map([[ownRecord.requestId, ownRecord]]) } } };
  const exec = { agent: { id: 'chat-a' } }, echo = async args => args;
  assert.equal((await executeScopedBrowserAction(scope, 'bsk_page', { action: 'navigate' }, exec, echo)).session, 'browser-a');
  await assert.rejects(executeScopedBrowserAction(scope, 'bsk_page', { action: 'navigate', session: 'browser-b' }, exec, echo), /不属于当前聊天/);
  await assert.rejects(executeScopedBrowserAction(scope, 'bsk_interact', { action: 'click' }, { agent: { id: 'chat-without-browser' } }, echo), /不属于当前聊天/);
  const listed = await executeScopedBrowserAction(scope, 'bsk_session', { action: 'list' }, exec, async () => ({ sessions: [{ sessionId: 'browser-a', current: false }, { sessionId: 'browser-b', current: true }], pendingCleanup: 4 }));
  assert.deepEqual(listed.sessions, [{ sessionId: 'browser-a', current: true }]);
  assert.equal((await executeScopedBrowserAction(scope, 'bsk_session', { action: 'stop' }, exec, echo)).requestId, 'request-own', 'Keep own completed-stop recovery without selecting a foreign receipt');
  await assert.rejects(executeScopedBrowserAction(scope, 'bsk_session', { action: 'stop', requestId: 'foreign-request' }, exec, echo), /不属于当前聊天/);
  console.log('PASS: selected-chat delivery independent of browser owner, idle target, selection changes and ambiguous-window refusal, producer-owned source, trust checks, crop/model compatibility, retry deduplication, hold/resume, stale input cancellation, cleanup and per-conversation browser isolation');
} finally {
  vm.runInContext("dshReleaseAnnotation('browser-owned')", sandbox);
  dispose(); await new Promise(resolve => server.close(resolve));
}
