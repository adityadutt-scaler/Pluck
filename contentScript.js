// --- State ---
let pickMode = false; applyPickCursor();
let xrayMode = false;
let hoverElement = null;
let selectedElements = new Set();
// Store clones at selection time to freeze dynamic content (like rotating ProTips)
let selectionClones = new Map(); // original element -> clone (captured at selection time)

// --- DOM navigation state ---
let isNavigating = false;
let navigatedElement = null;
let navBackStack = [];

// --- Export diagnostics ---
let _exportDiag = null;

// --- Tailwind mode (set in buildExport when source page uses Tailwind) ---
let _tailwindStyles = null;

// --- X-Ray Inspector State ---
let inspectorOverlay = null;
let inspectorHoverLabel = null;
let lastInspectedElement = null;
let inspectorUpdateScheduled = false;

// Note: Color Picker state is defined in the Color Picker section below

// Debug: Log when script loads
console.log('[Pluck] Content script loaded in frame:', window.location.href.substring(0, 100));

// --- Style Registry for deduplication ---
let styleRegistry = new Map(); // styleString -> styleName (s1, s2, etc.)
let hoverStyleRegistry = new Map(); // Maps base styleName -> hover styles object
let pseudoStyleRegistry = new Map(); // key -> { className, bundle: { before?, after? } }
let styleCounter = 0;
let pseudoCounter = 0;

function resetStyleRegistry() {
  styleRegistry.clear();
  hoverStyleRegistry.clear();
  pseudoStyleRegistry.clear();
  styleCounter = 0;
  pseudoCounter = 0;
  resetDetectedFonts();
}

function getOrCreatePseudoClass(bundle) {
  const key = JSON.stringify(bundle);
  const existing = pseudoStyleRegistry.get(key);
  if (existing) return existing.className;
  const className = `p${++pseudoCounter}`;
  pseudoStyleRegistry.set(key, { className, bundle });
  return className;
}

function getOrCreateStyleName(styleObj) {
  const key = JSON.stringify(styleObj);
  if (styleRegistry.has(key)) {
    return styleRegistry.get(key);
  }
  const name = `s${++styleCounter}`;
  styleRegistry.set(key, name);
  return name;
}

function registerHoverStyle(styleName, hoverObj) {
  if (hoverObj && Object.keys(hoverObj).length > 0) {
    hoverStyleRegistry.set(styleName, hoverObj);
  }
}

// --- Shadow DOM helpers ---
// For closed shadow DOM, we can access elements via composedPath() during events
// but we can't traverse into them programmatically. However, we CAN select
// the elements inside and export them using the event path.

function getShadowRoot(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
  // Only open shadow roots are accessible
  if (el.shadowRoot) return el.shadowRoot;
  return null;
}

// Get the shadow root containing an element (if any) by walking up
function getContainingShadowRoot(el) {
  let node = el;
  while (node) {
    if (node.parentNode && node.parentNode.host) {
      // We're inside a shadow root
      return node.parentNode;
    }
    node = node.parentNode;
  }
  return null;
}

// Track shadow roots we've injected styles into
const injectedShadowRoots = new WeakSet();

// --- Inject helper styles (works for both document and shadow roots) ---
function injectHelperStyles(root = document) {
  const styleId = "web-replica-helper-style";

  // Check if already injected
  if (root === document) {
    if (document.getElementById(styleId)) return;
  } else {
    // For shadow roots, check via querySelector
    if (root.querySelector && root.querySelector(`#${styleId}`)) return;
  }

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    .web-replica-hover {
      outline: 2px solid red !important;
    }
    .web-replica-selected {
      outline: 3px solid blue !important;
    }
    /* Cursor needs a boosted-specificity selector: apps like Notion set
       cursor:text !important on contenteditable areas, which beats a
       single-class rule even when both are !important. Repeating the class
       raises specificity above any realistic page selector. */
    .web-replica-hover.web-replica-hover.web-replica-hover.web-replica-hover.web-replica-hover,
    .web-replica-selected.web-replica-selected.web-replica-selected.web-replica-selected.web-replica-selected {
      cursor: crosshair !important;
    }
    /* While picking, force the crosshair page-wide so it applies immediately —
       even when pick mode starts while the mouse is sitting still on a
       cursor:pointer element (no mouseover fires to add .web-replica-hover). */
    html.pluck-picking, html.pluck-picking * { cursor: crosshair !important; }
    /* X-Ray mode - rainbow outlines for layout visualization */
    .pluck-xray * { outline: 1px solid rgba(255, 127, 0, 0.75) !important; }
    .pluck-xray *:nth-child(2n) { outline-color: rgba(255, 127, 0, 0.75) !important; }
    .pluck-xray *:nth-child(3n) { outline-color: rgba(255, 255, 0, 0.75) !important; }
    .pluck-xray *:nth-child(4n) { outline-color: rgba(0, 255, 0, 0.75) !important; }
    .pluck-xray *:nth-child(5n) { outline-color: rgba(0, 0, 255, 0.75) !important; }
    .pluck-xray *:nth-child(6n) { outline-color: rgba(75, 0, 130, 0.75) !important; }
    .pluck-xray *:nth-child(7n) { outline-color: rgba(148, 0, 211, 0.75) !important; }
  `;

  if (root === document) {
    document.documentElement.appendChild(style);
  } else if (root.appendChild) {
    root.appendChild(style);
  }
}

// Toggle the page-wide picking crosshair to match pickMode. Called wherever
// pickMode changes (see the appended applyPickCursor() calls).
function applyPickCursor() {
  try { if (document.documentElement) document.documentElement.classList.toggle('pluck-picking', !!pickMode); } catch (e) {}
  // Selection on → flag the dock to minimize (frees the viewport); it reopens on export.
  // Central here so every trigger is covered; top frame only.
  if (pickMode && window.top === window) {
    try { chrome.storage.local.set({ pluckMinimized: true }); } catch (e) {}
  }
}

function ensureStylesInShadow(el) {
  // Check if element has an open shadow root
  const shadowRoot = getShadowRoot(el);
  if (shadowRoot && !injectedShadowRoots.has(shadowRoot)) {
    injectHelperStyles(shadowRoot);
    injectedShadowRoots.add(shadowRoot);
  }
}

// Inject styles into shadow root found in event path
function ensureStylesInEventPath(path) {
  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    // Check if this is a ShadowRoot (has host property)
    if (node && node.host && !injectedShadowRoots.has(node)) {
      injectHelperStyles(node);
      injectedShadowRoots.add(node);
    }
    // Also check for open shadow roots on elements
    if (node && node.nodeType === Node.ELEMENT_NODE) {
      ensureStylesInShadow(node);
    }
  }
}

// Inject styles into document on load
(function() {
  injectHelperStyles(document);
})();

// Expand a leaf click to its nearest visually-distinct ancestor. Alt-click bypasses.
function expandToMeaningfulContainer(el) {
  if (!el || !el.tagName) return el;
  const tag = el.tagName.toLowerCase();

  if (['div', 'section', 'article', 'aside', 'nav', 'header', 'footer',
       'main', 'form', 'fieldset', 'ul', 'ol', 'table', 'tbody', 'thead',
       'tr'].includes(tag)) {
    return el;
  }

  const cs = window.getComputedStyle(el);

  if ((tag === 'button' || tag === 'a') &&
      (cs.position === 'absolute' || cs.position === 'fixed')) {
    const op = el.offsetParent;
    if (op && op !== document.body && op !== document.documentElement) {
      const elArea = el.offsetWidth * el.offsetHeight;
      const opArea = op.offsetWidth * op.offsetHeight;
      if (opArea >= elArea * 1.05) return op;
    }
  }

  const isLeafish = ['input', 'select', 'textarea', 'button', 'a', 'span',
                     'img', 'svg', 'label', 'i', 'em', 'strong', 'p',
                     'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag);
  if (!isLeafish) return el;

  const startW = el.offsetWidth || el.getBoundingClientRect().width;
  const startH = el.offsetHeight || el.getBoundingClientRect().height;
  const startArea = startW * startH;
  if (!startArea) return el;

  const vpArea = window.innerWidth * window.innerHeight;
  const maxArea = vpArea * 0.4;
  const minGrowth = 1.2;

  let current = el.parentElement;
  let depth = 0;
  let bestMatch = null;

  while (current && current !== document.body && current !== document.documentElement && depth < 8) {
    const ccs = window.getComputedStyle(current);
    const cArea = current.offsetWidth * current.offsetHeight;

    if (cArea > maxArea) break;
    if (cArea < startArea * minGrowth) {
      current = current.parentElement;
      depth++;
      continue;
    }

    const hasBg = ccs.backgroundColor && ccs.backgroundColor !== 'rgba(0, 0, 0, 0)' && ccs.backgroundColor !== 'transparent';
    const hasBorder = parseFloat(ccs.borderTopWidth) > 0 || parseFloat(ccs.borderLeftWidth) > 0;
    const hasRadius = parseFloat(ccs.borderTopLeftRadius) > 0;
    const hasShadow = ccs.boxShadow && ccs.boxShadow !== 'none';
    const hasPadding = parseFloat(ccs.paddingTop) >= 4 || parseFloat(ccs.paddingLeft) >= 4;
    const isVisuallyDistinct = hasBg || hasBorder || hasRadius || hasShadow || hasPadding;

    const ctag = current.tagName.toLowerCase();
    const isStructural = ['form', 'fieldset', 'label', 'li', 'tr', 'article',
                          'section', 'header', 'footer', 'aside', 'nav'].includes(ctag);

    if (isVisuallyDistinct || isStructural) {
      bestMatch = current;
      return current;
    }

    current = current.parentElement;
    depth++;
  }

  return bestMatch || el;
}

// --- Navigation helpers (parent/child walk + Shadow DOM aware) ---
const SKIP_NAV_TAGS = new Set(['head', 'script', 'style', 'link', 'meta', 'noscript', 'br', 'hr']);

function getNavParent(el) {
  if (!el) return null;
  if (el === document.documentElement) return null;
  if (el.parentElement) return el.parentElement;
  if (el.parentNode && el.parentNode.host) return el.parentNode.host;
  if (el.parentNode === document) return document.documentElement;
  return null;
}

function getFirstNavChild(el) {
  if (!el) return null;
  if (el === document.documentElement) return document.body;
  const shadowRoot = getShadowRoot(el);
  const children = shadowRoot ? shadowRoot.children : el.children;
  if (!children || children.length === 0) return null;
  for (const child of children) {
    if (!SKIP_NAV_TAGS.has(child.tagName.toLowerCase())) return child;
  }
  return null;
}

function describeElement(el) {
  if (!el || !el.tagName) return '';
  let s = el.tagName.toLowerCase();
  if (el.id) s += `#${el.id}`;
  if (el.className && typeof el.className === 'string') {
    const cls = el.className.split(/\s+/).filter(c => c && !c.startsWith('web-replica-')).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
  }
  return s;
}

// --- Hover handling (with Shadow DOM support) ---
document.addEventListener(
  "mouseover",
  (e) => {
    if (!pickMode) return;

    // Use composedPath to get actual target inside Shadow DOM
    const path = e.composedPath();
    const actualTarget = path[0];

    // Inject styles into any shadow roots along the path (including closed ones!)
    ensureStylesInEventPath(path);

    // Keep the keyboard-navigated target sticky; mouseover would otherwise snap back to the deepest child.
    if (isNavigating) {
      if (actualTarget === navigatedElement) return;
      if (navigatedElement && navigatedElement.contains(actualTarget)) return;
      isNavigating = false;
      navigatedElement = null;
      navBackStack = [];
    }

    if (hoverElement && hoverElement !== actualTarget) {
      if (hoverElement.classList) {
        hoverElement.classList.remove("web-replica-hover");
      }
    }
    hoverElement = actualTarget;
    if (hoverElement && hoverElement.classList) {
      hoverElement.classList.add("web-replica-hover");
    }
  },
  true
);

document.addEventListener(
  "mouseout",
  (e) => {
    if (!pickMode) return;

    if (isNavigating && navigatedElement) {
      const rel = e.relatedTarget;
      if (rel && (rel === navigatedElement || navigatedElement.contains(rel))) return;
      if (hoverElement && hoverElement.classList) {
        hoverElement.classList.remove("web-replica-hover");
      }
      hoverElement = null;
      isNavigating = false;
      navigatedElement = null;
      navBackStack = [];
      return;
    }

    const actualTarget = e.composedPath()[0];
    if (actualTarget === hoverElement) {
      if (hoverElement && hoverElement.classList) {
        hoverElement.classList.remove("web-replica-hover");
      }
      hoverElement = null;
    }
  },
  true
);

// --- Utility: select/deselect element ---
function toggleElement(el, shouldSelect) {
  if (!el || !el.classList) {
    console.log('[Pluck] Cannot select element - no classList:', el);
    return;
  }
  if (shouldSelect) {
    el.classList.add("web-replica-selected");
    selectedElements.add(el);
    // IMPORTANT: Clone immediately at selection time to freeze dynamic content
    // This captures the exact DOM state the user sees when they click
    const clone = el.cloneNode(true);
    selectionClones.set(el, clone);
    const inShadow = getContainingShadowRoot(el) ? 'YES' : 'NO';
    console.log('[Pluck] Selected element:', el.tagName, 'In Shadow DOM:', inShadow, 'Total:', selectedElements.size);
  } else {
    el.classList.remove("web-replica-selected");
    selectedElements.delete(el);
    selectionClones.delete(el);
    console.log('[Pluck] Deselected element, remaining:', selectedElements.size);
  }
}

// --- Click handling (with Shadow DOM support) ---
document.addEventListener(
  "mousedown",
  (e) => {
    if (!pickMode) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Use composedPath to get actual target inside Shadow DOM
    const path = e.composedPath();
    ensureStylesInEventPath(path);

    // Alt/Shift bypass smart-expansion; otherwise expand to the nearest container.
    let el;
    if (isNavigating && navigatedElement) {
      el = navigatedElement;
    } else if (e.altKey || e.shiftKey) {
      el = path[0];
    } else {
      el = expandToMeaningfulContainer(path[0]);
    }

    isNavigating = false;
    navigatedElement = null;
    navBackStack = [];

    if (!el || !el.classList) return;

    if (!e.shiftKey && !selectedElements.has(el)) {
      selectedElements.forEach((sel) =>
        sel.classList.remove("web-replica-selected")
      );
      selectedElements.clear();
      selectionClones.clear();
    }

    if (selectedElements.has(el)) {
      toggleElement(el, false);
    } else {
      toggleElement(el, true);
    }
  },
  true
);

document.addEventListener(
  "click",
  (e) => {
    if (!pickMode) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  },
  true
);

// --- Keyboard shortcuts (customizable) ---
// Default shortcuts - will be overridden by stored settings
let shortcuts = {
  startSelect: { ctrl: true, shift: true, alt: false, key: 'S' },
  clearSelect: { ctrl: false, shift: false, alt: false, key: 'Escape' },
  export: { ctrl: true, shift: true, alt: false, key: 'E' },
  xray: { ctrl: true, shift: true, alt: false, key: 'X' },
  colorPick: { ctrl: true, shift: true, alt: false, key: 'P' },
  extractPage: { ctrl: true, shift: true, alt: false, key: 'F' }
};

// Load shortcuts from storage (with context check)
try {
  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(['shortcuts'], (result) => {
      if (chrome.runtime.lastError) return;
      if (result.shortcuts) {
        // Merge with defaults to ensure new shortcuts like colorPick exist
        shortcuts = { ...shortcuts, ...result.shortcuts };
        console.log('[Pluck] Loaded custom shortcuts:', shortcuts);
      }
    });
  }
} catch (e) {
  console.log('[Pluck] Could not load shortcuts:', e.message);
}

// Listen for shortcut updates from popup (with context check)
try {
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.shortcuts) {
        // Merge with current shortcuts to preserve defaults
        shortcuts = { ...shortcuts, ...changes.shortcuts.newValue };
        console.log('[Pluck] Shortcuts updated:', shortcuts);
      }
    });
  }
} catch (e) {
  console.log('[Pluck] Could not add storage listener:', e.message);
}

const isMac = navigator.userAgent.toUpperCase().includes('MAC');

// Check if a keyboard event matches a shortcut
// On Mac, Cmd (metaKey) is used instead of Ctrl
function matchesShortcut(e, shortcut) {
  if (!e || !e.key || !shortcut || !shortcut.key) return false;
  const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase() ||
                   e.key === shortcut.key;
  // On Mac, use Cmd (metaKey) when shortcut specifies ctrl
  // On Windows/Linux, use Ctrl as normal
  const ctrlMatch = isMac
    ? (e.metaKey === shortcut.ctrl)  // Mac: Cmd key
    : (e.ctrlKey === shortcut.ctrl); // Windows/Linux: Ctrl key
  return keyMatch &&
         ctrlMatch &&
         e.shiftKey === shortcut.shift &&
         e.altKey === shortcut.alt;
}

// Check if extension context is still valid
function isExtensionContextValid() {
  try {
    return chrome.runtime && chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// Download files via background script (bypasses CSP restrictions)
function downloadFiles(toonContent, htmlContent, filename = 'component') {
  if (!isExtensionContextValid()) {
    console.warn("[Pluck] Extension context invalidated. Please refresh the page.");
    alert("Pluck: Extension was reloaded. Please refresh this page to continue using the extension.");
    return;
  }

  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_FILES',
    toon: toonContent,
    html: htmlContent,
    filename: filename
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("[Pluck] Download error:", chrome.runtime.lastError);
    } else {
      console.log("[Pluck] Download initiated via background script");
    }
  });
}

// Perform export action with optional custom filename
async function performExport(filename = 'component') {
  console.log("[Pluck] Export triggered, selected:", selectedElements.size);
  if (selectedElements.size > 0) {
    const result = await buildExport();
    if (result && result.toon && result.html) {
      console.log("[Pluck] Export data generated, downloading...");

      // Download both files via background script with custom filename
      downloadFiles(result.toon, result.html, filename);

      console.log("[Pluck] Export complete");
      return true;
    } else {
      console.log("[Pluck] buildExport returned null or incomplete");
    }
  } else {
    console.log("[Pluck] No elements selected for export");
  }
  return false;
}

