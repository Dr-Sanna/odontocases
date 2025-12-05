import { Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import ScrollToTop from './components/ScrollToTop';
import Background from './components/Background';

import HomePage from './pages/HomePage';
import CasCliniques from './pages/CasCliniques';
import CaseDetail from './pages/CaseDetail';
import Randomisation from './pages/Randomisation';
import Documentation from './pages/Documentation';
import LiensUtiles from './pages/LiensUtiles';

export default function App() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <>
      <Navbar />
      <Background variant={isHome ? 'home' : 'secondary'} />
      <ScrollToTop />

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/cas-cliniques" element={<CasCliniques />} />
        <Route path="/cas-cliniques/:slug" element={<CaseDetail />} />
        <Route path="/randomisation" element={<Randomisation />} />
        <Route path="/documentation" element={<Documentation />} />
        <Route path="/liens-utiles" element={<LiensUtiles />} />
      </Routes>
    </>
  );
}
