// Only native-validated sessions may be held or receive a human annotation.
let dshBrowserSessions;
const dshAnnotationLocks = new Map();
const dshAnnotationRunning = new Map();
const dshAnnotationDrafts = new Map();
const DSH_ANNOTATION_HOST = (typeof __DSH_HARNESS_URL__ === 'string' ? __DSH_HARNESS_URL__ : 'http://127.0.0.1:3080') + '/bsk-observation/annotations';

function dshReleaseAnnotation(sessionId, submitted = false) {
  const lock = dshAnnotationLocks.get(sessionId);
  if (!lock) return;
  clearTimeout(lock.timer);
  dshAnnotationLocks.delete(sessionId);
  lock.release(submitted);
}

async function dshAnnotationOperation(dispatcher, request, signal, operation) {
  dshBrowserSessions = dispatcher.sessions;
  const sessionId = request.params?.session_id;
  if (!sessionId) return operation();
  if (request.method === 'tool.session_stop' || (request.method === 'tool.tab_return' && dshAnnotationLocks.get(sessionId)?.tabId === request.params.tab_id)) dshReleaseAnnotation(sessionId);
  else {
    const lock = dshAnnotationLocks.get(sessionId);
    if (lock) {
      let abort;
      try {
        const submitted = await Promise.race([lock.promise, new Promise((_, reject) => {
          abort = () => reject(signal.reason ?? new Error('Operation cancelled'));
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        })]);
        if (submitted) return { code: 'cancelled', message: 'The user sent a browser annotation to this conversation. Read the new feedback and observe the page again before acting.' };
      } finally { if (abort) signal?.removeEventListener('abort', abort); }
    }
  }
  let done;
  const running = new Promise(resolve => { done = resolve; });
  dshAnnotationRunning.set(sessionId, running);
  try { return await operation(); }
  finally { if (dshAnnotationRunning.get(sessionId) === running) dshAnnotationRunning.delete(sessionId); done(); }
}

async function dshAnnotationFetch(path, body) {
  const response = await fetch(DSH_ANNOTATION_HOST + path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-browser-extension': chrome.runtime.id },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000), credentials: 'omit', redirect: 'error'
  });
  if ([404, 405].includes(response.status)) throw new Error('请正常退出并重开 Harness，以启用局部标注接收功能。');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '未能发送标注，请重试。');
  return result;
}

function dshInstallAnnotations() {
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'dsh-annotate') return;
  try {
    tab ??= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!Number.isInteger(tab?.id) || !dshBrowserSessions?.findByWindowId(tab.windowId)) return;
    await chrome.tabs.sendMessage(tab.id, { kind: 'dsh-annotation-open' }, { frameId: 0 });
  } catch (error) { console.warn('[dsh-annotation] shortcut failed', error); }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['dsh-annotation-begin', 'dsh-annotation-submit', 'dsh-annotation-cancel'].includes(message?.kind)) return;
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) return;
  (async () => {
    const tab = await chrome.tabs.get(sender.tab.id);
    if (message.kind !== 'dsh-annotation-begin') {
      const draft = dshAnnotationDrafts.get(message.token);
      if (!draft || draft.tabId !== tab.id) throw new Error('标注已过期，请重新框选。');
      if (message.kind === 'dsh-annotation-cancel') {
        dshReleaseAnnotation(draft.sessionId);
        dshAnnotationDrafts.delete(message.token);
        return { cancelled: true };
      }
      const result = await dshAnnotationFetch('/submit', { ...message.annotation, token: message.token });
      dshReleaseAnnotation(draft.sessionId, true);
      return result;
    }
    const session = dshBrowserSessions?.findByWindowId(tab.windowId);
    if (!session || dshAnnotationLocks.has(session.sessionId)) throw new Error('此页面当前不能开始标注，请稍后重试。');
    let release;
    const lock = { tabId: tab.id, expiresAt: Date.now() + 5 * 60 * 1000, promise: new Promise(resolve => { release = resolve; }), release };
    lock.timer = setTimeout(() => dshReleaseAnnotation(session.sessionId), 5 * 60 * 1000);
    dshAnnotationLocks.set(session.sessionId, lock);
    try {
      let timer;
      try {
        await Promise.race([dshAnnotationRunning.get(session.sessionId) ?? Promise.resolve(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('当前操作仍在执行，请稍后再标注。')), 12000); })]);
      } finally { clearTimeout(timer); }
      const context = await dshAnnotationFetch('/context', { browserSessionId: session.sessionId });
      // Capture the owned task tab without focusing the OS window.
      let image;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'bsk/capture-suppress', phase: 'begin' }, { frameId: 0 });
        image = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      } finally { await chrome.tabs.sendMessage(tab.id, { type: 'bsk/capture-suppress', phase: 'end' }, { frameId: 0 }).catch(() => {}); }
      if (dshAnnotationLocks.get(session.sessionId) !== lock) throw new Error('标注准备超时，请重试。');
      dshAnnotationDrafts.set(context.token, { tabId: tab.id, sessionId: session.sessionId, createdAt: Date.now() });
      for (const [token, draft] of dshAnnotationDrafts) if (Date.now() - draft.createdAt > 10 * 60 * 1000) dshAnnotationDrafts.delete(token);
      return { ...context, expiresAt: lock.expiresAt, snapshot: 'data:image/png;base64,' + image.data, url: tab.url, title: tab.title };
    } catch (error) { dshReleaseAnnotation(session.sessionId); throw error; }
  })().then(value => respond({ ok: true, ...value }), error => respond({ ok: false, error: error.message || '标注操作未完成。' }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const [sessionId, lock] of dshAnnotationLocks) if (lock.tabId === tabId) dshReleaseAnnotation(sessionId);
  for (const [token, draft] of dshAnnotationDrafts) if (draft.tabId === tabId) dshAnnotationDrafts.delete(token);
});
chrome.webNavigation.onCommitted.addListener(event => {
  if (event.frameId !== 0) return;
  for (const [sessionId, lock] of dshAnnotationLocks) if (lock.tabId === event.tabId) dshReleaseAnnotation(sessionId, true);
  for (const [token, draft] of dshAnnotationDrafts) if (draft.tabId === event.tabId) dshAnnotationDrafts.delete(token);
});
}

export { dshAnnotationOperation, dshInstallAnnotations };
