/* DiffPixel — Popup Script v1.2 */
'use strict';

/* ── i18n ──────────────────────────────────── */
const t = key => chrome.i18n.getMessage(key) || key;

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

function applyTheme(theme) {
  currentTheme = theme;
  document.body.classList.toggle('dp-light', theme === 'light');
}

async function loadTheme() {
  const res = await chrome.storage.local.get('dp_theme');
  applyTheme(res.dp_theme ?? (
    window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  ));
}

async function toggleTheme() {
  const next = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await chrome.storage.local.set({ dp_theme: next });
}

/* ── State ──────────────────────────────────── */
let tabId = null;
let hostname = '';
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
const invertBtn       = $('invertBtn');
const lockBtn         = $('lockBtn');
const removeLayerBtn  = $('removeLayerBtn');
const resetBtn        = $('resetBtn');
const centerBtn       = $('centerBtn');
const fitWidthBtn     = $('fitWidthBtn');
const gridBtn         = $('gridBtn');
const gridSizeWrap    = $('gridSizeWrap');
const gridSizeInput   = $('gridSizeInput');
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
function storageKey() { return `dp_${hostname}`; }

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
  applyI18n();
  await loadTheme();   // Apply saved theme before rendering

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { setStatus('err', 'statusCantRun'); return; }
  tabId = tab.id;

  try { hostname = new URL(tab.url).hostname; } catch {}

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

  appState.layers.forEach(layer => {
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer.id === appState.activeLayerId ? ' active' : '');
    item.dataset.id = layer.id;

    const thumb = document.createElement('div');
    thumb.className = 'layer-thumb';
    if (layer.imageData) {
      const img = document.createElement('img');
      img.src = layer.imageData;
      thumb.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'layer-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'layer-name';
    nameEl.textContent = layer.name;

    const metaEl = document.createElement('div');
    metaEl.className = 'layer-meta';
    metaEl.textContent = `${Math.round(layer.opacity * 100)}% · ${layer.x}px ${layer.y}px · ×${Number(layer.scale).toFixed(2)}`;

    info.appendChild(nameEl);
    info.appendChild(metaEl);

    const visBtn = document.createElement('button');
    visBtn.className = 'layer-vis-btn' + (!layer.visible ? ' hidden' : '');
    visBtn.title = t(layer.visible ? 'visHide' : 'visShow');
    visBtn.innerHTML = layer.visible
      ? `<svg width="13" height="10" viewBox="0 0 13 10"><ellipse cx="6.5" cy="5" rx="5.5" ry="4" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="6.5" cy="5" r="1.8" fill="currentColor"/></svg>`
      : `<svg width="13" height="11" viewBox="0 0 13 11"><line x1="1" y1="1" x2="12" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 7.5A5.5 4 0 0 0 10 7.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;

    visBtn.addEventListener('click', e => { e.stopPropagation(); toggleLayerVisibility(layer.id); });

    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(visBtn);
    item.addEventListener('click', () => setActiveLayer(layer.id));
    layerList.appendChild(item);
  });
}

function renderControls() {
  const layer = activeLayer();
  if (!layer) { controlsSection.style.display = 'none'; return; }

  controlsSection.style.display = 'block';
  layerNameInput.value = layer.name;
  opacitySlider.value  = Math.round(layer.opacity * 100);
  opacityInput.value   = Math.round(layer.opacity * 100);
  xInput.value         = layer.x;
  yInput.value         = layer.y;
  scaleInput.value     = Number(layer.scale).toFixed(2);
  blendSelect.value    = layer.blendMode;
  invertBtn.classList.toggle('active', !!layer.invert);
  lockBtn.classList.toggle('active',   !!layer.locked);
}

function renderGrid() {
  gridBtn.classList.toggle('active', appState.grid.enabled);
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

/* Reset position to 0,0 */
async function resetPosition() {
  xInput.value = 0; yInput.value = 0;
  await updateActiveLayer({ x: 0, y: 0 });
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
  const scale = Math.round((info.viewportWidth / info.imageNaturalWidth) * 100) / 100;
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
    const v = Math.max(0.05, parseFloat(scaleInput.value) || 1);
    updateActiveLayer({ scale: v });
  }, 180);
});

document.querySelectorAll('.step-btn').forEach(btn => {
  btn.addEventListener('click', () => {
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
      layer.scale = Math.max(0.05, Math.round((layer.scale + dir * 0.05) * 100) / 100);
      scaleInput.value = layer.scale.toFixed(2);
      updateActiveLayer({ scale: layer.scale });
    }
    renderLayerList();
  });
});

blendSelect.addEventListener('change', () => updateActiveLayer({ blendMode: blendSelect.value }));

invertBtn.addEventListener('click', () => {
  const layer = activeLayer();
  if (!layer) return;
  layer.invert = !layer.invert;
  invertBtn.classList.toggle('active', layer.invert);
  updateActiveLayer({ invert: layer.invert });
});

lockBtn.addEventListener('click', () => {
  const layer = activeLayer();
  if (!layer) return;
  layer.locked = !layer.locked;
  lockBtn.classList.toggle('active', layer.locked);
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

/* File input (multiple) */
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
    if (changes['dp_state']) {
      const s = changes['dp_state'].newValue;
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
  });
}

/* ── Start ──────────────────────────────────── */
init();
