// ===== Pluck dock — unified cockpit (side panel + popped-out tab) =====

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const isPopout = params.get('view') === 'popout';
const isMac = navigator.platform.toUpperCase().includes('MAC') || navigator.userAgent.toUpperCase().includes('MAC');

// ---- State ----
let exportData = null;
let activeTab = 'toon';
let currentView = 'preview';
let editMode = false;
let prismLiveInstance = null;
let isSelecting = false;
let xrayMode = false;
let colorPickActive = false;
let selectionCount = 0;
let lastExportedAt = null;
let handledAt = null; // exportedAt of the last export we copied/historied (persisted)
let pollTimer = null;
let isUpdatingState = false;
let pendingCopy = null;
let elprevSuppressed = false; // hide the hover preview once a result is showing

let settings = { autoCopyFormat: 'toon', aiPreset: 'react-tailwind', theme: 'dark' };

const DEFAULT_SHORTCUTS = {
  startSelect: { ctrl: true, shift: true, alt: false, key: 'S' },
  clearSelect: { ctrl: false, shift: false, alt: false, key: 'Escape' },
  export: { ctrl: true, shift: true, alt: false, key: 'E' },
  xray: { ctrl: true, shift: true, alt: false, key: 'X' },
  colorPick: { ctrl: true, shift: true, alt: false, key: 'P' },
};

const AI_PRESETS = {
  'react-tailwind': { label: 'React + Tailwind', hint: 'JSX component, utility classes',
    wrap: (t) => `Recreate this UI component as a React functional component using Tailwind CSS. Match the layout, spacing, colors, typography, borders and any hover/interaction states as closely as possible. Below is the component in TOON format — a compact tree of \`tag.class[inline-styles] (attributes) "text" { children }\`:\n\n${t}` },
  'react-css': { label: 'React + CSS', hint: 'JSX + a CSS module',
    wrap: (t) => `Recreate this UI component as a React functional component with a matching CSS module. Reproduce the layout, spacing, colors and typography exactly. Component in TOON format:\n\n${t}` },
  'vue': { label: 'Vue 3 SFC', hint: 'single-file component, scoped CSS',
    wrap: (t) => `Recreate this UI component as a Vue 3 single-file component with scoped styles, matching it exactly. Component in TOON format:\n\n${t}` },
  'html': { label: 'Responsive HTML/CSS', hint: 'semantic, responsive markup',
    wrap: (t) => `Recreate this UI component as clean, semantic, responsive HTML and CSS, matching the layout, spacing, colors and typography exactly. Component in TOON format:\n\n${t}` },
  'raw': { label: 'Raw TOON', hint: 'just the TOON, no instruction',
    wrap: (t) => t },
};

// ================= Settings & theme =================
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
  const icon = $('btn-theme').querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = settings.theme === 'light' ? 'light_mode' : 'dark_mode';
}
function loadSettings(cb) {
  chrome.storage.local.get('pluckSettings', (r) => {
    if (r.pluckSettings) settings = Object.assign(settings, r.pluckSettings);
    cb && cb();
  });
}
function saveSettings() {
  chrome.storage.local.set({ pluckSettings: settings });
}

// ================= Toast =================
let toastTimer = null;
function showToast(message, ok = true) {
  $('toast-text').textContent = message;
  const icon = $('toast').querySelector('.material-symbols-outlined');
  if (icon) { icon.textContent = ok ? 'check_circle' : 'info'; icon.style.color = ok ? 'var(--success)' : 'var(--warn)'; }
  $('toast').classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2200);
}

// ================= Clipboard =================
async function writeClipboard(text) {
  if (!text) return false;
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
    } catch (_) { return false; }
  }
}

// ================= Tokens =================
function estTokens(str) { return Math.max(0, Math.round((str || '').length / 4)); }
function fmtTok(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n); }
function updateTokens() {
  if (!exportData) return;
  ['html', 'jsx', 'css', 'toon'].forEach((t) => {
    const el = $('tok-' + t);
    if (el) el.textContent = exportData[t] ? fmtTok(estTokens(exportData[t])) : '–';
  });
}

// ================= Code display (ported from preview) =================
const codeOutput = $('code-output'), codePre = $('code-pre'), codeEditor = $('code-editor');
const codeWrap = $('code-wrap'), filenameInput = $('filename');

function langClass(tab) { return tab === 'jsx' ? 'javascript' : tab === 'css' ? 'css' : tab === 'toon' ? 'markup' : 'html'; }
function fileExt(tab) { return tab === 'jsx' ? '.jsx' : tab === 'css' ? '.css' : tab === 'toon' ? '.toon' : '.html'; }
function mimeType(tab) { return tab === 'html' ? 'text/html' : tab === 'jsx' ? 'text/javascript' : tab === 'css' ? 'text/css' : 'text/plain'; }

