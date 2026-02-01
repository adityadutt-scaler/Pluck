// ===== DOM Elements =====
const startBtn = document.getElementById("start");
const clearBtn = document.getElementById("clear");
const exportBtn = document.getElementById("export");
const xrayBtn = document.getElementById("xray");
const colorPickBtn = document.getElementById("color-pick");
const statusDiv = document.getElementById("status");
const statusDot = document.getElementById("status-dot");
const hintDiv = document.getElementById("hint");
const toggleSettings = document.getElementById("toggle-settings");
const settingsPanel = document.getElementById("settings-panel");
const saveShortcutsBtn = document.getElementById("save-shortcuts");
const resetShortcutsBtn = document.getElementById("reset-shortcuts");
const currentShortcutsDiv = document.getElementById("current-shortcuts");
const selectionCountDiv = document.getElementById("selection-count");

// Export modal elements
const exportModal = document.getElementById("export-modal");
const filenameInput = document.getElementById("filename-input");
const filenamePreview = document.getElementById("filename-preview");
const modalCancel = document.getElementById("modal-cancel");
const modalExport = document.getElementById("modal-export");

// ===== Selection State =====
let isSelecting = false;
let xrayMode = false;
let colorPickActive = false;
let currentSelectionCount = 0;
let isUpdatingState = false; // Prevent polling from overriding during button actions

// ===== Platform Detection =====
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
              navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

// Update modifier button labels for Mac
if (isMac) {
  document.querySelectorAll('.mod-btn').forEach(btn => {
    const mod = btn.dataset.mod;
    if (mod === 'ctrl') btn.textContent = '⌘';
    if (mod === 'alt') btn.textContent = '⌥';
    if (mod === 'shift') btn.textContent = '⇧';
  });
}

// ===== Default Shortcuts =====
const DEFAULT_SHORTCUTS = {
  startSelect: { ctrl: true, shift: true, alt: false, key: 'S' },
  clearSelect: { ctrl: false, shift: false, alt: false, key: 'Escape' },
  export: { ctrl: true, shift: true, alt: false, key: 'E' },
  xray: { ctrl: true, shift: true, alt: false, key: 'X' },
  colorPick: { ctrl: true, shift: true, alt: false, key: 'P' }
};

// ===== Shortcut Formatting =====
function formatShortcutHTML(shortcut) {
  const keys = [];
  if (shortcut.ctrl) keys.push(isMac ? '⌘' : 'Ctrl');
  if (shortcut.shift) keys.push(isMac ? '⇧' : 'Shift');
  if (shortcut.alt) keys.push(isMac ? '⌥' : 'Alt');
  keys.push(shortcut.key === 'Escape' ? 'Esc' : shortcut.key.toUpperCase());

  return keys.map(k => `<span class="kbd">${k}</span>`).join('');
}

function displayCurrentShortcuts(shortcuts) {
  currentShortcutsDiv.innerHTML = `
    <div class="shortcut-item">${formatShortcutHTML(shortcuts.startSelect)} <span>Select</span></div>
    <div class="shortcut-item">${formatShortcutHTML(shortcuts.clearSelect)} <span>Clear</span></div>
    <div class="shortcut-item">${formatShortcutHTML(shortcuts.export)} <span>Export</span></div>
    <div class="shortcut-item">${formatShortcutHTML(shortcuts.xray)} <span>X-Ray</span></div>
    <div class="shortcut-item">${formatShortcutHTML(shortcuts.colorPick || DEFAULT_SHORTCUTS.colorPick)} <span>Color Pick</span></div>
  `;
}

// ===== Settings Panel: Toggle Buttons =====
function setupModifierButtons() {
  document.querySelectorAll('.mod-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      // Update separator visibility for this row
      const prefix = btn.id.split('-')[0]; // e.g., 'start', 'clear', 'export'
      updateSeparatorVisibility(prefix);
      // Update the shortcuts display live
      updateShortcutsDisplay();
    });
  });
}

