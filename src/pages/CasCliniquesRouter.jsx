// src/pages/CasCliniquesRouter.jsx
import { useParams } from 'react-router-dom';
import CasCliniques from './CasCliniques';
import CaseDetail from './CaseDetail';

export default function CasCliniquesRouter() {
  const splat = (useParams()['*'] || '').replace(/^\/+/, '');
  const parts = splat.split('/').filter(Boolean);

  // /atlas  ou /qr-quiz
  if (parts.length === 0) return <CasCliniques />;

  // ✅ QR/QUIZ hub — LISTES (doivent rester des listes)
  // /qr-quiz/tous
  if (parts[0] === 'tous' && parts.length === 1) return <CasCliniques />;

  // /qr-quiz/qr
  if (parts[0] === 'qr' && parts.length === 1) return <CasCliniques />;

  // /qr-quiz/quiz
  if (parts[0] === 'quiz' && parts.length === 1) return <CasCliniques />;

  // ✅ QR/QUIZ hub — DETAIL
  // /qr-quiz/cas/:slug
  if (parts[0] === 'cas') {
    const slug = parts[1] || null;
    if (!slug) return <CasCliniques />;
    return <CaseDetail kind="cas" slug={slug} />;
  }

  // ✅ ATLAS hub — DETAIL
  // /atlas/:pathologySlug/:caseSlug?
  // (ici parts[0] est directement la pathologie)
  const pathologySlug = parts[0] || null;
  const caseSlug = parts[1] || null;
  return <CaseDetail kind="cas-presentation" pathologySlug={pathologySlug} caseSlug={caseSlug} />;
}