// Show filename prompt modal on the page
function showFilenamePrompt() {
  // Stop selection mode while export modal is open
  if (pickMode) {
    pickMode = false; applyPickCursor();
    if (hoverElement) {
      hoverElement.classList.remove("web-replica-hover");
      hoverElement = null;
    }
  }

  // Remove existing modal if any
  const existing = document.getElementById('pluck-export-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'pluck-export-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, sans-serif;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: #1a1a2e;
    border-radius: 12px;
    padding: 24px;
    width: 300px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  `;

  content.innerHTML = `
    <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #fff;">Export Component</h3>
    <p style="margin: 0 0 16px 0; font-size: 12px; color: #888;">Enter a name for your exported files</p>
    <input type="text" id="pluck-filename-input" value="component" style="
      width: 100%;
      padding: 10px 12px;
      background: #0f0f1a;
      border: 2px solid #333;
      border-radius: 6px;
      font-size: 14px;
      color: #fff;
      outline: none;
      box-sizing: border-box;
    ">
    <div id="pluck-filename-preview" style="
      margin-top: 8px;
      padding: 8px;
      background: #0f0f1a;
      border-radius: 6px;
      font-size: 11px;
      color: #666;
      font-family: monospace;
    ">component.html, component.toon</div>
    <div style="display: flex; gap: 8px; margin-top: 16px;">
      <button id="pluck-cancel-btn" style="
        flex: 1;
        padding: 10px;
        background: #333;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        color: #aaa;
        cursor: pointer;
      ">Cancel</button>
      <button id="pluck-export-btn" style="
        flex: 1;
        padding: 10px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        color: #fff;
        cursor: pointer;
      ">Export</button>
    </div>
  `;

  modal.appendChild(content);
  document.body.appendChild(modal);

  const input = document.getElementById('pluck-filename-input');
  const preview = document.getElementById('pluck-filename-preview');
  const cancelBtn = document.getElementById('pluck-cancel-btn');
  const exportBtn = document.getElementById('pluck-export-btn');

  // Focus and select input
  input.focus();
  input.select();

  // Update preview on input
  input.addEventListener('input', () => {
    const name = input.value.replace(/[<>:"/\\|?*]/g, '').trim() || 'component';
    preview.textContent = `${name}.html, ${name}.toon`;
  });

  // Handle input focus styling
  input.addEventListener('focus', () => {
    input.style.borderColor = '#667eea';
  });
  input.addEventListener('blur', () => {
    input.style.borderColor = '#333';
  });

  // Close modal function
  const closeModal = () => {
    modal.remove();
  };

  // Export function
  const doExport = () => {
    const filename = input.value.replace(/[<>:"/\\|?*]/g, '').trim() || 'component';
    closeModal();
    showModeIndicator('Exporting...');
    const success = performExport(filename);
    if (success) {
      setTimeout(() => showModeIndicator('Exported!'), 100);
    } else {
      showModeIndicator('Export failed');
    }
  };

  // Event listeners
  cancelBtn.addEventListener('click', closeModal);
  exportBtn.addEventListener('click', doExport);

  // Keyboard handlers
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doExport();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
    e.stopPropagation();
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Prevent keydown from propagating to page
  modal.addEventListener('keydown', (e) => {
    e.stopPropagation();
  });
}

// Visual feedback for selection mode
function showModeIndicator(message) {
  let indicator = document.getElementById('pluck-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'pluck-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: #4a90d9;
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: opacity 0.3s;
    `;
    document.body.appendChild(indicator);
  }
  indicator.textContent = message;
  indicator.style.opacity = '1';

  // Auto-hide after 2 seconds
  clearTimeout(indicator._timeout);
  indicator._timeout = setTimeout(() => {
    indicator.style.opacity = '0';
  }, 2000);
}

// --- X-Ray Inspector Overlay Functions ---

// Get element metadata (tag, classes, id)
function getInspectorElementInfo(element) {
  if (!element || !element.tagName) return null;
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || '',
    classList: Array.from(element.classList || [])
      .filter(c => !c.startsWith('web-replica-') && !c.startsWith('pluck-'))
      .join(' ')
  };
}

// Build DOM tree path from element to html root
function buildInspectorDOMPath(element) {
  const path = [];
  let current = element;

  while (current && current !== document.documentElement && current !== document) {
    const node = {
      tag: current.tagName ? current.tagName.toLowerCase() : 'unknown',
      id: current.id || null,
      classList: Array.from(current.classList || [])
        .filter(c => !c.startsWith('web-replica-') && !c.startsWith('pluck-'))
        .slice(0, 2) // Limit to first 2 classes for brevity
    };
    path.unshift(node);

    // Handle Shadow DOM - get parent or shadow host
    current = current.parentElement ||
              (current.parentNode && current.parentNode.host) ||
              current.parentNode;
  }

  // Add html root
  path.unshift({ tag: 'html', id: null, classList: [] });

  return path;
}

// Get all dimension values
function getInspectorDimensions(element) {
  if (!element) return null;

  const computed = window.getComputedStyle(element);

  return {
    // Client dimensions (content + padding, no border/scrollbar)
    clientWidth: element.clientWidth || 0,
    clientHeight: element.clientHeight || 0,

    // Offset dimensions (content + padding + border + scrollbar)
    offsetWidth: element.offsetWidth || 0,
    offsetHeight: element.offsetHeight || 0,

    // Scroll dimensions (total scrollable area)
    scrollWidth: element.scrollWidth || 0,
    scrollHeight: element.scrollHeight || 0,

    // Box model values
    margin: {
      top: Math.round(parseFloat(computed.marginTop) || 0),
      right: Math.round(parseFloat(computed.marginRight) || 0),
      bottom: Math.round(parseFloat(computed.marginBottom) || 0),
      left: Math.round(parseFloat(computed.marginLeft) || 0)
    },
    border: {
      top: Math.round(parseFloat(computed.borderTopWidth) || 0),
      right: Math.round(parseFloat(computed.borderRightWidth) || 0),
      bottom: Math.round(parseFloat(computed.borderBottomWidth) || 0),
      left: Math.round(parseFloat(computed.borderLeftWidth) || 0)
    },
    padding: {
      top: Math.round(parseFloat(computed.paddingTop) || 0),
      right: Math.round(parseFloat(computed.paddingRight) || 0),
      bottom: Math.round(parseFloat(computed.paddingBottom) || 0),
      left: Math.round(parseFloat(computed.paddingLeft) || 0)
    },
    content: {
      width: Math.round((element.clientWidth || 0) -
             (parseFloat(computed.paddingLeft) || 0) -
             (parseFloat(computed.paddingRight) || 0)),
      height: Math.round((element.clientHeight || 0) -
              (parseFloat(computed.paddingTop) || 0) -
              (parseFloat(computed.paddingBottom) || 0))
    }
  };
}

// Create the inspector overlay with Shadow DOM for style isolation
function createInspectorOverlay() {
  if (inspectorOverlay) return;

  inspectorOverlay = document.createElement('div');
  inspectorOverlay.id = 'pluck-inspector-overlay';

  // Create shadow root for style isolation
  const shadow = inspectorOverlay.attachShadow({ mode: 'open' });

  // Inject isolated styles
  const style = document.createElement('style');
  style.textContent = `
    :host {
      position: fixed !important;
      bottom: 0 !important;
      left: 0 !important;
      right: 0 !important;
      z-index: 2147483647 !important;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif !important;
      font-size: 12px !important;
      pointer-events: none !important;
    }

    .inspector-panel {
      background: rgba(30, 30, 30, 0.95);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      color: #e0e0e0;
      padding: 12px 16px;
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      max-height: 280px;
      overflow: auto;
    }

    .info-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .element-info {
      font-size: 11px;
      color: #aaa;
    }

    .element-info .node-name {
      color: #89c4f4;
      font-weight: 600;
    }

    .element-info .class-name {
      color: #c3e88d;
    }

    .element-info .id-name {
      color: #ffcb6b;
    }

    .dom-path {
      font-size: 10px;
      color: #888;
      line-height: 1.6;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .dom-path .path-node {
      color: #aaa;
      padding: 1px 3px;
      border-radius: 2px;
      background: rgba(255,255,255,0.05);
    }

    .dom-path .path-node.current {
      color: #89c4f4;
      background: rgba(137, 196, 244, 0.15);
      font-weight: 600;
    }

    .dom-path .path-separator {
      color: #555;
      margin: 0 2px;
    }

    .dimensions-section {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px 16px;
      font-size: 11px;
      align-content: start;
    }

    .dim-item {
      display: flex;
      gap: 6px;
    }

    .dim-label {
      color: #888;
    }

    .dim-value {
      color: #89c4f4;
      font-weight: 500;
      font-family: monospace;
    }

    .box-model-section {
      width: 180px;
      flex-shrink: 0;
    }

    .box-model-title {
      font-size: 10px;
      color: #666;
      margin-bottom: 6px;
      text-align: center;
    }

    .box-model-diagram {
      width: 180px;
      height: 120px;
      font-size: 9px;
      text-align: center;
      position: relative;
    }

    .box-margin {
      position: absolute;
      inset: 0;
      background: rgba(255, 166, 87, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px dashed rgba(255, 166, 87, 0.5);
    }

    .box-border {
      position: absolute;
      inset: 16px;
      background: rgba(253, 212, 92, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px dashed rgba(253, 212, 92, 0.5);
    }

    .box-padding {
      position: absolute;
      inset: 14px;
      background: rgba(195, 232, 141, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px dashed rgba(195, 232, 141, 0.5);
    }

    .box-content {
      position: absolute;
      inset: 14px;
      background: rgba(137, 196, 244, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      color: #89c4f4;
      font-size: 10px;
    }

    .box-label {
      position: absolute;
      font-size: 8px;
      color: #666;
    }

    .margin-label { top: 2px; left: 4px; color: rgba(255, 166, 87, 0.8); }
    .border-label { top: 2px; left: 4px; color: rgba(253, 212, 92, 0.8); }
    .padding-label { top: 2px; left: 4px; color: rgba(195, 232, 141, 0.8); }

    .box-value {
      position: absolute;
      color: #999;
      font-size: 8px;
      font-family: monospace;
    }

    .box-margin > .box-value.top { top: 2px; left: 50%; transform: translateX(-50%); }
    .box-margin > .box-value.right { right: 2px; top: 50%; transform: translateY(-50%); }
    .box-margin > .box-value.bottom { bottom: 2px; left: 50%; transform: translateX(-50%); }
    .box-margin > .box-value.left { left: 2px; top: 50%; transform: translateY(-50%); }

    .box-border > .box-value.top { top: 0px; left: 50%; transform: translateX(-50%); }
    .box-border > .box-value.right { right: 0px; top: 50%; transform: translateY(-50%); }
    .box-border > .box-value.bottom { bottom: 0px; left: 50%; transform: translateX(-50%); }
    .box-border > .box-value.left { left: 0px; top: 50%; transform: translateY(-50%); }

    .box-padding > .box-value.top { top: 0px; left: 50%; transform: translateX(-50%); }
    .box-padding > .box-value.right { right: 0px; top: 50%; transform: translateY(-50%); }
    .box-padding > .box-value.bottom { bottom: 0px; left: 50%; transform: translateX(-50%); }
    .box-padding > .box-value.left { left: 0px; top: 50%; transform: translateY(-50%); }

    .close-btn {
      position: absolute;
      top: 8px;
      right: 12px;
      width: 24px;
      height: 24px;
      border: none;
      background: rgba(255, 255, 255, 0.1);
      color: #aaa;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      line-height: 1;
      pointer-events: auto;
      transition: background 0.15s, color 0.15s;
    }

    .close-btn:hover {
      background: rgba(255, 80, 80, 0.3);
      color: #ff6b6b;
    }

    .inspector-panel {
      position: relative;
    }
  `;

  shadow.appendChild(style);

  // Create panel structure
  const panel = document.createElement('div');
  panel.className = 'inspector-panel';
  panel.innerHTML = `
    <button class="close-btn" id="close-xray" title="Close X-Ray Mode">✕</button>
    <div class="info-section">
      <div class="element-info" id="element-info">Hover over an element...</div>
      <div class="dom-path" id="dom-path"></div>
    </div>
    <div class="dimensions-section" id="dimensions">
      <div class="dim-item"><span class="dim-label">Client Height:</span> <span class="dim-value" id="client-h">-</span></div>
      <div class="dim-item"><span class="dim-label">Offset height:</span> <span class="dim-value" id="offset-h">-</span></div>
      <div class="dim-item"><span class="dim-label">Client Width:</span> <span class="dim-value" id="client-w">-</span></div>
      <div class="dim-item"><span class="dim-label">Offset Width:</span> <span class="dim-value" id="offset-w">-</span></div>
      <div class="dim-item"><span class="dim-label">Scroll height:</span> <span class="dim-value" id="scroll-h">-</span></div>
      <div class="dim-item"><span class="dim-label">Scroll Width:</span> <span class="dim-value" id="scroll-w">-</span></div>
    </div>
    <div class="box-model-section">
      <div class="box-model-title">Layout:</div>
      <div class="box-model-diagram">
        <div class="box-margin">
          <span class="box-label margin-label">margin</span>
          <span class="box-value top" id="m-top">-</span>
          <span class="box-value right" id="m-right">-</span>
          <span class="box-value bottom" id="m-bottom">-</span>
          <span class="box-value left" id="m-left">-</span>
          <div class="box-border">
            <span class="box-label border-label">border</span>
            <span class="box-value top" id="b-top">-</span>
            <span class="box-value right" id="b-right">-</span>
            <span class="box-value bottom" id="b-bottom">-</span>
            <span class="box-value left" id="b-left">-</span>
            <div class="box-padding">
              <span class="box-label padding-label">padding</span>
              <span class="box-value top" id="p-top">-</span>
              <span class="box-value right" id="p-right">-</span>
              <span class="box-value bottom" id="p-bottom">-</span>
              <span class="box-value left" id="p-left">-</span>
              <div class="box-content" id="content-size">- × -</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  shadow.appendChild(panel);
  document.body.appendChild(inspectorOverlay);

  // Add close button click handler - hides the panel but keeps X-Ray mode active
  const closeBtn = shadow.getElementById('close-xray');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Just hide the inspector panel, don't turn off X-Ray mode
      inspectorOverlay.style.display = 'none';
    });
  }
}

// Destroy the inspector overlay
function destroyInspectorOverlay() {
  if (inspectorOverlay) {
    inspectorOverlay.remove();
    inspectorOverlay = null;
  }
  destroyHoverLabel();
  lastInspectedElement = null;
}

// Create the hover label that follows the cursor/element
function createHoverLabel() {
  if (inspectorHoverLabel) return;

  inspectorHoverLabel = document.createElement('div');
  inspectorHoverLabel.id = 'pluck-hover-label';

  // Use setProperty for proper !important handling
  const s = inspectorHoverLabel.style;
  s.setProperty('position', 'fixed', 'important');
  s.setProperty('z-index', '2147483647', 'important');
  s.setProperty('background', 'rgba(30, 30, 30, 0.95)', 'important');
  s.setProperty('color', '#e0e0e0', 'important');
  s.setProperty('padding', '4px 8px', 'important');
  s.setProperty('border-radius', '4px', 'important');
  s.setProperty('font-family', 'system-ui, -apple-system, sans-serif', 'important');
  s.setProperty('font-size', '11px', 'important');
  s.setProperty('pointer-events', 'none', 'important');
  s.setProperty('white-space', 'nowrap', 'important');
  s.setProperty('box-shadow', '0 2px 8px rgba(0,0,0,0.3)', 'important');
  s.setProperty('border', '1px solid rgba(255,255,255,0.1)', 'important');
  s.setProperty('display', 'none', 'important');
  s.setProperty('left', '0px', 'important');
  s.setProperty('top', '0px', 'important');

  document.body.appendChild(inspectorHoverLabel);
  console.log('[Pluck] Hover label created');
}

// Destroy the hover label
function destroyHoverLabel() {
  if (inspectorHoverLabel) {
    inspectorHoverLabel.remove();
    inspectorHoverLabel = null;
    console.log('[Pluck] Hover label destroyed');
  }
}

// Update hover label position and content
function updateHoverLabel(element, mouseX, mouseY) {
  if (!inspectorHoverLabel || !element) return;

  const info = getInspectorElementInfo(element);
  if (!info) {
    inspectorHoverLabel.style.setProperty('display', 'none', 'important');
    return;
  }

  // Build label text: tag.class#id dimensions
  let labelText = info.tagName;
  if (info.classList) {
    // Show first class only to keep it short
    const firstClass = info.classList.split(' ')[0];
    if (firstClass) labelText += `.${firstClass}`;
  }
  if (info.id) labelText += `#${info.id}`;

  // Add dimensions
  const width = element.offsetWidth || 0;
  const height = element.offsetHeight || 0;
  labelText += ` | ${width} × ${height}`;

  inspectorHoverLabel.textContent = labelText;

  // Show the label
  inspectorHoverLabel.style.setProperty('display', 'block', 'important');

  // Position near mouse, but offset to not cover cursor
  let left = mouseX + 15;
  let top = mouseY + 15;

  // Get label dimensions after content update
  const labelWidth = inspectorHoverLabel.offsetWidth || 100;
  const labelHeight = inspectorHoverLabel.offsetHeight || 20;

  // Keep within viewport
  if (left + labelWidth > window.innerWidth - 10) {
    left = mouseX - labelWidth - 15;
  }
  if (top + labelHeight > window.innerHeight - 10) {
    top = mouseY - labelHeight - 15;
  }

  // Ensure not negative
  left = Math.max(5, left);
  top = Math.max(5, top);

  inspectorHoverLabel.style.setProperty('left', `${left}px`, 'important');
  inspectorHoverLabel.style.setProperty('top', `${top}px`, 'important');
}

// Hide the hover label
function hideHoverLabel() {
  if (inspectorHoverLabel) {
    inspectorHoverLabel.style.setProperty('display', 'none', 'important');
  }
}

// Update the inspector overlay with element data
function updateInspectorOverlay(element) {
  if (!inspectorOverlay || !element) return;
  if (element === lastInspectedElement) return;
  if (inspectorUpdateScheduled) return;

  inspectorUpdateScheduled = true;
  requestAnimationFrame(() => {
    performInspectorUpdate(element);
    lastInspectedElement = element;
    inspectorUpdateScheduled = false;
  });
}

function performInspectorUpdate(element) {
  if (!inspectorOverlay || !element) return;

  const shadow = inspectorOverlay.shadowRoot;
  if (!shadow) return;

  // Get element info
  const info = getInspectorElementInfo(element);
  if (!info) return;

  // Update element info line
  const infoEl = shadow.getElementById('element-info');
  if (infoEl) {
    let infoText = `You're hovering on = { node: <span class="node-name">${info.tagName}</span>; `;
    infoText += `classes: <span class="class-name">${info.classList || '(none)'}</span>; `;
    infoText += `id: <span class="id-name">${info.id || '(none)'}</span>; }`;
    infoEl.innerHTML = infoText;
  }

  // Update DOM path
  const pathEl = shadow.getElementById('dom-path');
  if (pathEl) {
    const path = buildInspectorDOMPath(element);
    const pathHTML = path.map((node, i) => {
      let selector = node.tag;
      if (node.id) selector += `#${node.id}`;
      else if (node.classList.length) selector += `.${node.classList[0]}`;
      const isCurrent = i === path.length - 1;
      return `<span class="path-node ${isCurrent ? 'current' : ''}">${selector}</span>`;
    }).join('<span class="path-separator">→</span>');
    pathEl.innerHTML = `DOM tree: ${pathHTML}`;
  }

  // Update dimensions
  const dims = getInspectorDimensions(element);
  if (dims) {
    const setVal = (id, val) => {
      const el = shadow.getElementById(id);
      if (el) el.textContent = val;
    };

    setVal('client-h', dims.clientHeight);
    setVal('client-w', dims.clientWidth);
    setVal('offset-h', dims.offsetHeight);
    setVal('offset-w', dims.offsetWidth);
    setVal('scroll-h', dims.scrollHeight);
    setVal('scroll-w', dims.scrollWidth);

    // Box model values
    setVal('m-top', dims.margin.top);
    setVal('m-right', dims.margin.right);
    setVal('m-bottom', dims.margin.bottom);
    setVal('m-left', dims.margin.left);

    setVal('b-top', dims.border.top);
    setVal('b-right', dims.border.right);
    setVal('b-bottom', dims.border.bottom);
    setVal('b-left', dims.border.left);

    setVal('p-top', dims.padding.top);
    setVal('p-right', dims.padding.right);
    setVal('p-bottom', dims.padding.bottom);
    setVal('p-left', dims.padding.left);

    setVal('content-size', `w:${dims.content.width} × h:${dims.content.height}`);
  }
}

// Handle hover for inspector overlay
function handleInspectorHover(e) {
  if (!xrayMode) return;

  const target = e.composedPath()[0];
  // Skip if hovering over the inspector overlay itself or hover label
  if (!target || target === inspectorOverlay || target === inspectorHoverLabel ||
      (inspectorOverlay && inspectorOverlay.contains && inspectorOverlay.contains(target))) {
    return;
  }

  updateInspectorOverlay(target);
  updateHoverLabel(target, e.clientX, e.clientY);
}

// Handle mouse move for hover label position
function handleInspectorMouseMove(e) {
  if (!xrayMode || !inspectorHoverLabel) return;

  const target = e.composedPath()[0];
  if (!target || target === inspectorOverlay || target === inspectorHoverLabel) {
    return;
  }

  updateHoverLabel(target, e.clientX, e.clientY);
}

// Handle mouse out to hide hover label
function handleInspectorMouseOut(e) {
  if (!xrayMode) return;
  // Only hide if leaving the document
  if (e.relatedTarget === null) {
    hideHoverLabel();
  }
}

