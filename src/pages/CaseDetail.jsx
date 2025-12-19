// src/pages/CaseDetail.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, NavLink, useLocation } from 'react-router-dom';

import PageTitle from '../components/PageTitle';
import Breadcrumbs from '../components/Breadcrumbs';
import QuizBlock from '../components/QuizBlock';
import CaseMarkdown from '../components/CaseMarkdown';

import { strapiFetch, imgUrl } from '../lib/strapi';
import { getCaseFromCache, setCaseToCache, prefetchCase } from '../lib/caseCache';

import { BottomExpandIcon, BottomCollapseIcon } from '../components/Icons';
import { useCaseDetailSidebar } from '../ui/CaseDetailSidebarContext';

import './CaseDetail.css';

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

const LS_KEY_COLLAPSE = 'cd-sidebar-collapsed';
const LS_KEY_EXPANDED_PREFIX = 'cd-expanded-container:'; // + type

/** Breakpoint helper */
function useIsNarrow(maxWidthPx = 980) {
  const get = () => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches;
  };

  const [isNarrow, setIsNarrow] = useState(get);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mq = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
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

/** Tri numérique par slug (extrait le premier groupe de chiffres). */
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
  if (typeKey === 'quiz') return 'Quiz';
  if (typeKey === 'presentation') return 'Présentation';
  return null;
}

/** Normalise Strapi v4/v5: data/attributes ou objet direct */
function normalizeEntity(node) {
  if (!node) return null;
  if (node.attributes) return { id: node.id, ...node.attributes };
  return node;
}
function normalizeRelation(rel) {
  if (!rel) return null;
  if (rel.data === null) return null;
  if (rel.data) return normalizeEntity(rel.data);
  return normalizeEntity(rel);
}
function normalizeRelationArray(rel) {
  if (!rel) return [];
  if (Array.isArray(rel)) return rel.map(normalizeEntity).filter(Boolean);
  if (Array.isArray(rel.data)) return rel.data.map(normalizeEntity).filter(Boolean);
  if (Array.isArray(rel?.results)) return rel.results.map(normalizeEntity).filter(Boolean);
  return [];
}

/* =========================
   Page
   ========================= */

