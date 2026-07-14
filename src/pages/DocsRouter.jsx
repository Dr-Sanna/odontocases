// src/pages/DocsRouter.jsx
import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';

const Documentation = lazy(() => import('./Documentation'));
const CaseDetail = lazy(() => import('./CaseDetail'));

const RESERVED_ROOT = new Set(['', 'randomisation', 'cas-cliniques', 'liens-utiles', 'documentation']);

function splitPath(pathname, basePath) {
  let rest = pathname;
  if (basePath && rest.startsWith(basePath)) rest = rest.slice(basePath.length);
  return rest.replace(/^\/+/, '').split('/').filter(Boolean);
}

function RouteFallback() {
  return <div className="cd-state">Chargement…</div>;
}

export default function DocsRouter() {
  const { pathname } = useLocation();
  const isUnderDocumentation = pathname === '/documentation' || pathname.startsWith('/documentation/');
  const basePath = isUnderDocumentation ? '/documentation' : '';
  const parts = splitPath(pathname, basePath);

  if (!isUnderDocumentation && RESERVED_ROOT.has(parts[0] || '')) return null;

  const subjectSlug = parts[0] || null;
  const chapterSlug = parts[1] || null;
  const itemSlug = parts[2] || null;
  const sectionSlug = parts[3] || null;

  const content =
    parts.length <= 2 ? (
      <Documentation basePath={basePath} subjectSlug={subjectSlug} chapterSlug={chapterSlug} />
    ) : (
      <CaseDetail
        kind="doc"
        basePath={basePath}
        subjectSlug={subjectSlug}
        chapterSlug={chapterSlug}
        itemSlug={itemSlug}
        sectionSlug={sectionSlug}
      />
    );

  return <Suspense fallback={<RouteFallback />}>{content}</Suspense>;
}
