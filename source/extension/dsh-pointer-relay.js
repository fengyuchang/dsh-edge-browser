import { dshVisualStates, dshPointerPositions, dshSendVisual } from './dsh-visual-activity.js';
const pointerQueues = new Map();
function enqueuePointer(tabId, message) {
  let queue = pointerQueues.get(tabId);
  if (!queue) pointerQueues.set(tabId, queue = { pending: [], stopped: false, running: false });
  const last = queue.pending.at(-1);
  if (message.action === 'mouseMoved' && last?.action === 'mouseMoved') queue.pending[queue.pending.length - 1] = message;
  else queue.pending.push(message);
  if (queue.running) return;
  queue.running = true;
  void (async () => {
    try { while (!queue.stopped && queue.pending.length) await dshSendVisual(tabId, queue.pending.shift(), () => !queue.stopped); }
    finally { if (pointerQueues.get(tabId) === queue) pointerQueues.delete(tabId); }
  })().catch(() => {});
}
// Visualize this extension's actual CDP mouse input, never the desktop mouse.
async function dshCdpCommand(target, method, params) {
  if (method === 'Input.dispatchMouseEvent' && Number.isInteger(target?.tabId) &&
      ['mouseMoved', 'mousePressed', 'mouseReleased', 'mouseWheel'].includes(params?.type) &&
      Number.isFinite(params.x) && Number.isFinite(params.y)) {
    const message = { type: 'dsh-automation-pointer', action: params.type, x: params.x, y: params.y,
      deltaY: params.deltaY, edgeScroll: dshVisualStates.get(target.tabId)?.action === 'hover' && dshVisualStates.get(target.tabId)?.phase === 'running' };
    if (params.x >= 0 && params.y >= 0) dshPointerPositions.set(target.tabId, { ...message, restore: true, edgeScroll: false });
    enqueuePointer(target.tabId, message); // Cosmetic work never delays native input.
  }
  return chrome.debugger.sendCommand(target, method, params);
}

function dshInstallPointerRelay() {
chrome.debugger.onDetach.addListener(target => {
  if (Number.isInteger(target.tabId)) {
    const queue = pointerQueues.get(target.tabId); if (queue) { queue.stopped = true; queue.pending.length = 0; }
    dshVisualStates.delete(target.tabId); dshPointerPositions.delete(target.tabId);
    chrome.tabs.sendMessage(target.tabId, { type: 'dsh-visual-reset' }, { frameId: 0 }).catch(() => {});
  }
});
}

export { dshCdpCommand, dshInstallPointerRelay };
