import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const browser = process.argv[process.argv.indexOf('--browser') + 1];
assert(process.argv.includes('--browser') && browser, 'Pass the verified browser with --browser');
const plugin = ['packages/browser-skill-dsh-plugin/lib/index.mjs', 'offline/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin/lib/index.mjs'].map(file => path.join(root, file)).find(file => fs.existsSync(file));
const { apply } = await import(pathToFileURL(plugin));
const tools = new Map(), hooks = new Map(), disposers = [];
const ctx = { tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
  on: (event, hook) => { hooks.set(event, hook); return () => hooks.delete(event); }, get: () => undefined, inject() {}, effect: callback => disposers.push(callback()) };
apply(ctx, { bskPath: process.env.BSK_PATH || path.join(root, 'bin/bsk.exe'), observationEnabled: false, lazyTools: false }, { startJournal: { records: new Map(), save() {}, release() {} } });
const signal = new AbortController().signal, agent = { id: 'finish-fixture-owner', status: 'running' }, exec = { signal, agent };
const call = (tool, args) => tools.get(tool).execute(args, exec);
let closeFixtures = false;
const states = new Map();
const server = http.createServer(async (req, res) => {
  if (req.url === '/state') {
    let body = ''; for await (const chunk of req) body += chunk;
    const state = JSON.parse(body); states.set(state.id, state);
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ close: closeFixtures }));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<doctype html><title>Task completion fixture</title><h1>保留结果与表单</h1><input aria-label="未保存内容"><button>测试目标</button><script>
    const id=crypto.randomUUID();setInterval(async()=>{try{const pointer=document.getElementById('dsh-automation-pointer');const state={id,value:document.querySelector('input').value,pointerHidden:!pointer||getComputedStyle(pointer).display==='none'};const result=await(await fetch('/state',{method:'POST',body:JSON.stringify(state)})).json();if(result.close)window.close();}catch{}},200);
  </script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const owned = new Set(), kept = [];
const start = async () => { const id = (await call('bsk_session', { action: 'start', browser, noFocus: true, url })).sessionId; owned.add(id); return id; };
const list = session => call('bsk_tabs', { action: 'list', session, scope: 'agent' });
const report = { scope: 'Native model-facing tool and completion hooks in real Edge, isolated synthetic chat; no real chat messages.', checks: [] };
try {
  const id = await start();
  const initial = await list(id), tab = initial.tabs[0].tabId;
  assert(Number.isInteger(tab), JSON.stringify(initial));
  await call('bsk_interact', { action: 'fill', session: id, target: 'input', value: 'unsaved fixture value' });
  const extra = await call('bsk_tabs', { action: 'create', session: id, url: 'about:blank' });
  const result = await call('bsk_session', { action: 'finish', session: id, keepTabIds: [tab] });
  owned.delete(id); kept.push(tab);
  assert(result.controlReleased); assert.deepEqual(result.keptTabIds, [tab]);
  for (let i = 0; i < 25 && ![...states.values()].some(state => state.value === 'unsaved fixture value' && state.pointerHidden); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert([...states.values()].some(state => state.value === 'unsaved fixture value' && state.pointerHidden), 'Keep the live unsaved form and hide the pointer after releasing control');
  assert.equal((await call('bsk_session', { action: 'list' })).sessions.length, 0);
  report.checks.push('Explicit model finish preserves the chosen result/form page and stops its task window with disposable blank tab');
  const next = await start();
  const fallbackTabs = (await list(next)).tabs.map(entry => entry.tabId);
  await hooks.get('agent/turn-stopping')({ agent, signal }); owned.delete(next); kept.push(...fallbackTabs);
  assert.equal((await call('bsk_session', { action: 'list' })).sessions.length, 0);
  report.checks.push('An otherwise completed turn preserves remaining task pages and releases its browser session automatically');
  // Inspect only fixture IDs, via another owned task. The fixture pages later
  // close themselves through their test-only loopback command, with no user tabs touched.
  const inspect = await start();
  const all = await call('bsk_tabs', { action: 'list', session: inspect, scope: 'user' });
  for (const keptId of kept) assert(all.tabs.some(entry => entry.tabId === keptId), 'Kept fixture must be an ordinary user page');
  assert(!all.tabs.some(entry => entry.tabId === extra.tabId), 'Unused created page must close');
  report.checks.push('Retained pages appear as ordinary user tabs; unused task-created tab is closed');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
finally {
  for (const id of owned) await call('bsk_session', { action: 'stop', session: id }).catch(() => {});
  closeFixtures = true; await new Promise(resolve => setTimeout(resolve, 1200));
  for (const dispose of disposers.reverse()) await dispose?.();
  await new Promise(resolve => server.close(resolve));
  fs.mkdirSync(path.join(root, '验收记录'), { recursive: true }); fs.writeFileSync(path.join(root, '验收记录/task-finish-live.json'), JSON.stringify({ ...report, keptFixtureTabIds: kept }, null, 2) + '\n');
}
console.log(JSON.stringify({ ...report, keptFixtureTabIds: kept }));
