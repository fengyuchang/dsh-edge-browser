(() => {
  if (globalThis.__dshPointerInstalled) return;
  globalThis.__dshPointerInstalled = true;
  let host, shadow, arrow, trails, panel, panelLabel, panelDetail, focusRing, scan, scrollGlow;
  let scrollTimer, glowTimer, previous, edgePoint, activity, focusTarget;
  let pointerMotion, effectSequence = 0;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  let lastPageY = document.scrollingElement?.scrollTop ?? 0;
  let lastScrollAt = -Infinity;
  let paused = true;
  let hintsHidden = false;
  let captureHidden = 0;
  let automationBypass = 0;
  const hide = () => {
    clearTimeout(scrollTimer);
    clearTimeout(glowTimer);
    if (scrollGlow) scrollGlow.style.display = 'none';
    if (pointerMotion) { pointerMotion.animation.cancel(); pointerMotion = undefined; }
    if (arrow && previous) { arrow.style.offsetPath = 'none'; arrow.style.transform = `translate3d(${previous.x}px,${previous.y}px,0)`; }
    trails?.replaceChildren();
    if (host) host.style.setProperty('display', 'none', 'important');
  };
  const refreshVisibility = () => {
    if (arrow) arrow.style.display = previous ? 'block' : 'none';
    if (host && (previous || activity) && !paused && !hintsHidden && !document.hidden && captureHidden === 0) host.style.setProperty('display', 'block', 'important');
    else hide();
  };
  const mount = () => {
    if (host?.isConnected) return;
    if (!document.documentElement) return;
    host = document.createElement('div');
    host.id = 'dsh-automation-pointer';
    host.dataset.visualVersion = 'comet-2026-10-29';
    host.setAttribute('aria-hidden', 'false');
    host.setAttribute('data-bsk-overlay', '');
    if (automationBypass) host.setAttribute('data-bypass', '');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;display:none!important;';
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host,*{pointer-events:none!important;box-sizing:border-box}
      .arrow{position:absolute;left:0;top:0;width:25px;height:32px;offset-anchor:0 0;offset-rotate:0deg;will-change:transform,offset-distance;filter:drop-shadow(0 2px 2px #0006)}
      .label{position:absolute;left:23px;top:24px;padding:3px 7px;border-radius:5px;background:#18364f;color:#fff;white-space:nowrap;font:600 12px/1.3 system-ui}
      .journey{position:fixed;inset:0;width:100%;height:100%;overflow:visible}
      .spark{position:absolute;border-radius:50%;will-change:transform,opacity;box-shadow:0 0 5px #ffd29c66}
      .pulse{position:absolute;width:32px;height:32px;border:3px solid #ff7a24;border-radius:50%;background:#ff7a2426;animation:pulse 650ms forwards}
      .activity{display:none;position:fixed;right:22px;bottom:90px;width:260px;padding:13px 16px;border:1px solid #ff9c5b88;border-radius:13px;background:#163149f2;color:white;box-shadow:0 8px 28px #0003;overflow:hidden;font:13px/1.6 system-ui}
      .activity-label{font-size:15px;font-weight:650}.activity-detail{color:#d5e3ed;margin-top:3px}
      .activity-label{padding-right:32px}.activity-hide{pointer-events:auto!important;position:absolute;right:9px;top:9px;border:0;border-radius:6px;background:#ffffff18;color:#e4f1fb;cursor:pointer;padding:3px 8px;font:14px system-ui}.activity-hide:focus-visible{outline:2px solid #77c4ff}
      :host([data-bypass]) .activity-hide{pointer-events:none!important}
      .activity::before{content:'';position:absolute;inset:0 auto auto 0;height:3px;width:100%;background:#68d9b4;opacity:.8}
      .activity.busy::before{width:45%;background:linear-gradient(90deg,transparent,#ff9e4d,transparent);animation:progress 1.1s ease-in-out infinite}
      .activity.error::before{background:#ff9292}
      .focus-ring{display:none;position:fixed;border:2px solid #ff8b3d;border-radius:7px;box-shadow:0 0 0 4px #ff8b3d22;transition:left 180ms,top 180ms,width 180ms,height 180ms}
      .focus-ring.busy{animation:breathe 1.3s ease-in-out infinite}
      .scan{display:none;position:fixed;inset:0;border:2px solid #52b6e988;background:linear-gradient(180deg,transparent 20%,#52b6e914 45%,transparent 65%);background-size:100% 250%;animation:scan 1.8s linear infinite}
      .scroll-glow{display:none;position:fixed;left:0;right:0;height:90px;text-align:center;padding:18px;color:#a94a0e;font:650 17px system-ui;background:linear-gradient(0deg,#ffaf6777,transparent)}
      .scroll-glow.up{top:0;background:linear-gradient(180deg,#ffaf6777,transparent)}.scroll-glow.down{bottom:0}
      @keyframes pulse{from{transform:scale(.45);opacity:1}to{transform:scale(1.8);opacity:0}}
      @keyframes progress{from{transform:translateX(-100%)}to{transform:translateX(330%)}}
      @keyframes breathe{50%{box-shadow:0 0 0 7px #ff8b3d30}}
      @keyframes scan{from{background-position:0 -100%}to{background-position:0 200%}}
      @media(prefers-reduced-motion:reduce){.focus-ring{transition:none}.pulse,.scan,.focus-ring.busy,.activity.busy::before{animation:none}}
    </style><div class="scan" aria-hidden="true"></div><div class="scroll-glow" aria-hidden="true"></div><div class="focus-ring" aria-hidden="true"></div><div class="trails" aria-hidden="true"></div><div class="arrow" aria-hidden="true"><svg viewBox="0 0 25 32" width="25" height="32"><path d="M2 2V25L8 19L13 30L18 27L13 17H23Z" fill="#ff7a24" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg><span class="label">DeepSeek</span></div><div class="activity"><button class="activity-hide" type="button" aria-label="收起步骤提示到页面右侧" title="收起到右侧">›</button><div class="activity-label"></div><div class="activity-detail"></div></div>`;
    trails = shadow.querySelector('.trails');
    arrow = shadow.querySelector('.arrow');
    panel = shadow.querySelector('.activity'); panelLabel = shadow.querySelector('.activity-label'); panelDetail = shadow.querySelector('.activity-detail');
    shadow.querySelector('.activity-hide').onclick = () => globalThis.dshCollapseActivity?.(true);
    focusRing = shadow.querySelector('.focus-ring'); scan = shadow.querySelector('.scan'); scrollGlow = shadow.querySelector('.scroll-glow');
    document.documentElement.append(host);
  };
  const highlight = node => {
    focusTarget = node;
    const rect = node?.isConnected ? node.getBoundingClientRect?.() : null;
    if (!focusRing) return;
    if (!rect || rect.width <= 0 || rect.height <= 0 || rect.height > innerHeight * 0.85 || rect.width > innerWidth * 0.98) { focusRing.style.display = 'none'; return; }
    const left = Math.max(0, rect.left - 4), top = Math.max(0, rect.top - 4);
    focusRing.style.cssText = `display:block;left:${left}px;top:${top}px;width:${Math.max(0, Math.min(innerWidth, rect.right + 4) - left)}px;height:${Math.max(0, Math.min(innerHeight, rect.bottom + 4) - top)}px`;
    focusRing.classList.toggle('busy', activity?.phase === 'running');
  };
  const renderActivity = () => {
    if (!panel) return;
    panel.style.display = activity && !globalThis.dshActivityCollapsed ? 'block' : 'none';
    if (activity) {
      const busy = activity.phase === 'running';
      panelLabel.textContent = `DeepSeek · ${activity.label}`;
      panelDetail.textContent = busy ? '正在执行这一步' : activity.phase === 'error' ? '这一步未完成 · 等待下一步' : '这一步已完成 · 等待下一步';
      panel.classList.toggle('busy', busy); panel.classList.toggle('error', activity.phase === 'error');
      scan.style.display = busy && ['observe', 'snapshot', 'extract', 'get_html'].includes(activity.action) ? 'block' : 'none';
      focusRing.classList.toggle('busy', busy);
    }
    refreshVisibility();
  };
  globalThis.dshRefreshActivity = renderActivity;
  globalThis.dshRaisePointer = () => { if (host?.isConnected) document.documentElement.append(host); };
  const flashScroll = direction => {
    if (!scrollGlow || paused || hintsHidden || document.hidden) return;
    scrollGlow.className = `scroll-glow ${direction < 0 ? 'up' : 'down'}`;
    scrollGlow.textContent = direction < 0 ? '↑ 页面向上滚动' : '↓ 页面向下滚动';
    scrollGlow.style.display = 'block'; clearTimeout(glowTimer);
    glowTimer = setTimeout(() => { scrollGlow.style.display = 'none'; }, 900);
  };
  const updateActivity = message => {
    activity = { action: message.action, label: message.label, phase: message.phase };
    globalThis.dshUpdateActivity?.(activity);
    mount();
    host.dataset.activity = activity.action; host.dataset.phase = activity.phase;
    if (activity.action !== 'hover') { clearTimeout(scrollTimer); edgePoint = undefined; }
    if (['fill', 'press', 'select', 'focus'].includes(activity.action)) highlight(document.activeElement);
    else if (activity.phase === 'running') highlight(null);
    renderActivity();
  };
  const temporary = element => {
    trails.append(element);
    while (trails.children.length > 80) trails.firstElementChild.remove();
    setTimeout(() => element.remove(), 1500);
  };
  const movePointer = (from, target, restore) => {
    if (pointerMotion?.x === target.x && pointerMotion?.y === target.y) return;
    const rect = arrow.getBoundingClientRect();
    const start = pointerMotion ? { x: rect.left, y: rect.top } : from;
    pointerMotion?.animation.cancel(); pointerMotion = undefined;
    const distance = start ? Math.hypot(target.x - start.x, target.y - start.y) : 0;
    arrow.style.offsetPath = 'none';
    if (restore || reducedMotion || !start || distance < 8) {
      arrow.style.transform = `translate3d(${target.x}px,${target.y}px,0)`; return;
    }
    const dx = target.x - start.x, dy = target.y - start.y;
    const bend = Math.min(42, distance * 0.12);
    const control = { x: (start.x + target.x) / 2 - dy / distance * bend, y: (start.y + target.y) / 2 + dx / distance * bend };
    const curve = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${target.x} ${target.y}`;
    const duration = Math.min(400, Math.max(180, distance * 0.4));
    const easing = 'cubic-bezier(.16,.85,.24,1)';
    arrow.style.transform = 'none'; arrow.style.offsetPath = `path('${curve}')`;
    const animation = arrow.animate([{ offsetDistance: '0%' }, { offsetDistance: '100%' }], { duration, easing, fill: 'forwards' });
    pointerMotion = { animation, x: target.x, y: target.y };
    animation.finished.then(() => {
      if (pointerMotion?.animation !== animation) return;
      arrow.style.offsetPath = 'none'; arrow.style.transform = `translate3d(${target.x}px,${target.y}px,0)`;
      pointerMotion = undefined; animation.cancel();
    }).catch(() => {});

    const id = `dsh-comet-${++effectSequence}`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'journey'); svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    svg.innerHTML = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${start.x}" y1="${start.y}" x2="${target.x}" y2="${target.y}"><stop offset="0" stop-color="#66bff7"/><stop offset=".45" stop-color="#8dc9eb"/><stop offset=".7" stop-color="#ffb76c"/><stop offset="1" stop-color="#ffa75c"/></linearGradient><filter id="${id}-glow" x="-40%" y="-100%" width="180%" height="300%"><feGaussianBlur stdDeviation="2.5"/></filter></defs><path class="core" d="${curve}" fill="none" stroke="url(#${id})" stroke-width="7" stroke-linecap="round" opacity=".16" filter="url(#${id}-glow)"/>`;
    temporary(svg);
    const core = svg.querySelector('.core'), length = core.getTotalLength();
    const tail = Math.min(125, length), piece = tail / 10;
    core.style.strokeDasharray = `${tail} ${length + tail}`;
    core.animate([{ strokeDashoffset: tail }, { strokeDashoffset: tail - length }], { duration, easing, fill: 'forwards' });
    for (let index = 0; index < 10; index++) {
      const segment = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      segment.setAttribute('d', curve); segment.setAttribute('fill', 'none'); segment.setAttribute('stroke', `url(#${id})`);
      segment.setAttribute('stroke-linecap', 'round'); segment.setAttribute('stroke-width', String(.35 + (index + 1) / 10 * 2.6));
      segment.style.opacity = String(Math.pow((index + 1) / 10, 1.5) * .85);
      segment.style.strokeDasharray = `${piece} ${length + tail}`;
      svg.append(segment);
      const offset = tail - index * piece;
      segment.animate([{ strokeDashoffset: offset }, { strokeDashoffset: offset - length }], { duration, easing, fill: 'forwards' });
    }
    svg.animate([{ opacity: 0 }, { opacity: 1, offset: .1 }, { opacity: .75, offset: .4 }, { opacity: 0 }], { duration: duration + 750, fill: 'forwards' });
    const count = Math.min(24, Math.max(10, Math.round(distance / 20)));
    for (let index = 0; index < count; index++) {
      const t = (index + 1) / (count + 1), u = 1 - t;
      const x = u * u * start.x + 2 * u * t * control.x + t * t * target.x;
      const y = u * u * start.y + 2 * u * t * control.y + t * t * target.y;
      const particle = document.createElement('i'), size = 2.5 + Math.random() * 3;
      const color = index % 4 === 0 ? '96,182,247' : '255,163,76';
      particle.className = 'spark';
      particle.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:radial-gradient(circle,rgba(${color},.95),rgba(${color},.35) 35%,rgba(${color},0) 75%)`;
      temporary(particle);
      const scatter = (Math.random() - .5) * 32;
      const driftX = -dx / distance * 14 - dy / distance * scatter, driftY = -dy / distance * 14 + dx / distance * scatter;
      particle.animate([{ opacity: 0, transform: 'scale(.3)' }, { opacity: .9, transform: 'scale(1)', offset: .18 }, { opacity: 0, transform: `translate(${driftX}px,${driftY}px) scale(.1)` }], { duration: 650 + Math.random() * 350, delay: t * duration * .8, fill: 'both' });
    }
  };
  const edgeScroll = message => {
    clearTimeout(scrollTimer);
    // One bounded scroll per deliberate edge movement. Clicks and native wheel
    // input cancel the dwell, so a stationary cursor cannot scroll indefinitely.
    if (message.action !== 'mouseMoved' || message.edgeScroll !== true || document.hidden) { edgePoint = undefined; return; }
    const edge = Math.min(80, innerHeight * 0.12);
    const direction = message.y < edge ? -1 : message.y > innerHeight - edge ? 1 : 0;
    if (!direction) { edgePoint = undefined; return; }
    if (edgePoint?.direction === direction && Math.hypot(message.x - edgePoint.x, message.y - edgePoint.y) < 12) return;
    edgePoint = { x: message.x, y: message.y, direction };
    if (Date.now() - lastScrollAt < 800) return;
    scrollTimer = setTimeout(() => {
      if (paused || hintsHidden || document.hidden) return;
      let element = document.elementFromPoint(message.x, message.y);
      const root = document.scrollingElement;
      for (; element; element = element.parentElement) {
        const scrollable = element === root || /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY);
        const available = direction < 0 ? element.scrollTop : element.scrollHeight - element.clientHeight - element.scrollTop;
        if (scrollable && available > 2) {
          element.scrollBy({ top: direction * Math.min(240, available), behavior: 'instant' });
          lastScrollAt = Date.now(); flashScroll(direction); return;
        }
      }
      if (root) {
        const available = direction < 0 ? root.scrollTop : root.scrollHeight - root.clientHeight - root.scrollTop;
        if (available > 2) { root.scrollBy({ top: direction * Math.min(240, available), behavior: 'instant' }); lastScrollAt = Date.now(); flashScroll(direction); }
      }
    }, 500);
  };
  const show = message => {
    if (!Number.isFinite(message.x) || !Number.isFinite(message.y) ||
        message.x < 0 || message.y < 0 || message.x > innerWidth || message.y > innerHeight) { clearTimeout(scrollTimer); edgePoint = undefined; return; }
    mount(); if (!host) return;
    const { x, y } = message;
    movePointer(previous, { x, y }, message.restore || paused || hintsHidden || document.hidden);
    previous = { x, y };
    host.dataset.x = String(x); host.dataset.y = String(y); host.dataset.action = message.action;
    refreshVisibility();
    if (!message.restore && !paused && !hintsHidden && message.action === 'mousePressed') {
      const pulse = document.createElement('div'); pulse.className = 'pulse';
      pulse.style.left = `${x - 16}px`; pulse.style.top = `${y - 16}px`; temporary(pulse);
      highlight(document.elementFromPoint(x, y));
    }
    if (!message.restore && !paused && !hintsHidden) {
      edgeScroll(message);
      if (message.action === 'mouseWheel' && message.deltaY) flashScroll(Math.sign(message.deltaY));
    }
  };
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'dsh-automation-pointer') {
      show(message); respond({ dshPointer: true, dshVisual: true }); return false;
    }
    if (message.type === 'dsh-visual-activity') { updateActivity(message); respond({ dshVisual: true }); return false; }
    if (message.type === 'dsh-visual-reset') { previous = undefined; activity = undefined; edgePoint = undefined; highlight(null); if (scan) scan.style.display = 'none'; renderActivity(); hide(); return; }
    if (message.type === 'dsh-automation-pointer-hide') { previous = undefined; edgePoint = undefined; hide(); return; }
    if (message.type === 'bh-agent-overlay-state') {
      paused = message.mode !== 'control'; refreshVisibility();
    }
    if (message.type === 'bsk-help-request' || message.type === 'bh-agent-overlay-reset') { paused = true; hide(); }
    if (message.type === 'bsk/capture-suppress') { captureHidden = message.phase === 'begin' ? captureHidden + 1 : Math.max(0, captureHidden - 1); refreshVisibility(); }
    if (message.type === 'bh-automation-bypass') { automationBypass = message.enabled ? automationBypass + 1 : Math.max(0, automationBypass - 1); if (host) automationBypass ? host.setAttribute('data-bypass', '') : host.removeAttribute('data-bypass'); }
  });
  chrome.storage.local.get('bsk_control_hints_hidden').then(value => {
    hintsHidden = value.bsk_control_hints_hidden === true; refreshVisibility();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bsk_control_hints_hidden) {
      hintsHidden = changes.bsk_control_hints_hidden.newValue === true; refreshVisibility();
    }
  });
  document.addEventListener('visibilitychange', refreshVisibility);
  document.addEventListener('focusin', event => { if (activity?.phase === 'running') highlight(event.target); }, true);
  document.addEventListener('scroll', () => {
    if (focusTarget) highlight(focusTarget);
    const y = document.scrollingElement?.scrollTop ?? 0;
    if (activity?.phase === 'running' && y !== lastPageY) flashScroll(Math.sign(y - lastPageY));
    lastPageY = y;
  }, true);
  chrome.runtime.sendMessage({ kind: 'overlay.ready' }).catch(() => {});
  chrome.runtime.sendMessage({ kind: 'dsh-visual-ready' }).then(state => {
    if (state?.activity) updateActivity(state.activity);
    if (state?.pointer) show(state.pointer);
  }).catch(() => {});
})();
