// Observe validated native operations. Visual failures never change their result.
const dshVisualStates = new Map();
const dshPointerPositions = new Map();
const dshVisualActions = {
  click: '点击目标', hover: '移动指针', fill: '填写输入框', press: '按键操作',
  select: '选择选项', focus: '定位输入框', blur: '离开输入框',
  wheel: '滚动页面', scroll_to: '滚动到目标',
  observe: '读取页面', snapshot: '读取页面结构', extract: '提取页面数据', get_html: '读取页面内容',
  navigate: '打开网页', navigate_back: '返回上一页', navigate_forward: '前往下一页', reload: '刷新网页',
  upload: '上传文件', download: '下载文件', wait_for_element: '等待页面元素', wait_for_navigation: '等待网页加载'
};

async function dshSendVisual(tabId, message) {
  try {
    let reply;
    try { reply = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }); } catch {}
    if (!reply?.dshVisual) {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content-scripts/dsh-pointer.js'] });
      await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    }
  } catch {} // Restricted pages must still receive the original native operation.
}

async function dshVisualOperation(dispatcher, request, operation) {
  const action = request.method?.replace(/^tool\./, '');
  const label = dshVisualActions[action];
  let tab, session;
  if (label) try {
    session = dispatcher.sessions.get(request.params?.session_id);
    if (session) {
      tab = Number.isInteger(request.params?.tab_id)
        ? await chrome.tabs.get(request.params.tab_id)
        : (await chrome.tabs.query({ windowId: session.agentWindowId, active: true }))[0];
    }
  } catch {}
  if (!tab || tab.windowId !== session?.agentWindowId) return operation();
  const state = { id: request.id, sessionId: request.params.session_id, action, label, phase: 'running' };
  dshVisualStates.set(tab.id, state);
  await dshSendVisual(tab.id, { type: 'dsh-visual-activity', ...state });
  try {
    const result = await operation();
    state.phase = result && typeof result.code === 'string' && typeof result.message === 'string' ? 'error' : 'complete';
    return result;
  } catch (error) {
    state.phase = 'error'; throw error;
  } finally {
    if (dshVisualStates.get(tab.id) === state) await dshSendVisual(tab.id, { type: 'dsh-visual-activity', ...state });
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.kind !== 'dsh-visual-ready' || sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id)) return;
  respond({ activity: dshVisualStates.get(sender.tab.id), pointer: dshPointerPositions.get(sender.tab.id) });
});
chrome.tabs.onRemoved.addListener(tabId => { dshVisualStates.delete(tabId); dshPointerPositions.delete(tabId); });