function displayCode(tab) {
  if (!exportData) return;
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const content = exportData[tab] || '';
  const lc = langClass(tab);
  if (editMode) {
    codeEditor.value = content;
    codeEditor.className = `prism-live language-${lc}`;
    if (prismLiveInstance) prismLiveInstance.update();
  } else {
    codePre.className = `language-${lc}`;
    codeOutput.className = `language-${lc}`;
    codeOutput.textContent = content;
    if (typeof Prism !== 'undefined' && Prism.highlightElement) {
      try { Prism.highlightElement(codeOutput); } catch (e) {}
    }
  }
  scheduleRender();
}

// ---- Edit mode (Prism-Live lifecycle) ----
function destroyPrismLive() {
  if (!prismLiveInstance) return;
  const wrapper = prismLiveInstance.wrapper;
  if (wrapper && wrapper.parentNode) { wrapper.parentNode.insertBefore(codeEditor, wrapper); wrapper.remove(); }
  codeWrap.querySelectorAll('pre.prism-live').forEach((el) => el.remove());
  codeWrap.querySelectorAll('div.prism-live').forEach((el) => { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); });
  prismLiveInstance = null;
}
function createPrismLive() {
  if (typeof Prism === 'undefined' || !Prism.Live) return;
  try { prismLiveInstance = new Prism.Live(codeEditor); } catch (e) { prismLiveInstance = null; }
}
function toggleEditMode() {
  if (!exportData) return;
  editMode = !editMode;
  const icon = $('btn-edit').querySelector('.material-symbols-outlined');
  if (editMode) {
    codePre.style.display = 'none';
    codeEditor.value = exportData[activeTab] || '';
    codeEditor.className = `prism-live language-${langClass(activeTab)}`;
    codeEditor.style.display = '';
    destroyPrismLive(); createPrismLive();
    if (icon) icon.textContent = 'visibility';
    showToast('Edit mode');
  } else {
    if (codeEditor.value) exportData[activeTab] = codeEditor.value;
    destroyPrismLive();
    codeEditor.style.display = 'none';
    codePre.style.display = '';
    displayCode(activeTab);
    if (icon) icon.textContent = 'edit';
    updateTokens();
  }
}

