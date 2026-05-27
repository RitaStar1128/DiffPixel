/* Toggle the in-page floating panel from the extension toolbar icon. */
chrome.runtime.onMessage.addListener((msg, _sender) => {
  if (msg.type === 'LAYER_MOVED' || msg.type === 'THEME_CHANGED') {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
});

/* Extension button click: toggle the page panel, injecting assets if needed. */
chrome.action.onClicked.addListener(async tab => {
  if (!tab?.id) return;

  /* Content script already present: just toggle. */
  const toggled = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => null);
  if (toggled) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/content.css'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_PANEL' }).catch(() => {});
  } catch {
    /* chrome://, edge://, and other restricted pages cannot be scripted. */
  }
});
