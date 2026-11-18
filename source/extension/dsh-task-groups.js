// Track task windows without leaving persistent browser tab groups behind.
const dshTaskWindows = new Set();
const dshMutedTabs = new Set();
// ponytail: reuse only windows recorded by this worker; after restart, create
// a fresh window rather than infer ownership from ordinary browser tab titles.
const dshIdleTaskWindows = new Set(), dshReservedTaskWindows = new Set();
const dshResultWindows = new Map(), dshReusedWindows = new Map();
const dshRetainedIdleTabs = new Map();
function dshIsRetainedIdleTab(windowId, tabId) { return dshRetainedIdleTabs.get(windowId)?.has(tabId) === true; }
function dshRememberResultWindow(windowId, sessionId, tabId) {
  dshResultWindows.set(windowId, sessionId);
  if (Number.isInteger(tabId)) {
    let tabs = dshRetainedIdleTabs.get(windowId);
    if (!tabs) dshRetainedIdleTabs.set(windowId, tabs = new Set());
    tabs.add(tabId);
  }
}

function dshSyncTaskWindows(sessions) {
  const liveWindows = new Set(sessions.map(s => s.agentWindowId)), liveSessions = new Set(sessions.map(s => s.sessionId));
  for (const id of liveWindows) { dshReservedTaskWindows.delete(id); dshIdleTaskWindows.delete(id); }
  for (const id of [...dshTaskWindows]) {
    if (liveWindows.has(id) || dshReservedTaskWindows.has(id)) continue;
    dshTaskWindows.delete(id); dshIdleTaskWindows.add(id); dshReusedWindows.delete(id); dshRetainedIdleTabs.delete(id);
    void chrome.tabs.query({ windowId: id }).then(async tabs => {
      if (dshTaskWindows.has(id)) return;
      await Promise.all(tabs.map(dshRestoreTabAudio));
    }).catch(() => {});
  }
  for (const [id, owner] of dshResultWindows) if (!liveSessions.has(owner) && !liveWindows.has(id) && !dshReservedTaskWindows.has(id)) dshIdleTaskWindows.add(id);
}

async function dshAcquireIdleTaskWindow(url) {
  for (const id of [...dshIdleTaskWindows]) {
    dshIdleTaskWindows.delete(id); dshResultWindows.delete(id); dshReservedTaskWindows.add(id);
    try {
      const window = await chrome.windows.get(id);
      if (window.focused || window.incognito || window.type !== 'normal') { dshIdleTaskWindows.add(id); continue; }
      const retained = await chrome.tabs.query({ windowId: id });
      if ((await chrome.windows.get(id)).focused) { dshIdleTaskWindows.add(id); continue; }
      dshRetainedIdleTabs.set(id, new Set(retained.map(tab => tab.id)));
      dshTaskWindows.add(id);
      const tab = await chrome.tabs.create({ windowId: id, url, active: true });
      dshReusedWindows.set(id, new Set([tab.id]));
      return { ...window, tabs: [tab] }; // Existing result tabs are never claimed.
    } catch { dshTaskWindows.delete(id); dshReusedWindows.delete(id); dshRetainedIdleTabs.delete(id); }
    finally { if (!dshReusedWindows.has(id)) dshReservedTaskWindows.delete(id); }
  }
  return null;
}

async function dshRemoveTaskWindow(windowId) {
  const owned = dshReusedWindows.get(windowId);
  if (owned) {
    const tabs = await chrome.tabs.query({ windowId });
    if (tabs.some(tab => !owned.has(tab.id))) {
      // Failed initialization must not close results already in a reused window.
      for (const tab of tabs) if (owned.has(tab.id)) await chrome.tabs.remove(tab.id);
      dshReservedTaskWindows.delete(windowId); dshReusedWindows.delete(windowId); dshRetainedIdleTabs.delete(windowId);
      dshTaskWindows.delete(windowId); dshIdleTaskWindows.add(windowId); return;
    }
  }
  await chrome.windows.remove(windowId);
}

async function dshMuteTaskTab(tab) {
  if (!dshTaskWindows.has(tab.windowId) || !Number.isInteger(tab.id) || tab.mutedInfo?.muted) return;
  dshMutedTabs.add(tab.id);
  try { await chrome.tabs.update(tab.id, { muted: true }); }
  catch (error) {
    dshMutedTabs.delete(tab.id);
    console.warn('[DSH] Task tab muting unavailable:', error.message);
  }
}

async function dshRestoreTabAudio(tab) {
  if (dshTaskWindows.has(tab.windowId) || !dshMutedTabs.has(tab.id)) return;
  // Only undo our own mute when a borrowed tab returns to a personal window.
  const muted = tab.mutedInfo;
  if (muted?.muted && muted.reason === 'extension' && muted.extensionId === chrome.runtime.id) {
    await chrome.tabs.update(tab.id, { muted: false });
  }
  dshMutedTabs.delete(tab.id);
}

async function dshGroupAgentWindow(window) {
  dshReservedTaskWindows.add(window.id);
  dshTaskWindows.add(window.id);
  await Promise.all((window.tabs || []).map(tab => dshMuteTaskTab({ ...tab, windowId: window.id })));
}

async function dshClearLegacyTaskGroups() {
  // Cosmetic migration of the old exact title/color only. Keep every page;
  // these restored groups never establish task ownership or window reuse.
  const groups = await chrome.tabGroups.query({ title: 'DeepSeek Harness', color: 'blue' });
  for (const group of groups) {
    const current = await chrome.tabGroups.get(group.id).catch(() => null);
    if (!current || current.title !== 'DeepSeek Harness' || current.color !== 'blue' || current.windowId !== group.windowId) continue;
    const tabs = await chrome.tabs.query({ windowId: group.windowId, groupId: group.id });
    const ids = tabs.filter(tab => tab.groupId === group.id && tab.windowId === group.windowId && Number.isInteger(tab.id)).map(tab => tab.id);
    if (ids.length) await chrome.tabs.ungroup(ids).catch(() => {});
  }
}

function dshInstallTaskGroups() {
const clearLegacy = () => { void dshClearLegacyTaskGroups().catch(error => console.warn('[DSH] Legacy task label cleanup unavailable:', error.message)); };
clearLegacy();
chrome.runtime.onStartup?.addListener(clearLegacy);
chrome.tabs.onCreated.addListener(async tab => {
  await dshMuteTaskTab(tab);
});
chrome.tabs.onAttached.addListener(async tabId => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await dshMuteTaskTab(tab);
    await dshRestoreTabAudio(tab);
  } catch (error) { console.warn('[DSH] Task tab audio update unavailable:', error.message); }
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.audible === true) void dshMuteTaskTab(tab);
});
chrome.tabs.onRemoved.addListener(tabId => dshMutedTabs.delete(tabId));
chrome.windows.onRemoved.addListener(windowId => {
  dshIdleTaskWindows.delete(windowId); dshReservedTaskWindows.delete(windowId); dshResultWindows.delete(windowId); dshReusedWindows.delete(windowId); dshRetainedIdleTabs.delete(windowId);
  dshTaskWindows.delete(windowId);
});
}

export { dshGroupAgentWindow, dshRestoreTabAudio, dshInstallTaskGroups, dshRememberResultWindow, dshSyncTaskWindows, dshAcquireIdleTaskWindow, dshRemoveTaskWindow, dshIsRetainedIdleTab };
