import { expectedTabMoves } from '@/session-manager/tab-moves';
import { dshVisualStates, dshPointerPositions } from './dsh-visual-activity.js';
import { dshRestoreTabAudio, dshRememberResultWindow } from './dsh-task-groups.js';
// Preserve a task-created tab as an ordinary page using the native tab-return seam.
// Borrowed user tabs always follow upstream's original-window return path.
const dshKeptTaskTabs = new WeakMap();

function dshWithCleanupReceipt(manager, params, operation) {
  const session = manager.get(params?.session_id);
  if (!session || typeof chrome === 'undefined' || !/^[a-p]{32}$/.test(chrome.runtime?.id ?? '')) return operation();
  return (async () => {
  const post = async body => {
    const response = await fetch(__DSH_HARNESS_URL__ + '/bsk-observation/task-cleanup', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-browser-extension': chrome.runtime.id },
      body: JSON.stringify({ sessionId: session.sessionId, ...body }), signal: AbortSignal.timeout(500),
    });
    if (!response.ok) return undefined;
    return response.json();
  };
  const ticket = await post({ action: 'begin' }).catch(() => undefined);
  if (!ticket?.token || !ticket.requestId || !Array.isArray(ticket.tabIds) || ticket.tabIds.length > 512 || ticket.tabIds.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ticket.tabIds).size !== ticket.tabIds.length || !Array.isArray(ticket.keepIds) || ticket.keepIds.some(id => !ticket.tabIds.includes(id))) return operation();
  // Only inspect IDs from this session, including pages explicitly returned by
  // the invoking finish. The authenticated peer supplies no page content.
  const borrowed = new Set(session.borrowedTabs.keys()), observed = new Set(session.observedTabs ?? []), created = new Set(session.agentCreatedTabs);
  try { return await operation(); }
  finally {
    try {
      const entries = await Promise.all(ticket.tabIds.map(async tabId => {
        try {
          await chrome.tabs.get(tabId);
          const reason = ticket.keepIds.includes(tabId) ? 'requested' : borrowed.has(tabId) ? 'borrowed' : observed.has(tabId) ? 'human_or_user' : !created.has(tabId) ? 'previous_result_or_user' : !session.agentCreatedTabs.has(tabId) ? 'form_or_uncertain_content' : 'cleanup_failed';
          return { tabId, state: reason === 'cleanup_failed' ? 'failed' : 'retained', reason };
        } catch (error) {
          return /No tab with id|Invalid tab ID/i.test(String(error?.message))
            ? { tabId, state: 'closed', reason: 'tab_absent' }
            : { tabId, state: 'unknown', reason: 'query_failed' };
        }
      }));
      let windowState = 'unknown';
      try { await chrome.windows.get(session.agentWindowId); windowState = 'retained'; }
      catch (error) { if (/No window with id|Invalid window ID/i.test(String(error?.message))) windowState = 'closed'; }
      await post({ action: 'complete', token: ticket.token, requestId: ticket.requestId, entries, windowState, controlReleased: manager.get(session.sessionId) !== session });
    } catch {} // Evidence failure never changes the real stop result or error.
  }
  })();
}

// Runs only at task cleanup. Return a boolean, never field values or secrets.
function dshPageNeedsPreserving() {
  if (document.readyState === 'loading') return true;
  const visit = root => {
    for (const el of root.querySelectorAll('input,textarea,select,[contenteditable]')) {
      if (el.disabled || el.readOnly) continue;
      if (el.isContentEditable && el.textContent.trim()) return true;
      const type = String(el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'range', 'color', 'search'].includes(type) || el.closest('[role="search"]')) continue;
      let search = false;
      try { search = /^(q|query|search|keyword)$/i.test(el.name) && /(^|\/)search(\/|$)/i.test(new URL(el.form?.action || '', location.href).pathname); } catch {}
      if (search) continue;
      if (type === 'checkbox' || type === 'radio') { if (el.checked !== el.defaultChecked) return true; continue; }
      if (el.tagName === 'SELECT') {
        const options = [...el.options], hasDefault = options.some(option => option.defaultSelected);
        if (options.some((option, index) => option.selected !== (option.defaultSelected || (!hasDefault && !el.multiple && index === 0)))) return true;
        continue;
      }
      if (type === 'file') { if (el.files?.length) return true; continue; }
      if (typeof el.value === 'string' && el.value.trim()) return true;
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.matches('browser-skill-overlay,[data-bsk-overlay]')) continue;
      const shadow = el.shadowRoot || (el instanceof HTMLElement ? globalThis.chrome?.dom?.openOrClosedShadowRoot?.(el) : undefined);
      if (shadow && visit(shadow)) return true;
    }
    return false;
  };
  return visit(document);
}