// ===== Update Shortcuts Display Live =====
function updateShortcutsDisplay() {
  const shortcuts = getShortcutsFromUI();
  displayCurrentShortcuts(shortcuts);
}

// ===== Update Separator Visibility =====
function updateSeparatorVisibility(prefix) {
  const ctrl = document.getElementById(`${prefix}-ctrl`).classList.contains('active');
  const shift = document.getElementById(`${prefix}-shift`).classList.contains('active');
  const alt = document.getElementById(`${prefix}-alt`).classList.contains('active');
  const controls = document.getElementById(`${prefix}-ctrl`).closest('.shortcut-controls');
  const separator = controls.querySelector('.key-separator');
  const keyInput = document.getElementById(`${prefix}-key`);

  const hasModifiers = ctrl || shift || alt;

  if (separator) {
    separator.style.visibility = hasModifiers ? 'visible' : 'hidden';
  }

  // Add standalone class when no modifiers (makes key input stand out)
  if (keyInput) {
    keyInput.classList.toggle('standalone', !hasModifiers);
  }
}

// ===== Load Shortcuts into UI =====
function loadShortcutsToUI(shortcuts) {
  // Start Select
  document.getElementById('start-ctrl').classList.toggle('active', shortcuts.startSelect.ctrl);
  document.getElementById('start-shift').classList.toggle('active', shortcuts.startSelect.shift);
  document.getElementById('start-alt').classList.toggle('active', shortcuts.startSelect.alt);
  document.getElementById('start-key').value = shortcuts.startSelect.key;
  updateSeparatorVisibility('start');

  // Clear Select
  document.getElementById('clear-ctrl').classList.toggle('active', shortcuts.clearSelect.ctrl);
  document.getElementById('clear-shift').classList.toggle('active', shortcuts.clearSelect.shift);
  document.getElementById('clear-alt').classList.toggle('active', shortcuts.clearSelect.alt);
  document.getElementById('clear-key').value = shortcuts.clearSelect.key;
  updateSeparatorVisibility('clear');

  // Export
  document.getElementById('export-ctrl').classList.toggle('active', shortcuts.export.ctrl);
  document.getElementById('export-shift').classList.toggle('active', shortcuts.export.shift);
  document.getElementById('export-alt').classList.toggle('active', shortcuts.export.alt);
  document.getElementById('export-key').value = shortcuts.export.key;
  updateSeparatorVisibility('export');

  // X-Ray
  document.getElementById('xray-ctrl').classList.toggle('active', shortcuts.xray.ctrl);
  document.getElementById('xray-shift').classList.toggle('active', shortcuts.xray.shift);
  document.getElementById('xray-alt').classList.toggle('active', shortcuts.xray.alt);
  document.getElementById('xray-key').value = shortcuts.xray.key;
  updateSeparatorVisibility('xray');

  // Color Pick
  document.getElementById('colorpick-ctrl').classList.toggle('active', shortcuts.colorPick?.ctrl ?? true);
  document.getElementById('colorpick-shift').classList.toggle('active', shortcuts.colorPick?.shift ?? true);
  document.getElementById('colorpick-alt').classList.toggle('active', shortcuts.colorPick?.alt ?? false);
  document.getElementById('colorpick-key').value = shortcuts.colorPick?.key ?? 'P';
  updateSeparatorVisibility('colorpick');

  displayCurrentShortcuts(shortcuts);
}

