// src/pages/CasCliniquesRouter.jsx
import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';

const CasCliniques = lazy(() => import('./CasCliniques'));
const CaseDetail = lazy(() => import('./CaseDetail'));

function RouteFallback() {
  return <div className="cd-state">Chargement…</div>;
}

export default function CasCliniquesRouter() {
  const splat = (useParams()['*'] || '').replace(/^\/+/, '');
  const parts = splat.split('/').filter(Boolean);
  let content;

  if (parts.length === 0) content = <CasCliniques />;
  else if (parts[0] === 'tous' && parts.length === 1) content = <CasCliniques />;
  else if (parts[0] === 'qr' && parts.length === 1) content = <CasCliniques />;
  else if (parts[0] === 'quiz' && parts.length === 1) content = <CasCliniques />;
  else if (parts[0] === 'cas') {
    const slug = parts[1] || null;
    content = slug ? <CaseDetail kind="cas" slug={slug} /> : <CasCliniques />;
  } else {
    const pathologySlug = parts[0] || null;
    const caseSlug = parts[1] || null;
    content = <CaseDetail kind="cas-presentation" pathologySlug={pathologySlug} caseSlug={caseSlug} />;
  }

  return <Suspense fallback={<RouteFallback />}>{content}</Suspense>;
}
