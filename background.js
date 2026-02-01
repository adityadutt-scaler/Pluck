// Background script for handling downloads and font fetching
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle font fetching (bypasses CORS restrictions)
  if (message.type === 'FETCH_FONT') {
    const { url } = message;

    fetch(url)
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
        sendResponse({ ok: false, error: error.message });
      });

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

  // Handle opening preview tab (from content script keyboard shortcut)
  // Captures tab screenshot, merges into stored data, then opens preview
  if (message.type === 'OPEN_PREVIEW_TAB') {
    const openPreview = () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('preview.html') });
    };

    // Try to capture screenshot before opening
    try {
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          openPreview();
          sendResponse({ ok: true });
          return;
        }
        chrome.storage.local.get('pluckExportData', (result) => {
          if (result.pluckExportData) {
            result.pluckExportData.screenshotDataUrl = dataUrl;
            chrome.storage.local.set({ pluckExportData: result.pluckExportData }, () => {
              openPreview();
              sendResponse({ ok: true });
            });
          } else {
            openPreview();
            sendResponse({ ok: true });
          }
        });
      });
    } catch (e) {
      openPreview();
      sendResponse({ ok: true });
    }
    return true; // Keep channel open for async
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
