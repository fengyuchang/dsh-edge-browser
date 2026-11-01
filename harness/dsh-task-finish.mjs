// Ending a turn always releases control. The model chooses which result pages to keep.
const pending = new WeakMap();
export async function finishBrowserTask(deps, args, exec, parse, { keepAll = false, eligible = () => true } = {}) {
  if (args.requestId !== undefined) throw new Error('finish requires session; requestId is for stop recovery only');
  const requested = args.keepTabIds ?? [];
  if (!Array.isArray(requested) || requested.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(requested).size !== requested.length) {
    throw new Error('keepTabIds must be an array of unique positive tab IDs from this task');
  }
  const sessionId = deps.registry.resolveForStop(args.session);
  const requestId = deps.registry.requestFor(sessionId);
  let finishes = pending.get(deps);
  if (!finishes) pending.set(deps, finishes = new Map());
  let state = finishes.get(sessionId);
  if (state?.requestId !== requestId) state = undefined;
  if (state?.running) return state.running;
  if (state?.keep && !keepAll && JSON.stringify(requested) !== JSON.stringify(state.requested)) throw new Error('A partial finish is pending; retry with the original keepTabIds');
  if (!state) finishes.set(sessionId, state = { requestId, requested: [...requested], returned: new Set() });
  const task = (async () => {
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
      if (requested.some(id => !ids.has(id) && !state.keep?.includes(id))) throw new Error('keepTabIds contains a page outside this task; no pages were closed');
      if (!eligible()) return null; // An idle event may have raced the next user turn.
      const keep = state.keep = [...new Set([...(state.keep ?? requested), ...(keepAll ? ids : [])])];
      deps.registry.markForCleanup(sessionId); // Reject further input while transferring and stopping.
      for (const id of keep) if (!state.returned.has(id)) {
        await run(['tab', 'return', String(id)]);
        state.returned.add(id);
      }
      return keep;
    }, exec.signal);
    if (preserved === null) return { skipped: true };
    if (deps.registry.requestFor(sessionId) !== requestId) throw new Error('Browser ownership changed before stop');
    const result = await deps.starts.stop({ sessionId, signal: exec.signal });
    return { ...result, keptTabIds: preserved, controlReleased: true };
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
      try { await finishBrowserTask(deps, { session: id }, { signal }, parse, { keepAll: true, eligible }); }
      catch (error) { console.warn('[browser-skill] Task completion cleanup failed; pages retained:', error.message); }
    }
  };
  const disposers = [
    ctx.on('agent/turn-stopping', ({ agent, signal }) => cleanup(agent, signal)),
    ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') void cleanup(agent, undefined, true); })
  ];
  return () => { active = false; for (const dispose of disposers) dispose(); };
}
