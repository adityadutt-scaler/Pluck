// ===== Pluck Code Preview Page =====

// DOM Elements
const codeOutput = document.getElementById('code-output');
const codePre = document.getElementById('code-pre');
const codeEditor = document.getElementById('code-editor');
const codeWrapper = document.getElementById('code-wrapper');
const filenameInput = document.getElementById('filename');
const headerBadge = document.getElementById('header-badge');
const btnEdit = document.getElementById('btn-edit');
const btnCopy = document.getElementById('btn-copy');
const btnDownloadCurrent = document.getElementById('btn-download-current');
const btnDownloadAll = document.getElementById('btn-download-all');
const toast = document.getElementById('toast');
const toastText = document.getElementById('toast-text');
const tabButtons = document.querySelectorAll('.tab-btn');
const previewPanel = document.getElementById('preview-panel');
const previewIframe = document.getElementById('preview-iframe');
const previewEmpty = document.getElementById('preview-empty');
const btnTogglePreview = document.getElementById('btn-toggle-preview');
const btnShowPreview = document.getElementById('btn-show-preview');
const mainContent = document.getElementById('main-content');

// State
let exportData = null;
let activeTab = 'html';
let toastTimeout = null;
let editMode = false;
let prismLiveInstance = null;

// ===== Initialize =====
async function init() {
  try {
    const result = await chrome.storage.local.get('pluckExportData');
    if (result.pluckExportData) {
      exportData = result.pluckExportData;
      // Clean up storage after reading
      chrome.storage.local.remove('pluckExportData');
      displayCode('html');
      updateBadge();
      loadVisualPreview();
    } else {
      showEmptyState();
    }
  } catch (e) {
    console.error('[Pluck Preview] Failed to load export data:', e);
    showEmptyState();
  }
}

// ===== Display Code =====
function displayCode(tab) {
  if (!exportData) return;

  activeTab = tab;

  // Update tab buttons
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Get content for the active tab
  const content = exportData[tab] || '';
  const lang = getLanguageClass(tab);

  if (editMode) {
    // Update editor textarea
    codeEditor.value = content;
    codeEditor.className = `prism-live language-${lang}`;
    if (prismLiveInstance) {
      prismLiveInstance.update();
    }
  } else {
    // Update read-only view with syntax highlighting
    const langClass = `language-${lang}`;
    codePre.className = langClass;
    codeOutput.className = langClass;
    codeOutput.textContent = content;
    highlightCode();
  }

  // Refresh live preview when switching tabs
  scheduleLivePreviewUpdate();
}

function highlightCode() {
  if (typeof Prism !== 'undefined' && Prism.highlightElement) {
    try {
      Prism.highlightElement(codeOutput);
    } catch (e) {
      console.warn('[Pluck Preview] Prism highlight error:', e);
    }
  }
}

function getLanguageClass(tab) {
  switch (tab) {
    case 'html': return 'html';
    case 'jsx': return 'javascript';
    case 'css': return 'css';
    case 'toon': return 'markup';
    default: return 'markup';
  }
}

function getFileExtension(tab) {
  switch (tab) {
    case 'html': return '.html';
    case 'jsx': return '.jsx';
    case 'css': return '.css';
    case 'toon': return '.toon';
    default: return '.txt';
  }
}

function getMimeType(tab) {
  switch (tab) {
    case 'html': return 'text/html';
    case 'jsx': return 'text/javascript';
    case 'css': return 'text/css';
    case 'toon': return 'text/plain';
    default: return 'text/plain';
  }
}

// ===== Edit Mode =====
// Properly manages Prism-Live lifecycle to avoid wrapper piling

function destroyPrismLive() {
  if (!prismLiveInstance) return;

  // Prism-Live wraps the textarea inside a <div class="prism-live">.
  // We need to move the textarea back out and remove the wrapper.
  const wrapper = prismLiveInstance.wrapper;
  if (wrapper && wrapper.parentNode) {
    // Move textarea out of the wrapper back into code-wrapper
    wrapper.parentNode.insertBefore(codeEditor, wrapper);
    wrapper.remove();
  }

  // Also remove any leftover Prism-Live <pre> overlays that might be siblings
  codeWrapper.querySelectorAll('pre.prism-live').forEach(el => el.remove());
  codeWrapper.querySelectorAll('div.prism-live').forEach(el => {
    // Move children out before removing
    while (el.firstChild) {
      el.parentNode.insertBefore(el.firstChild, el);
    }
    el.remove();
  });

  prismLiveInstance = null;
}

