import { expectedTabMoves } from '@/session-manager/tab-moves';
import { dshVisualStates, dshPointerPositions } from './dsh-visual-activity.js';
import { dshRestoreTabAudio } from './dsh-task-groups.js';
// Preserve a task-created tab as an ordinary page using the native tab-return seam.
// Borrowed user tabs always follow upstream's original-window return path.
const dshKeptTaskTabs = new WeakMap();
async function dshKeepTaskTab(session, params, options, overlay) {
  const tabId = params.tab_id;
  let state = dshKeptTaskTabs.get(session);
  if (!state) dshKeptTaskTabs.set(session, state = { receipts: new Map() });
  if (!session.agentCreatedTabs.has(tabId) && !state.receipts.has(tabId)) {
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
        state.placeholderId = window.tabs?.[0]?.id;
        await chrome.windows.update(state.windowId, { state: 'minimized' }).catch(() => {});
      }
      await expectedTabMoves.run({ tabId, fromWindowId: tab.windowId, toWindowId: state.windowId },
        () => chrome.tabs.move(tabId, { windowId: state.windowId, index: -1 }));
      tab = await chrome.tabs.get(tabId);
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

export { dshKeepTaskTab };
