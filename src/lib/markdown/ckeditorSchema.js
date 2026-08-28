// src/lib/markdown/ckeditorSchema.js
import { defaultSchema } from 'rehype-sanitize';

/**
 * Schéma sanitize pour le Markdown/HTML provenant d'Obsidian et de CKEditor.
 *
 * Objectifs :
 * - conserver les éléments HTML de mise en forme courants utilisés dans Obsidian ;
 * - conserver les tables, figures, callouts et ancres utilisés par OdontoCases ;
 * - continuer à filtrer les éléments HTML actifs ou dangereux
 *   (script, iframe, object, embed, form, etc.).
 */
export const ckeditorSchema = (() => {
  const tagNames = new Set([...(defaultSchema.tagNames || [])]);

  // Éléments structurels / composants déjà utilisés par OdontoCases.
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
  ].forEach((tag) => tagNames.add(tag));

  // HTML de mise en forme couramment utile dans une note Obsidian.
  // Plusieurs de ces balises sont déjà présentes dans defaultSchema ;
  // les ajouter explicitement rend la whitelist lisible et stable.
  [
    'p',
    'br',
    'hr',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'del',
    'ins',
    'mark',
    'small',
    'sub',
    'sup',
    'code',
    'pre',
    'kbd',
    'samp',
    'var',
    'cite',
    'q',
    'abbr',
    'time',
    'span',
    'div',
    'blockquote',
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    'a',
    'img',
  ].forEach((tag) => tagNames.add(tag));

  // Titres Markdown / HTML.
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((tag) => tagNames.add(tag));

  const withCommonFormattingAttributes = (tagName) => [
    ...(defaultSchema.attributes?.[tagName] || []),
    'className',
    'style',
    'title',
  ];

  const attributes = {
    ...(defaultSchema.attributes || {}),

    // Tables.
    table: [...(defaultSchema.attributes?.table || []), 'className', 'style'],
    thead: [...(defaultSchema.attributes?.thead || []), 'className', 'style'],
    tbody: [...(defaultSchema.attributes?.tbody || []), 'className', 'style'],
    tfoot: [...(defaultSchema.attributes?.tfoot || []), 'className', 'style'],
    tr: [...(defaultSchema.attributes?.tr || []), 'className', 'style'],
    td: [
      ...(defaultSchema.attributes?.td || []),
      'className',
      'style',
      'colspan',
      'rowspan',
    ],
    th: [
      ...(defaultSchema.attributes?.th || []),
      'className',
      'style',
      'colspan',
      'rowspan',
      'scope',
    ],
    colgroup: [
      ...(defaultSchema.attributes?.colgroup || []),
      'className',
      'style',
      'span',
    ],
    col: [...(defaultSchema.attributes?.col || []), 'className', 'style', 'span'],

    // Figures et images.
    figure: [...(defaultSchema.attributes?.figure || []), 'className', 'style'],
    figcaption: [...(defaultSchema.attributes?.figcaption || []), 'className', 'style'],
    img: [
      ...(defaultSchema.attributes?.img || []),
      'className',
      'style',
      'width',
      'height',
      'title',
    ],

    // Callouts et conteneurs.
    blockquote: [
      ...(defaultSchema.attributes?.blockquote || []),
      'className',
      'style',
      'data-callout',
    ],
    div: [
      ...(defaultSchema.attributes?.div || []),
      'className',
      'id',
      'style',
      'title',
      'data-callout',
      'data-callout-col',
    ],
    span: [
      ...(defaultSchema.attributes?.span || []),
      'className',
      'id',
      'style',
      'title',
    ],
    details: [...(defaultSchema.attributes?.details || []), 'className', 'open'],
    summary: [...(defaultSchema.attributes?.summary || []), 'className'],

    // Mise en forme inline courante.
    p: withCommonFormattingAttributes('p'),
    strong: withCommonFormattingAttributes('strong'),
    b: withCommonFormattingAttributes('b'),
    em: withCommonFormattingAttributes('em'),
    i: withCommonFormattingAttributes('i'),
    u: withCommonFormattingAttributes('u'),
    s: withCommonFormattingAttributes('s'),
    mark: withCommonFormattingAttributes('mark'),
    small: withCommonFormattingAttributes('small'),
    sub: withCommonFormattingAttributes('sub'),
    sup: withCommonFormattingAttributes('sup'),
    code: withCommonFormattingAttributes('code'),
    pre: withCommonFormattingAttributes('pre'),
    kbd: withCommonFormattingAttributes('kbd'),
    samp: withCommonFormattingAttributes('samp'),
    var: withCommonFormattingAttributes('var'),
    cite: withCommonFormattingAttributes('cite'),

    // Balises ayant des attributs sémantiques spécifiques.
    q: [...withCommonFormattingAttributes('q'), 'cite'],
    abbr: [...withCommonFormattingAttributes('abbr'), 'title'],
    time: [...withCommonFormattingAttributes('time'), 'dateTime', 'datetime'],
    del: [...withCommonFormattingAttributes('del'), 'cite', 'dateTime', 'datetime'],
    ins: [...withCommonFormattingAttributes('ins'), 'cite', 'dateTime', 'datetime'],

    // Listes.
    ul: [...(defaultSchema.attributes?.ul || []), 'className', 'style'],
    ol: [
      ...(defaultSchema.attributes?.ol || []),
      'className',
      'style',
      'start',
      'reversed',
      'type',
    ],
    li: [...(defaultSchema.attributes?.li || []), 'className', 'style', 'value'],
    dl: [...(defaultSchema.attributes?.dl || []), 'className', 'style'],
    dt: [...(defaultSchema.attributes?.dt || []), 'className', 'style'],
    dd: [...(defaultSchema.attributes?.dd || []), 'className', 'style'],

    // Ancres sur titres.
    h1: [...(defaultSchema.attributes?.h1 || []), 'id', 'className', 'style'],
    h2: [...(defaultSchema.attributes?.h2 || []), 'id', 'className', 'style'],
    h3: [...(defaultSchema.attributes?.h3 || []), 'id', 'className', 'style'],
    h4: [...(defaultSchema.attributes?.h4 || []), 'id', 'className', 'style'],
    h5: [...(defaultSchema.attributes?.h5 || []), 'id', 'className', 'style'],
    h6: [...(defaultSchema.attributes?.h6 || []), 'id', 'className', 'style'],

    // Liens.
    a: [
      ...(defaultSchema.attributes?.a || []),
      'id',
      'className',
      'style',
      'href',
      'title',
      'target',
      'rel',
    ],
  };

  return {
    ...defaultSchema,
    tagNames: Array.from(tagNames),
    attributes,
  };
})();
