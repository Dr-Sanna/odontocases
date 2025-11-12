import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import CasCliniques from './pages/CasCliniques';
import Randomisation from './pages/Randomisation';
import Documentation from './pages/Documentation';
import LiensUtiles from './pages/LiensUtiles';
import ScrollToTop from './components/ScrollToTop'; // 👈 importe le composant
import CaseDetail from './pages/CaseDetail';

export default function App() {
  return (
    <>
      <Navbar />
      <ScrollToTop />   {/* 👈 remet la page en haut à chaque navigation */}
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
