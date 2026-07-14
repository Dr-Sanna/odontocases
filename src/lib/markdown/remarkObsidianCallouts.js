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
    if (n.type === 'paragraph') return !isEmptyParagraph(n);
    if (n.type === 'html') return String(n.value || '').trim().length > 0;

    return true;
  });
}

function isEmptyParagraph(node) {
  if (!node || node.type !== 'paragraph') return false;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) return true;

  return children.every((child) => {
    if (!child) return true;
    if (child.type === 'text') return String(child.value || '').trim().length === 0;
    if (child.type === 'break') return true;
    return false;
  });
}

function stripEmptyParagraphs(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((node) => !isEmptyParagraph(node));
}

function paragraphRemainderAfterMarker(firstParagraph, marker) {
  if (!firstParagraph || firstParagraph.type !== 'paragraph') return [];
  const originalChildren = Array.isArray(firstParagraph.children) ? firstParagraph.children : [];
  if (originalChildren.length === 0) return [];

  const children = [];

  // Texte situé sur la même ligne que le marqueur : [!col|46] Texte conservé
  if (marker?.title) {
    children.push({ ...originalChildren[0], value: String(marker.title) });
  }

  // CommonMark peut conserver le saut de ligne souple et le texte suivant dans
  // le même nœud texte : "[!col|46]\nTexte conservé".
  if (marker?.remainder) {
    children.push({ ...originalChildren[0], value: String(marker.remainder) });
  }

  // Autres nœuds inline éventuels du paragraphe (liens, emphase, break, etc.).
  children.push(...originalChildren.slice(1));

  // Nettoyage du début : CommonMark insère souvent un break puis du texte.
  while (children.length > 0) {
    const first = children[0];

    if (first?.type === 'break') {
      children.shift();
      continue;
    }

    if (first?.type === 'text') {
      const trimmed = String(first.value || '').replace(/^\s+/, '');
      if (!trimmed) {
        children.shift();
        continue;
      }
      first.value = trimmed;
    }

    break;
  }

  if (children.length === 0) return [];

  const paragraph = {
    ...firstParagraph,
    children,
  };

  return isEmptyParagraph(paragraph) ? [] : [paragraph];
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

/**
 * Marqueur de callout Obsidian.
 * Supporte aussi les variantes avec options :
 * - [!multi-column|bordered]
 * - [!col|46]
 * - [!info]- Titre
 */
const CALLOUT_MARKER_RE = /^\s*\[!([a-z][\w-]*)(?:\|([^\]]+))?\]([+-])?\s*(.*?)\s*$/i;
const CALLOUT_PREFIX_RE = /^\s*\[!([a-z][\w-]*)(?:\|([^\]]+))?\]([+-])?\s*/i;

function inlineText(nodes) {
  if (!Array.isArray(nodes)) return '';

  const read = (node) => {
    if (!node) return '';
    if (node.type === 'text' || node.type === 'inlineCode') return String(node.value || '');
    if (node.type === 'break') return '\n';
    if (Array.isArray(node.children)) return node.children.map(read).join('');
    return '';
  };

  return nodes.map(read).join('');
}

function splitInlineNodesAtFirstLineBreak(nodes) {
  const before = [];
  const after = [];
  let found = false;

  for (const original of Array.isArray(nodes) ? nodes : []) {
    if (found) {
      after.push(original);
      continue;
    }

    if (original?.type === 'break') {
      found = true;
      continue;
    }

    if (original?.type === 'text') {
      const raw = String(original.value || '');
      const match = raw.match(/\r?\n/);
      if (match) {
        const index = match.index ?? -1;
        const left = index >= 0 ? raw.slice(0, index) : raw;
        const right = index >= 0 ? raw.slice(index + match[0].length) : '';

        if (left) before.push({ ...original, value: left });
        if (right) after.push({ ...original, value: right.replace(/^\s+/, '') });
        found = true;
        continue;
      }
    }

    before.push(original);
  }

  return { before, after, found };
}

