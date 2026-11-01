// Group only tabs created inside BrowserSkill-owned task windows.
// Borrowed user tabs are left to BrowserSkill's normal return workflow.
const dshTaskGroups = new Map();
const dshTaskWindows = new Set();
const dshMutedTabs = new Set();

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
  dshTaskGroups.delete(windowId);
  dshTaskWindows.delete(windowId);
});
chrome.tabGroups.onRemoved.addListener(group => {
  if (dshTaskGroups.get(group.windowId) === group.id) dshTaskGroups.delete(group.windowId);
});
