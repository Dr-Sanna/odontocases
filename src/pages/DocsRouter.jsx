// src/pages/DocsRouter.jsx
import { useLocation } from 'react-router-dom';
import Documentation from './Documentation';
import CaseDetail from './CaseDetail';

const RESERVED_ROOT = new Set(['', 'randomisation', 'cas-cliniques', 'liens-utiles', 'documentation']);

function splitPath(pathname, basePath) {
  let rest = pathname;

  if (basePath && rest.startsWith(basePath)) {
    rest = rest.slice(basePath.length);
  }

  rest = rest.replace(/^\/+/, ''); // enlève les /
  const parts = rest.split('/').filter(Boolean);
  return parts;
}

export default function DocsRouter() {
  const { pathname } = useLocation();

  const isUnderDocumentation = pathname === '/documentation' || pathname.startsWith('/documentation/');
  const basePath = isUnderDocumentation ? '/documentation' : '';

  const parts = splitPath(pathname, basePath);

  // sécurité : si on tombe sur une route “réservée” via le fallback, on n’affiche pas la doc
  if (!isUnderDocumentation && RESERVED_ROOT.has(parts[0] || '')) {
    return null;
  }

  const subjectSlug = parts[0] || null;
  const chapterSlug = parts[1] || null;
  const itemSlug = parts[2] || null;
  const sectionSlug = parts[3] || null;

  // 0 → sujets, 1 → chapitres, 2 → items
  if (parts.length <= 2) {
    return <Documentation basePath={basePath} subjectSlug={subjectSlug} chapterSlug={chapterSlug} />;
  }

  // 3+ → détail item/section
  return (
    <CaseDetail
      kind="doc"
      basePath={basePath}
      subjectSlug={subjectSlug}
      chapterSlug={chapterSlug}
      itemSlug={itemSlug}
      sectionSlug={sectionSlug}
    />
  );
}
