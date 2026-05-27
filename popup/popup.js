/* DiffPixel — Popup Script v1.2 */
'use strict';

/* ── i18n ──────────────────────────────────── */
const I18N = {
  en: {
    statusConnecting: 'Connecting...', statusConnected: 'Connected', statusCantRun: 'Cannot run on this page',
    sectionLayers: 'LAYERS', sectionControls: 'CONTROLS', sectionTools: 'TOOLS',
    addLayerTitle: 'Add layer - click or drop image', emptyState: 'Drop an image or click + to start',
    labelOpacity: 'Opacity', labelX: 'X', labelY: 'Y', labelScale: 'Scale', labelBlend: 'Blend',
    blendNormal: 'Normal', blendDifference: 'Difference', blendMultiply: 'Multiply', blendScreen: 'Screen',
    blendOverlay: 'Overlay', blendHardLight: 'Hard Light', blendExclusion: 'Exclusion',
    btnInvert: 'Invert', btnLock: 'Lock', btnRemove: 'Remove', btnReset: 'Reset', btnCenter: 'Center',
    btnFitW: 'Fit W', btnGrid: 'Grid', gridSizeLabel: 'Grid size',
    savedLabel: 'Settings auto-saved', clearSavedBtn: 'Clear', clearSavedTitle: 'Clear saved settings for this domain',
    noSaved: 'No saved settings', visShow: 'Show layer', visHide: 'Hide layer', dropHint: 'Drop image to add layer',
    layerDefault: 'Layer', layerNamePlaceholder: 'Layer name',
    toggleTheme: 'Toggle light / dark theme', themeLight: 'Switch to light theme', themeDark: 'Switch to dark theme',
    toggleOverlay: 'Enable / disable overlay', overlayLabel: 'Overlay', languageTitle: 'Language', languageAuto: 'Lang: Auto',
    languageEnglish: 'Lang: EN', languageJapanese: 'Lang: JA',
  },
};
const LANG_VALUES = new Set(['auto', 'en', 'ja']);
let langMode = 'auto';
let activeLang = 'en';

function normalizeLang(value) { return LANG_VALUES.has(value) ? value : 'auto'; }
function browserLang() {
  const lang = chrome.i18n.getUILanguage?.() || navigator.language || 'en';
  return lang.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}