// Toggle X-Ray mode with inspector overlay
function toggleXrayMode() {
  xrayMode = !xrayMode;
  document.documentElement.classList.toggle('pluck-xray', xrayMode);

  if (xrayMode) {
    createInspectorOverlay();
    createHoverLabel();
    document.addEventListener('mouseover', handleInspectorHover, true);
    document.addEventListener('mousemove', handleInspectorMouseMove, true);
    document.addEventListener('mouseout', handleInspectorMouseOut, true);
  } else {
    document.removeEventListener('mouseover', handleInspectorHover, true);
    document.removeEventListener('mousemove', handleInspectorMouseMove, true);
    document.removeEventListener('mouseout', handleInspectorMouseOut, true);
    destroyInspectorOverlay();
  }

  showModeIndicator(xrayMode ? 'X-Ray ON' : 'X-Ray OFF');
  console.log("[Pluck] X-Ray mode:", xrayMode ? 'ON' : 'OFF');
}

// ===========================================
// --- Color Picker Mode ---
// ===========================================
// Custom magnifier UI with screen capture
// ===========================================

// Color Picker State
let colorPickerActive = false;
let colorPickerOverlay = null;
let colorPickerScreenshot = null;
let colorPickerCanvas = null;
let colorPickerCtx = null;

// Create the color picker overlay with magnifier UI
function createColorPickerUI() {
  // Create container using Shadow DOM for style isolation
  const container = document.createElement('div');
  container.id = 'pluck-color-picker-container';
  const shadow = container.attachShadow({ mode: 'closed' });

  // Styles for the magnifier UI
  const styles = document.createElement('style');
  styles.textContent = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
      cursor: none;
    }

    .magnifier-wrapper {
      position: fixed;
      pointer-events: none;
      transform: translate(-55px, -55px);
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 10px;
      filter: drop-shadow(0 4px 15px rgba(0,0,0,0.25));
    }

    .magnifier {
      width: 110px;
      height: 110px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.9);
      overflow: hidden;
      background: #f5f5f5;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.1);
    }

    .magnifier canvas {
      display: block;
      width: 110px;
      height: 110px;
      image-rendering: pixelated;
    }

    .info-panel {
      background: #222;
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }

    .color-preview {
      width: 28px;
      height: 28px;
      border-radius: 4px;
      border: 2px solid rgba(255,255,255,0.3);
      background: #000;
    }

    .hex-value {
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
    }

    .rgb-value {
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
      font-size: 10px;
      color: rgba(255,255,255,0.5);
      white-space: nowrap;
    }

    .click-hint {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 9px;
      color: rgba(255,255,255,0.35);
    }
  `;

  // Create the overlay structure
  const overlay = document.createElement('div');
  overlay.className = 'overlay';

  const magnifierWrapper = document.createElement('div');
  magnifierWrapper.className = 'magnifier-wrapper';

  const magnifier = document.createElement('div');
  magnifier.className = 'magnifier';

  const magnifierCanvas = document.createElement('canvas');
  magnifierCanvas.width = 110;
  magnifierCanvas.height = 110;
  magnifier.appendChild(magnifierCanvas);
  // Crosshair will be drawn on canvas directly

  const infoPanel = document.createElement('div');
  infoPanel.className = 'info-panel';

  const colorPreview = document.createElement('div');
  colorPreview.className = 'color-preview';

  const hexValue = document.createElement('div');
  hexValue.className = 'hex-value';
  hexValue.textContent = '#000000';

  const rgbValue = document.createElement('div');
  rgbValue.className = 'rgb-value';
  rgbValue.textContent = 'RGB(0, 0, 0)';

  const clickHint = document.createElement('div');
  clickHint.className = 'click-hint';
  clickHint.textContent = 'Click to copy';

  infoPanel.appendChild(colorPreview);
  infoPanel.appendChild(hexValue);
  infoPanel.appendChild(rgbValue);
  infoPanel.appendChild(clickHint);

  magnifierWrapper.appendChild(magnifier);
  magnifierWrapper.appendChild(infoPanel);
  overlay.appendChild(magnifierWrapper);

  shadow.appendChild(styles);
  shadow.appendChild(overlay);

  return {
    container,
    overlay,
    magnifierWrapper,
    magnifierCanvas,
    colorPreview,
    hexValue,
    rgbValue
  };
}

// Update the magnifier display
function updateColorPickerMagnifier(ui, x, y, canvas, ctx) {
  const pixelRatio = window.devicePixelRatio || 1;
  const sampleX = Math.floor(x * pixelRatio);
  const sampleY = Math.floor(y * pixelRatio);

  // Position the magnifier wrapper above the cursor
  ui.magnifierWrapper.style.left = x + 'px';
  ui.magnifierWrapper.style.top = y + 'px';

  // Draw magnified pixels
  const magnifierCtx = ui.magnifierCanvas.getContext('2d');
  const canvasSize = 110;
  const zoomLevel = 10; // Each pixel becomes 10x10
  const gridSize = 11; // 11x11 grid (odd number = true center pixel)
  const centerOffset = Math.floor(gridSize / 2); // = 5

  magnifierCtx.imageSmoothingEnabled = false;
  magnifierCtx.clearRect(0, 0, canvasSize, canvasSize);

  // Draw the zoomed pixels
  for (let py = 0; py < gridSize; py++) {
    for (let px = 0; px < gridSize; px++) {
      const srcX = sampleX - centerOffset + px;
      const srcY = sampleY - centerOffset + py;

      // Get pixel color from the screenshot canvas
      let color = '#1a1a1a';
      if (srcX >= 0 && srcX < canvas.width && srcY >= 0 && srcY < canvas.height) {
        const pixel = ctx.getImageData(srcX, srcY, 1, 1).data;
        color = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
      }

      magnifierCtx.fillStyle = color;
      magnifierCtx.fillRect(px * zoomLevel, py * zoomLevel, zoomLevel, zoomLevel);
    }
  }

  // Draw circle crosshair at exact center
  // With 11x11 grid, center pixel (5,5) is drawn at (50,50), its center is (55,55) = canvas center
  const centerX = canvasSize / 2;
  const centerY = canvasSize / 2;
  const radius = 5;

  // Outer dark ring
  magnifierCtx.beginPath();
  magnifierCtx.arc(centerX, centerY, radius + 1, 0, Math.PI * 2);
  magnifierCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  magnifierCtx.lineWidth = 1;
  magnifierCtx.stroke();

  // Inner white ring
  magnifierCtx.beginPath();
  magnifierCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  magnifierCtx.strokeStyle = '#ffffff';
  magnifierCtx.lineWidth = 2;
  magnifierCtx.stroke();

  // Get the center pixel color
  let hexColor = '#000000';
  let r = 0, g = 0, b = 0;
  if (sampleX >= 0 && sampleX < canvas.width && sampleY >= 0 && sampleY < canvas.height) {
    const centerPixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
    r = centerPixel[0];
    g = centerPixel[1];
    b = centerPixel[2];
    hexColor = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // Update the info panel
  ui.colorPreview.style.background = hexColor;
  ui.hexValue.textContent = hexColor;
  ui.rgbValue.textContent = `${r}, ${g}, ${b}`;

  return hexColor;
}

async function copyColorToClipboard(hexColor) {
  try {
    await navigator.clipboard.writeText(hexColor);
    return true;
  } catch (err) {
    console.warn('[Pluck] Clipboard write failed:', err);
    return false;
  }
}

// Main color picker function
async function toggleColorPickMode() {
  // If already active, close it
  if (colorPickerActive && colorPickerOverlay) {
    destroyColorPicker();
    return false;
  }

  try {
    // Disable other modes if active
    if (xrayMode) toggleXrayMode();
    if (pickMode) {
      pickMode = false; applyPickCursor();
      if (hoverElement) {
        hoverElement.classList.remove("web-replica-hover");
        hoverElement = null;
      }
    }

    console.log('[Pluck] Starting color picker...');

    // Capture the current tab
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' }, resolve);
    });

    if (!response || !response.ok) {
      showModeIndicator('Failed to capture screen');
      console.error('[Pluck] Capture failed:', response?.error);
      return false;
    }

    // Load the screenshot into a canvas
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = response.dataUrl;
    });

    colorPickerCanvas = document.createElement('canvas');
    colorPickerCanvas.width = img.width;
    colorPickerCanvas.height = img.height;
    colorPickerCtx = colorPickerCanvas.getContext('2d', { willReadFrequently: true });
    colorPickerCtx.drawImage(img, 0, 0);

    // Create the UI
    const ui = createColorPickerUI();
    colorPickerOverlay = ui;
    document.body.appendChild(ui.container);
    colorPickerActive = true;

    let currentColor = '#000000';

    // Mouse move handler
    const handleMove = (e) => {
      currentColor = updateColorPickerMagnifier(
        ui, e.clientX, e.clientY,
        colorPickerCanvas, colorPickerCtx
      );
    };

    // Click handler
    const handleClick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      await copyColorToClipboard(currentColor);

      const r = parseInt(currentColor.slice(1, 3), 16);
      const g = parseInt(currentColor.slice(3, 5), 16);
      const b = parseInt(currentColor.slice(5, 7), 16);

      destroyColorPicker();
      showModeIndicator(`Copied: ${currentColor} | RGB(${r}, ${g}, ${b})`);
    };

    // Keyboard handler (Escape to cancel)
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        destroyColorPicker();
        showModeIndicator('Color picker cancelled');
      }
    };

    // Store handlers for cleanup
    ui.handlers = { handleMove, handleClick, handleKeydown };

    ui.overlay.addEventListener('mousemove', handleMove);
    ui.overlay.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeydown, true);

    console.log('[Pluck] Color picker ready');
    return true;

  } catch (e) {
    console.error('[Pluck] Color picker error:', e);
    showModeIndicator('Color picker failed to start');
    destroyColorPicker();
    return false;
  }
}

// Clean up the color picker
function destroyColorPicker() {
  if (colorPickerOverlay) {
    const { handlers, container } = colorPickerOverlay;
    if (handlers) {
      colorPickerOverlay.overlay.removeEventListener('mousemove', handlers.handleMove);
      colorPickerOverlay.overlay.removeEventListener('click', handlers.handleClick);
      document.removeEventListener('keydown', handlers.handleKeydown, true);
    }
    container.remove();
    colorPickerOverlay = null;
  }
  colorPickerCanvas = null;
  colorPickerCtx = null;
  colorPickerActive = false;
}

// Use capturing phase to intercept before page handlers
document.addEventListener("keydown", (e) => {
  if (pickMode && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    if (!hoverElement) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    let target = null;
    if (e.key === 'ArrowUp') {
      target = getNavParent(hoverElement);
      if (target && target !== hoverElement) navBackStack.push(hoverElement);
    } else {
      const top = navBackStack[navBackStack.length - 1];
      if (top && top !== hoverElement && hoverElement && hoverElement.contains(top)) {
        target = top;
        navBackStack.pop();
      } else {
        navBackStack = [];
        target = getFirstNavChild(hoverElement);
      }
    }

    if (!target || !target.classList) return false;

    if (hoverElement && hoverElement.classList) {
      hoverElement.classList.remove("web-replica-hover");
    }
    ensureStylesInShadow(target);
    hoverElement = target;
    navigatedElement = target;
    isNavigating = true;
    hoverElement.classList.add("web-replica-hover");

    selectedElements.forEach((sel) => sel.classList.remove("web-replica-selected"));
    selectedElements.clear();
    selectionClones.clear();
    toggleElement(target, true);

    showModeIndicator(describeElement(hoverElement));
    return false;
  }

  // Toggle selection mode (start if off, stop if on)
  if (matchesShortcut(e, shortcuts.startSelect)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    pickMode = !pickMode; applyPickCursor(); // Toggle
    if (pickMode) {
      showModeIndicator('Selection mode ON');
      console.log("[Pluck] Selection mode started");
    } else {
      if (hoverElement) {
        hoverElement.classList.remove("web-replica-hover");
        hoverElement = null;
      }
      showModeIndicator('Selection mode OFF');
      console.log("[Pluck] Selection mode stopped");
    }
    return false;
  }

  // Clear selection - only capture ESC when extension is active (pickMode or has selections)
  if (matchesShortcut(e, shortcuts.clearSelect)) {
    // Only intercept if extension is actively being used
    if (pickMode || selectedElements.size > 0) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      selectedElements.forEach((el) => el.classList.remove("web-replica-selected"));
      selectedElements.clear();
      selectionClones.clear();
      // Belt-and-suspenders: sweep any lingering outline classes off the DOM
      // in case state ever desyncs from the tracked set.
      document.querySelectorAll(".web-replica-selected").forEach((el) => el.classList.remove("web-replica-selected"));
      if (hoverElement) { hoverElement.classList.remove("web-replica-hover"); hoverElement = null; }
      document.querySelectorAll(".web-replica-hover").forEach((el) => el.classList.remove("web-replica-hover"));
      pickMode = false; applyPickCursor();
      showModeIndicator('Selection cleared');
      console.log("[Pluck] Selection cleared");
      return false;
    }
    // Otherwise let ESC do its normal Chrome job
  }

  // Export selection - open preview page
  if (matchesShortcut(e, shortcuts.export)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (selectedElements.size > 0) {
      showModeIndicator('Preparing export...');
      buildExport().then(result => {
        if (result && result.toon) {
          chrome.storage.local.set({ pluckExportData: result }, () => {
            chrome.runtime.sendMessage({ type: 'OPEN_PREVIEW_TAB' }, () => {
              if (chrome.runtime.lastError) {
                console.warn('[Pluck] Background message failed:', chrome.runtime.lastError.message);
              }
              showModeIndicator('Export ready — open the Pluck dock');
            });
          });
        } else {
          showModeIndicator('Nothing selected to export');
        }
      }).catch(err => {
        console.error('[Pluck] Export error:', err);
        showModeIndicator(/context invalidated/i.test(err && err.message) ? 'Reload this page — Pluck was updated' : 'Export failed');
      });
    } else {
      showModeIndicator('No elements selected');
    }
    return false;
  }

  // Toggle X-Ray mode
  if (matchesShortcut(e, shortcuts.xray)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    toggleXrayMode();
    return false;
  }

  // Toggle Color Pick mode
  if (matchesShortcut(e, shortcuts.colorPick)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    toggleColorPickMode();
    return false;
  }

  if (matchesShortcut(e, shortcuts.extractPage)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const body = document.body;
    if (!body) {
      showModeIndicator('No body element found');
      return false;
    }
    selectedElements.forEach((sel) => sel.classList.remove("web-replica-selected"));
    selectedElements.clear();
    selectionClones.clear();
    toggleElement(body, true);
    showModeIndicator('Exporting full page...');
    buildExport().then(result => {
      if (result && result.toon) {
        chrome.storage.local.set({ pluckExportData: result }, () => {
          chrome.runtime.sendMessage({ type: 'OPEN_PREVIEW_TAB' }, () => {
            if (chrome.runtime.lastError) {
              console.warn('[Pluck] Background message failed:', chrome.runtime.lastError.message);
            }
            showModeIndicator('Full page exported — open the Pluck dock');
          });
        });
      } else {
        showModeIndicator('Nothing selected to export');
      }
    }).catch(err => {
      console.error('[Pluck] Full-page export error:', err);
      showModeIndicator(/context invalidated/i.test(err && err.message) ? 'Reload this page — Pluck was updated' : 'Export failed');
    });
    return false;
  }
}, true); // true = capturing phase (runs BEFORE page handlers)

// --- Default values to SKIP (only truly useless defaults) ---
const DEFAULT_SKIP = {
  'position': ['static'],
  'float': ['none'],
  'clear': ['none'],
  // 'box-sizing': ['content-box'], // REMOVED - We force border-box now
  // Individual margin/padding sides - only skip exact 0
  // Individual margin/padding sides - only skip exact 0
  'margin-top': ['0px'],
  'margin-right': ['0px'],
  'margin-bottom': ['0px'],
  'margin-left': ['0px'],
  'padding-top': ['0px'],
  'padding-right': ['0px'],
  'padding-bottom': ['0px'],
  'padding-left': ['0px'],
  'min-width': ['0px'],
  'min-height': ['0px'],
  'max-width': ['none'],
  'max-height': ['none'],
  'top': ['auto'],
  'right': ['auto'],
  'bottom': ['auto'],
  'left': ['auto'],
  'z-index': ['auto'],
  'flex-grow': ['0'],
  'flex-shrink': ['1'],
  'flex-basis': ['auto'],
  // baseline on icon-only grid items sinks them — let parent's align-items win.
  'align-self': ['auto', 'baseline'],
  'justify-self': ['auto', 'normal'],
  'justify-items': ['legacy', 'normal'],
  'order': ['0'],
  'grid-template-columns': ['none'],
  'grid-template-rows': ['none'],
  'grid-template-areas': ['none'],
  'grid-column': ['auto'],
  'grid-row': ['auto'],
  'grid-area': ['auto / auto / auto / auto', 'auto'],
  'grid-auto-flow': ['row'],
  'grid-auto-columns': ['auto'],
  'grid-auto-rows': ['auto'],
  'background-color': ['transparent', 'rgba(0, 0, 0, 0)'],
  'background-image': ['none'],
  'background-size': ['auto'],
  'background-position': ['0% 0%'],
  'background-repeat': ['repeat'],
  'opacity': ['1'],
  'border-width': ['0px'],
  'border-style': ['none'],
  // Per-side longhand defaults — keep sides without a real border out of classes.
  'border-top-width': ['0px'],
  'border-right-width': ['0px'],
  'border-bottom-width': ['0px'],
  'border-left-width': ['0px'],
  'border-top-style': ['none'],
  'border-right-style': ['none'],
  'border-bottom-style': ['none'],
  'border-left-style': ['none'],
  'border-radius': ['0px'],
  'box-shadow': ['none'],
  'outline': ['none'],
  'text-decoration': ['none'],
  'text-transform': ['none'],
  'text-overflow': ['clip'],
  'letter-spacing': ['normal'],
  'vertical-align': ['baseline'],
  'overflow': ['visible'],
  'overflow-x': ['visible'],
  'overflow-y': ['visible'],
  'cursor': ['auto'],
  'pointer-events': ['auto'],
  'user-select': ['auto'],
  'transform': ['none'],
  'object-fit': ['fill'],
  // Visual effects
  'backdrop-filter': ['none'],
  '-webkit-backdrop-filter': ['none'],
  'filter': ['none'],
  // Font rendering - skip defaults
  '-webkit-font-smoothing': ['auto'],
  '-moz-osx-font-smoothing': ['auto'],
  'text-rendering': ['auto'],
  'font-optical-sizing': ['auto'],
  'font-variant': ['normal'],
  'font-variant-ligatures': ['normal'],
};

// --- Properties for SHARED styles ---
// Capture all important properties, use longhand for margin/padding to preserve individual sides
const SHARED_PROPS = [
  // Layout
  'display', 'position', 'float', 'clear', // 'box-sizing', // REMOVED - forcing border-box manually
  // Spacing - use longhand to capture individual sides correctly
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  // Sizing
  'min-width', 'min-height', 'max-width', 'max-height',
  // Flex container
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'gap',
  // Flex item
  'flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'order',
  // Grid
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
  'grid-column', 'grid-row', 'grid-area',
  'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows',
  'justify-self', 'justify-items',
  // Position offsets
  'top', 'right', 'bottom', 'left', 'z-index',
  // Background
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  // Visual
  'color', 'opacity',
  'border-width', 'border-style', 'border-color',
  // Longhands needed so `border-bottom: 2px solid` survives the shorthand collapse.
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-radius',
  'box-shadow', 'outline',
  // Text
  'font-family', 'font-size', 'font-weight', 'line-height', 'text-align',
  'text-decoration', 'text-transform', 'white-space', 'text-overflow',
  'word-break', 'overflow-wrap', 'hyphens', 'tab-size', 'text-indent',
  'letter-spacing', 'vertical-align',
  // Other
  'overflow', 'overflow-x', 'overflow-y',
  'cursor', 'pointer-events', 'user-select',
  'transform', 'object-fit',
  // Visual effects - backdrop blur, filters, etc.
  'backdrop-filter', '-webkit-backdrop-filter', 'filter',
  // Font rendering
  '-webkit-font-smoothing', '-moz-osx-font-smoothing', 'text-rendering',
  'font-optical-sizing', 'font-variant', 'font-variant-ligatures',
  // Scrollbar styling (standard properties that can be captured)
  'scrollbar-width', 'scrollbar-color'
];

// --- Properties captured on ::before / ::after pseudo-elements ---
const PSEUDO_PROPS = [
  'display',
  'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'width', 'height',
  'background-color', 'background-image', 'background-size',
  'background-position', 'background-repeat',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-radius',
  'box-shadow',
  'color', 'opacity',
  'transform', 'transform-origin',
  'filter',
  'font-family', 'font-size', 'font-weight', 'line-height',
  'text-align', 'vertical-align',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'overflow', 'overflow-x', 'overflow-y',
  'pointer-events',
];

const VOID_ELEMENT_TAGS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'col', 'embed', 'param']);

function isDecorativePseudo(style) {
  const bg = style.getPropertyValue('background-color');
  const bgImg = style.getPropertyValue('background-image');
  const transform = style.getPropertyValue('transform');
  const shadow = style.getPropertyValue('box-shadow');
  const borderTop = parseFloat(style.getPropertyValue('border-top-width')) || 0;
  const borderLeft = parseFloat(style.getPropertyValue('border-left-width')) || 0;
  const w = parseFloat(style.getPropertyValue('width')) || 0;
  const h = parseFloat(style.getPropertyValue('height')) || 0;
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return true;
  if (bgImg && bgImg !== 'none') return true;
  if (transform && transform !== 'none') return true;
  if (shadow && shadow !== 'none') return true;
  if (borderTop > 0 || borderLeft > 0) return true;
  if (w > 0 && h > 0) return true;
  return false;
}

function capturePseudoStyles(pseudoStyle) {
  const captured = {};
  const positionValue = pseudoStyle.getPropertyValue('position');
  for (const prop of PSEUDO_PROPS) {
    if (['top', 'right', 'bottom', 'left'].includes(prop) && positionValue === 'static') continue;

    const borderSideMatch = prop.match(/^border-(top|right|bottom|left)-(width|style|color)$/);
    if (borderSideMatch) {
      const side = borderSideMatch[1];
      const sideWidth = parseFloat(pseudoStyle.getPropertyValue(`border-${side}-width`)) || 0;
      const sideStyle = pseudoStyle.getPropertyValue(`border-${side}-style`);
      if (sideWidth <= 0 || sideStyle === 'none' || sideStyle === 'hidden') continue;
    }

    let value = pseudoStyle.getPropertyValue(prop);
    if (isDefaultValue(prop, value)) continue;
    if (prop.includes('color') || prop === 'background-color') {
      const hex = rgbToHex(value);
      if (!hex) continue;
      value = hex;
    }
    if (prop === 'font-family') {
      const short = shortenFontFamily(value);
      if (!short) continue;
      value = short;
    }
    captured[prop] = value;
  }
  return captured;
}

function tryCapturePseudo(originalEl, position) {
  const style = window.getComputedStyle(originalEl, '::' + position);
  const content = style.getPropertyValue('content');
  if (!content || content === 'none' || content === 'normal') return null;
  const cleaned = content.replace(/^["']|["']$/g, '');
  const hasContent = cleaned.length > 0;
  const hasDecoration = isDecorativePseudo(style);
  if (!hasContent && !hasDecoration) return null;
  const styles = capturePseudoStyles(style);
  if (!hasContent && Object.keys(styles).length === 0) return null;
  return { content: cleaned, styles };
}

function escapePseudoContent(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// --- Parent-context wrapper ---
function getLayoutParent(el) {
  if (!el) return null;
  const cs = window.getComputedStyle(el);
  if (cs.position === 'absolute' || cs.position === 'fixed') {
    return el.offsetParent || el.parentElement;
  }
  return el.parentElement;
}

const LAYOUT_PARENT_PROPS = [
  'display',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items',
  'align-content', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
  'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'background-color',
  'position',
  'border-radius',
];

function captureLayoutParentStyles(parent, hasPositionedChildren) {
  if (!parent) return {};
  const cs = window.getComputedStyle(parent);
  const captured = {};
  for (const prop of LAYOUT_PARENT_PROPS) {
    let value = cs.getPropertyValue(prop);
    if (isDefaultValue(prop, value)) continue;
    if (prop === 'position' && value === 'static') continue;
    if (prop.includes('color') || prop === 'background-color') {
      const hex = rgbToHex(value);
      if (!hex) continue;
      value = hex;
    }
    captured[prop] = value;
  }
  if (hasPositionedChildren && (!captured['position'] || captured['position'] === 'static')) {
    captured['position'] = 'relative';
  }
  return captured;
}

// --- Inherited props: skip on descendants when parent's value matches ---
const INHERITED_PROPS = new Set([
  'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'font-variant', 'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-indent', 'text-transform', 'text-decoration',
  'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'tab-size',
  'cursor', 'pointer-events', 'user-select',
  '-webkit-font-smoothing', '-moz-osx-font-smoothing', 'text-rendering',
  'font-optical-sizing', 'font-variant-ligatures',
]);

// --- Properties for INLINE styles (unique per element) ---
const INLINE_PROPS = []; // Dimensions handled manually now

// --- Check if value is a default (should skip) ---
function isDefaultValue(prop, value) {
  if (!value || value === '' || value === 'initial' || value === 'inherit') return true;

  const defaults = DEFAULT_SKIP[prop];
  if (!defaults || defaults.length === 0) return false;  // No defaults = always keep

  const normalized = value.toLowerCase().trim();
  for (const def of defaults) {
    if (normalized === def.toLowerCase()) return true;
  }
  return false;
}

// --- Convert RGB to shorter hex, preserve alpha for rgba ---
function rgbToHex(rgb) {
  if (!rgb || rgb === 'transparent') return null;

  // Check for rgba with alpha
  const rgbaMatch = rgb.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1]);
    const g = parseInt(rgbaMatch[2]);
    const b = parseInt(rgbaMatch[3]);
    const a = parseFloat(rgbaMatch[4]);

    // Skip fully transparent
    if (a === 0) return null;

    // Keep rgba format for semi-transparent colors (this is crucial for backdrop effects)
    if (a < 1) {
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    // Fully opaque - convert to hex
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  // Regular rgb
  const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return rgb;
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// --- Check if color is neutral (gray/black/white) - borders with neutral colors are intentional ---
function isNeutralColor(color) {
  if (!color) return false;

  let r, g, b;

  if (color.startsWith('#')) {
    r = parseInt(color.slice(1, 3), 16);
    g = parseInt(color.slice(3, 5), 16);
    b = parseInt(color.slice(5, 7), 16);
  } else if (color.startsWith('rgba')) {
    const match = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return false;
    r = parseInt(match[1]);
    g = parseInt(match[2]);
    b = parseInt(match[3]);
  } else if (color.startsWith('rgb')) {
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return false;
    r = parseInt(match[1]);
    g = parseInt(match[2]);
    b = parseInt(match[3]);
  } else {
    return false;
  }

  // Check if RGB values are close to each other (grayscale)
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  return maxDiff < 30; // Within 30 is considered neutral/gray
}

// --- Shorten font-family ---
// Track unique font families for loading
let detectedFonts = new Set();

function shortenFontFamily(value) {
  if (!value) return null;

  // Parse the font stack
  const fonts = value.split(',').map(f => f.trim().replace(/["']/g, ''));
  const first = fonts[0].toLowerCase();

  // A lone "Times"/"serif" is the UA default (page set no real font here) — drop it so
  // the element inherits the export's sans reset instead of forcing serif.
  if (fonts.length === 1 && ['times', 'times new roman', 'serif'].includes(first)) {
    return null;
  }

  // Detect web fonts that need to be loaded
  const webFonts = ['mona sans', 'inter', 'roboto', 'open sans', 'lato', 'montserrat', 'poppins', 'nunito', 'raleway', 'source sans', 'ubuntu', 'fira sans'];
  for (const font of fonts) {
    const fontLower = font.toLowerCase();
    for (const webFont of webFonts) {
      if (fontLower.includes(webFont)) {
        detectedFonts.add(font);
      }
    }
  }

  // If it's a system font stack, use a comprehensive cross-platform stack
  if (first.includes('system-ui') || first.includes('segoe') || first.includes('-apple-system') || first.includes('blinkmacsystemfont')) {
    return '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';
  }

  // Keep the full font stack for better fallback
  return value;
}

function resetDetectedFonts() {
  detectedFonts = new Set();
}

function getDetectedFonts() {
  return detectedFonts;
}

// --- WOFF/Custom Font Embedding ---
// Detect font format from URL
function detectFontFormat(url) {
  // Strip query/fragment so `foo.woff2?v=3` still matches.
  const path = (url || '').split('#')[0].split('?')[0].toLowerCase();
  if (path.endsWith('.woff2')) return 'woff2';
  if (path.endsWith('.woff')) return 'woff';
  if (path.endsWith('.ttf')) return 'truetype';
  if (path.endsWith('.otf')) return 'opentype';
  if (path.endsWith('.eot')) return 'embedded-opentype';
  // Unknown: drop. Pretending it's woff2 produced broken @font-face rules.
  return null;
}

// FETCH_FONT via background with a hard timeout — a slow/hung URL must never leave the export hanging.
function bgFetch(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const done = (v) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(v); } };
    timer = setTimeout(() => done({ ok: false, error: 'timeout' }), timeoutMs);
    try {
      chrome.runtime.sendMessage({ type: 'FETCH_FONT', url }, (response) => {
        if (chrome.runtime.lastError) done({ ok: false, error: chrome.runtime.lastError.message });
        else done(response);
      });
    } catch (e) { done({ ok: false, error: e && e.message }); }
  });
}

// Memoized stylesheet-text fetch — avoids re-fetching every sheet per font (O(fonts × sheets)). Cleared per export.
const _sheetCssCache = new Map();
async function getSheetCssText(href) {
  if (_sheetCssCache.has(href)) return _sheetCssCache.get(href);
  const resp = await bgFetch(href);
  let css = null;
  if (resp && resp.ok && resp.dataUrl) {
    try { css = atob(resp.dataUrl.split(',')[1]); } catch (e) { css = null; }
  }
  _sheetCssCache.set(href, css);
  return css;
}

// Fetch a font file and convert to base64 data URL
// Uses background script to bypass CORS restrictions
async function fetchFontAsBase64(url) {
  try {
    // Handle relative URLs
    const absoluteUrl = new URL(url, window.location.href).href;

    // First, try using the background script (bypasses CORS), time-boxed.
    const bg = await bgFetch(absoluteUrl);
    if (bg && bg.ok && bg.dataUrl) {
      return bg.dataUrl;
    }
    console.warn('[Pluck] Background fetch failed:', bg && bg.error);

    // Fallback: try direct fetch (works for same-origin or CORS-enabled fonts), time-boxed
    // so a hanging response can't stall the export.
    const response = await fetch(absoluteUrl, { mode: 'cors', signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;

    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('[Pluck] Could not fetch font:', url, e.message);
    return null;
  }
}

// Parse @font-face rules from CSS text (for CORS-blocked stylesheets)
function parseFontFacesFromText(cssText, fontFaces) {
  const fontFaceRegex = /@font-face\s*\{([^}]+)\}/gi;
  let match;

  while ((match = fontFaceRegex.exec(cssText)) !== null) {
    const block = match[1];

    // Extract font-family
    const familyMatch = block.match(/font-family\s*:\s*["']?([^"';\n]+)["']?/i);
    if (!familyMatch) continue;
    const family = familyMatch[1].trim();

    // Extract src URL
    const srcMatch = block.match(/src\s*:[^;]*url\(["']?([^"')]+)["']?\)/i);
    if (!srcMatch) continue;
    const url = srcMatch[1];

    // Extract font-weight (default: normal)
    const weightMatch = block.match(/font-weight\s*:\s*([^;\n]+)/i);
    const weight = weightMatch ? weightMatch[1].trim() : 'normal';

    // Extract font-style (default: normal)
    const styleMatch = block.match(/font-style\s*:\s*([^;\n]+)/i);
    const style = styleMatch ? styleMatch[1].trim() : 'normal';

    const format = detectFontFormat(url);
    if (!format) continue;
    const key = `${family}-${weight}-${style}`;

    fontFaces.set(key, { family, url, format, weight, style });
  }
}

// Extract fonts from network requests using Performance API
function extractFontsFromNetwork() {
  const networkFonts = new Map();

  try {
    const resources = performance.getEntriesByType('resource');
    for (const resource of resources) {
      const url = resource.name;
      // Check if it's a font file
      if (/\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url)) {
        const format = detectFontFormat(url);
        // Try to extract font family from URL path
        const pathMatch = url.match(/\/([^/]+)\.(woff2?|ttf|otf|eot)/i);
        const guessedFamily = pathMatch ? pathMatch[1].replace(/[-_]/g, ' ') : 'Unknown';

        // Use URL as key since we don't know the exact family name
        networkFonts.set(url, {
          family: guessedFamily,
          url: url,
          format: format,
          weight: 'normal',
          style: 'normal',
          fromNetwork: true
        });
        console.log('[Pluck] Found font in network:', url);
      }
    }
  } catch (e) {
    console.warn('[Pluck] Could not access performance entries:', e.message);
  }

  return networkFonts;
}

// Extract @font-face rules from all stylesheets
async function extractFontFaces() {
  const fontFaces = new Map();
  _sheetCssCache.clear(); // fresh per export; memoizes sheet fetches within this run

  // First, get fonts from stylesheets (more accurate - has family names).
  // Collect CORS-blocked sheet hrefs; fetch them all in parallel below (serial awaits were slow).
  const corsBlockedHrefs = [];
  for (const sheet of document.styleSheets) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;

      for (const rule of rules) {
        if (rule instanceof CSSFontFaceRule) {
          // Get font-family - try multiple methods as browsers return it differently
          let family = rule.style.getPropertyValue('font-family');

          // Also try accessing via cssText if getPropertyValue fails
          if (!family && rule.cssText) {
            const familyMatch = rule.cssText.match(/font-family\s*:\s*["']?([^"';\n}]+)["']?/i);
            if (familyMatch) {
              family = familyMatch[1];
            }
          }

          // Clean up the family name (remove quotes, trim)
          family = (family || '').replace(/["']/g, '').trim();

          // Skip if we couldn't get a valid family name
          if (!family) {
            console.log('[Pluck] Skipping @font-face with empty family in sheet:', sheet.href);
            continue;
          }

          const src = rule.style.getPropertyValue('src');
          const weight = rule.style.getPropertyValue('font-weight') || 'normal';
          const style = rule.style.getPropertyValue('font-style') || 'normal';

          // Parse URL from src (handle multiple url() in src)
          const urlMatch = src.match(/url\(["']?([^"')]+\.(?:woff2?|ttf|otf|eot)[^"')]*?)["']?\)/i);
          if (urlMatch) {
            const url = urlMatch[1];
            const format = detectFontFormat(url);
            if (!format) {
              console.log('[Pluck] Skipping unrecognised font format:', url);
              continue;
            }
            const key = `${family}-${weight}-${style}`;

            fontFaces.set(key, { family, url, format, weight, style });
            console.log('[Pluck] Found @font-face:', family, weight, style);
          }
        }
      }
    } catch (e) {
      // CORS blocked - remember it; fetched in parallel below.
      if (sheet.href) corsBlockedHrefs.push(sheet.href);
    }
  }

  // Fetch every CORS-blocked stylesheet at once (getSheetCssText memoizes, so dupes
  // collapse); parse each for @font-face rules as it arrives.
  await Promise.all(corsBlockedHrefs.map(async (href) => {
    const cssText = await getSheetCssText(href);
    if (cssText) {
      parseFontFacesFromText(cssText, fontFaces);
      console.log('[Pluck] Parsed CORS-blocked stylesheet via background:', href);
    }
  }));

  // Then, get fonts from network requests (catches dynamically loaded fonts)
  const networkFonts = extractFontsFromNetwork();

  // Merge network fonts that weren't found in stylesheets
  // Match by URL to avoid duplicates
  const existingUrls = new Set();
  for (const [, font] of fontFaces) {
    // Normalize URL for comparison
    try {
      const absoluteUrl = new URL(font.url, window.location.href).href;
      existingUrls.add(absoluteUrl);
    } catch (e) {
      existingUrls.add(font.url);
    }
  }

  for (const [url, font] of networkFonts) {
    if (!existingUrls.has(url)) {
      // This font was loaded but not found in stylesheets
      // Try to find the font-family by fetching and parsing stylesheets via background script
      let foundFamily = null;

      // Search through stylesheets we couldn't access directly. getSheetCssText is
      // memoized, so each sheet is fetched at most once for the whole export.
      for (const sheet of document.styleSheets) {
        if (sheet.href) {
          const cssText = await getSheetCssText(sheet.href);
          if (cssText) {
            // Look for @font-face rules that reference this font URL
            const fontFaceRegex = /@font-face\s*\{([^}]+)\}/gi;
            let match;
            while ((match = fontFaceRegex.exec(cssText)) !== null) {
              const block = match[1];
              // Check if this @font-face references our font URL
              if (block.includes(url) || block.includes(url.split('/').pop())) {
                const familyMatch = block.match(/font-family\s*:\s*["']?([^"';\n]+)["']?/i);
                if (familyMatch) {
                  foundFamily = familyMatch[1].trim();
                  // Also extract weight/style
                  const weightMatch = block.match(/font-weight\s*:\s*([^;\n]+)/i);
                  const styleMatch = block.match(/font-style\s*:\s*([^;\n]+)/i);
                  if (weightMatch) font.weight = weightMatch[1].trim();
                  if (styleMatch) font.style = styleMatch[1].trim();
                  break;
                }
              }
            }
          }
        }
        if (foundFamily) break;
      }

      if (foundFamily) {
        font.family = foundFamily;
        console.log('[Pluck] Found family for network font:', foundFamily, url);
      }

      const key = `network-${url}`;
      fontFaces.set(key, font);
      console.log('[Pluck] Added network font:', font.family, url);
    }
  }

  return fontFaces;
}

// Collect all font families used in the node tree
function collectUsedFontFamilies(nodes) {
  const families = new Set();

  function extractFromStyle(styleStr) {
    if (!styleStr) return;
    const fontMatch = styleStr.match(/font-family:\s*([^;]+)/i);
    if (fontMatch) {
      fontMatch[1].split(',').forEach(f => {
        const cleaned = f.trim().replace(/["']/g, '');
        if (cleaned) families.add(cleaned);
      });
    }
  }

  function traverse(node) {
    // Check inline style from structure
    if (node.inlineStyle) {
      extractFromStyle(node.inlineStyle);
    }
    // Registry keys are JSON, not CSS — parse and read the family directly (a CSS regex never matched).
    if (node.style && styleRegistry) {
      for (const [styleJson, name] of styleRegistry.entries()) {
        if (name === node.style) {
          try {
            const ff = JSON.parse(styleJson)['font-family'];
            if (ff) ff.split(',').forEach((f) => { const c = f.trim().replace(/["']/g, ''); if (c) families.add(c); });
          } catch (e) { extractFromStyle(styleJson); }
          break;
        }
      }
    }
    // Also collect icon font families
    if (node.iconFont) {
      families.add(node.iconFont);
    }
    if (node.children) {
      node.children.forEach(traverse);
    }
  }

  nodes.forEach(traverse);
  return families;
}

// Filter font faces to only those actually used
function filterUsedFonts(fontFaces, usedFontFamilies) {
  const usedFonts = new Map();

  for (const [key, font] of fontFaces) {
    const familyLower = font.family.toLowerCase();

    // For network-detected fonts, include them if they're from the same domain
    // (since we can't always determine the exact family name)
    if (font.fromNetwork) {
      // Include network fonts that were actually loaded on this page
      // They're likely being used if the browser loaded them
      usedFonts.set(key, font);
      continue;
    }

    // For stylesheet fonts, match by family name
    for (const used of usedFontFamilies) {
      const usedLower = used.toLowerCase();
      if (usedLower.includes(familyLower) || familyLower.includes(usedLower) || usedLower === familyLower) {
        usedFonts.set(key, font);
        break;
      }
    }
  }

  return usedFonts;
}

// Generate @font-face CSS rules with embedded base64 fonts
function generateFontFaceCSS(embeddedFonts) {
  let css = '';

  for (const font of embeddedFonts.values()) {
    // Skip fonts without a valid family name or data URL
    if (!font.dataUrl || !font.family || font.family === 'Unknown') {
      console.log('[Pluck] Skipping font without valid family/data:', font.family, font.url);
      continue;
    }

    css += `@font-face {
  font-family: '${font.family}';
  src: url(${font.dataUrl}) format('${font.format}');
  font-weight: ${font.weight};
  font-style: ${font.style};
  font-display: swap;
}
`;
  }

  return css;
}

// --- Check visibility ---
function isElementVisible(computed) {
  if (computed.display === 'none' ||
      computed.visibility === 'hidden' ||
      computed.opacity === '0') {
    return false;
  }

  // Check for screen-reader-only / visually hidden elements
  // These are often 1x1px or use clip to hide content visually
  const width = parseFloat(computed.width) || 0;
  const height = parseFloat(computed.height) || 0;
  const clip = computed.clip || '';
  const clipPath = computed.clipPath || '';
  const position = computed.position || '';

  // sr-only: require BOTH dims tiny — a 1×24 element is a real divider, not sr-only.
  if (position === 'absolute' && width <= 1 && height <= 1) {
    return false;
  }

  // Detect clip: rect(0,0,0,0) or clip-path: inset(50%)
  if (clip && clip !== 'auto' && clip.includes('rect(0')) {
    return false;
  }
  if (clipPath && clipPath.includes('inset(50%)')) {
    return false;
  }

  return true;
}

// --- Get hover styles by comparing normal vs hover state ---
// NOTE: Disabled event dispatch as it causes side effects on sites like GitHub
// (e.g., ProTip tooltips cycling, dynamic content changing)
function getHoverStyles(_el, _normalStyles) {
  // Disabled: dispatching mouse events caused tooltip cycling on GitHub etc.
  return null;

  /* Original implementation (disabled due to side effects):
  const HOVER_PROPS = [
    'background-color', 'color', 'opacity', 'transform', 'box-shadow',
    'border-color', 'text-decoration', 'cursor', 'outline'
  ];

  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  el.classList.add(':hover');
  el.offsetHeight;

  const hoverComputed = window.getComputedStyle(el);
  const hoverStyles = {};

  for (const prop of HOVER_PROPS) {
    let hoverValue = hoverComputed.getPropertyValue(prop);
    const normalValue = normalStyles[prop] || '';
    if (hoverValue && hoverValue !== normalValue) {
      if (prop.includes('color') || prop === 'background-color') {
        hoverValue = rgbToHex(hoverValue);
        if (!hoverValue) continue;
      }
      hoverStyles[prop] = hoverValue;
    }
  }

  el.classList.remove(':hover');
  el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

  return Object.keys(hoverStyles).length > 0 ? hoverStyles : null;
  */
}

// --- Get non-default styles as compact object ---
// Returns { shared: {}, inline: {} } where shared goes to CSS class, inline to style attribute
// Tailwind CSS detection (cached per page)
let _tailwindDetected = null;
function isTailwindPage() {
  if (_tailwindDetected !== null) return _tailwindDetected;
  const rootStyles = getComputedStyle(document.documentElement);
  for (let i = 0; i < rootStyles.length; i++) {
    if (rootStyles[i].startsWith('--tw-')) {
      _tailwindDetected = true;
      return true;
    }
  }
  _tailwindDetected = false;
  return false;
}

// --- CSS style object -> Tailwind utility class string ---
// Used when the source page is Tailwind-built; JSX output then reads as
// idiomatic utilities rather than `className={s1}` references to deduped CSS.
// Covers the common 90% with arbitrary-value fallbacks (e.g. `gap-[13px]`) for
// everything else, so output is always valid even on uncommon values.

const TW_SPACING = { // px -> Tailwind spacing scale step (0.25rem = 4px)
  '0px': '0', '1px': 'px', '2px': '0.5', '4px': '1', '6px': '1.5', '8px': '2',
  '10px': '2.5', '12px': '3', '14px': '3.5', '16px': '4', '20px': '5',
  '24px': '6', '28px': '7', '32px': '8', '36px': '9', '40px': '10',
  '44px': '11', '48px': '12', '56px': '14', '64px': '16', '80px': '20',
  '96px': '24', '112px': '28', '128px': '32', '160px': '40', '192px': '48',
  '224px': '56', '256px': '64',
};
const TW_RADIUS = {
  '0px': 'rounded-none', '2px': 'rounded-sm', '4px': 'rounded', '6px': 'rounded-md',
  '8px': 'rounded-lg', '12px': 'rounded-xl', '16px': 'rounded-2xl', '24px': 'rounded-3xl',
  '9999px': 'rounded-full', '50%': 'rounded-full',
};
const TW_FONT_WEIGHT = {
  '100': 'font-thin', '200': 'font-extralight', '300': 'font-light',
  '400': 'font-normal', '500': 'font-medium', '600': 'font-semibold',
  '700': 'font-bold', '800': 'font-extrabold', '900': 'font-black',
  'normal': 'font-normal', 'bold': 'font-bold',
};
const TW_FONT_SIZE = {
  '12px': 'text-xs', '14px': 'text-sm', '16px': 'text-base', '18px': 'text-lg',
  '20px': 'text-xl', '24px': 'text-2xl', '30px': 'text-3xl', '36px': 'text-4xl',
  '48px': 'text-5xl', '60px': 'text-6xl', '72px': 'text-7xl', '96px': 'text-8xl',
  '128px': 'text-9xl',
};
const TW_OPACITY = {
  '0': 'opacity-0', '0.05': 'opacity-5', '0.1': 'opacity-10', '0.2': 'opacity-20',
  '0.25': 'opacity-25', '0.3': 'opacity-30', '0.4': 'opacity-40', '0.5': 'opacity-50',
  '0.6': 'opacity-60', '0.7': 'opacity-70', '0.75': 'opacity-75', '0.8': 'opacity-80',
  '0.9': 'opacity-90', '0.95': 'opacity-95', '1': 'opacity-100',
};
const TW_JUSTIFY = {
  'flex-start': 'justify-start', 'flex-end': 'justify-end', 'center': 'justify-center',
  'space-between': 'justify-between', 'space-around': 'justify-around',
  'space-evenly': 'justify-evenly', 'start': 'justify-start', 'end': 'justify-end',
};
const TW_ALIGN = {
  'flex-start': 'items-start', 'flex-end': 'items-end', 'center': 'items-center',
  'baseline': 'items-baseline', 'stretch': 'items-stretch', 'start': 'items-start', 'end': 'items-end',
};
const TW_TEXT_ALIGN = {
  'left': 'text-left', 'center': 'text-center', 'right': 'text-right',
  'justify': 'text-justify', 'start': 'text-start', 'end': 'text-end',
};

function _twSpacing(prefix, val) {
  if (val in TW_SPACING) return `${prefix}-${TW_SPACING[val]}`;
  return `${prefix}-[${val}]`;
}
function _twSize(prefix, val) {
  if (val === '100%') return `${prefix}-full`;
  if (val === 'auto') return `${prefix}-auto`;
  if (val === '50%') return `${prefix}-1/2`;
  if (val === '0px' || val === '0') return `${prefix}-0`;
  if (val in TW_SPACING) return `${prefix}-${TW_SPACING[val]}`;
  return `${prefix}-[${val}]`;
}

function styleObjToTailwind(styleObj) {
  const classes = [];
  const push = (c) => { if (c) classes.push(c); };

  for (const [prop, raw] of Object.entries(styleObj)) {
    const val = String(raw).trim();
    switch (prop) {
      case 'display': {
        const map = { 'flex': 'flex', 'inline-flex': 'inline-flex', 'grid': 'grid',
          'inline-grid': 'inline-grid', 'block': 'block', 'inline-block': 'inline-block',
          'inline': 'inline', 'none': 'hidden', 'table': 'table', 'contents': 'contents' };
        push(map[val] || `[display:${val}]`);
        break;
      }
      case 'flex-direction':
        push({ 'row': 'flex-row', 'row-reverse': 'flex-row-reverse',
          'column': 'flex-col', 'column-reverse': 'flex-col-reverse' }[val]);
        break;
      case 'flex-wrap':
        push({ 'wrap': 'flex-wrap', 'nowrap': 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' }[val]);
        break;
      case 'justify-content': push(TW_JUSTIFY[val] || `[justify-content:${val}]`); break;
      case 'align-items': push(TW_ALIGN[val] || `[align-items:${val}]`); break;
      case 'align-self':
        push({ 'auto': '', 'flex-start': 'self-start', 'flex-end': 'self-end',
          'center': 'self-center', 'stretch': 'self-stretch', 'baseline': 'self-baseline' }[val]);
        break;
      case 'align-content':
        push({ 'flex-start': 'content-start', 'flex-end': 'content-end',
          'center': 'content-center', 'space-between': 'content-between',
          'space-around': 'content-around', 'stretch': 'content-stretch' }[val]);
        break;
      case 'flex-grow': push(val === '1' ? 'grow' : val === '0' ? 'grow-0' : `grow-[${val}]`); break;
      case 'flex-shrink': push(val === '1' ? 'shrink' : val === '0' ? 'shrink-0' : `shrink-[${val}]`); break;
      case 'gap': push(_twSpacing('gap', val)); break;
      case 'row-gap': push(_twSpacing('gap-y', val)); break;
      case 'column-gap': push(_twSpacing('gap-x', val)); break;

      case 'padding-top': push(_twSpacing('pt', val)); break;
      case 'padding-right': push(_twSpacing('pr', val)); break;
      case 'padding-bottom': push(_twSpacing('pb', val)); break;
      case 'padding-left': push(_twSpacing('pl', val)); break;
      case 'margin-top': push(_twSpacing('mt', val)); break;
      case 'margin-right': push(_twSpacing('mr', val)); break;
      case 'margin-bottom': push(_twSpacing('mb', val)); break;
      case 'margin-left': push(_twSpacing('ml', val)); break;

      case 'width': push(_twSize('w', val)); break;
      case 'height': push(_twSize('h', val)); break;
      case 'min-width': push(_twSize('min-w', val)); break;
      case 'min-height': push(_twSize('min-h', val)); break;
      case 'max-width': push(val === 'none' ? 'max-w-none' : _twSize('max-w', val)); break;
      case 'max-height': push(val === 'none' ? 'max-h-none' : _twSize('max-h', val)); break;

      case 'position':
        push({ 'static': 'static', 'relative': 'relative', 'absolute': 'absolute',
          'fixed': 'fixed', 'sticky': 'sticky' }[val]);
        break;
      case 'top': push(_twSize('top', val)); break;
      case 'right': push(_twSize('right', val)); break;
      case 'bottom': push(_twSize('bottom', val)); break;
      case 'left': push(_twSize('left', val)); break;
      case 'z-index': push(/^-?\d+$/.test(val) ? `z-[${val}]` : null); break;

      case 'background-color':
        push(val === 'transparent' ? 'bg-transparent' : `bg-[${val}]`);
        break;
      case 'color': push(`text-[${val}]`); break;
      case 'opacity': push(TW_OPACITY[val] || `opacity-[${val}]`); break;

      case 'font-size': push(TW_FONT_SIZE[val] || `text-[${val}]`); break;
      case 'font-weight': push(TW_FONT_WEIGHT[val] || `font-[${val}]`); break;
      case 'font-style':
        push({ 'italic': 'italic', 'normal': 'not-italic' }[val]);
        break;
      case 'font-family': push(`font-[${val.replace(/\s+/g, '_')}]`); break;
      case 'line-height':
        push({ '1': 'leading-none', '1.25': 'leading-tight', '1.375': 'leading-snug',
          '1.5': 'leading-normal', '1.625': 'leading-relaxed', '2': 'leading-loose' }[val]
          || `leading-[${val}]`);
        break;
      case 'letter-spacing':
        push({ 'normal': 'tracking-normal', '-0.05em': 'tracking-tighter',
          '-0.025em': 'tracking-tight', '0.025em': 'tracking-wide',
          '0.05em': 'tracking-wider', '0.1em': 'tracking-widest' }[val]
          || `tracking-[${val}]`);
        break;
      case 'text-align': push(TW_TEXT_ALIGN[val]); break;
      case 'text-transform':
        push({ 'uppercase': 'uppercase', 'lowercase': 'lowercase',
          'capitalize': 'capitalize', 'none': 'normal-case' }[val]);
        break;
      case 'text-decoration': {
        // computed value: "<line> <style> <color>" — first token wins.
        const td = val.split(/\s+/)[0];
        push({ 'underline': 'underline', 'line-through': 'line-through',
          'overline': 'overline', 'none': 'no-underline' }[td]);
        break;
      }
      case 'white-space':
        push({ 'normal': 'whitespace-normal', 'nowrap': 'whitespace-nowrap',
          'pre': 'whitespace-pre', 'pre-line': 'whitespace-pre-line',
          'pre-wrap': 'whitespace-pre-wrap' }[val]);
        break;

      case 'border-radius':
        push(TW_RADIUS[val] || `rounded-[${val}]`);
        break;
      case 'border-width':
        push(val === '0px' ? 'border-0' : val === '1px' ? 'border'
          : val === '2px' ? 'border-2' : val === '4px' ? 'border-4'
          : val === '8px' ? 'border-8' : `border-[${val}]`);
        break;
      case 'border-color': push(`border-[${val}]`); break;
      case 'border-style':
        push({ 'solid': 'border-solid', 'dashed': 'border-dashed',
          'dotted': 'border-dotted', 'double': 'border-double', 'none': 'border-none' }[val]);
        break;

      case 'box-shadow': push(val === 'none' ? 'shadow-none' : `shadow-[${val.replace(/\s+/g, '_')}]`); break;
      case 'overflow':
        push({ 'auto': 'overflow-auto', 'hidden': 'overflow-hidden',
          'visible': 'overflow-visible', 'scroll': 'overflow-scroll', 'clip': 'overflow-clip' }[val]);
        break;
      case 'overflow-x':
        push({ 'auto': 'overflow-x-auto', 'hidden': 'overflow-x-hidden',
          'visible': 'overflow-x-visible', 'scroll': 'overflow-x-scroll' }[val]);
        break;
      case 'overflow-y':
        push({ 'auto': 'overflow-y-auto', 'hidden': 'overflow-y-hidden',
          'visible': 'overflow-y-visible', 'scroll': 'overflow-y-scroll' }[val]);
        break;
      case 'cursor':
        push({ 'auto': '', 'pointer': 'cursor-pointer', 'default': 'cursor-default',
          'wait': 'cursor-wait', 'text': 'cursor-text', 'move': 'cursor-move',
          'not-allowed': 'cursor-not-allowed', 'grab': 'cursor-grab',
          'grabbing': 'cursor-grabbing' }[val] || `cursor-[${val}]`);
        break;
      case 'pointer-events':
        push({ 'none': 'pointer-events-none', 'auto': 'pointer-events-auto' }[val]);
        break;
      case 'user-select':
        push({ 'none': 'select-none', 'text': 'select-text',
          'all': 'select-all', 'auto': 'select-auto' }[val]);
        break;
      case 'object-fit':
        push({ 'contain': 'object-contain', 'cover': 'object-cover',
          'fill': 'object-fill', 'none': 'object-none', 'scale-down': 'object-scale-down' }[val]);
        break;
      case 'transform':
        push(val === 'none' ? '' : `[transform:${val.replace(/\s+/g, '_')}]`);
        break;
      case 'filter':
        push(val === 'none' ? '' : `[filter:${val.replace(/\s+/g, '_')}]`);
        break;
      case 'backdrop-filter':
      case '-webkit-backdrop-filter':
        push(val === 'none' ? '' : `[backdrop-filter:${val.replace(/\s+/g, '_')}]`);
        break;

      default:
        // Per-side border longhands, grid-*, anything else: arbitrary value.
        if (prop.startsWith('--')) break;
        push(`[${prop}:${val.replace(/\s+/g, '_')}]`);
    }
  }

  // Dedupe + drop empty strings.
  return Array.from(new Set(classes.filter(Boolean))).join(' ');
}

function getCompactStyles(el, isRoot = false) {
  const hadHover = el.classList.contains("web-replica-hover");
  const hadSelected = el.classList.contains("web-replica-selected");
  el.classList.remove("web-replica-hover", "web-replica-selected");

  const computed = window.getComputedStyle(el);
  const parentComputed = !isRoot && el.parentElement ? window.getComputedStyle(el.parentElement) : null;
  const shared = {};   // Goes into CSS class (deduplicated)
  const inline = {};   // Goes into style attribute (unique per element)

  const tagName = el.tagName.toLowerCase();
  const positionValue = computed.getPropertyValue('position');
  const isListElement = ['ul', 'ol', 'li'].includes(tagName);

  // Get border values to check if border should be rendered
  const borderWidth = computed.getPropertyValue('border-width');
  const borderStyle = computed.getPropertyValue('border-style');
  const borderColor = computed.getPropertyValue('border-color');
  const textColor = computed.getPropertyValue('color');

  // Check if border has meaningful styling (not just inheriting from text color)
  const hasVisibleBorder = borderWidth !== '0px' && borderStyle !== 'none';
  // Border color often inherits from text color - only keep border if colors differ significantly
  // or if border-color is explicitly a neutral/gray color
  const borderColorHex = rgbToHex(borderColor);
  const textColorHex = rgbToHex(textColor);
  const hasMeaningfulBorder = hasVisibleBorder && borderColorHex &&
    (borderColorHex !== textColorHex || isNeutralColor(borderColorHex));

  // Process SHARED properties (go into CSS classes)
  for (const prop of SHARED_PROPS) {
    // Skip list-style for non-list elements
    if (prop.startsWith('list-style') && !isListElement) continue;

    // Skip position offsets when position is static
    if (['top', 'right', 'bottom', 'left'].includes(prop) && positionValue === 'static') continue;

    // Skip all border properties if border is just inheriting text color (causes blue outlines)
    if (prop.startsWith('border-') && prop !== 'border-radius' && !hasMeaningfulBorder) continue;

    // Only emit `border-{side}-*` for sides that actually paint a border.
    const borderSideMatch = prop.match(/^border-(top|right|bottom|left)-(width|style|color)$/);
    if (borderSideMatch) {
      const side = borderSideMatch[1];
      const sideWidth = parseFloat(computed.getPropertyValue(`border-${side}-width`)) || 0;
      const sideStyle = computed.getPropertyValue(`border-${side}-style`);
      if (sideWidth <= 0 || sideStyle === 'none' || sideStyle === 'hidden') continue;
    }

    let value = computed.getPropertyValue(prop);

    // Debug: Log backdrop-filter and filter values
    if (prop.includes('backdrop') || prop === 'filter') {
      console.log('[Pluck Debug]', prop, '=', JSON.stringify(value));
    }

    // Fallback: If backdrop-filter is empty, try webkit prefix
    if (prop === 'backdrop-filter' && (!value || value === 'none')) {
      const webkitValue = computed.getPropertyValue('-webkit-backdrop-filter');
      if (webkitValue && webkitValue !== 'none') {
        value = webkitValue;
        console.log('[Pluck Debug] Using -webkit-backdrop-filter fallback:', value);
      }
    }

    // Tailwind CSS: filter out unresolved --tw-* variable references
    // getComputedStyle resolves most variables, but some internal Tailwind utility
    // variables (ring, shadow, transform) can produce odd intermediate values
    if (isTailwindPage() && typeof value === 'string') {
      // Skip properties that are purely Tailwind internal variables
      if (prop.startsWith('--tw-')) continue;
      // If the resolved value still contains var(--tw-*), it's unresolvable
      if (value.includes('var(--tw-')) continue;
    }

    if (isDefaultValue(prop, value)) continue;

    // Chrome resolves `outline` to "<currentColor> none medium" on every element;
    // drop when the shorthand has a standalone `none` token (word-boundary so
    // we don't false-match `none` inside a colour name).
    if (prop === 'outline' && /(?:^|\s)none(?:\s|$)/.test(value)) continue;

    // Inherited-prop dedup: skip on descendants when parent already provides it.
    if (!isRoot && parentComputed && INHERITED_PROPS.has(prop)) {
      const parentVal = parentComputed.getPropertyValue(prop);
      if (parentVal === value) continue;
    }

    // Shorten colors
    if (prop.includes('color') || prop === 'background-color') {
      value = rgbToHex(value);
      if (!value) continue;
    }

    // Shorten font-family
    if (prop === 'font-family') {
      value = shortenFontFamily(value);
      if (!value) continue;
    }

    shared[prop] = value;
  }

  // Process INLINE properties (Dimensions - Manual Layout Logic)
  // We use offsetWidth/offsetHeight (Border-Box) instead of computed width (Content-Box)
  // This solves the shrinking issue where padding was subtracted twice.
  
  const display = computed.getPropertyValue('display');
  const isInline = display === 'inline'; // Inline elements (span, a) ignore width/height
  
  if (!isInline && display !== 'none') {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const isMedia = ['img', 'video', 'canvas', 'svg', 'iframe', 'input', 'textarea', 'select'].includes(tagName);
      // Tags that should be allowed to expand to fit text (Fluid Strategy)
      const FLUID_TAGS = ['a', 'button', 'span', 'label', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'summary', 'cite', 'li', 'td', 'th', 'strong', 'em', 'b', 'i', 'mark', 'q', 'small', 'sub', 'sup'];
      const isFluid = FLUID_TAGS.includes(tagName);

      // Width Handling
      if (width > 0) {
          if (isMedia || !isFluid) {
              // STRICT STRATEGY: For media and structure (divs), lock the width.
              // This preserves the page layout grid.
              inline['width'] = `${width}px`;
              // We also capture min-width to prevent shrinking below this point in flex contexts
              inline['min-width'] = `${width}px`;
          } else {
              // FLUID STRATEGY: For text elements, use min-width + auto.
              // This fixes the text overflow issue. (Matches main.)
              inline['min-width'] = `${width}px`;
              inline['flex-basis'] = 'auto';
              inline['width'] = 'auto';
          }
      }
      
      // Height Handling
      if (height > 0) {
          if (isMedia || !isFluid) {
              // STRICT: media AND structural divs get an exact height, so the layout
              // matches the original pixel-for-pixel (equal-height cards, fixed bands,
              // etc.). Deliberate trade-off: if a font can't be embedded and reflows
              // taller, its text may overflow the box — the user prefers exact layout
              // over avoiding the occasional font collision. (Fonts now embed, so this
              // is rare; see collectUsedFontFamilies / the @font-face embedding path.)
              inline['height'] = `${height}px`;
              inline['min-height'] = `${height}px`;
          } else {
              // FLUID text (h1–h6, p, span, …): min-height + auto so it can wrap.
              inline['min-height'] = `${height}px`;
              inline['height'] = 'auto';
          }
      }
  }

  // For root, get inherited background
  if (isRoot && !shared['background-color']) {
    let parent = el.parentElement;
    while (parent && parent !== document.documentElement) {
      const bg = window.getComputedStyle(parent).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        shared['background-color'] = rgbToHex(bg);
        break;
      }
      parent = parent.parentElement;
    }
  }

  // Restore classes
  if (hadHover) el.classList.add("web-replica-hover");
  if (hadSelected) el.classList.add("web-replica-selected");

  const hasShared = Object.keys(shared).length > 0;
  const hasInline = Object.keys(inline).length > 0;

  if (!hasShared && !hasInline) return null;

  return { shared: hasShared ? shared : null, inline: hasInline ? inline : null };
}

// --- Build semantic structure recursively ---
function buildStructure(el, isRoot = false) {
  const tagName = el.tagName.toLowerCase();

  // Get the ORIGINAL element for computed styles (clones aren't in DOM)
  // Must be done early - needed for visibility check and SVG handling
  const originalEl = cloneToOriginal.get(el) || el;

  // Special handling for SVG - preserve entire element with all attributes
  if (tagName === 'svg') {
    // Skip decorative SVGs that are just transparent circle outlines (Google avatar rings)
    const circles = el.querySelectorAll('circle');
    const paths = el.querySelectorAll('path');
    // If SVG only contains circles with transparent/none fill and no paths with content, skip it
    if (circles.length > 0 && paths.length === 0) {
      const allTransparent = Array.from(circles).every(c => {
        const fill = c.getAttribute('fill');
        return fill === 'transparent' || fill === 'none';
      });
      if (allTransparent) {
        return null; // Skip decorative circle outlines
      }
    }

    // Clone SVG to remove extension classes before getting outerHTML
    const svgClone = el.cloneNode(true);
    // Remove extension classes from the clone and all descendants
    svgClone.classList.remove('web-replica-hover', 'web-replica-selected');
    svgClone.querySelectorAll('.web-replica-hover, .web-replica-selected').forEach(node => {
      node.classList.remove('web-replica-hover', 'web-replica-selected');
    });

    // Get computed dimensions and add inline styles to ensure SVG is visible
    // Use originalEl for computed styles since clones aren't in the DOM
    const computed = window.getComputedStyle(originalEl);
    const width = computed.width;
    const height = computed.height;
    const fill = computed.fill;

    // Add inline styles if not already present
    let existingStyle = svgClone.getAttribute('style') || '';
    if (width && width !== 'auto' && !existingStyle.includes('width')) {
      existingStyle += `width: ${width}; `;
    }
    if (height && height !== 'auto' && !existingStyle.includes('height')) {
      existingStyle += `height: ${height}; `;
    }
    if (fill && fill !== 'none' && !existingStyle.includes('fill')) {
      existingStyle += `fill: ${fill}; `;
    }
    if (existingStyle) {
      svgClone.setAttribute('style', existingStyle.trim());
    }

    return {
      tag: 'svg',
      svg: svgClone.outerHTML
    };
  }

  // Use originalEl for class manipulation and computed styles (clones aren't in DOM)
  const hadHover = originalEl.classList.contains("web-replica-hover");
  const hadSelected = originalEl.classList.contains("web-replica-selected");
  originalEl.classList.remove("web-replica-hover", "web-replica-selected");

  const computed = window.getComputedStyle(originalEl);

  // Don't prune the root selection — better a tiny element than an empty export.
  if (!isRoot && !isElementVisible(computed)) {
    if (hadHover) originalEl.classList.add("web-replica-hover");
    if (hadSelected) originalEl.classList.add("web-replica-selected");
    if (_exportDiag) _exportDiag.filteredCount++;
    return null;
  }

  // Restore for style computation
  if (hadHover) originalEl.classList.add("web-replica-hover");
  if (hadSelected) originalEl.classList.add("web-replica-selected");

  const node = {
    tag: tagName
  };

  // el is a CLONE - text is frozen at clone time, safe to read directly
  // Build ordered child nodes list (text nodes and elements interleaved)
  // This preserves the correct order: "Hello <span>World</span>!"
  const childNodesOrdered = [];

  // Check if this element might be an icon (for special text handling)
  const mightBeIcon = computed.fontFamily.toLowerCase().includes('fluent') ||
    computed.fontFamily.toLowerCase().includes('material') ||
    computed.fontFamily.toLowerCase().includes('fontawesome') ||
    computed.fontFamily.toLowerCase().includes('icon') ||
    el.classList?.contains('material-icons') ||
    el.classList?.contains('material-symbols-outlined') ||
    tagName === 'i';

  for (const childNode of el.childNodes) {
    if (childNode.nodeType === Node.TEXT_NODE) {
      // For icon elements, preserve the raw text (don't trim - icons may be single Unicode chars)
      // For regular elements, trim whitespace
      const rawText = childNode.textContent;
      const text = mightBeIcon ? rawText : rawText.trim();
      if (text.length > 0) {
        childNodesOrdered.push({ type: 'text', content: text });
      }
    } else if (childNode.nodeType === Node.ELEMENT_NODE) {
      childNodesOrdered.push({ type: 'element', el: childNode });
    }
  }

  // Capture simple text for elements with no child elements
  const textContent = childNodesOrdered
    .filter(n => n.type === 'text')
    .map(n => n.content)
    .join(mightBeIcon ? '' : ' '); // Don't add spaces for icons

  if (textContent && !Array.from(el.children).length) {
    node.text = textContent;
  }

  // For icon elements, also try to capture text if it has children but only whitespace/icon chars
  if (mightBeIcon && !node.text && el.textContent) {
    const iconText = el.textContent.trim();
    if (iconText.length > 0 && iconText.length <= 10) { // Icons are typically short
      node.text = iconText;
    }
  }

  // Get compact styles (returns { shared, inline })
  // Note: originalEl was declared at function start for visibility check
  const styleResult = getCompactStyles(originalEl, isRoot);
  if (styleResult) {
    // Shared styles go into deduplicated CSS class
    if (styleResult.shared) {
      const styleName = getOrCreateStyleName(styleResult.shared);
      node.style = styleName;

      // Capture hover styles for interactive elements
      // This dispatches mouse events, so must be done AFTER text capture
      const interactiveTags = ['a', 'button', 'input', 'select', 'textarea'];
      if (interactiveTags.includes(tagName)) {
        const hoverStyles = getHoverStyles(el, styleResult.shared);
        if (hoverStyles) {
          registerHoverStyle(styleName, hoverStyles);
        }
      }
    }

    // Inline styles (width/height) go directly on element
    if (styleResult.inline) {
      node.inlineStyle = Object.entries(styleResult.inline)
        .map(([prop, val]) => `${prop}: ${val}`)
        .join('; ');
    }
  }

  // ::before / ::after as real CSS rules — except void elements (no pseudos)
  // and icon fonts (keep glyph as text so existing icon-class plumbing renders).
  const beforePseudo = tryCapturePseudo(originalEl, 'before');
  const afterPseudo = tryCapturePseudo(originalEl, 'after');

  const usesIconFont = node.iconFont ||
    computed.fontFamily.toLowerCase().includes('fluent') ||
    computed.fontFamily.toLowerCase().includes('material') ||
    computed.fontFamily.toLowerCase().includes('fontawesome') ||
    computed.fontFamily.toLowerCase().includes('fa ') ||
    el.classList?.contains('material-icons') ||
    el.classList?.contains('material-symbols-outlined');

  if (beforePseudo || afterPseudo) {
    if (VOID_ELEMENT_TAGS.has(tagName)) {
      const src = beforePseudo || afterPseudo;
      if (src.content && !textContent) {
        node.text = src.content;
        node.fromPseudo = true;
      }
      if (styleResult && styleResult.shared) {
        for (const [prop, val] of Object.entries(src.styles)) {
          if (!styleResult.shared[prop]) styleResult.shared[prop] = val;
        }
      }
    } else if (usesIconFont && (beforePseudo?.content || afterPseudo?.content)) {
      const src = (beforePseudo && beforePseudo.content) ? beforePseudo : afterPseudo;
      if (src.content && !textContent) {
        node.text = src.content;
        node.fromPseudo = true;
      }
    } else {
      const bundle = {};
      if (beforePseudo) bundle.before = beforePseudo;
      if (afterPseudo) bundle.after = afterPseudo;
      node.pseudoClass = getOrCreatePseudoClass(bundle);
      // Letter-avatar pattern: pseudo content stands in for missing text.
      if (beforePseudo && beforePseudo.content && !textContent && el.children.length === 0) {
        node.fromPseudo = true;
      }
    }
  }

  // Process children using the ordered list (preserves text/element interleaving)
  const shadowRoot = getShadowRoot(el);

  // Build ordered content array with both text and processed child elements
  const orderedContent = [];

  // If element has Shadow DOM, process shadow children first
  if (shadowRoot) {
    for (const shadowChild of shadowRoot.children) {
      const childNode = buildStructure(shadowChild, false);
      if (childNode) {
        orderedContent.push({ type: 'element', node: childNode });
      }
    }
  }

  // Process light DOM children in order (using our captured order)
  for (const item of childNodesOrdered) {
    if (item.type === 'text') {
      orderedContent.push({ type: 'text', content: item.content });
    } else if (item.type === 'element') {
      const childNode = buildStructure(item.el, false);
      if (childNode) {
        // Check if this child has any meaningful content to export
        const hasText = childNode.text;
        const hasChildren = childNode.orderedContent?.length > 0 || childNode.children?.length > 0;
        const hasSvg = childNode.svg;
        const hasImage = childNode.src;
        const hasDecorativePseudo = childNode.pseudoClass;

        // Skip empty <span>s (overlay decorations); keep anything with content or a pseudo.
        const isEmptySpan = childNode.tag === 'span' && !hasText && !hasChildren && !hasSvg && !hasImage && !hasDecorativePseudo;

        if (isEmptySpan) {
          continue; // Skip empty decorative spans
        }

        orderedContent.push({ type: 'element', node: childNode });
      }
    }
  }

  if (orderedContent.length > 0) {
    node.orderedContent = orderedContent;
    // Also keep children array for backward compat
    node.children = orderedContent
      .filter(c => c.type === 'element')
      .map(c => c.node);
  }

  // Add useful attributes
  if (el.href) node.href = el.href;
  if (el.src) node.src = el.src;
  if (el.alt) node.alt = el.alt;

  // Capture placeholder - use aria-label as fallback for inputs without placeholder
  if (el.placeholder) {
    node.placeholder = el.placeholder;
  } else if ((tagName === 'input' || tagName === 'textarea') && el.getAttribute('aria-label')) {
    node.placeholder = el.getAttribute('aria-label');
  }

  if (el.type && (tagName === 'input' || tagName === 'button')) node.type = el.type;
  if (el.value && (tagName === 'input' || tagName === 'textarea')) node.value = el.value;

  // Capture aria-label for accessibility
  if (el.getAttribute('aria-label')) node.ariaLabel = el.getAttribute('aria-label');

  // Check for icon font usage. Match only the PRIMARY (first) font family — an icon
  // font is always the element's own font (e.g. "Material Symbols Outlined").
  // Matching anywhere in the stack falsely flagged normal text whose fallback chain
  // ends in "Segoe UI Symbol"/emoji fonts (all of Notion), rendering text as glyphs.
  const fontFamily = computed.getPropertyValue('font-family').toLowerCase();
  const primaryFont = (fontFamily.split(',')[0] || '').trim().replace(/["']/g, '');
  const SYSTEM_SYMBOL_FONTS = ['segoe ui symbol', 'segoe ui emoji', 'apple color emoji', 'noto color emoji', 'noto sans symbols', 'noto sans symbols 2'];
  const isIconFont = !SYSTEM_SYMBOL_FONTS.includes(primaryFont) && (
    primaryFont.includes('material icons') ||
    primaryFont.includes('material symbols') ||
    primaryFont.includes('google material') ||
    primaryFont.includes('awesome') ||
    /\bicon(s|font)?\b/.test(primaryFont) ||
    primaryFont.includes('symbol')
  );

  // Icon-font class conventions only (not any class that merely contains "icon").
  const classListStr = el.className && typeof el.className === 'string' ? el.className.toLowerCase() : '';
  const hasIconClass = /\bmaterial-(icons|symbols)\b/.test(classListStr) ||
                       /\bfa-/.test(classListStr) ||
                       /\b(fa|fas|far|fab|fal)\b/.test(classListStr);

  if ((isIconFont || hasIconClass) && textContent) {
    node.isIcon = true;
    if (primaryFont.includes('symbol') || /\bmaterial-symbols\b/.test(classListStr)) {
      node.iconFont = 'material-symbols';
    } else if (primaryFont.includes('material') || classListStr.includes('material')) {
      node.iconFont = 'material-icons';
    } else if (primaryFont.includes('awesome') || /\bfa/.test(classListStr)) {
      node.iconFont = 'fontawesome';
    } else {
      node.iconFont = primaryFont;
    }
  }

  return node;
}

// --- Get ancestor including Shadow DOM host ---
function getAncestor(el) {
  if (el.parentElement) return el.parentElement;
  // Check if we're in a shadow root and need to get the host
  if (el.parentNode && el.parentNode.host) {
    return el.parentNode.host;
  }
  return null;
}

// --- Get top-level selections (handles Shadow DOM) ---
function getTopLevelSelections() {
  const topLevel = [];
  selectedElements.forEach((el) => {
    let ancestor = getAncestor(el);
    let hasSelectedAncestor = false;
    while (ancestor) {
      if (selectedElements.has(ancestor)) {
        hasSelectedAncestor = true;
        break;
      }
      ancestor = getAncestor(ancestor);
    }
    if (!hasSelectedAncestor) {
      topLevel.push(el);
    }
  });
  return topLevel;
}

// --- Convert style object to CSS string ---
function styleObjToCss(styleObj) {
  return Object.entries(styleObj)
    .map(([prop, value]) => `${prop}: ${value}`)
    .join('; ');
}

// --- Escape HTML special characters ---
function escapeHtml(str) {
  if (!str) return str;
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
}

// --- Build HTML from structure ---
function structureToHtml(node, indent = 0, preserve = false) {
  const tag = node.tag;
  // Whitespace-preserving elements (pre/code/textarea, or anything nested inside one)
  // must NOT be pretty-printed — injected indentation/newlines are rendered as blank
  // lines and stray background rectangles (e.g. GitHub inline `code`, code blocks).
  const pre = preserve || tag === 'pre' || tag === 'code' || tag === 'textarea';
  const pad = pre ? '' : '  '.repeat(indent);

  // SVG - output the preserved outerHTML directly
  if (node.svg) {
    return `${pad}${node.svg}`;
  }

  // Build attributes: class (shared styles) + style (inline dimensions)
  let attrs = '';
  let classes = [];
  if (node.style) classes.push(node.style);
  if (node.pseudoClass) classes.push(node.pseudoClass);

  // Add icon font class if needed - this class makes the icon text render as actual icons
  if (node.isIcon && node.iconFont) {
    if (node.iconFont.includes('symbol')) {
      classes.push('material-symbols-outlined');
    } else if (node.iconFont.includes('material') || node.iconFont.includes('google')) {
      classes.push('material-icons');
    } else if (node.iconFont.includes('fontawesome') || node.iconFont.includes('fa')) {
      // Font Awesome icons use specific classes, keep original
    } else {
      classes.push('material-icons'); // Default to material icons
    }
  }

  if (classes.length > 0) {
    attrs += ` class="${classes.join(' ')}"`;
  }
  let inlineStyleParts = [];
  if (node.inlineStyle) {
    inlineStyleParts.push(node.inlineStyle);
  }

  if (inlineStyleParts.length > 0) {
    attrs += ` style="${inlineStyleParts.join('; ')}"`;
  }

  // Self-closing tags
  if (['img', 'input', 'br', 'hr'].includes(tag)) {
    if (node.src) attrs += ` src="${node.src}"`;
    if (node.alt) attrs += ` alt="${escapeHtml(node.alt)}"`;
    if (node.type) attrs += ` type="${node.type}"`;
    // Use placeholder, or aria-label as fallback for placeholder display
    const placeholder = node.placeholder || node.ariaLabel;
    if (placeholder) attrs += ` placeholder="${escapeHtml(placeholder)}"`;
    if (node.value) attrs += ` value="${escapeHtml(node.value)}"`;
    // For inputs, override tiny widths to show placeholder properly and ensure flex-grow
    if (tag === 'input') {
      const hasSmallWidth = node.inlineStyle && (node.inlineStyle.includes('width: 1px') || node.inlineStyle.includes('width: 0'));
      if (hasSmallWidth || !node.inlineStyle) {
        // Remove existing style if present and add proper width
        attrs = attrs.replace(/style="[^"]*"/, '');
        attrs += ` style="width: 100%; min-width: 0; flex-grow: 1;"`;
      }
    }
    return `${pad}<${tag}${attrs}>`;
  }

  // Textarea needs placeholder and value
  if (tag === 'textarea') {
    const placeholder = node.placeholder || node.ariaLabel;
    if (placeholder) attrs += ` placeholder="${escapeHtml(placeholder)}"`;
    const content = node.value || node.text || '';
    return `${pad}<${tag}${attrs}>${escapeHtml(content)}</${tag}>`;
  }

  if (node.href) attrs += ` href="${node.href}"`;
  if (node.ariaLabel) attrs += ` aria-label="${node.ariaLabel}"`;

  // No children and just text - don't apply fixed width/height that could cause wrapping/clipping
  if (!node.children && node.text) {
    // Build inline styles for text elements
    let stylesParts = [];

    // Use inline styles as-is, trusting getCompactStyles logic
    if (node.inlineStyle) {
      stylesParts.push(node.inlineStyle);
    }

    const finalStyle = stylesParts.join('; ');

    // Rebuild attrs
    attrs = '';
    let classes = [];
    if (node.style) classes.push(node.style);
  if (node.pseudoClass) classes.push(node.pseudoClass);
    if (node.isIcon && node.iconFont) {
      if (node.iconFont.includes('symbol')) classes.push('material-symbols-outlined');
      else classes.push('material-icons');
    }
    if (classes.length > 0) attrs += ` class="${classes.join(' ')}"`;
    if (finalStyle) attrs += ` style="${finalStyle}"`;
    if (node.href) attrs += ` href="${node.href}"`;
    if (node.ariaLabel) attrs += ` aria-label="${node.ariaLabel}"`;
    return `${pad}<${tag}${attrs}>${node.text}</${tag}>`;
  }

  // Has children - use orderedContent to preserve text/element interleaving
  let html = `${pad}<${tag}${attrs}>`;

  if (node.orderedContent && node.orderedContent.length > 0) {
    if (!pre) html += '\n';
    for (const item of node.orderedContent) {
      if (item.type === 'text') {
        html += pre ? item.content : `${pad}  ${item.content}\n`;
      } else if (item.type === 'element') {
        html += pre ? structureToHtml(item.node, 0, true) : structureToHtml(item.node, indent + 1) + '\n';
      }
    }
    if (!pre) html += pad;
  } else if (node.text) {
    // Fallback for simple text nodes
    html += node.text;
  } else if (node.children) {
    // Fallback for old-style children array
    if (!pre) html += '\n';
    for (const child of node.children) {
      html += pre ? structureToHtml(child, 0, true) : structureToHtml(child, indent + 1) + '\n';
    }
    if (!pre) html += pad;
  }

  html += `</${tag}>`;
  return html;
}

// --- JSX Helpers ---

// Map HTML attributes to JSX equivalents
const HTML_TO_JSX_ATTRS = {
  'class': 'className',
  'for': 'htmlFor',
  'tabindex': 'tabIndex',
  'readonly': 'readOnly',
  'maxlength': 'maxLength',
  'cellpadding': 'cellPadding',
  'cellspacing': 'cellSpacing',
  'colspan': 'colSpan',
  'rowspan': 'rowSpan',
  'enctype': 'encType',
  'contenteditable': 'contentEditable',
  'crossorigin': 'crossOrigin',
  'accesskey': 'accessKey',
  'autocomplete': 'autoComplete',
  'autofocus': 'autoFocus',
  'autoplay': 'autoPlay',
};

// Convert CSS property name to camelCase for JSX style objects
function cssPropToCamel(prop) {
  // Handle vendor prefixes
  if (prop.startsWith('-webkit-')) prop = prop.replace('-webkit-', 'Webkit');
  else if (prop.startsWith('-moz-')) prop = prop.replace('-moz-', 'Moz');
  else if (prop.startsWith('-ms-')) prop = prop.replace('-ms-', 'ms');
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Convert CSS string to JSX style object string
// "color: red; font-size: 14px" → '{ color: "red", fontSize: "14px" }'
function cssStringToJsxStyleObj(cssString) {
  if (!cssString) return null;
  const parts = cssString.split(';').filter(s => s.trim());
  if (parts.length === 0) return null;
  const entries = parts.map(decl => {
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) return null;
    const prop = decl.substring(0, colonIdx).trim();
    const val = decl.substring(colonIdx + 1).trim();
    const camelProp = cssPropToCamel(prop);
    // Numbers without units stay as numbers, everything else is a string
    const numericVal = parseFloat(val);
    if (!isNaN(numericVal) && String(numericVal) === val) {
      return `${camelProp}: ${val}`;
    }
    return `${camelProp}: "${val}"`;
  }).filter(Boolean);
  return `{ ${entries.join(', ')} }`;
}

// Escape text for JSX (curly braces need escaping)
function escapeJsx(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

// --- Build JSX from structure ---
function structureToJsx(node, indent = 0) {
  const pad = '  '.repeat(indent);
  const tag = node.tag;

  // SVG - output preserved outerHTML directly (JSX-compatible SVGs)
  if (node.svg) {
    // Convert SVG attributes to JSX-compatible ones
    let svgStr = node.svg;
    svgStr = svgStr.replace(/class="/g, 'className="');
    svgStr = svgStr.replace(/clip-path="/g, 'clipPath="');
    svgStr = svgStr.replace(/fill-rule="/g, 'fillRule="');
    svgStr = svgStr.replace(/clip-rule="/g, 'clipRule="');
    svgStr = svgStr.replace(/stroke-width="/g, 'strokeWidth="');
    svgStr = svgStr.replace(/stroke-linecap="/g, 'strokeLinecap="');
    svgStr = svgStr.replace(/stroke-linejoin="/g, 'strokeLinejoin="');
    svgStr = svgStr.replace(/fill-opacity="/g, 'fillOpacity="');
    svgStr = svgStr.replace(/stroke-opacity="/g, 'strokeOpacity="');
    svgStr = svgStr.replace(/stroke-dasharray="/g, 'strokeDasharray="');
    svgStr = svgStr.replace(/stroke-dashoffset="/g, 'strokeDashoffset="');
    svgStr = svgStr.replace(/font-size="/g, 'fontSize="');
    svgStr = svgStr.replace(/font-family="/g, 'fontFamily="');
    svgStr = svgStr.replace(/text-anchor="/g, 'textAnchor="');
    svgStr = svgStr.replace(/xmlns:xlink="/g, 'xmlnsXlink="');
    return `${pad}${svgStr}`;
  }

  // Build JSX attributes
  let attrs = '';
  let classes = [];
  if (node.style) {
    const tw = _tailwindStyles && _tailwindStyles[node.style];
    classes.push(tw || node.style);
  }
  if (node.pseudoClass) classes.push(node.pseudoClass);

  // Icon font class
  if (node.isIcon && node.iconFont) {
    if (node.iconFont.includes('symbol')) {
      classes.push('material-symbols-outlined');
    } else if (node.iconFont.includes('material') || node.iconFont.includes('google')) {
      classes.push('material-icons');
    }
  }

  if (classes.length > 0) {
    attrs += ` className="${classes.join(' ')}"`;
  }

  // Build inline style as JSX object
  let inlineStyleParts = [];
  if (node.inlineStyle) inlineStyleParts.push(node.inlineStyle);

  if (inlineStyleParts.length > 0) {
    const styleObj = cssStringToJsxStyleObj(inlineStyleParts.join('; '));
    if (styleObj) {
      attrs += ` style={${styleObj}}`;
    }
  }

  // Self-closing tags
  const voidElements = ['img', 'input', 'br', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'];
  if (voidElements.includes(tag)) {
    if (node.src) attrs += ` src="${node.src}"`;
    if (node.alt) attrs += ` alt="${escapeHtml(node.alt)}"`;
    if (node.type) attrs += ` type="${node.type}"`;
    const placeholder = node.placeholder || node.ariaLabel;
    if (placeholder) attrs += ` placeholder="${escapeHtml(placeholder)}"`;
    if (node.value) attrs += ` value="${escapeHtml(node.value)}"`;
    // Fix input width for JSX
    if (tag === 'input') {
      const hasSmallWidth = node.inlineStyle && (node.inlineStyle.includes('width: 1px') || node.inlineStyle.includes('width: 0'));
      if (hasSmallWidth || !node.inlineStyle) {
        attrs = attrs.replace(/style=\{[^}]*\}/, '');
        attrs += ` style={{ width: "100%", minWidth: 0, flexGrow: 1 }}`;
      }
    }
    return `${pad}<${tag}${attrs} />`;
  }

  // Textarea
  if (tag === 'textarea') {
    const placeholder = node.placeholder || node.ariaLabel;
    if (placeholder) attrs += ` placeholder="${escapeHtml(placeholder)}"`;
    const content = node.value || node.text || '';
    return `${pad}<${tag}${attrs}>{${JSON.stringify(content)}}</${tag}>`;
  }

  if (node.href) attrs += ` href="${node.href}"`;
  if (node.ariaLabel) attrs += ` aria-label="${node.ariaLabel}"`;

  // No children, just text
  if (!node.children && node.text) {
    let stylesParts = [];
    if (node.inlineStyle) stylesParts.push(node.inlineStyle);
    const finalStyle = stylesParts.join('; ');

    // Rebuild attrs for text elements
    attrs = '';
    let textClasses = [];
    if (node.style) {
      const tw = _tailwindStyles && _tailwindStyles[node.style];
      textClasses.push(tw || node.style);
    }
    if (node.pseudoClass) textClasses.push(node.pseudoClass);
    if (node.isIcon && node.iconFont) {
      if (node.iconFont.includes('symbol')) textClasses.push('material-symbols-outlined');
      else textClasses.push('material-icons');
    }
    if (textClasses.length > 0) attrs += ` className="${textClasses.join(' ')}"`;
    if (finalStyle) {
      const styleObj = cssStringToJsxStyleObj(finalStyle);
      if (styleObj) attrs += ` style={${styleObj}}`;
    }
    if (node.href) attrs += ` href="${node.href}"`;
    if (node.ariaLabel) attrs += ` aria-label="${node.ariaLabel}"`;
    return `${pad}<${tag}${attrs}>${escapeJsx(node.text)}</${tag}>`;
  }

  // Has children - use orderedContent
  let jsx = `${pad}<${tag}${attrs}>`;

  if (node.orderedContent && node.orderedContent.length > 0) {
    jsx += '\n';
    for (const item of node.orderedContent) {
      if (item.type === 'text') {
        jsx += `${pad}  ${escapeJsx(item.content)}\n`;
      } else if (item.type === 'element') {
        jsx += structureToJsx(item.node, indent + 1) + '\n';
      }
    }
    jsx += pad;
  } else if (node.text) {
    jsx += escapeJsx(node.text);
  } else if (node.children) {
    jsx += '\n';
    for (const child of node.children) {
      jsx += structureToJsx(child, indent + 1) + '\n';
    }
    jsx += pad;
  }

  jsx += `</${tag}>`;
  return jsx;
}

// Global map to link clones back to originals (for style computation)
let cloneToOriginal = new Map();

// Build a mapping from cloned nodes to original nodes (for getComputedStyle)
function buildCloneMapping(original, clone, map) {
  map.set(clone, original);
  const origChildren = Array.from(original.children);
  const cloneChildren = Array.from(clone.children);
  for (let i = 0; i < origChildren.length && i < cloneChildren.length; i++) {
    buildCloneMapping(origChildren[i], cloneChildren[i], map);
  }
}

// --- Build compact JSON export ---
async function buildExport() {
  console.log('[Pluck] buildExport called, selectedElements.size:', selectedElements.size);
  selectedElements.forEach((el, idx) => {
    console.log('[Pluck] Selected element', idx, ':', el.tagName, el);
  });
  if (!selectedElements.size) return null;

  // Signal the dock to show its loader now (covers every trigger); it hides on result.
  try { chrome.runtime.sendMessage({ type: 'EXPORT_STARTED' }, () => void chrome.runtime.lastError); } catch (e) {}

  resetStyleRegistry();
  cloneToOriginal = new Map();
  _tailwindStyles = null;

  _exportDiag = {
    selectionCount: 0,
    groupCount: 0,
    wrapperCount: 0,
    filteredCount: 0,
    selections: [],
    styleCount: 0,
    pseudoStyleCount: 0,
    hoverStyleCount: 0,
  };

  const topLevel = getTopLevelSelections();
  _exportDiag.selectionCount = topLevel.length;

  // Group selections by layout parent so siblings keep their flex/grid context.
  const groups = new Map();
  for (const el of topLevel) {
    const layoutParent = getLayoutParent(el);
    const useWrapper = layoutParent &&
      layoutParent !== document.body &&
      layoutParent !== document.documentElement;
    const key = useWrapper ? layoutParent : null;
    if (!groups.has(key)) {
      groups.set(key, { parent: useWrapper ? layoutParent : null, originals: [] });
    }
    groups.get(key).originals.push(el);
  }
  _exportDiag.groupCount = groups.size;

  const structures = [];

  for (const { parent, originals } of groups.values()) {
    const built = [];
    let hasPositioned = false;

    for (const original of originals) {
      // Clone FRESH at export: a stale selection-time clone can diverge from the live DOM
      // (index-paired mapping then falls back to INITIAL styles, collapsing flex rows).
      const clone = original.cloneNode(true);
      buildCloneMapping(original, clone, cloneToOriginal);

      const structure = buildStructure(clone, true);

      const rect = original.getBoundingClientRect();
      const className = (typeof original.className === 'string')
        ? original.className.split(/\s+/).filter(c => c && !c.startsWith('web-replica-')).slice(0, 3).join(' ').slice(0, 60)
        : '';
      _exportDiag.selections.push({
        tag: original.tagName.toLowerCase(),
        className,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        wrapped: !!parent,
        kept: !!structure,
      });

      if (!structure) continue;

      const ocs = window.getComputedStyle(original);
      if (ocs.position === 'absolute' || ocs.position === 'fixed') hasPositioned = true;
      built.push({ structure, original });
    }

    if (built.length === 0) continue;

    if (parent) {
      const parentStyles = captureLayoutParentStyles(parent, hasPositioned);
      const childNodes = built.map(({ structure }) => structure);
      const wrapper = {
        tag: 'div',
        style: Object.keys(parentStyles).length > 0 ? getOrCreateStyleName(parentStyles) : undefined,
        children: childNodes,
        orderedContent: childNodes.map(node => ({ type: 'element', node })),
      };
      structures.push(wrapper);
      _exportDiag.wrapperCount++;
    } else {
      // No parent context — normalize orphan abs/fixed so offsets don't resolve against <body>.
      for (const { structure, original } of built) {
        const ocs = window.getComputedStyle(original);
        if (ocs.position === 'absolute' || ocs.position === 'fixed') {
          const overrides = 'position: relative; top: auto; right: auto; bottom: auto; left: auto';
          structure.inlineStyle = structure.inlineStyle
            ? `${structure.inlineStyle}; ${overrides}`
            : overrides;
        }
        structures.push(structure);
      }
    }
  }

  // Build styles object from registry (as CSS strings for compactness)
  const styles = {};
  const tailwindMode = isTailwindPage();
  _tailwindStyles = tailwindMode ? {} : null;
  styleRegistry.forEach((name, styleJson) => {
    const styleObj = JSON.parse(styleJson);
    styles[name] = styleObjToCss(styleObj);
    if (_tailwindStyles) _tailwindStyles[name] = styleObjToTailwind(styleObj);
  });

  // Build hover styles object
  const hoverStyles = {};
  hoverStyleRegistry.forEach((hoverObj, styleName) => {
    hoverStyles[styleName] = styleObjToCss(hoverObj);
  });

  const structure = structures.length === 1 ? structures[0] : structures;

  // Build TOON (Token-Optimized Object Notation) - more efficient for LLMs
  // Format: Minimal syntax, abbreviated keys, no redundant quotes
  function structureToToon(node, indent = 0) {
    const pad = '  '.repeat(indent);
    let toon = `${pad}`;

    // Tag with style class
    toon += node.tag;
    if (node.style) toon += `.${node.style}`;
    if (node.pseudoClass) toon += `.${node.pseudoClass}`;
    if (node.inlineStyle) toon += `[${node.inlineStyle}]`;

    // Attributes on same line
    const attrs = [];
    if (node.href) attrs.push(`href="${node.href}"`);
    if (node.src) attrs.push(`src="${node.src}"`);
    if (node.alt) attrs.push(`alt="${node.alt}"`);
    if (node.type) attrs.push(`type="${node.type}"`);
    if (node.placeholder) attrs.push(`placeholder="${node.placeholder}"`);
    if (node.value) attrs.push(`value="${node.value}"`);
    if (node.ariaLabel) attrs.push(`aria-label="${node.ariaLabel}"`);
    if (node.isIcon) attrs.push(`icon`);
    if (attrs.length) toon += ` (${attrs.join(' ')})`;

    // Text content
    if (node.text) toon += ` "${node.text}"`;

    // SVG (inline)
    if (node.svg) {
      return `${pad}SVG: ${node.svg}`;
    }

    // Children
    if (node.children && node.children.length > 0) {
      toon += ' {\n';
      for (const child of node.children) {
        toon += structureToToon(child, indent + 1) + '\n';
      }
      toon += `${pad}}`;
    }

    return toon;
  }

  // Build TOON output
  let toon = `# Component Structure (TOON format)
