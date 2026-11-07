(() => {
  if (!globalThis.chrome?.runtime?.onMessage) return;
  if (globalThis.__dshControlsInstalled) return;
  globalThis.__dshControlsInstalled = true;
  let host, root, pill, editor, stage, box, note, status, send, frozen;
  let controlDock, activityDock, toast, sessionId, mode = 'hidden', hintsHidden = false;
  let controlCollapsed = false, activity, draft, rect, drag, viewport, regionText = '', elementContext, captureHidden = 0;
  let expiryTimer, toastTimer, busy = false;
  let cooperation, takeoverActive = false, takeoverPending = false;
  const call = async message => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || '扩展没有响应，请重试。');
    return result;
  };
  const raise = () => {
    // Native click bypass rerenders the pill; keep active animations mounted.
    if (host?.isConnected && document.documentElement.lastElementChild === host) return;
    globalThis.dshRaisePointer?.();
    if (host?.isConnected) document.documentElement.append(host);
  };
  const refresh = () => {
    if (!root) return;
    const controlling = mode === 'control' && !!sessionId;
    controlDock.hidden = !takeoverActive || !(controlCollapsed || hintsHidden) || !!draft || busy;
    const takeover = controlDock.querySelector('.takeover');
    takeover.textContent = cooperation?.mode === 'held' ? '完成并交还 AI' : cooperation?.mode === 'yielding' ? '正在暂停 AI…' : '用户插入';
    takeover.disabled = takeoverPending || !cooperation || cooperation.mode === 'yielding';
    activityDock.hidden = !controlling || hintsHidden || !globalThis.dshActivityCollapsed || !activity || !!draft || busy;
    if (pill) pill.style.setProperty('display', controlCollapsed ? 'none' : 'flex', controlCollapsed ? 'important' : '');
    host.style.setProperty('display', captureHidden > 0 || document.hidden ? 'none' : 'block', 'important');
    activityDock.title = activity ? `DeepSeek · ${activity.label}，点击展开` : '展开步骤提示';
    globalThis.dshRefreshActivity?.();
  };
  const notify = text => {
    mount(); toast.textContent = text; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
  };
  const preference = (key, value) => { chrome.storage.local.set({ [key]: value }).catch(() => {}); };
  globalThis.dshCollapseControl = value => { controlCollapsed = value === true; refresh(); preference('dsh_control_collapsed', controlCollapsed); };
  globalThis.dshCollapseActivity = value => { globalThis.dshActivityCollapsed = value === true; refresh(); preference('dsh_activity_collapsed', globalThis.dshActivityCollapsed); };
  globalThis.dshUpdateActivity = value => { activity = value; refresh(); };
  globalThis.dshBindControlPill = element => { pill = element; if (element) { mount(); raise(); refresh(); } };
  globalThis.dshIsAnnotationEvent = event => event.composedPath().includes(host);
  globalThis.dshSetTakeoverState = value => { takeoverActive = value.active; cooperation = value.state; mount(); refresh(); };
  globalThis.dshFocusControlDock = () => {
    if (!controlDock || controlDock.hidden) return false;
    controlDock.querySelector('button:not(:disabled)')?.focus({ preventScroll: true }); return true;
  };

  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'dsh-browser-controls'; host.setAttribute('data-bsk-overlay', '');
    host.dataset.version = 'annotations-2026-11-01-r3';
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host{color-scheme:light}*{box-sizing:border-box} [hidden]{display:none!important}
      button,textarea{font:inherit}button{cursor:pointer;border:0}button:focus-visible,textarea:focus-visible{outline:3px solid #77c4ff;outline-offset:3px}button:disabled{cursor:wait;opacity:.55}
      .dock,.card,.toast{font:13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#edf5ff}
      .dock{position:fixed;pointer-events:auto;background:#18334cf5;box-shadow:0 4px 20px #0003;display:flex;align-items:center;gap:2px;padding:3px;border:1px solid #68849c66}
      .dock button{color:inherit;background:transparent;padding:6px 10px;border-radius:6px;white-space:nowrap}.dock button:hover{background:#ffffff1c}
      .control-dock{bottom:0;left:50%;transform:translateX(-50%);border-radius:10px 10px 0 0}.control-dock .stop{color:#ffbb92}
      .activity-dock{right:0;bottom:115px;border-radius:10px 0 0 10px}
      .editor{position:fixed;inset:0;pointer-events:auto;background:#101b2b33;touch-action:none;cursor:crosshair;font-family:system-ui}
      .frozen{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;user-select:none}
      .stage{position:absolute;inset:0;touch-action:none;cursor:crosshair}
      .box{position:absolute;border:2px solid #ff8b38;background:#ff9c3420;box-shadow:0 0 0 1px #fff9,0 0 0 99999px #10203340;cursor:move;touch-action:none}
      .box::before{content:'标注区域';position:absolute;top:-26px;left:-2px;background:#ee7426;color:white;border-radius:5px 5px 0 0;padding:2px 8px;font:12px/20px system-ui;white-space:nowrap}
      .resize{position:absolute;right:-7px;bottom:-7px;width:15px;height:15px;border:2px solid white;background:#ff8b38;border-radius:3px;cursor:nwse-resize}
      .card{position:absolute;right:20px;top:20px;width:min(340px,calc(100vw - 40px));padding:17px;background:#173149fa;border:1px solid #7294ae66;border-radius:14px;box-shadow:0 12px 50px #0005;cursor:default;pointer-events:auto}
      .heading{display:flex;justify-content:space-between;align-items:center;font-size:16px;font-weight:650}.close{background:transparent;color:#d8e8f5;font-size:20px;width:30px;height:30px;border-radius:6px}
      .hint{margin:7px 0 12px;color:#c2d3e2;font-size:12px}.target{padding:8px;border:1px solid #7294ae66;border-radius:7px;color:#ffe0b8;font-size:12px;overflow-wrap:anywhere}.card label{display:block;margin:10px 0 6px}
      textarea{display:block;width:100%;height:115px;resize:vertical;max-height:40vh;padding:10px;background:#0e2339;color:#fff;border:1px solid #7293ad;border-radius:8px;outline:none;line-height:1.6;user-select:text}
      .actions{display:flex;gap:8px;margin-top:12px}.actions button{padding:8px 13px;border-radius:8px;background:#294960;color:#eaf4fc}.actions .send{flex:1;background:#ff8735;color:#152839;font-weight:700}
      .status{margin-top:10px;min-height:20px;color:#b6d4ed;font-size:12px}.status.error{color:#ffb5ab}
      .toast{position:fixed;left:50%;top:22px;transform:translateX(-50%);max-width:90vw;background:#173149f5;padding:11px 18px;border-radius:10px;box-shadow:0 5px 28px #0003;pointer-events:none}
      :host([data-bypass]) .editor,:host([data-bypass]) .editor *,:host([data-bypass]) .dock,:host([data-bypass]) .dock *{pointer-events:none!important}
      @media(max-width:600px){.card{top:auto;bottom:45px;width:calc(100vw - 30px);right:15px;padding:12px}textarea{height:75px}.hint{margin-bottom:6px}}
    </style>
    <div class="dock control-dock" role="toolbar" aria-label="已收起的 DeepSeek 控制" hidden><button class="takeover">用户插入</button><button class="annotate" title="局部标注（默认 Alt+Shift+A）">▧ 标注</button><button class="expand-control">DeepSeek 控制 ▴</button><button class="stop">中断</button></div>
    <div class="dock activity-dock" hidden><button class="expand-activity" aria-label="展开 DeepSeek 步骤提示">步骤 ◂</button></div>
    <div class="editor" hidden><img class="frozen" alt="用于框选标注的当前网页画面" draggable="false"><div class="stage"><div class="box" hidden><i class="resize"></i></div></div>
      <section class="card" role="dialog" aria-label="局部标注与建议"><div class="heading">局部标注<button class="close" aria-label="取消标注">×</button></div><p class="hint">拖动框选；框内可移动，右下角可调整大小。发送或取消后，DeepSeek 继续操作。</p><div class="target"></div><label for="dsh-note">你的建议</label><textarea id="dsh-note" maxlength="4000" aria-describedby="dsh-note-keys" placeholder="填写建议后按 Enter 发送，Shift+Enter 换行。"></textarea><p class="hint" id="dsh-note-keys">Enter 发送 · Shift+Enter 换行 · Esc 取消</p><div class="actions"><button class="redraw">重新框选</button><button class="send" disabled>✓ 发送建议</button></div><div class="status" role="status" aria-live="polite">正在准备当前画面…</div></section>
    </div><div class="toast" role="status" aria-live="polite" hidden></div>`;
    editor = root.querySelector('.editor'); stage = root.querySelector('.stage'); box = root.querySelector('.box');
    note = root.querySelector('textarea'); status = root.querySelector('.status'); send = root.querySelector('.send'); frozen = root.querySelector('.frozen');
    controlDock = root.querySelector('.control-dock'); activityDock = root.querySelector('.activity-dock'); toast = root.querySelector('.toast');
    // Preserve page focus until native hold/resume has accepted the transition.
    controlDock.addEventListener('pointerdown', event => event.preventDefault());
    root.querySelector('.takeover').onclick = async () => {
      if (!cooperation || takeoverPending || cooperation.mode === 'yielding') return;
      takeoverPending = true; refresh();
      try {
        const result = await chrome.runtime.sendMessage({ kind: 'cooperation.control', revision: cooperation.revision, action: cooperation.mode === 'held' ? 'resume' : 'hold' });
        if (!result?.ok) throw new Error('控制状态已变化，请再点一次。页面仍保持原有控制权。');
      } catch (error) { notify(error.message || '切换控制失败，请重试。'); }
      finally { takeoverPending = false; refresh(); }
    };
    root.querySelector('.annotate').onclick = () => globalThis.dshStartAnnotation();
    root.querySelector('.expand-control').onclick = () => globalThis.dshCollapseControl(false);
    root.querySelector('.expand-activity').onclick = () => globalThis.dshCollapseActivity(false);
    root.querySelector('.stop').onclick = async () => { if (sessionId) await chrome.runtime.sendMessage({ kind: 'overlay.interrupt', sessionId }); };
    root.querySelector('.close').onclick = () => { if (!busy) void close(); };
    root.querySelector('.redraw').onclick = () => { rect = undefined; setStatus('请重新拉出标注方框。'); renderBox(); };
    note.oninput = () => { send.disabled = busy || !rect || !note.value.trim(); };
    note.onkeydown = event => {
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !send.disabled) void submit();
    };
    send.title = '发送建议（Enter）';
    send.onclick = submit;
    stage.addEventListener('pointerdown', startDrag);
    stage.addEventListener('pointermove', moveDrag);
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    document.documentElement.append(host);
    refresh();
  }

  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  function renderBox() {
    box.hidden = !rect;
    if (rect) box.style.cssText = `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
    send.disabled = busy || !rect || rect.width < 8 || rect.height < 8 || !note.value.trim();
    note.readOnly = busy;
    root.querySelector('.close').disabled = busy; root.querySelector('.redraw').disabled = busy;
    if (rect && !busy && !status.classList.contains('error')) status.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)} 像素 · 对勾发送至上方会话`;
  }
  function startDrag(event) {
    if (busy || !draft || event.button !== 0) return;
    setStatus('拖动调整标注区域。');
    event.preventDefault(); event.stopPropagation();
    const kind = event.target.closest('.resize') ? 'resize' : event.target.closest('.box') ? 'move' : 'draw';
    drag = { kind, x: clamp(event.clientX, innerWidth), y: clamp(event.clientY, innerHeight), rect: rect && { ...rect } };
    if (kind === 'draw') rect = { x: drag.x, y: drag.y, width: 0, height: 0 };
    stage.setPointerCapture(event.pointerId); renderBox();
  }
  function moveDrag(event) {
    if (!drag) return;
    const x = clamp(event.clientX, innerWidth), y = clamp(event.clientY, innerHeight);
    if (drag.kind === 'draw') rect = { x: Math.min(x, drag.x), y: Math.min(y, drag.y), width: Math.abs(x - drag.x), height: Math.abs(y - drag.y) };
    if (drag.kind === 'move') rect = { ...drag.rect, x: clamp(drag.rect.x + x - drag.x, innerWidth - drag.rect.width), y: clamp(drag.rect.y + y - drag.y, innerHeight - drag.rect.height) };
    if (drag.kind === 'resize') rect = { ...drag.rect, width: Math.max(8, clamp(drag.rect.width + x - drag.x, innerWidth - drag.rect.x)), height: Math.max(8, clamp(drag.rect.height + y - drag.y, innerHeight - drag.rect.y)) };
    renderBox();
  }
  function endDrag() {
    if (!drag) return;
    drag = undefined;
    if (!rect || rect.width < 8 || rect.height < 8) { rect = undefined; status.textContent = '请拉出至少 8 × 8 像素的方框。'; }
    else { regionText = selectedText(rect); elementContext = selectedElement(rect); note.focus({ preventScroll: true }); }
    renderBox();
  }
  function selectedText(area) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts = []; let node, visited = 0, length = 0;
    while ((node = walker.nextNode()) && visited++ < 6000 && length < 1800) {
      if (!node.textContent.trim() || node.parentElement?.closest('script,style,noscript,input,textarea,[contenteditable],browser-skill-overlay,[data-bsk-overlay]')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      if (![...range.getClientRects()].some(r => r.width && r.height && r.right > area.x && r.left < area.x + area.width && r.bottom > area.y && r.top < area.y + area.height)) continue;
      const text = node.textContent.trim().slice(0, 1800 - length); texts.push(text); length += text.length;
    }
    return texts.join('\n');
  }
  function selectedElement(area) {
    const element = document.elementsFromPoint(area.x + area.width / 2, area.y + area.height / 2).find(node => !node.closest('browser-skill-overlay,[data-bsk-overlay]'));
    if (!element || element === document.documentElement || element === document.body) return undefined;
    const segments = [];
    for (let node = element; node && node !== document.body && segments.length < 5; node = node.parentElement) {
      if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) { segments.unshift('#' + CSS.escape(node.id)); break; }
      const peers = [...(node.parentElement?.children ?? [])].filter(peer => peer.tagName === node.tagName);
      segments.unshift(node.localName + (peers.length > 1 ? `:nth-of-type(${peers.indexOf(node) + 1})` : ''));
    }
    return { tag: element.localName, role: element.getAttribute('role') ?? '', selector: segments.join(' > ').slice(0, 500) };
  }
  function setStatus(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
  async function close(sent = false) {
    const closing = draft;
    draft = undefined; rect = undefined; drag = undefined;
    clearTimeout(expiryTimer); editor.hidden = true; frozen.removeAttribute('src'); host.dataset.annotating = 'false';
    if (sent) note.value = '';
    busy = false; refresh();
    if (closing && !sent) await call({ kind: 'dsh-annotation-cancel', token: closing.token }).catch(() => {});
  }
  globalThis.dshStartAnnotation = async () => {
    if (busy || draft || mode !== 'control') return;
    mount(); busy = true; refresh(); notify('正在准备标注，等待当前浏览器操作结束…');
    try {
      // The native capture suppression also hides the upstream control pill.
      const result = await call({ kind: 'dsh-annotation-begin' });
      draft = result; rect = undefined; regionText = ''; elementContext = undefined;
      root.querySelector('.target').textContent = `发送至：${result.targetTitle || '当前聊天'} · ${result.targetId.slice(-8)}`;
      root.querySelector('.target').title = result.targetId;
      viewport = { width: innerWidth, height: innerHeight, scrollX, scrollY };
      frozen.src = result.snapshot; await frozen.decode();
      editor.hidden = false; toast.hidden = true; host.dataset.annotating = 'true';
      setStatus('已暂缓网页操作，请拖动方框并填写建议。');
      expiryTimer = setTimeout(() => { void close(); notify('标注已超时，建议文字已保留。可重新框选。'); }, Math.max(0, result.expiresAt - Date.now()));
    } catch (error) {
      if (draft) await close();
      notify(error.message);
    } finally { busy = false; renderBox(); refresh(); }
  };
  async function submit() {
    if (!draft || !rect || busy || !note.value.trim()) return;
    busy = true; renderBox(); setStatus('正在发送建议…');
    try {
      const scale = Math.min(1, 1600 / Math.max(rect.width, rect.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(rect.width * scale)); canvas.height = Math.max(1, Math.round(rect.height * scale));
      const sx = frozen.naturalWidth / viewport.width, sy = frozen.naturalHeight / viewport.height;
      canvas.getContext('2d').drawImage(frozen, rect.x * sx, rect.y * sy, rect.width * sx, rect.height * sy, 0, 0, canvas.width, canvas.height);
      const result = await call({ kind: 'dsh-annotation-submit', token: draft.token, annotation: {
        note: note.value, rect, viewport, regionText, element: elementContext, url: draft.url, title: draft.title, image: canvas.toDataURL('image/png').split(',')[1]
      } });
      if (!result.accepted) throw new Error('会话未确认接收，建议尚未发送。');
      const title = draft.targetTitle || draft.targetId;
      await close(true); notify(`✓ 已发送至 ${title}，DeepSeek 将结合建议继续。`);
    } catch (error) { setStatus(error.message, true); }
    finally { busy = false; renderBox(); }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.kind === 'dsh-annotation-open') { void globalThis.dshStartAnnotation(); respond({ ok: true }); return; }
    if (message?.type === 'bh-agent-overlay-state') {
      sessionId = message.sessionId; mode = message.mode;
      if (mode !== 'control' && draft) void close();
      mount(); refresh();
    }
    if (message?.type === 'bh-agent-overlay-reset' || message?.type === 'bsk-help-request') { mode = 'hidden'; if (draft) void close(); refresh(); }
    if (message?.type === 'bh-automation-bypass') { if (host) message.enabled ? host.setAttribute('data-bypass', '') : host.removeAttribute('data-bypass'); }
    if (message?.type === 'bsk/capture-suppress') {
      captureHidden = message.phase === 'begin' ? captureHidden + 1 : Math.max(0, captureHidden - 1); refresh();
    }
  });
  chrome.storage.local.get(['dsh_control_collapsed', 'dsh_activity_collapsed', 'bsk_control_hints_hidden']).then(values => {
    controlCollapsed = values.dsh_control_collapsed === true; globalThis.dshActivityCollapsed = values.dsh_activity_collapsed === true; hintsHidden = values.bsk_control_hints_hidden === true; refresh();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.dsh_control_collapsed) controlCollapsed = changes.dsh_control_collapsed.newValue === true;
    if (changes.dsh_activity_collapsed) globalThis.dshActivityCollapsed = changes.dsh_activity_collapsed.newValue === true;
    if (changes.bsk_control_hints_hidden) hintsHidden = changes.bsk_control_hints_hidden.newValue === true;
    refresh();
  });
  document.addEventListener('keydown', event => { if (draft && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!busy) void close(); } }, true);
  window.addEventListener('resize', () => { if (draft) { void close(); notify('窗口尺寸已变化，建议已保留，请重新框选。'); } });
  document.addEventListener('visibilitychange', refresh);
})();
