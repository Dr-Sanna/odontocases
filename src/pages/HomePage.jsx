// src/pages/HomePage.jsx
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { isDocsPrimed, primeDocsEssentials } from '../lib/docsPrefetchStore';
import './HomePage.css';

const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

export default function HomePage() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const primingRef = useRef(false);

  function onSubmit(e) {
    e.preventDefault();
    const q = query.trim();
    if (q) navigate(`/cas-cliniques?type=all&page=1&q=${encodeURIComponent(q)}`);
    else navigate('/cas-cliniques');
  }

  const primeDocs = () => {
    if (primingRef.current) return;
    if (isDocsPrimed({ publicationState: PUB_STATE })) return;

    primingRef.current = true;
    const ctrl = new AbortController();

    primeDocsEssentials({ publicationState: PUB_STATE, signal: ctrl.signal })
      .catch(() => {})
      .finally(() => {
        primingRef.current = false;
      });

    return () => ctrl.abort();
  };

  // Prime en idle (pour que /documentation soit instant)
  useEffect(() => {
    let cleanup = null;

    const run = () => {
      cleanup = primeDocs() || null;
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 900 });
      return () => {
        window.cancelIdleCallback?.(id);
        cleanup?.();
      };
    }

    const t = setTimeout(run, 250);
    return () => {
      clearTimeout(t);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="homepage">
      <main className="hero">
        <section className="hero-text">
          <h1 className="hero-title">Odontocases</h1>

          <p className="hero-subtitle">
            Bibliothèque interactive de cas cliniques et outil de randomisation dédiés aux pathologies orales.
          </p>

          <form onSubmit={onSubmit} className="hero-search">
            <input
              type="text"
              placeholder="Rechercher un cas…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Recherche de cas cliniques"
            />
          </form>

          <nav className="hero-actions">
            <HomeCard title="Cas cliniques" to="/cas-cliniques" />
            <HomeCard title="Randomisation" to="/randomisation" />
            <HomeCard title="Documentation" to="/documentation" onPrefetch={primeDocs} />
            <HomeCard title="Liens utiles" to="/liens-utiles" />
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
