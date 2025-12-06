import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useCaseDetailSidebar } from '../ui/CaseDetailSidebarContext';
import './Navbar.css';

const THEME_KEY = 'theme'; // 'light' | 'dark'

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}

  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  return prefersDark ? 'dark' : 'light';
}

function isCaseDetailPath(pathname) {
  return /^\/cas-cliniques\/[^/]+$/.test(pathname);
}

export default function Navbar() {
  const [theme, setTheme] = useState(getInitialTheme);
  const { pathname } = useLocation();
  const isCaseDetail = isCaseDetailPath(pathname);

  const { mobileOpen, setMobileOpen } = useCaseDetailSidebar();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  // si tu quittes CaseDetail -> ferme le drawer mobile
  useEffect(() => {
    if (!isCaseDetail) setMobileOpen(false);
  }, [isCaseDetail, setMobileOpen]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const toggleCaseDetailMenu = () => setMobileOpen((v) => !v);

  return (
    <nav className="navbar">
      <div className="navbar-left">
        {/* Bouton drawer (visible seulement mobile/tablette via CSS) */}
        {isCaseDetail && (
          <button
            type="button"
            className="cd-nav-toggle"
            aria-label={mobileOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={mobileOpen}
            onClick={toggleCaseDetailMenu}
          >
            <span className="cd-nav-toggle-bars" aria-hidden="true" />
          </button>
        )}

        <Link to="/" className="logo-container" draggable="false" aria-label="Retour à l’accueil">
          <img src="/logo.svg" alt="Logo" className="logo" />
          <span>Dr Sanna</span>
        </Link>

        <div className="nav-links" aria-label="Navigation principale">
          <NavLink to="/cas-cliniques" className={({ isActive }) => (isActive ? 'active' : '')}>
            Cas Cliniques
          </NavLink>
          <NavLink to="/randomisation" className={({ isActive }) => (isActive ? 'active' : '')}>
            Randomisation
          </NavLink>
          <NavLink to="/documentation" className={({ isActive }) => (isActive ? 'active' : '')}>
            Documentation
          </NavLink>
          <NavLink to="/liens-utiles" className={({ isActive }) => (isActive ? 'active' : '')}>
            Liens Utiles
          </NavLink>
        </div>
      </div>

      <div className="navbar-right">
        <a
          className="github-link"
          href="https://github.com/Dr-Sanna"
          target="_blank"
          rel="noopener noreferrer"
          title="Voir sur GitHub"
          aria-label="Ouvrir le GitHub"
        >
          <svg className="github-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
        </a>

        <button
          onClick={toggleTheme}
          className="theme-toggle"
          title="Changer le thème"
          aria-label="Changer le thème"
          aria-pressed={theme === 'dark'}
          type="button"
        >
          {theme === 'dark' ? '🌕' : '☀️'}
        </button>
      </div>
    </nav>
  );
}