function createPrismLive() {
  if (typeof Prism === 'undefined' || !Prism.Live) return;

  try {
    prismLiveInstance = new Prism.Live(codeEditor);
  } catch (e) {
    console.warn('[Pluck Preview] Prism-Live init error:', e);
    prismLiveInstance = null;
  }
}

function toggleEditMode() {
  editMode = !editMode;

  if (editMode) {
    // --- Enter edit mode ---
    // Hide read-only view
    codePre.style.display = 'none';

    // Set up the textarea
    const lang = getLanguageClass(activeTab);
    codeEditor.value = exportData[activeTab] || '';
    codeEditor.className = `prism-live language-${lang}`;
    codeEditor.style.display = '';

    // Create a fresh Prism-Live instance (clean any old one first)
    destroyPrismLive();
    createPrismLive();

    btnEdit.innerHTML = '<span class="material-symbols-outlined">visibility</span> View';
    showToast('Edit mode enabled');
  } else {
    // --- Exit edit mode ---
    // Save edits
    if (exportData && codeEditor.value) {
      exportData[activeTab] = codeEditor.value;
    }

    // Fully destroy Prism-Live and clean up DOM
    destroyPrismLive();

    // Hide textarea
    codeEditor.style.display = 'none';

    // Show read-only view and re-highlight
    codePre.style.display = '';
    displayCode(activeTab);

    btnEdit.innerHTML = '<span class="material-symbols-outlined">edit</span> Edit';
    showToast('View mode');
  }
}

// ===== UI Helpers =====
function updateBadge() {
  if (exportData) {
    const formats = ['html', 'jsx', 'css', 'toon'].filter(f => exportData[f]);
    headerBadge.textContent = `${formats.length} formats`;
  }
}

function showEmptyState() {
  codeWrapper.innerHTML = `
    <div class="empty-state">
      <span class="material-symbols-outlined">code_off</span>
      <p>No export data found</p>
      <p style="font-size: 12px;">Select elements on a page and click Export to preview code here.</p>
    </div>
  `;
}

function showToast(message) {
  toastText.textContent = message;
  toast.classList.add('visible');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('visible');
  }, 2000);
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '').trim();
}

// ===== Actions =====
function getActiveContent() {
  if (editMode && codeEditor.value) {
    return codeEditor.value;
  }
  return exportData ? (exportData[activeTab] || '') : '';
}

function copyToClipboard() {
  const content = getActiveContent();
  if (!content) return;

  if (editMode && exportData) {
    exportData[activeTab] = codeEditor.value;
  }

  navigator.clipboard.writeText(content).then(() => {
    showToast('Copied to clipboard!');
  }).catch(() => {
    const textarea = document.createElement('textarea');
    textarea.value = content;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Copied to clipboard!');
  });
}

function downloadFile(tab) {
  if (!exportData) return;

  if (editMode && tab === activeTab) {
    exportData[activeTab] = codeEditor.value;
  }

  if (!exportData[tab]) return;

  const name = sanitizeFilename(filenameInput.value) || 'component';
  const ext = getFileExtension(tab);
  const mime = getMimeType(tab);
  const blob = new Blob([exportData[tab]], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}${ext}`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${name}${ext}`);
}

function downloadAll() {
  if (editMode && exportData) {
    exportData[activeTab] = codeEditor.value;
  }

  const tabs = ['html', 'jsx', 'css', 'toon'];
  let delay = 0;
  let count = 0;

  tabs.forEach(tab => {
    if (exportData && exportData[tab]) {
      setTimeout(() => downloadFile(tab), delay);
      delay += 150;
      count++;
    }
  });

  setTimeout(() => {
    showToast(`Downloaded ${count} files`);
  }, delay);
}

// ===== Event Listeners =====
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    // Save current edits before switching tabs
    if (editMode && exportData) {
      exportData[activeTab] = codeEditor.value;
    }

    // If in edit mode, destroy Prism-Live before switching
    if (editMode) {
      destroyPrismLive();
    }

    displayCode(btn.dataset.tab);

    // Re-init Prism-Live for new tab language if in edit mode
    if (editMode) {
      codeEditor.style.display = '';
      createPrismLive();
    }
  });
});

