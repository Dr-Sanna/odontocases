// src/lib/markdown/ckeditorSchema.js
import { defaultSchema } from 'rehype-sanitize';

/**
 * Schéma sanitize pour CKEditor + callouts :
 * - tables + colgroup/col + style="width:..."
 * - img width/height/style
 * - blockquote: className + data-callout
 * - div/span: className (heading callout)
 * - details/summary: pour callouts pliables
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
    div: [...(defaultSchema.attributes?.div || []), 'className'],
    span: [...(defaultSchema.attributes?.span || []), 'className'],
    details: [...(defaultSchema.attributes?.details || []), 'className', 'open'],
    summary: [...(defaultSchema.attributes?.summary || []), 'className'],
  };

  return {
    ...defaultSchema,
    tagNames: Array.from(tagNames),
    attributes,
  };
})();