// ---- Copy / download ----
function getActiveContent() { return editMode && codeEditor.value ? codeEditor.value : (exportData ? exportData[activeTab] || '' : ''); }
function sanitizeFilename(n) { return (n || '').replace(/[<>:"/\\|?*]/g, '').trim(); }

async function copyCurrent() {
  const c = getActiveContent();
  if (!c) return;
  if (editMode && exportData) exportData[activeTab] = codeEditor.value;
  const ok = await writeClipboard(c);
  showToast(ok ? `${activeTab.toUpperCase()} copied` : 'Copy failed — click the panel first', ok);
}
async function copyForAI() {
  if (!exportData || !exportData.toon) return;
  const preset = AI_PRESETS[settings.aiPreset] || AI_PRESETS['react-tailwind'];
  const ok = await writeClipboard(preset.wrap(exportData.toon));
  showToast(ok ? `Copied for AI · ${preset.label}` : 'Copy failed — click the panel first', ok);
}
function downloadBlob(content, name, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
function downloadFile(tab) {
  if (!exportData) return;
  if (editMode && tab === activeTab) exportData[activeTab] = codeEditor.value;
  if (!exportData[tab]) return;
  const name = sanitizeFilename(filenameInput.value) || 'component';
  downloadBlob(exportData[tab], `${name}${fileExt(tab)}`, mimeType(tab));
  showToast(`Downloaded ${name}${fileExt(tab)}`);
}
function downloadAll() {
  if (editMode && exportData) exportData[activeTab] = codeEditor.value;
  let delay = 0, count = 0;
  ['html', 'jsx', 'css', 'toon'].forEach((t) => {
    if (exportData && exportData[t]) { setTimeout(() => downloadFile(t), delay); delay += 150; count++; }
  });
  setTimeout(() => showToast(`Downloaded ${count} files`), delay);
}

// ================= Live render =================
// We render exportData.html VERBATIM — it's the complete standalone page the
// engine produced (fonts, resets, captured CSS, body) and renders identically
// to the downloaded file. We only zoom-to-fit afterwards; no wrapping, no
// re-injecting CSS (that was what broke the preview).
let renderDebounce = null, renderMode = 'fit', lastRenderKey = '';
function scheduleRender() { if (renderDebounce) clearTimeout(renderDebounce); renderDebounce = setTimeout(updateRender, 300); }
function updateRender() {
  if (!exportData) return;
  const html = exportData.html || '';
  const iframe = $('render-iframe'), empty = $('render-empty');
  if (!html) { empty.style.display = ''; lastRenderKey = ''; return; }
  empty.style.display = 'none';
  if (html === lastRenderKey) { fitRender(); return; } // unchanged — just refit, no reload/flicker
  lastRenderKey = html;
  iframe.onload = () => {
    requestAnimationFrame(fitRender);
    // Re-fit after web-fonts swap in (their metrics change layout) and after a
    // beat for late images — measuring only at onload scales against fallback
    // metrics and makes text shift/overlap.
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (doc && doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => fitRender()).catch(() => {});
    } catch (e) {}
    setTimeout(fitRender, 350);
  };
  iframe.srcdoc = html;
}
function fitRender() {
  try {
    const bw = $('render-body').clientWidth;
    if (bw < 40) return;                        // preview pane not visible yet
    const iframe = $('render-iframe');
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    if (!doc || !doc.documentElement) return;
    const root = doc.documentElement;
    root.style.zoom = '1';                       // reset before measuring natural width
    const natW = root.scrollWidth;
    if (!natW) return;
    const scale = renderMode === 'actual' ? 1 : Math.min((bw - 2) / natW, 1);
    root.style.zoom = String(scale);             // zoom reflows; iframe scrolls tall content
  } catch (e) {}
}
function refitRender() { fitRender(); }
function setView(v) {
  if (document.body.classList.contains('sidebyside')) return; // both panes shown in popout
  currentView = v;
  document.querySelectorAll('.view-tab').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('pane-preview').classList.toggle('hidden', v !== 'preview');
  $('pane-code').classList.toggle('hidden', v !== 'code');
  if (v === 'preview') requestAnimationFrame(refitRender); // pane visible now → measure
}

// ================= Diagnostics (ported) =================
function renderDiagnostics(d) {
  const wrap = $('diag');
  if (!wrap) return;
  if (!d) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const summary = $('diag-summary'); summary.innerHTML = '';
  const label = document.createElement('span'); label.textContent = 'Diagnostics'; summary.appendChild(label);
  const pill = (text, warn) => { const s = document.createElement('span'); s.className = 'diag-pill' + (warn ? ' warn' : ''); s.textContent = text; summary.appendChild(s); };
  pill(`${d.selectionCount} selection${d.selectionCount === 1 ? '' : 's'}`);
  if (d.wrapperCount > 0) pill(`${d.wrapperCount} parent-wrap${d.wrapperCount === 1 ? '' : 's'}`);
  if (d.filteredCount > 0) pill(`${d.filteredCount} dropped`, true);
  pill(`${d.styleCount} styles`);
  if (d.pseudoStyleCount > 0) pill(`${d.pseudoStyleCount} pseudo`);
  if (d.tailwindMode) pill('tailwind');
  if (d.primaryFont && !d.primaryFontWillLoad) pill(`font fallback: ${d.primaryFont}`, true);
  const body = $('diag-body'); body.innerHTML = '';
  if (d.primaryFont && !d.primaryFontWillLoad) {
    const note = document.createElement('div'); note.className = 'diag-row';
    note.innerHTML = `<span class="meta" style="white-space:normal;color:var(--warn)">Primary font <strong>${d.primaryFont}</strong> isn't on Google Fonts — export falls back to the system stack and text widths may shift.</span>`;
    body.appendChild(note);
  }
  if (!d.selections || !d.selections.length) {
    const e = document.createElement('div'); e.className = 'diag-row'; e.innerHTML = `<span class="meta">No top-level selections recorded.</span>`; body.appendChild(e); return;
  }
  for (const s of d.selections) {
    const row = document.createElement('div'); row.className = 'diag-row';
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = `<${s.tag}>`; row.appendChild(tag);
    const meta = document.createElement('span'); meta.className = 'meta';
    const cls = s.className ? `.${s.className.replace(/\s+/g, '.')}` : '';
    meta.textContent = `${cls} — ${s.w}×${s.h} at (${s.x}, ${s.y})`; row.appendChild(meta);
    if (s.wrapped) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'wrapped'; row.appendChild(b); }
    if (!s.kept) { const b = document.createElement('span'); b.className = 'badge dropped'; b.textContent = 'dropped'; row.appendChild(b); }
    body.appendChild(row);
  }
}

// ================= Fonts zip (ported) =================
function base64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
const CRC32_TABLE = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = (c >>> 8) ^ CRC32_TABLE[(c ^ b[i]) & 0xff]; return (c ^ 0xffffffff) >>> 0; }
function buildZip(entries) {
  const enc = new TextEncoder(); const local = [], central = []; let offset = 0;
  for (const e of entries) {
    const nb = enc.encode(e.name), data = e.data, crc = crc32(data), size = data.length;
    const l = new Uint8Array(30 + nb.length); const lv = new DataView(l.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true); lv.setUint16(26, nb.length, true);
    l.set(nb, 30); local.push(l, data);
    const c = new Uint8Array(46 + nb.length); const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, nb.length, true); cv.setUint32(42, offset, true);
    c.set(nb, 46); central.push(c); offset += l.length + size;
  }
  let cSize = 0; for (const c of central) cSize += c.length;
  const eo = new Uint8Array(22); const ev = new DataView(eo.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cSize + eo.length); let p = 0;
  for (const c of local) { out.set(c, p); p += c.length; }
  for (const c of central) { out.set(c, p); p += c.length; }
  out.set(eo, p); return out;
}
function fontFileName(f) {
  const fam = f.family.replace(/[^A-Za-z0-9]/g, '');
  const sfx = f.style && f.style !== 'normal' ? `-${f.style}` : '';
  const ext = f.format === 'truetype' ? 'ttf' : f.format === 'opentype' ? 'otf' : f.format === 'embedded-opentype' ? 'eot' : f.format;
  return `pluck-${fam}-${f.weight}${sfx}.${ext}`;
}
function downloadFontsZip() {
  if (!exportData || !exportData.fontFaces) return;
  const ok = exportData.fontFaces.filter((f) => f.ok && f.base64);
  if (!ok.length) return;
  downloadBlob(buildZip(ok.map((f) => ({ name: fontFileName(f), data: base64ToBytes(f.base64) }))), 'pluck-fonts.zip', 'application/zip');
  showToast('Fonts downloaded');
}

