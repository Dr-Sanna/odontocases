// src/components/Breadcrumbs.jsx
import { useLayoutEffect, useRef } from 'react';
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

function fitBreadcrumbs(container) {
  const list = container?.querySelector('.breadcrumbs');
  if (!list) return;

  const links = Array.from(
    list.querySelectorAll('.breadcrumbs__item:not(:first-child) .breadcrumbs__link')
  );

  // On repart toujours des largeurs naturelles avant de recalculer.
  links.forEach((link) => link.style.removeProperty('--breadcrumb-max-width'));

  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 780px)').matches) {
    return;
  }

  const containerWidth = list.clientWidth;
  if (!containerWidth || links.length === 0) return;

  const naturalWidths = links.map((link) => link.getBoundingClientRect().width);
  const naturalLinksWidth = naturalWidths.reduce((sum, width) => sum + width, 0);

  // scrollWidth comprend aussi l'accueil et les séparateurs. Leur largeur reste fixe.
  const fixedWidth = Math.max(0, list.scrollWidth - naturalLinksWidth);
  const availableForLinks = Math.max(0, containerWidth - fixedWidth);

  if (naturalLinksWidth <= availableForLinks + 0.5) return;

  /*
   * Recherche d'un plafond commun :
   * - les libellés plus courts que ce plafond restent intégralement visibles ;
   * - seuls les libellés réellement longs sont tronqués ;
   * - si plusieurs libellés sont très longs, ils partagent équitablement l'espace restant.
   */
  let low = 24;
  let high = Math.max(...naturalWidths);

  for (let i = 0; i < 32; i += 1) {
    const cap = (low + high) / 2;
    const used = naturalWidths.reduce((sum, width) => sum + Math.min(width, cap), 0);

    if (used <= availableForLinks) low = cap;
    else high = cap;
  }

  const cap = Math.max(24, Math.floor(low));

  links.forEach((link, index) => {
    if (naturalWidths[index] > cap + 0.5) {
      link.style.setProperty('--breadcrumb-max-width', `${cap}px`);
    }
  });
}

export default function Breadcrumbs({ items = [] }) {
  const containerRef = useRef(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let frame = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitBreadcrumbs(container));
    };

    scheduleFit();

    const observer = new ResizeObserver(scheduleFit);
    observer.observe(container);

    const list = container.querySelector('.breadcrumbs');
    if (list) observer.observe(list);

    if (document.fonts?.ready) {
      document.fonts.ready.then(scheduleFit).catch(() => {});
    }

    window.addEventListener('resize', scheduleFit);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', scheduleFit);
    };
  }, [items]);

  if (!items.length) return null;

  return (
    <nav
      ref={containerRef}
      className="theme-doc-breadcrumbs breadcrumbsContainer_Wvrh"
      aria-label="Fil d'Ariane"
    >
      <ul className="breadcrumbs">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          const label = String(it?.label || '');
          const isHome = it?.to === '/' || label.toLowerCase() === 'accueil';

          return (
            <li
              key={`${label}-${i}`}
              className={`breadcrumbs__item ${last ? 'breadcrumbs__item--active' : ''}`}
            >
              {it.to && !last ? (
                <Link
                  to={it.to}
                  className="breadcrumbs__link"
                  aria-label={isHome ? 'Page d’accueil' : undefined}
                  title={isHome ? undefined : label}
                >
                  {isHome ? <BreadcrumbHomeIcon /> : <span>{label}</span>}
                </Link>
              ) : (
                <span className="breadcrumbs__link" aria-current="page" title={label}>
                  <span>{label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