function stripCalloutPrefix(nodes) {
  const cloned = (Array.isArray(nodes) ? nodes : []).map((node) => ({ ...node }));
  let stripped = false;

  for (const node of cloned) {
    if (stripped) break;
    if (node?.type !== 'text') continue;

    const raw = String(node.value || '');
    const next = raw.replace(CALLOUT_PREFIX_RE, '');
    if (next !== raw) {
      node.value = next;
      stripped = true;
    }
  }

  while (cloned[0]?.type === 'text' && !String(cloned[0].value || '').trim()) cloned.shift();
  while (cloned.at(-1)?.type === 'text' && !String(cloned.at(-1).value || '').trim()) cloned.pop();

  return cloned;
}

function paragraphFromInlineNodes(template, inlineNodes) {
  const children = Array.isArray(inlineNodes) ? [...inlineNodes] : [];
  while (children[0]?.type === 'text') {
    const value = String(children[0].value || '').replace(/^\s+/, '');
    if (!value) {
      children.shift();
      continue;
    }
    children[0] = { ...children[0], value };
    break;
  }

  if (children.length === 0) return [];
  const paragraph = { ...template, children };
  return isEmptyParagraph(paragraph) ? [] : [paragraph];
}

function parseCalloutMarker(value) {
  if (typeof value !== 'string') return null;

  // Un saut de ligne Markdown simple peut rester dans le premier nœud texte.
  // On analyse uniquement la première ligne comme marqueur et on conserve le
  // reste afin de le réinjecter dans le contenu de la colonne/callout.
  const raw = String(value);
  const newlineMatch = raw.match(/\r?\n/);
  const newlineIndex = newlineMatch?.index ?? -1;
  const markerLine = newlineIndex === -1 ? raw : raw.slice(0, newlineIndex);
  const remainder = newlineIndex === -1
    ? ''
    : raw.slice(newlineIndex + newlineMatch[0].length).replace(/^\s+/, '');

  const m = markerLine.match(CALLOUT_MARKER_RE);
  if (!m) return null;

  const rawType = String(m[1] || '').toLowerCase();
  const rawOptions = String(m[2] || '').trim();
  const options = rawOptions
    ? rawOptions
        .split('|')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];

  return {
    rawType,
    options,
    fold: m[3] || '', // '' | '-' | '+'
    title: String(m[4] || '').trim(),
    remainder,
  };
}

function getCalloutStart(blockquoteNode) {
  if (!blockquoteNode || blockquoteNode.type !== 'blockquote') return null;
  const firstParagraph = blockquoteNode.children?.[0];
  const firstChild = firstParagraph?.children?.[0];
  if (!firstParagraph || firstParagraph.type !== 'paragraph') return null;
  if (!firstChild || firstChild.type !== 'text') return null;

  const split = splitInlineNodesAtFirstLineBreak(firstParagraph.children);
  const marker = parseCalloutMarker(inlineText(split.before));
  if (!marker) return null;

  return {
    marker,
    firstParagraph,
    firstChild,
    headerNodes: split.before,
    bodyInlineNodes: split.after,
  };
}

/** Callout start = blockquote dont 1ère ligne commence par [!type] */
function isCalloutStart(blockquoteNode) {
  return Boolean(getCalloutStart(blockquoteNode));
}

function isTableishHtml(val) {
  if (typeof val !== 'string') return false;
  const s = val.trim().toLowerCase();
  if (s.startsWith('<table')) return true;
  if (s.startsWith('<figure') && s.includes('<table')) return true;
  return false;
}

function normalizeOption(option) {
  return String(option || '').trim().toLowerCase();
}

function hasOption(options, wanted) {
  const key = normalizeOption(wanted);
  return (options || []).some((option) => normalizeOption(option) === key);
}

function parseColumnWeight(options) {
  const raw = (options || []).find((option) => /^\d+(?:[.,]\d+)?%?\s*$/.test(String(option || '').trim()));
  if (!raw) return null;

  const value = Number.parseFloat(String(raw).replace(',', '.').replace('%', '').trim());
  if (!Number.isFinite(value) || value <= 0) return null;

  // Les nombres représentent des pourcentages/poids visuels. On borne pour éviter
  // une valeur accidentelle extrême qui casserait la mise en page.
  return Math.max(1, Math.min(100, value));
}

function appendClasses(existing, classes) {
  const baseClasses = Array.isArray(existing) ? existing : existing ? [existing] : [];
  return [...baseClasses, ...classes];
}

function prepareHProperties(node) {
  if (!node.data) node.data = {};
  if (!node.data.hProperties) node.data.hProperties = {};
  return node.data.hProperties;
}

