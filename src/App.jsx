// src/App.jsx
import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import CasCliniques from './pages/CasCliniques';
import Randomisation from './pages/Randomisation';
import Documentation from './pages/Documentation';
import LiensUtiles from './pages/LiensUtiles';
import ScrollToTop from './components/ScrollToTop';
import CaseDetail from './pages/CaseDetail';

import Background from './components/Background';
import './App.css';

export default function App() {
  return (
    <div className="app-shell">
      {/* ✅ 1 seul background pour toute l’app */}
      <Background />

      {/* ✅ tout le contenu au-dessus */}
      <div className="app-content">
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
      </div>
    </div>
  );
}
