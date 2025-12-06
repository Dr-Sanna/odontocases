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

import { CaseDetailSidebarProvider } from './ui/CaseDetailSidebarContext';

function BackgroundRouteSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    const body = document.body;

    body.classList.remove('bg-home', 'bg-secondary', 'bg-none');

    // Case detail : /cas-cliniques/:slug
    const isCaseDetail = /^\/cas-cliniques\/[^/]+$/.test(pathname);

    if (pathname === '/') body.classList.add('bg-home');
    else if (isCaseDetail) body.classList.add('bg-none');
    else body.classList.add('bg-secondary');
  }, [pathname]);

  return null;
}

export default function App() {
  return (
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
  );
}
