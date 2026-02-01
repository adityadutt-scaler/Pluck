# Pluck

**Extract any UI component from the web and make it yours.**

Pluck is a Chrome browser extension that lets you select any UI component from any webpage, extract it with all its styles, and export it as standalone HTML, JSX, CSS, or in a token-optimized format perfect for AI/LLM consumption. Includes a full-featured code preview page with live editing, syntax highlighting, and a dynamic live preview.

## Features

- **Point & Click Selection** - Hover over any element to highlight it, click to select
- **Multi-Select Support** - Hold Shift and click to select multiple components, with live count display
- **Combined Export** - Multiple selections are exported as a single file
- **Standalone HTML Export** - Get a fully functional HTML file with embedded CSS
- **JSX Export** - Convert extracted components to JSX with `className` attributes
- **CSS Export** - Extracted and deduplicated CSS styles
- **TOON Format Export** - Token-Optimized Object Notation for AI/LLM workflows
- **Code Preview Page** - Dedicated preview page with syntax highlighting, live code editing, and dynamic live preview
- **Live Code Editor** - Edit extracted code in-browser with real-time syntax highlighting (Prism-Live)
- **Dynamic Live Preview** - Live HTML render that auto-adjusts orientation based on content aspect ratio
- **Tailwind CSS Detection** - Automatically detects and flags Tailwind utility classes in extracted components
- **HTML Beautification** - Exported HTML is auto-formatted with proper indentation
- **Live Element Preview in Popup** - Real-time visual preview and code snippet of hovered/selected elements right in the extension popup
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
   - Click it to open the popup and start using the extension

---

## Quick Start

1. **Navigate** to any webpage you want to extract components from

2. **Activate Pluck** by either:
   - Clicking the extension icon and pressing "Start Selecting", or
   - Using the keyboard shortcut (Ctrl+Shift+S / Cmd+Shift+S)

3. **Hover** over elements to see them highlighted with a red outline

4. **Click** on an element to select it (turns blue)
   - Hold **Shift + Click** to select multiple elements
   - The popup shows a live count of selected elements (e.g., "3 elements selected")

5. **Stop selecting** by either:
   - Pressing the same shortcut again (Ctrl+Shift+S / Cmd+Shift+S), or
   - Clicking "Stop Selecting" in the popup

6. **Export** your selection:
   - Click the "Export" button in the popup, or
   - Use the keyboard shortcut (Ctrl+Shift+E / Cmd+Shift+E)

7. **Code Preview Page** opens with:
   - Syntax-highlighted HTML, JSX, CSS, and TOON tabs
   - Live preview of the rendered component
   - Edit, copy, and download actions

---

## Code Preview Page

When you export a component, Pluck opens a dedicated **Code Preview Page** with a full-featured code viewer and editor.

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
| Export | `Cmd + Shift + E` | `Ctrl + Shift + E` | Opens Code Preview Page |
| X-Ray Mode | `Cmd + Shift + X` | `Ctrl + Shift + X` | Toggle element inspector |
| Color Picker | `Cmd + Shift + P` | `Ctrl + Shift + P` | Pick any color from screen |

### Code Preview Page Shortcuts

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

1. Click the Pluck extension icon
2. Click "Customize Shortcuts" to expand settings
3. Click modifier buttons (⌘/Ctrl, ⇧, ⌥/Alt) to toggle them
4. Click the key input and press your desired key
5. Click "Save Shortcuts" to apply changes

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

When a component uses **Tailwind CSS** utility classes, Pluck automatically detects them and displays a badge in the popup. This helps you identify Tailwind-based components so you can use the appropriate approach when recreating them.

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
- **Button**: Click the layers icon in the Pluck popup

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
- **Button**: Click the eyedropper icon in the Pluck popup

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
┌─────────────┐     Messages      ┌──────────────────┐
│   Popup     │ ───────────────→  │  Content Script  │
│  (popup.js) │                   │ (contentScript.js)│
└─────────────┘                   └────────┬─────────┘
                                           │
                                           │ Messages
                                           ▼
                                  ┌──────────────────┐
                                  │   Background     │
                                  │ (background.js)  │
                                  └────────┬─────────┘
                                           │
                                           │ Opens
                                           ▼
                                  ┌──────────────────┐
                                  │  Preview Page    │
                                  │  (preview.html)  │
                                  └──────────────────┘
```

**Popup** (`popup.html` + `popup.js`)
- User interface for controlling the extension
- Sends messages to content script to start/stop selection
- Displays current status, settings, and live element preview

**Content Script** (`contentScript.js`)
- Injected into every webpage
- Handles element selection and highlighting
- Extracts styles and builds export data (HTML, JSX, CSS, TOON)
- Detects Tailwind CSS usage
- Core extraction engine (~64KB)

**Background Service Worker** (`background.js`)
- Handles file downloads via Chrome Downloads API
- Captures visible tab for Color Picker and live preview
- Opens the Code Preview Page on export

**Code Preview Page** (`preview.html` + `preview.js`)
- Dedicated page for viewing and editing extracted code
- Syntax highlighting via PrismJS
- Live code editing via Prism-Live
- Dynamic live preview with auto-orientation
- Download individual or all export formats

### File Structure

```
Pluck/
├── manifest.json          # Extension configuration (Manifest V3)
├── popup.html             # Popup UI markup
├── popup.js               # Popup logic and event handlers
├── background.js          # Service worker for downloads & preview
├── contentScript.js       # Core selection and extraction engine
├── preview.html           # Code Preview Page markup & styles
├── preview.js             # Preview page logic, editor, live preview
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
| **Popup Live Preview** | Real-time visual preview and code snippet of selected elements in the popup |
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

Special thanks to **Shaurya** for the creative vision and helping me make this tool.
