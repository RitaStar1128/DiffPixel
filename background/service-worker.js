/* DiffPixel — Service Worker v1.3 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[DiffPixel] installed v1.3');
});

/* Forward LAYER_MOVED / THEME_CHANGED from content scripts to any open popup */
chrome.runtime.onMessage.addListener((msg, _sender) => {
  if (msg.type === 'LAYER_MOVED' || msg.type === 'THEME_CHANGED') {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
});

/* Extension button click — toggle panel, injecting content script if needed */
chrome.action.onClicked.addListener(async tab => {
  if (!tab?.id) return;

  /* Content script already present — just toggle */
  const toggled = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => null);
  if (toggled) return;

  /* Not injected yet (e.g. page loaded before extension was installed) */
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/content.css'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_PANEL' }).catch(() => {});
  } catch {
    /* chrome://, edge://, restricted pages — silently ignore */
  }
});
