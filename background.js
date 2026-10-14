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

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab || tab.id == null) return;
  if (command === 'toggle-select') {
    // Don't open the dock — selection frees the viewport; the dock reopens on export.
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PICK_MODE' }, () => void chrome.runtime.lastError);
  } else if (command === 'export-selection') {
    // Open synchronously (the command is the user gesture) before the async export.
    if (tab.windowId != null) {
      try { const p = chrome.sidePanel.open({ windowId: tab.windowId }); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    }
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

    // Abort a slow/hung request so we always respond and free the socket.
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

  // Screen capture for the color picker and for canvases an export cannot read.
  // Taken from the asking tab's own window (the focused window may be another
  // one, or a chrome:// page that cannot be captured), and only while that tab
  // is the one showing, or the screenshot would be of a different page.
  if (message.type === 'CAPTURE_TAB') {
    const tab = sender.tab;
    if (tab && !tab.active) {
      sendResponse({ ok: false, error: 'the tab is not the visible one in its window' });
      return true;
    }
    let done = false;
    const finish = (reply) => { if (!done) { done = true; sendResponse(reply); } };
    // A window covered by another app may never produce a frame to capture.
    setTimeout(() => finish({ ok: false, error: 'the tab produced no frame to screenshot (timed out)' }), 5000);
    chrome.tabs.captureVisibleTab(tab ? tab.windowId : null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        finish({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        finish({ ok: true, dataUrl });
      }
    });
    return true; // Keep channel open for async
  }
});

/* ===================================================================== *
 * Agent bridge (see the agent bridge section at the end of
 * contentScript.js). A page can only ask for a capture of itself, but that
 * still writes into Downloads, so the bridge answers only on allowed
 * origins: local development hosts by default, plus any site switched on
 * in the dock's Settings. Stored as chrome.storage.local
 * { pluckAgentBridge: { enabled, origins, redactParams } }; stored keys
 * replace the defaults. Captures land in Downloads/pluck/<site>/, one folder
 * per site, so a page on one allowed site cannot overwrite another's.
 * ===================================================================== */
const AGENT_DEFAULTS = {
  enabled: true,
  origins: ['http://localhost', 'http://127.0.0.1', 'http://[::1]', 'http://*.localhost'],
  // Query parameters whose values become REDACTED in saved files, so a capture
  // of a signed-in page does not carry its session into a repository.
  redactParams: [
    'token', 'access_token', 'id_token', 'refresh_token', 'auth', 'session', 'sessionid',
    'session_id', 'sid', 'jsessionid', 'phpsessid', 'sig', 'signature', 'api_key', 'apikey',
    'password', 'secret', 'x-amz-signature', 'x-amz-credential', 'x-amz-security-token'
  ]
};
const AGENT_DOWNLOAD_TIMEOUT_MS = 15000;
const AGENT_LOCAL_PATTERNS = new Set(AGENT_DEFAULTS.origins);

function agentOriginMatches(origin, pattern) {
  let o;
  let p;
  try { o = new URL(origin); p = new URL(pattern.replace('://*.', '://wildcard.')); } catch (e) { return false; }
  if (o.protocol !== p.protocol) return false;
  if (pattern.indexOf('://*.') !== -1) {
    const suffix = p.hostname.replace(/^wildcard\./, '');
    return o.hostname === suffix || o.hostname.endsWith('.' + suffix);
  }
  // The built-in local hosts match on any port (dev servers move between ports);
  // a site allowed from the dock matches only its exact origin, port included.
  if (AGENT_LOCAL_PATTERNS.has(pattern)) return o.hostname === p.hostname;
  return o.origin === p.origin;
}

async function agentConfig() {
  try {
    const stored = await chrome.storage.local.get('pluckAgentBridge');
    if (stored && stored.pluckAgentBridge) return Object.assign({}, AGENT_DEFAULTS, stored.pluckAgentBridge);
  } catch (e) { /* defaults */ }
  return Object.assign({}, AGENT_DEFAULTS);
}

function agentOriginAllowed(config, origin) {
  return (config.origins || []).some((pattern) => agentOriginMatches(origin || '', pattern));
}

/** `refused` tells the content script to stay silent, so a site that is not
 *  allowed cannot learn that Pluck is installed. */
