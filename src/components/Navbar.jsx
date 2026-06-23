// src/components/Navbar.jsx
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import './Navbar.css';

import { useMobileDrawer } from '../ui/MobileDrawerContext';
import { useCaseDetailSidebar } from '../ui/CaseDetailSidebarContext';

const THEME_KEY = 'theme';
const THEME_MODE_KEY = 'theme_mode';

function getSystemTheme() {
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  return prefersDark ? 'dark' : 'light';
}

function getInitialThemeMode() {
  try {
    const savedMode = localStorage.getItem(THEME_MODE_KEY);
    if (savedMode === 'auto' || savedMode === 'dark' || savedMode === 'light') return savedMode;

    // Compat avec l'ancien fonctionnement qui ne stockait que "dark" ou "light" dans "theme".
    const legacyTheme = localStorage.getItem(THEME_KEY);
    if (legacyTheme === 'dark' || legacyTheme === 'light') return legacyTheme;
  } catch {}

  return 'auto';
}

function useIsNarrow(maxWidthPx = 980) {
  const get = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.(`(max-width: ${maxWidthPx}px)`)?.matches
      ? true
      : false;

  const [isNarrow, setIsNarrow] = useState(get);

  useEffect(() => {
    const mq = window.matchMedia?.(`(max-width: ${maxWidthPx}px)`);
    if (!mq) return;

    const onChange = () => setIsNarrow(mq.matches);
    onChange();

    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [maxWidthPx]);

  return isNarrow;
}

function isDetailRoute(pathname) {
  // hubs actuels
  const isAtlasDetail = pathname.startsWith('/atlas/') && pathname !== '/atlas';
  const isQrQuizDetail = pathname.startsWith('/qr-quiz/') && pathname !== '/qr-quiz';

  // compat anciennes routes
  const isOldCasDetail = pathname.startsWith('/cas-cliniques/') && pathname !== '/cas-cliniques';

  return isAtlasDetail || isQrQuizDetail || isOldCasDetail;
}

export default function Navbar() {
  const location = useLocation();
  const isNarrow = useIsNarrow(980);

  const isCaseDetail = useMemo(() => isDetailRoute(location.pathname), [location.pathname]);

  const [themeMode, setThemeMode] = useState(getInitialThemeMode);
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);

  const activeTheme = themeMode === 'auto' ? systemTheme : themeMode;

  const { navOpen, setNavOpen, toggleNav, closeNav } = useMobileDrawer();
  const { mobileOpen, setMobileOpen } = useCaseDetailSidebar();

  // Thème système : utilisé quand le mode automatique est actif.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;

    const onChange = () => setSystemTheme(mq.matches ? 'dark' : 'light');
    onChange();

    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  // Thème appliqué sur <html>.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', activeTheme);
    document.documentElement.setAttribute('data-theme-mode', themeMode);

    try {
      localStorage.setItem(THEME_KEY, activeTheme);
      localStorage.setItem(THEME_MODE_KEY, themeMode);
    } catch {}
  }, [activeTheme, themeMode]);

  // Nettoyage de l'ancienne option de flou des images.
  useEffect(() => {
    document.documentElement.classList.remove('blur-images');

    try {
      localStorage.removeItem('blur_images');
    } catch {}
  }, []);

  // Lock scroll uniquement pour le drawer "nav"
  useEffect(() => {
    if (!isNarrow) return;

    const prevOverflow = document.body.style.overflow;
    if (navOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = prevOverflow || '';

    const onKey = (e) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    if (navOpen) document.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = prevOverflow || '';
      document.removeEventListener('keydown', onKey);
    };
  }, [navOpen, isNarrow, setNavOpen]);

  // Sécurité: si on ouvre un drawer, on ferme l’autre
  useEffect(() => {
    if (!isNarrow) {
      setNavOpen(false);
      setMobileOpen(false);
      return;
    }
    if (navOpen) setMobileOpen(false);
    if (mobileOpen) setNavOpen(false);
  }, [navOpen, mobileOpen, isNarrow, setNavOpen, setMobileOpen]);

  const themeButton = useMemo(() => {
    if (themeMode === 'auto') {
      return {
        icon: '🌓',
        label: `Thème automatique (${activeTheme === 'dark' ? 'sombre' : 'clair'})`,
      };
    }

    if (themeMode === 'dark') {
      return {
        icon: '🌕',
        label: 'Thème sombre',
      };
    }

    return {
      icon: '☀️',
      label: 'Thème clair',
    };
  }, [activeTheme, themeMode]);

  const toggleTheme = () => {
    setThemeMode((mode) => {
      if (mode === 'auto') return 'light';
      if (mode === 'light') return 'dark';
      return 'auto';
    });
  };

  const onMenuClick = () => {
    if (!isNarrow) return;

    if (isCaseDetail) {
      setMobileOpen((v) => !v);
    } else {
      toggleNav();
    }
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbar-left">
          <button type="button" className="navbar-menu-button" aria-label="Ouvrir le menu" onClick={onMenuClick}>
            ☰
          </button>

          <Link to="/" className="logo-container" draggable="false" aria-label="Retour à l’accueil">
            <img src="/logo.svg" alt="Logo" className="logo" />
            <span>Dr Sanna</span>
          </Link>

          <div className="nav-links" aria-label="Navigation principale">
            <NavLink to="/atlas" className={({ isActive }) => (isActive ? 'active' : '')}>
              Atlas
            </NavLink>

            <NavLink to="/qr-quiz" className={({ isActive }) => (isActive ? 'active' : '')}>
              Q/R &amp; Quiz
            </NavLink>

            <NavLink to="/randomisation" className={({ isActive }) => (isActive ? 'active' : '')}>
              Randomisation
            </NavLink>

            <NavLink to="/documentation" className={({ isActive }) => (isActive ? 'active' : '')}>
              Documentation
            </NavLink>

            <NavLink to="/liens-utiles" className={({ isActive }) => (isActive ? 'active' : '')}>
              Liens utiles
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
            title={`${themeButton.label} — cliquer pour changer`}
            aria-label={`${themeButton.label}. Cliquer pour changer le thème.`}
            type="button"
          >
            {themeButton.icon}
          </button>
        </div>
      </nav>

      {/* Drawer NAV : uniquement mobile et uniquement hors CaseDetail */}
      {isNarrow && !isCaseDetail && navOpen && (
        <>
          <div className="md-scrim" onClick={closeNav} role="button" tabIndex={0} aria-label="Fermer le menu" />
          <aside className="md-drawer" aria-label="Menu mobile">
            <nav className="md-nav">
              <NavLink to="/atlas" className="md-link" onClick={() => setNavOpen(false)}>
                Atlas
              </NavLink>
              <NavLink to="/qr-quiz" className="md-link" onClick={() => setNavOpen(false)}>
                Q/R &amp; Quiz
              </NavLink>
              <NavLink to="/randomisation" className="md-link" onClick={() => setNavOpen(false)}>
                Randomisation
              </NavLink>
              <NavLink to="/documentation" className="md-link" onClick={() => setNavOpen(false)}>
                Documentation
              </NavLink>
              <NavLink to="/liens-utiles" className="md-link" onClick={() => setNavOpen(false)}>
                Liens utiles
              </NavLink>
            </nav>
          </aside>
        </>
      )}
    </>
  );
}
