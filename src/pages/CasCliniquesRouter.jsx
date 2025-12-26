// src/pages/CasCliniquesRouter.jsx
import { useParams } from 'react-router-dom';
import CasCliniques from './CasCliniques';
import CaseDetail from './CaseDetail';

export default function CasCliniquesRouter() {
  const splat = (useParams()['*'] || '').replace(/^\/+/, '');
  const parts = splat.split('/').filter(Boolean);

  if (parts.length === 0) {
    return <CasCliniques />;
  }

  // /cas-cliniques/presentation/:pathologySlug/:caseSlug?
  if (parts[0] === 'presentation') {
    const pathologySlug = parts[1] || null;
    const caseSlug = parts[2] || null;

    return <CaseDetail kind="cas-presentation" pathologySlug={pathologySlug} caseSlug={caseSlug} />;
  }

  // /cas-cliniques/:slug
  return <CaseDetail kind="cas" slug={parts[0]} />;
}