// ================= History =================
function trimForHistory(d) {
  return { id: d.exportedAt || Date.now(), name: d.name || 'component', ts: Date.now(),
    html: d.html, jsx: d.jsx, css: d.css, toon: d.toon, diagnostics: d.diagnostics };
}
function pushHistory(d) {
  chrome.storage.local.get('pluckHistory', (r) => {
    let hist = r.pluckHistory || [];
    hist.unshift(trimForHistory(d));
    hist = hist.slice(0, 10);
    chrome.storage.local.set({ pluckHistory: hist }, () => renderHistory(hist));
  });
}
function renderHistory(hist) {
  const wrap = $('history'), strip = $('history-strip');
  if (!hist || !hist.length) { wrap.classList.add('empty'); return; }
  wrap.classList.remove('empty');
  strip.innerHTML = '';
  hist.forEach((h) => {
    const card = document.createElement('div'); card.className = 'hist-card';
    if (exportData && h.id === exportData.exportedAt) card.classList.add('active');
    const t = new Date(h.ts);
    const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const n = h.diagnostics ? h.diagnostics.selectionCount : '';
    card.innerHTML = `<div class="hist-name">${h.name || 'component'}</div><div class="hist-meta">${time}${n ? ' · ' + n + 'el' : ''}</div>`;
    card.addEventListener('click', () => { loadExport(h, { isNew: false }); });
    strip.appendChild(card);
  });
}
function loadHistory() { chrome.storage.local.get('pluckHistory', (r) => renderHistory(r.pluckHistory || [])); }

// ================= Load an export into the UI =================
async function loadExport(data, opts = {}) {
  // Drop edit mode WITHOUT saving — otherwise stale editor text leaks into the new data.
  if (editMode) {
    editMode = false;
    destroyPrismLive();
    codeEditor.style.display = 'none';
    codePre.style.display = '';
    const ei = $('btn-edit').querySelector('.material-symbols-outlined');
    if (ei) ei.textContent = 'edit';
  }
  exportData = data;
  setExporting(false); // result is in — drop the loader (covers dock, keyboard & storage paths)
  elprevSuppressed = true; updateElPreview(null); // one preview after export: hide the hover one
  $('result').classList.remove('empty');
  if (data.name) filenameInput.value = sanitizeFilename(data.name) || 'component';
  displayCode(activeTab);
  updateTokens();
  renderDiagnostics(data.diagnostics);
  $('btn-download-fonts').hidden = !(data.fontFaces && data.fontFaces.some((f) => f.ok));
  updateRender();
  if (opts.isNew) setView('preview'); // land on the visual first
  if (opts.isNew) {
    handledAt = data.exportedAt;
    if (data.exportedAt != null) chrome.storage.local.set({ pluckHandledAt: data.exportedAt });
    pushHistory(data);
    const fmt = settings.autoCopyFormat;
    let copied = false;
    if (fmt !== 'off' && data[fmt]) { copied = await writeClipboard(data[fmt]); if (!copied) pendingCopy = data[fmt]; }
    const n = data.diagnostics ? data.diagnostics.selectionCount : 0;
    if (copied) showToast(`Grabbed ${n || ''} · ${fmt.toUpperCase()} copied`.replace('  ', ' '));
    else if (fmt !== 'off') showToast('Export ready — click the dock to copy', false);
    else showToast('Export ready');
  } else {
    loadHistory();
  }
}

// ================= Messaging (ported from popup) =================
function getActiveTab(cb) { chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => cb(tabs[0])); }
function isTabCompatible(tab) {
  if (!tab || !tab.url) return false;
  return !/^(chrome|chrome-extension|about|data|edge|brave):/.test(tab.url);
}
async function sendMessageToTab(tab, message, callback) {
  if (!isTabCompatible(tab)) { setStatus("Can't run on this page", 'idle'); callback(null); return; }
  if (message.type === 'EXPORT_SELECTION') {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      for (const f of frames) {
        try { const r = await chrome.tabs.sendMessage(tab.id, message, { frameId: f.frameId }); if (r && r.toon) { callback(r); return; } } catch (e) {}
      }
      callback(null);
    } catch (e) {
      chrome.tabs.sendMessage(tab.id, message, (r) => callback(chrome.runtime.lastError ? null : r));
    }
    return;
  }
  if (message.type === 'GET_STATE') {
    // Main frame only — querying all frames lets an iframe (pickMode:false) answer
    // first, flipping the button on its own.
    try { callback(await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 })); } catch (e) { callback(null); }
    return;
  }
  if (message.type === 'TOGGLE_XRAY') {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, message);
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      for (const f of frames) if (f.frameId !== 0) { try { await chrome.tabs.sendMessage(tab.id, message, { frameId: f.frameId }); } catch (e) {} }
      callback(r);
    } catch (e) { callback(null); }
    return;
  }
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    for (const f of frames) { try { await chrome.tabs.sendMessage(tab.id, message, { frameId: f.frameId }); } catch (e) {} }
    callback({ ok: true });
  } catch (e) {
    chrome.tabs.sendMessage(tab.id, message, (r) => callback(chrome.runtime.lastError ? null : r));
  }
}