// ===== Get Shortcuts from UI =====
function getShortcutsFromUI() {
  return {
    startSelect: {
      ctrl: document.getElementById('start-ctrl').classList.contains('active'),
      shift: document.getElementById('start-shift').classList.contains('active'),
      alt: document.getElementById('start-alt').classList.contains('active'),
      key: document.getElementById('start-key').value || 'S'
    },
    clearSelect: {
      ctrl: document.getElementById('clear-ctrl').classList.contains('active'),
      shift: document.getElementById('clear-shift').classList.contains('active'),
      alt: document.getElementById('clear-alt').classList.contains('active'),
      key: document.getElementById('clear-key').value || 'Escape'
    },
    export: {
      ctrl: document.getElementById('export-ctrl').classList.contains('active'),
      shift: document.getElementById('export-shift').classList.contains('active'),
      alt: document.getElementById('export-alt').classList.contains('active'),
      key: document.getElementById('export-key').value || 'E'
    },
    xray: {
      ctrl: document.getElementById('xray-ctrl').classList.contains('active'),
      shift: document.getElementById('xray-shift').classList.contains('active'),
      alt: document.getElementById('xray-alt').classList.contains('active'),
      key: document.getElementById('xray-key').value || 'X'
    },
    colorPick: {
      ctrl: document.getElementById('colorpick-ctrl').classList.contains('active'),
      shift: document.getElementById('colorpick-shift').classList.contains('active'),
      alt: document.getElementById('colorpick-alt').classList.contains('active'),
      key: document.getElementById('colorpick-key').value || 'P'
    }
  };
}

// ===== Status Updates =====
function setStatus(message, state = 'idle') {
  statusDiv.textContent = message;
  statusDot.classList.remove('active', 'success');
  if (state === 'active') statusDot.classList.add('active');
  if (state === 'success') statusDot.classList.add('success');
}

// ===== Selection Count Updates =====
function updateSelectionCount(count) {
  currentSelectionCount = count;
  if (count > 0) {
    selectionCountDiv.textContent = `${count} element${count > 1 ? 's' : ''} selected`;
    selectionCountDiv.classList.add('visible');
  } else {
    selectionCountDiv.classList.remove('visible');
  }
}

// ===== Live Preview =====
const previewPanel = document.getElementById('preview-panel');
const previewTag = document.getElementById('preview-tag');
const previewDims = document.getElementById('preview-dims');
const previewCode = document.getElementById('preview-code');
const previewRender = document.getElementById('preview-render');

let lastPreviewSnippet = '';
let lastPreviewRectKey = '';

function updateLivePreview(response) {
  if (!response || !response.previewSnippet) {
    previewPanel.classList.remove('visible');
    lastPreviewSnippet = '';
    lastPreviewRectKey = '';
    previewRender.innerHTML = '';
    return;
  }

  // Show panel
  previewPanel.classList.add('visible');

  // Update header
  let tagLabel = `<${response.previewTag || 'element'}>`;
  if (response.previewClasses) {
    tagLabel += `.${response.previewClasses.split(/\s+/).slice(0, 2).join('.')}`;
  }
  previewTag.textContent = tagLabel;
  previewDims.textContent = response.previewDimensions || '';

  // Update visual render (screenshot cropped to element)
  if (response.previewRect) {
    const r = response.previewRect;
    const rectKey = `${r.x},${r.y},${r.width},${r.height}`;
    if (rectKey !== lastPreviewRectKey) {
      lastPreviewRectKey = rectKey;
      captureElementPreview(r);
    }
  } else {
    previewRender.innerHTML = '';
    lastPreviewRectKey = '';
  }

  // Update code preview (only if changed)
  if (response.previewSnippet !== lastPreviewSnippet) {
    lastPreviewSnippet = response.previewSnippet;
    previewCode.innerHTML = highlightHtml(response.previewSnippet);
  }
}

function captureElementPreview(rect) {
  chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' }, (result) => {
    if (!result || !result.ok || !result.dataUrl) {
      previewRender.innerHTML = '';
      return;
    }

    const img = new Image();
    img.onload = () => {
      // Crop the screenshot to the element's bounding rect
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Clamp to image bounds
      const sx = Math.max(0, rect.x);
      const sy = Math.max(0, rect.y);
      const sw = Math.min(rect.width, img.width - sx);
      const sh = Math.min(rect.height, img.height - sy);

      if (sw <= 0 || sh <= 0) {
        previewRender.innerHTML = '';
        return;
      }

      canvas.width = sw;
      canvas.height = sh;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const croppedImg = document.createElement('img');
      croppedImg.src = canvas.toDataURL('image/png');
      croppedImg.alt = 'Element preview';
      previewRender.innerHTML = '';
      previewRender.appendChild(croppedImg);
    };
    img.src = result.dataUrl;
  });
}

