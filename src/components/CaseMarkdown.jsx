// src/components/CaseMarkdown.jsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

import { ckeditorSchema } from '../lib/markdown/ckeditorSchema';
import { remarkObsidianCallouts } from '../lib/markdown/remarkObsidianCallouts';

/**
 * Corrige les blockquotes échappés par Strapi:
 * "\>" en début de ligne → "> "
 */
function normalizeEscapedBlockquotes(src) {
  if (typeof src !== 'string') return src;
  return src.replace(/^[ \t]*\\>\s?/gm, '> ');
}

export default function CaseMarkdown({ children }) {
  const source = normalizeEscapedBlockquotes(String(children ?? ''));

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkObsidianCallouts]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, ckeditorSchema]]}
    >
      {source}
    </ReactMarkdown>
  );
}
