// Resolve omitted browser sessions within the calling conversation, never globally.
export async function executeScopedBrowserAction(deps, toolName, args, exec, run) {
  const owner = exec.agent?.id;
  if (!owner) return run(args); // Native internal callers carry no conversation identity.
  const owned = deps.registry.ownedByDsh(owner);
  const records = [...(deps.starts?.journal?.records?.values() ?? [])].filter(record => record.owners.includes(owner));
  const sessionTool = toolName === 'bsk_session';
  const refuse = () => { throw new Error('此浏览器任务不属于当前聊天。请在本会话新建浏览器任务；不会使用其他会话的窗口。'); };
  if (sessionTool && args.action === 'start') return run(args);
  if (sessionTool && args.action === 'list') {
    const result = await run(args);
    const sessions = result.sessions.filter(entry => owned.includes(entry.sessionId));
    const current = sessions.find(entry => entry.current)?.sessionId ?? sessions.at(-1)?.sessionId;
    return { ...result, sessions: sessions.map(entry => ({ ...entry, current: entry.sessionId === current })), pendingCleanup: records.filter(record => record.cleanup).length };
  }
  if (sessionTool && args.action === 'stop') {
    if (args.requestId !== undefined) {
      if (!records.some(record => record.requestId === args.requestId)) refuse();
      return run(args);
    }
    if (args.session !== undefined) {
      if (!owned.includes(args.session) && !records.some(record => record.session?.sessionId === args.session && record.stop !== undefined)) refuse();
      return run(args);
    }
    const receipts = records.filter(record => record.stop !== undefined);
    if (receipts.length > 1) throw new Error('本会话有多个停止回执，请指定本会话的 session 或 requestId。');
    if (receipts.length === 1) return run({ ...args, requestId: receipts[0].requestId });
    if (!owned.length) {
      const pending = records.filter(record => record.cleanup);
      if (pending.length === 1) return run({ ...args, requestId: pending[0].requestId });
      refuse();
    }
  }
  if (args.session !== undefined) {
    if (!owned.includes(args.session)) refuse();
    return run(args);
  }
  const active = deps.registry.list().filter(entry => owned.includes(entry.sessionId));
  const session = active.find(entry => entry.sessionId === deps.registry.current())?.sessionId ?? active.at(-1)?.sessionId;
  if (!session) refuse();
  return run({ ...args, session });
}
