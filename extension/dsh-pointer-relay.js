// Visualize this extension's actual CDP mouse input, never the desktop mouse.
async function dshCdpCommand(target, method, params) {
  if (method === 'Input.dispatchMouseEvent' && Number.isInteger(target?.tabId) &&
      ['mouseMoved', 'mousePressed', 'mouseReleased', 'mouseWheel'].includes(params?.type) &&
      Number.isFinite(params.x) && Number.isFinite(params.y)) {
    const message = { type: 'dsh-automation-pointer', action: params.type, x: params.x, y: params.y,
      deltaY: params.deltaY, edgeScroll: dshVisualStates.get(target.tabId)?.action === 'hover' && dshVisualStates.get(target.tabId)?.phase === 'running' };
    if (params.x >= 0 && params.y >= 0) dshPointerPositions.set(target.tabId, { ...message, restore: true, edgeScroll: false });
    try {
      let reply;
      try { reply = await chrome.tabs.sendMessage(target.tabId, message, { frameId: 0 }); } catch {}
      if (!reply?.dshPointer) {
        await chrome.scripting.executeScript({ target: { tabId: target.tabId, frameIds: [0] }, files: ['content-scripts/dsh-pointer.js'] });
        await chrome.tabs.sendMessage(target.tabId, message, { frameId: 0 });
      }
    } catch {} // A cosmetic failure must never prevent the actual browser input.
  }
  return chrome.debugger.sendCommand(target, method, params);
}

chrome.debugger.onDetach.addListener(target => {
  if (Number.isInteger(target.tabId)) {
    dshVisualStates.delete(target.tabId); dshPointerPositions.delete(target.tabId);
    chrome.tabs.sendMessage(target.tabId, { type: 'dsh-visual-reset' }, { frameId: 0 }).catch(() => {});
  }
});