# Paste to Claude: "Replicate this component in React/Vue/Tailwind"
# Format: tag.class[inline-style] (attrs) "text" { children }

## Styles\n`;

  for (const [name, cssString] of Object.entries(styles)) {
    toon += `.${name}: ${cssString}\n`;
  }

  if (Object.keys(hoverStyles).length > 0) {
    toon += `\n## Hover Styles\n`;
    for (const [name, cssString] of Object.entries(hoverStyles)) {
      toon += `.${name}:hover: ${cssString}\n`;
    }
  }

  if (pseudoStyleRegistry.size > 0) {
    toon += `\n## Pseudo Styles\n`;
    pseudoStyleRegistry.forEach(({ className, bundle }) => {
      if (bundle.before) {
        const body = Object.keys(bundle.before.styles).length
          ? '; ' + styleObjToCss(bundle.before.styles)
          : '';
        toon += `.${className}::before: content:'${bundle.before.content}'${body}\n`;
      }
      if (bundle.after) {
        const body = Object.keys(bundle.after.styles).length
          ? '; ' + styleObjToCss(bundle.after.styles)
          : '';
        toon += `.${className}::after: content:'${bundle.after.content}'${body}\n`;
      }
    });
  }

  toon += `\n## Structure\n`;
  if (Array.isArray(structure)) {
    for (const s of structure) {
      toon += structureToToon(s) + '\n\n';
    }
  } else {
    toon += structureToToon(structure);
  }

  // Build HTML preview - sanitize problematic CSS values
  function sanitizeCss(cssString) {
    let result = cssString
      // Fix overflow: clip which may not be supported everywhere
      .replace(/overflow:\s*clip/g, 'overflow: hidden')
      .replace(/overflow-x:\s*clip/g, 'overflow-x: hidden')
      .replace(/overflow-y:\s*clip/g, 'overflow-y: hidden');

    // Add webkit prefix for backdrop-filter (cross-browser support)
    // If we have backdrop-filter but no -webkit-backdrop-filter, add it
    if (result.includes('backdrop-filter:') && !result.includes('-webkit-backdrop-filter:')) {
      const backdropMatch = result.match(/backdrop-filter:\s*([^;]+)/);
      if (backdropMatch) {
        result = result.replace(
          /backdrop-filter:\s*([^;]+)/,
          `backdrop-filter: ${backdropMatch[1]}; -webkit-backdrop-filter: ${backdropMatch[1]}`
        );
      }
    }

    return result;
  }

  let css = '';
  for (const [name, cssString] of Object.entries(styles)) {
    css += `.${name} { ${sanitizeCss(cssString)}; }\n`;
  }
  // Add hover styles
  for (const [name, cssString] of Object.entries(hoverStyles)) {
    css += `.${name}:hover { ${sanitizeCss(cssString)}; }\n`;
  }
  pseudoStyleRegistry.forEach(({ className, bundle }) => {
    if (bundle.before) {
      const body = Object.keys(bundle.before.styles).length
        ? `${sanitizeCss(styleObjToCss(bundle.before.styles))}; `
        : '';
      css += `.${className}::before { content: '${escapePseudoContent(bundle.before.content)}'; ${body}}\n`;
    }
    if (bundle.after) {
      const body = Object.keys(bundle.after.styles).length
        ? `${sanitizeCss(styleObjToCss(bundle.after.styles))}; `
        : '';
      css += `.${className}::after { content: '${escapePseudoContent(bundle.after.content)}'; ${body}}\n`;
    }
  });

  const bodyHtml = Array.isArray(structure)
    ? structure.map(s => structureToHtml(s)).join('\n\n')
    : structureToHtml(structure);

  // Detect which icon fonts are used in the structure
  const usedIconFonts = new Set();
  function findIconFonts(node) {
    if (node.isIcon && node.iconFont) {
      usedIconFonts.add(node.iconFont.toLowerCase());
    }
    if (node.children) {
      node.children.forEach(findIconFonts);
    }
  }
  if (Array.isArray(structure)) {
    structure.forEach(findIconFonts);
  } else {
    findIconFonts(structure);
  }

  // Build font links - icons and web fonts
  let fontLinks = '';

  // Add icon fonts if detected
  if (usedIconFonts.size > 0) {
    fontLinks += '  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">\n';
    fontLinks += '  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">\n';

    for (const font of usedIconFonts) {
      if (font.includes('fontawesome') || font.includes('fa')) {
        fontLinks += '  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">\n';
      }
    }
  }

  // Add detected web fonts from Google Fonts
  const webFonts = getDetectedFonts();
  if (webFonts.size > 0) {
    const fontFamilies = Array.from(webFonts).map(f => {
      // Convert font name to Google Fonts URL format
      const formatted = f.replace(/\s+/g, '+');
      return `family=${formatted}:wght@400;500;600;700`;
    }).join('&');
    fontLinks += `  <link href="https://fonts.googleapis.com/css2?${fontFamilies}&display=swap" rel="stylesheet">\n`;
  }

  // Extract and embed custom WOFF/WOFF2 fonts
  let embeddedFontCSS = '';
  const exportFontFaces = []; // Surfaced to preview for the Download Fonts button.
  try {
    console.log('[Pluck] Extracting @font-face rules...');
    const allFontFaces = await extractFontFaces();
    console.log('[Pluck] Found', allFontFaces.size, 'font faces');

    if (allFontFaces.size > 0) {
      // Collect font families used in the selected elements
      const structureArray = Array.isArray(structure) ? structure : [structure];
      const usedFontFamilies = collectUsedFontFamilies(structureArray);

      // Also add icon font families that were detected
      for (const iconFont of usedIconFonts) {
        usedFontFamilies.add(iconFont);
      }

      console.log('[Pluck] Used font families:', Array.from(usedFontFamilies));

      // Filter to only fonts actually used
      const usedFonts = filterUsedFonts(allFontFaces, usedFontFamilies);
      console.log('[Pluck] Fonts to embed:', usedFonts.size);

      // Fetch fonts in PARALLEL — serial awaits summed every font's latency.
      await Promise.all(Array.from(usedFonts.values()).map(async (font) => {
        console.log('[Pluck] Fetching font:', font.family, font.url);
        font.dataUrl = await fetchFontAsBase64(font.url);
        if (font.dataUrl) {
          console.log('[Pluck] Successfully embedded:', font.family);
          // Strip `data:<mime>;base64,` so the preview can decode raw bytes.
          const base64 = font.dataUrl.split(',')[1] || '';
          exportFontFaces.push({
            family: font.family,
            weight: String(font.weight || '400'),
            style: String(font.style || 'normal'),
            format: font.format,
            base64,
            ok: !!base64,
          });
        }
      }));

      // Generate @font-face CSS
      embeddedFontCSS = generateFontFaceCSS(usedFonts);
    }
  } catch (e) {
    console.warn('[Pluck] Font embedding error:', e.message);
  }
  if (_exportDiag) _exportDiag.bundledFontCount = exportFontFaces.filter(f => f.ok).length;

  // Check if any styles use backdrop-filter (need background to show effect)
  const hasBackdropFilter = css.includes('backdrop-filter');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Component Preview</title>
