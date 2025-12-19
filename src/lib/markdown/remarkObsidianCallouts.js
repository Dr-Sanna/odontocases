// src/lib/markdown/remarkObsidianCallouts.js
import { visit } from 'unist-util-visit';

/** Échappement simple HTML pour le titre */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    return '&quot;';
  });
}

/**
 * Plugin remark pour callouts style Obsidian
 */
export function remarkObsidianCallouts() {
  const KNOWN = new Set(['info', 'note', 'tip', 'warning', 'danger', 'success', 'question', 'important']);
  const ICON = {
    info: 'ℹ️',
    note: '📝',
    tip: '💡',
    warning: '⚠️',
    danger: '⛔',
    success: '✅',
    question: '❓',
    important: '📌',
  };

  const isCalloutStart = (blockquoteNode) => {
    if (!blockquoteNode || blockquoteNode.type !== 'blockquote') return false;
    const firstParagraph = blockquoteNode.children?.[0];
    const firstChild = firstParagraph?.children?.[0];
    if (!firstParagraph || firstParagraph.type !== 'paragraph') return false;
    if (!firstChild || firstChild.type !== 'text') return false;
    return /^\s*\[\!(\w+)\]([+-])?\s*(.*?)\s*$/i.test(firstChild.value);
  };

  const isTableishHtml = (val) => {
    if (typeof val !== 'string') return false;
    const s = val.trim().toLowerCase();
    if (s.startsWith('<table')) return true;
    if (s.startsWith('<figure') && s.includes('<table')) return true;
    return false;
  };

  return (tree) => {
    visit(tree, 'blockquote', (node, index, parent) => {
      if (!Array.isArray(node.children) || node.children.length === 0) return;

      const firstParagraph = node.children[0];
      const firstChild = firstParagraph?.children?.[0];
      if (!firstParagraph || firstParagraph.type !== 'paragraph') return;
      if (!firstChild || firstChild.type !== 'text') return;

      const m = firstChild.value.match(/^\s*\[\!(\w+)\]([+-])?\s*(.*?)\s*$/i);
      if (!m) return;

      const rawType = String(m[1] || '').toLowerCase();
      const fold = m[2] || ''; // '' | '-' | '+'
      const titleTextRaw = String(m[3] || '').trim();

      const calloutType = KNOWN.has(rawType) ? rawType : 'info';
      const title =
        titleTextRaw ||
        (calloutType === 'info' ? 'Info' : calloutType.charAt(0).toUpperCase() + calloutType.slice(1));

      const safeTitle = escapeHtml(title);
      const icon = ICON[calloutType] || 'ℹ️';

      // remove header line
      node.children.shift();
      const innerChildren = node.children;

      // pull next HTML table / blockquotes
      if (parent && Array.isArray(parent.children) && typeof index === 'number') {
        let j = index + 1;
        let pulledTable = false;

        while (j < parent.children.length) {
          const sib = parent.children[j];

          if (sib?.type === 'html' && isTableishHtml(sib.value)) {
            innerChildren.push({ type: 'html', value: sib.value });
            parent.children.splice(j, 1);
            pulledTable = true;
            continue;
          }

          if (pulledTable && sib?.type === 'blockquote' && !isCalloutStart(sib)) {
            if (Array.isArray(sib.children) && sib.children.length) {
              innerChildren.push(...sib.children);
            }
            parent.children.splice(j, 1);
            continue;
          }

          break;
        }
      }

      if (!node.data) node.data = {};
      if (!node.data.hProperties) node.data.hProperties = {};
      const h = node.data.hProperties;

      const baseClasses = Array.isArray(h.className) ? h.className : h.className ? [h.className] : [];
      h.className = [...baseClasses, 'cd-callout', `cd-callout-${calloutType}`];
      h['data-callout'] = calloutType;

      const headingCore =
        `<span class="cd-callout-icon">${icon}</span>` +
        `<span class="cd-callout-title">${safeTitle}</span>`;

      if (fold === '-' || fold === '+') {
        const openAttr = fold === '+' ? ' open' : '';
        const headingHtml =
          `<details class="cd-callout-details"${openAttr}>` +
          `<summary class="cd-callout-heading">` +
          `${headingCore}<span class="cd-callout-chevron" aria-hidden="true"></span>` +
          `</summary><div class="cd-callout-content">`;

        node.children = [
          { type: 'html', value: headingHtml },
          ...innerChildren,
          { type: 'html', value: '</div></details>' },
        ];
      } else {
        const headingHtml =
          `<div class="cd-callout-heading">` +
          `${headingCore}` +
          `</div><div class="cd-callout-content">`;

        node.children = [
          { type: 'html', value: headingHtml },
          ...innerChildren,
          { type: 'html', value: '</div>' },
        ];
      }
    });
  };
}
