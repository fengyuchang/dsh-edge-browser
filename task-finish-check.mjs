import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { finishBrowserTask, armTaskCompletion } from './harness/dsh-task-finish.mjs';

// Observable lifecycle checks: transfer before close, failed-transfer recovery,
// foreign pages, cancelled turns and parents with a still-running child.
const rows = new Map(), tabs = new Map(), calls = [], hooks = new Map();
let failReturn, beforeQueue;
const registry = {
  resolveForStop(id) { assert(rows.has(id)); return id; },
  requestFor: id => rows.get(id)?.request,
  markForCleanup: id => { rows.get(id).cleanup = true; },
  ownedByDsh: owner => [...rows].filter(([, row]) => row.owners.includes(owner)).map(([id]) => id),
  dshOwnersOf: id => rows.get(id)?.owners ?? []
};
const deps = { registry, config: { defaultTimeoutMs: 1000 },
  queue: { run: async (_id, run) => { beforeQueue?.(); return run(); } },
  runner: { run: async words => {
    const id = words.at(-1); calls.push(words.slice(0, -2));
    if (words[1] === 'list') return { tabs: (tabs.get(id) ?? []).map(tab_id => ({ tab_id })) };
    const tab = Number(words[2]);
    if (failReturn === tab) { failReturn = undefined; throw new Error('fixture transfer failure'); }
    tabs.set(id, tabs.get(id).filter(value => value !== tab));
    return { tab_id: tab };
  } },
  starts: { stop: async ({ sessionId }) => { calls.push(['stop', sessionId]); rows.delete(sessionId); return { stopped: sessionId }; } }
};
const seed = (id, ids, owners = ['owner']) => { rows.set(id, { request: 'request-' + id, owners }); tabs.set(id, ids); };
const parse = result => result;
const exec = { signal: new AbortController().signal };
seed('a', [11, 12]); seed('foreign', [99], ['other']);
await assert.rejects(finishBrowserTask(deps, { session: 'a', keepTabIds: [99] }, exec, parse), /outside this task/);
assert(!rows.get('a').cleanup); assert(rows.has('foreign')); assert(!calls.some(call => call[0] === 'stop'));
calls.length = 0;
const finished = await finishBrowserTask(deps, { session: 'a', keepTabIds: [12] }, exec, parse);
assert.deepEqual(finished.keptTabIds, [12]); assert(finished.controlReleased);
assert.deepEqual(calls, [['tab', 'list', '--scope', 'agent'], ['tab', 'return', '12'], ['stop', 'a']]);
assert(rows.has('foreign'));
seed('retry', [21, 22]); failReturn = 22;
await assert.rejects(finishBrowserTask(deps, { session: 'retry', keepTabIds: [21, 22] }, exec, parse), /transfer failure/);
assert(rows.has('retry'), 'Failed preservation must not close any remaining page');
assert.deepEqual(tabs.get('retry'), [22]);
await finishBrowserTask(deps, { session: 'retry', keepTabIds: [21, 22] }, exec, parse);
assert.equal(calls.filter(call => call[0] === 'tab' && call[1] === 'return' && call[2] === '21').length, 1);
const ctx = { on: (name, callback) => { hooks.set(name, callback); return () => hooks.delete(name); } };
const dispose = armTaskCompletion(ctx, deps, parse);
seed('normal', [31, 32]); seed('child', [41], ['child-agent', 'owner']);
await hooks.get('agent/turn-stopping')({ agent: { id: 'owner' }, signal: exec.signal });
assert(!rows.has('normal')); assert(rows.has('child'), 'A parent finishing must leave a child-owned active browser alone');
seed('raced', [51]);
const agent = { id: 'owner', status: 'idle' };
beforeQueue = () => { agent.status = 'running'; };
hooks.get('agent/status')({ agent, status: 'idle' });
await new Promise(resolve => setImmediate(resolve)); beforeQueue = undefined;
assert(rows.has('raced'), 'An old idle notification must not stop a new turn');
agent.status = 'idle'; hooks.get('agent/status')({ agent, status: 'idle' });
await new Promise(resolve => setImmediate(resolve));
assert(!rows.has('raced')); assert(rows.has('foreign'));
dispose(); assert.equal(hooks.size, 0);

// Exercise the shipped extension seam with stateful Chrome APIs. This verifies
// a kept form/tab is moved (not copied), detached, unmuted and safe to retry.
const pages = new Map([[7, { id: 7, windowId: 4, index: 0, formValue: 'unsaved input' }], [99, { id: 99, windowId: 88 }]]);
const released = [], reset = [], windowCalls = [];
let releaseFails = true;
const session = { sessionId: 'owned', agentWindowId: 4, agentCreatedTabs: new Set([7]), refStore: { invalidateTab() {} } };
const options = { cdp: { releaseSessionTab: async (_id, tab) => { if (releaseFails) { releaseFails = false; throw new Error('detach failed'); } released.push(tab); } } };
const overlay = { resetAgentOverlays: async tab => reset.push(tab) };
const classic = text => text.replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\};?\r?$/gm, '').replace(/^export /gm, '');
const sandbox = vm.createContext({ console, expectedTabMoves:{run: async (_move, run)=>run()}, dshVisualStates: new Map([[7, {}]]), dshPointerPositions: new Map([[7, {}]]),
  dshRestoreTabAudio: async page => { page.muted = false; },
  chrome: {
    tabs: {
      get: async id => { if (!pages.has(id)) throw new Error('closed'); return pages.get(id); },
      query: async ({ windowId }) => [...pages.values()].filter(page => page.windowId === windowId),
      create: async props => { const page = { id: 8, ...props }; pages.set(page.id, page); return page; },
      move: async (id, props) => Object.assign(pages.get(id), props)
    },
    windows: {
      create: async props => { windowCalls.push(props); return { id:90 }; },
      update: async () => ({}),
      get: async id => ({ id })
    }
  }, session, options, overlay
});
vm.runInContext(classic(fs.readFileSync(new URL('./source/extension/dsh-task-finish.js', import.meta.url), 'utf8')), sandbox);
const keep = id => { sandbox.params = { tab_id: id }; return vm.runInContext('dshKeepTaskTab(session, params, options, overlay)', sandbox); };
assert.equal((await keep(99)).code, 'not_found'); assert.equal(windowCalls.length, 0);
assert.equal((await keep(7)).code, 'cdp_failed');
assert.equal(pages.get(7).windowId, 90); assert.equal(pages.get(7).formValue, 'unsaved input');
assert.equal(pages.get(8).windowId, 4, 'Keep an owned placeholder until native stop');
assert((await keep(7)).preserved); assert.equal(windowCalls.length, 1, 'Retry must not create duplicate user windows');
assert.deepEqual(released, [7]); assert.deepEqual(reset, [7]); assert.equal(pages.get(7).muted, false);
assert.equal(pages.get(99).windowId, 88);
const nativePath = ['./packages/browser-skill-dsh-plugin/lib/index.mjs', './offline/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin/lib/index.mjs'].map(file => new URL(file, import.meta.url)).find(file => fs.existsSync(file));
assert(nativePath, 'Native browser plugin must be included');
const native = fs.readFileSync(nativePath, 'utf8');
assert(native.includes('finish: "session.finish"') && native.includes('armTaskCompletion(ctx, deps, parseBskJson)'));
assert(fs.readFileSync(new URL('./source/browser-skill.patch', import.meta.url), 'utf8').includes('dshKeepTaskTab'));
console.log('PASS: task finish keeps results/forms, closes only disposable task tabs, returns ownership, retries safely and isolates turn cleanup');