function highlightHtml(html) {
  // Escape HTML entities first
  let escaped = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Highlight tags
  escaped = escaped.replace(/&lt;(\/?)([\w-]+)/g, '&lt;$1<span class="hl-tag">$2</span>');

  // Highlight attributes
  escaped = escaped.replace(/([\w-]+)=&quot;/g, '<span class="hl-attr">$1</span>=&quot;');
  escaped = escaped.replace(/([\w-]+)="/g, '<span class="hl-attr">$1</span>="');

  // Highlight attribute values
  escaped = escaped.replace(/="([^"]*?)"/g, '="<span class="hl-val">$1</span>"');
  escaped = escaped.replace(/=&quot;([^&]*?)&quot;/g, '=&quot;<span class="hl-val">$1</span>&quot;');

  return escaped;
}

// ===== Initialize =====
setupModifierButtons();

// Load saved shortcuts on popup open
chrome.storage.sync.get(['shortcuts'], (result) => {
  const shortcuts = result.shortcuts || DEFAULT_SHORTCUTS;
  loadShortcutsToUI(shortcuts);
});

// ===== Settings Panel Toggle =====
toggleSettings.addEventListener('click', () => {
  settingsPanel.classList.toggle('visible');
  toggleSettings.classList.toggle('open');
});

// ===== Save Shortcuts =====
saveShortcutsBtn.addEventListener('click', () => {
  const shortcuts = getShortcutsFromUI();
  chrome.storage.sync.set({ shortcuts }, () => {
    setStatus('Shortcuts saved!', 'success');
    displayCurrentShortcuts(shortcuts);

    // Add success animation
    saveShortcutsBtn.classList.add('success-animation');
    setTimeout(() => {
      saveShortcutsBtn.classList.remove('success-animation');
    }, 300);

    setTimeout(() => {
      setStatus('Selection mode active', 'active');
    }, 1500);
  });
});

// ===== Reset Shortcuts =====
resetShortcutsBtn.addEventListener('click', () => {
  loadShortcutsToUI(DEFAULT_SHORTCUTS);
  chrome.storage.sync.set({ shortcuts: DEFAULT_SHORTCUTS }, () => {
    setStatus('Shortcuts reset to defaults', 'success');
    setTimeout(() => {
      setStatus('Selection mode active', 'active');
    }, 1500);
  });
});

// ===== Key Input Handlers =====
['start-key', 'clear-key', 'export-key', 'xray-key', 'colorpick-key'].forEach(id => {
  const input = document.getElementById(id);

  // Remove readonly on focus to allow key capture
  input.addEventListener('focus', () => {
    input.removeAttribute('readonly');
    input.value = '';
    input.placeholder = 'Press key...';
  });

  input.addEventListener('keydown', (e) => {
    e.preventDefault();
    let keyName = e.key;
    if (keyName === ' ') keyName = 'Space';
    // Uppercase single letter keys, keep special keys as-is
    if (keyName.length === 1) {
      keyName = keyName.toUpperCase();
    }
    input.value = keyName;
    input.setAttribute('readonly', true);
    input.blur();
    // Update the shortcuts display live
    updateShortcutsDisplay();
  });

  input.addEventListener('blur', () => {
    input.setAttribute('readonly', true);
    if (!input.value) {
      input.placeholder = 'Key';
    }
  });
});

// ===== Tab Communication Helpers =====
function getActiveTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    cb(tabs[0]);
  });
}

function isTabCompatible(tab) {
  if (!tab.url) return false;
  if (tab.url.startsWith("chrome://")) return false;
  if (tab.url.startsWith("chrome-extension://")) return false;
  if (tab.url.startsWith("about:")) return false;
  if (tab.url.startsWith("data:")) return false;
  return true;
}