// ================= Controls =================
function setStatus(message, state = 'idle') {
  $('status').textContent = message;
  const dot = $('status-dot');
  dot.classList.remove('active', 'success');
  if (state === 'active') dot.classList.add('active');
  if (state === 'success') dot.classList.add('success');
}
let _exportingTimer = null;
function setExporting(on) {
  const loader = $('export-loader');
  const btn = $('btn-export');
  clearTimeout(_exportingTimer);
  if (on) {
    loader.classList.add('show'); loader.setAttribute('aria-hidden', 'false');
    btn.classList.add('loading'); btn.disabled = true;
    // Safety: never let the loader itself hang if a reply is ever lost (font timeout is 4s).
    _exportingTimer = setTimeout(() => setExporting(false), 15000);
  } else {
    loader.classList.remove('show'); loader.setAttribute('aria-hidden', 'true');
    btn.classList.remove('loading'); btn.disabled = false;
  }
}
function updateSelCount(count) {
  selectionCount = count;
  const el = $('sel-count');
  if (count > 0) { el.textContent = `${count} selected`; el.classList.remove('hidden'); }
  else el.classList.add('hidden');
}
function updateSelectButton() {
  const icon = $('btn-select').querySelector('.material-symbols-outlined');
  const label = $('select-label');
  if (isSelecting) {
    icon.textContent = 'stop_circle'; label.textContent = 'Stop Selecting';
    $('btn-select').classList.remove('btn-primary'); $('btn-select').classList.add('btn-stop');
  } else {
    icon.textContent = 'point_scan'; label.textContent = 'Start Selecting';
    $('btn-select').classList.add('btn-primary'); $('btn-select').classList.remove('btn-stop');
  }
}
function setSelecting(on) {
  isSelecting = on;
  updateSelectButton();
  if (on) setStatus('Selection mode active', 'active');
  else { setStatus('Ready to select', 'idle'); updateElPreview(null); }
}
function toggleSelection() {
  isUpdatingState = true;
  const next = !isSelecting;
  if (next) elprevSuppressed = false; // re-enable hover preview when starting a fresh selection
  setSelecting(next);
  getActiveTab((tab) => sendMessageToTab(tab, { type: next ? 'START_PICK_MODE' : 'STOP_PICK_MODE' }, () => setTimeout(() => { isUpdatingState = false; }, 600)));
}

// ---- Live element preview during selection ----
let lastSnippet = '', lastRectKey = '';
function updateElPreview(resp) {
  const panel = $('elprev');
  if (elprevSuppressed || !isSelecting || !resp || !resp.previewSnippet) { panel.classList.remove('visible'); lastSnippet = ''; lastRectKey = ''; $('elprev-render').innerHTML = ''; $('elprev-code').innerHTML = ''; return; }
  panel.classList.add('visible');
  let tag = `<${resp.previewTag || 'element'}>`;
  if (resp.previewClasses) tag += `.${resp.previewClasses.split(/\s+/).slice(0, 2).join('.')}`;
  $('elprev-tag').textContent = tag;
  $('elprev-dims').textContent = resp.previewDimensions || '';
  if (resp.previewRect) {
    const r = resp.previewRect, key = `${r.x},${r.y},${r.width},${r.height}`;
    if (key !== lastRectKey) { lastRectKey = key; captureElPreview(r); }
  } else { $('elprev-render').innerHTML = ''; lastRectKey = ''; }
  if (resp.previewSnippet !== lastSnippet) { lastSnippet = resp.previewSnippet; $('elprev-code').innerHTML = highlightHtml(resp.previewSnippet); }
}
function captureElPreview(rect) {
  chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' }, (res) => {
    if (!res || !res.ok || !res.dataUrl) { $('elprev-render').innerHTML = ''; return; }
    const img = new Image();
    img.onload = () => {
      const sx = Math.max(0, rect.x), sy = Math.max(0, rect.y);
      const sw = Math.min(rect.width, img.width - sx), sh = Math.min(rect.height, img.height - sy);
      if (sw <= 0 || sh <= 0) { $('elprev-render').innerHTML = ''; return; }
      const c = document.createElement('canvas'); c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const out = document.createElement('img'); out.src = c.toDataURL('image/png');
      $('elprev-render').innerHTML = ''; $('elprev-render').appendChild(out);
    };
    img.src = res.dataUrl;
  });
}
function highlightHtml(html) {
  let e = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  e = e.replace(/&lt;(\/?)([\w-]+)/g, '&lt;$1<span class="hl-tag">$2</span>');
  e = e.replace(/([\w-]+)=&quot;/g, '<span class="hl-attr">$1</span>=&quot;');
  e = e.replace(/([\w-]+)="/g, '<span class="hl-attr">$1</span>="');
  e = e.replace(/="([^"]*?)"/g, '="<span class="hl-val">$1</span>"');
  e = e.replace(/=&quot;([^&]*?)&quot;/g, '=&quot;<span class="hl-val">$1</span>&quot;');
  return e;
}