function transformMultiColumnCallout(node, parsed) {
  const { marker, firstParagraph, headerNodes, bodyInlineNodes } = parsed;
  const headerContent = stripCalloutPrefix(headerNodes);
  const sameParagraphContent = [
    ...headerContent,
    ...(headerContent.length && bodyInlineNodes.length ? [{ type: 'break' }] : []),
    ...bodyInlineNodes,
  ];
  const firstParagraphRemainder = paragraphFromInlineNodes(firstParagraph, sameParagraphContent);
  node.children.shift();
  const innerChildren = stripEmptyParagraphs([...firstParagraphRemainder, ...node.children]);

  node.data = node.data || {};
  node.data.hName = 'div';

  const h = prepareHProperties(node);
  const classes = ['cd-callout-multi-column'];
  if (hasOption(marker.options, 'bordered') || hasOption(marker.options, 'border')) {
    classes.push('cd-callout-multi-column--bordered');
  }

  h.className = appendClasses(h.className, classes);
  h['data-callout'] = 'multi-column';

  node.children = innerChildren;
}

function transformColumnCallout(node, parsed) {
  const { marker, firstParagraph, headerNodes, bodyInlineNodes } = parsed;
  const headerContent = stripCalloutPrefix(headerNodes);
  const sameParagraphContent = [
    ...headerContent,
    ...(headerContent.length && bodyInlineNodes.length ? [{ type: 'break' }] : []),
    ...bodyInlineNodes,
  ];
  const firstParagraphRemainder = paragraphFromInlineNodes(firstParagraph, sameParagraphContent);
  node.children.shift();
  const innerChildren = stripEmptyParagraphs([...firstParagraphRemainder, ...node.children]);
  const weight = parseColumnWeight(marker.options);

  node.data = node.data || {};
  node.data.hName = 'div';

  const h = prepareHProperties(node);
  h.className = appendClasses(h.className, ['cd-callout-column']);
  h['data-callout'] = 'col';

  if (weight !== null) {
    h.style = `--cd-callout-col-weight: ${weight};`;
    h['data-callout-col'] = String(weight);
  }

  node.children = innerChildren;
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

      const parsed = getCalloutStart(node);
      if (!parsed) return;

      const { marker, firstParagraph, headerNodes, bodyInlineNodes } = parsed;
      const rawType = marker.rawType;

      // Callout spécial : grille multicolonnes. Pas de titre, pas d'icône.
      if (rawType === 'multi-column' || rawType === 'multicolumn' || rawType === 'columns') {
        transformMultiColumnCallout(node, parsed);
        return;
      }

      // Callout spécial : colonne d'une grille multicolonnes. Le chiffre après | est
      // utilisé comme poids relatif, ex. [!col|46] + [!col|54].
      if (rawType === 'col' || rawType === 'column') {
        transformColumnCallout(node, parsed);
        return;
      }

      const fold = marker.fold; // '' | '-' | '+'
      const calloutType = KNOWN.has(rawType) ? rawType : 'info';
      const icon = ICON[calloutType] || 'ℹ️';

      // ---- titre : uniquement la première ligne du blockquote.
      // Le corps peut rester dans le même paragraphe MDAST sous forme de saut de ligne souple.
      const titleNodes = stripCalloutPrefix(headerNodes);
      const titleHtmlRaw = renderInlineNodesToHtml(titleNodes);
      const fallbackTitle =
        calloutType === 'info' ? 'Info' : calloutType.charAt(0).toUpperCase() + calloutType.slice(1);
      const titleHtml = titleHtmlRaw && titleHtmlRaw.replace(/<[^>]+>/g, '').trim()
        ? titleHtmlRaw
        : escapeHtml(fallbackTitle);

      // ---- retire le paragraphe d’en-tête, mais réinjecte la partie située
      // après le premier saut de ligne comme premier paragraphe du corps.
      const sameParagraphBody = paragraphFromInlineNodes(firstParagraph, bodyInlineNodes);
      node.children.shift();
      const innerChildren = stripEmptyParagraphs([...sameParagraphBody, ...node.children]);

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

      const h = prepareHProperties(node);

      h.className = appendClasses(h.className, ['cd-callout', `cd-callout-${calloutType}`]);
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