btnEdit.addEventListener('click', toggleEditMode);
btnCopy.addEventListener('click', copyToClipboard);
btnDownloadCurrent.addEventListener('click', () => downloadFile(activeTab));
btnDownloadAll.addEventListener('click', downloadAll);

// Sync editor changes back to exportData on input + update live preview
codeEditor.addEventListener('input', () => {
  if (editMode && exportData) {
    exportData[activeTab] = codeEditor.value;
    scheduleLivePreviewUpdate();
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const isInEditor = editMode && document.activeElement === codeEditor;

  // Cmd/Ctrl + C when not editing
  if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !isInEditor && document.activeElement !== filenameInput) {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    e.preventDefault();
    copyToClipboard();
  }

  // Cmd/Ctrl + S to download current
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && !e.shiftKey) {
    e.preventDefault();
    downloadFile(activeTab);
  }

  // Cmd/Ctrl + Shift + S to download all
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    downloadAll();
  }

  // Cmd/Ctrl + E to toggle edit mode
  if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
    e.preventDefault();
    toggleEditMode();
  }

  // Tab switching with number keys (only when not in editor or filename)
  if (!e.metaKey && !e.ctrlKey && !e.altKey && !isInEditor && document.activeElement !== filenameInput) {
    const tabMap = { '1': 'html', '2': 'jsx', '3': 'css', '4': 'toon' };
    if (tabMap[e.key]) {
      e.preventDefault();
      if (editMode && exportData) {
        exportData[activeTab] = codeEditor.value;
      }
      if (editMode) {
        destroyPrismLive();
      }
      displayCode(tabMap[e.key]);
      if (editMode) {
        codeEditor.style.display = '';
        createPrismLive();
      }
    }
  }
});

// ===== Live Preview =====
let previewDebounce = null;
let currentOrientation = 'bottom'; // 'bottom' or 'side'

function loadVisualPreview() {
  if (!exportData) return;
  updateLivePreview();
}

function updateLivePreview() {
  if (!exportData) return;

  // Build a full HTML document to render in the iframe
  const htmlContent = exportData.html || '';
  const cssContent = exportData.css || '';

  if (!htmlContent) {
    previewEmpty.style.display = '';
    return;
  }

  previewEmpty.style.display = 'none';
  previewPanel.classList.remove('hidden');

  // Wrap content in an inline-block div so we can measure its natural dimensions
  const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body {
    margin: 0; padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #ffffff; color: #1d1d1f;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1c1e; color: #f5f5f7; }
  }
  ${cssContent}
</style>
</head>
<body><div id="__pluck_measure" style="display:inline-block;max-width:100%">${htmlContent}</div></body>
</html>`;

  previewIframe.srcdoc = doc;

  // After iframe loads, detect content's natural aspect ratio and switch orientation
  previewIframe.onload = () => {
    try {
      const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
      const measure = iframeDoc.getElementById('__pluck_measure');
      if (!measure) return;

      const contentWidth = measure.offsetWidth;
      const contentHeight = measure.offsetHeight;

      if (contentWidth === 0 || contentHeight === 0) return;

      if (contentHeight > contentWidth * 1.2) {
        // Vertical / portrait content → right sidebar
        setPreviewOrientation('side');
      } else {
        // Horizontal / landscape / square content → bottom strip
        setPreviewOrientation('bottom');
      }
    } catch (e) {
      // Cross-origin or access error, keep current orientation
    }
  };
}

function setPreviewOrientation(orientation) {
  if (orientation === currentOrientation) return;
  currentOrientation = orientation;

  const toggleIcon = btnTogglePreview.querySelector('.material-symbols-outlined');

  if (orientation === 'side') {
    mainContent.classList.remove('main-content--bottom');
    mainContent.classList.add('main-content--side');
    if (toggleIcon) toggleIcon.textContent = 'chevron_right';
  } else {
    mainContent.classList.remove('main-content--side');
    mainContent.classList.add('main-content--bottom');
    if (toggleIcon) toggleIcon.textContent = 'expand_more';
  }
}

function scheduleLivePreviewUpdate() {
  if (previewDebounce) clearTimeout(previewDebounce);
  previewDebounce = setTimeout(updateLivePreview, 300);
}

function togglePreviewPanel() {
  previewPanel.classList.toggle('hidden');
}

btnTogglePreview.addEventListener('click', togglePreviewPanel);
btnShowPreview.addEventListener('click', togglePreviewPanel);

// ===== Start =====
init();
