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
      renderDiagnostics(exportData.diagnostics);
      if (btnDownloadFonts && exportData.fontFaces && exportData.fontFaces.some(f => f.ok)) {
        btnDownloadFonts.hidden = false;
      }
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
let currentOrientation = 'bottom';
let manualOrientation = null;

// Wider than this never goes in the side panel — would clip.
const WIDE_CONTENT_THRESHOLD = 600;

function loadVisualPreview() {
  if (!exportData) return;
  updateLivePreview();
}

function updateLivePreview() {
  if (!exportData) return;

  const htmlContent = exportData.html || '';
  const cssContent = exportData.css || '';

  if (!htmlContent) {
    previewEmpty.style.display = '';
    return;
  }

  previewEmpty.style.display = 'none';
  previewPanel.classList.remove('hidden');

  // Render at natural width inside a scaler; transform: scale fits it to the panel post-load.
  const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; color: #1d1d1f; }
  @media (prefers-color-scheme: dark) {
    html, body { background: #1c1c1e; color: #f5f5f7; }
  }
  #__pluck_scaler {
    transform-origin: top left;
    padding: 16px;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  #__pluck_measure { display: inline-block; }
  ${cssContent}
</style>
</head>
<body><div id="__pluck_scaler"><div id="__pluck_measure">${htmlContent}</div></div></body>
</html>`;

  previewIframe.srcdoc = doc;

  previewIframe.onload = () => {
    try {
      const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
      const measure = iframeDoc.getElementById('__pluck_measure');
      const scaler = iframeDoc.getElementById('__pluck_scaler');
      if (!measure || !scaler) return;

      const contentWidth = measure.offsetWidth;
      const contentHeight = measure.offsetHeight;
      if (contentWidth === 0 || contentHeight === 0) return;

      let target = manualOrientation;
      if (!target) {
        if (contentWidth > WIDE_CONTENT_THRESHOLD) target = 'bottom';
        else if (contentHeight > contentWidth * 1.2) target = 'side';
        else target = 'bottom';
      }
      setPreviewOrientation(target);

      // rAF so the panel's width/height transition has applied before we measure.
      requestAnimationFrame(() => fitPreviewContent(scaler, contentWidth, contentHeight));
    } catch (e) {
      // Cross-origin or access error, keep current orientation
    }
  };
}

function fitPreviewContent(scaler, contentWidth, contentHeight) {
  if (!scaler) return;
  const body = document.getElementById('preview-panel-body');
  if (!body) return;
  const availW = body.clientWidth;
  // +32 for the scaler's 16px all-sides padding.
  const naturalW = contentWidth + 32;
  const naturalH = contentHeight + 32;
  const scale = Math.min(availW / naturalW, 1);
  scaler.style.transform = `scale(${scale})`;
  scaler.style.width = `${naturalW}px`;
  scaler.style.height = `${naturalH}px`;
  // Negative margins collapse the transform's leftover layout footprint.
  scaler.style.marginBottom = `${(scale - 1) * naturalH}px`;
  scaler.style.marginRight = `${(scale - 1) * naturalW}px`;
}

function setPreviewOrientation(orientation) {
  const toggleIcon = btnTogglePreview.querySelector('.material-symbols-outlined');
  const flipIcon = document.querySelector('#btn-flip-orientation .material-symbols-outlined');

  if (orientation === 'side') {
    mainContent.classList.remove('main-content--bottom');
    mainContent.classList.add('main-content--side');
    if (toggleIcon) toggleIcon.textContent = 'chevron_right';
    if (flipIcon) flipIcon.textContent = 'splitscreen_bottom';
  } else {
    mainContent.classList.remove('main-content--side');
    mainContent.classList.add('main-content--bottom');
    if (toggleIcon) toggleIcon.textContent = 'expand_more';
    if (flipIcon) flipIcon.textContent = 'splitscreen_right';
  }
  currentOrientation = orientation;
}

function flipPreviewOrientation() {
  manualOrientation = currentOrientation === 'side' ? 'bottom' : 'side';
  setPreviewOrientation(manualOrientation);
  try {
    const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
    const measure = iframeDoc.getElementById('__pluck_measure');
    const scaler = iframeDoc.getElementById('__pluck_scaler');
    if (measure && scaler) {
      requestAnimationFrame(() =>
        fitPreviewContent(scaler, measure.offsetWidth, measure.offsetHeight)
      );
    }
  } catch (e) {}
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

const btnFlipOrientation = document.getElementById('btn-flip-orientation');
if (btnFlipOrientation) btnFlipOrientation.addEventListener('click', flipPreviewOrientation);

let resizeDebounce = null;
window.addEventListener('resize', () => {
  if (resizeDebounce) clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(() => {
    try {
      const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow.document;
      const measure = iframeDoc.getElementById('__pluck_measure');
      const scaler = iframeDoc.getElementById('__pluck_scaler');
      if (measure && scaler) fitPreviewContent(scaler, measure.offsetWidth, measure.offsetHeight);
    } catch (e) {}
  }, 100);
});

// ===== Font zip download =====
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const enc = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localChunks.push(local, data);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralChunks.push(central);
    offset += local.length + size;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const c of centralChunks) centralSize += c.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);
  const out = new Uint8Array(offset + centralSize + eocd.length);
  let pos = 0;
  for (const c of localChunks) { out.set(c, pos); pos += c.length; }
  for (const c of centralChunks) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
}

function fontFileName(face) {
  const safeFam = face.family.replace(/[^A-Za-z0-9]/g, '');
  const styleSuffix = face.style && face.style !== 'normal' ? `-${face.style}` : '';
  const ext = face.format === 'truetype' ? 'ttf'
    : face.format === 'opentype' ? 'otf'
    : face.format === 'embedded-opentype' ? 'eot'
    : face.format;
  return `pluck-${safeFam}-${face.weight}${styleSuffix}.${ext}`;
}

function downloadFontsZip() {
  if (!exportData || !exportData.fontFaces) return;
  const ok = exportData.fontFaces.filter(f => f.ok && f.base64);
  if (ok.length === 0) return;
  const entries = ok.map(face => ({
    name: fontFileName(face),
    data: base64ToBytes(face.base64),
  }));
  const zipBytes = buildZip(entries);
  const blob = new Blob([zipBytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pluck-fonts.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const btnDownloadFonts = document.getElementById('btn-download-fonts');
if (btnDownloadFonts) btnDownloadFonts.addEventListener('click', downloadFontsZip);

// ===== Diagnostics renderer =====
function renderDiagnostics(d) {
  const wrap = document.getElementById('diag');
  if (!wrap || !d) return;
  wrap.hidden = false;

  const summary = document.getElementById('diag-summary');
  summary.innerHTML = '';

  const label = document.createElement('span');
  label.textContent = 'Diagnostics';
  summary.appendChild(label);

  const pill = (text, warn) => {
    const s = document.createElement('span');
    s.className = 'diag-pill' + (warn ? ' warn' : '');
    s.textContent = text;
    summary.appendChild(s);
  };

  pill(`${d.selectionCount} selection${d.selectionCount === 1 ? '' : 's'}`);
  if (d.wrapperCount > 0) pill(`${d.wrapperCount} parent-wrap${d.wrapperCount === 1 ? '' : 's'}`);
  if (d.filteredCount > 0) pill(`${d.filteredCount} dropped`, true);
  pill(`${d.styleCount} styles`);
  if (d.pseudoStyleCount > 0) pill(`${d.pseudoStyleCount} pseudo`);
  if (d.tailwindMode) pill('tailwind');
  if (d.primaryFont && !d.primaryFontWillLoad) {
    pill(`font fallback: ${d.primaryFont}`, true);
  }

  const body = document.getElementById('diag-body');
  body.innerHTML = '';

  if (d.filteredCount > 0) {
    const note = document.createElement('div');
    note.className = 'diag-row';
    note.style.color = '#fbbf24';
    note.innerHTML = `<span class="meta">Filtered ${d.filteredCount} hidden node${d.filteredCount === 1 ? '' : 's'} from descendants. Use Alt+Click for exact targeting if you need them.</span>`;
    body.appendChild(note);
  }

  if (d.primaryFont && !d.primaryFontWillLoad) {
    const note = document.createElement('div');
    note.className = 'diag-row';
    note.style.color = '#fbbf24';
    note.innerHTML = `<span class="meta">Primary font <strong>${d.primaryFont}</strong> isn't on Google Fonts — export will fall back to the system stack and text widths may shift.</span>`;
    body.appendChild(note);
  }

  if (!d.selections || d.selections.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'diag-row';
    empty.innerHTML = `<span class="meta">No top-level selections recorded.</span>`;
    body.appendChild(empty);
    return;
  }

  for (const s of d.selections) {
    const row = document.createElement('div');
    row.className = 'diag-row';

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `<${s.tag}>`;
    row.appendChild(tag);

    const meta = document.createElement('span');
    meta.className = 'meta';
    const cls = s.className ? `.${s.className.replace(/\s+/g, '.')}` : '';
    meta.textContent = `${cls} — ${s.w}×${s.h} at (${s.x}, ${s.y})`;
    row.appendChild(meta);

    if (s.wrapped) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'wrapped';
      row.appendChild(b);
    }
    if (!s.kept) {
      const b = document.createElement('span');
      b.className = 'badge dropped';
      b.textContent = 'dropped';
      row.appendChild(b);
    }

    body.appendChild(row);
  }
}

// ===== Start =====
init();