${fontLinks}  <style>
${embeddedFontCSS}/* Reset base styles */
html, body { margin: 0; padding: 0; }
${hasBackdropFilter ? `html { background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%); min-height: 100vh; }` : ''}
body { padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"; box-sizing: border-box; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; font-size: 14px; line-height: 1.5; }
/* Reset list styles - inherit colors from parent */
ul, ol { list-style: none; margin: 0; padding: 0; background: inherit; color: inherit; }
li { list-style: none; background: inherit; color: inherit; }
/* Ensure all elements inherit box-sizing and prevent overflow issues */
*, *::before, *::after { box-sizing: border-box; }
img, video, svg, canvas { max-width: 100%; }
/* Fix button/input/link resets - inherit colors from parent */
button { background: transparent; border: none; cursor: pointer; color: inherit; padding: 0; }
input { background: transparent; border: none; outline: none; color: inherit; min-width: 0; }
input::placeholder { color: inherit; opacity: 0.5; }
a { color: inherit; text-decoration: inherit; }
/* Ensure proper inline display */
span { display: inline; }
/* Flex container fixes */
/* [style*="display: flex"], [style*="display:flex"] { min-width: 0; } */
/* Icon font styles - using !important to override captured styles */
.material-icons {
  font-family: 'Material Icons', 'Google Material Icons' !important;
  font-weight: normal !important;
  font-style: normal !important;
  letter-spacing: normal !important;
  text-transform: none !important;
  white-space: nowrap !important;
  word-wrap: normal !important;
  direction: ltr !important;
  -webkit-font-feature-settings: 'liga' !important;
  font-feature-settings: 'liga' !important;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  -moz-osx-font-smoothing: grayscale;
}
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined' !important;
  font-weight: normal !important;
  font-style: normal !important;
  letter-spacing: normal !important;
  text-transform: none !important;
  white-space: nowrap !important;
  word-wrap: normal !important;
  direction: ltr !important;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  -moz-osx-font-smoothing: grayscale;
}
/* Captured component styles */
${css}
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  // Build JSX output
  const jsxBody = Array.isArray(structure)
    ? structure.map(s => structureToJsx(s, 3)).join('\n\n')
    : structureToJsx(structure, 3);

  const jsxComponent = tailwindMode
    ? `// Tailwind classes — source page detected as Tailwind-built.
import React from 'react';

const Component = () => {
  return (
    <>
${jsxBody}
    </>
  );
};

export default Component;`
    : `import React from 'react';
import './Component.css';

const Component = () => {
  return (
    <>
${jsxBody}
    </>
  );
};

export default Component;`;

  // Build CSS module content (same styles, for use alongside JSX)
  const cssModule = css;

  // Beautify output if available
  const finalHtml = typeof beautifyHtml === 'function' ? beautifyHtml(html) : html;
  const finalJsx = typeof beautifyJsx === 'function' ? beautifyJsx(jsxComponent) : jsxComponent;

  // Diagnostics are best-effort — never abort the export (a concurrent grab may null
  // _exportDiag). Local fallback + swallow errors so the export always returns.
  const diag = _exportDiag || {};
  try {
    diag.styleCount = styleRegistry.size;
    diag.pseudoStyleCount = pseudoStyleRegistry.size;
    diag.hoverStyleCount = hoverStyleRegistry.size;
    diag.tailwindMode = tailwindMode;

    const fontCounts = new Map();
    styleRegistry.forEach((_name, styleJson) => {
      try {
        const obj = JSON.parse(styleJson);
        if (obj['font-family']) {
          const first = obj['font-family'].split(',')[0].trim().replace(/["']/g, '');
          const lo = first.toLowerCase();
          if (['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
               '-apple-system', 'blinkmacsystemfont', 'system-ui',
               'inherit', 'initial'].includes(lo)) return;
          if (lo.includes('icon') || lo.includes('material') || lo.includes('fontawesome')) return;
          fontCounts.set(first, (fontCounts.get(first) || 0) + 1);
        }
      } catch (e) {}
    });
    let primaryFont = null;
    let primaryFontCount = 0;
    fontCounts.forEach((count, font) => {
      if (count > primaryFontCount) { primaryFont = font; primaryFontCount = count; }
    });
    diag.primaryFont = primaryFont;
    diag.primaryFontWillLoad = primaryFont
      ? Array.from(getDetectedFonts()).some(f => f.toLowerCase() === primaryFont.toLowerCase())
      : false;
  } catch (e) {
    console.warn('[Pluck] diagnostics failed (non-fatal):', e && e.message);
  }

  const diagnostics = diag;
  _exportDiag = null;

  return {
    toon,  // TOON format for LLMs (more token-efficient)
    html: finalHtml,
    jsx: finalJsx,
    css: cssModule,
    diagnostics,
    fontFaces: exportFontFaces,
  };
}


// --- Helper to broadcast message to all iframes ---
function broadcastToFrames(msg) {
  const iframes = document.querySelectorAll('iframe');
  const promises = [];

  iframes.forEach(iframe => {
    try {
      // Try to post message to iframe's content script
      if (iframe.contentWindow) {
        promises.push(new Promise(resolve => {
          // Use a unique ID to match response
          const msgId = Math.random().toString(36);
          const handler = (event) => {
            if (event.data && event.data.msgId === msgId) {
              window.removeEventListener('message', handler);
              resolve(event.data.result);
            }
          };
          window.addEventListener('message', handler);
          iframe.contentWindow.postMessage({ ...msg, msgId, fromParent: true }, '*');
          // Timeout after 100ms
          setTimeout(() => {
            window.removeEventListener('message', handler);
            resolve(null);
          }, 100);
        }));
      }
    } catch (e) {
      // Cross-origin iframe, can't access
    }
  });

  return Promise.all(promises);
}

// --- Listen for messages from parent frame ---
window.addEventListener('message', async (event) => {
  if (!event.data || !event.data.fromParent) return;

  const msg = event.data;
  let result = null;

  if (msg.type === "START_PICK_MODE") {
    pickMode = true; applyPickCursor();
    result = { ok: true };
  } else if (msg.type === "STOP_PICK_MODE") {
    pickMode = false; applyPickCursor();
    if (hoverElement) {
      hoverElement.classList.remove("web-replica-hover");
      hoverElement = null;
    }
    result = { ok: true, pickMode: false };
  } else if (msg.type === "CLEAR_SELECTION") {
    selectedElements.forEach((el) => el.classList.remove("web-replica-selected"));
    selectedElements.clear();
    selectionClones.clear();
    pickMode = false; applyPickCursor();
    result = { ok: true };
  } else if (msg.type === "EXPORT_SELECTION") {
    result = await buildExport();
  }

  // Send response back to parent
  if (event.source && msg.msgId) {
    event.source.postMessage({ msgId: msg.msgId, result }, '*');
  }
});

// --- Message handling from popup ---
// Wrap in try-catch to handle extension context invalidation gracefully
try {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CHECK_INJECTED") {
    sendResponse({ injected: true });
    return true;
  }

  if (msg.type === "START_PICK_MODE") {
    pickMode = true; applyPickCursor();
    if (hoverElement) {
      hoverElement.classList.remove("web-replica-hover");
      hoverElement = null;
    }
    selectedElements.forEach((el) =>
      el.classList.remove("web-replica-selected")
    );
    selectedElements.clear();
    selectionClones.clear();

    // Show visual feedback
    showModeIndicator('Selection mode ON');

    // Also broadcast to iframes
    broadcastToFrames(msg);

    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "STOP_PICK_MODE") {
    pickMode = false; applyPickCursor();
    if (hoverElement) {
      hoverElement.classList.remove("web-replica-hover");
      hoverElement = null;
    }

    // Show visual feedback
    showModeIndicator('Selection mode OFF');

    // Also broadcast to iframes
    broadcastToFrames(msg);

    sendResponse({ ok: true, pickMode: false });
    return true;
  }

  if (msg.type === "TOGGLE_PICK_MODE") {
    pickMode = !pickMode; applyPickCursor();
    if (hoverElement) { hoverElement.classList.remove("web-replica-hover"); hoverElement = null; }
    showModeIndicator(pickMode ? 'Selection mode ON' : 'Selection mode OFF');
    broadcastToFrames({ type: pickMode ? 'START_PICK_MODE' : 'STOP_PICK_MODE' });
    sendResponse({ ok: true, pickMode });
    return true;
  }

  if (msg.type === "GET_STATE") {
    // Build a quick snippet of selected/hovered element for live preview
    let previewSnippet = '';
    let previewTag = '';
    let previewClasses = '';
    let previewDimensions = '';

    // Show last selected element, or hovered element if nothing selected
    const previewEl = selectedElements.size > 0
      ? Array.from(selectedElements).pop()
      : (pickMode ? hoverElement : null);

    if (previewEl) {
      previewTag = previewEl.tagName.toLowerCase();
      previewClasses = previewEl.className
        ? previewEl.className.toString().replace(/web-replica-\w+/g, '').trim()
        : '';
      const rect = previewEl.getBoundingClientRect();
      previewDimensions = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;

      // Get a truncated outerHTML for preview (limit to 2000 chars)
      try {
        let html = previewEl.outerHTML;
        if (html.length > 2000) {
          html = html.substring(0, 2000) + '\n<!-- ... truncated -->';
        }
        previewSnippet = html;
      } catch (e) {
        previewSnippet = `<${previewTag}>...</${previewTag}>`;
      }
    }

    sendResponse({
      pickMode,
      xrayMode,
      selectionCount: selectedElements.size,
      previewSnippet,
      previewTag,
      previewClasses,
      previewDimensions,
      previewRect: previewEl ? (() => {
        const r = previewEl.getBoundingClientRect();
        return {
          x: Math.round(r.x * window.devicePixelRatio),
          y: Math.round(r.y * window.devicePixelRatio),
          width: Math.round(r.width * window.devicePixelRatio),
          height: Math.round(r.height * window.devicePixelRatio),
          dpr: window.devicePixelRatio
        };
      })() : null
    });
    return true;
  }

  if (msg.type === "TOGGLE_XRAY") {
    toggleXrayMode();
    // Also broadcast to iframes
    broadcastToFrames(msg);
    sendResponse({ ok: true, xrayMode });
    return true;
  }

  if (msg.type === "TOGGLE_COLOR_PICK") {
    toggleColorPickMode().then(() => {
      sendResponse({ ok: true, colorPickActive: colorPickerActive });
    });
    return true; // Keep channel open for async
  }

  if (msg.type === "CLEAR_SELECTION") {
    selectedElements.forEach((el) =>
      el.classList.remove("web-replica-selected")
    );
    selectedElements.clear();
    selectionClones.clear();
    document.querySelectorAll(".web-replica-selected").forEach((el) => el.classList.remove("web-replica-selected"));
    pickMode = false; applyPickCursor();
    if (hoverElement) {
      hoverElement.classList.remove("web-replica-hover");
      hoverElement = null;
    }
    document.querySelectorAll(".web-replica-hover").forEach((el) => el.classList.remove("web-replica-hover"));

    // Also broadcast to iframes
    broadcastToFrames(msg);

    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "EXPORT_SELECTION") {
    // First check if this frame has selections
    buildExport().then(result => {
      if (result) {
        sendResponse(result);
        return;
      }

      // If no selection in main frame, check iframes
      broadcastToFrames(msg).then(iframeResults => {
        // Find first iframe that has a result
        for (const res of iframeResults) {
          if (res && res.toon) {
            sendResponse(res);
            return;
          }
        }
        // No selections anywhere
        sendResponse(null);
      });
    });

    return true; // Keep channel open for async response
  }

    return true;
  });
  }
} catch (e) {
  console.log('[Pluck] Could not add message listener:', e.message);
}

