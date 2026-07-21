// src/pages/DocsRouter.jsx
import { lazy, Suspense } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

const Documentation = lazy(() => import('./Documentation'));
const CaseDetail = lazy(() => import('./CaseDetail'));

const DEFAULT_SUBJECT_SLUG = import.meta.env.VITE_DOCS_DEFAULT_SUBJECT_SLUG || 'moco';
const DEFAULT_CHAPTER_SLUG = import.meta.env.VITE_DOCS_DEFAULT_CHAPTER_SLUG || 'medecine-orale';

// Protège la route générique /* définie dans App.jsx.
const RESERVED_ROOT = new Set([
  '',
  'randomisation',
  'atlas',
  'qr-quiz',
  'cas-cliniques',
  'liens-utiles',
  'documentation',
]);

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function splitPath(pathname, basePath) {
  let rest = pathname;

  if (basePath && rest.startsWith(basePath)) {
    rest = rest.slice(basePath.length);
  }

  return rest.replace(/^\/+/, '').split('/').filter(Boolean);
}

function buildPath(basePath, segments) {
  const cleanBase = String(basePath || '').replace(/\/+$/, '');
  const cleanSegments = (segments || [])
    .filter(Boolean)
    .map((segment) => String(segment).replace(/^\/+|\/+$/g, ''));
  const joined = [cleanBase, ...cleanSegments].filter(Boolean).join('/');

  return `/${joined.replace(/^\/+/, '')}`;
}

function RouteFallback() {
  return <div className="cd-state">Chargement…</div>;
}

export default function DocsRouter() {
  const { pathname, search, hash } = useLocation();
  const normalizedPathname = normalizePathname(pathname);

  // Une seule URL canonique, sans slash final, tout en conservant query et ancre.
  if (normalizedPathname !== pathname) {
    return <Navigate replace to={`${normalizedPathname}${search}${hash}`} />;
  }

  const isUnderDocumentation =
    normalizedPathname === '/documentation' || normalizedPathname.startsWith('/documentation/');
  const basePath = isUnderDocumentation ? '/documentation' : '';
  const rawParts = splitPath(normalizedPathname, basePath);

  // Compatibilité avec les anciennes adresses :
  // /documentation/moco/medecine-orale/...
  // devient /documentation/medecine-orale/...
  const isLegacyDefaultChapterPath =
    isUnderDocumentation &&
    rawParts[0] === DEFAULT_SUBJECT_SLUG &&
    rawParts[1] === DEFAULT_CHAPTER_SLUG;

  if (isLegacyDefaultChapterPath) {
    const canonicalPath = buildPath(basePath, [DEFAULT_CHAPTER_SLUG, ...rawParts.slice(2)]);
    return <Navigate replace to={`${canonicalPath}${search}${hash}`} />;
  }

  // L'URL publique masque uniquement le sujet technique par défaut « moco ».
  // Les composants reçoivent toujours la hiérarchie Strapi complète.
  const parts =
    isUnderDocumentation && rawParts[0] === DEFAULT_CHAPTER_SLUG
      ? [DEFAULT_SUBJECT_SLUG, ...rawParts]
      : rawParts;

  // Sécurité pour la route générique /* de App.jsx.
  if (!isUnderDocumentation && RESERVED_ROOT.has(parts[0] || '')) {
    return null;
  }

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
