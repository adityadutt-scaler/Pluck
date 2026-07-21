# Pluck

**Extract any UI component from the web and make it yours.**

Pluck is a Chrome browser extension that lets you select any UI component from any webpage, extract it with all its styles, and export it as standalone HTML, JSX, CSS, or in a token-optimized format perfect for AI/LLM consumption. Everything happens in a **side-panel dock** pinned to the page: select a component and its code lands on your clipboard automatically, ready to paste into an LLM — with a tabbed **Preview | Code** workspace, live token counts, and ready-made "Copy for AI" prompts.

## Features

- **Point & Click Selection** - Hover over any element to highlight it, click to select
- **Multi-Select Support** - Hold Shift and click to select multiple components, with live count display
- **Combined Export** - Multiple selections are exported as a single file
- **Standalone HTML Export** - Get a fully functional HTML file with embedded CSS
- **JSX Export** - Convert extracted components to JSX with `className` attributes
- **CSS Export** - Extracted and deduplicated CSS styles
- **TOON Format Export** - Token-Optimized Object Notation for AI/LLM workflows
- **Side-Panel Dock** - A persistent panel pinned to the page — select, preview, and grab code without ever leaving the site. Minimize it to a corner pill, or pop it out side-by-side.
- **Auto-Copy on Export** - The instant you export, your chosen format is already on your clipboard (TOON by default — or HTML/JSX/CSS, or off)
- **Copy for AI** - Wraps the export in a ready-made prompt (React + Tailwind, React + CSS, Vue 3, plain responsive HTML) so you can paste straight into an LLM
- **Tabbed Preview | Code** - Flip between the live render and the generated code (HTML/JSX/CSS/TOON), each with a live token count
- **Recent Grabs History** - Remembers your last 10 exports; click any one to reload its preview and copy it again
- **Code Preview Page (Pop-out)** - Pop the dock out into a full-tab, side-by-side code + preview view with syntax highlighting and live code editing
- **Live Code Editor** - Edit extracted code in-browser with real-time syntax highlighting (Prism-Live)
- **Dynamic Live Preview** - Live HTML render that auto-adjusts orientation based on content aspect ratio
- **Tailwind CSS Detection** - Automatically detects and flags Tailwind utility classes in extracted components
- **Tailwind JSX Output** - When the source page is Tailwind-built, JSX exports use real utility classes (`flex items-center gap-3 rounded-lg`) instead of deduped CSS class references, with arbitrary-value fallbacks (`gap-[13px]`) for unmatched values
- **Smart Container Expansion** - Clicks on small leaves (inputs, icons, headings) auto-expand to the nearest visually-distinct or structural ancestor; `⌥`/`Alt + Click` bypasses for exact targeting
- **DOM Navigation** - `⌥`/`Alt + ↑/↓` walks the parent/child chain with a back-stack so over-navigating up doesn't strand you at `<body>`
- **Full-Page Extract** - One shortcut (`Cmd/Ctrl+Shift+F`) selects `<body>` and exports the whole page
- **Full Pseudo-Element Capture** - Both `::before` and `::after` captured independently as real CSS rules (decorative pseudos with empty content included)
- **Parent-Context Wrapper** - When inner elements are selected, their flex/grid container's layout (display, gap, padding, named grid areas) is wrapped around the selection so it still flows correctly
- **Position Normalization** - `position: absolute|fixed` selections with no positioned ancestor get their offsets cleared, so they don't render relative to `<body>`
- **Style-Noise Filtering** - Drops runaway min-locks, user-agent borders, outline noise, and inherited duplicates
- **Diagnostics Panel** - Collapsible panel above the preview tabs shows top-level selections captured, nodes dropped by the visibility filter, registry sizes, per-selection bounding boxes, and primary-font fallback warnings
- **Download Fonts as Zip** - Bundles every embedded `@font-face` binary into a single zip you can save next to the exported HTML
- **HTML Beautification** - Exported HTML is auto-formatted with proper indentation
- **Live Element Preview** - Real-time visual preview and code snippet of the hovered/selected element right in the dock
- **Hover State Extraction** - Captures `:hover` CSS pseudo-class styles along with base styles
- **Dynamic Content Freezing** - Clones elements at selection time so dynamic/animated content is captured exactly as seen
- **Custom Font Embedding** - Fetches and embeds WOFF/WOFF2 fonts as base64 data URLs for fully offline exports
- **Style Preservation** - Captures computed styles, Google Fonts, pseudo-elements, icon fonts, and more
- **Shadow DOM Support** - Works with modern web components
- **Customizable Shortcuts** - Configure keyboard shortcuts to your preference
- **X-Ray Mode** - Inspect any element with detailed info, DOM path, dimensions, and box model visualization
- **Color Picker** - Pick any color from the screen with a magnified pixel view and copy to clipboard

