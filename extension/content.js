/**
 * Middle-Click AutoScroll — content script.
 *
 * Middle-click on empty page content to arm autoscroll. Moving the pointer
 * away from the click origin scrolls the nearest scrollable element in that
 * direction; speed ramps up with distance. A deliberate press-and-drag stops
 * on release; a quick click arms it hands-free until you click again or hit
 * Escape (scroll-wheel-to-cancel is available but off by default — see
 * settings.cancelOnWheel below).
 */
(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;

  const DEFAULTS = { enabled: true, sensitivity: 1, invert: false, cancelOnWheel: false, disabledSites: [] };
  let settings = { ...DEFAULTS };

  function storageGet() {
    if (api.storage.sync) {
      return api.storage.sync.get(DEFAULTS).catch(() => api.storage.local.get(DEFAULTS));
    }
    return api.storage.local.get(DEFAULTS);
  }

  storageGet().then((res) => {
    settings = { ...DEFAULTS, ...res };
  }).catch(() => {});

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' && area !== 'local') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in DEFAULTS) settings[key] = newValue;
    }
  });

  const DEADZONE = 16; // px — no scrolling inside this radius of the origin
  const MAX_DIST = 220; // px — distance at which speed maxes out
  const MIN_SPEED = 2; // px/frame, just past the deadzone
  const MAX_SPEED = 24; // px/frame, at MAX_DIST
  const AXIS_SNAP_RATIO = 0.35; // below this minor/major ratio, snap to one axis
  const ARM_DEBOUNCE_MS = 220; // absorbs mechanical middle-button switch bounce,
  // and doubles as "how long a press must last before release-to-stop applies"
  const SUPPRESS_TTL_MS = 400; // auto-expires a stuck auxclick/contextmenu suppression
  const ACCENT = '#0A84FF';

  let state = null; // non-null while autoscroll is armed
  let suppressAuxClickUntil = 0;
  let suppressContextMenuUntil = 0;

  function isEnabledForHost() {
    if (!settings.enabled) return false;
    return !(settings.disabledSites || []).includes(location.hostname);
  }

  function realTarget(e) {
    if (typeof e.composedPath === 'function') {
      const path = e.composedPath();
      if (path && path.length && path[0] instanceof Element) return path[0];
    }
    return e.target;
  }

  // ---- Scrollable-element lookup (with bubbling past maxed-out containers) ----

  function isScrollable(el) {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    const canY = /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    const canX = /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
    return canY || canX;
  }

  function findScrollRoot(target) {
    let el = target;
    while (el && el !== document.documentElement && el !== document.body) {
      if (isScrollable(el)) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function canScrollMore(el, axis, dir) {
    if (axis === 'y') {
      return dir < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    }
    return dir < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  }

  // Walks from the element under the original click up to the document,
  // handing scrolling to the first ancestor that still has room to move in
  // the requested direction. This means once a scrollable sidebar/code block
  // maxes out, autoscroll keeps going on the page behind it instead of
  // feeling "stuck".
  function findScrollableFor(startEl, axis, dir) {
    let el = startEl;
    while (el && el !== document.documentElement) {
      if (isScrollable(el) && canScrollMore(el, axis, dir)) return el;
      el = el.parentElement;
    }
    const root = document.scrollingElement || document.documentElement;
    return canScrollMore(root, axis, dir) ? root : null;
  }

  // ---- Custom cursor rendering (drawn on a canvas, applied as a CSS cursor) ----

  const cursorCache = new Map();

  function drawArrow(ctx, cx, cy, angleDeg, r, active, isDark) {
    const ang = (angleDeg * Math.PI) / 180;
    const outer = r * 0.62;
    const inner = r * 0.30;
    const half = r * 0.16;
    const perp = ang + Math.PI / 2;
    const tip = [cx + outer * Math.cos(ang), cy + outer * Math.sin(ang)];
    const b1 = [cx + inner * Math.cos(ang) + half * Math.cos(perp), cy + inner * Math.sin(ang) + half * Math.sin(perp)];
    const b2 = [cx + inner * Math.cos(ang) - half * Math.cos(perp), cy + inner * Math.sin(ang) - half * Math.sin(perp)];
    ctx.beginPath();
    ctx.moveTo(...tip);
    ctx.lineTo(...b1);
    ctx.lineTo(...b2);
    ctx.closePath();
    ctx.fillStyle = active ? ACCENT : (isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)');
    ctx.fill();
  }

  function getCursorDataUri(dirKey, isDark) {
    const cacheKey = `${dirKey}:${isDark}`;
    if (cursorCache.has(cacheKey)) return cursorCache.get(cacheKey);

    const size = 36;
    const c = size / 2;
    const r = size * 0.42;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? 'rgba(28,28,30,0.92)' : 'rgba(255,255,255,0.94)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)';
    ctx.stroke();

    const active = dirKey === 'neutral' ? new Set() : new Set(dirKey.split('-'));
    drawArrow(ctx, c, c, -90, r, active.has('up'), isDark);
    drawArrow(ctx, c, c, 0, r, active.has('right'), isDark);
    drawArrow(ctx, c, c, 90, r, active.has('down'), isDark);
    drawArrow(ctx, c, c, 180, r, active.has('left'), isDark);

    ctx.beginPath();
    ctx.arc(c, c, 2, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? '#ffffff' : '#111111';
    ctx.fill();

    const uri = canvas.toDataURL('image/png');
    cursorCache.set(cacheKey, uri);
    return uri;
  }

  // Cursor direction reflects the *actual applied* velocity (post axis-snap,
  // post boundary-clamp) rather than the raw pointer offset, so an arrow
  // never lights up for a direction that isn't really scrolling.
  function cursorDirKeyFromVelocity(vx, vy) {
    if (!vx && !vy) return 'neutral';
    return [vy < 0 && 'up', vy > 0 && 'down', vx < 0 && 'left', vx > 0 && 'right'].filter(Boolean).join('-');
  }

  function updateCursor(vx, vy) {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dirKey = cursorDirKeyFromVelocity(vx, vy);
    const fullKey = `${dirKey}:${isDark}`;
    if (state.lastCursorKey === fullKey) return;
    state.lastCursorKey = fullKey;
    const uri = getCursorDataUri(dirKey, isDark);
    state.cursorStyleEl.textContent = `html, html * { cursor: url(${uri}) 18 18, all-scroll !important; }`;
  }

  // ---- Scroll loop ----

  function axisSpeed(delta) {
    const abs = Math.abs(delta);
    if (abs <= DEADZONE) return 0;
    const t = Math.min((abs - DEADZONE) / (MAX_DIST - DEADZONE), 1);
    const eased = Math.pow(t, 1.6);
    const magnitude = (MIN_SPEED + eased * (MAX_SPEED - MIN_SPEED)) * settings.sensitivity;
    let dir = Math.sign(delta);
    if (settings.invert) dir = -dir;
    return dir * magnitude;
  }

  function tick() {
    if (!state) return;
    try {
      if (state.pointerActive) {
        const dx = state.pointer.x - state.origin.x;
        const dy = state.pointer.y - state.origin.y;
        let vx = axisSpeed(dx);
        let vy = axisSpeed(dy);

        // Snap near-straight drags to a single axis so small hand tremor
        // doesn't cause unwanted diagonal drift while scrolling.
        if (vx && vy) {
          const ax = Math.abs(dx);
          const ay = Math.abs(dy);
          const minorRatio = Math.min(ax, ay) / Math.max(ax, ay);
          if (minorRatio < AXIS_SNAP_RATIO) {
            if (ax > ay) vy = 0;
            else vx = 0;
          }
        }

        if (vy !== 0) {
          const target = findScrollableFor(state.startEl, 'y', vy);
          if (target) target.scrollBy({ top: vy });
          else vy = 0;
        }
        if (vx !== 0) {
          const target = findScrollableFor(state.startEl, 'x', vx);
          if (target) target.scrollBy({ left: vx });
          else vx = 0;
        }

        updateCursor(vx, vy);
      }
    } catch (err) {
      console.warn('Middle-Click AutoScroll: stopping after an unexpected error', err);
      deactivate();
      return;
    }
    state.rafId = requestAnimationFrame(tick);
  }

  // ---- Activate / deactivate ----

  function activate(x, y, target) {
    const startEl = findScrollRoot(target);

    // pointer-events:auto (not none) is deliberate: this full-viewport layer
    // catches every mouse event before it can hit-test into a same-page
    // iframe (an ad, an embed) and get "stuck" there, unreachable by our
    // window-level listeners. It sits above everything, so it also becomes
    // the thing clicked when the user clicks anywhere to stop — which is
    // fine, since we always intended to swallow that click anyway.
    const shadowHost = document.createElement('div');
    shadowHost.style.cssText = 'position:fixed;inset:0;pointer-events:auto;z-index:2147483647;';
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style>
        .marker {
          position: fixed;
          width: ${DEADZONE * 2}px;
          height: ${DEADZONE * 2}px;
          border-radius: 50%;
          border: 1.5px dashed rgba(120,120,120,0.6);
          background: rgba(127,127,127,0.10);
          transform: translate(-50%, -50%);
          opacity: 0;
          transition: opacity 0.12s ease;
          pointer-events: none;
        }
        .marker.show { opacity: 1; }
        .dot {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: rgba(120,120,120,0.9);
          transform: translate(-50%, -50%);
        }
      </style>
      <div class="marker"><div class="dot"></div></div>
    `;
    document.documentElement.appendChild(shadowHost);
    const markerEl = shadowRoot.querySelector('.marker');
    markerEl.style.left = `${x}px`;
    markerEl.style.top = `${y}px`;
    requestAnimationFrame(() => markerEl.classList.add('show'));

    const cursorStyleEl = document.createElement('style');
    document.documentElement.appendChild(cursorStyleEl);

    state = {
      startEl,
      origin: { x, y },
      pointer: { x, y },
      pointerActive: true,
      armedAt: performance.now(),
      shadowHost,
      cursorStyleEl,
      lastCursorKey: null,
      rafId: null,
    };
    updateCursor(0, 0);
    state.rafId = requestAnimationFrame(tick);
  }

  let lastDeactivatedAt = 0;

  function deactivate() {
    if (!state) return;
    cancelAnimationFrame(state.rafId);
    state.shadowHost.remove();
    state.cursorStyleEl.remove();
    state = null;
    lastDeactivatedAt = performance.now();
  }

  // ---- Event wiring ----

  const INTERACTIVE_SELECTOR =
    'a[href], button, input, textarea, select, video, audio, canvas, ' +
    '[contenteditable="true"], [draggable="true"], [role="button"], [role="slider"], [role="link"]';

  function onMouseDown(e) {
    if (state) {
      // Absorb a same-button re-press that follows the arming click within a
      // beat — cheap middle-click switches often "bounce" (fire down-up-down
      // in a few ms), which would otherwise cancel autoscroll the instant it
      // starts.
      if (e.button === 1 && performance.now() - state.armedAt < ARM_DEBOUNCE_MS) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      if (e.button === 1) suppressAuxClickUntil = now + SUPPRESS_TTL_MS;
      if (e.button === 2) suppressContextMenuUntil = now + SUPPRESS_TTL_MS;
      deactivate();
      return;
    }
    if (e.button !== 1) return;
    if (!isEnabledForHost()) return;
    // A bounced switch stopping autoscroll can fire a second, ghost
    // mousedown a few ms after the one that just deactivated it — without
    // this, that ghost press looks like a brand-new click and immediately
    // re-arms autoscroll right after the user stopped it.
    if (performance.now() - lastDeactivatedAt < ARM_DEBOUNCE_MS) return;

    const target = realTarget(e);
    if (target && target.closest && target.closest(INTERACTIVE_SELECTOR)) return;

    e.preventDefault();
    e.stopPropagation();
    suppressAuxClickUntil = performance.now() + SUPPRESS_TTL_MS;
    activate(e.clientX, e.clientY, target);
  }

  // A deliberate press-and-drag stops the moment you let go of the button —
  // but only once BOTH the press has lasted a beat AND moved past the dead
  // zone. Distance alone isn't enough: a quick tap on a clicky middle button
  // can jitter the cursor a few pixels from hand mechanics alone, and that
  // used to be misread as "the user dragged and let go, stop now". Requiring
  // real elapsed time as well means only an actual press-and-drag qualifies;
  // a quick tap always falls through to "arm and let go" (hands-free) instead.
  function onMouseUp(e) {
    if (!state || e.button !== 1) return;
    const heldFor = performance.now() - state.armedAt;
    if (heldFor < ARM_DEBOUNCE_MS) return;
    const dx = e.clientX - state.origin.x;
    const dy = e.clientY - state.origin.y;
    if (Math.hypot(dx, dy) > DEADZONE) {
      e.stopPropagation();
      deactivate();
    }
  }

  function onAuxClick(e) {
    if (e.button === 1 && performance.now() < suppressAuxClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      suppressAuxClickUntil = 0;
    }
  }

  function onContextMenu(e) {
    if (performance.now() < suppressContextMenuUntil) {
      e.preventDefault();
      e.stopPropagation();
      suppressContextMenuUntil = 0;
    }
  }

  function onMouseMove(e) {
    if (!state) return;
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
    state.pointerActive = true;
  }

  // When the pointer crosses into a same-page iframe (an ad, an embed, a
  // widget) our mousemove stops firing entirely — the mouse is now over a
  // different document. Rather than keep scrolling at whatever the last
  // known speed was, pause until the pointer is confirmed back over us.
  function onPointerLeave() {
    if (state) state.pointerActive = false;
  }

  function onKeyDown(e) {
    if (state && e.key === 'Escape') {
      e.preventDefault();
      deactivate();
    }
  }

  function onWheel() {
    if (!state || !settings.cancelOnWheel) return;
    deactivate();
  }

  // Registered on window (fires before document in the capture phase) so we
  // get first refusal even on pages that install their own capturing
  // listeners on document (common with dev-server overlays, some SPA
  // frameworks). Deliberately NOT tied to window focus/blur — a same-page
  // iframe (ad, embed, lazy-loaded widget) stealing focus should never be
  // treated as "the user left the page".
  window.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mouseup', onMouseUp, true);
  window.addEventListener('auxclick', onAuxClick, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('mousemove', onMouseMove, { passive: true, capture: true });
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('wheel', onWheel, { passive: true, capture: true });
  document.documentElement.addEventListener('mouseleave', onPointerLeave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) deactivate();
  });
  window.addEventListener('pagehide', () => deactivate());
})();
