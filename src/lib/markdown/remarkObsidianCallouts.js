// src/lib/markdown/remarkObsidianCallouts.js
import { visit } from 'unist-util-visit';

/** Échappement simple HTML */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    return '&quot;';
  });
}

/** Échappement attribut HTML (href, title, etc.) */
function escapeAttr(str) {
  // ici on peut réutiliser escapeHtml (mêmes chars critiques)
  return escapeHtml(String(str ?? ''));
}

/** URL sanitizer minimal (évite javascript:) etc. */
function sanitizeHref(url) {
  if (typeof url !== 'string') return '';
  const u = url.trim();
  if (!u) return '';

  // liens relatifs + ancres
  if (u.startsWith('/') || u.startsWith('./') || u.startsWith('../') || u.startsWith('#')) return u;

  // liens absolus safe
  try {
    const parsed = new URL(u);
    const ok = ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol);
    return ok ? u : '';
  } catch {
    return '';
  }
}

/** Détecte si un tableau de nodes contient du contenu "réel" */
function hasMeaningfulContent(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return false;

  return nodes.some((n) => {
    if (!n) return false;

    if (n.type === 'text') return String(n.value || '').trim().length > 0;
    if (n.type === 'paragraph') return true;
    if (n.type === 'html') return String(n.value || '').trim().length > 0;

    return true;
  });
}

/** Render inline MDAST -> HTML (subset volontairement safe) */
function renderInlineNodesToHtml(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return '';

  const render = (n) => {
    if (!n) return '';

    if (n.type === 'text') return escapeHtml(String(n.value || ''));

    if (n.type === 'link') {
      const href = sanitizeHref(String(n.url || ''));
      const label = renderChildren(n.children);
      // si href refusé, on garde juste le label (texte)
      if (!href) return label;
      return `<a href="${escapeAttr(href)}">${label}</a>`;
    }

    if (n.type === 'strong') {
      return `<strong>${renderChildren(n.children)}</strong>`;
    }

    if (n.type === 'emphasis') {
      return `<em>${renderChildren(n.children)}</em>`;
    }

    if (n.type === 'inlineCode') {
      return `<code>${escapeHtml(String(n.value || ''))}</code>`;
    }

    if (n.type === 'break') {
      return '<br/>';
    }

    // par défaut : si node a des enfants, on les rend
    if (Array.isArray(n.children) && n.children.length) return renderChildren(n.children);

    // sinon, on n’injecte rien (évite d’introduire du html brut)
    return '';
  };

  const renderChildren = (children) => (Array.isArray(children) ? children.map(render).join('') : '');

  return nodes.map(render).join('');
}

/** Callout start = blockquote dont 1ère ligne commence par [!type] */
function isCalloutStart(blockquoteNode) {
  if (!blockquoteNode || blockquoteNode.type !== 'blockquote') return false;
  const firstParagraph = blockquoteNode.children?.[0];
  const firstChild = firstParagraph?.children?.[0];
  if (!firstParagraph || firstParagraph.type !== 'paragraph') return false;
  if (!firstChild || firstChild.type !== 'text') return false;
  return /^\s*\[\!(\w+)\]([+-])?\s*(.*?)\s*$/i.test(firstChild.value);
}

function isTableishHtml(val) {
  if (typeof val !== 'string') return false;
  const s = val.trim().toLowerCase();
  if (s.startsWith('<table')) return true;
  if (s.startsWith('<figure') && s.includes('<table')) return true;
  return false;
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

  return (tree) => {
    visit(tree, 'blockquote', (node, index, parent) => {
      if (!Array.isArray(node.children) || node.children.length === 0) return;

      const firstParagraph = node.children[0];
      const firstChild = firstParagraph?.children?.[0];
      if (!firstParagraph || firstParagraph.type !== 'paragraph') return;
      if (!firstChild || firstChild.type !== 'text') return;

      // IMPORTANT : le match se fait avant qu’on modifie firstChild.value
      const m = firstChild.value.match(/^\s*\[\!(\w+)\]([+-])?\s*(.*?)\s*$/i);
      if (!m) return;

      const rawType = String(m[1] || '').toLowerCase();
      const fold = m[2] || ''; // '' | '-' | '+'

      const calloutType = KNOWN.has(rawType) ? rawType : 'info';
      const icon = ICON[calloutType] || 'ℹ️';

      // ---- titre : on rend les inline nodes du 1er paragraphe (liens, bold, etc.)
      // on enlève le préfixe "[!type][+-]" du tout premier text node
      firstChild.value = firstChild.value.replace(/^\s*\[\!(\w+)\]([+-])?\s*/i, '');

      // on récupère tous les inline nodes (texte + link...) qui restent dans le 1er paragraphe
      let titleNodes = Array.isArray(firstParagraph.children) ? [...firstParagraph.children] : [];

      // si le premier texte est vide après replace, on l’enlève
      if (titleNodes[0]?.type === 'text' && !String(titleNodes[0].value || '').trim()) {
        titleNodes.shift();
      }

      const titleHtmlRaw = renderInlineNodesToHtml(titleNodes);
      const fallbackTitle =
        calloutType === 'info' ? 'Info' : calloutType.charAt(0).toUpperCase() + calloutType.slice(1);
      const titleHtml = titleHtmlRaw && titleHtmlRaw.replace(/<[^>]+>/g, '').trim()
        ? titleHtmlRaw
        : escapeHtml(fallbackTitle);

      // ---- remove header line (le 1er paragraphe)
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

      const contentExists = hasMeaningfulContent(innerChildren);

      if (!node.data) node.data = {};
      if (!node.data.hProperties) node.data.hProperties = {};
      const h = node.data.hProperties;

      const baseClasses = Array.isArray(h.className) ? h.className : h.className ? [h.className] : [];
      h.className = [...baseClasses, 'cd-callout', `cd-callout-${calloutType}`];
      h['data-callout'] = calloutType;

      if (!contentExists) h.className.push('cd-callout--title-only');

      const headingCore =
        `<span class="cd-callout-icon">${icon}</span>` +
        `<span class="cd-callout-title">${titleHtml}</span>`;

      // foldable
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
        return;
      }

      // non-foldable
      const headingHtml =
        `<div class="cd-callout-heading">` +
        `${headingCore}` +
        `</div><div class="cd-callout-content">`;

      node.children = [
        { type: 'html', value: headingHtml },
        ...innerChildren,
        { type: 'html', value: '</div>' },
      ];
    });
  };
}