// ---- Polling: always on, so the dock tracks the page even when selection is
// toggled from the page (⌘⇧S) and the hover preview shows while selecting. ----
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (isUpdatingState) return;
    getActiveTab((tab) => sendMessageToTab(tab, { type: 'GET_STATE' }, (resp) => {
      if (isUpdatingState || !resp) return;
      updateSelCount(resp.selectionCount || 0);
      if (resp.pickMode !== isSelecting) {
        isSelecting = resp.pickMode;
        updateSelectButton();
        setStatus(isSelecting ? 'Selection mode active' : 'Ready to select', isSelecting ? 'active' : 'idle');
      }
      if (resp.xrayMode !== xrayMode) { xrayMode = resp.xrayMode || false; $('btn-xray').classList.toggle('on', xrayMode); }
      updateElPreview(resp);
    }));
  }, 500);
}

function queryCurrentState() {
  getActiveTab((tab) => sendMessageToTab(tab, { type: 'GET_STATE' }, (resp) => {
    if (resp && resp.pickMode !== undefined) {
      isSelecting = resp.pickMode; xrayMode = resp.xrayMode || false;
      updateSelectButton(); $('btn-xray').classList.toggle('on', xrayMode);
      updateSelCount(resp.selectionCount || 0);
      if (isSelecting) { setStatus('Selection mode active', 'active'); startPolling(); }
      else if (xrayMode) setStatus('X-Ray active', 'active');
      else setStatus('Ready to select', 'idle');
    } else { setStatus('Ready to select', 'idle'); }
  }));
}

function doExport() {
  getActiveTab((tab) => {
    setStatus('Exporting…', 'active');
    setExporting(true);
    sendMessageToTab(tab, { type: 'EXPORT_SELECTION' }, (resp) => {
      if (!resp || !resp.toon) { setExporting(false); setStatus('No elements selected', 'idle'); showToast('No elements selected', false); return; }
      resp.exportedAt = Date.now();
      resp.name = sanitizeFilename(filenameInput.value) || 'component';
      setStatus('Export ready', 'success');
      chrome.storage.local.set({ pluckExportData: resp });
      // loadExport (via storage change) clears the loader once the result renders.
    });
  });
}

// ================= Shortcut editor =================
const MODS = [['ctrl', isMac ? '⌘' : 'Ctrl'], ['shift', isMac ? '⇧' : 'Shift'], ['alt', isMac ? '⌥' : 'Alt']];
function buildShortcutEditor() {
  document.querySelectorAll('.sc-row').forEach((row) => {
    const mods = row.querySelector('.sc-mods'); mods.innerHTML = '';
    MODS.forEach(([m, label]) => {
      const b = document.createElement('button'); b.className = 'mod-btn'; b.dataset.mod = m; b.textContent = label;
      b.addEventListener('click', () => b.classList.toggle('active'));
      mods.appendChild(b);
    });
    const input = row.querySelector('.sc-key');
    input.addEventListener('focus', () => { input.removeAttribute('readonly'); input.value = ''; input.placeholder = 'press'; });
    input.addEventListener('keydown', (e) => { e.preventDefault(); let k = e.key; if (k === ' ') k = 'Space'; if (k.length === 1) k = k.toUpperCase(); input.value = k; input.setAttribute('readonly', true); input.blur(); });
    input.addEventListener('blur', () => input.setAttribute('readonly', true));
  });
}
function loadShortcutsToUI(sc) {
  document.querySelectorAll('.sc-row').forEach((row) => {
    const s = sc[row.dataset.sc] || {};
    row.querySelectorAll('.mod-btn').forEach((b) => b.classList.toggle('active', !!s[b.dataset.mod]));
    row.querySelector('.sc-key').value = s.key === 'Escape' ? 'Esc' : (s.key || '');
  });
  renderKbdHints(sc);
}
function renderKbdHints(sc) {
  const wrap = $('kbd-hints'); if (!wrap) return;
  const keysFor = (s) => {
    const k = [];
    if (s.ctrl) k.push(isMac ? '⌘' : 'Ctrl');
    if (s.shift) k.push(isMac ? '⇧' : 'Shift');
    if (s.alt) k.push(isMac ? '⌥' : 'Alt');
    k.push(s.key === 'Escape' ? 'Esc' : (s.key || '').toUpperCase());
    return k;
  };
  const rows = [['startSelect', 'Toggle select'], ['export', 'Export'], ['xray', 'X-Ray'], ['colorPick', 'Color pick']];
  wrap.innerHTML = rows.map(([id, label]) => {
    const s = sc[id] || DEFAULT_SHORTCUTS[id];
    return `<div class="kh"><span class="kh-keys">${keysFor(s).map((x) => `<kbd>${x}</kbd>`).join('')}</span><span>${label}</span></div>`;
  }).join('');
}
function getShortcutsFromUI() {
  const out = {};
  document.querySelectorAll('.sc-row').forEach((row) => {
    const k = row.dataset.sc;
    let key = row.querySelector('.sc-key').value || DEFAULT_SHORTCUTS[k].key;
    if (key === 'Esc') key = 'Escape';
    out[k] = { ctrl: row.querySelector('[data-mod=ctrl]').classList.contains('active'), shift: row.querySelector('[data-mod=shift]').classList.contains('active'), alt: row.querySelector('[data-mod=alt]').classList.contains('active'), key };
  });
  return out;
}

