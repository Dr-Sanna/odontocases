import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import './HomePage.css';

export default function HomePage() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  function onSubmit(e) {
    e.preventDefault();
    const q = query.trim();
    if (q) navigate(`/cas-cliniques?q=${encodeURIComponent(q)}`);
    else navigate('/cas-cliniques');
  }

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
            <HomeCard title="Documentation" to="/documentation" />
            <HomeCard title="Liens utiles" to="/liens-utiles" />
          </nav>
        </section>
      </main>
    </div>
  );
}

function HomeCard({ title, to }) {
  return (
    <Link to={to} className="home-card ui-card" draggable="false">
      <span>{title}</span>
    </Link>
  );
}
