// src/components/Breadcrumbs.jsx
import { Link } from 'react-router-dom';
import './Breadcrumbs.css';

function BreadcrumbHomeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="breadcrumbHomeIcon" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 19v-5h4v5c0 .55.45 1 1 1h3c.55 0 1-.45 1-1v-7h1.7c.46 0 .68-.57.33-.87L12.67 3.6c-.38-.34-.96-.34-1.34 0l-8.36 7.53c-.34.3-.13.87.33.87H5v7c0 .55.45 1 1 1h3c.55 0 1-.45 1-1z"
      />
    </svg>
  );
}

export default function Breadcrumbs({ items = [] }) {
  if (!items.length) return null;

  return (
    <nav className="theme-doc-breadcrumbs breadcrumbsContainer_Wvrh" aria-label="Fil d'Ariane">
      <ul className="breadcrumbs">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          const isHome = it?.to === '/' || it?.label?.toLowerCase() === 'accueil';

          return (
            <li
              key={`${it.label}-${i}`}
              className={`breadcrumbs__item ${last ? 'breadcrumbs__item--active' : ''}`}
            >
              {it.to && !last ? (
                <Link
                  to={it.to}
                  className="breadcrumbs__link"
                  aria-label={isHome ? 'Page d’accueil' : undefined}
                >
                  {isHome ? <BreadcrumbHomeIcon /> : <span>{it.label}</span>}
                </Link>
              ) : (
                <span className="breadcrumbs__link" aria-current="page">
                  <span>{it.label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