function agentGate(config, origin) {
  if (!config.enabled) return { ok: false, refused: true, reason: 'agent bridge is disabled' };
  return agentOriginAllowed(config, origin)
    ? { ok: true }
    : { ok: false, refused: true, reason: 'origin not in the agent bridge allowlist: ' + origin };
}

async function agentAllowed(origin) {
  return agentGate(await agentConfig(), origin);
}

/** Adds or removes one exact origin (the dock's "Agent captures" switch). */
async function agentSetOrigin(origin, allow) {
  let parsed;
  try { parsed = new URL(origin); } catch (e) { return { ok: false, reason: 'not an origin: ' + origin }; }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, reason: 'only http(s) origins can be allowed' };
  const exact = parsed.origin;
  const config = await agentConfig();
  const origins = (config.origins || []).filter((o) => o !== exact);
  if (allow) origins.push(exact);
  const stored = (await chrome.storage.local.get('pluckAgentBridge')).pluckAgentBridge || {};
  await chrome.storage.local.set({ pluckAgentBridge: Object.assign({}, stored, { origins }) });
  return { ok: true, allowed: agentOriginAllowed(Object.assign({}, config, { origins }), exact) };
}

/** `https://s1.example.com:8443` → `s1.example.com-8443`: a safe folder name. */
function agentSite(origin) {
  let host = '';
  try { host = new URL(origin).host; } catch (e) { /* unknown */ }
  const cleaned = host.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'unknown-site';
}

function agentName(raw) {
  const cleaned = String(raw || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80);
  return cleaned || 'capture-' + Date.now().toString(36);
}

/**
 * Blanks the values of the listed URL parameters wherever a URL carries them:
 * in the query or fragment (`?token=…`, `&sid=…`, `#access_token=…`, HTML-escaped
 * `&amp;sid=…`) and inside URL-encoded links (`%3Fsid%3D…`). Only parameter
 * positions match, so text and CSS mentioning the same words are left alone.
 */
function agentRedactor(names) {
  const list = (names || []).filter((n) => typeof n === 'string' && /^[\w.-]{1,64}$/.test(n))
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!list.length) return (text) => text;
  const keys = '(?:' + list.join('|') + ')';
  const plain = new RegExp('([?&;#](?:amp;)?' + keys + '=)[^&#"\'\\s)<>]*', 'gi');
  const encoded = new RegExp('((?:%3F|%26|%23)' + keys + '%3D)(?:(?!%26|%23)[^&#"\'\\s)<>])*', 'gi');
  return (text) => (typeof text === 'string'
    ? text.replace(plain, '$1REDACTED').replace(encoded, '$1REDACTED') : text);
}

function agentDataUrl(text, mime) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('could not encode the file'));
    reader.readAsDataURL(new Blob([text], { type: mime }));
  });
}

/**
 * Saves one file and resolves with its path relative to Downloads once Chrome
 * reports the download complete — or null if it is interrupted or too slow.
 * Overwrites, so re-capturing a name replaces the file instead of adding "(1)".
 */
async function agentDownload(relPath, text, mime) {
  const url = await agentDataUrl(text, mime);
  const id = await new Promise((resolve) => {
    chrome.downloads.download({ url, filename: relPath, saveAs: false, conflictAction: 'overwrite' },
      (downloadId) => resolve(chrome.runtime.lastError ? null : downloadId));
  });
  if (id == null) return null;
  const started = Date.now();
  while (Date.now() - started < AGENT_DOWNLOAD_TIMEOUT_MS) {
    const [item] = await chrome.downloads.search({ id });
    if (item && item.state === 'complete') {
      const saved = String(item.filename || relPath).replace(/\\/g, '/');
      const folder = relPath.slice(0, relPath.lastIndexOf('/'));
      const at = saved.lastIndexOf('/' + folder + '/');
      return at === -1 ? relPath : saved.slice(at + 1);
    }
    if (item && item.state === 'interrupted') return null;
    await new Promise((r) => setTimeout(r, 120));
  }
  // Too slow: cancel it, so the file does not appear after the capture was reported failed.
  chrome.downloads.cancel(id, () => void chrome.runtime.lastError);
  return null;
}

// octet-stream keeps the .toon extension (a text/* blob gets renamed).
const AGENT_MIME = { toon: 'application/octet-stream', html: 'text/html' };