---

## Installation

### Chrome (Developer Mode)

1. **Download the extension**
   - Clone this repository or download as ZIP and extract

2. **Open Chrome Extensions**
   - Navigate to `chrome://extensions` in your browser
   - Or go to Menu → More Tools → Extensions

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

4. **Load the extension**
   - Click "Load unpacked"
   - Select the `Pluck` folder containing `manifest.json`

5. **Verify installation**
   - You should see the Pluck icon in your browser toolbar
   - Click it to open the side-panel dock and start using the extension

---

## Quick Start

1. **Navigate** to any webpage you want to extract components from

2. **Open the dock & start selecting** by either:
   - Clicking the extension icon (opens the side-panel dock) and pressing "Start Selecting", or
   - Using the keyboard shortcut (Ctrl+Shift+S / Cmd+Shift+S)

3. **Hover** over elements to see them highlighted with a red outline

4. **Click** on an element to select it (turns blue)
   - Hold **Shift + Click** to select multiple elements
   - The dock shows a live count of selected elements (e.g., "3 elements selected")

5. **Stop selecting** by either:
   - Pressing the same shortcut again (Ctrl+Shift+S / Cmd+Shift+S), or
   - Clicking "Stop Selecting" in the dock

6. **Export** your selection:
   - Click the "Export" button in the dock, or
   - Use the keyboard shortcut (Ctrl+Shift+E / Cmd+Shift+E)

7. **Done — it's already on your clipboard.** Export auto-copies your chosen format (TOON by default) so you can paste straight into an LLM. In the dock you can also:
   - Switch between the **Preview** and **Code** tabs (HTML / JSX / CSS / TOON), each with a live token count
   - Hit **Copy for AI** to copy the export wrapped in a ready-made prompt
   - Reload any of your **last 10 grabs** from the history

---

## The Dock: Preview | Code

When you export, the result appears right in the side-panel dock — no new tab. The dock has a tabbed **Preview | Code** workspace, and the export is auto-copied to your clipboard the instant it lands. Need more room? **Pop it out** (the ⧉ button) into a full-tab, side-by-side code + preview view with the same editor and syntax highlighting.

### Auto-Copy & Copy for AI

- **Auto-copy on export** - The moment you export, your chosen format is on the clipboard. Pick which one in Settings: **TOON** (default), HTML, JSX, CSS, or off.
- **Copy for AI** - Copies the export wrapped in a ready-made prompt. Choose a preset (React + Tailwind, React + CSS, Vue 3, plain responsive HTML) so you can paste straight into Claude/ChatGPT and go.
- **Live token counts** - Each format tab shows an estimated token count so you know exactly how much you're sending the model.

### Tabs

| Tab | Description |
|-----|-------------|
| **HTML** | Beautified, standalone HTML with embedded CSS classes |
| **JSX** | React-ready JSX with `className` instead of `class` and self-closing tags |
| **CSS** | Extracted and deduplicated CSS styles |
| **TOON** | Token-optimized format for AI/LLM consumption |

### Actions

| Action | Shortcut | Description |
|--------|----------|-------------|
| **Edit** | `Ctrl/Cmd + E` | Toggle live code editing with syntax highlighting |
| **Copy** | `Ctrl/Cmd + C` | Copy current tab content to clipboard |
| **Download** | `Ctrl/Cmd + S` | Download the current tab as a file |
| **Download All** | `Ctrl/Cmd + Shift + S` | Download all formats as separate files |
| **Switch Tabs** | `1` / `2` / `3` / `4` | Quick-switch between HTML, JSX, CSS, TOON tabs |