async function dshProtectTaskForms(session) {
  await Promise.all([...session.agentCreatedTabs].map(async tabId => {
    let timer, preserve = true;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId !== session.agentWindowId) return;
      if (tab.url === 'about:blank') return;
      const frames = await Promise.race([
        chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: dshPageNeedsPreserving, injectImmediately: true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Form check timed out')), 1500); }),
      ]);
      preserve = !frames?.length || frames.some(frame => frame.result !== false);
    } catch { /* Unknown content stays open; cleanup may never discard a form blindly. */ }
    finally { clearTimeout(timer); }
    if (preserve && session.agentCreatedTabs.delete(tabId)) (session.observedTabs ??= new Set()).add(tabId);
  }));
}
async function dshKeepTaskTab(session, params, options, overlay) {
  const tabId = params.tab_id;
  let state = dshKeptTaskTabs.get(session);
  if (!state) dshKeptTaskTabs.set(session, state = { receipts: new Map() });
  // Native cooperation protects human-touched task tabs by moving them from
  // agentCreatedTabs to observedTabs. They still belong to this task window.
  if ((!session.agentCreatedTabs.has(tabId) && !session.observedTabs?.has(tabId) && !state.receipts.has(tabId)) || session.borrowedTabs?.has(tabId)) {
    return { code: 'not_found', message: `tab_return: tab ${tabId} is not owned by this session` };
  }
  if (options.signal?.aborted) return { code: 'cancelled', message: 'tab_return aborted before preserving page' };
  try {
    let tab = await chrome.tabs.get(tabId);
    let receipt = state.receipts.get(tabId);
    if (!receipt) {
      if (tab.windowId !== session.agentWindowId) throw new Error('Task page moved before it could be preserved; inspect before retrying');
      await options.beforeReturn?.(session.sessionId, tabId);
      // Keep the task window alive until session.stop acknowledges its teardown.
      if ((await chrome.tabs.query({ windowId: session.agentWindowId })).length === 1) {
        const placeholder = await chrome.tabs.create({ windowId: session.agentWindowId, url: 'about:blank', active: false });
        session.agentCreatedTabs.add(placeholder.id);
      }
      if (options.signal?.aborted) return { code: 'cancelled', message: 'tab_return aborted before moving page' };
      if (state.windowId !== undefined) {
        try { await chrome.windows.get(state.windowId); } catch { state.windowId = undefined; }
      }
      if (state.windowId === undefined) {
        const window = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized', type: 'normal' });
        state.windowId = window.id;
        dshRememberResultWindow(window.id, session.sessionId);
        state.placeholderId = window.tabs?.[0]?.id;
        await chrome.windows.update(state.windowId, { state: 'minimized' }).catch(() => {});
      }
      await expectedTabMoves.run({ tabId, fromWindowId: tab.windowId, toWindowId: state.windowId },
        () => chrome.tabs.move(tabId, { windowId: state.windowId, index: -1 }));
      tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(state.windowId, { state: 'minimized' }).catch(() => {});
      receipt = { tab_id: tabId, returned_to_window_id: tab.windowId, returned_to_index: tab.index, preserved: true };
      state.receipts.set(tabId, receipt); // Keep retries safe if release fails after the move.
      session.agentCreatedTabs.delete(tabId);
      session.observedTabs?.delete(tabId);
      session.refStore.invalidateTab(tabId);
      if (Number.isInteger(state.placeholderId)) {
        await chrome.tabs.remove(state.placeholderId).catch(() => {});
        state.placeholderId = undefined;
      }
    }
    await options.cdp?.releaseSessionTab?.(session.sessionId, tabId);
    await overlay.resetAgentOverlays(tabId, session.sessionId).catch(() => {}); // Restricted/discarded pages may have no content script.
    dshVisualStates.delete(tabId); dshPointerPositions.delete(tabId);
    await dshRestoreTabAudio(await chrome.tabs.get(tabId));
    return receipt;
  } catch (error) {
    return { code: 'cdp_failed', message: `Could not finish preserving page: ${error.message}`, data: { effect_state: 'unknown' } };
  }
}

export { dshKeepTaskTab, dshProtectTaskForms, dshPageNeedsPreserving, dshWithCleanupReceipt };