async function agentSave(origin, message) {
  const config = await agentConfig();
  const gate = agentGate(config, origin);
  if (!gate.ok) return gate;
  const extra = Array.isArray(message.redactParams) ? message.redactParams.slice(0, 50) : [];
  const redact = agentRedactor((config.redactParams || []).concat(extra));
  const folder = 'pluck/' + agentSite(origin);
  const name = agentName(message.name);
  const wanted = Array.isArray(message.formats) && message.formats.length ? message.formats : ['toon', 'html'];
  const formats = Object.keys(AGENT_MIME).filter((f) => wanted.indexOf(f) !== -1 && message[f]);
  const texts = formats.map((f) => redact(message[f]));
  const saved = await Promise.all(formats.map((f, i) =>
    agentDownload(folder + '/' + name + '.' + f, texts[i], AGENT_MIME[f])));
  const paths = {};
  const bytes = {};
  formats.forEach((f, i) => { paths[f] = saved[i]; bytes[f] = new Blob([texts[i]]).size; });
  const failed = formats.filter((f) => !paths[f]);
  if (!formats.length || failed.length) {
    return { ok: false, reason: 'downloads did not complete: ' + (failed.join(', ') || 'nothing to save') };
  }
  return { ok: true, paths, bytes };
}

/**
 * Moves the real pointer for an agent capture's `hover`. Only Chrome's own input
 * pipeline sets :hover and fires trusted mouse events, so a page cannot fake it;
 * the debugger is attached for this one event and detached straight away.
 */
async function agentHover(tabId, x, y) {
  if (!isFinite(x) || !isFinite(y)) return { ok: false, reason: 'hover point is not a number' };
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    return { ok: false, reason: 'could not move the pointer: ' + String((e && e.message) || e) };
  }
  try {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    return { ok: true, x, y };
  } catch (e) {
    return { ok: false, reason: 'could not move the pointer: ' + String((e && e.message) || e) };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string' || message.type.indexOf('PLUCK_AGENT_') !== 0) return false;
  const tabOrigin = sender.tab && sender.tab.url ? (() => { try { return new URL(sender.tab.url).origin; } catch (e) { return ''; } })() : '';
  const reply = (promise) => {
    promise.then(sendResponse, (e) => sendResponse({ ok: false, reason: String((e && e.message) || e) }));
    return true;
  };

  switch (message.type) {
    // Asked by the page's content script: may this origin use the bridge?
    case 'PLUCK_AGENT_ALLOWED':
      return reply(agentAllowed(tabOrigin));

    // Read by the dock to show the switch. `origin` is the dock's active tab.
    case 'PLUCK_AGENT_CONFIG':
      return reply(agentConfig().then((config) => {
        const allowed = message.origin ? agentOriginAllowed(config, message.origin) : null;
        const byPattern = message.origin ? agentOriginAllowed(Object.assign({}, config, {
          origins: (config.origins || []).filter((o) => o !== message.origin)
        }), message.origin) : null;
        return { ok: true, enabled: !!config.enabled, allowed, byPattern };
      }));

    // Only an extension page (the dock) may change the list; a content script
    // always has sender.tab, so a page cannot allow itself.
    case 'PLUCK_AGENT_SET_ORIGIN':
      if (sender.tab || sender.id !== chrome.runtime.id) {
        sendResponse({ ok: false, reason: 'not allowed from a page' });
        return true;
      }
      return reply(agentSetOrigin(message.origin, !!message.allow));

    // The content script built the export; save it. The site is checked again
    // here, from the tab URL Chrome reports rather than anything the page says.
    // Moves the real pointer before a capture (`hover`), on an allowed site only.
    case 'PLUCK_AGENT_HOVER':
      if (!sender.tab || sender.frameId !== 0) { sendResponse({ ok: false, reason: 'hover is top-frame only' }); return true; }
      return reply(agentAllowed(tabOrigin).then((gate) => (gate.ok
        ? agentHover(sender.tab.id, Number(message.x), Number(message.y))
        : gate)));

    case 'PLUCK_AGENT_SAVE':
      if (!sender.tab) { sendResponse({ ok: false, reason: 'no tab' }); return true; }
      return reply(agentSave(tabOrigin, message));

    default:
      return false;
  }
});
