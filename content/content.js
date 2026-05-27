/* DiffPixel — Content Script v1.2
 * • Overlay layer rendering
 * • Floating control panel (Shadow DOM, fully isolated)
 * • Cross-tab sync via chrome.storage.local
 * • Light / Dark theme
 */
(() => {
  'use strict';

  const I18N = {
    en: {
      sectionLayers: 'LAYERS', sectionControls: 'CONTROLS', addLayerTitle: 'Add layer - click, drop, or paste image',
      emptyState: 'Drop, paste, or click + to start', labelOpacity: 'Opacity', labelX: 'X', labelY: 'Y',
      labelScale: 'Scale', labelLayerName: 'Name', labelBlend: 'Blend', blendNormal: 'Normal', blendDifference: 'Difference',
      blendMultiply: 'Multiply', blendScreen: 'Screen', blendOverlay: 'Overlay', blendHardLight: 'Hard Light',
      blendExclusion: 'Exclusion', btnInvert: 'Invert', btnLock: 'Lock', btnRemove: 'Remove',
      btnReset: 'Reset', btnCenter: 'Center', btnFitW: 'Fit W', btnGrid: 'Grid', btnAddLayer: 'Add',
      visShow: 'Show layer', visHide: 'Hide layer', dropHint: 'Drop image to add layer',
      layerDefault: 'Layer', layerNamePlaceholder: 'Layer name', toggleTheme: 'Toggle light / dark theme',
      clipboardLayerName: 'Clipboard image',
      themeLight: 'Switch to light theme', themeDark: 'Switch to dark theme',
      toggleOverlay: 'Enable / disable overlay', overlayLabel: 'Overlay', languageTitle: 'Language', languageAuto: 'Lang: Auto',
      languageEnglish: 'Lang: EN', languageJapanese: 'Lang: JA',
    },
  };
  const LANG_VALUES = new Set(['auto', 'en', 'ja']);
  let langMode = 'auto';
  let activeLang = 'en';
  let extensionContextInvalid = false;

  function normalizeLang(value) { return LANG_VALUES.has(value) ? value : 'auto'; }
  function isExtensionContextInvalidError(error) {
    return /Extension context invalidated/i.test(error?.message || String(error || ''));
  }
  function getRuntimeId() {
    if (extensionContextInvalid) return '';
    try {
      return typeof chrome !== 'undefined' ? chrome.runtime?.id ?? '' : '';
    } catch (error) {
      if (isExtensionContextInvalidError(error)) extensionContextInvalid = true;
      return '';
    }
  }
  function canUseExtensionApi() {
    if (!getRuntimeId()) return false;
    try {
      return typeof chrome !== 'undefined' && !!chrome.storage?.local;
    } catch (error) {
      if (isExtensionContextInvalidError(error)) extensionContextInvalid = true;
      return false;
    }
  }
  async function safeStorageGet(keys, fallback = {}) {
    if (!canUseExtensionApi()) return fallback;
    try {
      return await chrome.storage.local.get(keys);
    } catch (error) {
      if (isExtensionContextInvalidError(error)) {
        extensionContextInvalid = true;
        return fallback;
      }
      throw error;
    }
  }
  async function safeStorageSet(value) {
    if (!canUseExtensionApi()) return false;
    try {
      await chrome.storage.local.set(value);
      return true;
    } catch (error) {
      if (isExtensionContextInvalidError(error)) {
        extensionContextInvalid = true;
        return false;
      }
      throw error;
    }
  }
  function queueStorageSet(value) {
    safeStorageSet(value).catch(error => {
      if (!isExtensionContextInvalidError(error)) console.warn('[DiffPixel] Failed to save setting', error);
    });
  }
  function browserLang() {
    let uiLang = '';
    try { uiLang = chrome.i18n.getUILanguage?.() || ''; } catch {}
    const lang = uiLang || navigator.language || 'en';
    return lang.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  }
  function updateActiveLang() {
    activeLang = langMode === 'auto' ? browserLang() : langMode;
  }
  const t = key => {
    const msg = I18N[activeLang]?.[key];
    if (msg) return msg;
    try { return chrome.i18n.getMessage(key) || key; } catch { return key; }
  };
  const storagePrefix = (() => {
    try {
      const u = new URL(location.href);
      return `dp_${u.hostname || u.protocol.replace(':', '')}`;
    } catch {
      return 'dp_page';
    }
  })();
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const SCALE_MIN = 0.05;
  const SCALE_MAX = 20;
  const SCALE_DECIMALS = 4;
  const SCALE_DISPLAY_DECIMALS = 2;
  const SCALE_PRECISION = 10 ** SCALE_DECIMALS;
  const SCALE_STEP = 0.1;
  const SCALE_STEP_COARSE = 0.01;
  const SCALE_STEP_FINE = 0.001;
  const BASE_STYLE_ID = 'dp-base-style';
  const IMAGE_EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };
  const isEditablePasteTarget = event => {
    const path = event.composedPath?.() ?? [event.target];
    return path.some(node => {
      if (!(node instanceof Element)) return false;
      if (node.isContentEditable) return true;
      if (node.matches?.('input, textarea, select')) return true;
      return !!node.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"]');
    });
  };
  const BASE_CSS = `
    html > #dp-root {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 0 !important;
      height: 0 !important;
      z-index: 2147483645 !important;
      pointer-events: none !important;
      overflow: visible !important;
      isolation: auto !important;
    }
    html > #dp-root .dp-layer {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: max-content !important;
      height: max-content !important;
      z-index: 2147483645 !important;
      transform-origin: top left !important;
      will-change: auto !important;
      pointer-events: auto;
      isolation: auto !important;
      backface-visibility: hidden !important;
    }
    html > #dp-root .dp-layer img {
      display: block !important;
      max-width: none !important;
      max-height: none !important;
      mix-blend-mode: normal !important;
      user-select: none !important;
      -webkit-user-drag: none !important;
    }
    html > #dp-grid {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483646 !important;
      display: none;
      pointer-events: none !important;
      background-repeat: repeat !important;
    }
  `;

  /* ── Storage keys ────────────────────────── */
  const K = {
    STATE:     `${storagePrefix}_state`,
    IMAGES:    `${storagePrefix}_images`,
    THEME:     'dp_theme',
    LANG:      'dp_lang',
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

  function normalizeScale(value, fallback = 1) {
    const n = Number(value);
    const base = Number.isFinite(n) ? n : fallback;
    const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, base));
    return Math.round(clamped * SCALE_PRECISION) / SCALE_PRECISION;
  }

  function formatScale(value) {
    const normalized = normalizeScale(value);
    const fixed = normalized.toFixed(SCALE_DECIMALS);
    const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
    const decimals = trimmed.includes('.') ? trimmed.split('.')[1].length : 0;
    return decimals <= SCALE_DISPLAY_DECIMALS
      ? normalized.toFixed(SCALE_DISPLAY_DECIMALS)
      : trimmed;
  }

  function scaleStepFromEvent(e) {
    if (e?.altKey) return SCALE_STEP_FINE;
    if (e?.shiftKey) return SCALE_STEP_COARSE;
    return SCALE_STEP;
  }

  function extensionAsset(path) {
    try {
      return chrome.runtime.getURL(path);
    } catch {
      return '';
    }
  }

  function themeIconSVG(theme) {
    if (theme === 'light') {
      return `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <circle cx="7.5" cy="7.5" r="3" stroke="currentColor" stroke-width="1.4"/>
        <line x1="7.5" y1="1" x2="7.5" y2="2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <line x1="7.5" y1="12.5" x2="7.5" y2="14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <line x1="1" y1="7.5" x2="2.5" y2="7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <line x1="12.5" y1="7.5" x2="14" y2="7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <line x1="3.2" y1="3.2" x2="4.2" y2="4.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <line x1="10.8" y1="10.8" x2="11.8" y2="11.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <line x1="11.8" y1="3.2" x2="10.8" y2="4.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        <line x1="4.2" y1="10.8" x2="3.2" y2="11.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>`;
    }

    return `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M11.9 9.2A5 5 0 0 1 5.8 3.1a5.2 5.2 0 1 0 6.1 6.1Z" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/>
      <path d="M10.5 2.1l.35 1.05 1.05.35-1.05.35-.35 1.05-.35-1.05-1.05-.35 1.05-.35.35-1.05Z" fill="currentColor"/>
    </svg>`;
  }

  function sanitizeMeta(m) {
    return {
      id:        (typeof m.id === 'string' && VALID_ID_RE.test(m.id)) ? m.id : genId(),
      name:      typeof m.name === 'string' ? m.name.slice(0, 32) : t('layerDefault'),
      opacity:   typeof m.opacity === 'number' ? Math.min(1, Math.max(0, m.opacity)) : 0.5,
      x:         typeof m.x === 'number' ? Math.trunc(m.x) : 0,
      y:         typeof m.y === 'number' ? Math.trunc(m.y) : 0,
      scale:     typeof m.scale === 'number' ? normalizeScale(m.scale) : 1,
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

  function normalizeTheme(theme) {
    if (theme === true) return 'light';
    return String(theme).toLowerCase() === 'light' ? 'light' : 'dark';
  }

  function preferredTheme() {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

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
      const blendMode = VALID_BLEND.has(meta.blendMode) ? meta.blendMode : 'normal';
      this.el.style.display      = (meta.visible && globalEnabled) ? 'block' : 'none';
      this.el.style.zIndex       = '2147483645';
      this.el.style.opacity      = '1';
      this.el.style.transform    = `translate(${meta.x}px, ${meta.y}px) scale(${meta.scale})`;
      this.el.style.mixBlendMode = blendMode;
      this.el.style.pointerEvents= meta.locked ? 'none' : 'auto';
      this.el.style.filter       = 'none';
      if (this.img) {
        this.img.style.opacity = String(meta.opacity);
        this.img.style.setProperty('mix-blend-mode', 'normal', 'important');
        this.img.style.filter = meta.invert ? 'invert(1)' : 'none';
      }
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
            m.x = ox + e.pageX - sx;
            m.y = oy + e.pageY - sy;
            this.el.style.transform = `translate(${m.x}px, ${m.y}px) scale(${m.scale})`;
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
        sx = e.pageX; sy = e.pageY; ox = m.x; oy = m.y;
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
  const pageLeft      = ()  => window.scrollX || document.documentElement.scrollLeft || 0;
  const pageTop       = ()  => window.scrollY || document.documentElement.scrollTop || 0;

  /* ── DOM setup ───────────────────────────── */
  function ensureBaseStyles() {
    let styleEl = document.getElementById(BASE_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = BASE_STYLE_ID;
      document.documentElement.appendChild(styleEl);
    }
    if (styleEl.textContent !== BASE_CSS) styleEl.textContent = BASE_CSS;
  }

  function ensureDOM() {
    ensureBaseStyles();
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
      gridEl.style.setProperty('display', 'block', 'important');
      gridEl.style.backgroundImage =
        `linear-gradient(${c} 1px,transparent 1px),linear-gradient(90deg,${c} 1px,transparent 1px)`;
      gridEl.style.backgroundSize = `${s}px ${s}px`;
    } else { gridEl.style.setProperty('display', 'none', 'important'); }
  }

  /* ── Storage: save ───────────────────────── */
  let _saveTimer = null;
  function debounceSave(immediate = false) {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      saveToStorage().catch(error => {
        if (!isExtensionContextInvalidError(error)) console.warn('[DiffPixel] Failed to save state', error);
      });
    }, immediate ? 0 : 280);
  }

  async function saveToStorage() {
    const imgs = {};
    layerMeta.forEach(m => { const d = imageData.get(m.id); if (d) imgs[m.id] = d; });
    await safeStorageSet({
      [K.STATE]:  { enabled: globalEnabled, activeLayerId, grid: gridConfig, layers: layerMeta },
      [K.IMAGES]: imgs,
    });
  }

  /* ── Storage: load ───────────────────────── */
  async function loadFromStorage() {
    const res = await safeStorageGet([K.STATE, K.IMAGES, K.THEME, K.LANG, K.PANEL_POS]);
    langMode = normalizeLang(res[K.LANG]);
    updateActiveLang();
    currentTheme = normalizeTheme(res[K.THEME] ?? preferredTheme());
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

  /* ── Utility helpers ───────────────────── */
  function getFullState() {
    return {
      enabled: globalEnabled, activeLayerId, grid: gridConfig,
      layers: layerMeta.map(m => ({ ...m, imageData: imageData.get(m.id) ?? '' })),
    };
  }

  /* ─────────────────────────────────────────────
     PANEL CSS — embedded in shadow root
  ──────────────────────────────────────────────── */
  const PANEL_WIDTH = 360;
  const PANEL_EDGE_GAP = 18;

  const PANEL_CSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; font-size: 12px; }

    .dp-p {
      --bg:     #0d0d16; --surf:   #161622; --surf2:  #1e1e2e; --surf3:  #252538;
      --brd:    rgba(255,255,255,0.07); --brd-hi: rgba(0,212,255,0.28);
      --acc:    #00d4ff; --acc-d:  rgba(0,212,255,0.12);
      --active-bg: #00d4ff; --active-soft: rgba(0,212,255,.28); --active-brd: #78eeff; --active-ring: rgba(0,212,255,0.30); --active-fg: #041018;
      --tx:     #e8eaf0; --tx2:    #aab2c5; --tx3:    #919bb0;
      --dng:    #ff4d6a; --dng-d:  rgba(255,77,106,0.12); --ok: #00e5a0;
      --r: 8px;
      --sans: -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
      --mono: 'SFMono-Regular',Consolas,'Liberation Mono',monospace;
      color-scheme: dark;

      position: fixed; width: ${PANEL_WIDTH}px;
      background: var(--bg);
      border: 1px solid var(--brd);
      border-radius: var(--r);
      box-shadow: none;
      font-family: var(--sans); font-size: 12px; color: var(--tx);
      z-index: 2147483647; overflow: hidden; user-select: none;
    }

    /* Light theme */
    .dp-p.dp-light,
    .dp-p[data-theme="light"] {
      --bg:    #f2f3f8; --surf:  #ffffff; --surf2: #ebebf5; --surf3: #dfe0ef;
      --brd:   rgba(0,0,0,0.08); --brd-hi: rgba(0,80,220,0.25);
      --acc:   #0055cc; --acc-d: rgba(0,85,204,0.09);
      --active-bg: #0055cc; --active-soft: rgba(0,85,204,.18); --active-brd: #2d7cff; --active-ring: rgba(0,85,204,0.22); --active-fg: #ffffff;
      --tx:    #1a1d2e; --tx2:   #4b5270; --tx3:   #59627b;
      --dng:   #d63050; --dng-d: rgba(214,48,80,0.1); --ok: #00966a;
      color-scheme: light;
      box-shadow: none;
    }

    /* Header */
    .dp-header {
      display: flex; align-items: center; justify-content: flex-start; gap: 16px;
      padding: 0 11px 0 14px; height: 40px;
      background: var(--surf); border-bottom: 1px solid var(--brd);
      cursor: grab; flex-shrink: 0;
    }
    .dp-header:active { cursor: grabbing; }
    .dp-logo {
      display: flex; align-items: center; gap: 8px;
      min-width: max-content; flex: 0 0 auto; padding-right: 14px;
      border-right: 1px solid var(--brd);
      pointer-events: none;
    }
    .dp-logo-img {
      width: 22px; height: 22px; flex: 0 0 22px;
      object-fit: contain; display: block;
    }
    .dp-logo-fallback {
      width: 22px; height: 22px; display: block; flex: 0 0 22px;
    }
    .dp-logo-tx { font-size: 13px; font-weight: 600; letter-spacing: 0; color: var(--tx); white-space: nowrap; }
    .dp-hbtns { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; margin-left: 0; }
    .dp-settings, .dp-overlay-actions {
      display: flex; align-items: center; gap: 7px;
    }
    .dp-settings {
      padding-right: 10px; margin-right: 0;
      border-right: 1px solid var(--brd);
    }
    .dp-overlay-actions {
      padding-left: 0; margin-left: 0;
    }

    .dp-lang {
      width: 94px; height: 26px; padding: 0 6px;
      background: var(--surf2); border: 1px solid var(--brd); border-radius: 4px;
      color: var(--tx2); font-family: var(--sans); font-size: 10.5px;
      outline: none; cursor: pointer;
    }
    .dp-lang:hover, .dp-lang:focus { border-color: var(--brd-hi); color: var(--tx); }
    .dp-p :where(button, select, input, .dp-addbtn, .dp-li):focus-visible {
      outline: 2px solid var(--active-brd);
      outline-offset: 2px;
    }

    .dp-ibtn {
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; background: none; border: 1px solid transparent;
      border-radius: 4px; color: var(--tx2); cursor: pointer; font-size: 11px;
      transition: background .12s, color .12s, border-color .12s, box-shadow .12s;
    }
    .dp-ibtn:hover { background: var(--surf2); color: var(--tx); }
    .dp-ibtn[aria-pressed="true"] {
      background: var(--active-bg); border-color: var(--active-brd); color: var(--active-fg);
      box-shadow: inset 0 0 0 1px var(--active-brd), 0 0 0 2px var(--active-ring);
    }

    /* Toggle */
    .dp-tog { display: flex; align-items: center; min-width: 34px; min-height: 26px; cursor: pointer; position: relative; }
    .dp-tog input {
      position: absolute; width: 1px; height: 1px; margin: 0; padding: 0;
      opacity: 0; pointer-events: none;
    }
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
    .dp-tog input:checked + .dp-track {
      background: var(--active-bg); border-color: var(--active-brd);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.35), 0 0 0 2px var(--active-ring);
    }
    .dp-tog input:focus-visible + .dp-track {
      box-shadow: 0 0 0 2px var(--active-ring), 0 0 0 4px rgba(0,85,204,.12);
    }
    .dp-tog input:checked + .dp-track .dp-thumb {
      background: var(--active-fg); transform: translateX(14px);
      box-shadow: 0 1px 4px rgba(0,0,0,.35);
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
    .dp-sec { padding: 9px 12px; border-bottom: 1px solid var(--brd); }
    .dp-sec:last-child { border-bottom: none; }
    .dp-shead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .dp-slabel { font-size: 9px; font-weight: 700; letter-spacing: .1em; color: var(--tx3); text-transform: uppercase; }

    /* Add button */
    .dp-addbtn {
      display: flex; align-items: center; justify-content: center;
      gap: 5px; min-width: 58px; height: 24px; padding: 0 8px;
      background: var(--acc-d); border: 1px solid var(--brd-hi);
      border-radius: 5px; color: var(--acc); cursor: pointer; font-size: 10.5px; font-weight: 700; line-height: 1;
      transition: background .12s, border-color .12s, color .12s, box-shadow .12s, transform .08s;
    }
    .dp-addbtn:hover { background: var(--active-soft); border-color: var(--active-brd); color: var(--acc); box-shadow: 0 0 0 2px var(--active-ring); }
    .dp-addbtn:active { transform: scale(.97); }
    .dp-addbtn input {
      position: absolute; width: 1px; height: 1px; margin: 0; padding: 0;
      opacity: 0; pointer-events: none;
    }
    .dp-add-plus { font-size: 15px; font-weight: 800; line-height: 1; }

    /* Layer list */
    .dp-ll { display: flex; flex-direction: column; gap: 2px; }
    .dp-li {
      display: flex; align-items: center; gap: 8px;
      padding: 5px 6px; border-radius: 5px; border: 1px solid transparent;
      position: relative;
      cursor: pointer; transition: background .1s, border-color .1s;
    }
    .dp-li:hover  { background: var(--surf2); border-color: var(--brd); }
    .dp-li.active {
      background: var(--active-soft);
      border-color: var(--active-brd);
      box-shadow: inset 0 0 0 1px var(--active-brd), 0 0 0 2px var(--active-ring);
    }
    .dp-li.active .dp-th {
      border-color: var(--active-brd);
      box-shadow: 0 0 0 1px var(--active-ring);
    }
    .dp-li.active .dp-lname { color: var(--acc); font-weight: 700; }

    .dp-th { width: 34px; height: 22px; border-radius: 3px; overflow: hidden; background: var(--surf3); border: 1px solid var(--brd); flex-shrink: 0; }
    .dp-th img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .dp-linfo { flex: 1; min-width: 0; }
    .dp-lname { font-size: 11px; font-weight: 500; color: var(--tx); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dp-lmeta { font-size: 9.5px; color: var(--tx3); font-family: var(--mono); }

    .dp-visbtn {
      background: none; border: none; cursor: pointer; color: var(--tx2);
      width: 24px; height: 24px; padding: 0; border-radius: 3px; display: flex; align-items: center; justify-content: center;
      opacity: .6; transition: opacity .12s, color .12s; flex-shrink: 0;
    }
    .dp-visbtn:hover { opacity: 1; color: var(--acc); }
    .dp-visbtn.hid { opacity: .2; }

    /* Empty */
    .dp-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 8px; text-align: center; color: var(--tx3); font-size: 10.5px; }

    /* Controls */
    .dp-ni { /* name input */
      flex: 1; min-width: 0; width: auto; background: var(--surf2); border: 1px solid var(--brd);
      border-radius: 4px; color: var(--tx); font-family: var(--sans); font-size: 11px;
      font-weight: 500; min-height: 26px; padding: 4px 7px; outline: none; transition: border-color .15s;
    }
    .dp-ni:focus { border-color: var(--brd-hi); background: var(--surf3); }

    .dp-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .dp-row:last-child { margin-bottom: 0; }
    .dp-cl { font-size: 10.5px; color: var(--tx2); width: 46px; flex-shrink: 0; }
    .dp-name-row .dp-cl, .dp-blend-row .dp-cl { font-weight: 600; }
    .dp-blend-row.is-active .dp-cl { color: var(--active-brd); font-weight: 700; }

    /* Slider */
    .dp-sw { flex: 1; }
    .dp-sl { -webkit-appearance: none; width: 100%; height: 3px; border-radius: 2px; background: var(--surf3); outline: none; cursor: pointer; }
    .dp-sl::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--acc); cursor: pointer; box-shadow: 0 0 5px rgba(0,212,255,.4); transition: transform .1s; }
    .dp-sl::-webkit-slider-thumb:hover { transform: scale(1.2); }

    /* Num input */
    .dp-nw { display: flex; align-items: center; min-height: 24px; background: var(--surf2); border: 1px solid var(--brd); border-radius: 4px; overflow: hidden; transition: border-color .12s; }
    .dp-nw:focus-within { border-color: var(--brd-hi); }
    .dp-nw.f1 { flex: 1; min-width: 0; }
    .dp-num { background: transparent; border: none; color: var(--tx); font-family: var(--mono); font-size: 11px; padding: 3px 5px; text-align: right; outline: none; }
    .dp-num.fw { width: 100%; }
    .dp-num::-webkit-inner-spin-button, .dp-num::-webkit-outer-spin-button { -webkit-appearance: none; }
    .dp-unit { font-family: var(--mono); font-size: 9.5px; color: var(--tx3); padding: 0 5px 0 1px; }

    /* Step buttons */
    .dp-sb { display: flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; background: var(--surf2); border: 1px solid var(--brd); border-radius: 3px; color: var(--tx2); cursor: pointer; padding: 0; font-size: 8px; flex-shrink: 0; transition: all .1s; line-height: 1; }
    .dp-sb:hover { background: var(--surf3); color: var(--acc); border-color: var(--brd-hi); }
    .dp-sb:active { transform: scale(.93); }

    /* Quick-action */
    .dp-qa { gap: 4px; }
    .dp-qbtn { flex: 1; min-height: 24px; background: var(--surf2); border: 1px solid var(--brd); border-radius: 5px; color: var(--tx2); cursor: pointer; font-family: var(--sans); font-size: 10px; font-weight: 500; padding: 3px 4px; text-align: center; transition: all .1s; }
    .dp-qbtn:hover { background: var(--acc-d); border-color: var(--brd-hi); color: var(--acc); }

    /* Select */
    .dp-selw { position: relative; flex: 1; }
    .dp-selw::after { content: '▾'; position: absolute; right: 7px; top: 50%; transform: translateY(-50%); color: var(--tx3); font-size: 9px; pointer-events: none; }
    .dp-sel { width: 100%; min-height: 24px; -webkit-appearance: none; background: var(--surf2); border: 1px solid var(--brd); border-radius: 4px; color: var(--tx); font-family: var(--sans); font-size: 10.5px; padding: 4px 20px 4px 7px; cursor: pointer; outline: none; transition: background .12s, border-color .12s, box-shadow .12s, color .12s; }
    .dp-sel:focus { border-color: var(--active-brd); box-shadow: 0 0 0 2px var(--active-ring); }
    .dp-blend-row.is-active .dp-selw::before {
      content: none; display: none;
    }
    .dp-blend-row.is-active .dp-selw::after { color: var(--acc); }
    .dp-blend-row.is-active .dp-sel {
      background: var(--active-soft); border-color: var(--active-brd); color: var(--acc);
      font-weight: 700; padding-right: 20px;
      box-shadow: inset 0 0 0 1px var(--active-brd), 0 0 0 2px var(--active-ring);
    }

    /* Flag buttons */
    .dp-frow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 42px; gap: 6px; align-items: stretch; margin-top: 2px; }
    .dp-fbtn { display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; min-height: 28px; background: var(--surf2); border: 1px solid var(--brd); border-radius: 5px; color: var(--tx2); cursor: pointer; font-family: var(--sans); font-size: 10.5px; padding: 5px 8px; transition: all .12s; white-space: nowrap; }
    .dp-fbtn:hover { background: var(--surf3); border-color: var(--brd-hi); color: var(--acc); }
    .dp-fbtn.on  {
      background: var(--active-soft) !important; border-color: var(--active-brd); color: var(--acc) !important; font-weight: 700;
      box-shadow: inset 0 0 0 1px var(--active-brd), 0 0 0 2px var(--active-ring);
    }
    .dp-p[data-theme="light"] .dp-fbtn.on,
    .dp-p.dp-light .dp-fbtn.on {
      background: var(--active-soft) !important;
      color: #0055cc !important;
    }
    .dp-fbtn.on::before {
      content: none; display: none;
    }
    .dp-fbtn.dng {
      width: 42px; min-width: 42px; padding: 0; background: rgba(255,77,106,.18); border-color: rgba(255,77,106,.55);
      color: var(--dng); font-weight: 700;
    }
    .dp-fbtn.dng:hover { background: var(--dng); border-color: var(--dng); color: #fff; }

    /* Tool buttons */
    .dp-trow { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; }
    .dp-tbtn { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 116px; min-height: 26px; background: var(--surf2); border: 1px solid var(--brd); border-radius: 5px; color: var(--tx2); cursor: pointer; font-family: var(--sans); font-size: 10.5px; padding: 4px 8px; transition: all .12s; }
    .dp-tbtn:hover { background: var(--surf3); border-color: var(--brd-hi); color: var(--acc); }
    .dp-tbtn.on   {
      background: var(--active-soft); border-color: var(--active-brd); color: var(--acc); font-weight: 700;
      box-shadow: inset 0 0 0 1px var(--active-brd), 0 0 0 2px var(--active-ring);
    }
    /* Initially-hidden elements */
    #dp-ctrl  { display: none; }
    #dp-gsize { display: flex; }
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
    const logoURL = extensionAsset('icons/icon32.png');
    const logoFallback = `<svg class="dp-logo-fallback" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" rx="2" fill="var(--acc)" stroke="#04121a" stroke-width="1.3"/>
      <rect x="12" y="1" width="9" height="9" rx="2" fill="#0b6f86" stroke="#04121a" stroke-width="1.3"/>
      <rect x="1" y="12" width="9" height="9" rx="2" fill="#087089" stroke="#04121a" stroke-width="1.3"/>
      <rect x="12" y="12" width="9" height="9" rx="2" fill="var(--acc)" stroke="#04121a" stroke-width="1.3"/>
      <path d="M3.6 3.4h3.8M14.6 3.4h3.8M3.6 14.4h3.8M14.6 14.4h3.8" stroke="#5feeff" stroke-width="1" stroke-linecap="round" opacity=".85"/>
    </svg>`;
    const logoMark = logoURL
      ? `<img class="dp-logo-img" src="${logoURL}" width="22" height="22" alt="" aria-hidden="true">`
      : logoFallback;
    const eyeOn  = `<svg width="13" height="10" viewBox="0 0 13 10"><ellipse cx="6.5" cy="5" rx="5.5" ry="4" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="6.5" cy="5" r="1.8" fill="currentColor"/></svg>`;
    const eyeOff = `<svg width="13" height="11" viewBox="0 0 13 11"><line x1="1" y1="1" x2="12" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 7.5A5.5 4 0 0 0 10 7.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;
    const gridSVG = `<svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14"><line x1="0" y1="4.67" x2="14" y2="4.67" stroke="currentColor" stroke-width="1.2"/><line x1="0" y1="9.33" x2="14" y2="9.33" stroke="currentColor" stroke-width="1.2"/><line x1="4.67" y1="0" x2="4.67" y2="14" stroke="currentColor" stroke-width="1.2"/><line x1="9.33" y1="0" x2="9.33" y2="14" stroke="currentColor" stroke-width="1.2"/></svg>`;

    return `<div class="dp-p" id="dpp" data-theme="${currentTheme}" role="region" aria-label="DiffPixel">
      <!-- Header -->
      <div class="dp-header" id="dp-drag">
        <div class="dp-logo">${logoMark}<span class="dp-logo-tx">DiffPixel</span></div>
        <div class="dp-hbtns">
          <div class="dp-settings">
          <select class="dp-lang" id="dp-lang" title="${t('languageTitle')}" aria-label="${t('languageTitle')}">
            <option value="auto" ${langMode === 'auto' ? 'selected' : ''}>${t('languageAuto')}</option>
            <option value="en" ${langMode === 'en' ? 'selected' : ''}>${t('languageEnglish')}</option>
            <option value="ja" ${langMode === 'ja' ? 'selected' : ''}>${t('languageJapanese')}</option>
          </select>
          <button type="button" class="dp-ibtn" id="dp-theme" title="${t(currentTheme === 'light' ? 'themeDark' : 'themeLight')}" aria-pressed="false" aria-label="${t('toggleTheme')}">${themeIconSVG(currentTheme)}</button>
          </div>
          <div class="dp-overlay-actions" aria-label="${t('overlayLabel')}">
          <label class="dp-tog" title="${t('toggleOverlay')}" aria-label="${t('toggleOverlay')}"><input type="checkbox" id="dp-en" aria-label="${t('toggleOverlay')}"/><span class="dp-track"><span class="dp-thumb"></span></span></label>
          <button type="button" class="dp-ibtn" id="dp-col" title="Collapse" aria-label="Collapse"><span class="dp-chev">▲</span></button>
          </div>
        </div>
      </div>
      <!-- Drop zone overlay -->
      <div class="dp-dropzone" id="dp-dropzone">
        <svg width="24" height="24" viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M18 6v16M11 14l7-9 7 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 28h24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span>${t('dropHint')}</span>
      </div>
      <!-- Body -->
      <div class="dp-body">
        <!-- Layers -->
        <div class="dp-sec">
          <div class="dp-shead">
            <span class="dp-slabel">${t('sectionLayers')}</span>
            <label class="dp-addbtn" id="dp-add" role="button" tabindex="0" title="${t('addLayerTitle')}" aria-label="${t('addLayerTitle')}">
              <span class="dp-add-plus">+</span><span>${t('btnAddLayer')}</span>
              <input type="file" id="dp-file" accept="image/*" multiple tabindex="-1" aria-label="${t('addLayerTitle')}"/>
            </label>
          </div>
          <div class="dp-ll" id="dp-ll" role="listbox" aria-label="${t('sectionLayers')}">
            <div class="dp-empty" id="dp-empty">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" opacity=".35" aria-hidden="true"><rect x="2" y="2" width="13" height="13" rx="1.5" stroke="var(--acc)" stroke-width="1.5"/><rect x="17" y="2" width="13" height="13" rx="1.5" stroke="var(--acc)" stroke-width="1.5" opacity=".5"/><rect x="2" y="17" width="13" height="13" rx="1.5" stroke="var(--acc)" stroke-width="1.5" opacity=".5"/><rect x="17" y="17" width="13" height="13" rx="1.5" stroke="var(--acc)" stroke-width="1.5"/></svg>
              <p>${t('emptyState')}</p>
            </div>
          </div>
        </div>
        <!-- Controls -->
        <div class="dp-sec" id="dp-ctrl">
          <div class="dp-row dp-name-row">
            <span class="dp-cl">${t('labelLayerName')}</span>
            <input type="text" id="dp-lname" class="dp-ni" placeholder="${t('layerNamePlaceholder')}" maxlength="32" aria-label="${t('labelLayerName')}"/>
          </div>
          <div class="dp-row dp-blend-row" id="dp-blend-row">
            <span class="dp-cl">${t('labelBlend')}</span>
            <div class="dp-selw"><select id="dp-blend" class="dp-sel" aria-label="${t('labelBlend')}">
              <option value="normal">${t('blendNormal')}</option>
              <option value="difference">${t('blendDifference')}</option>
              <option value="multiply">${t('blendMultiply')}</option>
              <option value="screen">${t('blendScreen')}</option>
              <option value="overlay">${t('blendOverlay')}</option>
              <option value="hard-light">${t('blendHardLight')}</option>
              <option value="exclusion">${t('blendExclusion')}</option>
            </select></div>
          </div>
          <div class="dp-row">
            <span class="dp-cl">${t('labelOpacity')}</span>
            <div class="dp-sw"><input type="range" id="dp-osl" class="dp-sl" min="0" max="100" step="1" value="50" aria-label="${t('labelOpacity')}"/></div>
            <div class="dp-nw"><input type="number" id="dp-onum" class="dp-num dp-onum-w" min="0" max="100" value="50" aria-label="${t('labelOpacity')}"/><span class="dp-unit">%</span></div>
          </div>
          <div class="dp-row">
            <span class="dp-cl">${t('labelX')}</span>
            <button type="button" class="dp-sb" data-f="x" data-d="-1" aria-label="${t('labelX')} -1">◀</button>
            <div class="dp-nw f1"><input type="number" id="dp-xi" class="dp-num fw" value="0" step="1" aria-label="${t('labelX')}"/><span class="dp-unit">px</span></div>
            <button type="button" class="dp-sb" data-f="x" data-d="1" aria-label="${t('labelX')} +1">▶</button>
          </div>
          <div class="dp-row">
            <span class="dp-cl">${t('labelY')}</span>
            <button type="button" class="dp-sb" data-f="y" data-d="-1" aria-label="${t('labelY')} -1">◀</button>
            <div class="dp-nw f1"><input type="number" id="dp-yi" class="dp-num fw" value="0" step="1" aria-label="${t('labelY')}"/><span class="dp-unit">px</span></div>
            <button type="button" class="dp-sb" data-f="y" data-d="1" aria-label="${t('labelY')} +1">▶</button>
          </div>
          <div class="dp-row">
            <span class="dp-cl">${t('labelScale')}</span>
            <button type="button" class="dp-sb" data-f="scale" data-d="-1" title="Scale -0.1 (Shift: 0.01 / Alt: 0.001)" aria-label="${t('labelScale')} -0.1">◀</button>
            <div class="dp-nw f1"><input type="text" id="dp-si" class="dp-num fw" value="1.00" inputmode="decimal" autocomplete="off" aria-label="${t('labelScale')}"/><span class="dp-unit">x</span></div>
            <button type="button" class="dp-sb" data-f="scale" data-d="1" title="Scale +0.1 (Shift: 0.01 / Alt: 0.001)" aria-label="${t('labelScale')} +0.1">▶</button>
          </div>
          <div class="dp-row dp-qa">
            <button type="button" class="dp-qbtn" id="dp-reset">${t('btnReset')}</button>
            <button type="button" class="dp-qbtn" id="dp-center">${t('btnCenter')}</button>
            <button type="button" class="dp-qbtn" id="dp-fitw">${t('btnFitW')}</button>
          </div>
          <div class="dp-row dp-frow">
            <button type="button" class="dp-fbtn" id="dp-inv" aria-pressed="false">
              <svg width="11" height="11" viewBox="0 0 13 13" fill="none" aria-hidden="true"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M6.5 1v11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M1.7 6.5h4.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              ${t('btnInvert')}
            </button>
            <button type="button" class="dp-fbtn" id="dp-lock" aria-pressed="false">
              <svg width="10" height="11" viewBox="0 0 12 13" fill="none" aria-hidden="true"><rect x="1" y="5.5" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M3 5.5V3.5a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
              ${t('btnLock')}
            </button>
            <button type="button" class="dp-fbtn dng" id="dp-del" title="${t('btnRemove')}" aria-label="${t('btnRemove')}">
              <svg width="10" height="10" viewBox="0 0 11 11"><line x1="1.5" y1="1.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="9.5" y1="1.5" x2="1.5" y2="9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
        <!-- Tools -->
        <div class="dp-sec">
          <div class="dp-trow">
            <button type="button" class="dp-tbtn" id="dp-grid" aria-pressed="false">${gridSVG} <span>${t('btnGrid')}</span></button>
            <div class="dp-nw" id="dp-gsize">
              <input type="number" id="dp-gnum" class="dp-num dp-gnum-w" min="2" max="128" step="1" value="8" aria-label="${t('gridSizeLabel')}"/>
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
      this._onPaste = e => this._handlePaste(e);
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

      const defX = Math.max(0, window.innerWidth - PANEL_WIDTH - PANEL_EDGE_GAP), defY = 20;
      this._px = savedPos?.x ?? defX;
      this._py = savedPos?.y ?? defY;
      this._setPos(this._px, this._py);

      this._bindEvents();
      document.addEventListener('paste', this._onPaste, { capture: true });
      this.renderAll();
    }

    _setPos(x, y) {
      this._px = Math.min(Math.max(0, x), window.innerWidth - PANEL_WIDTH);
      this._py = Math.min(Math.max(0, y), window.innerHeight - 40);
      this.root.style.left = `${this._px}px`;
      this.root.style.top  = `${this._py}px`;
    }

    applyTheme(theme) {
      currentTheme = normalizeTheme(theme);
      this.root?.classList.toggle('dp-light', currentTheme === 'light');
      this.root?.setAttribute('data-theme', currentTheme);
      const btn = this.shadow?.getElementById('dp-theme');
      if (btn) {
        btn.title = t(currentTheme === 'light' ? 'themeDark' : 'themeLight');
        btn.setAttribute('aria-label', btn.title);
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = themeIconSVG(currentTheme);
      }
    }

    refreshLanguage() {
      if (!this.root) return;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = buildPanelHTML();
      const nextRoot = wrapper.firstElementChild;
      nextRoot.style.pointerEvents = 'auto';
      nextRoot.style.left = this.root.style.left;
      nextRoot.style.top = this.root.style.top;
      nextRoot.classList.toggle('collapsed', this._collapsed);
      this.root.replaceWith(nextRoot);
      this.root = nextRoot;
      this.applyTheme(currentTheme);
      this._bindEvents();
      this.renderAll();
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
      empty.setAttribute('aria-hidden', String(layerMeta.length !== 0));

      layerMeta.forEach(meta => {
        const item = document.createElement('div');
        item.className = 'dp-li' + (meta.id === activeLayerId ? ' active' : '');
        item.dataset.id = meta.id;
        item.tabIndex = 0;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(meta.id === activeLayerId));
        item.setAttribute('aria-label', `${meta.name}, ${Math.round(meta.opacity * 100)}%, ${meta.x}px ${meta.y}px, x${formatScale(meta.scale)}`);

        const th = document.createElement('div'); th.className = 'dp-th';
        const img = imageData.get(meta.id);
        if (img) {
          const i = document.createElement('img');
          i.src = img;
          i.alt = '';
          i.setAttribute('aria-hidden', 'true');
          th.appendChild(i);
        }

        const info = document.createElement('div'); info.className = 'dp-linfo';
        const nameDiv = document.createElement('div'); nameDiv.className = 'dp-lname';
        nameDiv.textContent = meta.name;
        const metaDiv = document.createElement('div'); metaDiv.className = 'dp-lmeta';
        metaDiv.textContent = `${Math.round(meta.opacity * 100)}% | ${meta.x}px ${meta.y}px | x${formatScale(meta.scale)}`;
        info.appendChild(nameDiv); info.appendChild(metaDiv);

        const vis = document.createElement('button');
        vis.type = 'button';
        vis.className = 'dp-visbtn' + (!meta.visible ? ' hid' : '');
        vis.title = t(meta.visible ? 'visHide' : 'visShow');
        vis.setAttribute('aria-label', t(meta.visible ? 'visHide' : 'visShow'));
        vis.setAttribute('aria-pressed', String(!!meta.visible));
        vis.innerHTML = meta.visible
          ? `<svg width="13" height="10" viewBox="0 0 13 10" aria-hidden="true"><ellipse cx="6.5" cy="5" rx="5.5" ry="4" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="6.5" cy="5" r="1.8" fill="currentColor"/></svg>`
          : `<svg width="13" height="11" viewBox="0 0 13 11" aria-hidden="true"><line x1="1" y1="1" x2="12" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 7.5A5.5 4 0 0 0 10 7.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;
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
        item.addEventListener('keydown', e => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
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
      const si = g('dp-si'); if (si && si !== this.shadow.activeElement) si.value = formatScale(meta.scale);
      const bl = g('dp-blend'); if (bl) bl.value = meta.blendMode;
      g('dp-blend-row')?.classList.toggle('is-active', meta.blendMode !== 'normal');
      const inv = g('dp-inv');
      const lock = g('dp-lock');
      inv?.classList.toggle('on', !!meta.invert);
      inv?.setAttribute('aria-pressed', String(!!meta.invert));
      lock?.classList.toggle('on', !!meta.locked);
      lock?.setAttribute('aria-pressed', String(!!meta.locked));
    }

    renderGrid() {
      const btn  = this.shadow.getElementById('dp-grid');
      const wrap = this.shadow.getElementById('dp-gsize');
      const inp  = this.shadow.getElementById('dp-gnum');
      btn?.classList.toggle('on', gridConfig.enabled);
      btn?.setAttribute('aria-pressed', String(!!gridConfig.enabled));
      if (wrap) wrap.style.display = 'flex';
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
          queueStorageSet({ [K.PANEL_POS]: { x: this._px, y: this._py } });
        };
        document.addEventListener('mousemove', onMove, { capture: true, passive: true });
        document.addEventListener('mouseup',   onUp,   { capture: true });
      });

      /* Collapse */
      g('dp-col')?.addEventListener('click', () => {
        this._collapsed = !this._collapsed;
        this.root.classList.toggle('collapsed', this._collapsed);
      });

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

      /* Language */
      g('dp-lang')?.addEventListener('change', e => {
        langMode = normalizeLang(e.target.value);
        updateActiveLang();
        queueStorageSet({ [K.LANG]: langMode });
        this.refreshLanguage();
      });

      /* Theme */
      g('dp-theme')?.addEventListener('click', () => {
        const next = currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(next);
        queueStorageSet({ [K.THEME]: next });
        if (canUseExtensionApi()) {
          try { chrome.runtime.sendMessage({ type: 'THEME_CHANGED', theme: next }); } catch {}
        }
      });

      /* Enable */
      g('dp-en')?.addEventListener('change', e => { setEnabled(e.target.checked); debounceSave(); });

      /* File upload (multiple) */
      g('dp-add')?.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        g('dp-file')?.click();
      });
      g('dp-file')?.addEventListener('change', e => {
        const files = [...(e.target.files ?? [])].filter(f => f.type.startsWith('image/'));
        if (files.length) this._addLayers(files);
        e.target.value = '';
      });

      /* Opacity */
      const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      const nudgeActiveLayer = e => {
        const meta = getActiveMeta();
        if (!meta || meta.locked) return;
        const step = e.shiftKey ? 10 : 1;
        let moved = false;
        if (e.key === 'ArrowLeft')  { meta.x -= step; moved = true; }
        if (e.key === 'ArrowRight') { meta.x += step; moved = true; }
        if (e.key === 'ArrowUp')    { meta.y -= step; moved = true; }
        if (e.key === 'ArrowDown')  { meta.y += step; moved = true; }
        if (!moved) return;
        layerDOM.get(meta.id)?.applyStyle(meta);
        this.renderControls(); this.renderLayers(); debounceSave();
      };
      const blurAndNudgeOnArrow = el => {
        el?.addEventListener('keydown', e => {
          if (!arrowKeys.includes(e.key)) return;
          e.preventDefault();
          e.stopPropagation();
          e.target.blur();
          nudgeActiveLayer(e);
        });
      };

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
      blurAndNudgeOnArrow(g('dp-osl'));
      blurAndNudgeOnArrow(g('dp-onum'));

      /* X / Y / Scale inputs */
      const bindNum = (id, field, parse = parseInt) => {
        g(id)?.addEventListener('input', e => {
          const meta = getActiveMeta(); if (!meta) return;
          let v = parse(e.target.value, 10);
          if (field === 'scale') v = normalizeScale(v, meta.scale);
          else v = v || 0;
          meta[field] = v;
          layerDOM.get(meta.id)?.applyStyle(meta); this.renderLayers(); debounceSave();
        });
      };
      bindNum('dp-xi', 'x');
      bindNum('dp-yi', 'y');
      bindNum('dp-si', 'scale', parseFloat);
      blurAndNudgeOnArrow(g('dp-xi'));
      blurAndNudgeOnArrow(g('dp-yi'));
      blurAndNudgeOnArrow(g('dp-si'));

      g('dp-si')?.addEventListener('blur', e => {
        const meta = getActiveMeta(); if (!meta) return;
        e.target.value = formatScale(meta.scale);
      });

      /* Step buttons */
      this.shadow.querySelectorAll('.dp-sb').forEach(btn => {
        btn.addEventListener('click', e => {
          const meta = getActiveMeta(); if (!meta) return;
          const f = btn.dataset.f, d = +btn.dataset.d;
          if (f === 'x')     meta.x += d;
          else if (f === 'y') meta.y += d;
          else if (f === 'scale') meta.scale = normalizeScale(meta.scale + d * scaleStepFromEvent(e), meta.scale);
          layerDOM.get(meta.id)?.applyStyle(meta);
          this.renderControls(); this.renderLayers(); debounceSave();
        });
      });

      /* Quick actions */
      g('dp-reset')?.addEventListener('click', () => {
        const meta = getActiveMeta(); if (!meta) return;
        meta.x = 0; meta.y = 0; meta.scale = 1;
        layerDOM.get(meta.id)?.applyStyle(meta); this.renderControls(); this.renderLayers(); debounceSave();
      });
      g('dp-center')?.addEventListener('click', () => {
        const meta = getActiveMeta(), layer = meta ? layerDOM.get(meta.id) : null; if (!meta || !layer) return;
        meta.x = Math.round(pageLeft() + (window.innerWidth  - (layer.img?.naturalWidth  ?? 0) * meta.scale) / 2);
        meta.y = Math.round(pageTop()  + (window.innerHeight - (layer.img?.naturalHeight ?? 0) * meta.scale) / 2);
        layerDOM.get(meta.id)?.applyStyle(meta); this.renderControls(); this.renderLayers(); debounceSave();
      });
      g('dp-fitw')?.addEventListener('click', () => {
        const meta = getActiveMeta(), layer = meta ? layerDOM.get(meta.id) : null; if (!meta || !layer) return;
        const nw = layer.img?.naturalWidth; if (!nw) return;
        meta.scale = normalizeScale(window.innerWidth / nw, meta.scale); meta.x = pageLeft();
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
      const blendSelect = g('dp-blend');
      blendSelect?.addEventListener('keydown', e => {
        if (!arrowKeys.includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        e.target.blur();
        nudgeActiveLayer(e);
      });
      blendSelect?.addEventListener('change', e => {
        const meta = getActiveMeta(); if (!meta) return;
        meta.blendMode = e.target.value;
        this.shadow.getElementById('dp-blend-row')?.classList.toggle('is-active', meta.blendMode !== 'normal');
        layerDOM.get(meta.id)?.applyStyle(meta); debounceSave();
        e.target.blur();
      });

      /* Flag buttons */
      g('dp-inv')?.addEventListener('click', () => {
        const meta = getActiveMeta(); if (!meta) return;
        meta.invert = !meta.invert; layerDOM.get(meta.id)?.applyStyle(meta);
        g('dp-inv').classList.toggle('on', meta.invert);
        g('dp-inv').setAttribute('aria-pressed', String(!!meta.invert));
        debounceSave();
      });
      g('dp-lock')?.addEventListener('click', () => {
        const meta = getActiveMeta(); if (!meta) return;
        meta.locked = !meta.locked; layerDOM.get(meta.id)?.applyStyle(meta);
        g('dp-lock').classList.toggle('on', meta.locked);
        g('dp-lock').setAttribute('aria-pressed', String(!!meta.locked));
        debounceSave();
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
    _clipboardImageFiles(event) {
      const clipboard = event.clipboardData;
      if (!clipboard) return [];
      const items = [...(clipboard.items ?? [])];
      const sourceFiles = items.length
        ? items.filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean)
        : [...(clipboard.files ?? [])].filter(file => file.type.startsWith('image/'));

      return sourceFiles.map((file, index) => {
        const ext = IMAGE_EXT_BY_MIME[file.type] ?? 'png';
        const stamp = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/:/g, '.');
        const name = `${t('clipboardLayerName')} ${stamp}${index ? ` ${index + 1}` : ''}.${ext}`;
        try {
          return new File([file], name, { type: file.type, lastModified: file.lastModified || Date.now() });
        } catch {
          return file;
        }
      });
    }

    _handlePaste(event) {
      if (!this._visible || event.defaultPrevented || isEditablePasteTarget(event)) return;
      const files = this._clipboardImageFiles(event).filter(file => file.size <= MAX_IMAGE_BYTES);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      this._addLayers(files);
    }

    _addLayers(files) {
      [...files].forEach(file => {
        if (!file.type.startsWith('image/') || file.size > MAX_IMAGE_BYTES) return;
        const reader = new FileReader();
        reader.onload = e => {
          const data = e.target.result;
          const id   = genId();
          const name = (file.name.replace(/\.[^.]+$/, '') || t('layerDefault')).slice(0, 32);
          const meta = { id, name, opacity: .5, x: Math.round(pageLeft()), y: Math.round(pageTop()), scale: 1, blendMode: 'normal', visible: true, invert: false, locked: false };
          imageData.set(id, data);
          layerMeta.push(meta);
          activeLayerId = id;
          setEnabled(true);
          const l = new Layer(id); layerDOM.set(id, l); l.mount(containerEl, meta);
          this.renderAll(); debounceSave(true);
        };
        reader.readAsDataURL(file);
      });
    }

    destroy() {
      document.removeEventListener('paste', this._onPaste, { capture: true });
      this.host?.remove();
    }
  }

  /* ── Panel: on-demand creation ──────────── */
  async function createAndShowPanel() {
    if (panel) { panel.show(); return; }
    const res = await safeStorageGet(K.PANEL_POS);
    panel = new DiffPixelPanel();
    panel.mount(res[K.PANEL_POS] ?? null);
  }

  /* ── chrome.runtime messages ── */
  if (canUseExtensionApi()) {
    try {
      chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    const runtimeId = getRuntimeId();
    if (!runtimeId || !sender || sender.id !== runtimeId) return;
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
        setEnabled(true);
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
    } catch (error) {
      if (!isExtensionContextInvalidError(error)) throw error;
    }
  }

  /* ── Cross-tab sync via storage.onChanged ── */
  if (canUseExtensionApi()) {
    try {
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

    if (changes[K.LANG]) {
      langMode = normalizeLang(changes[K.LANG].newValue);
      updateActiveLang();
      panel?.refreshLanguage();
    }
      });
    } catch (error) {
      if (!isExtensionContextInvalidError(error)) throw error;
    }
  }

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
