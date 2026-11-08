// Group only tabs created inside BrowserSkill-owned task windows.
// Borrowed user tabs are left to BrowserSkill's normal return workflow.
const dshTaskGroups = new Map();
const dshTaskWindows = new Set();
const dshMutedTabs = new Set();
// ponytail: reuse only windows recorded by this worker; after restart, create
// a fresh window rather than infer ownership from ordinary browser tab titles.
const dshIdleTaskWindows = new Set(), dshReservedTaskWindows = new Set();
const dshResultWindows = new Map(), dshReusedWindows = new Map();
const dshRetainedIdleTabs = new Map();
function dshIsRetainedIdleTab(windowId, tabId) { return dshRetainedIdleTabs.get(windowId)?.has(tabId) === true; }
function dshRememberResultWindow(windowId, sessionId) { dshResultWindows.set(windowId, sessionId); }

function dshSyncTaskWindows(sessions) {
  const liveWindows = new Set(sessions.map(s => s.agentWindowId)), liveSessions = new Set(sessions.map(s => s.sessionId));
  for (const id of liveWindows) { dshReservedTaskWindows.delete(id); dshIdleTaskWindows.delete(id); }
  for (const id of [...dshTaskWindows]) {
    if (liveWindows.has(id) || dshReservedTaskWindows.has(id)) continue;
    dshTaskWindows.delete(id); dshIdleTaskWindows.add(id); dshReusedWindows.delete(id); dshRetainedIdleTabs.delete(id);
    const groupId = dshTaskGroups.get(id); dshTaskGroups.delete(id);
    void chrome.tabs.query({ windowId: id }).then(async tabs => {
      if (dshTaskWindows.has(id)) return;
      const grouped = tabs.filter(tab => tab.groupId === groupId).map(tab => tab.id);
      if (grouped.length) await chrome.tabs.ungroup(grouped).catch(() => {});
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
  try {
    const tabIds = (window.tabs || []).map(tab => tab.id).filter(Number.isInteger);
    if (!tabIds.length) return;
    // The API otherwise defaults to the current window and moves these tabs.
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: window.id } });
    await chrome.tabGroups.update(groupId, { title: 'DeepSeek Harness', color: 'blue', collapsed: false });
    dshTaskGroups.set(window.id, groupId);
  } catch (error) {
    console.warn('[DSH] Task tab grouping unavailable:', error.message);
  }
}

function dshInstallTaskGroups() {
chrome.tabs.onCreated.addListener(async tab => {
  await dshMuteTaskTab(tab);
  const groupId = dshTaskGroups.get(tab.windowId);
  if (groupId === undefined || !Number.isInteger(tab.id)) return;
  try { await chrome.tabs.group({ groupId, tabIds: [tab.id] }); }
  catch (error) { console.warn('[DSH] Task tab grouping failed:', error.message); }
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
  dshTaskGroups.delete(windowId);
  dshTaskWindows.delete(windowId);
});
chrome.tabGroups.onRemoved.addListener(group => {
  if (dshTaskGroups.get(group.windowId) === group.id) dshTaskGroups.delete(group.windowId);
});
}

export { dshGroupAgentWindow, dshRestoreTabAudio, dshInstallTaskGroups, dshRememberResultWindow, dshSyncTaskWindows, dshAcquireIdleTaskWindow, dshRemoveTaskWindow, dshIsRetainedIdleTab };
