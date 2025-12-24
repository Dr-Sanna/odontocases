// src/lib/markdown/ckeditorSchema.js
import { defaultSchema } from 'rehype-sanitize';

/**
 * Schéma sanitize pour CKEditor + callouts :
 * - tables + colgroup/col + style="width:..."
 * - img width/height/style
 * - blockquote: className + data-callout
 * - div/span: className (heading callout)
 * - details/summary: pour callouts pliables
 * + ids (ancres) sur headings / span / div / a
 */
export const ckeditorSchema = (() => {
  const tagNames = new Set([...(defaultSchema.tagNames || [])]);
  [
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'colgroup',
    'col',
    'figure',
    'figcaption',
    'details',
    'summary',
  ].forEach((t) => tagNames.add(t));

  // si jamais certains headings n’étaient pas présents (normalement oui), on les garde
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((t) => tagNames.add(t));

  const attributes = {
    ...(defaultSchema.attributes || {}),

    table: [...(defaultSchema.attributes?.table || []), 'className', 'style'],
    thead: [...(defaultSchema.attributes?.thead || []), 'className', 'style'],
    tbody: [...(defaultSchema.attributes?.tbody || []), 'className', 'style'],
    tfoot: [...(defaultSchema.attributes?.tfoot || []), 'className', 'style'],
    tr: [...(defaultSchema.attributes?.tr || []), 'className', 'style'],
    td: [...(defaultSchema.attributes?.td || []), 'className', 'style', 'colspan', 'rowspan'],
    th: [...(defaultSchema.attributes?.th || []), 'className', 'style', 'colspan', 'rowspan', 'scope'],
    colgroup: [...(defaultSchema.attributes?.colgroup || []), 'className', 'style', 'span'],
    col: [...(defaultSchema.attributes?.col || []), 'className', 'style', 'span'],
    figure: [...(defaultSchema.attributes?.figure || []), 'className', 'style'],
    figcaption: [...(defaultSchema.attributes?.figcaption || []), 'className', 'style'],

    img: [...(defaultSchema.attributes?.img || []), 'style', 'width', 'height'],

    blockquote: [...(defaultSchema.attributes?.blockquote || []), 'className', 'data-callout'],
    div: [...(defaultSchema.attributes?.div || []), 'className', 'id'],
    span: [...(defaultSchema.attributes?.span || []), 'className', 'id'],

    details: [...(defaultSchema.attributes?.details || []), 'className', 'open'],
    summary: [...(defaultSchema.attributes?.summary || []), 'className'],

    // ✅ ancres sur titres (si tu ajoutes des ids à la main ou via rehypeSlug après sanitize, c’est safe)
    h1: [...(defaultSchema.attributes?.h1 || []), 'id', 'className'],
    h2: [...(defaultSchema.attributes?.h2 || []), 'id', 'className'],
    h3: [...(defaultSchema.attributes?.h3 || []), 'id', 'className'],
    h4: [...(defaultSchema.attributes?.h4 || []), 'id', 'className'],
    h5: [...(defaultSchema.attributes?.h5 || []), 'id', 'className'],
    h6: [...(defaultSchema.attributes?.h6 || []), 'id', 'className'],

    // ✅ utile si tu poses des ancres sur <a id="...">
    a: [...(defaultSchema.attributes?.a || []), 'id'],
  };

  return {
    ...defaultSchema,
    tagNames: Array.from(tagNames),
    attributes,
  };
})();
