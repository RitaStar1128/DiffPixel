/* DiffPixel — Content Script v1.2
 * • Overlay layer rendering
 * • Floating control panel (Shadow DOM, fully isolated)
 * • Cross-tab sync via chrome.storage.local
 * • Light / Dark theme
 */
(() => {
  'use strict';

  const t = key => { try { return chrome.i18n.getMessage(key) || key; } catch { return key; } };

  /* ── Storage keys ────────────────────────── */
  const K = {
    STATE:     'dp_state',
    IMAGES:    'dp_images',
    THEME:     'dp_theme',
    PANEL_POS: 'dp_panel_pos',
  };

  /* ── Security helpers ───────────────────── */
  const VALID_BLEND   = new Set(['normal','difference','multiply','screen','overlay','hard-light','exclusion']);
  const VALID_COLOR_RE = /^rgba?\(\s*\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?(?:\s*,\s*[\d.]+)?\s*\)$/;
  const VALID_ID_RE   = /^dp-[a-zA-Z0-9]+$/;

  function genId() {
    const arr = new Uint8Array(6);
    crypto.getRandomValues(arr);
    return 'dp-' + Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').slice(0, 9);
  }

  function sanitizeMeta(m) {
    return {
      id:        (typeof m.id === 'string' && VALID_ID_RE.test(m.id)) ? m.id : genId(),
      name:      typeof m.name === 'string' ? m.name.slice(0, 32) : t('layerDefault'),
      opacity:   typeof m.opacity === 'number' ? Math.min(1, Math.max(0, m.opacity)) : 0.5,
      x:         typeof m.x === 'number' ? Math.trunc(m.x) : 0,
      y:         typeof m.y === 'number' ? Math.trunc(m.y) : 0,
      scale:     typeof m.scale === 'number' ? Math.min(20, Math.max(0.05, m.scale)) : 1,
      blendMode: VALID_BLEND.has(m.blendMode) ? m.blendMode : 'normal',
      visible:   typeof m.visible === 'boolean' ? m.visible : true,
      invert:    typeof m.invert === 'boolean' ? m.invert : false,
      locked:    typeof m.locked === 'boolean' ? m.locked : false,
    };
  }

  function sanitizeGrid(g) {
    if (!g || typeof g !== 'object') return {};
    return {
      enabled: typeof g.enabled === 'boolean' ? g.enabled : gridConfig.enabled,
      size:    typeof g.size === 'number' ? Math.min(128, Math.max(2, Math.trunc(g.size))) : gridConfig.size,
      color:   (typeof g.color === 'string' && VALID_COLOR_RE.test(g.color)) ? g.color : gridConfig.color,
    };
  }

  /* ── Module-level state ──────────────────── */
  let globalEnabled = false;
  let activeLayerId = null;
  let gridConfig    = { enabled: false, size: 8, color: 'rgba(0,212,255,0.25)' };
  let currentTheme  = 'dark';
  let layerMeta     = [];          // ordered metadata (no imageData)
  const imageData   = new Map();   // layerId → data URL
  const layerDOM    = new Map();   // layerId → Layer instance
  let containerEl   = null;
  let gridEl        = null;
  let panel         = null;

  /* ── Layer (manages one overlay element) ─── */
  class Layer {
    constructor(id) {
      this.id   = id;
      this.el   = null;
      this.img  = null;
      this._raf = null;
    }

    mount(parent, meta) {
      this.el = document.createElement('div');
      this.el.className = 'dp-layer';
      this.img = document.createElement('img');
      this.img.src = imageData.get(this.id) ?? '';
      this.img.draggable = false;
      this.el.appendChild(this.img);
      this.applyStyle(meta);
      this.bindDrag();
      parent.appendChild(this.el);
    }

    updateImage() {
      if (this.img) this.img.src = imageData.get(this.id) ?? '';
    }

    applyStyle(meta) {
      if (!this.el || !meta) return;
      this.el.style.display      = (meta.visible && globalEnabled) ? 'block' : 'none';
      this.el.style.opacity      = meta.opacity;
      this.el.style.transform    = `translate3d(${meta.x}px,${meta.y}px,0) scale(${meta.scale})`;
      this.el.style.mixBlendMode = meta.blendMode;
      this.el.style.pointerEvents= meta.locked ? 'none' : 'auto';
      this.el.style.filter       = meta.invert ? 'invert(1)' : 'none';
    }

    bindDrag() {
      let sx, sy, ox, oy, pending = false;
      this._dragCleanup = null;

      const onMove = e => {
        if (pending) return;
        pending = true;
        this._raf = requestAnimationFrame(() => {
          const m = getMeta(this.id);
          if (m) {
            m.x = ox + e.clientX - sx;
            m.y = oy + e.clientY - sy;
            this.el.style.transform = `translate3d(${m.x}px,${m.y}px,0) scale(${m.scale})`;
          }
          pending = false;
        });
      };

      const onUp = () => {
        this.el.classList.remove('dp-dragging');
        document.removeEventListener('mousemove', onMove, { capture: true });
        document.removeEventListener('mouseup',   onUp,   { capture: true });
        this._dragCleanup = null;
        panel?.renderControls();
        panel?.renderLayers();
        debounceSave();
      };

      this.el.addEventListener('mousedown', e => {
        const m = getMeta(this.id);
        if (!m || m.locked || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        sx = e.clientX; sy = e.clientY; ox = m.x; oy = m.y;
        this.el.classList.add('dp-dragging');
        this._dragCleanup = () => {
          document.removeEventListener('mousemove', onMove, { capture: true });
          document.removeEventListener('mouseup',   onUp,   { capture: true });
        };
        document.addEventListener('mousemove', onMove, { capture: true, passive: true });
        document.addEventListener('mouseup',   onUp,   { capture: true });
      });
    }

    destroy() { cancelAnimationFrame(this._raf); this._dragCleanup?.(); this.el?.remove(); }
  }

  /* ── Meta helpers ────────────────────────── */
  const getMeta       = id => layerMeta.find(m => m.id === id);
  const getActiveMeta = ()  => getMeta(activeLayerId);

  /* ── DOM setup ───────────────────────────── */
  function ensureDOM() {
    containerEl = document.getElementById('dp-root') ?? (() => {
      const el = document.createElement('div'); el.id = 'dp-root';
      document.documentElement.appendChild(el); return el;
    })();
    gridEl = document.getElementById('dp-grid') ?? (() => {
      const el = document.createElement('div'); el.id = 'dp-grid';
      document.documentElement.appendChild(el); return el;
    })();
  }

  /* ── Overlay management ──────────────────── */
  function refreshLayers() {
    /* Remove stale */
    layerDOM.forEach((layer, id) => {
      if (!getMeta(id)) { layer.destroy(); layerDOM.delete(id); }
    });
    /* Add/update */
    layerMeta.forEach(meta => {
      if (!layerDOM.has(meta.id)) {
        const l = new Layer(meta.id);
        layerDOM.set(meta.id, l);
        l.mount(containerEl, meta);
      } else {
        layerDOM.get(meta.id).applyStyle(meta);
      }
    });
    /* Sync image src */
    layerDOM.forEach(l => l.updateImage());
  }

  function setEnabled(v) {
    globalEnabled = v;
    layerMeta.forEach(m => layerDOM.get(m.id)?.applyStyle(m));
  }

  function applyGrid(cfg) {
    Object.assign(gridConfig, sanitizeGrid(cfg));
    if (!gridEl) return;
    if (gridConfig.enabled) {
      const s = gridConfig.size, c = gridConfig.color;
      gridEl.style.display = 'block';
      gridEl.style.backgroundImage =
        `linear-gradient(${c} 1px,transparent 1px),linear-gradient(90deg,${c} 1px,transparent 1px)`;
      gridEl.style.backgroundSize = `${s}px ${s}px`;
    } else { gridEl.style.display = 'none'; }
  }

  /* ── Storage: save ───────────────────────── */
  let _saveTimer = null;
  function debounceSave(immediate = false) {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveToStorage, immediate ? 0 : 280);
  }

  async function saveToStorage() {
    const imgs = {};
    layerMeta.forEach(m => { const d = imageData.get(m.id); if (d) imgs[m.id] = d; });
    await chrome.storage.local.set({
      [K.STATE]:  { enabled: globalEnabled, activeLayerId, grid: gridConfig, layers: layerMeta },
      [K.IMAGES]: imgs,
    });
  }

  /* ── Storage: load ───────────────────────── */
  async function loadFromStorage() {
    const res = await chrome.storage.local.get([K.STATE, K.IMAGES, K.THEME, K.PANEL_POS]);
    if (res[K.THEME])  currentTheme = res[K.THEME];
    if (res[K.IMAGES]) Object.entries(res[K.IMAGES]).forEach(([id, d]) => imageData.set(id, d));
    if (res[K.STATE]) {
      const s = res[K.STATE];
      globalEnabled = s.enabled ?? false;
      activeLayerId = s.activeLayerId ?? null;
      if (s.grid) Object.assign(gridConfig, sanitizeGrid(s.grid));
      layerMeta = (s.layers ?? []).filter(m => m && typeof m.id === 'string').map(sanitizeMeta);
    }
    return res[K.PANEL_POS] ?? null;
  }

  /* ── Utility for popup ───────────────────── */
  function getFullState() {
    return {
      enabled: globalEnabled, activeLayerId, grid: gridConfig,
      layers: layerMeta.map(m => ({ ...m, imageData: imageData.get(m.id) ?? '' })),
    };
  }

  /* ─────────────────────────────────────────────
     PANEL CSS — embedded in shadow root
  ──────────────────────────────────────────────── */
  const PANEL_CSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; font-size: 12px; }

    .dp-p {
      --bg:     #0d0d16; --surf:   #161622; --surf2:  #1e1e2e; --surf3:  #252538;
      --brd:    rgba(255,255,255,0.07); --brd-hi: rgba(0,212,255,0.28);
      --acc:    #00d4ff; --acc-d:  rgba(0,212,255,0.12);
      --tx:     #e8eaf0; --tx2:    #8890a4; --tx3:    #50566a;
      --dng:    #ff4d6a; --dng-d:  rgba(255,77,106,0.12); --ok: #00e5a0;
      --r: 8px;
      --sans: -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
      --mono: 'SFMono-Regular',Consolas,'Liberation Mono',monospace;

      position: fixed; width: 272px;
      background: var(--bg);
      border: 1px solid var(--brd);
      border-radius: var(--r);
      box-shadow: 0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04);
      font-family: var(--sans); font-size: 12px; color: var(--tx);
      z-index: 2147483647; overflow: hidden; user-select: none;
    }

    /* Light theme */
    .dp-p.dp-light {
      --bg:    #f2f3f8; --surf:  #ffffff; --surf2: #ebebf5; --surf3: #dfe0ef;
      --brd:   rgba(0,0,0,0.08); --brd-hi: rgba(0,80,220,0.25);
      --acc:   #0055cc; --acc-d: rgba(0,85,204,0.09);
      --tx:    #1a1d2e; --tx2:   #5a6080; --tx3:   #9499b0;
      --dng:   #d63050; --dng-d: rgba(214,48,80,0.1); --ok: #00966a;
      box-shadow: 0 8px 32px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.06);
    }

    /* Header */
    .dp-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 8px 0 12px; height: 38px;
      background: var(--surf); border-bottom: 1px solid var(--brd);
      cursor: grab; flex-shrink: 0;
    }
    .dp-header:active { cursor: grabbing; }
    .dp-logo { display: flex; align-items: center; gap: 8px; pointer-events: none; }
    .dp-logo-tx { font-size: 13px; font-weight: 600; letter-spacing: -.2px; color: var(--tx); }
    .dp-hbtns { display: flex; align-items: center; gap: 3px; }

    .dp-ibtn {
      display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; background: none; border: none;
      border-radius: 4px; color: var(--tx2); cursor: pointer; font-size: 11px;
      transition: background .12s, color .12s;
    }
    .dp-ibtn:hover { background: var(--surf2); color: var(--tx); }

    /* Toggle */
    .dp-tog { display: flex; align-items: center; cursor: pointer; }
    .dp-tog input { display: none; }
    .dp-track {
      width: 30px; height: 16px; background: var(--surf3);
      border-radius: 8px; border: 1px solid var(--brd); position: relative;
      transition: background .2s, border-color .2s;
    }
    .dp-thumb {
      position: absolute; top: 1px; left: 1px;
      width: 12px; height: 12px; border-radius: 50%; background: var(--tx3);
      transition: transform .2s, background .2s, box-shadow .2s;
    }
    .dp-tog input:checked + .dp-track { background: rgba(0,212,255,.18); border-color: var(--acc); }
    .dp-p.dp-light .dp-tog input:checked + .dp-track { background: rgba(0,85,204,.12); }
    .dp-tog input:checked + .dp-track .dp-thumb {
      background: var(--acc); transform: translateX(14px);
      box-shadow: 0 0 6px rgba(0,212,255,.45);
    }

    /* Chevron */
    .dp-chev { font-size: 9px; display: inline-block; transition: transform .2s; }
    .dp-p.collapsed .dp-chev { transform: rotate(180deg); }
    .dp-p.collapsed .dp-body { display: none; }

    /* Body */
    .dp-body {
      max-height: 440px; overflow-y: auto; overflow-x: hidden;
      scrollbar-width: thin; scrollbar-color: var(--surf3) transparent;
    }
    .dp-body::-webkit-scrollbar { width: 3px; }
    .dp-body::-webkit-scrollbar-thumb { background: var(--surf3); border-radius: 2px; }

    /* Sections */
    .dp-sec { padding: 8px 12px; border-bottom: 1px solid var(--brd); }
    .dp-sec:last-child { border-bottom: none; }
    .dp-shead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .dp-slabel { font-size: 9px; font-weight: 700; letter-spacing: .1em; color: var(--tx3); text-transform: uppercase; }

    /* Add button */
    .dp-addbtn {
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; background: var(--surf3); border: 1px solid var(--brd);
      border-radius: 4px; color: var(--tx2); cursor: pointer; font-size: 16px; line-height: 1;
      transition: all .12s;
    }
    .dp-addbtn:hover { background: var(--acc-d); border-color: var(--brd-hi); color: var(--acc); }

    /* Layer list */
    .dp-ll { display: flex; flex-direction: column; gap: 2px; }
    .dp-li {
      display: flex; align-items: center; gap: 7px;
      padding: 4px 6px; border-radius: 5px; border: 1px solid transparent;
      cursor: pointer; transition: background .1s, border-color .1s;
    }
    .dp-li:hover  { background: var(--surf2); border-color: var(--brd); }
    .dp-li.active { background: var(--acc-d); border-color: var(--brd-hi); }

    .dp-th { width: 30px; height: 20px; border-radius: 3px; overflow: hidden; background: var(--surf3); border: 1px solid var(--brd); flex-shrink: 0; }
    .dp-th img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .dp-linfo { flex: 1; min-width: 0; }
    .dp-lname { font-size: 11px; font-weight: 500; color: var(--tx); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dp-lmeta { font-size: 9.5px; color: var(--tx3); font-family: var(--mono); }

    .dp-visbtn {
      background: none; border: none; cursor: pointer; color: var(--tx2);
      padding: 2px 3px; border-radius: 3px; display: flex; align-items: center;
      opacity: .6; transition: opacity .12s, color .12s; flex-shrink: 0;
    }
    .dp-visbtn:hover { opacity: 1; color: var(--acc); }
    .dp-visbtn.hid { opacity: .2; }

    /* Empty */
    .dp-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 8px; text-align: center; color: var(--tx3); font-size: 10.5px; }

    /* Controls */
    .dp-ni { /* name input */
      width: 100%; background: var(--surf2); border: 1px solid var(--brd);
      border-radius: 4px; color: var(--tx); font-family: var(--sans); font-size: 11px;
      font-weight: 500; padding: 3px 7px; outline: none; transition: border-color .15s;
      margin-bottom: 6px;
    }
    .dp-ni:focus { border-color: var(--brd-hi); background: var(--surf3); }

    .dp-row { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
    .dp-row:last-child { margin-bottom: 0; }
    .dp-cl { font-size: 10.5px; color: var(--tx2); width: 46px; flex-shrink: 0; }

    /* Slider */
    .dp-sw { flex: 1; }
    .dp-sl { -webkit-appearance: none; width: 100%; height: 3px; border-radius: 2px; background: var(--surf3); outline: none; cursor: pointer; }
    .dp-sl::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--acc); cursor: pointer; box-shadow: 0 0 5px rgba(0,212,255,.4); transition: transform .1s; }
    .dp-sl::-webkit-slider-thumb:hover { transform: scale(1.2); }

    /* Num input */
    .dp-nw { display: flex; align-items: center; background: var(--surf2); border: 1px solid var(--brd); border-radius: 4px; overflow: hidden; transition: border-color .12s; }
    .dp-nw:focus-within { border-color: var(--brd-hi); }
    .dp-nw.f1 { flex: 1; min-width: 0; }
    .dp-num { background: transparent; border: none; color: var(--tx); font-family: var(--mono); font-size: 11px; padding: 3px 5px; text-align: right; outline: none; }
    .dp-num.fw { width: 100%; }
    .dp-num::-webkit-inner-spin-button, .dp-num::-webkit-outer-spin-button { -webkit-appearance: none; }
    .dp-unit { font-family: var(--mono); font-size: 9.5px; color: var(--tx3); padding: 0 5px 0 1px; }

    /* Step buttons */
    .dp-sb { background: var(--surf2); border: 1px solid var(--brd); border-radius: 3px; color: var(--tx2); cursor: pointer; padding: 3px 5px; font-size: 8px; flex-shrink: 0; transition: all .1s; line-height: 1; }
    .dp-sb:hover { background: var(--surf3); color: var(--acc); border-color: var(--brd-hi); }
    .dp-sb:active { transform: scale(.93); }

    /* Quick-action */
    .dp-qa { gap: 4px; }
    .dp-qbtn { flex: 1; background: var(--surf2); border: 1px solid var(--brd); border-radius: 5px; color: var(--tx2); cursor: pointer; font-family: var(--sans); font-size: 10px; font-weight: 500; padding: 3px 4px; text-align: center; transition: all .1s; }
    .dp-qbtn:hover { background: var(--acc-d); border-color: var(--brd-hi); color: var(--acc); }

    /* Select */
    .dp-selw { position: relative; flex: 1; }
    .dp-selw::after { content: '▾'; position: absolute; right: 7px; top: 50%; transform: translateY(-50%); color: var(--tx3); font-size: 9px; pointer-events: none; }
    .dp-sel { width: 100%; -webkit-appearance: none; background: var(--surf2); border: 1px solid var(--brd); border-radius: 4px; color: var(--tx); font-family: var(--sans); font-size: 10.5px; padding: 4px 20px 4px 7px; cursor: pointer; outline: none; transition: border-color .12s; }
    .dp-sel:focus { border-color: var(--brd-hi); }

    /* Flag buttons */
    .dp-frow { gap: 4px; flex-wrap: wrap; }
    .dp-fbtn { display: flex; align-items: center; gap: 4px; background: var(--surf2); border: 1px solid var(--brd); border-radius: 5px; color: var(--tx2); cursor: pointer; font-family: var(--sans); font-size: 10.5px; padding: 4px 7px; transition: all .12s; white-space: nowrap; }
    .dp-fbtn:hover { background: var(--surf3); border-color: var(--brd-hi); color: var(--acc); }
    .dp-fbtn.on  { background: var(--acc-d); border-color: var(--brd-hi); color: var(--acc); }
    .dp-fbtn.dng:hover { background: var(--dng-d); border-color: rgba(255,77,106,.3); color: var(--dng); }

    /* Tool buttons */
    .dp-trow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .dp-tbtn { display: flex; align-items: center; gap: 5px; background: var(--surf2); border: 1px solid var(--brd); border-radius: 5px; color: var(--tx2); cursor: pointer; font-family: var(--sans); font-size: 10.5px; padding: 4px 8px; transition: all .12s; }
    .dp-tbtn:hover { background: var(--surf3); border-color: var(--brd-hi); color: var(--acc); }
    .dp-tbtn.on   { background: var(--acc-d); border-color: var(--brd-hi); color: var(--acc); }

    /* Initially-hidden elements */
    #dp-ctrl  { display: none; }
    #dp-gsize { display: none; }
    .dp-onum-w { width: 36px; }
    .dp-gnum-w { width: 38px; }

    /* Drop zone overlay (inside panel) */
    .dp-dropzone {
      display: none; position: absolute; inset: 0; z-index: 20; pointer-events: none;
      align-items: center; justify-content: center; flex-direction: column; gap: 6px;
      background: rgba(0,212,255,0.07); border: 2px dashed var(--acc);
      border-radius: var(--r); color: var(--acc); font-size: 11px; font-weight: 500;
      backdrop-filter: blur(2px);
    }
    .dp-p.dp-light .dp-dropzone { background: rgba(0,85,204,0.06); }
    .dp-dropzone.active { display: flex; }
  `;

  /* ── Panel HTML ──────────────────────────── */
  function buildPanelHTML() {
    const logoSVG = `<svg width="18" height="18" viewBox="0 0 22 22" fill="none">
      <rect x="1" y="1" width="9" height="9" rx="1" stroke="var(--acc)" stroke-width="1.5"/>
      <rect x="12" y="1" width="9" height="9" rx="1" stroke="var(--acc)" stroke-width="1.5" opacity=".4"/>
      <rect x="1" y="12" width="9" height="9" rx="1" stroke="var(--acc)" stroke-width="1.5" opacity=".4"/>
      <rect x="12" y="12" width="9" height="9" rx="1" stroke="var(--acc)" stroke-width="1.5"/>
      <line x1="11" y1="5.5" x2="11" y2="16.5" stroke="var(--acc)" stroke-width="1" opacity=".3"/>
      <line x1="5.5" y1="11" x2="16.5" y2="11" stroke="var(--acc)" stroke-width="1" opacity=".3"/>
    </svg>`;
    const sunSVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2.8" stroke="currentColor" stroke-width="1.3"/>
      <line x1="7" y1="1" x2="7" y2="2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="7" y1="11.6" x2="7" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="1" y1="7" x2="2.4" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="11.6" y1="7" x2="13" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="2.9" y1="2.9" x2="3.9" y2="3.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="10.1" y1="10.1" x2="11.1" y2="11.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="11.1" y1="2.9" x2="10.1" y2="3.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="3.9" y1="10.1" x2="2.9" y2="11.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`;
    const eyeOn  = `<svg width="13" height="10" viewBox="0 0 13 10"><ellipse cx="6.5" cy="5" rx="5.5" ry="4" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="6.5" cy="5" r="1.8" fill="currentColor"/></svg>`;
    const eyeOff = `<svg width="13" height="11" viewBox="0 0 13 11"><line x1="1" y1="1" x2="12" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 7.5A5.5 4 0 0 0 10 7.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;
    const gridSVG = `<svg width="12" height="12" viewBox="0 0 14 14"><line x1="0" y1="4.67" x2="14" y2="4.67" stroke="currentColor" stroke-width="1.2"/><line x1="0" y1="9.33" x2="14" y2="9.33" stroke="currentColor" stroke-width="1.2"/><line x1="4.67" y1="0" x2="4.67" y2="14" stroke="currentColor" stroke-width="1.2"/><line x1="9.33" y1="0" x2="9.33" y2="14" stroke="currentColor" stroke-width="1.2"/></svg>`;

    const closeSVG = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><line x1="1.5" y1="1.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="9.5" y1="1.5" x2="1.5" y2="9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

    return `<div class="dp-p" id="dpp">
      <!-- Header -->
      <div class="dp-header" id="dp-drag">
        <div class="dp-logo">${logoSVG}<span class="dp-logo-tx">DiffPixel</span></div>
        <div class="dp-hbtns">
          <button class="dp-ibtn" id="dp-theme" title="${t('toggleTheme')}">${sunSVG}</button>
          <label class="dp-tog" title="${t('toggleOverlay')}"><input type="checkbox" id="dp-en"/><span class="dp-track"><span class="dp-thumb"></span></span></label>
          <button class="dp-ibtn" id="dp-col" title="Collapse"><span class="dp-chev">▲</span></button>
          <button class="dp-ibtn" id="dp-close" title="Close panel">${closeSVG}</button>
        </div>
      </div>
      <!-- Drop zone overlay -->
      <div class="dp-dropzone" id="dp-dropzone">
        <svg width="24" height="24" viewBox="0 0 36 36" fill="none"><path d="M18 6v16M11 14l7-9 7 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 28h24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span>${t('dropHint')}</span>
      </div>
      <!-- Body -->
      <div class="dp-body">
        <!-- Layers -->
        <div class="dp-sec">
          <div class="dp-shead">
            <span class="dp-slabel">${t('sectionLayers')}</span>
            <label class="dp-addbtn" title="${t('addLayerTitle')}">+<input type="file" id="dp-file" accept="image/*" multiple hidden/></label>
          </div>
          <div class="dp-ll" id="dp-ll">
            <div class="dp-empty" id="dp-empty">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" opacity=".35"><rect x="2" y="2" width="13" height="13" rx="1.5" stroke="var(--acc)" stroke-width="1.5"/><rect x="17" y="2" width="13" height="13" rx="1.5" stroke="var(--acc)" stroke-width="1.5" opacity=".5"/><rect x="2" y="17" width="13" height="13" rx="1.5" stroke="var(--acc)" stroke-width="1.5" opacity=".5"/><rect x="17" y="17" width="13" height="13" rx="1.5" stroke="var(--acc)" stroke-width="1.5"/></svg>
              <p>${t('emptyState')}</p>
            </div>
          </div>
        </div>
        <!-- Controls -->
        <div class="dp-sec" id="dp-ctrl">
          <input type="text" id="dp-lname" class="dp-ni" placeholder="${t('layerNamePlaceholder')}" maxlength="32"/>
          <div class="dp-row">
            <span class="dp-cl">${t('labelOpacity')}</span>
            <div class="dp-sw"><input type="range" id="dp-osl" class="dp-sl" min="0" max="100" step="1" value="50"/></div>
            <div class="dp-nw"><input type="number" id="dp-onum" class="dp-num dp-onum-w" min="0" max="100" value="50"/><span class="dp-unit">%</span></div>
          </div>
          <div class="dp-row">
            <span class="dp-cl">${t('labelX')}</span>
            <button class="dp-sb" data-f="x" data-d="-1">◀</button>
            <div class="dp-nw f1"><input type="number" id="dp-xi" class="dp-num fw" value="0" step="1"/><span class="dp-unit">px</span></div>
            <button class="dp-sb" data-f="x" data-d="1">▶</button>
          </div>
          <div class="dp-row">
            <span class="dp-cl">${t('labelY')}</span>
            <button class="dp-sb" data-f="y" data-d="-1">◀</button>
            <div class="dp-nw f1"><input type="number" id="dp-yi" class="dp-num fw" value="0" step="1"/><span class="dp-unit">px</span></div>
            <button class="dp-sb" data-f="y" data-d="1">▶</button>
          </div>
          <div class="dp-row">
            <span class="dp-cl">${t('labelScale')}</span>
            <button class="dp-sb" data-f="scale" data-d="-1">◀</button>
            <div class="dp-nw f1"><input type="number" id="dp-si" class="dp-num fw" value="1.00" step="0.01" min="0.05" max="20"/><span class="dp-unit">×</span></div>
            <button class="dp-sb" data-f="scale" data-d="1">▶</button>
          </div>
          <div class="dp-row dp-qa">
            <button class="dp-qbtn" id="dp-reset">${t('btnReset')}</button>
            <button class="dp-qbtn" id="dp-center">${t('btnCenter')}</button>
            <button class="dp-qbtn" id="dp-fitw">${t('btnFitW')}</button>
          </div>
          <div class="dp-row">
            <span class="dp-cl">${t('labelBlend')}</span>
            <div class="dp-selw"><select id="dp-blend" class="dp-sel">
              <option value="normal">${t('blendNormal')}</option>
              <option value="difference">${t('blendDifference')}</option>
              <option value="multiply">${t('blendMultiply')}</option>
              <option value="screen">${t('blendScreen')}</option>
              <option value="overlay">${t('blendOverlay')}</option>
              <option value="hard-light">${t('blendHardLight')}</option>
              <option value="exclusion">${t('blendExclusion')}</option>
            </select></div>
          </div>
          <div class="dp-row dp-frow">
            <button class="dp-fbtn" id="dp-inv">
              <svg width="11" height="11" viewBox="0 0 13 13"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 1v11" stroke="currentColor" stroke-width="1.4"/><path d="M1 6.5h5.5" fill="currentColor"/></svg>
              ${t('btnInvert')}
            </button>
            <button class="dp-fbtn" id="dp-lock">
              <svg width="10" height="11" viewBox="0 0 12 13"><rect x="1" y="5.5" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M3 5.5V3.5a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>
              ${t('btnLock')}
            </button>
            <button class="dp-fbtn dng" id="dp-del">
              <svg width="10" height="10" viewBox="0 0 11 11"><line x1="1.5" y1="1.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="9.5" y1="1.5" x2="1.5" y2="9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              ${t('btnRemove')}
            </button>
          </div>
        </div>
        <!-- Tools -->
        <div class="dp-sec">
          <div class="dp-trow">
            <button class="dp-tbtn" id="dp-grid">${gridSVG} ${t('btnGrid')}</button>
            <div class="dp-nw" id="dp-gsize">
              <input type="number" id="dp-gnum" class="dp-num dp-gnum-w" min="2" max="128" step="1" value="8"/>
              <span class="dp-unit">px</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  /* ── DiffPixelPanel ──────────────────────── */
  class DiffPixelPanel {
    constructor() {
      this.host = null; this.shadow = null; this.root = null;
      this._px = 0; this._py = 0; this._dragging = false;
      this._ox = 0; this._oy = 0; this._collapsed = false;
      this._visible = true;
    }

    show() {
      this._visible = true;
      if (this.host) this.host.style.display = '';
    }

    hide() {
      this._visible = false;
      if (this.host) this.host.style.display = 'none';
    }

    toggle() { this._visible ? this.hide() : this.show(); }

    mount(savedPos) {
      this.host = document.createElement('div');
      this.host.id = 'dp-panel-host';
      Object.assign(this.host.style, { position:'fixed', top:'0', left:'0', zIndex:'2147483647', pointerEvents:'none', overflow:'visible' });
      document.documentElement.appendChild(this.host);

      this.shadow = this.host.attachShadow({ mode: 'open' });
      const styleEl = document.createElement('style');
      styleEl.textContent = PANEL_CSS;
      this.shadow.appendChild(styleEl);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = buildPanelHTML();
      this.shadow.appendChild(wrapper.firstElementChild);
      this.root = this.shadow.getElementById('dpp');
      this.root.style.pointerEvents = 'auto';

      this.applyTheme(currentTheme);

      const defX = Math.max(0, window.innerWidth - 290), defY = 20;
      this._px = savedPos?.x ?? defX;
      this._py = savedPos?.y ?? defY;
      this._setPos(this._px, this._py);

      this._bindEvents();
      this.renderAll();
    }

    _setPos(x, y) {
      this._px = Math.min(Math.max(0, x), window.innerWidth  - 272);
      this._py = Math.min(Math.max(0, y), window.innerHeight - 40);
      this.root.style.left = `${this._px}px`;
      this.root.style.top  = `${this._py}px`;
    }

    applyTheme(theme) {
      currentTheme = theme;
      this.root?.classList.toggle('dp-light', theme === 'light');
    }

    /* ── Render ── */
    renderAll() { this.renderEnable(); this.renderLayers(); this.renderControls(); this.renderGrid(); }

    renderEnable() {
      const cb = this.shadow.getElementById('dp-en');
      if (cb) cb.checked = globalEnabled;
    }

    renderLayers() {
      const list  = this.shadow.getElementById('dp-ll');
      const empty = this.shadow.getElementById('dp-empty');
      if (!list || !empty) return;
      list.querySelectorAll('.dp-li').forEach(el => el.remove());
      empty.style.display = layerMeta.length === 0 ? '' : 'none';

      layerMeta.forEach(meta => {
        const item = document.createElement('div');
        item.className = 'dp-li' + (meta.id === activeLayerId ? ' active' : '');

        const th = document.createElement('div'); th.className = 'dp-th';
        const img = imageData.get(meta.id);
        if (img) { const i = document.createElement('img'); i.src = img; th.appendChild(i); }

        const info = document.createElement('div'); info.className = 'dp-linfo';
        const nameDiv = document.createElement('div'); nameDiv.className = 'dp-lname';
        nameDiv.textContent = meta.name;
        const metaDiv = document.createElement('div'); metaDiv.className = 'dp-lmeta';
        metaDiv.textContent = `${Math.round(meta.opacity*100)}% · ${meta.x}px ${meta.y}px · ×${Number(meta.scale).toFixed(2)}`;
        info.appendChild(nameDiv); info.appendChild(metaDiv);

        const vis = document.createElement('button');
        vis.className = 'dp-visbtn' + (!meta.visible ? ' hid' : '');
        vis.innerHTML = meta.visible
          ? `<svg width="13" height="10" viewBox="0 0 13 10"><ellipse cx="6.5" cy="5" rx="5.5" ry="4" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="6.5" cy="5" r="1.8" fill="currentColor"/></svg>`
          : `<svg width="13" height="11" viewBox="0 0 13 11"><line x1="1" y1="1" x2="12" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 7.5A5.5 4 0 0 0 10 7.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;
        vis.addEventListener('click', e => {
          e.stopPropagation();
          meta.visible = !meta.visible;
          layerDOM.get(meta.id)?.applyStyle(meta);
          this.renderLayers(); debounceSave();
        });

        item.appendChild(th); item.appendChild(info); item.appendChild(vis);
        item.addEventListener('click', () => {
          activeLayerId = meta.id; this.renderLayers(); this.renderControls(); debounceSave();
        });
        list.appendChild(item);
      });
    }

    renderControls() {
      const meta = getActiveMeta();
      const ctrl = this.shadow.getElementById('dp-ctrl');
      if (!ctrl) return;
      if (!meta) { ctrl.style.display = 'none'; return; }
      ctrl.style.display = 'block';
      const g = id => this.shadow.getElementById(id);
      const ni = g('dp-lname'); if (ni && ni !== this.shadow.activeElement) ni.value = meta.name;
      const v = Math.round(meta.opacity * 100);
      const os = g('dp-osl'); if (os) os.value = v;
      const on = g('dp-onum'); if (on) on.value = v;
      const xi = g('dp-xi'); if (xi) xi.value = meta.x;
      const yi = g('dp-yi'); if (yi) yi.value = meta.y;
      const si = g('dp-si'); if (si) si.value = Number(meta.scale).toFixed(2);
      const bl = g('dp-blend'); if (bl) bl.value = meta.blendMode;
      g('dp-inv')?.classList.toggle('on',  !!meta.invert);
      g('dp-lock')?.classList.toggle('on', !!meta.locked);
    }

    renderGrid() {
      const btn  = this.shadow.getElementById('dp-grid');
      const wrap = this.shadow.getElementById('dp-gsize');
      const inp  = this.shadow.getElementById('dp-gnum');
      btn?.classList.toggle('on', gridConfig.enabled);
      if (wrap) wrap.style.display = gridConfig.enabled ? 'flex' : 'none';
      if (inp)  inp.value = gridConfig.size;
    }

    /* ── Events ── */
    _bindEvents() {
      const g = id => this.shadow.getElementById(id);

      /* Panel drag */
      g('dp-drag')?.addEventListener('mousedown', e => {
        if (e.target.closest('button,label,input,select')) return;
        e.preventDefault();
        this._dragging = true;
        this._ox = e.clientX - this._px;
        this._oy = e.clientY - this._py;
        const onMove = e => { if (this._dragging) this._setPos(e.clientX - this._ox, e.clientY - this._oy); };
        const onUp   = () => {
          this._dragging = false;
          document.removeEventListener('mousemove', onMove, { capture: true });
          document.removeEventListener('mouseup',   onUp,   { capture: true });
          chrome.storage.local.set({ [K.PANEL_POS]: { x: this._px, y: this._py } });
        };
        document.addEventListener('mousemove', onMove, { capture: true, passive: true });
        document.addEventListener('mouseup',   onUp,   { capture: true });
      });

      /* Collapse */
      g('dp-col')?.addEventListener('click', () => {
        this._collapsed = !this._collapsed;
        this.root.classList.toggle('collapsed', this._collapsed);
      });

      /* Close panel */
      g('dp-close')?.addEventListener('click', () => this.hide());

      /* Drop zone on the panel itself */
      const dropZone = g('dp-dropzone');
      let _dropCounter = 0;
      this.root.addEventListener('dragenter', e => {
        if (e.dataTransfer?.types && [...e.dataTransfer.types].includes('Files')) {
          _dropCounter++; dropZone?.classList.add('active');
        }
      });
      this.root.addEventListener('dragleave', () => {
        _dropCounter = Math.max(0, _dropCounter - 1);
        if (_dropCounter === 0) dropZone?.classList.remove('active');
      });
      this.root.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
      this.root.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation();
        _dropCounter = 0; dropZone?.classList.remove('active');
        const files = [...(e.dataTransfer.files ?? [])].filter(f => f.type.startsWith('image/'));
        if (files.length) this._addLayers(files);
      });

      /* Theme */
      g('dp-theme')?.addEventListener('click', () => {
        const next = currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(next);
        chrome.storage.local.set({ [K.THEME]: next });
        try { chrome.runtime.sendMessage({ type: 'THEME_CHANGED', theme: next }); } catch {}
      });

      /* Enable */
      g('dp-en')?.addEventListener('change', e => { setEnabled(e.target.checked); debounceSave(); });

      /* File upload (multiple) */
      g('dp-file')?.addEventListener('change', e => {
        const files = [...(e.target.files ?? [])].filter(f => f.type.startsWith('image/'));
        if (files.length) this._addLayers(files);
        e.target.value = '';
      });

      /* Opacity */
      g('dp-osl')?.addEventListener('input', e => {
        const meta = getActiveMeta(); if (!meta) return;
        const v = +e.target.value; meta.opacity = v / 100;
        const on = g('dp-onum'); if (on) on.value = v;
        layerDOM.get(meta.id)?.applyStyle(meta); this.renderLayers(); debounceSave();
      });
      g('dp-onum')?.addEventListener('input', e => {
        const meta = getActiveMeta(); if (!meta) return;
        const v = Math.min(100, Math.max(0, +e.target.value || 0)); meta.opacity = v / 100;
        const os = g('dp-osl'); if (os) os.value = v;
        layerDOM.get(meta.id)?.applyStyle(meta); this.renderLayers(); debounceSave();
      });

      /* X / Y / Scale inputs */
      const bindNum = (id, field, parse = parseInt) => {
        g(id)?.addEventListener('input', e => {
          const meta = getActiveMeta(); if (!meta) return;
          let v = parse(e.target.value, 10);
          if (field === 'scale') v = Math.max(0.05, v || 1);
          else v = v || 0;
          meta[field] = v;
          layerDOM.get(meta.id)?.applyStyle(meta); this.renderLayers(); debounceSave();
        });
      };
      bindNum('dp-xi', 'x');
      bindNum('dp-yi', 'y');
      bindNum('dp-si', 'scale', parseFloat);

      /* Step buttons */
      this.shadow.querySelectorAll('.dp-sb').forEach(btn => {
        btn.addEventListener('click', () => {
          const meta = getActiveMeta(); if (!meta) return;
          const f = btn.dataset.f, d = +btn.dataset.d;
          if (f === 'x')     meta.x += d;
          else if (f === 'y') meta.y += d;
          else if (f === 'scale') meta.scale = Math.max(0.05, Math.round((meta.scale + d * 0.05) * 100) / 100);
          layerDOM.get(meta.id)?.applyStyle(meta);
          this.renderControls(); this.renderLayers(); debounceSave();
        });
      });

      /* Quick actions */
      g('dp-reset')?.addEventListener('click', () => {
        const meta = getActiveMeta(); if (!meta) return;
        meta.x = 0; meta.y = 0;
        layerDOM.get(meta.id)?.applyStyle(meta); this.renderControls(); this.renderLayers(); debounceSave();
      });
      g('dp-center')?.addEventListener('click', () => {
        const meta = getActiveMeta(), layer = meta ? layerDOM.get(meta.id) : null; if (!meta || !layer) return;
        meta.x = Math.round((window.innerWidth  - (layer.img?.naturalWidth  ?? 0) * meta.scale) / 2);
        meta.y = Math.round((window.innerHeight - (layer.img?.naturalHeight ?? 0) * meta.scale) / 2);
        layerDOM.get(meta.id)?.applyStyle(meta); this.renderControls(); this.renderLayers(); debounceSave();
      });
      g('dp-fitw')?.addEventListener('click', () => {
        const meta = getActiveMeta(), layer = meta ? layerDOM.get(meta.id) : null; if (!meta || !layer) return;
        const nw = layer.img?.naturalWidth; if (!nw) return;
        meta.scale = Math.round((window.innerWidth / nw) * 100) / 100; meta.x = 0;
        layerDOM.get(meta.id)?.applyStyle(meta); this.renderControls(); this.renderLayers(); debounceSave();
      });

      /* Layer name */
      g('dp-lname')?.addEventListener('input', e => {
        const meta = getActiveMeta(); if (!meta) return;
        meta.name = e.target.value;
        clearTimeout(this._nt);
        this._nt = setTimeout(() => { this.renderLayers(); debounceSave(); }, 400);
      });

      /* Blend */
      g('dp-blend')?.addEventListener('change', e => {
        const meta = getActiveMeta(); if (!meta) return;
        meta.blendMode = e.target.value; layerDOM.get(meta.id)?.applyStyle(meta); debounceSave();
      });

      /* Flag buttons */
      g('dp-inv')?.addEventListener('click', () => {
        const meta = getActiveMeta(); if (!meta) return;
        meta.invert = !meta.invert; layerDOM.get(meta.id)?.applyStyle(meta);
        g('dp-inv').classList.toggle('on', meta.invert); debounceSave();
      });
      g('dp-lock')?.addEventListener('click', () => {
        const meta = getActiveMeta(); if (!meta) return;
        meta.locked = !meta.locked; layerDOM.get(meta.id)?.applyStyle(meta);
        g('dp-lock').classList.toggle('on', meta.locked); debounceSave();
      });
      g('dp-del')?.addEventListener('click', () => {
        const meta = getActiveMeta(); if (!meta) return;
        const idx = layerMeta.indexOf(meta);
        layerMeta.splice(idx, 1);
        layerDOM.get(meta.id)?.destroy(); layerDOM.delete(meta.id); imageData.delete(meta.id);
        activeLayerId = layerMeta[Math.max(0, idx - 1)]?.id ?? null;
        this.renderAll(); debounceSave(true);
      });

      /* Grid */
      g('dp-grid')?.addEventListener('click', () => {
        gridConfig.enabled = !gridConfig.enabled; applyGrid(gridConfig); this.renderGrid(); debounceSave();
      });
      g('dp-gnum')?.addEventListener('input', e => {
        gridConfig.size = Math.min(128, Math.max(2, +e.target.value || 8));
        applyGrid(gridConfig); debounceSave();
      });
    }

    /* ── Add layers from one or more files ── */
    _addLayers(files) {
      [...files].forEach(file => {
        const reader = new FileReader();
        reader.onload = e => {
          const data = e.target.result;
          const id   = genId();
          const name = (file.name.replace(/\.[^.]+$/, '') || t('layerDefault')).slice(0, 32);
          const meta = { id, name, opacity: .5, x: 0, y: 0, scale: 1, blendMode: 'normal', visible: true, invert: false, locked: false };
          imageData.set(id, data);
          layerMeta.push(meta);
          activeLayerId = id;
          const l = new Layer(id); layerDOM.set(id, l); l.mount(containerEl, meta);
          this.renderAll(); debounceSave(true);
        };
        reader.readAsDataURL(file);
      });
    }

    destroy() { this.host?.remove(); }
  }

  /* ── Panel: on-demand creation ──────────── */
  async function createAndShowPanel() {
    if (panel) { panel.show(); return; }
    const res = await chrome.storage.local.get(K.PANEL_POS);
    panel = new DiffPixelPanel();
    panel.mount(res[K.PANEL_POS] ?? null);
  }

  /* ── chrome.runtime messages (from popup) ── */
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!sender || sender.id !== chrome.runtime.id) return;
    switch (msg.type) {
      case 'PING': reply({ ok: true }); break;

      case 'TOGGLE_PANEL':
        if (!panel) { createAndShowPanel().then(() => reply({ ok: true })); return true; }
        panel.toggle(); reply({ ok: true }); break;

      case 'SHOW_PANEL':
        if (!panel) { createAndShowPanel().then(() => reply({ ok: true })); return true; }
        panel.show(); reply({ ok: true }); break;

      case 'GET_STATE': reply(getFullState()); break;

      case 'SET_ENABLED':
        setEnabled(msg.enabled); panel?.renderEnable(); debounceSave(); reply({ ok: true }); break;

      case 'ADD_LAYER': {
        const { layer: l } = msg;
        if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !VALID_ID_RE.test(l.id)) {
          reply({ error: 'invalid' }); break;
        }
        if (typeof l.imageData === 'string' && l.imageData.startsWith('data:image/')) {
          imageData.set(l.id, l.imageData);
        }
        const meta = sanitizeMeta(l);
        layerMeta.push(meta); activeLayerId = meta.id;
        const ld = new Layer(meta.id); layerDOM.set(meta.id, ld); ld.mount(containerEl, meta);
        panel?.renderAll(); debounceSave(true); reply({ ok: true }); break;
      }

      case 'REMOVE_LAYER':
        layerDOM.get(msg.layerId)?.destroy(); layerDOM.delete(msg.layerId); imageData.delete(msg.layerId);
        layerMeta = layerMeta.filter(m => m.id !== msg.layerId);
        if (activeLayerId === msg.layerId) activeLayerId = layerMeta[0]?.id ?? null;
        panel?.renderAll(); debounceSave(true); reply({ ok: true }); break;

      case 'UPDATE_LAYER': {
        const meta = getMeta(msg.layerId);
        if (meta && msg.data && typeof msg.data === 'object') {
          const safe = sanitizeMeta({ ...meta, ...msg.data });
          Object.assign(meta, safe);
          layerDOM.get(msg.layerId)?.applyStyle(meta);
          panel?.renderLayers(); panel?.renderControls();
        }
        debounceSave(); reply({ ok: true }); break;
      }

      case 'SET_ACTIVE':
        activeLayerId = msg.layerId; panel?.renderLayers(); panel?.renderControls(); reply({ ok: true }); break;

      case 'SET_GRID':
        applyGrid(msg.grid); panel?.renderGrid(); debounceSave(); reply({ ok: true }); break;

      case 'GET_LAYER_INFO': {
        const l = layerDOM.get(msg.layerId);
        reply(l ? { viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, imageNaturalWidth: l.img?.naturalWidth ?? 0, imageNaturalHeight: l.img?.naturalHeight ?? 0 } : null);
        break;
      }

      case 'LOAD_STATE': {
        const s = msg.state;
        if (!s || typeof s !== 'object') { reply({ error: 'invalid' }); break; }
        globalEnabled = typeof s.enabled === 'boolean' ? s.enabled : false;
        activeLayerId = typeof s.activeLayerId === 'string' ? s.activeLayerId : null;
        if (s.grid && typeof s.grid === 'object') Object.assign(gridConfig, sanitizeGrid(s.grid));
        layerDOM.forEach(l => l.destroy()); layerDOM.clear(); layerMeta = [];
        if (containerEl) containerEl.innerHTML = '';
        (s.layers ?? []).filter(l => l && typeof l.id === 'string').forEach(l => {
          if (typeof l.imageData === 'string' && l.imageData.startsWith('data:image/')) {
            imageData.set(l.id, l.imageData);
          }
          const meta = sanitizeMeta(l);
          layerMeta.push(meta);
          const ld = new Layer(meta.id); layerDOM.set(meta.id, ld); ld.mount(containerEl, meta);
        });
        applyGrid(gridConfig); setEnabled(globalEnabled); panel?.renderAll();
        reply({ ok: true }); break;
      }

      default: reply({ error: 'unknown' });
    }
    return true;
  });

  /* ── Cross-tab sync via storage.onChanged ── */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes[K.IMAGES]) {
      const imgs = changes[K.IMAGES].newValue ?? {};
      Object.entries(imgs).forEach(([id, d]) => imageData.set(id, d));
    }

    if (changes[K.STATE]) {
      const s = changes[K.STATE].newValue;
      if (!s || typeof s !== 'object') return;
      globalEnabled = typeof s.enabled === 'boolean' ? s.enabled : globalEnabled;
      activeLayerId = typeof s.activeLayerId === 'string' ? s.activeLayerId : activeLayerId;
      if (s.grid && typeof s.grid === 'object') Object.assign(gridConfig, sanitizeGrid(s.grid));

      /* Sync layers: remove deleted, add new */
      const newMeta = (s.layers ?? []).filter(m => m && typeof m.id === 'string').map(sanitizeMeta);
      [...layerDOM.keys()].forEach(id => {
        if (!newMeta.find(m => m.id === id)) { layerDOM.get(id)?.destroy(); layerDOM.delete(id); }
      });
      layerMeta = newMeta;
      newMeta.forEach(meta => {
        if (!layerDOM.has(meta.id)) {
          const l = new Layer(meta.id); layerDOM.set(meta.id, l); l.mount(containerEl, meta);
        } else {
          layerDOM.get(meta.id)?.applyStyle(meta);
          layerDOM.get(meta.id)?.updateImage();
        }
      });

      applyGrid(gridConfig); setEnabled(globalEnabled);
      panel?.renderAll();
    }

    if (changes[K.THEME]) {
      panel?.applyTheme(changes[K.THEME].newValue);
    }
  });

  /* ── Keyboard shortcuts ──────────────────── */
  document.addEventListener('keydown', e => {
    if (!globalEnabled || !activeLayerId) return;
    const ae = document.activeElement;
    if (ae?.tagName === 'INPUT' || ae?.tagName === 'TEXTAREA' || ae?.isContentEditable) return;
    if (panel?.host?.contains(ae)) return;

    const meta = getActiveMeta();
    if (!meta || meta.locked) return;
    const step = e.shiftKey ? 10 : 1;
    let moved = false;
    if (e.key === 'ArrowLeft')  { meta.x -= step; moved = true; }
    if (e.key === 'ArrowRight') { meta.x += step; moved = true; }
    if (e.key === 'ArrowUp')    { meta.y -= step; moved = true; }
    if (e.key === 'ArrowDown')  { meta.y += step; moved = true; }
    if (moved) {
      e.preventDefault();
      layerDOM.get(meta.id)?.applyStyle(meta);
      panel?.renderControls(); panel?.renderLayers(); debounceSave();
    }
  });

  /* ── Init ────────────────────────────────── */
  async function init() {
    if (document.getElementById('dp-panel-host')) return;
    ensureDOM();
    await loadFromStorage();
    refreshLayers(); applyGrid(gridConfig); setEnabled(globalEnabled);
    // panel は TOGGLE_PANEL / SHOW_PANEL でオンデマンド生成
    // 万が一 init() 完了前にパネルが生成されていれば再描画
    panel?.renderAll();
  }

  init();
})();
