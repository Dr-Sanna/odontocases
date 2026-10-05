import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { imgUrl } from '../lib/strapi';
import {
  primeAtlasSearchIndex,
  searchAtlasPathologies,
} from '../lib/atlasSearchStore';
import './AtlasSearch.css';

const DEFAULT_MAX_RESULTS = 8;
const SEARCH_DELAY_MS = 120;
const PANEL_MAX_HEIGHT = 440;
const PANEL_BOTTOM_GAP = 12;
const PANEL_TOP_GAP = 8;

export default function AtlasSearch({
  variant = 'navbar',
  className = '',
  placeholder = 'Rechercher une pathologie…',
  maxResults = DEFAULT_MAX_RESULTS,
}) {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const requestRef = useRef(0);
  const listboxId = useId();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [panelMaxHeight, setPanelMaxHeight] = useState(PANEL_MAX_HEIGHT);

  const trimmedQuery = query.trim();
  const showPanel = open && Boolean(trimmedQuery);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    if (!trimmedQuery) {
      setResults([]);
      setLoading(false);
      setActiveIndex(-1);
      return undefined;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    const timer = window.setTimeout(() => {
      setLoading(true);
      searchAtlasPathologies(trimmedQuery, { limit: maxResults })
        .then((nextResults) => {
          if (requestRef.current !== requestId) return;
          setResults(nextResults);
          setActiveIndex(-1);
          setOpen(true);
        })
        .catch(() => {
          if (requestRef.current !== requestId) return;
          setResults([]);
          setActiveIndex(-1);
          setOpen(true);
        })
        .finally(() => {
          if (requestRef.current === requestId) setLoading(false);
        });
    }, SEARCH_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [trimmedQuery, maxResults]);

  // Le panneau ne dépasse jamais du viewport : sa hauteur disponible est calculée
  // à partir de la position réelle de la barre. Les résultats gardent leur propre
  // scrollbar et le bouton « Voir tous » reste visible au bas du panneau.
  useLayoutEffect(() => {
    if (!showPanel || typeof window === 'undefined') return undefined;

    let raf = 0;

    const updatePanelHeight = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const root = rootRef.current;
        if (!root) return;

        const rect = root.getBoundingClientRect();
        const available = Math.max(
          0,
          Math.floor(window.innerHeight - rect.bottom - PANEL_TOP_GAP - PANEL_BOTTOM_GAP)
        );

        setPanelMaxHeight(Math.min(PANEL_MAX_HEIGHT, available));
      });
    };

    updatePanelHeight();
    window.addEventListener('resize', updatePanelHeight, { passive: true });
    window.addEventListener('scroll', updatePanelHeight, { passive: true });

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePanelHeight);
      window.removeEventListener('scroll', updatePanelHeight);
    };
  }, [showPanel, results.length, loading]);

  const goToPathology = (item) => {
    if (!item?.slug) return;
    setOpen(false);
    setActiveIndex(-1);
    navigate(`/atlas/${item.slug}`, {
      state: {
        breadcrumb: {
          mode: 'atlas',
          pathology: {
            slug: item.slug,
            title: item.title || item.slug,
          },
          case: null,
        },
        prefetch: {
          slug: item.slug,
          title: item.title || item.slug,
          type: 'presentation',
        },
      },
    });
  };

  const goToResults = () => {
    const q = trimmedQuery;
    if (!q) return;
    setOpen(false);
    setActiveIndex(-1);
    navigate(`/atlas?q=${encodeURIComponent(q)}`);
  };

  const onSubmit = (event) => {
    event.preventDefault();
    if (activeIndex >= 0 && results[activeIndex]) {
      goToPathology(results[activeIndex]);
      return;
    }
    goToResults();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (!open || results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1));
    }
  };

  return (
    <div
      ref={rootRef}
      className={`atlas-search atlas-search--${variant} ${className}`.trim()}
    >
      <form className="atlas-search-form" role="search" onSubmit={onSubmit}>
        <div className="atlas-search-input-shell">
          {variant === 'navbar' && (
            <svg className="atlas-search-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
              />
            </svg>
          )}

          <input
            className="atlas-search-input"
            type="search"
            value={query}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck="false"
            aria-label="Rechercher une pathologie dans l’Atlas"
            aria-autocomplete="list"
            aria-expanded={showPanel}
            aria-controls={showPanel ? listboxId : undefined}
            aria-activedescendant={
              activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
            }
            onFocus={() => {
              primeAtlasSearchIndex().catch(() => {});
              if (trimmedQuery) setOpen(true);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(Boolean(event.target.value.trim()));
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      </form>

      {showPanel && panelMaxHeight > 0 && (
        <div
          className="atlas-search-panel"
          id={listboxId}
          role="listbox"
          style={{ '--atlas-search-panel-max-height': `${panelMaxHeight}px` }}
        >
          {loading && results.length === 0 ? (
            <div className="atlas-search-status">Recherche…</div>
          ) : results.length > 0 ? (
            <>
              <div className="atlas-search-results">
                {results.map((item, index) => {
                  const cover = item?.cover?.data?.attributes || item?.cover || null;
                  const coverUrl =
                    imgUrl(cover, 'thumbnail') || imgUrl(cover, 'medium') || imgUrl(cover) || '';
                  const aliasMatch = item?._searchMatch?.kind === 'alias'
                    ? item._searchMatch.value
                    : '';

                  return (
                    <button
                      key={item.documentId || item.id || item.slug}
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={activeIndex === index}
                      className={`atlas-search-result ${activeIndex === index ? 'is-active' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => goToPathology(item)}
                    >
                      <span
                        className={`atlas-search-result-thumb ${coverUrl ? '' : 'is-empty'}`}
                        aria-hidden="true"
                      >
                        {coverUrl && <img src={coverUrl} alt="" loading="lazy" decoding="async" />}
                      </span>

                      <span className="atlas-search-result-copy">
                        <span className="atlas-search-result-title">{item.title || item.slug}</span>
                        {aliasMatch && (
                          <span className="atlas-search-result-alias">
                            Aussi appelé « {aliasMatch} »
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button type="button" className="atlas-search-all" onClick={goToResults}>
                Voir tous les résultats pour « {trimmedQuery} »
              </button>
            </>
          ) : (
            <div className="atlas-search-status">Aucune pathologie trouvée.</div>
          )}
        </div>
      )}
    </div>
  );
}
