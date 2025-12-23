import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';

import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import CasCliniques from './pages/CasCliniques';
import Randomisation from './pages/Randomisation';
import Documentation from './pages/Documentation';
import LiensUtiles from './pages/LiensUtiles';
import ScrollToTop from './components/ScrollToTop';
import CaseDetail from './pages/CaseDetail';

import { MobileDrawerProvider } from './ui/MobileDrawerContext';
import { CaseDetailSidebarProvider } from './ui/CaseDetailSidebarContext';

// ✅ 0 = OFF, 1 = ON (prod uniquement)
const MAINTENANCE_PROD = 1;

function MaintenancePage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 720 }}>
        <h1 style={{ margin: 0 }}>Maintenance en cours</h1>
        <p style={{ marginTop: 12 }}>
          L’application est temporairement indisponible. Reviens un peu plus tard.
        </p>
      </div>
    </div>
  );
}

function BackgroundRouteSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    const body = document.body;
    body.classList.remove('bg-home', 'bg-secondary', 'bg-none');

    const isCaseDetail = /^\/cas-cliniques\/[^/]+/.test(pathname);

    if (pathname === '/') body.classList.add('bg-home');
    else if (isCaseDetail) body.classList.add('bg-none');
    else body.classList.add('bg-secondary');
  }, [pathname]);

  return null;
}

export default function App() {
  // ✅ bloque tout en prod si MAINTENANCE_PROD=1
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
          <Route path="/cas-cliniques" element={<CasCliniques />} />
          <Route path="/cas-cliniques/:slug" element={<CaseDetail />} />
          <Route path="/randomisation" element={<Randomisation />} />
          <Route path="/documentation" element={<Documentation />} />
          <Route path="/liens-utiles" element={<LiensUtiles />} />
        </Routes>
      </CaseDetailSidebarProvider>
    </MobileDrawerProvider>
  );
}