async function sendMessageToTab(tab, message, callback) {
  if (!isTabCompatible(tab)) {
    setStatus("Can't run on this page type", 'idle');
    callback(null);
    return;
  }

  // For export, check all frames
  if (message.type === "EXPORT_SELECTION") {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });

      for (const frame of frames) {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, message, { frameId: frame.frameId });
          if (response && response.toon) {
            callback(response);
            return;
          }
        } catch (e) {
          // Frame might not have content script, continue
        }
      }
      callback(null);
    } catch (e) {
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          callback(null);
          return;
        }
        callback(response);
      });
    }
    return;
  }

  // For GET_STATE, we need the actual response from the main frame
  if (message.type === "GET_STATE") {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message);
      callback(response);
    } catch (e) {
      callback(null);
    }
    return;
  }

  // For TOGGLE_XRAY, we need the response from the main frame to get xrayMode state
  if (message.type === "TOGGLE_XRAY") {
    try {
      // Send to main frame first to get the response with xrayMode
      const response = await chrome.tabs.sendMessage(tab.id, message);

      // Also broadcast to iframes
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      for (const frame of frames) {
        if (frame.frameId !== 0) { // Skip main frame, already handled
          try {
            await chrome.tabs.sendMessage(tab.id, message, { frameId: frame.frameId });
          } catch (e) {
            // Ignore frames without content script
          }
        }
      }

      callback(response);
    } catch (e) {
      callback(null);
    }
    return;
  }

  // For other messages (START_PICK_MODE, STOP_PICK_MODE, CLEAR_SELECTION), send to all frames
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    for (const frame of frames) {
      try {
        await chrome.tabs.sendMessage(tab.id, message, { frameId: frame.frameId });
      } catch (e) {
        // Ignore frames without content script
      }
    }
    callback({ ok: true });
  } catch (e) {
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        setStatus(`Error: ${chrome.runtime.lastError.message}`, 'idle');
        callback(null);
        return;
      }
      callback(response);
    });
  }
}

// ===== Update Button UI =====
function updateStartButton() {
  const icon = startBtn.querySelector('.material-symbols-outlined');
  if (isSelecting) {
    icon.textContent = 'stop_circle';
    startBtn.innerHTML = '';
    startBtn.appendChild(icon);
    startBtn.appendChild(document.createTextNode(' Stop Selecting'));
    startBtn.classList.remove('btn-primary');
    startBtn.classList.add('btn-stop');
  } else {
    icon.textContent = 'point_scan';
    startBtn.innerHTML = '';
    startBtn.appendChild(icon);
    startBtn.appendChild(document.createTextNode(' Start Selecting'));
    startBtn.classList.remove('btn-stop');
    startBtn.classList.add('btn-primary');
  }
}

// ===== Button Actions =====
function activateSelectionMode() {
  isUpdatingState = true;
  isSelecting = true;
  updateStartButton();
  setStatus('Selection mode active', 'active');

  getActiveTab((tab) => {
    sendMessageToTab(tab, { type: "START_PICK_MODE" }, (response) => {
      // Reset flag after a short delay to let content script catch up
      setTimeout(() => {
        isUpdatingState = false;
      }, 600);
    });
  });
}

function deactivateSelectionMode() {
  isUpdatingState = true;
  isSelecting = false;
  updateStartButton();
  setStatus('Selection mode stopped', 'idle');

  getActiveTab((tab) => {
    sendMessageToTab(tab, { type: "STOP_PICK_MODE" }, () => {
      // Reset flag after a short delay to let content script catch up
      setTimeout(() => {
        isUpdatingState = false;
      }, 600);
    });
  });
}

function toggleSelectionMode() {
  if (isSelecting) {
    deactivateSelectionMode();
  } else {
    activateSelectionMode();
  }
}

startBtn.addEventListener("click", toggleSelectionMode);