### Live Preview

The preview page includes a **dynamic live preview** panel that renders the extracted HTML+CSS in real-time:

- **Auto-orientation** - The preview panel automatically switches between a **right sidebar** (for tall/portrait content) and a **bottom strip** (for wide/landscape content) based on the rendered content's aspect ratio
- **Real-time updates** - When editing code, the live preview updates with a 300ms debounce
- **System theme aware** - The preview background adapts to light/dark system preference
- **Toggle visibility** - Show/hide the preview panel with the eye icon in the header

### Live Code Editor

Click **Edit** to enter edit mode powered by [Prism-Live](https://live.prismjs.com/):

- Full syntax highlighting while typing
- Changes are reflected in the live preview in real-time
- Edits persist within the session across tab switches

---

## Keyboard Shortcuts

### Main Extension Shortcuts

| Action | Mac | Windows / Linux | Notes |
|--------|-----|-----------------|-------|
| Toggle Selection | `Cmd + Shift + S` | `Ctrl + Shift + S` | Press again to stop |
| Clear Selection | `Escape` | `Escape` | Clears all selected elements |
| Export | `Cmd + Shift + E` | `Ctrl + Shift + E` | Exports + auto-copies; shows result in the dock |
| Extract Full Page | `Cmd + Shift + F` | `Ctrl + Shift + F` | Selects `<body>` and exports immediately |
| X-Ray Mode | `Cmd + Shift + X` | `Ctrl + Shift + X` | Toggle element inspector |
| Color Picker | `Cmd + Shift + P` | `Ctrl + Shift + P` | Pick any color from screen |
| Navigate Parent | `⌥ + ↑` (Option) | `Alt + ↑` | Walks to the parent of the hovered element |
| Navigate Child / Back | `⌥ + ↓` (Option) | `Alt + ↓` | First child, or back-stack pop if available |
| Exact Target | `⌥ + Click` (Option) | `Alt + Click` | Bypasses smart container expansion |
| Multi-Select | `Shift + Click` | `Shift + Click` | Add more elements to the selection |

### Preview | Code (Pop-out) Shortcuts

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| Toggle Edit Mode | `Cmd + E` | `Ctrl + E` |
| Copy Code | `Cmd + C` | `Ctrl + C` |
| Download Current | `Cmd + S` | `Ctrl + S` |
| Download All | `Cmd + Shift + S` | `Ctrl + Shift + S` |
| Switch to HTML | `1` | `1` |
| Switch to JSX | `2` | `2` |
| Switch to CSS | `3` | `3` |
| Switch to TOON | `4` | `4` |

### Customizing Shortcuts

1. Open the dock (click the Pluck extension icon) and open **Settings** (the gear icon)
2. Find the shortcuts section
3. Click modifier buttons (⌘/Ctrl, ⇧, ⌥/Alt) to toggle them
4. Click the key input and press your desired key
5. Save to apply changes

---

## Export Formats

### HTML Export

The HTML export creates a **standalone, self-contained HTML file** that renders the selected component exactly as it appeared on the original page.

**What's included:**
- All computed CSS styles (deduplicated for efficiency)
- **Hover states** (`:hover` pseudo-class styles) captured
- Google Fonts automatically detected and loaded
- **Custom WOFF/WOFF2 fonts embedded** as base64 data URLs for offline use
- Images and SVGs preserved with original sources
- Pseudo-elements (::before, ::after) captured
- Icon fonts (Font Awesome, Material Icons, etc.) supported
- Backdrop filters with cross-browser prefixes
- **Beautified HTML** with proper indentation via js-beautify
- Elements frozen at selection time to preserve dynamic content

### JSX Export

The JSX export converts extracted HTML into **React-ready JSX**:

- `class` → `className`
- `for` → `htmlFor`
- `tabindex` → `tabIndex`
- Self-closing tags for void elements (`<img />`, `<br />`, etc.)
- Inline `style` strings converted to JSX object syntax

### CSS Export

Standalone CSS output with:

- Deduplicated style classes (s1, s2, s3, etc.)
- Computed styles from the original page
- Proper formatting and indentation

### Tailwind CSS Detection

When a component uses **Tailwind CSS** utility classes, Pluck automatically detects them and displays a badge in the dock. This helps you identify Tailwind-based components so you can use the appropriate approach when recreating them.

---

### TOON Format (Token-Optimized Object Notation)

TOON is a **compact, structured format designed specifically for AI/LLM consumption**. It represents UI components in a way that large language models can easily understand and recreate.

#### Syntax

```
tag.styleClass[inline-styles] (attributes) "text content" {
  children...
}
```

#### Example

A simple button component in TOON format:

```
button.s1[background:#007bff;color:#fff;padding:10px 20px;border-radius:4px] (type="submit") "Get Started" {}
```

A card with nested elements:

```
div.s1[background:#fff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);padding:24px] () "" {
  h2.s2[font-size:24px;font-weight:600;margin-bottom:12px] () "Welcome Back" {}
  p.s3[color:#666;line-height:1.5] () "Sign in to continue to your dashboard." {}
  button.s4[background:#007bff;color:#fff;padding:12px 24px;border:none;border-radius:4px;cursor:pointer] () "Sign In" {}
}
```

#### Using TOON with AI

1. **Export a component** from any website using Pluck

2. **Open the .toon file** and copy its contents

3. **Paste into Claude, ChatGPT, or any LLM** with a prompt like:

   > "Recreate this component in React with Tailwind CSS"

   > "Convert this to a Vue component with scoped styles"

   > "Make this component responsive and add dark mode support"

4. **The AI understands:**
   - Element hierarchy and nesting
   - All CSS styles applied to each element
   - Text content and attributes
   - The visual structure of the component

#### Why TOON?

| Benefit | Description |
|---------|-------------|
| **Token Efficient** | ~70% fewer tokens than raw HTML |
| **Structure Preserved** | Hierarchy and nesting are clear |
| **Style Complete** | All computed styles included |
| **AI Optimized** | Format designed for LLM parsing |

---

## X-Ray Mode

X-Ray Mode is a powerful inspection tool inspired by [Pesticide](https://chrome.google.com/webstore/detail/pesticide-for-chrome) that helps you understand the structure and layout of any webpage.

### Activating X-Ray Mode

- **Keyboard shortcut**: `Cmd + Shift + X` (Mac) or `Ctrl + Shift + X` (Windows/Linux)
- **Button**: Click the layers icon in the Pluck dock

### What You See

When X-Ray Mode is active:

1. **Rainbow Outlines** - Every element on the page gets a colorful outline, making the layout structure visible at a glance

2. **Hover Label** - A floating tooltip follows your cursor showing:
   - Element tag name (e.g., `div`, `span`, `button`)
   - CSS classes applied to the element
   - Dimensions (width × height)

3. **Inspector Panel** - A fixed panel at the bottom of the screen displays:

   | Section | Information |
   |---------|-------------|
   | **Element Info** | Tag name, classes, and ID of the hovered element |
   | **DOM Tree Path** | Full path from `<html>` to the current element (e.g., `html > body > div.container > ul.menu > li`) |
   | **Dimensions** | Client, Offset, and Scroll dimensions (Height/Width) |
   | **Box Model** | Visual diagram showing margin, border, padding, and content area with exact pixel values |

### Box Model Colors

The visual box model uses color-coded layers:
- **Orange** - Margin
- **Yellow** - Border
- **Green** - Padding
- **Blue** - Content

### Use Cases

- **Debugging layouts** - Quickly identify spacing and alignment issues
- **Learning CSS** - Understand how elements are structured and sized
- **Responsive design** - Check element dimensions across different viewport sizes
- **Accessibility** - Verify proper DOM structure and hierarchy

---

## Color Picker

The Color Picker lets you sample any color from the screen with pixel-perfect accuracy.

### Activating Color Picker

- **Keyboard shortcut**: `Cmd + Shift + P` (Mac) or `Ctrl + Shift + P` (Windows/Linux)
- **Button**: Click the eyedropper icon in the Pluck dock

### How It Works

1. **Activate** the color picker using the button or keyboard shortcut

2. **Magnifier appears** - A circular magnifier follows your cursor showing:
   - Zoomed view of pixels (11×11 grid at 10× magnification)
   - Circle crosshair indicating the exact pixel being sampled
   - Info panel with color preview, HEX value, and RGB values

3. **Click to copy** - Click anywhere to:
   - Copy the HEX color code to your clipboard
   - See a confirmation notification with the color values

4. **Cancel** - Press `Escape` to close the color picker without copying

### Features

| Feature | Description |
|---------|-------------|
| **Pixel-Perfect Sampling** | Uses screen capture for accurate color detection |
| **Magnified View** | 10× zoom shows individual pixels clearly |
| **Centered Crosshair** | Circle indicator shows exact sampling point |
| **HEX & RGB Display** | Both color formats shown in the info panel |
| **One-Click Copy** | Color code copied to clipboard instantly |
| **Works Everywhere** | Captures colors from images, gradients, videos, etc. |

### Use Cases

- **Design inspiration** - Sample colors from any website
- **Color matching** - Get exact color values for design work
- **Accessibility testing** - Check color contrast ratios
- **Development** - Quickly grab colors for CSS

---

## Troubleshooting

### Extension icon not appearing
- Go to `chrome://extensions` and ensure Pluck is enabled
- Click the puzzle piece icon in Chrome toolbar and pin Pluck

### Selection not working on a website
- Some sites with heavy JavaScript may require a page refresh
- Sites with strict Content Security Policy may block the extension
- Shadow DOM elements are supported but may behave differently

### Exported styles look different
- Dynamic styles (hover states, animations) may not capture
- Some CSS-in-JS solutions generate styles at runtime
- Try selecting the element in its desired state before exporting

### Keyboard shortcuts not working
- Check if another extension is using the same shortcuts
- Try customizing shortcuts in the Pluck settings
- Ensure the page has focus (click somewhere on the page first)

---

## Technical Documentation

### Architecture

Pluck uses the Chrome Extension Manifest V3 architecture:

```
┌──────────────────┐    Messages    ┌───────────────────┐
│ Side-Panel Dock  │ ─────────────→ │  Content Script   │
│ (panel.js)       │                │ (contentScript.js)│
└──────────────────┘                └─────────┬─────────┘
                                              │
                                              │ Messages
                                              ▼
                                    ┌──────────────────┐
                                    │   Background     │
                                    │ (background.js)  │
                                    └────────┬─────────┘
                                             │
                                             │ Opens side panel /
                                             │ stages export data
                                             ▼
                                    ┌──────────────────────┐
                                    │  Pop-out Preview     │
                                    │  (preview.html)      │
                                    └──────────────────────┘
```

**Side-Panel Dock** (`panel.html` + `panel.js` + `panel.css`)
- The primary UI, opened in Chrome's side panel when you click the toolbar icon
- Controls selection, shows status/settings, live element preview, and recent-grabs history
- Tabbed Preview | Code workspace with token counts; auto-copy and Copy-for-AI on export

**Content Script** (`contentScript.js`)
- Injected into every webpage
- Handles element selection and highlighting
- Extracts styles and builds export data (HTML, JSX, CSS, TOON)
- Detects Tailwind CSS usage
- Core extraction engine

**Background Service Worker** (`background.js`)
- Opens the side panel and stages export data for the dock
- Handles file downloads via Chrome Downloads API
- Captures the visible tab for Color Picker and live preview

**Pop-out Preview** (`preview.html` + `preview.js`)
- Full-tab, side-by-side code + preview view popped out from the dock
- Syntax highlighting via PrismJS; live code editing via Prism-Live
- Dynamic live preview with auto-orientation; download individual or all formats

> **Note:** `popup.html` / `popup.js` are the retired pre-v3 popup UI, kept for reference. Clicking the toolbar icon now opens the side-panel dock, not the popup.

### File Structure

```
Pluck/
├── manifest.json          # Extension configuration (Manifest V3)
├── panel.html             # Side-panel dock markup
├── panel.css              # Dock styles (theme, layout)
├── panel.js               # Dock logic: selection, tabs, auto-copy, history
├── background.js          # Service worker: side panel, downloads, tab capture
├── contentScript.js       # Core selection and extraction engine
├── preview.html           # Pop-out preview page markup & styles
├── preview.js             # Pop-out logic, editor, live preview
├── popup.html             # Retired pre-v3 popup UI (kept for reference)
├── popup.js               # Retired pre-v3 popup logic
├── icons/                 # Extension icons (16/32/48/128)
├── lib/
│   ├── beautify-html.js   # HTML beautification library
│   ├── bliss.js           # Bliss.js (DOM helper, Prism-Live dependency)
│   ├── prism.js           # PrismJS syntax highlighter
│   ├── prism.css          # PrismJS theme styles
│   ├── prism-live.js      # Prism-Live editable code component
│   └── prism-live.css     # Prism-Live editor styles
└── README.md              # This file
```

### Key Technical Features

| Feature | Description |
|---------|-------------|
| **Style Deduplication** | Generates reusable CSS classes (s1, s2, etc.) to minimize output size |
| **Hover State Extraction** | Captures `:hover` pseudo-class styles and maps them to base selectors |
| **Dynamic Content Freezing** | Clones elements at selection time to preserve exact DOM state |
| **Shadow DOM Support** | Handles both open and closed shadow roots via composedPath() |
| **iframe Support** | Works across nested iframes with cross-frame messaging |
| **Pseudo-Element Extraction** | Captures ::before and ::after content and styles |
| **Icon Font Detection** | Recognizes Material Icons, Font Awesome, and other icon fonts |
| **Smart Sizing** | Uses different strategies for media elements vs text content |
| **WOFF Font Embedding** | Extracts @font-face rules and embeds custom fonts as base64 for offline use |
| **HTML Beautification** | Auto-formats HTML output with proper indentation via js-beautify |
| **JSX Conversion** | Converts HTML attributes to JSX equivalents (class→className, etc.) |
| **Tailwind Detection** | Identifies Tailwind CSS utility classes in extracted components |
| **Dock Live Preview** | Real-time visual preview and code snippet of selected elements in the side-panel dock |
| **Auto-Copy & Copy for AI** | Chosen format auto-copied on export; Copy-for-AI wraps it in a prompt preset |
| **Parallel Font Fetch** | Custom-font fetching is parallel, time-boxed, and memoized so one slow font URL can't hang an export |
| **Live Code Editor** | Prism-Live powered in-browser code editing with syntax highlighting |
| **Dynamic Live Preview** | iframe-based HTML render that auto-switches between sidebar and bottom strip |
| **Platform-Aware Shortcuts** | Auto-detects Mac vs Windows/Linux and uses appropriate modifier keys |
| **X-Ray Inspector** | Real-time element inspection with box model visualization using Shadow DOM isolation |
| **Color Picker** | Screen capture-based color sampling with magnified pixel view and clipboard copy |

### Permissions Explained

| Permission | Purpose |
|------------|---------|
| `activeTab` | Access the currently active tab when user clicks the extension |
| `scripting` | Inject content scripts into web pages |
| `storage` | Save user preferences, custom shortcuts, and export data for preview page |
| `downloads` | Download exported HTML, JSX, CSS, and TOON files |
| `webNavigation` | Detect frames and iframes for cross-frame support |
| `clipboardWrite` | Auto-copy exports and Copy-for-AI output to the clipboard |
| `sidePanel` | Show the Pluck dock in Chrome's side panel |

### Browser Compatibility

| Browser | Status |
|---------|--------|
| Google Chrome | Fully supported |
| Microsoft Edge | Should work (Chromium-based) |
| Brave | Should work (Chromium-based) |
| Opera | Should work (Chromium-based) |
| Firefox | Not supported (uses different extension API) |
| Safari | Not supported (uses different extension API) |

---

## Acknowledgments

Huge thanks to **Deep Bansal** for leading the **v3.1.0 revamp** — the side-panel dock, AI-first auto-copy export, Copy-for-AI prompts, and the extraction-fidelity + performance overhaul.

Special thanks to **Shaurya** for the creative vision and helping me make this tool.