// ================= AI menu =================
function buildAiMenu() {
  const menu = $('ai-menu'); menu.innerHTML = '';
  Object.entries(AI_PRESETS).forEach(([key, p]) => {
    const b = document.createElement('button'); b.className = 'ai-item' + (key === settings.aiPreset ? ' sel' : '');
    b.innerHTML = `${p.label}<small>${p.hint}</small>`;
    b.addEventListener('click', () => { settings.aiPreset = key; saveSettings(); buildAiMenu(); $('set-aipreset').value = key; menu.classList.remove('open'); copyForAI(); });
    menu.appendChild(b);
  });
}

// ================= Wiring =================
function wire() {
  // tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => {
    if (editMode && exportData) exportData[activeTab] = codeEditor.value;
    if (editMode) destroyPrismLive();
    displayCode(btn.dataset.tab);
    if (editMode) { codeEditor.style.display = ''; createPrismLive(); }
  }));
  // code actions
  $('btn-edit').addEventListener('click', toggleEditMode);
  $('btn-copy').addEventListener('click', copyCurrent);
  $('btn-copy-ai').addEventListener('click', copyForAI);
  $('btn-ai-caret').addEventListener('click', (e) => { e.stopPropagation(); $('ai-menu').classList.toggle('open'); });
  document.addEventListener('click', (e) => { if (!$('ai-menu').contains(e.target) && e.target !== $('btn-ai-caret')) $('ai-menu').classList.remove('open'); });
  $('btn-download-current').addEventListener('click', () => downloadFile(activeTab));
  $('btn-download-all').addEventListener('click', downloadAll);
  $('btn-download-fonts').addEventListener('click', downloadFontsZip);
  codeEditor.addEventListener('input', () => { if (editMode && exportData) { exportData[activeTab] = codeEditor.value; scheduleRender(); } });
  // view tabs (Preview | Code) + fit/actual toggle
  document.querySelectorAll('.view-tab').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('btn-copy-ai-pv').addEventListener('click', copyForAI);
  $('btn-flip').addEventListener('click', () => { renderMode = renderMode === 'fit' ? 'actual' : 'fit'; $('btn-flip').querySelector('.material-symbols-outlined').textContent = renderMode === 'actual' ? 'crop_free' : 'fit_screen'; refitRender(); });
  // history
  $('history-clear').addEventListener('click', () => chrome.storage.local.set({ pluckHistory: [] }, () => renderHistory([])));
  // controls
  $('btn-select').addEventListener('click', toggleSelection);
  $('btn-export').addEventListener('click', doExport);
  $('btn-clear').addEventListener('click', () => { elprevSuppressed = false; getActiveTab((tab) => sendMessageToTab(tab, { type: 'CLEAR_SELECTION' }, () => { updateSelCount(0); updateElPreview(null); setStatus('Selection cleared', 'idle'); })); });
  $('btn-xray').addEventListener('click', () => getActiveTab((tab) => sendMessageToTab(tab, { type: 'TOGGLE_XRAY' }, (r) => { if (r) { xrayMode = r.xrayMode; $('btn-xray').classList.toggle('on', xrayMode); setStatus(xrayMode ? 'X-Ray active' : 'Ready to select', xrayMode ? 'active' : 'idle'); } })));
  $('btn-colorpick').addEventListener('click', () => { colorPickActive = !colorPickActive; $('btn-colorpick').classList.toggle('on', colorPickActive); getActiveTab((tab) => sendMessageToTab(tab, { type: 'TOGGLE_COLOR_PICK' }, (r) => { if (r && r.colorPickActive !== undefined) { colorPickActive = r.colorPickActive; $('btn-colorpick').classList.toggle('on', colorPickActive); } })); });
  // header
  $('btn-popout').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('panel.html?view=popout') }));
  $('btn-theme').addEventListener('click', () => { settings.theme = settings.theme === 'light' ? 'dark' : 'light'; applyTheme(); $('set-theme').value = settings.theme; saveSettings(); });
  $('btn-minimize').addEventListener('click', () => { chrome.storage.local.set({ pluckMinimized: true }, () => { try { window.close(); } catch (e) {} }); });
  $('btn-settings').addEventListener('click', () => $('settings').classList.add('open'));
  $('btn-settings-back').addEventListener('click', () => $('settings').classList.remove('open'));
  // settings selects
  $('set-autocopy').addEventListener('change', (e) => { settings.autoCopyFormat = e.target.value; saveSettings(); });
  $('set-aipreset').addEventListener('change', (e) => { settings.aiPreset = e.target.value; saveSettings(); buildAiMenu(); });
  $('set-theme').addEventListener('change', (e) => { settings.theme = e.target.value; applyTheme(); saveSettings(); });
  // shortcuts save/reset
  $('btn-save-sc').addEventListener('click', () => { const sc = getShortcutsFromUI(); chrome.storage.sync.set({ shortcuts: sc }, () => showToast('Shortcuts saved')); });
  $('btn-reset-sc').addEventListener('click', () => { loadShortcutsToUI(DEFAULT_SHORTCUTS); chrome.storage.sync.set({ shortcuts: DEFAULT_SHORTCUTS }, () => showToast('Shortcuts reset')); });

  // keyboard inside panel
  document.addEventListener('keydown', (e) => {
    const inEditor = editMode && document.activeElement === codeEditor;
    const inInput = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !inEditor && !inInput) { const sel = window.getSelection(); if (sel && sel.toString().length) return; e.preventDefault(); copyCurrent(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && !e.shiftKey) { e.preventDefault(); downloadFile(activeTab); }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); downloadAll(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'e') { e.preventDefault(); toggleEditMode(); }
    // Escape clears the page selection even when focus is in the dock (the page's
    // own Escape handler can't fire when the side panel has focus).
    if (e.key === 'Escape' && !inInput) {
      getActiveTab((tab) => sendMessageToTab(tab, { type: 'CLEAR_SELECTION' }, () => { setSelecting(false); updateSelCount(0); updateElPreview(null); setStatus('Selection cleared', 'idle'); }));
    }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && !inEditor && !inInput) {
      const map = { '1': 'html', '2': 'jsx', '3': 'css', '4': 'toon' };
      if (map[e.key] && exportData) { e.preventDefault(); if (editMode) { exportData[activeTab] = codeEditor.value; destroyPrismLive(); } displayCode(map[e.key]); if (editMode) { codeEditor.style.display = ''; createPrismLive(); } }
    }
  });

  // resize re-fit
  let rz = null;
  window.addEventListener('resize', () => { if (rz) clearTimeout(rz); rz = setTimeout(refitRender, 100); });

  // If a keyboard export couldn't auto-copy (panel wasn't focused), copy the
  // moment the dock gains focus — so "click the panel" just works.
  window.addEventListener('focus', async () => {
    if (!pendingCopy) return;
    if (await writeClipboard(pendingCopy)) { showToast(`${settings.autoCopyFormat.toUpperCase()} copied`); pendingCopy = null; }
  });

  // Show the loader the instant an export starts, from ANY trigger (button, ⌘⇧E,
  // command). loadExport() hides it when the result renders; the safety timeout
  // in setExporting covers the rare failure.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'EXPORT_STARTED') setExporting(true);
  });

  // react to new exports from anywhere
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.pluckExportData) {
      const d = changes.pluckExportData.newValue;
      if (d && d.exportedAt !== undefined && d.exportedAt !== lastExportedAt) {
        lastExportedAt = d.exportedAt;
        loadExport(d, { isNew: true });
      }
    }
    if (changes.pluckHistory) renderHistory(changes.pluckHistory.newValue || []);
  });
}