function updateActiveLang() {
  activeLang = langMode === 'auto' ? browserLang() : langMode;
  document.documentElement.lang = activeLang;
}
const t = key => {
  const msg = I18N[activeLang]?.[key];
  if (msg) return msg;
  try { return chrome.i18n.getMessage(key) || key; } catch { return key; }
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SCALE_MIN = 0.05;
const SCALE_MAX = 20;
const SCALE_DECIMALS = 4;
const SCALE_DISPLAY_DECIMALS = 2;
const SCALE_PRECISION = 10 ** SCALE_DECIMALS;
const SCALE_STEP = 0.1;
const SCALE_STEP_COARSE = 0.01;
const SCALE_STEP_FINE = 0.001;

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

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const msg = t(key);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const msg = t(el.dataset.i18nTitle);
    if (msg) el.title = msg;
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const msg = t(el.dataset.i18nAriaLabel);
    if (msg) el.setAttribute('aria-label', msg);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const msg = t(el.dataset.i18nPlaceholder);
    if (msg) el.placeholder = msg;
  });
  /* Select options */
  document.querySelectorAll('option[data-i18n]').forEach(el => {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
}

/* ── Theme ──────────────────────────────────── */
let currentTheme = 'dark';

function normalizeTheme(theme) {
  if (theme === true) return 'light';
  return String(theme).toLowerCase() === 'light' ? 'light' : 'dark';
}

function preferredTheme() {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
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

function updateThemeButton() {
  if (!themeBtn) return;
  const label = t(currentTheme === 'light' ? 'themeDark' : 'themeLight');
  themeBtn.setAttribute('aria-label', label);
  themeBtn.setAttribute('aria-pressed', 'false');
  themeBtn.title = label;
  themeBtn.innerHTML = themeIconSVG(currentTheme);
}

function applyTheme(theme) {
  currentTheme = normalizeTheme(theme);
  document.documentElement.classList.toggle('dp-light', currentTheme === 'light');
  document.body.classList.toggle('dp-light', currentTheme === 'light');
  document.documentElement.dataset.theme = currentTheme;
  document.body.dataset.theme = currentTheme;
  updateThemeButton();
}

async function loadTheme() {
  const res = await chrome.storage.local.get('dp_theme');
  applyTheme(res.dp_theme ?? preferredTheme());
}

async function toggleTheme() {
  const next = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await chrome.storage.local.set({ dp_theme: next });
}

async function loadLanguage() {
  const res = await chrome.storage.local.get('dp_lang');
  langMode = normalizeLang(res.dp_lang);
  updateActiveLang();
  if (langSelect) langSelect.value = langMode;
}

async function setLanguage(value) {
  langMode = normalizeLang(value);
  updateActiveLang();
  if (langSelect) langSelect.value = langMode;
  await chrome.storage.local.set({ dp_lang: langMode });
  applyI18n();
  updateThemeButton();
  renderAll();
}

/* ── State ──────────────────────────────────── */
let tabId = null;
let hostname = '';
let storageScope = '';
let connected = false;

let appState = {
  enabled: false,
  activeLayerId: null,
  grid: { enabled: false, size: 8, color: 'rgba(0,212,255,0.25)' },
  layers: [],
};

/* ── DOM refs ───────────────────────────────── */
const $ = id => document.getElementById(id);

const enableToggle    = $('enableToggle');
const statusDot       = $('statusDot');
const statusText      = $('statusText');
const layerList       = $('layerList');
const emptyState      = $('emptyState');
const controlsSection = $('controlsSection');
const addLayerBtn     = $('addLayerBtn');
const fileInput       = $('fileInput');
const dropZone        = $('dropZone');
const persistRow      = $('persistRow');
const persistLabel    = $('persistLabel');
const clearSavedBtn   = $('clearSavedBtn');

const layerNameInput  = $('layerNameInput');
const opacitySlider   = $('opacitySlider');
const opacityInput    = $('opacityInput');
const xInput          = $('xInput');
const yInput          = $('yInput');
const scaleInput      = $('scaleInput');
const blendSelect     = $('blendSelect');
const blendRow        = $('blendRow');
const invertBtn       = $('invertBtn');
const lockBtn         = $('lockBtn');
const removeLayerBtn  = $('removeLayerBtn');
const resetBtn        = $('resetBtn');
const centerBtn       = $('centerBtn');
const fitWidthBtn     = $('fitWidthBtn');
const gridBtn         = $('gridBtn');
const gridSizeWrap    = $('gridSizeWrap');
const gridSizeInput   = $('gridSizeInput');
const langSelect      = $('langSelect');

const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const blurOnArrow = el => {
  el?.addEventListener('keydown', e => {
    if (!arrowKeys.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    el.blur();
  });
};
const themeBtn        = $('themeBtn');

/* ── Messaging ──────────────────────────────── */
function send(msg) {
  return new Promise(resolve => {
    if (!tabId) return resolve(null);
    chrome.tabs.sendMessage(tabId, msg, res => {
      resolve(chrome.runtime.lastError ? null : res);
    });
  });
}

/* ── Persistence ────────────────────────────── */
function storageKey() { return `dp_${storageScope || hostname}`; }
function contentStateKey() { return `${storageKey()}_state`; }

/**
 * Save per-domain settings to chrome.storage.local.
 * Images are NOT saved (too large); only metadata + positions.
 */
async function saveSettings() {
  if (!hostname) return;
  const settings = {
    enabled: appState.enabled,
    activeLayerId: appState.activeLayerId,
    grid: appState.grid,
    layersMeta: appState.layers.map(l => ({
      id: l.id, name: l.name,
      opacity: l.opacity, x: l.x, y: l.y,
      scale: l.scale, blendMode: l.blendMode,
      visible: l.visible, invert: l.invert, locked: l.locked,
    })),
    savedAt: Date.now(),
  };
  await chrome.storage.local.set({ [storageKey()]: settings });
  showPersistRow(true);
}

async function loadSettings() {
  if (!hostname) return null;
  const result = await chrome.storage.local.get(storageKey());
  return result[storageKey()] ?? null;
}

async function clearSettings() {
  if (!hostname) return;
  await chrome.storage.local.remove(storageKey());
  showPersistRow(false);
}

function showPersistRow(hasSaved) {
  persistRow.style.display = hasSaved ? 'flex' : 'none';
}

/* ── Status ─────────────────────────────────── */
function setStatus(type, key) {
  statusDot.className = 'status-dot' + (type ? ' ' + type : '');
  statusText.textContent = t(key);
}

/* ── Init ───────────────────────────────────── */
async function init() {
  await loadLanguage();
  applyI18n();
  await loadTheme();   // Apply saved theme before rendering

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { setStatus('err', 'statusCantRun'); return; }
  tabId = tab.id;

  try {
    const url = new URL(tab.url);
    hostname = url.hostname;
    storageScope = url.hostname || url.protocol.replace(':', '');
  } catch {
    storageScope = 'page';
  }

  setStatus('', 'statusConnecting');

  /* Check content script is alive */
  let pong = await send({ type: 'PING' });
  if (!pong?.ok) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/content.css'] });
    } catch {}
    pong = await send({ type: 'PING' });
    if (!pong?.ok) {
      setStatus('err', 'statusCantRun');
      return;
    }
  }

  connected = true;
  setStatus('ok', 'statusConnected');

  /* Load current overlay state from content script */
  const liveState = await send({ type: 'GET_STATE' });
  if (liveState) {
    appState = { ...appState, ...liveState, layers: liveState.layers ?? [] };
  }

  /* Restore saved settings and sync meta to live layers */
  const saved = await loadSettings();
  if (saved) {
    showPersistRow(true);
    /* Apply saved positions to any live layers that match by id */
    (saved.layersMeta ?? []).forEach(meta => {
      const live = appState.layers.find(l => l.id === meta.id);
      if (live) Object.assign(live, meta);
    });
    /* Restore grid from saved */
    if (saved.grid) appState.grid = saved.grid;
    if (!appState.activeLayerId && saved.activeLayerId) {
      appState.activeLayerId = saved.activeLayerId;
    }
  }

  renderAll();
  listenRuntime();
}

/* ── Render ─────────────────────────────────── */
function renderAll() {
  enableToggle.checked = appState.enabled;
  renderLayerList();
  renderControls();
  renderGrid();
}

function renderLayerList() {
  layerList.querySelectorAll('.layer-item').forEach(el => el.remove());
  emptyState.style.display = appState.layers.length === 0 ? '' : 'none';
  emptyState.setAttribute('aria-hidden', String(appState.layers.length !== 0));

  appState.layers.forEach(layer => {
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer.id === appState.activeLayerId ? ' active' : '');
    item.dataset.id = layer.id;
    item.tabIndex = 0;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(layer.id === appState.activeLayerId));
    item.setAttribute(
      'aria-label',
      `${layer.name}, ${Math.round(layer.opacity * 100)}%, ${layer.x}px ${layer.y}px, x${formatScale(layer.scale)}`
    );

    const thumb = document.createElement('div');
    thumb.className = 'layer-thumb';
    if (layer.imageData) {
      const img = document.createElement('img');
      img.src = layer.imageData;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      thumb.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'layer-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'layer-name';
    nameEl.textContent = layer.name;

    const metaEl = document.createElement('div');
    metaEl.className = 'layer-meta';
    metaEl.textContent = `${Math.round(layer.opacity * 100)}% | ${layer.x}px ${layer.y}px | x${formatScale(layer.scale)}`;

    info.appendChild(nameEl);
    info.appendChild(metaEl);

    const visBtn = document.createElement('button');
    visBtn.type = 'button';
    visBtn.className = 'layer-vis-btn' + (!layer.visible ? ' hidden' : '');
    visBtn.title = t(layer.visible ? 'visHide' : 'visShow');
    visBtn.setAttribute('aria-label', visBtn.title);
    visBtn.setAttribute('aria-pressed', String(!!layer.visible));
    visBtn.innerHTML = layer.visible
      ? `<svg aria-hidden="true" width="13" height="10" viewBox="0 0 13 10"><ellipse cx="6.5" cy="5" rx="5.5" ry="4" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="6.5" cy="5" r="1.8" fill="currentColor"/></svg>`
      : `<svg aria-hidden="true" width="13" height="11" viewBox="0 0 13 11"><line x1="1" y1="1" x2="12" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 7.5A5.5 4 0 0 0 10 7.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;

    visBtn.addEventListener('click', e => { e.stopPropagation(); toggleLayerVisibility(layer.id); });

    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(visBtn);
    item.addEventListener('click', () => setActiveLayer(layer.id));
    item.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      setActiveLayer(layer.id);
    });
    layerList.appendChild(item);
  });
}

function renderControls() {
  const layer = activeLayer();
  if (!layer) {
    controlsSection.style.display = 'none';
    blendRow?.classList.remove('is-active');
    return;
  }

  controlsSection.style.display = 'block';
  layerNameInput.value = layer.name;
  opacitySlider.value  = Math.round(layer.opacity * 100);
  opacityInput.value   = Math.round(layer.opacity * 100);
  xInput.value         = layer.x;
  yInput.value         = layer.y;
  if (scaleInput !== document.activeElement) scaleInput.value = formatScale(layer.scale);
  blendSelect.value    = layer.blendMode;
  blendRow?.classList.toggle('is-active', layer.blendMode !== 'normal');
  invertBtn.classList.toggle('active', !!layer.invert);
  invertBtn.setAttribute('aria-pressed', String(!!layer.invert));
  lockBtn.classList.toggle('active',   !!layer.locked);
  lockBtn.setAttribute('aria-pressed', String(!!layer.locked));
}

function renderGrid() {
  gridBtn.classList.toggle('active', appState.grid.enabled);
  gridBtn.setAttribute('aria-pressed', String(!!appState.grid.enabled));
  gridSizeWrap.style.display = appState.grid.enabled ? 'flex' : 'none';
  gridSizeInput.value = appState.grid.size;
}

/* ── Helpers ────────────────────────────────── */
function activeLayer() {
  return appState.layers.find(l => l.id === appState.activeLayerId) ?? null;
}

function genId() {
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  return 'dp-' + Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').slice(0, 9);
}

/* ── Actions ────────────────────────────────── */
async function setEnabled(enabled) {
  appState.enabled = enabled;
  await send({ type: 'SET_ENABLED', enabled });
  await saveSettings();
}

async function setActiveLayer(id) {
  appState.activeLayerId = id;
  await send({ type: 'SET_ACTIVE', layerId: id });
  renderLayerList();
  renderControls();
}

async function toggleLayerVisibility(id) {
  const layer = appState.layers.find(l => l.id === id);
  if (!layer) return;
  layer.visible = !layer.visible;
  await send({ type: 'UPDATE_LAYER', layerId: id, data: { visible: layer.visible } });
  renderLayerList();
  await saveSettings();
}

async function updateActiveLayer(data) {
  const layer = activeLayer();
  if (!layer) return;
  Object.assign(layer, data);
  await send({ type: 'UPDATE_LAYER', layerId: layer.id, data });
  renderLayerList();
  await saveSettings();
}

async function addImageLayer(file) {
  if (!file.type.startsWith('image/') || file.size > MAX_IMAGE_BYTES) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const imageData = e.target.result;
    const name = (file.name.replace(/\.[^.]+$/, '') || t('layerDefault')).slice(0, 32);
    const layer = {
      id: genId(), name,
      imageData,
      opacity: 0.5,
      x: 0, y: 0, scale: 1,
      blendMode: 'normal',
      visible: true, invert: false, locked: false,
    };
    appState.layers.push(layer);
    appState.activeLayerId = layer.id;
    await send({ type: 'ADD_LAYER', layer });
    renderAll();
    await saveSettings();
  };
  reader.readAsDataURL(file);
}

async function removeActiveLayer() {
  const layer = activeLayer();
  if (!layer) return;
  const idx = appState.layers.findIndex(l => l.id === layer.id);
  appState.layers.splice(idx, 1);
  await send({ type: 'REMOVE_LAYER', layerId: layer.id });
  appState.activeLayerId = appState.layers[Math.max(0, idx - 1)]?.id ?? null;
  renderAll();
  await saveSettings();
}

/* Reset position and scale */
async function resetPosition() {
  xInput.value = 0; yInput.value = 0; scaleInput.value = formatScale(1);
  await updateActiveLayer({ x: 0, y: 0, scale: 1 });
  renderControls();
}

/* Center overlay on viewport */
async function centerOnViewport() {
  const layer = activeLayer();
  if (!layer) return;
  const info = await send({ type: 'GET_LAYER_INFO', layerId: layer.id });
  if (!info) return;
  const x = Math.round((info.viewportWidth  - info.imageNaturalWidth  * layer.scale) / 2);
  const y = Math.round((info.viewportHeight - info.imageNaturalHeight * layer.scale) / 2);
  await updateActiveLayer({ x, y });
  renderControls();
}

/* Scale overlay to match viewport width */
async function fitToViewportWidth() {
  const layer = activeLayer();
  if (!layer) return;
  const info = await send({ type: 'GET_LAYER_INFO', layerId: layer.id });
  if (!info || !info.imageNaturalWidth) return;
  const scale = normalizeScale(info.viewportWidth / info.imageNaturalWidth, layer.scale);
  await updateActiveLayer({ scale, x: 0 });
  renderControls();
}

async function toggleGrid() {
  appState.grid.enabled = !appState.grid.enabled;
  await send({ type: 'SET_GRID', grid: appState.grid });
  renderGrid();
  await saveSettings();
}

async function updateGridSize(size) {
  appState.grid.size = size;
  await send({ type: 'SET_GRID', grid: appState.grid });
  await saveSettings();
}

/* ── Event wiring ───────────────────────────── */
enableToggle.addEventListener('change', () => setEnabled(enableToggle.checked));

layerNameInput.addEventListener('input', () => {
  const layer = activeLayer();
  if (!layer) return;
  layer.name = layerNameInput.value;
  clearTimeout(layerNameInput._t);
  layerNameInput._t = setTimeout(() => updateActiveLayer({ name: layer.name }), 400);
});

opacitySlider.addEventListener('input', () => {
  const v = parseInt(opacitySlider.value, 10);
  opacityInput.value = v;
  updateActiveLayer({ opacity: v / 100 });
});

opacityInput.addEventListener('input', () => {
  const v = Math.min(100, Math.max(0, parseInt(opacityInput.value, 10) || 0));
  opacitySlider.value = v;
  clearTimeout(opacityInput._t);
  opacityInput._t = setTimeout(() => updateActiveLayer({ opacity: v / 100 }), 180);
});

xInput.addEventListener('input', () => {
  clearTimeout(xInput._t);
  xInput._t = setTimeout(() => updateActiveLayer({ x: parseInt(xInput.value, 10) || 0 }), 180);
});

yInput.addEventListener('input', () => {
  clearTimeout(yInput._t);
  yInput._t = setTimeout(() => updateActiveLayer({ y: parseInt(yInput.value, 10) || 0 }), 180);
});

scaleInput.addEventListener('input', () => {
  clearTimeout(scaleInput._t);
  scaleInput._t = setTimeout(() => {
    const v = normalizeScale(scaleInput.value, activeLayer()?.scale ?? 1);
    updateActiveLayer({ scale: v });
  }, 180);
});

scaleInput.addEventListener('keydown', e => {
  if (!arrowKeys.includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  scaleInput.blur();
});

scaleInput.addEventListener('blur', () => {
  const layer = activeLayer();
  if (!layer) return;
  scaleInput.value = formatScale(layer.scale);
});

document.querySelectorAll('.step-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    const field = btn.dataset.field;
    const dir   = parseInt(btn.dataset.dir, 10);
    const layer = activeLayer();
    if (!layer) return;

    if (field === 'x') {
      layer.x += dir;
      xInput.value = layer.x;
      updateActiveLayer({ x: layer.x });
    } else if (field === 'y') {
      layer.y += dir;
      yInput.value = layer.y;
      updateActiveLayer({ y: layer.y });
    } else if (field === 'scale') {
      layer.scale = normalizeScale(layer.scale + dir * scaleStepFromEvent(e), layer.scale);
      scaleInput.value = formatScale(layer.scale);
      updateActiveLayer({ scale: layer.scale });
    }
    renderLayerList();
  });
});

blendSelect.addEventListener('change', () => {
  blendRow?.classList.toggle('is-active', blendSelect.value !== 'normal');
  updateActiveLayer({ blendMode: blendSelect.value });
  blendSelect.blur();
});

blendSelect.addEventListener('keydown', e => {
  if (!arrowKeys.includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  blendSelect.blur();
});

[opacitySlider, opacityInput, xInput, yInput].forEach(blurOnArrow);

invertBtn.addEventListener('click', () => {
  const layer = activeLayer();
  if (!layer) return;
  layer.invert = !layer.invert;
  invertBtn.classList.toggle('active', layer.invert);
  invertBtn.setAttribute('aria-pressed', String(!!layer.invert));
  updateActiveLayer({ invert: layer.invert });
});

lockBtn.addEventListener('click', () => {
  const layer = activeLayer();
  if (!layer) return;
  layer.locked = !layer.locked;
  lockBtn.classList.toggle('active', layer.locked);
  lockBtn.setAttribute('aria-pressed', String(!!layer.locked));
  updateActiveLayer({ locked: layer.locked });
});

removeLayerBtn.addEventListener('click', removeActiveLayer);
resetBtn.addEventListener('click',    resetPosition);
centerBtn.addEventListener('click',   centerOnViewport);
fitWidthBtn.addEventListener('click', fitToViewportWidth);

gridBtn.addEventListener('click', toggleGrid);
gridSizeInput.addEventListener('input', () => {
  const size = Math.min(128, Math.max(2, parseInt(gridSizeInput.value, 10) || 8));
  clearTimeout(gridSizeInput._t);
  gridSizeInput._t = setTimeout(() => updateGridSize(size), 220);
});

clearSavedBtn.addEventListener('click', clearSettings);

/* Theme button */
themeBtn.addEventListener('click', toggleTheme);
langSelect?.addEventListener('change', () => setLanguage(langSelect.value));

/* File input (multiple) */
addLayerBtn?.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  [...fileInput.files].filter(f => f.type.startsWith('image/')).forEach(addImageLayer);
  fileInput.value = '';
});

/* Drag & drop onto popup window (multiple files) */
document.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('active'); });
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget || !document.contains(e.relatedTarget)) dropZone.classList.remove('active');
});
document.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('active');
  [...e.dataTransfer.files].filter(f => f.type.startsWith('image/')).forEach(addImageLayer);
});

/* Listen for messages forwarded from content script via background */
function listenRuntime() {
  chrome.runtime.onMessage.addListener(msg => {
    /* Position updated by dragging overlay or arrow keys */
    if (msg.type === 'LAYER_MOVED') {
      const layer = appState.layers.find(l => l.id === msg.layerId);
      if (!layer) return;
      layer.x = msg.x;
      layer.y = msg.y;
      if (layer.id === appState.activeLayerId) {
        xInput.value = layer.x;
        yInput.value = layer.y;
      }
      renderLayerList();
      clearTimeout(listenRuntime._t);
      listenRuntime._t = setTimeout(saveSettings, 500);
    }

    /* Theme toggled from floating panel */
    if (msg.type === 'THEME_CHANGED') {
      applyTheme(msg.theme);
    }
  });

  /* React to storage changes made by other tabs / floating panel */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    /* Overlay state changed on another tab — refresh UI */
    if (changes[contentStateKey()]) {
      const s = changes[contentStateKey()].newValue;
      if (!s) return;
      appState.enabled        = s.enabled ?? appState.enabled;
      appState.activeLayerId  = s.activeLayerId ?? appState.activeLayerId;
      appState.grid           = s.grid ?? appState.grid;
      /* Merge metadata; keep local imageData (not in storage-state) */
      (s.layers ?? []).forEach(incoming => {
        const existing = appState.layers.find(l => l.id === incoming.id);
        if (existing) Object.assign(existing, incoming);
        else appState.layers.push(incoming);
      });
      /* Remove deleted layers */
      const ids = new Set((s.layers ?? []).map(l => l.id));
      appState.layers = appState.layers.filter(l => ids.has(l.id));
      if (!connected) return;
      renderAll();
    }

    /* Theme changed from another tab or panel */
    if (changes['dp_theme']) {
      applyTheme(changes['dp_theme'].newValue);
    }

    if (changes['dp_lang']) {
      langMode = normalizeLang(changes['dp_lang'].newValue);
      updateActiveLang();
      if (langSelect) langSelect.value = langMode;
      applyI18n();
      updateThemeButton();
      renderAll();
    }
  });
}

/* ── Start ──────────────────────────────────── */
init();
