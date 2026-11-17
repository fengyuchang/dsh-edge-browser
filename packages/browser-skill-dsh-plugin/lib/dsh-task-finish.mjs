import { randomBytes } from 'node:crypto';
import { trustedBrowserExtensionRequest } from './dsh-annotations.mjs';

// Ending a turn always releases control. The model chooses which result pages to keep.
const pending = new WeakMap();
const receiptServices = new WeakMap();
const cleanupReasons = new Set(['tab_absent', 'requested', 'borrowed', 'form_or_uncertain_content', 'human_or_user', 'previous_result_or_user', 'cleanup_failed', 'query_failed']);

// The unchanged CLI stop contract drops extension-only fields. A bounded,
// armed receipt supplies read-only evidence without changing durable teardown.
export function registerTaskCleanupRoutes(ctx, deps) {
  const armed = new Map();
  const prepare = (session, requestId, extensionId, tabIds, keepIds) => {
    if (tabIds.length > 512 || armed.size >= 16) return undefined;
    const token = randomBytes(24).toString('hex');
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const row = { token, requestId, extensionId, tabIds, keepIds, expires: Date.now() + 60000, resolve };
    armed.set(session, row);
    return {
      async wait(signal) {
        if (signal?.aborted) return undefined;
        let timer, abort;
        try {
          return await Promise.race([promise, new Promise(done => {
            timer = setTimeout(done, 1200);
            abort = () => done(undefined); signal?.addEventListener('abort', abort, { once: true });
          })]);
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      },
      dispose() { if (armed.get(session) === row) armed.delete(session); row.resolve(undefined); },
    };
  };
  const service = { prepare };
  receiptServices.set(deps, service);
  const dispose = ctx.get('webServer').register({ kind: 'exact', path: '/bsk-observation/task-cleanup', handler: async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method !== 'POST') return reply(405, { error: 'method not allowed' });
      if (!trustedBrowserExtensionRequest(req) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return reply(403, { error: 'untrusted source' });
      let bytes = 0, text = '';
      for await (const chunk of req) { bytes += Buffer.byteLength(chunk); if (bytes > 65536) throw Error('receipt too large'); text += chunk; }
      const body = JSON.parse(text), row = armed.get(body.sessionId);
      if (!row || row.expires < Date.now() || row.extensionId !== req.headers['x-dsh-browser-extension']) return reply(409, { error: 'receipt not armed' });
      const owner = deps.registry.requestFor(body.sessionId);
      if (owner !== undefined && owner !== row.requestId) return reply(409, { error: 'ownership changed' });
      if (body.action === 'begin') {
        if (owner !== row.requestId) return reply(409, { error: 'task no longer owned' });
        return reply(200, { token: row.token, requestId: row.requestId, tabIds: row.tabIds, keepIds: row.keepIds });
      }
      if (body.action !== 'complete' || body.token !== row.token || body.requestId !== row.requestId || typeof body.controlReleased !== 'boolean') throw Error('invalid receipt');
      if (!Array.isArray(body.entries) || body.entries.length !== row.tabIds.length) throw Error('incomplete receipt');
      const seen = new Set();
      const entries = body.entries.map(entry => {
        if (!row.tabIds.includes(entry.tabId) || seen.has(entry.tabId) || !['closed', 'retained', 'failed', 'unknown'].includes(entry.state) || !cleanupReasons.has(entry.reason)) throw Error('invalid page outcome');
        seen.add(entry.tabId);
        return { tabId: entry.tabId, state: entry.state, reason: entry.reason };
      });
      if (!['closed', 'retained', 'unknown'].includes(body.windowState)) throw Error('invalid window outcome');
      const counts = Object.fromEntries(['closed', 'retained', 'failed', 'unknown'].map(state => [state, entries.filter(entry => entry.state === state).length]));
      row.resolve({ confirmed: true, source: 'edge-receipt', controlReleased: body.controlReleased, entries, counts, windowState: body.windowState });
      reply(200, { ok: true });
    } catch { reply(400, { error: 'invalid cleanup receipt' }); }
  } });
  return () => { dispose(); if (receiptServices.get(deps) === service) receiptServices.delete(deps); for (const row of armed.values()) row.resolve(undefined); armed.clear(); };
}
export async function finishBrowserTask(deps, args, exec, parse, { keepAll = false, eligible = () => true } = {}) {
  if (args.requestId !== undefined) throw new Error('finish requires session; requestId is for stop recovery only');
  const requested = args.keepTabIds ?? [];
  if (!Array.isArray(requested) || requested.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(requested).size !== requested.length) {
    throw new Error('keepTabIds must be an array of unique positive tab IDs from this task');
  }
  const sessionId = deps.registry.resolveForStop(args.session);
  if (deps.dshUserWaits?.get(sessionId)) throw new Error('浏览器正在等待用户操作，不能结束任务；请等待用户交还后继续。');
  const requestId = deps.registry.requestFor(sessionId);
  let finishes = pending.get(deps);
  if (!finishes) pending.set(deps, finishes = new Map());
  let state = finishes.get(sessionId);
  if (state?.requestId !== requestId) state = undefined;
  if (state?.running) return state.running;
  if (state?.keep && !keepAll && JSON.stringify(requested) !== JSON.stringify(state.requested)) throw new Error('A partial finish is pending; retry with the original keepTabIds');
  if (!state) finishes.set(sessionId, state = { requestId, requested: [...requested], returned: new Set() });
  const task = (async () => {
    let ticket;
    try {
    const preserved = await deps.queue.run(sessionId, async () => {
      if (!eligible()) return null;
      if (deps.registry.requestFor(sessionId) !== requestId) throw new Error('Browser ownership changed before finish');
      exec.signal?.throwIfAborted();
      const run = async words => {
        const result = await deps.runner.run([...words, '--session', sessionId], { signal: exec.signal, timeoutMs: deps.config.defaultTimeoutMs, tag: sessionId });
        if (result.aborted) throw new Error('Browser finish was interrupted; inspect before retrying');
        return parse(result, 'task finish');
      };
      const { tabs } = await run(['tab', 'list', '--scope', 'agent']);
      if (!Array.isArray(tabs)) throw new Error('Could not inspect task tabs; no pages were closed');
      const ids = new Set(tabs.map(tab => tab.tab_id));
      if ([...ids].some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid task tab metadata; no pages were closed');
      state.tabIds = [...new Set([...(state.tabIds ?? []), ...ids])];
      if (requested.some(id => !ids.has(id) && !state.keep?.includes(id))) throw new Error('keepTabIds contains a page outside this task; no pages were closed');
      if (!eligible()) return null; // An idle event may have raced the next user turn.
      const keep = state.keep = [...new Set([...(state.keep ?? requested), ...(keepAll ? ids : [])])];
      deps.registry.markForCleanup(sessionId); // Reject further input while transferring and stopping.
      for (const id of keep) if (!state.returned.has(id)) {
        await run(['tab', 'return', String(id)]);
        state.returned.add(id);
      }
      const service = receiptServices.get(deps);
      if (service) try {
        const caps = (await run(['debug', 'capabilities']))?.capabilities?.extension;
        if (caps?.features?.dsh_cleanup_receipt === 1 && /^[a-p]{32}$/.test(caps.runtime_id)) ticket = service.prepare(sessionId, requestId, caps.runtime_id, state.tabIds, keep);
      } catch { /* Missing read-only receipts never prevent durable cleanup. */ }
      return keep;
    }, exec.signal);
    if (preserved === null) return { skipped: true };
    if (deps.registry.requestFor(sessionId) !== requestId) throw new Error('Browser ownership changed before stop');
    const result = await deps.starts.stop({ sessionId, signal: exec.signal });
    const cleanup = await ticket?.wait(exec.signal) ?? { confirmed: false, reason: ticket ? 'receipt_unavailable' : 'extension_receipt_unavailable' };
    return {
      ...result, keptTabIds: preserved, requestedKeepTabIds: preserved, controlReleased: true,
      cleanup,
      ...(cleanup.confirmed ? Object.fromEntries(['closed', 'retained', 'failed', 'unknown'].map(kind => [kind + 'TabIds', cleanup.entries.filter(entry => entry.state === kind).map(entry => entry.tabId)])) : {}),
      protectedPagesMayRemain: !cleanup.confirmed || cleanup.counts.retained + cleanup.counts.failed + cleanup.counts.unknown > 0,
      cleanupNote: 'keptTabIds lists the requested result pages. Native cleanup also preserves borrowed or human-touched pages, unfinished forms and uncertain content; controlReleased does not assert that every tab/window was closed.',
    };
    } catch (error) {
      const cleanup = await ticket?.wait(exec.signal);
      if (cleanup?.confirmed && error instanceof Error) {
        try {
          error.browserCleanup = cleanup;
          error.message += '\nBrowser cleanup evidence: ' + JSON.stringify({
            controlReleased: cleanup.controlReleased, counts: cleanup.counts, windowState: cleanup.windowState,
            failedTabIds: cleanup.entries.filter(row => row.state === 'failed').map(row => row.tabId),
            unknownTabIds: cleanup.entries.filter(row => row.state === 'unknown').map(row => row.tabId),
          });
        } catch { /* Preserve non-extensible original errors. */ }
      }
      throw error;
    } finally { ticket?.dispose(); }
  })();
  state.running = task;
  try { const result = await task; finishes.delete(sessionId); return result; }
  catch (error) { if (!state.keep) finishes.delete(sessionId); throw error; }
  finally { state.running = undefined; }
}

export function armTaskCompletion(ctx, deps, parse) {
  if (typeof ctx.on !== 'function') return () => {};
  let active = true;
  const cleanup = async (agent, signal, idleOnly = false) => {
    if (!active || !agent?.id) return;
    // Direct owners only: a parent's completed turn must not stop a running child.
    const eligible = () => active && !signal?.aborted && (!idleOnly || agent.status === 'idle');
    for (const id of deps.registry.ownedByDsh(agent.id)) {
      if (!eligible()) break;
      if (deps.registry.dshOwnersOf(id)[0] !== agent.id) continue;
      if (deps.dshUserWaits?.get(id)) continue;
      const taskEligible = () => eligible() && !deps.dshUserWaits?.get(id);
      // Native stop preserves human-touched/borrowed pages and guarded forms.
      // Temporary AI-created pages must not all become permanent result tabs.
      try { await finishBrowserTask(deps, { session: id }, { signal }, parse, { eligible: taskEligible }); }
      catch (error) { console.warn('[browser-skill] Task completion cleanup failed; pages retained:', error.message); }
    }
  };
  const disposers = [
    ctx.on('agent/turn-stopping', ({ agent, signal }) => cleanup(agent, signal)),
    ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') void cleanup(agent, undefined, true); })
  ];
  return () => { active = false; for (const dispose of disposers) dispose(); };
}