// ================= Init =================
function init() {
  loadSettings(() => {
    applyTheme();
    $('set-autocopy').value = settings.autoCopyFormat;
    $('set-aipreset').value = settings.aiPreset;
    $('set-theme').value = settings.theme;
    buildAiMenu();
  });
  buildShortcutEditor();
  chrome.storage.sync.get(['shortcuts'], (r) => loadShortcutsToUI(r.shortcuts || DEFAULT_SHORTCUTS));
  // The dock is open — clear the minimized flag so the page pill disappears.
  chrome.storage.local.set({ pluckMinimized: false });
  wire();

  if (isPopout) {
    document.body.classList.add('wide', 'sidebyside');
    $('controls').style.display = 'none';
    $('elprev').style.display = 'none';
    $('btn-popout').style.display = 'none';
    $('pane-code').classList.remove('hidden'); // show code + preview side by side
  }

  loadHistory();
  chrome.storage.local.get(['pluckExportData', 'pluckHandledAt'], (r) => {
    handledAt = r.pluckHandledAt != null ? r.pluckHandledAt : null;
    const d = r.pluckExportData;
    if (d && d.toon) {
      lastExportedAt = d.exportedAt !== undefined ? d.exportedAt : null;
      // If the dock was minimized/closed when this export happened, the live
      // listener never ran — so a recent, not-yet-handled export is "new" here
      // and should auto-copy + land in history on open.
      const recent = d.exportedAt != null && (Date.now() - d.exportedAt < 20000);
      const unhandled = d.exportedAt != null && d.exportedAt !== handledAt;
      loadExport(d, { isNew: recent && unhandled });
    }
  });

  if (!isPopout) { queryCurrentState(); startPolling(); }
}

init();
