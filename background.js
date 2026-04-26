// background.js — Service Worker (ES module)
// Opens the side panel when the extension icon is clicked
// Relays messages between the side panel and content scripts
// Handles daily licence revalidation

import { validateLicence, getLicenceState, activateLicence, deactivateLicence, initTrial } from './licence.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ── Daily licence revalidation ────────────────────────────────────────────
chrome.alarms.create('licenceCheck', { periodInMinutes: 1440 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'licenceCheck') {
    try { await validateLicence(); } catch (_) { /* silent */ }
  }
});

// ── Message relay ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Licence operations from side panel
  if (message.action === 'licenceAction') {
    const { type, key } = message.payload || {};
    (async () => {
      let result;
      switch (type) {
        case 'activate':    result = await activateLicence(key); break;
        case 'validate':    result = await validateLicence(); break;
        case 'deactivate':  result = await deactivateLicence(); break;
        case 'getState':    result = await getLicenceState(); break;
        case 'initTrial':   result = await initTrial(); break;
        default:            result = { ok: false, error: 'Unknown licence action' };
      }
      sendResponse(result);
    })();
    return true; // async
  }

  if (message.action === 'toContent') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      const tabId = tabs[0].id;
      chrome.tabs.sendMessage(tabId, message.payload, (response) => {
        if (chrome.runtime.lastError) {
          // Content script not injected yet (tab was open before extension loaded).
          // Inject it now, then retry.
          chrome.scripting.executeScript(
            { target: { tabId }, files: ['content.js'] },
            () => {
              if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
                return;
              }
              chrome.tabs.sendMessage(tabId, message.payload, (response2) => {
                if (chrome.runtime.lastError) {
                  sendResponse({ error: chrome.runtime.lastError.message });
                } else {
                  sendResponse(response2);
                }
              });
            }
          );
        } else {
          sendResponse(response);
        }
      });
    });
    return true; // keep message channel open for async response
  }

  // Relay messages from content script back to side panel
  if (message.action === 'fromContent') {
    // Broadcast to all extension views (the side panel)
    chrome.runtime.sendMessage({ action: 'contentMessage', payload: message.payload });
  }
});
