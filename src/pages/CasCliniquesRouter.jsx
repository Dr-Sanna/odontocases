// src/pages/CasCliniquesRouter.jsx
import { lazy, Suspense } from 'react';
import { useLocation, useParams } from 'react-router-dom';

const CasCliniques = lazy(() => import('./CasCliniques'));
const CaseDetail = lazy(() => import('./CaseDetail'));
const Aleatoire = lazy(() => import('./Aléatoire'));

function RouteFallback() {
  return <div className="cd-state">Chargement…</div>;
}

export default function CasCliniquesRouter() {
  const { pathname } = useLocation();
  const splat = (useParams()['*'] || '').replace(/^\/+/, '');
  const parts = splat.split('/').filter(Boolean);
  const isAtlasNamespace = pathname === '/atlas' || pathname.startsWith('/atlas/');

  let content;

  if (isAtlasNamespace) {
    if (parts.length === 0) {
      content = <CasCliniques />;
    } else {
      const pathologySlug = parts[0] || null;
      const caseSlug = parts[1] || null;
      content = <CaseDetail kind="cas-presentation" pathologySlug={pathologySlug} caseSlug={caseSlug} />;
    }
  } else if (parts.length === 0) {
    content = <CasCliniques />;
  } else if (
    (parts[0] === 'qr' || parts[0] === 'quiz' || parts[0] === 'presentation') &&
    parts.length === 1
  ) {
    content = <CasCliniques />;
  } else if (parts[0] === 'aleatoire' && parts.length === 1) {
    content = <Aleatoire />;
  } else if (parts[0] === 'cas') {
    const slug = parts[1] || null;
    content = slug ? <CaseDetail kind="cas" slug={slug} /> : <CasCliniques />;
  } else {
    content = <CasCliniques />;
  }

  return <Suspense fallback={<RouteFallback />}>{content}</Suspense>;
}