// Query current state when popup opens
function queryCurrentState() {
  getActiveTab((tab) => {
    sendMessageToTab(tab, { type: "GET_STATE" }, (response) => {
      if (response && response.pickMode !== undefined) {
        isSelecting = response.pickMode;
        xrayMode = response.xrayMode || false;
        updateStartButton();
        updateXrayButton();
        updateSelectionCount(response.selectionCount || 0);
        if (isSelecting) {
          setStatus('Selection mode active', 'active');
        } else if (xrayMode) {
          setStatus('X-Ray mode active', 'active');
        } else {
          setStatus('Ready to select elements', 'idle');
        }
      } else {
        // Content script not ready or no response, show default state
        isSelecting = false;
        xrayMode = false;
        updateStartButton();
        updateXrayButton();
        updateSelectionCount(0);
        setStatus('Ready to select elements', 'idle');
      }
    });
  });
}

// Poll for selection count updates while popup is open
function startStatePolling() {
  setInterval(() => {
    // Skip polling if we're in the middle of updating state from button click
    if (isUpdatingState) return;

    getActiveTab((tab) => {
      sendMessageToTab(tab, { type: "GET_STATE" }, (response) => {
        // Double-check flag in case it changed during async call
        if (isUpdatingState) return;

        if (response) {
          updateSelectionCount(response.selectionCount || 0);
          // Sync pick mode state
          if (response.pickMode !== isSelecting) {
            isSelecting = response.pickMode;
            updateStartButton();
            if (isSelecting) {
              setStatus('Selection mode active', 'active');
            } else if (xrayMode) {
              setStatus('X-Ray mode active', 'active');
            } else {
              setStatus('Ready to select elements', 'idle');
            }
          }
          // Sync X-Ray mode state
          if (response.xrayMode !== xrayMode) {
            xrayMode = response.xrayMode || false;
            updateXrayButton();
          }
          // Update live preview
          updateLivePreview(response);
        }
      });
    });
  }, 500);
}

// Query state when popup opens (don't auto-activate)
queryCurrentState();
startStatePolling();

clearBtn.addEventListener("click", () => {
  getActiveTab((tab) => {
    sendMessageToTab(tab, { type: "CLEAR_SELECTION" }, (response) => {
      if (response) {
        setStatus('Selection cleared', 'idle');
        updateSelectionCount(0);
        updateLivePreview(null); // Clear preview
      }
    });
  });
});

// ===== X-Ray Mode =====
function updateXrayButton() {
  if (xrayMode) {
    xrayBtn.classList.add('btn-xray-active');
  } else {
    xrayBtn.classList.remove('btn-xray-active');
  }
}

xrayBtn.addEventListener("click", () => {
  getActiveTab((tab) => {
    sendMessageToTab(tab, { type: "TOGGLE_XRAY" }, (response) => {
      if (response) {
        xrayMode = response.xrayMode;
        updateXrayButton();
        setStatus(xrayMode ? 'X-Ray mode active' : 'X-Ray mode off', xrayMode ? 'active' : 'idle');
      }
    });
  });
});

// ===== Color Picker =====
function updateColorPickButton() {
  if (colorPickActive) {
    colorPickBtn.classList.add('btn-colorpick-active');
  } else {
    colorPickBtn.classList.remove('btn-colorpick-active');
  }
}

colorPickBtn.addEventListener("click", () => {
  // Toggle the color picker
  colorPickActive = !colorPickActive;
  updateColorPickButton();

  if (colorPickActive) {
    setStatus('Color picker active', 'active');
  } else {
    setStatus('Ready', 'idle');
  }

  getActiveTab((tab) => {
    sendMessageToTab(tab, { type: "TOGGLE_COLOR_PICK" }, (response) => {
      // Sync state from content script if available
      if (response && response.colorPickActive !== undefined) {
        colorPickActive = response.colorPickActive;
        updateColorPickButton();
      }
    });
  });
});

// ===== Export Modal Functions =====
let pendingExportData = null;

