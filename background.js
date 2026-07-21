// Background script for handling downloads, font fetching, and the side-panel dock.

// Clicking the toolbar icon opens the side-panel cockpit.
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.warn('[Pluck] setPanelBehavior failed:', e));
}

// Best-effort open of the side panel for a given tab/window.
function openDock(sender) {
  if (!chrome.sidePanel || !chrome.sidePanel.open) return;
  const opts = {};
  if (sender && sender.tab && sender.tab.windowId != null) opts.windowId = sender.tab.windowId;
  else if (sender && sender.tab && sender.tab.id != null) opts.tabId = sender.tab.id;
  try {
    const p = chrome.sidePanel.open(opts);
    if (p && p.catch) p.catch(() => {});
  } catch (e) {
    // open() requires a user gesture; if it fails the data is already staged
    // and the dock will show it the next time the user opens it.
  }
}

// Keyboard commands open the side panel (a command IS a valid user gesture for
// sidePanel.open — but it must be called SYNCHRONOUSLY, before any await/message,
// or the gesture is lost). onCommand hands us the active tab, so no async lookup.
chrome.commands.onCommand.addListener((command, tab) => {
  if (tab && tab.windowId != null) {
    try { const p = chrome.sidePanel.open({ windowId: tab.windowId }); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  if (!tab || tab.id == null) return;
  if (command === 'toggle-select') {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PICK_MODE' }, () => void chrome.runtime.lastError);
  } else if (command === 'export-selection') {
    exportFromTab(tab.id);
  }
});

// Try every frame and use the one that actually has a selection. Sending to the
// whole tab and taking the first reply lets an empty iframe answer null first and
// swallow the export — which is why ⌘⇧E was flaky on iframe-heavy sites.
async function exportFromTab(tabId) {
  let frameIds = [0];
  try { const fr = await chrome.webNavigation.getAllFrames({ tabId }); if (fr && fr.length) frameIds = fr.map((f) => f.frameId); } catch (e) {}
  for (const frameId of frameIds) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'EXPORT_SELECTION' }, { frameId });
      if (resp && resp.toon) {
        resp.exportedAt = Date.now();
        resp.name = resp.name || 'component';
        chrome.storage.local.set({ pluckExportData: resp });
        return;
      }
    } catch (e) { /* frame without content script — skip */ }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle font fetching (bypasses CORS restrictions)
  if (message.type === 'FETCH_FONT') {
    const { url } = message;

    // Abort a slow/hung request so we always send a response (content-side also
    // times out, but this frees the socket instead of leaving it dangling).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    fetch(url, { signal: controller.signal })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.blob();
      })
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ ok: true, dataUrl: reader.result });
        };
        reader.onerror = () => {
          sendResponse({ ok: false, error: 'Failed to read blob' });
        };
        reader.readAsDataURL(blob);
      })
      .catch(error => {
        sendResponse({ ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message });
      })
      .finally(() => clearTimeout(timer));

    return true; // Keep message channel open for async response
  }

  if (message.type === 'DOWNLOAD_FILES') {
    const { toon, html, filename = 'component' } = message;

    // Download TOON file using application/octet-stream to preserve extension
    const toonBlob = new Blob([toon], { type: 'application/octet-stream' });
    const toonReader = new FileReader();
    toonReader.onload = () => {
      chrome.downloads.download({
        url: toonReader.result,
        filename: `${filename}.toon`,
        saveAs: false,
        conflictAction: 'uniquify'
      }, () => {
        // Download HTML file after TOON
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const htmlReader = new FileReader();
        htmlReader.onload = () => {
          chrome.downloads.download({
            url: htmlReader.result,
            filename: `${filename}.html`,
            saveAs: false,
            conflictAction: 'uniquify'
          });
        };
        htmlReader.readAsDataURL(htmlBlob);
      });
    };
    toonReader.readAsDataURL(toonBlob);

    sendResponse({ ok: true });
    return true;
  }

  // Handle clipboard copy (fallback for content scripts)
  if (message.type === 'COPY_TO_CLIPBOARD') {
    const { text } = message;
    // Use offscreen document or clipboard API
    navigator.clipboard.writeText(text)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Export was triggered from the page (keyboard shortcut). The content script
  // has already stored pluckExportData; we capture a screenshot, stamp it in,
  // bump a counter so the dock's storage listener always fires, then open the dock.
  if (message.type === 'OPEN_PREVIEW_TAB') {
    const stageAndOpen = (dataUrl) => {
      chrome.storage.local.get('pluckExportData', (result) => {
        const data = result.pluckExportData;
        if (data) {
          if (dataUrl) data.screenshotDataUrl = dataUrl;
          // Unique, monotonic stamp so the dock always treats this as a new export.
          // (A counter broke here: the fresh result never carries the prior value,
          // so it was always 1 and repeat exports got skipped as "unchanged".)
          data.exportedAt = Date.now();
          chrome.storage.local.set({ pluckExportData: data }, () => {
            openDock(sender);
            sendResponse({ ok: true });
          });
        } else {
          openDock(sender);
          sendResponse({ ok: true });
        }
      });
    };
    try {
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
        stageAndOpen(chrome.runtime.lastError ? null : dataUrl);
      });
    } catch (e) {
      stageAndOpen(null);
    }
    return true; // Keep channel open for async
  }

  // The dock asks the worker to open/focus the side panel (it can't always
  // satisfy the user-gesture requirement from a panel-internal handler).
  if (message.type === 'OPEN_DOCK') {
    openDock(sender);
    sendResponse({ ok: true });
    return true;
  }

  // Handle screen capture for color picker
  if (message.type === 'CAPTURE_TAB') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true; // Keep channel open for async
  }
});
