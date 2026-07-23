// src/App.jsx
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useEffect } from 'react';

import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import LiensUtiles from './pages/LiensUtiles';
import ScrollToTop from './components/ScrollToTop';

import DocsRouter from './pages/DocsRouter';
import CasCliniquesRouter from './pages/CasCliniquesRouter';

import { MobileDrawerProvider } from './ui/MobileDrawerContext';
import { CaseDetailSidebarProvider } from './ui/CaseDetailSidebarContext';
import { primeTrainingStats, revalidateTrainingStats } from './lib/trainingStatsStore';

// maintenance en prod :✅ 0 = maintenance OFF, 1 = maintenance ON
const MAINTENANCE_PROD = 0;

const DOCS_DEFAULT_CHAPTER_SLUG =
  import.meta.env.VITE_DOCS_DEFAULT_CHAPTER_SLUG || 'medecine-orale';

const TRAINING_STATS_PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

function MaintenancePage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 720, textAlign: 'center' }}>
        <img
          src="/logo.svg"
          alt="Logo"
          style={{ width: 260, maxWidth: '70vw', height: 'auto', marginBottom: 18 }}
        />
        <h1 style={{ margin: 0 }}>Maintenance en cours</h1>
        <p style={{ marginTop: 12 }}>L’application est temporairement indisponible &#58;&#40;</p>
      </div>
    </div>
  );
}

function LegacyTrainingRedirect() {
  const splat = (useParams()['*'] || '').replace(/^\/+|\/+$/g, '');
  const parts = splat.split('/').filter(Boolean);

  if (parts.length === 0 || parts[0] === 'tous') {
    return <Navigate to="/entrainement" replace />;
  }

  if (parts[0] === 'qr') {
    return <Navigate to="/entrainement/qr" replace />;
  }

  if (parts[0] === 'quiz') {
    return <Navigate to="/entrainement/quiz" replace />;
  }

  if (parts[0] === 'cas' && parts[1]) {
    return <Navigate to={`/entrainement/cas/${parts[1]}`} replace />;
  }

  return <Navigate to="/entrainement" replace />;
}

function LegacyCasesRedirect() {
  const splat = (useParams()['*'] || '').replace(/^\/+|\/+$/g, '');
  const parts = splat.split('/').filter(Boolean);

  if (parts.length === 0 || parts[0] === 'tous') {
    return <Navigate to="/entrainement" replace />;
  }

  if (parts[0] === 'qr') {
    return <Navigate to="/entrainement/qr" replace />;
  }

  if (parts[0] === 'quiz') {
    return <Navigate to="/entrainement/quiz" replace />;
  }

  if (parts[0] === 'cas' && parts[1]) {
    return <Navigate to={`/entrainement/cas/${parts[1]}`} replace />;
  }

  // L'ancien routeur interprétait les autres segments comme des routes Atlas.
  return <Navigate to={`/atlas/${splat}`} replace />;
}

function TrainingStatsSync() {
  useEffect(() => {
    const refresh = () =>
      revalidateTrainingStats({ publicationState: TRAINING_STATS_PUB_STATE }).catch(() => {});

    // Requête minuscule et dédupliquée. Si le cache est frais, cet appel ne fait aucun fetch.
    primeTrainingStats({ publicationState: TRAINING_STATS_PUB_STATE }).catch(() => {});

    const onVisible = () => {
      if (document.visibilityState === 'hidden') return;
      refresh();
    };

    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}

function BackgroundRouteSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    const body = document.body;
    body.classList.remove('bg-home', 'bg-secondary', 'bg-none');

    const segs = pathname.split('/').filter(Boolean);

    // Atlas : la racine affiche la liste ; les sous-routes affichent une fiche.
    const isAtlasRoot = pathname === '/atlas';
    const isCaseDetailAtlas = pathname.startsWith('/atlas/') && !isAtlasRoot;

    // Entraînement : seules les fiches /entrainement/cas/:slug utilisent le fond de détail.
    const isCaseDetailTraining = pathname.startsWith('/entrainement/cas/');

    // Compatibilité avec d'anciennes URL avant leur redirection.
    const isCaseDetailQrQuiz = pathname.startsWith('/qr-quiz/cas/');
    const isCaseDetailOldCas = pathname.startsWith('/cas-cliniques/cas/');

    // Détail documentaire.
    const isReservedRoot =
      segs.length > 0 &&
      [
        'atlas',
        'entrainement',
        'randomisation',
        'qr-quiz',
        'cas-cliniques',
        'liens-utiles',
        'documentation',
      ].includes(segs[0]);

    const isCanonicalMedicineOralDetail =
      pathname.startsWith('/documentation/') &&
      segs[1] === DOCS_DEFAULT_CHAPTER_SLUG &&
      segs.length >= 3;

    const isCaseDetailDoc =
      isCanonicalMedicineOralDetail ||
      (pathname.startsWith('/documentation/') && segs.length >= 4) ||
      (!pathname.startsWith('/documentation/') && !isReservedRoot && segs.length >= 3);

    if (pathname === '/') body.classList.add('bg-home');
    else if (
      isCaseDetailAtlas ||
      isCaseDetailTraining ||
      isCaseDetailQrQuiz ||
      isCaseDetailOldCas ||
      isCaseDetailDoc
    ) {
      body.classList.add('bg-none');
    } else {
      body.classList.add('bg-secondary');
    }
  }, [pathname]);

  return null;
}

export default function App() {
  if (import.meta.env.PROD && MAINTENANCE_PROD === 1) {
    return <MaintenancePage />;
  }

  return (
    <MobileDrawerProvider>
      <CaseDetailSidebarProvider>
        <BackgroundRouteSync />
        <TrainingStatsSync />

        <Navbar />
        <ScrollToTop />

        <Routes>
          <Route path="/" element={<HomePage />} />

          <Route path="/liens-utiles" element={<LiensUtiles />} />

          {/* Hubs principaux */}
          <Route path="/atlas/*" element={<CasCliniquesRouter />} />
          <Route path="/entrainement/*" element={<CasCliniquesRouter />} />

          {/* Compatibilité avec les anciennes URL */}
          <Route path="/randomisation" element={<Navigate to="/entrainement/aleatoire" replace />} />
          <Route path="/qr-quiz/*" element={<LegacyTrainingRedirect />} />
          <Route path="/cas-cliniques/*" element={<LegacyCasesRedirect />} />

          {/* Documentation : route générique */}
          <Route path="/documentation/*" element={<DocsRouter />} />

          {/* URLs courtes : /moco /moco/medecine-orale ... */}
          <Route path="/*" element={<DocsRouter />} />
        </Routes>
      </CaseDetailSidebarProvider>
    </MobileDrawerProvider>
  );
}