// ===== Reopen pill: shown on the page while the dock is minimized =====
(function () {
  const PILL_ID = '__pluck_reopen_pill';
  function removePill() { const p = document.getElementById(PILL_ID); if (p) p.remove(); }
  function showPill() {
    if (!document.body || document.getElementById(PILL_ID)) return;
    const pill = document.createElement('div');
    pill.id = PILL_ID;
    pill.title = 'Open Pluck dock';
    pill.setAttribute('style', [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483647',
      'width:46px', 'height:46px', 'border-radius:50%', 'cursor:pointer',
      'background:#161618', 'border:1px solid #2a2a2e', 'box-shadow:0 6px 22px rgba(0,0,0,0.45)',
      'display:flex', 'align-items:center', 'justify-content:center', 'color:#93a8ff',
      'transition:transform .14s ease'
    ].join(';'));
    pill.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3.2M12 18.8V22M2 12h3.2M18.8 12H22"/></svg>';
    pill.addEventListener('mouseenter', () => { pill.style.transform = 'scale(1.08)'; });
    pill.addEventListener('mouseleave', () => { pill.style.transform = 'scale(1)'; });
    pill.addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ type: 'OPEN_DOCK' }); } catch (e) {}
      try { chrome.storage.local.set({ pluckMinimized: false }); } catch (e) {}
      removePill();
    });
    document.body.appendChild(pill);
  }
  try {
    chrome.storage.local.get('pluckMinimized', (r) => { if (r && r.pluckMinimized) showPill(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.pluckMinimized) return;
      if (changes.pluckMinimized.newValue) showPill(); else removePill();
    });
  } catch (e) {}
})();

