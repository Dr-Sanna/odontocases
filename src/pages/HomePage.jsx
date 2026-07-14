// src/pages/HomePage.jsx
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { isDocsFresh, primeDocsEssentials } from '../lib/docsPrefetchStore';
import './HomePage.css';

const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

export default function HomePage() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const primingRef = useRef(false);

  function onSubmit(e) {
    e.preventDefault();
    const q = query.trim();

    // Recherche globale : par défaut on envoie vers /atlas
    if (q) navigate(`/atlas?q=${encodeURIComponent(q)}`);
    else navigate('/atlas');
  }

  const primeDocs = ({ userInitiated = false } = {}) => {
    if (primingRef.current) return;
    if (isDocsFresh({ publicationState: PUB_STATE })) return;

    const connection = typeof navigator !== 'undefined' ? navigator.connection : null;
    const constrained =
      connection?.saveData || connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g';
    const desktopLike =
      typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    // Sur mobile, ne pas télécharger automatiquement tout l'index documentaire.
    if (!userInitiated && (constrained || !desktopLike)) return;

    primingRef.current = true;
    // Pas d'AbortController ici : un clic sur Documentation ne doit pas annuler
    // le préchargement exactement au moment où la page en a besoin.
    primeDocsEssentials({ publicationState: PUB_STATE })
      .catch(() => {})
      .finally(() => {
        primingRef.current = false;
      });
  };

  useEffect(() => {
    const run = () => primeDocs({ userInitiated: false });

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(id);
    }

    const t = setTimeout(run, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="homepage">
      <main className="hero">
        <section className="hero-text">
          <h1 className="hero-title">Odontocases</h1>

          <p className="hero-subtitle">
            Atlas de pathologies orales, cas cliniques interactifs et outil de randomisation dédiés aux pathologies
            orales.
          </p>

          <form onSubmit={onSubmit} className="hero-search">
            <input
              type="text"
              placeholder="Rechercher une pathologie ou un cas…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Recherche"
            />
          </form>

          <nav className="hero-actions">
            <HomeCard title="Atlas" to="/atlas" />
            <HomeCard title="Q/R & Quiz" to="/qr-quiz" />
            <HomeCard title="Randomisation" to="/randomisation" />
            <HomeCard
              title="Documentation"
              to="/documentation"
              onPrefetch={() => primeDocs({ userInitiated: true })}
            />
            {/* Liens utiles retiré de la Home (reste dans la navbar) */}
          </nav>
        </section>
      </main>
    </div>
  );
}

function HomeCard({ title, to, onPrefetch }) {
  return (
    <Link
      to={to}
      className="home-card ui-card"
      draggable="false"
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onMouseDown={onPrefetch}
    >
      <span>{title}</span>
    </Link>
  );
}
