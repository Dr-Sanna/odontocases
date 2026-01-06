// src/App.jsx
import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';

import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import Randomisation from './pages/Randomisation';
import LiensUtiles from './pages/LiensUtiles';
import ScrollToTop from './components/ScrollToTop';

import DocsRouter from './pages/DocsRouter';
import CasCliniquesRouter from './pages/CasCliniquesRouter';

import { MobileDrawerProvider } from './ui/MobileDrawerContext';
import { CaseDetailSidebarProvider } from './ui/CaseDetailSidebarContext';

// maintenance en prod :✅ 0 = maintenance OFF, 1 = maintenance ON
const MAINTENANCE_PROD = 0;

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

function BackgroundRouteSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    const body = document.body;
    body.classList.remove('bg-home', 'bg-secondary', 'bg-none');

    const segs = pathname.split('/').filter(Boolean);

    // atlas :
    // - liste : /atlas
    // - detail : tout le reste sous /atlas/...
    const isAtlasRoot = pathname === '/atlas';
    const isCaseDetailAtlas = pathname.startsWith('/atlas/') && !isAtlasRoot;

    // qr-quiz :
    // - listes : /qr-quiz, /qr-quiz/tous, /qr-quiz/qr, /qr-quiz/quiz
    // - detail : tout le reste sous /qr-quiz/...
    const isQrQuizRoot = pathname === '/qr-quiz';
    const isQrQuizList =
      pathname === '/qr-quiz/tous' || pathname === '/qr-quiz/qr' || pathname === '/qr-quiz/quiz';
    const isCaseDetailQrQuiz = pathname.startsWith('/qr-quiz/') && !isQrQuizRoot && !isQrQuizList;

    // compat ancien
    const isOldCasListRoot = pathname === '/cas-cliniques';
    const isCaseDetailOldCas = pathname.startsWith('/cas-cliniques/') && !isOldCasListRoot;

    // doc detail :
    const isReservedRoot =
      segs.length > 0 &&
      ['randomisation', 'atlas', 'qr-quiz', 'cas-cliniques', 'liens-utiles', 'documentation'].includes(segs[0]);

    const isCaseDetailDoc =
      (pathname.startsWith('/documentation/') && segs.length >= 4) ||
      (!pathname.startsWith('/documentation/') && !isReservedRoot && segs.length >= 3);

    if (pathname === '/') body.classList.add('bg-home');
    else if (isCaseDetailAtlas || isCaseDetailQrQuiz || isCaseDetailOldCas || isCaseDetailDoc) {
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

        <Navbar />
        <ScrollToTop />

        <Routes>
          <Route path="/" element={<HomePage />} />

          <Route path="/randomisation" element={<Randomisation />} />
          <Route path="/liens-utiles" element={<LiensUtiles />} />

          {/* ✅ hubs */}
          <Route path="/atlas/*" element={<CasCliniquesRouter />} />
          <Route path="/qr-quiz/*" element={<CasCliniquesRouter />} />

          {/* compat ancien */}
          <Route path="/cas-cliniques/*" element={<CasCliniquesRouter />} />

          {/* documentation : route générique */}
          <Route path="/documentation/*" element={<DocsRouter />} />

          {/* URLs courtes : /moco /moco/medecine-orale ... */}
          <Route path="/*" element={<DocsRouter />} />
        </Routes>
      </CaseDetailSidebarProvider>
    </MobileDrawerProvider>
  );
}