// ===== Automation hooks =====
// When this file is injected into a Playwright page (main world), these let an
// external runner extract by selector and map a page. Harmless in the extension.
(function () {
  function __pluckCssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
      let sel = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + (window.CSS && CSS.escape ? CSS.escape(node.id) : node.id)); break; }
      const parent = node.parentNode;
      if (parent && parent.children) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      node = node.parentNode;
    }
    return parts.join(' > ');
  }
  window.__pluckCssPath = __pluckCssPath;

  window.__pluckExtract = async function (selector) {
    try {
      selectedElements.forEach((el) => el.classList.remove('web-replica-selected'));
      selectedElements.clear(); selectionClones.clear();
      const els = selector ? Array.from(document.querySelectorAll(selector)) : (document.body ? [document.body] : []);
      if (!els.length) return { error: 'No element matched selector: ' + selector };
      els.forEach((el) => toggleElement(el, true));
      const result = await buildExport();
      selectedElements.forEach((el) => el.classList.remove('web-replica-selected'));
      selectedElements.clear(); selectionClones.clear();
      return result || { error: 'Extraction produced no output' };
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
  };

  window.__pluckMap = function (max) {
    max = max || 30;
    const seen = new Set(); const out = [];
    const push = (el) => {
      if (!el || el.nodeType !== 1 || seen.has(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 24) return;
      seen.add(el);
      const cn = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/).slice(0, 4).join(' ') : '';
      out.push({
        selector: __pluckCssPath(el), tag: el.tagName.toLowerCase(), classes: cn,
        role: el.getAttribute('role') || '', testid: el.getAttribute('data-testid') || '',
        w: Math.round(r.width), h: Math.round(r.height),
        x: Math.round(r.left), y: Math.round(r.top + window.scrollY),
        text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      });
    };
    document.querySelectorAll('header,nav,main,footer,aside,section,article,[role],[data-testid]').forEach(push);
    [document.querySelector('main'), document.body].filter(Boolean).forEach((root) => Array.from(root.children).forEach(push));
    out.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    return out.slice(0, max);
  };
})();
