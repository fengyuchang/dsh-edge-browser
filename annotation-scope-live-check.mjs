import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const browser = process.argv[process.argv.indexOf('--browser') + 1];
assert(process.argv.includes('--browser') && browser, 'Pass the verified Edge instance with --browser');
const offline = path.join(root, 'offline/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin/lib/index.mjs');
const pluginPath = fs.existsSync(offline) ? offline : path.join(root, 'packages/browser-skill-dsh-plugin/lib/index.mjs');
const { apply } = await import(pathToFileURL(pluginPath));
const tools = new Map(), cleanup = [];
const ctx = { tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } }, get: () => undefined, on: () => () => {}, inject: () => {}, effect: callback => cleanup.push(callback()) };
const bin = fs.existsSync(path.join(root, 'bin/bsk.exe')) ? path.join(root, 'bin/bsk.exe') : (process.env.BSK_PATH || 'bsk');
apply(ctx, { bskPath: bin, observationEnabled: false, lazyTools: false }, { startJournal: { records: new Map(), save() {}, release() {} } });
const signal = new AbortController().signal;
const execA = { signal, agent: { id: 'annotation-fixture-chat-a' } }, execB = { signal, agent: { id: 'annotation-fixture-chat-b' } };
const call = (name, args, exec) => tools.get(name).execute(args, exec);
const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>会话隔离合成验收页</title><h1>仅应在测试会话 A 中打开</h1>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let sessionA, sessionB;
const report = { scope: 'Installed native tool handlers and real Edge; isolated host registrars and synthetic conversation identities. No user conversation messages.', checks: [] };
try {
  sessionA = (await call('bsk_session', { action: 'start', browser, noFocus: true }, execA)).sessionId;
  sessionB = (await call('bsk_session', { action: 'start', browser, noFocus: true }, execB)).sessionId;
  assert.deepEqual((await call('bsk_session', { action: 'list' }, execA)).sessions.map(entry => entry.sessionId), [sessionA]);
  assert.deepEqual((await call('bsk_session', { action: 'list' }, execB)).sessions.map(entry => entry.sessionId), [sessionB]);
  await call('bsk_page', { action: 'navigate', url: `http://127.0.0.1:${server.address().port}/` }, execA);
  assert.match(JSON.stringify(await call('bsk_inspect', { action: 'observe', maxTokens: 400 }, execA)), /会话隔离合成验收页|仅应在测试会话 A/);
  assert(!JSON.stringify(await call('bsk_inspect', { action: 'observe', maxTokens: 400 }, execB)).includes('仅应在测试会话 A'));
  report.checks.push('Implicit navigation and observation stay in the caller-owned browser, despite another current session');
  await assert.rejects(call('bsk_page', { action: 'navigate', session: sessionB, url: 'https://example.com' }, execA), /不属于当前聊天/);
  report.checks.push('Explicit foreign browser session is rejected before navigation');
  await call('bsk_session', { action: 'stop' }, execA); sessionA = undefined;
  assert.equal((await call('bsk_session', { action: 'list' }, execB)).sessions[0].sessionId, sessionB);
  report.checks.push('Implicit stop closes only the caller-owned session');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
finally {
  if (sessionA) await call('bsk_session', { action: 'stop', session: sessionA }, execA);
  if (sessionB) await call('bsk_session', { action: 'stop', session: sessionB }, execB);
  for (const dispose of cleanup.reverse()) await dispose?.();
  await new Promise(resolve => server.close(resolve));
  report.cleanedUp = true; fs.mkdirSync(path.join(root, '验收记录'), { recursive: true }); fs.writeFileSync(path.join(root, '验收记录/annotation-scope-native.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