export default function CaseDetail() {
  const { slug } = useParams();
  const location = useLocation();

  const isNarrow = useIsNarrow(980);
  const { mobileOpen, setMobileOpen } = useCaseDetailSidebar();

  const [drawerView, setDrawerView] = useState('cases');

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

  useEffect(() => {
    if (isNarrow) setMobileOpen(false);
  }, [slug, isNarrow, setMobileOpen]);

  useEffect(() => {
    if (isNarrow && mobileOpen) setDrawerView('cases');
  }, [isNarrow, mobileOpen]);

  useEffect(
    () => () => {
      setMobileOpen(false);
    },
    [setMobileOpen]
  );

  // lock body scroll on mobile drawer
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

    async function loadWithPopulate({ withQa, withQuiz, withChildren, withParent }) {
      const populate = { cover: { fields: ['url', 'formats'] } };

      if (withQa) populate.qa_blocks = { populate: '*' };
      if (withQuiz) {
        populate.quiz_blocks = {
          populate: { propositions: true },
        };
      }
      if (withChildren) {
        populate.child_cases = {
          fields: ['title', 'slug', 'excerpt', 'type', 'kind'],
          populate: { cover: { fields: ['url', 'formats'] } },
          sort: ['title:asc'],
        };
      }
      if (withParent) {
        populate.parent_case = {
          fields: ['title', 'slug', 'type', 'kind'],
        };
      }

      return strapiFetch(CASES_ENDPOINT, {
        params: {
          filters: { slug: { $eq: slug } },
          locale: 'all',
          publicationState: PUB_STATE,
          populate,
          fields: ['title', 'slug', 'type', 'kind', 'excerpt', 'content', 'updatedAt', 'references', 'copyright'],
          pagination: { page: 1, pageSize: 1 },
        },
      });
    }

    async function load() {
      setError('');
      try {
        let res;

        try {
          res = await loadWithPopulate({
            withQa: true,
            withQuiz: true,
            withChildren: true,
            withParent: true,
          });
        } catch (err) {
          const msg = err?.message || '';

          const qaInvalid = /Invalid key qa_blocks/i.test(msg);
          const quizInvalid = /Invalid key quiz_blocks/i.test(msg);
          const childInvalid = /Invalid key child_cases/i.test(msg);
          const parentInvalid = /Invalid key parent_case/i.test(msg);

          if (qaInvalid || quizInvalid || childInvalid || parentInvalid) {
            res = await loadWithPopulate({
              withQa: !qaInvalid,
              withQuiz: !quizInvalid,
              withChildren: !childInvalid,
              withParent: !parentInvalid,
            });
          } else {
            throw err;
          }
        }

        const node = Array.isArray(res?.data) ? res.data[0] : null;
        const attrs = normalizeEntity(node);

        if (ignore) return;

        if (!attrs) {
          setError('Cas introuvable ou non publié.');
          return;
        }

        const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
        const apiCover = imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || null;

        const parent = normalizeRelation(attrs?.parent_case);

        const children = normalizeRelationArray(attrs?.child_cases).map((c) => {
          const cCoverAttr = c?.cover?.data?.attributes || c?.cover || null;
          const cCoverUrl = imgUrl(cCoverAttr, 'medium') || imgUrl(cCoverAttr, 'thumbnail') || imgUrl(cCoverAttr) || null;
          return { ...c, coverUrl: cCoverUrl };
        });

        const full = {
          ...attrs,
          coverUrl: apiCover || item?.coverUrl || null,
          parent_case: parent,
          child_cases: children,
        };

        setItem(full);
        setCaseToCache(slug, full);
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
    if (item?.type === 'quiz') return 'Quiz';
    return 'Présentation';
  }, [item?.type]);

  const qaList = Array.isArray(item?.qa_blocks) ? item.qa_blocks : [];
  const quizList = Array.isArray(item?.quiz_blocks) ? item.quiz_blocks : [];
  const childList = Array.isArray(item?.child_cases) ? item.child_cases : [];
  const isContainer = item?.kind === 'container' || childList.length > 0;

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

    if (item?.parent_case?.slug) {
      base.push({
        label: item.parent_case.title || item.parent_case.slug,
        to: `/cas-cliniques/${item.parent_case.slug}`,
      });
    }

    base.push({ label: item?.title || 'Cas clinique', to: null });
    return base;
  }, [crumbTypeLabel, typeKey, item?.title, item?.parent_case?.slug, item?.parent_case?.title]);

  const [lightbox, setLightbox] = useState(null);
  const contentRef = useRef(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const onClick = (e) => {
      const t = e.target;
      if (!t || t.tagName !== 'IMG') return;
      if (t.dataset?.noLightbox === '1') return;
      if (t.closest?.('.cd-child-card')) return;

      e.preventDefault();
      setLightbox({ src: t.src, alt: t.alt || '' });
    };

    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [item?.content, qaList?.length, quizList?.length, childList?.length]);

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
        currentParentSlug={item?.parent_case?.slug || null}
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
          <Breadcrumbs items={breadcrumbItems} />
          <div className="cd-type-chip">
            <span className={`cd-chip cd-${item?.type || 'qa'}`}>{typeLabel}</span>
          </div>
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
              <PageTitle description={item?.excerpt || ''}>{item?.title || 'Cas clinique'}</PageTitle>
              <CaseMarkdown>{item.content}</CaseMarkdown>
            </div>
          )}

          {isContainer && childList.length > 0 && (
            <section className="cd-children">
              <h2 className="cd-children-title">Cas associés</h2>

              <div className="cd-children-grid">
                {childList.map((c) => (
                  <Link
                    key={c.slug}
                    to={`/cas-cliniques/${c.slug}`}
                    className="cd-child-card"
                    onMouseEnter={() => prefetchCase(c.slug, { publicationState: PUB_STATE }).catch(() => {})}
                    onFocus={() => prefetchCase(c.slug, { publicationState: PUB_STATE }).catch(() => {})}
                  >
                    {c.coverUrl && (
                      <img className="cd-child-cover" src={c.coverUrl} alt={c.title || c.slug} loading="lazy" data-no-lightbox="1" />
                    )}
                    <div className="cd-child-title">{c.title || c.slug}</div>
                    {c.excerpt && <div className="cd-child-excerpt">{c.excerpt}</div>}
                  </Link>
                ))}
              </div>
            </section>
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
                      <CaseMarkdown>{ans}</CaseMarkdown>
                    </div>
                  </details>
                );
              })}
            </section>
          )}

          {quizList.length > 0 && (
            <section className="quiz-section">
              <h2 className="quiz-title">Quiz</h2>

              {quizList.map((qb, i) => (
                <QuizBlock
                  key={qb?.id ?? `${slug}-quiz-${i}`}
                  block={qb}
                  index={i}
                  total={quizList.length}
                  seedKey={`${slug}-${qb?.id ?? i}`}
                  Markdown={CaseMarkdown}
                />
              ))}
            </section>
          )}

          {(item?.references || item?.copyright) && (
            <section className="cd-extras">
              {item?.references && (
                <div className="cd-references">
                  <h3>Références</h3>
                  <CaseMarkdown>{item.references}</CaseMarkdown>
                </div>
              )}

              {item?.copyright && (
                <div className="cd-copyright">
                  <h3>Copyright</h3>
                  <CaseMarkdown>{item.copyright}</CaseMarkdown>
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

/* =========================
   Sidebar (simple + stable)
   ========================= */

function AsideSameType({
  currentSlug,
  currentType,
  currentParentSlug,
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

  // un seul container ouvert (exclusive)
  const expandedKey = `${LS_KEY_EXPANDED_PREFIX}${currentType || 'none'}`;
  const [expandedSlug, setExpandedSlug] = useState(() => {
    try {
      return localStorage.getItem(expandedKey) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      setExpandedSlug(localStorage.getItem(expandedKey) || '');
    } catch {
      setExpandedSlug('');
    }
  }, [expandedKey]);

  const saveExpanded = (slug) => {
    try {
      localStorage.setItem(expandedKey, slug || '');
    } catch {}
  };

  const isPlainLeftClick = (e) => {
    if (!e) return false;
    if (e.button !== 0) return false;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
    return true;
  };

  const toggleContainer = (slug) => {
    setExpandedSlug((prev) => {
      const next = prev === slug ? '' : slug;
      saveExpanded(next);
      return next;
    });
  };

  const openContainerExclusive = (slug) => {
    setExpandedSlug((prev) => {
      if (prev === slug) return prev;
      saveExpanded(slug);
      return slug;
    });
  };

  // prefetch: déféré + une seule fois par slug
  const prefetchedRef = useRef(new Set());
  const prefetchIntent = (slug) => {
    if (!slug) return;
    if (prefetchedRef.current.has(slug)) return;
    prefetchedRef.current.add(slug);

    const run = () => prefetchCase(slug, { publicationState: PUB_STATE }).catch(() => {});
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 600 });
    } else {
      setTimeout(run, 0);
    }
  };

  // si on arrive sur un enfant : ouvrir son parent (exclusive)
  useEffect(() => {
    if (!currentParentSlug) return;
    setExpandedSlug((prev) => {
      if (prev === currentParentSlug) return prev;
      saveExpanded(currentParentSlug);
      return currentParentSlug;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentParentSlug]);

  const handleToggleSidebar = () => {
    onToggle();
  };

  // boot prefetch list
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
            const list = arr.filter((it) => it?.slug).sort(compareBySlugNumberAsc);
            setRelated(list);
            booted = true;
          }
        }
      } catch {}
    }

    setLoadingList(!booted);
  }, [prefetchRelated, currentType]);

  // load list
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
            fields: ['title', 'slug', 'type', 'kind', 'excerpt'],
            populate: { parent_case: { fields: ['slug'] } },
            sort: 'title:asc',
            pagination: { page: 1, pageSize: 200 },
          },
        });

        if (ignore) return;

        const list = Array.isArray(res?.data) ? res.data : [];
        const normalized = list.map(normalizeEntity).filter(Boolean).filter((it) => it.slug);

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

  // compute structure: containers + singles as top-level, children by parent
  const { topLevel, childrenByParent, containerSlugSet } = useMemo(() => {
    const byParent = new Map();
    const containersBySlug = new Map();
    const singles = [];

    for (const it of related) {
      if (!it?.slug) continue;

      const parentSlug = it?.parent_case?.data?.attributes?.slug || it?.parent_case?.slug || null;

      const isCont = it?.kind === 'container';
      if (isCont) {
        containersBySlug.set(it.slug, it);
        continue;
      }

      if (parentSlug) {
        if (!byParent.has(parentSlug)) byParent.set(parentSlug, []);
        byParent.get(parentSlug).push(it);
        continue;
      }

      singles.push(it);
    }

    for (const [, arr] of byParent.entries()) arr.sort(compareBySlugNumberAsc);
    const top = [...containersBySlug.values(), ...singles].sort(compareBySlugNumberAsc);

    return {
      topLevel: top,
      childrenByParent: byParent,
      containerSlugSet: new Set(containersBySlug.keys()),
    };
  }, [related]);

  // si item courant est un container avec kids : l’ouvrir (exclusive)
  useEffect(() => {
    if (!containerSlugSet.has(currentSlug)) return;
    const kids = childrenByParent.get(currentSlug) || [];
    if (!kids.length) return;

    setExpandedSlug((prev) => {
      if (prev === currentSlug) return prev;
      saveExpanded(currentSlug);
      return currentSlug;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlug, containerSlugSet, childrenByParent]);

  const labelType =
    currentType === 'qa'
      ? 'Cas Q/R'
      : currentType === 'quiz'
        ? 'Quiz'
        : currentType === 'presentation'
          ? 'Présentations'
          : 'Cas';

  const showNavInsteadOfCases = isNarrow && drawerView === 'nav';

  const renderCurrentOrLink = (it, className, onClick) => {
    const isCurrent = it.slug === currentSlug;

    if (isCurrent) {
      return (
        <span className={`${className} active cd-is-current`} aria-current="page">
          <span className="cd-side-link-text">{it.title || it.slug}</span>
        </span>
      );
    }

    return (
      <Link
        className={className}
        to={`/cas-cliniques/${it.slug}`}
        onClick={onClick}
        onMouseEnter={() => prefetchIntent(it.slug)}
        onFocus={() => prefetchIntent(it.slug)}
      >
        <span className="cd-side-link-text">{it.title || it.slug}</span>
      </Link>
    );
  };

  return (
    <aside className={['cd-side', collapsed ? 'is-collapsed' : ''].join(' ')}>
      <div className="cd-side-inner">
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
                {topLevel.map((it) => {
                  const isCont = it?.kind === 'container';

                  if (!isCont) {
                    return (
                      <li key={it.slug}>
                        {renderCurrentOrLink(it, 'cd-side-link', () => {
                          if (isNarrow) closeMobile();
                        })}
                      </li>
                    );
                  }

                  const kids = childrenByParent.get(it.slug) || [];
                  const hasKids = kids.length > 0;

                  const isOpen = hasKids && expandedSlug === it.slug;

                  const isCurrentContainer = it.slug === currentSlug;
                  const isParentCurrent = it.slug === currentParentSlug && currentSlug !== currentParentSlug;

                  const isActiveRow = it.slug === currentSlug || it.slug === currentParentSlug;

                  return (
                    <li key={it.slug}>
                      <div
                        className={[
                          'cd-side-row',
                          hasKids ? 'has-kids' : '',
                          isActiveRow ? 'is-active' : '',
                          isParentCurrent ? 'is-parent-current' : '',
                        ].join(' ')}
                        onClick={(e) => {
                          // toggle via clic sur la row UNIQUEMENT si on est déjà sur la page du conteneur
                          if (!hasKids) return;
                          if (!isCurrentContainer) return;
                          if (!isPlainLeftClick(e)) return;
                          toggleContainer(it.slug);
                        }}
                      >
                        {renderCurrentOrLink(it, 'cd-side-link', (e) => {
                          // cas "span current" => pas de handler
                          if (!e) return;

                          if (!hasKids) {
                            if (isNarrow) closeMobile();
                            return;
                          }

                          // si on est déjà sur le conteneur : clic sur le titre => toggle (pas de navigation)
                          if (isCurrentContainer && isPlainLeftClick(e)) {
                            e.preventDefault();
                            toggleContainer(it.slug);
                            return;
                          }

                          // sinon : navigation normale, mais on ouvre la liste (exclusive) avant
                          if (!isCurrentContainer && isPlainLeftClick(e)) {
                            if (!isOpen) openContainerExclusive(it.slug);
                            // on laisse la navigation se faire
                          }

                          if (isNarrow) closeMobile();
                        })}

                        <button
                          type="button"
                          className="cd-side-caret"
                          aria-label={isOpen ? 'Réduire' : 'Développer'}
                          aria-expanded={isOpen ? 'true' : 'false'}
                          disabled={!hasKids}
                          onClick={(e) => {
                            // le chevron toggle toujours
                            e.preventDefault();
                            e.stopPropagation();
                            if (!hasKids) return;
                            toggleContainer(it.slug);
                          }}
                        />
                      </div>

                      {hasKids && (
                        <div className={['cd-side-sublist', isOpen ? 'is-open' : ''].join(' ')}>
                          <div className="cd-side-sublist-inner">
                            <div className="cd-side-children">
                              {kids.map((ch) => (
                                <div key={ch.slug} className="cd-side-child">
                                  {renderCurrentOrLink(ch, 'cd-side-link cd-side-child-link', () => {
                                    if (isNarrow) closeMobile();
                                  })}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {!isNarrow && (
          <button
            type="button"
            title={collapsed ? 'Développer la barre latérale' : 'Réduire la barre latérale'}
            aria-label={collapsed ? 'Développer la barre latérale' : 'Réduire la barre latérale'}
            className="cd-side-toggle"
            onClick={handleToggleSidebar}
          >
            {collapsed ? (
              <BottomExpandIcon className="expandButtonIcon_H1n0" />
            ) : (
              <BottomCollapseIcon className="collapseSidebarButtonIcon_DI0B" />
            )}
          </button>
        )}
      </div>
    </aside>
  );
}