function showExportModal() {
  // Stop selection mode while export modal is open
  if (isSelecting) {
    deactivateSelectionMode();
  }

  // Reset filename to default
  filenameInput.value = 'component';
  updateFilenamePreview();
  exportModal.classList.add('visible');
  filenameInput.focus();
  filenameInput.select();
}

function hideExportModal() {
  exportModal.classList.remove('visible');
  pendingExportData = null;
}

function updateFilenamePreview() {
  const name = sanitizeFilename(filenameInput.value) || 'component';
  filenamePreview.textContent = `${name}.html, ${name}.jsx, ${name}.css, ${name}.toon`;
}

function sanitizeFilename(name) {
  // Remove invalid characters for filenames
  return name.replace(/[<>:"/\\|?*]/g, '').trim();
}

function performExport(filename) {
  if (!pendingExportData) return;

  const { toon, html, jsx, css } = pendingExportData;
  const safeName = sanitizeFilename(filename) || 'component';

  // Download TOON
  const toonBlob = new Blob([toon], { type: "text/plain" });
  const toonUrl = URL.createObjectURL(toonBlob);
  const toonLink = document.createElement("a");
  toonLink.href = toonUrl;
  toonLink.download = `${safeName}.toon`;
  toonLink.click();
  URL.revokeObjectURL(toonUrl);

  // Download HTML
  setTimeout(() => {
    const htmlBlob = new Blob([html], { type: "text/html" });
    const htmlUrl = URL.createObjectURL(htmlBlob);
    const htmlLink = document.createElement("a");
    htmlLink.href = htmlUrl;
    htmlLink.download = `${safeName}.html`;
    htmlLink.click();
    URL.revokeObjectURL(htmlUrl);
  }, 100);

  // Download JSX
  if (jsx) {
    setTimeout(() => {
      const jsxBlob = new Blob([jsx], { type: "text/javascript" });
      const jsxUrl = URL.createObjectURL(jsxBlob);
      const jsxLink = document.createElement("a");
      jsxLink.href = jsxUrl;
      jsxLink.download = `${safeName}.jsx`;
      jsxLink.click();
      URL.revokeObjectURL(jsxUrl);
    }, 200);
  }

  // Download CSS (companion to JSX)
  if (css) {
    setTimeout(() => {
      const cssBlob = new Blob([css], { type: "text/css" });
      const cssUrl = URL.createObjectURL(cssBlob);
      const cssLink = document.createElement("a");
      cssLink.href = cssUrl;
      cssLink.download = `${safeName}.css`;
      cssLink.click();
      URL.revokeObjectURL(cssUrl);
    }, 300);
  }

  const count = currentSelectionCount || 1;
  setStatus(`Exported ${count} element${count > 1 ? 's' : ''} successfully!`, 'success');

  // Add success animation to export button
  exportBtn.classList.add('success-animation');
  setTimeout(() => {
    exportBtn.classList.remove('success-animation');
  }, 300);

  hideExportModal();
}

// Filename input event listeners
filenameInput.addEventListener('input', updateFilenamePreview);

filenameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    performExport(filenameInput.value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideExportModal();
  }
});

modalCancel.addEventListener('click', hideExportModal);

modalExport.addEventListener('click', () => {
  performExport(filenameInput.value);
});

// Close modal when clicking outside
exportModal.addEventListener('click', (e) => {
  if (e.target === exportModal) {
    hideExportModal();
  }
});

// Export button - extract and open preview page
exportBtn.addEventListener("click", () => {
  getActiveTab((tab) => {
    setStatus('Preparing export...', 'active');

    sendMessageToTab(tab, { type: "EXPORT_SELECTION" }, (response) => {
      if (!response || !response.toon) {
        setStatus('No elements selected', 'idle');
        return;
      }

      // Store export data and open preview page
      chrome.storage.local.set({ pluckExportData: response }, () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('preview.html') });
        setStatus('Opened preview', 'success');
      });
    });
  });
});
