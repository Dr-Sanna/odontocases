// src/pages/CaseDetail.jsx
/**
 * Mobile/tablette:
 * - Le bouton Navbar ouvre le drawer "cases"
 * - En haut du drawer: bouton "Revenir" -> bascule en "nav" (les 4 liens)
 *
 * Desktop:
 * - sidebar sticky + rail collapse (localStorage)
 *
 * CKEditor:
 * - HTML autorisé via rehype-raw + sanitize schema (tables, colgroup, styles width)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, NavLink, useLocation } from 'react-router-dom';

import PageTitle from '../components/PageTitle';
import Breadcrumbs from '../components/Breadcrumbs';
import { strapiFetch, imgUrl } from '../lib/strapi';
import { getCaseFromCache, setCaseToCache, prefetchCase } from '../lib/caseCache';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

import { BottomExpandIcon, BottomCollapseIcon } from '../components/Icons';
import { useCaseDetailSidebar } from '../ui/CaseDetailSidebarContext';

import './CaseDetail.css';

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const LS_KEY_COLLAPSE = 'cd-sidebar-collapsed';
const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

function useIsNarrow(maxWidthPx = 980) {
  const get = () => window.matchMedia?.(`(max-width: ${maxWidthPx}px)`)?.matches ?? false;
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

function compareBySlugNumberAsc(a, b) {
  const sa = String(a?.slug ?? '');
  const sb = String(b?.slug ?? '');
  const na = sa.match(/\d+/);
  const nb = sb.match(/\d+/);
  const ai = na ? parseInt(na[0], 10) : Number.POSITIVE_INFINITY;
  const bi = nb ? parseInt(nb[0], 10) : Number.POSITIVE_INFINITY;

  if (Number.isFinite(ai) && Number.isFinite(bi)) {
    if (ai !== bi) return ai - bi;
    return sa.localeCompare(sb, 'fr', { numeric: true, sensitivity: 'base' });
  }
  if (Number.isFinite(ai)) return -1;
  if (Number.isFinite(bi)) return 1;
  return sa.localeCompare(sb, 'fr', { numeric: true, sensitivity: 'base' });
}

function typeLabelFromKey(typeKey) {
  if (typeKey === 'qa') return 'Q/R';
  if (typeKey === 'quiz') return 'Quizz';
  if (typeKey === 'presentation') return 'Présentation';
  return null;
}

const ckeditorSchema = (() => {
  const tagNames = new Set([...(defaultSchema.tagNames || [])]);
  [
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'colgroup',
    'col',
    'figure',
    'figcaption',
  ].forEach((t) => tagNames.add(t));

  const attributes = {
    ...(defaultSchema.attributes || {}),
    table: [...(defaultSchema.attributes?.table || []), 'className', 'style'],
    thead: [...(defaultSchema.attributes?.thead || []), 'className', 'style'],
    tbody: [...(defaultSchema.attributes?.tbody || []), 'className', 'style'],
    tfoot: [...(defaultSchema.attributes?.tfoot || []), 'className', 'style'],
    tr: [...(defaultSchema.attributes?.tr || []), 'className', 'style'],
    td: [...(defaultSchema.attributes?.td || []), 'className', 'style', 'colspan', 'rowspan'],
    th: [...(defaultSchema.attributes?.th || []), 'className', 'style', 'colspan', 'rowspan', 'scope'],
    colgroup: [...(defaultSchema.attributes?.colgroup || []), 'className', 'style', 'span'],
    col: [...(defaultSchema.attributes?.col || []), 'className', 'style', 'span'],
    figure: [...(defaultSchema.attributes?.figure || []), 'className', 'style'],
    figcaption: [...(defaultSchema.attributes?.figcaption || []), 'className', 'style'],
    img: [...(defaultSchema.attributes?.img || []), 'style', 'width', 'height'],
  };

  return { ...defaultSchema, tagNames: Array.from(tagNames), attributes };
})();

function Markdown({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, ckeditorSchema]]}
    >
      {children}
    </ReactMarkdown>
  );
}

export default function CaseDetail() {
  const { slug } = useParams();
  const location = useLocation();

  const isNarrow = useIsNarrow(980);
  const { mobileOpen, setMobileOpen } = useCaseDetailSidebar();

  // ✅ vue du drawer mobile sur CaseDetail
  const [drawerView, setDrawerView] = useState('cases'); // 'cases' | 'nav'

  // Prefetch passé depuis la liste
  const pre = location.state?.prefetch;
  const provisional = pre && pre.slug === slug ? pre : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [item, setItem] = useState(() => {
    const cached = getCaseFromCache(slug);
    if (cached) return cached;
    if (provisional) return provisional;
    return null;
  });

  const [collapsedDesktop, setCollapsedDesktop] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY_COLLAPSE) === '1';
    } catch {
      return false;
    }
  });

  // Mobile: à chaque slug, on ferme
  useEffect(() => {
    if (isNarrow) setMobileOpen(false);
  }, [slug, isNarrow, setMobileOpen]);

  // ✅ en mobile, quand on ouvre -> on revient sur la liste de cas
  useEffect(() => {
    if (isNarrow && mobileOpen) setDrawerView('cases');
  }, [isNarrow, mobileOpen]);

  // ✅ si on quitte la page, on force la fermeture (robuste)
  useEffect(() => {
    return () => {
      setMobileOpen(false);
    };
  }, [setMobileOpen]);

  // Drawer mobile: esc + lock scroll
  useEffect(() => {
    if (!isNarrow) return;

    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;

    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
      document.body.style.overscrollBehavior = 'contain';
    } else {
      document.body.style.overflow = prevOverflow || '';
      document.body.style.overscrollBehavior = prevOverscroll || '';
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };

    if (mobileOpen) document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow || '';
      document.body.style.overscrollBehavior = prevOverscroll || '';
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileOpen, isNarrow, setMobileOpen]);

  const collapsed = isNarrow ? !mobileOpen : collapsedDesktop;

  const toggleSidebar = () => {
    if (isNarrow) {
      setMobileOpen((v) => !v);
      return;
    }
    setCollapsedDesktop((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LS_KEY_COLLAPSE, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  // Chargement (cache + fetch)
  useEffect(() => {
    let ignore = false;

    const cached = getCaseFromCache(slug);
    if (cached) {
      setItem(cached);
      setLoading(false);
    } else if (provisional) {
      setItem(provisional);
      setLoading(true);
    } else {
      setItem(null);
      setLoading(true);
    }

    async function loadWithPopulate(populateQa) {
      return strapiFetch(CASES_ENDPOINT, {
        params: {
          filters: { slug: { $eq: slug } },
          locale: 'all',
          publicationState: PUB_STATE,
          populate: populateQa
            ? { cover: { fields: ['url', 'formats'] }, qa_blocks: { populate: '*' } }
            : { cover: { fields: ['url', 'formats'] } },
          fields: ['title', 'slug', 'type', 'excerpt', 'content', 'updatedAt', 'references', 'copyright'],
          pagination: { page: 1, pageSize: 1 },
        },
      });
    }

    async function load() {
      setError('');
      try {
        let res;
        try {
          res = await loadWithPopulate(true);
        } catch (err) {
          const msg = err?.message || '';
          if (/Invalid key qa_blocks/i.test(msg)) res = await loadWithPopulate(false);
          else throw err;
        }

        const node = Array.isArray(res?.data) ? res.data[0] : null;
        const attrs = node?.attributes ? node.attributes : node;

        if (ignore) return;

        if (!attrs) {
          setError('Cas introuvable ou non publié.');
        } else {
          const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
          const apiCover =
            imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || null;

          const full = { ...attrs, coverUrl: apiCover || item?.coverUrl || null };
          setItem(full);
          setCaseToCache(slug, full);
        }
      } catch (e) {
        if (!ignore) setError(e?.message || 'Erreur de chargement');
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const typeLabel = useMemo(() => {
    if (item?.type === 'qa') return 'Q/R';
    if (item?.type === 'quiz') return 'Quizz';
    return 'Présentation';
  }, [item?.type]);

  const qaList = Array.isArray(item?.qa_blocks) ? item.qa_blocks : [];

  const typeKey = item?.type || provisional?.type || null;
  const crumbTypeLabel = typeLabelFromKey(typeKey);

  const breadcrumbItems = useMemo(() => {
    const base = [
      { label: 'Accueil', to: '/' },
      { label: 'Cas cliniques', to: '/cas-cliniques' },
    ];

    if (crumbTypeLabel && typeKey) {
      base.push({
        label: crumbTypeLabel,
        to: `/cas-cliniques?type=${encodeURIComponent(typeKey)}&page=1`,
      });
    }

    base.push({ label: item?.title || 'Cas clinique', to: null });
    return base;
  }, [crumbTypeLabel, typeKey, item?.title]);

  // Lightbox
  const [lightbox, setLightbox] = useState(null);
  const contentRef = useRef(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const onClick = (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG') {
        e.preventDefault();
        setLightbox({ src: t.src, alt: t.alt || '' });
      }
    };

    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [item?.content, qaList?.length]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const drawerOpen = isNarrow && mobileOpen;

  return (
    <div className={['cd-shell', collapsed ? 'is-collapsed' : '', drawerOpen ? 'is-drawer-open' : ''].join(' ')}>
      <AsideSameType
        currentSlug={slug}
        currentType={item?.type}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        prefetchRelated={location.state?.relatedPrefetch || null}
        isNarrow={isNarrow}
        drawerView={drawerView}
        setDrawerView={setDrawerView}
        closeMobile={() => setMobileOpen(false)}
      />

      {drawerOpen && (
        <div
          className="cd-drawer-scrim"
          role="button"
          tabIndex={0}
          aria-label="Fermer le menu"
          onClick={() => setMobileOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setMobileOpen(false);
          }}
        />
      )}

      <main className="cd-main" aria-hidden={drawerOpen}>
        <div className="cd-page-header">
          <article>
            <Breadcrumbs items={breadcrumbItems} />

            <div className="cd-type-chip">
              <span className={`cd-chip cd-${item?.type || 'qa'}`}>{typeLabel}</span>
            </div>

            <PageTitle description={item?.excerpt || ''}>{item?.title || 'Cas clinique'}</PageTitle>
          </article>
        </div>

        {error && <div className="cd-state error">{error}</div>}

        {loading && !item && !error && (
          <div className="cd-skel" aria-hidden="true">
            <div className="sk-line sk-h24 sk-w80" />
            <div className="sk-line sk-h16 sk-w100" />
            <div className="sk-line sk-h16 sk-w95" />
            <div className="sk-line sk-h16 sk-w90" />
          </div>
        )}

        <article className="casedetail" ref={contentRef}>
          {item?.content && (
            <div className="cd-content">
              <Markdown>{item.content}</Markdown>
            </div>
          )}

          {qaList.length > 0 && (
            <section className="qa-section">
              <h2 className="qa-title">Questions</h2>

              {qaList.map((qa, i) => {
                const q = qa?.question || `Question ${i + 1}`;
                const ans = qa?.answer || '';
                return (
                  <details key={qa?.id ?? `${slug}-qa-${i}`} className="qa-item">
                    <summary className="qa-q">
                      <span className="qa-num">{i + 1}.</span>
                      <span className="qa-text">{q}</span>
                    </summary>

                    <div className="qa-a">
                      <Markdown>{ans}</Markdown>
                    </div>
                  </details>
                );
              })}
            </section>
          )}

          {(item?.references || item?.copyright) && (
            <section className="cd-extras">
              {item?.references && (
                <div className="cd-references">
                  <h3>Références</h3>
                  <Markdown>{item.references}</Markdown>
                </div>
              )}

              {item?.copyright && (
                <div className="cd-copyright">
                  <h3>Copyright</h3>
                  <Markdown>{item.copyright}</Markdown>
                </div>
              )}
            </section>
          )}
        </article>
      </main>

      {lightbox && (
        <div
          className="lb-backdrop"
          onClick={() => setLightbox(null)}
          role="button"
          tabIndex={0}
          aria-label="Fermer l’aperçu"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setLightbox(null);
          }}
        >
          <img className="lb-img" src={lightbox.src} alt={lightbox.alt} />
        </div>
      )}
    </div>
  );
}

function AsideSameType({
  currentSlug,
  currentType,
  collapsed,
  onToggle,
  prefetchRelated,
  isNarrow,
  drawerView,
  setDrawerView,
  closeMobile,
}) {
  const [related, setRelated] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [errList, setErrList] = useState('');

  const [anim, setAnim] = useState('');
  const animTimerRef = useRef(null);

  const handleToggle = () => {
    if (!isNarrow) {
      const nextCollapsed = !collapsed;
      setAnim(nextCollapsed ? 'closing' : 'opening');

      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      animTimerRef.current = setTimeout(() => {
        setAnim('');
        animTimerRef.current = null;
      }, 240);
    }
    onToggle();
  };

  useEffect(() => () => animTimerRef.current && clearTimeout(animTimerRef.current), []);

  useEffect(() => {
    let booted = false;

    if (Array.isArray(prefetchRelated) && currentType) {
      const list = prefetchRelated
        .filter((it) => it?.type === currentType && it?.slug)
        .sort(compareBySlugNumberAsc);

      if (list.length) {
        setRelated(list);
        booted = true;
      }
    }

    if (!booted && currentType) {
      try {
        const raw = sessionStorage.getItem(`cd-prefetch-${currentType}`);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length) {
            setRelated(arr.filter((it) => it?.slug).sort(compareBySlugNumberAsc));
            booted = true;
          }
        }
      } catch {}
    }

    setLoadingList(!booted);
  }, [prefetchRelated, currentType]);

  useEffect(() => {
    let ignore = false;

    async function load() {
      if (!currentType) {
        setRelated([]);
        setLoadingList(false);
        setErrList('');
        return;
      }

      setErrList('');

      try {
        const res = await strapiFetch(CASES_ENDPOINT, {
          params: {
            locale: 'all',
            publicationState: PUB_STATE,
            filters: { type: { $eq: currentType } },
            fields: ['title', 'slug', 'type'],
            sort: 'title:asc',
            pagination: { page: 1, pageSize: 100 },
          },
        });

        if (ignore) return;

        const list = Array.isArray(res?.data) ? res.data : [];
        const normalized = list
          .map((n) => (n?.attributes ? n.attributes : n))
          .filter(Boolean)
          .filter((it) => it.slug)
          .sort(compareBySlugNumberAsc);

        setRelated(normalized);
        try {
          sessionStorage.setItem(`cd-prefetch-${currentType}`, JSON.stringify(normalized));
        } catch {}
      } catch (e) {
        if (!ignore) setErrList(e?.message || 'Erreur de chargement');
      } finally {
        if (!ignore) setLoadingList(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [currentType]);

  useEffect(() => {
    if (!Array.isArray(related) || related.length === 0) return;
    for (const it of related.slice(0, 20)) {
      if (!it?.slug || it.slug === currentSlug) continue;
      prefetchCase(it.slug, { publicationState: PUB_STATE }).catch(() => {});
    }
  }, [related, currentSlug]);

  const labelType =
    currentType === 'qa'
      ? 'Cas Q/R'
      : currentType === 'quiz'
      ? 'Quizz'
      : currentType === 'presentation'
      ? 'Présentations'
      : 'Cas';

  const showOverlay = !isNarrow && (collapsed || anim !== '');
  const isAnimating = !isNarrow && anim !== '';
  const overlayShowsExpand = collapsed || anim === 'closing';

  const showNavInsteadOfCases = isNarrow && drawerView === 'nav';

  return (
    <aside className={`cd-side ${collapsed ? 'is-collapsed' : ''} ${anim} ${isAnimating ? 'is-animating' : ''}`}>
      <div className="cd-side-inner">
        <div className="cd-side-scroll">
          {showNavInsteadOfCases ? (
            <>
              <div className="cd-side-header">Menu</div>

              <ul className="cd-side-list">
                <li>
                  <button type="button" className="cd-side-back" onClick={() => setDrawerView('cases')}>
                    ← Liste des cas
                  </button>
                </li>

                <li>
                  <NavLink className="cd-side-link" to="/cas-cliniques" onClick={closeMobile}>
                    Cas cliniques
                  </NavLink>
                </li>
                <li>
                  <NavLink className="cd-side-link" to="/randomisation" onClick={closeMobile}>
                    Randomisation
                  </NavLink>
                </li>
                <li>
                  <NavLink className="cd-side-link" to="/documentation" onClick={closeMobile}>
                    Documentation
                  </NavLink>
                </li>
                <li>
                  <NavLink className="cd-side-link" to="/liens-utiles" onClick={closeMobile}>
                    Liens utiles
                  </NavLink>
                </li>
              </ul>
            </>
          ) : (
            <>
              {isNarrow && (
                <div className="cd-side-top">
                  <button type="button" className="cd-side-back" onClick={() => setDrawerView('nav')}>
                    ← Revenir
                  </button>
                </div>
              )}

              <div className="cd-side-header">{labelType}</div>

              {loadingList && <div className="cd-side-state">Chargement…</div>}
              {errList && !loadingList && <div className="cd-side-state error">{errList}</div>}

              {!errList && (
                <ul className="cd-side-list">
                  {related.map((it) => {
                    const active = it.slug === currentSlug;
                    return (
                      <li key={it.slug}>
                        {active ? (
                          <span className="cd-side-link active" aria-current="page">
                            {it.title || it.slug}
                          </span>
                        ) : (
                          <Link
                            className="cd-side-link"
                            to={`/cas-cliniques/${it.slug}`}
                            onClick={() => isNarrow && closeMobile()}
                            onMouseEnter={() => prefetchCase(it.slug, { publicationState: PUB_STATE }).catch(() => {})}
                            onFocus={() => prefetchCase(it.slug, { publicationState: PUB_STATE }).catch(() => {})}
                          >
                            {it.title || it.slug}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>

        {!isNarrow &&
          (showOverlay ? (
            <div
              className="cd-side-toggle"
              title={overlayShowsExpand ? 'Développer la barre latérale' : 'Réduire la barre latérale'}
              aria-label={overlayShowsExpand ? 'Développer la barre latérale' : 'Réduire la barre latérale'}
              role="button"
              tabIndex={0}
              onClick={isAnimating ? undefined : handleToggle}
              onKeyDown={(e) => {
                if (!isAnimating && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  handleToggle();
                }
              }}
            >
              {overlayShowsExpand ? (
                <BottomExpandIcon className="expandButtonIcon_H1n0" />
              ) : (
                <BottomCollapseIcon className="collapseSidebarButtonIcon_DI0B" />
              )}
            </div>
          ) : (
            <button
              type="button"
              title="Réduire la barre latérale"
              aria-label="Réduire la barre latérale"
              className="cd-side-toggle"
              onClick={handleToggle}
              disabled={isAnimating}
            >
              <BottomCollapseIcon className="collapseSidebarButtonIcon_DI0B" />
            </button>
          ))}
      </div>
    </aside>
  );
}
