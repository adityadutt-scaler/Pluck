// Lightweight HTML Beautifier for Pluck
// Formats HTML with proper indentation without external dependencies

(function () {
  'use strict';

  const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);

  const INLINE_ELEMENTS = new Set([
    'a', 'abbr', 'acronym', 'b', 'bdo', 'big', 'br', 'button', 'cite',
    'code', 'dfn', 'em', 'i', 'img', 'input', 'kbd', 'label', 'map',
    'object', 'output', 'q', 'samp', 'select', 'small', 'span',
    'strong', 'sub', 'sup', 'textarea', 'time', 'tt', 'u', 'var'
  ]);

  const PRESERVE_CONTENT = new Set(['pre', 'code', 'script', 'style', 'textarea']);

  function beautifyHtml(html, options) {
    options = options || {};
    const indentStr = options.indent || '  ';
    const result = [];
    let level = 0;
    let pos = 0;
    const len = html.length;

    // Stack of open tags to track preserve-content mode
    const tagStack = [];
    let preserveDepth = 0;

    while (pos < len) {
      // Skip whitespace between tags (only when not preserving)
      if (preserveDepth === 0) {
        while (pos < len && /\s/.test(html[pos])) pos++;
        if (pos >= len) break;
      }

      if (html[pos] === '<') {
        // Check for comment
        if (html.substr(pos, 4) === '<!--') {
          const endComment = html.indexOf('-->', pos + 4);
          if (endComment === -1) {
            result.push(html.substring(pos));
            break;
          }
          const comment = html.substring(pos, endComment + 3);
          if (preserveDepth > 0) {
            result.push(comment);
          } else {
            result.push(indentStr.repeat(level) + comment);
          }
          pos = endComment + 3;
          continue;
        }

        // Check for DOCTYPE
        if (html.substr(pos, 9).toUpperCase() === '<!DOCTYPE') {
          const endDoctype = html.indexOf('>', pos);
          if (endDoctype === -1) {
            result.push(html.substring(pos));
            break;
          }
          result.push(html.substring(pos, endDoctype + 1));
          pos = endDoctype + 1;
          continue;
        }

        // Check for closing tag
        if (html[pos + 1] === '/') {
          const endTag = html.indexOf('>', pos);
          if (endTag === -1) {
            result.push(html.substring(pos));
            break;
          }
          const fullTag = html.substring(pos, endTag + 1);
          const tagName = fullTag.match(/<\/\s*([a-zA-Z0-9-]+)/);

          if (tagName) {
            const name = tagName[1].toLowerCase();
            // Pop from stack
            if (tagStack.length > 0 && tagStack[tagStack.length - 1] === name) {
              tagStack.pop();
              if (PRESERVE_CONTENT.has(name)) preserveDepth--;
            }

            if (preserveDepth > 0) {
              result.push(fullTag);
            } else {
              level = Math.max(0, level - 1);
              result.push(indentStr.repeat(level) + fullTag);
            }
          }
          pos = endTag + 1;
          continue;
        }

        // Opening tag
        const tagMatch = html.substring(pos).match(/^<([a-zA-Z0-9-]+)/);
        if (!tagMatch) {
          // Not a recognized tag, output as-is
          result.push(html[pos]);
          pos++;
          continue;
        }

        const tagName = tagMatch[1].toLowerCase();

        // Find end of opening tag (handle attributes with quotes)
        let tagEnd = pos + 1;
        let inQuote = false;
        let quoteChar = '';
        while (tagEnd < len) {
          const ch = html[tagEnd];
          if (inQuote) {
            if (ch === quoteChar) inQuote = false;
          } else {
            if (ch === '"' || ch === "'") {
              inQuote = true;
              quoteChar = ch;
            } else if (ch === '>') {
              break;
            }
          }
          tagEnd++;
        }

        if (tagEnd >= len) {
          result.push(html.substring(pos));
          break;
        }

        const fullOpenTag = html.substring(pos, tagEnd + 1);
        const isSelfClosing = fullOpenTag.endsWith('/>') || VOID_ELEMENTS.has(tagName);

        if (preserveDepth > 0) {
          result.push(fullOpenTag);
        } else {
          result.push(indentStr.repeat(level) + fullOpenTag);
        }

        if (!isSelfClosing) {
          tagStack.push(tagName);
          if (PRESERVE_CONTENT.has(tagName)) {
            preserveDepth++;
          } else {
            level++;
          }
        }

        pos = tagEnd + 1;
      } else {
        // Text content
        if (preserveDepth > 0) {
          // In preserve mode, output text as-is until next tag
          let textEnd = html.indexOf('<', pos);
          if (textEnd === -1) textEnd = len;
          result.push(html.substring(pos, textEnd));
          pos = textEnd;
        } else {
          let textEnd = html.indexOf('<', pos);
          if (textEnd === -1) textEnd = len;
          const text = html.substring(pos, textEnd).trim();
          if (text) {
            result.push(indentStr.repeat(level) + text);
          }
          pos = textEnd;
        }
      }
    }

    return result.join('\n');
  }

  // Also beautify JSX (same logic, JSX is structurally similar)
  function beautifyJsx(jsx, options) {
    return beautifyHtml(jsx, options);
  }

  // Expose globally
  if (typeof window !== 'undefined') {
    window.beautifyHtml = beautifyHtml;
    window.beautifyJsx = beautifyJsx;
  }
})();
