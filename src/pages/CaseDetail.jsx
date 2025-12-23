// src/pages/CaseDetail.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, NavLink, useLocation } from 'react-router-dom';

import PageTitle from '../components/PageTitle';
import Breadcrumbs from '../components/Breadcrumbs';
import QuizBlock from '../components/QuizBlock';
import CaseMarkdown from '../components/CaseMarkdown';

import { strapiFetch, imgUrl } from '../lib/strapi';
import { getCaseFromCache, setCaseToCache, prefetchCase } from '../lib/caseCache';
import { getPathologyFromCache, setPathologyToCache, prefetchPathology } from '../lib/pathologyCache';

import { BottomExpandIcon, BottomCollapseIcon } from '../components/Icons';
import { useCaseDetailSidebar } from '../ui/CaseDetailSidebarContext';

import './CaseDetail.css';

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const PATHO_ENDPOINT = import.meta.env.VITE_PATHO_ENDPOINT || '/pathologies';
const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

const LS_KEY_COLLAPSE = 'cd-sidebar-collapsed';
const LS_KEY_EXPANDED_PATHOLOGY = 'cd-expanded-pathology';

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
function normalizeRelationArray(rel) {
  if (!rel) return [];
  if (Array.isArray(rel)) return rel.map(normalizeEntity).filter(Boolean);
  if (Array.isArray(rel.data)) return rel.data.map(normalizeEntity).filter(Boolean);
  if (Array.isArray(rel?.results)) return rel.results.map(normalizeEntity).filter(Boolean);
  return [];
}

function safeGetSessionJson(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* =========================
   Page
   ========================= */

export default function CaseDetail() {
  const params = useParams();
  const location = useLocation();

  // Routes attendues :
  // - /cas-cliniques/:slug
  // - /cas-cliniques/presentation/:pathologySlug
  // - /cas-cliniques/presentation/:pathologySlug/:caseSlug
  const pathologySlug = params.pathologySlug || null;
  const caseSlug = params.caseSlug || params.slug || null;

  const isPresentationNamespace = Boolean(pathologySlug);
  const isPathologyPage = isPresentationNamespace && !params.caseSlug;
  const isCaseInPathology = isPresentationNamespace && Boolean(params.caseSlug);
  const isPlainCase = !isPresentationNamespace;

  const isNarrow = useIsNarrow(980);
  const { mobileOpen, setMobileOpen } = useCaseDetailSidebar();
  const [drawerView, setDrawerView] = useState('cases');

  // breadcrumb seed (instant)
  const navCrumb = location.state?.breadcrumb || null;

  const pre = location.state?.prefetch || null;
  const provisionalKeySlug = isPathologyPage ? pathologySlug : caseSlug;
  const provisional = pre && pre.slug === provisionalKeySlug ? pre : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // item = case OU pathology selon la route
  const [item, setItem] = useState(() => {
    const key = provisionalKeySlug;
    if (!key) return null;

    if (isPathologyPage) return getPathologyFromCache(key) || provisional || null;
    return getCaseFromCache(key) || provisional || null;
  });

  // parent pathology (utile sur /presentation/:patho/:case)
  const [parentPathology, setParentPathology] = useState(() => {
    if (!isCaseInPathology || !pathologySlug) return null;
    return getPathologyFromCache(pathologySlug) || null;
  });

  // stableType seulement pour les cas classiques
  const [stableType, setStableType] = useState(() => {
    if (!isPlainCase) return null;
    return getCaseFromCache(caseSlug)?.type || provisional?.type || null;
  });

  useEffect(() => {
    if (isPlainCase && item?.type) setStableType(item.type);
  }, [item?.type, isPlainCase]);

  const [collapsedDesktop, setCollapsedDesktop] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY_COLLAPSE) === '1';
    } catch {
      return false;
    }
  });

  const [collapseDone, setCollapseDone] = useState(() => collapsedDesktop && !isNarrow);

  useEffect(() => {
    if (isNarrow) setMobileOpen(false);
  }, [caseSlug, pathologySlug, isNarrow, setMobileOpen]);

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

  useEffect(() => {
    if (isNarrow) return;
    setCollapseDone(false);
  }, [collapsedDesktop, isNarrow]);

  useEffect(() => {
    if (isNarrow) return;
    if (collapsedDesktop) setCollapseDone(true);
  }, [isNarrow]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---------- loaders ----------
  async function loadCaseBySlug(slugToLoad) {
    const loadOnce = ({ withQa, withQuiz }) =>
      strapiFetch(CASES_ENDPOINT, {
        params: {
          filters: { slug: { $eq: slugToLoad } },
          locale: 'all',
          publicationState: PUB_STATE,
          populate: {
            cover: { fields: ['url', 'formats'] },
            ...(withQa ? { qa_blocks: { populate: '*' } } : {}),
            ...(withQuiz ? { quiz_blocks: { populate: { propositions: true } } } : {}),
          },
          fields: ['title', 'slug', 'type', 'excerpt', 'content', 'updatedAt', 'references', 'copyright'],
          pagination: { page: 1, pageSize: 1 },
        },
      });

    let res;
    try {
      res = await loadOnce({ withQa: true, withQuiz: true });
    } catch (err) {
      const msg = err?.message || '';
      const qaInvalid = /Invalid key qa_blocks/i.test(msg);
      const quizInvalid = /Invalid key quiz_blocks/i.test(msg);

      if (qaInvalid || quizInvalid) {
        res = await loadOnce({ withQa: !qaInvalid, withQuiz: !quizInvalid });
      } else {
        throw err;
      }
    }

    const node = Array.isArray(res?.data) ? res.data[0] : null;
    const attrs = normalizeEntity(node);
    if (!attrs) return null;

    const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
    const coverUrl =
      imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || null;

    return { ...attrs, coverUrl: coverUrl || null };
  }

  async function loadPathologyBySlug(slugToLoad, { withCases } = { withCases: true }) {
    const loadOnce = ({ withQa, withQuiz, withCases: withCasesInner }) =>
      strapiFetch(PATHO_ENDPOINT, {
        params: {
          filters: { slug: { $eq: slugToLoad } },
          locale: 'all',
          publicationState: PUB_STATE,
          populate: {
            cover: { fields: ['url', 'formats'] },
            ...(withQa ? { qa_blocks: { populate: '*' } } : {}),
            ...(withQuiz ? { quiz_blocks: { populate: { propositions: true } } } : {}),
            ...(withCasesInner
              ? {
                  cases: {
                    fields: ['title', 'slug', 'excerpt', 'type'],
                    populate: { cover: { fields: ['url', 'formats'] } },
                    sort: ['slug:asc'],
                  },
                }
              : {}),
          },
          fields: ['title', 'slug', 'excerpt', 'content', 'updatedAt', 'references', 'copyright'],
          pagination: { page: 1, pageSize: 1 },
        },
      });

    let res;
    try {
      res = await loadOnce({ withQa: true, withQuiz: true, withCases: withCases });
    } catch (err) {
      const msg = err?.message || '';
      const qaInvalid = /Invalid key qa_blocks/i.test(msg);
      const quizInvalid = /Invalid key quiz_blocks/i.test(msg);
      const casesInvalid = /Invalid key cases/i.test(msg);

      if (qaInvalid || quizInvalid || casesInvalid) {
        res = await loadOnce({
          withQa: !qaInvalid,
          withQuiz: !quizInvalid,
          withCases: withCases && !casesInvalid,
        });
      } else {
        throw err;
      }
    }

    const node = Array.isArray(res?.data) ? res.data[0] : null;
    const attrs = normalizeEntity(node);
    if (!attrs) return null;

    const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
    const coverUrl =
      imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || null;

    const rel = normalizeRelationArray(attrs?.cases).map((c) => {
      const cCoverAttr = c?.cover?.data?.attributes || c?.cover || null;
      const cCoverUrl =
        imgUrl(cCoverAttr, 'medium') || imgUrl(cCoverAttr, 'thumbnail') || imgUrl(cCoverAttr) || null;
      return { ...c, coverUrl: cCoverUrl };
    });

    return { ...attrs, coverUrl: coverUrl || null, cases: rel };
  }

  // ---------- main load ----------
  useEffect(() => {
    let ignore = false;

    const keySlug = provisionalKeySlug;
    if (!keySlug) {
      setError('Slug manquant.');
      setLoading(false);
      return () => {};
    }

    const cached = isPathologyPage ? getPathologyFromCache(keySlug) : getCaseFromCache(keySlug);

    if (cached) {
      setItem(cached);
      setLoading(false);
    } else if (provisional) {
      setItem(provisional);
      setLoading(true);
    } else {
      setLoading(true);
    }

    async function load() {
      setError('');
      try {
        if (isPathologyPage) {
          const fullPatho = await loadPathologyBySlug(pathologySlug, { withCases: true });
          if (ignore) return;

          if (!fullPatho) {
            setError('Pathologie introuvable ou non publiée.');
            return;
          }

          setItem(fullPatho);
          setPathologyToCache(pathologySlug, fullPatho);
          return;
        }

        if (isCaseInPathology) {
          const parentPromise = pathologySlug
            ? prefetchPathology(pathologySlug, { publicationState: PUB_STATE }).catch(() => null)
            : Promise.resolve(null);

          const fullCase = await loadCaseBySlug(caseSlug);
          const parent = await parentPromise;

          if (ignore) return;

          if (!fullCase) {
            setError('Cas introuvable ou non publié.');
            return;
          }

          setItem(fullCase);
          setCaseToCache(caseSlug, fullCase);

          if (parent) setParentPathology(parent);
          else if (pathologySlug) {
            const p = getPathologyFromCache(pathologySlug);
            if (p) setParentPathology(p);
          }

          return;
        }

        const full = await loadCaseBySlug(caseSlug);
        if (ignore) return;

        if (!full) {
          setError('Cas introuvable ou non publié.');
          return;
        }

        setItem(full);
        setCaseToCache(caseSlug, full);
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
  }, [pathologySlug, caseSlug, isPathologyPage, isCaseInPathology]);

  // ---------- type + labels ----------
  const effectiveType = useMemo(() => {
    if (isPresentationNamespace) return 'presentation';
    return item?.type || provisional?.type || stableType || null;
  }, [isPresentationNamespace, item?.type, provisional?.type, stableType]);

  const typeLabel = useMemo(() => {
    if (effectiveType === 'qa') return 'Q/R';
    if (effectiveType === 'quiz') return 'Quiz';
    return 'Présentation';
  }, [effectiveType]);

  // ---------- content blocks ----------
  const qaList = Array.isArray(item?.qa_blocks) ? item.qa_blocks : [];
  const quizList = Array.isArray(item?.quiz_blocks) ? item.quiz_blocks : [];

  // Pathology: cas associés + anti-spoil
  const relatedCases = useMemo(() => {
    if (!isPathologyPage) return [];
    return Array.isArray(item?.cases) ? item.cases : [];
  }, [isPathologyPage, item?.cases]);

  const [showSpoilers, setShowSpoilers] = useState(false);
  useEffect(() => {
    if (isPathologyPage) setShowSpoilers(false);
  }, [pathologySlug, isPathologyPage]);

  const visibleRelatedCases = useMemo(() => {
    if (!isPathologyPage) return [];
    const arr = Array.isArray(relatedCases) ? relatedCases : [];
    const pres = arr.filter((c) => c?.type === 'presentation');
    const others = arr.filter((c) => c?.type !== 'presentation');
    const merged = showSpoilers ? [...pres, ...others] : pres;
    merged.sort(compareBySlugNumberAsc);
    return merged;
  }, [isPathologyPage, relatedCases, showSpoilers]);

  const spoilerCounts = useMemo(() => {
    if (!isPathologyPage) return { pres: 0, other: 0 };
    const arr = Array.isArray(relatedCases) ? relatedCases : [];
    const pres = arr.filter((c) => c?.type === 'presentation').length;
    const other = arr.filter((c) => c?.type !== 'presentation').length;
    return { pres, other };
  }, [isPathologyPage, relatedCases]);

  // ---------- breadcrumb immediate ----------
  const cdIndex = useMemo(() => safeGetSessionJson('cd-patho-index'), []);
  const indexPatho = cdIndex?.pathoIndex || {};
  const indexCase = cdIndex?.caseIndex || {};

  const instantCurrentTitle = useMemo(() => {
    if (isPathologyPage) {
      if (navCrumb?.pathology?.title) return navCrumb.pathology.title;
      if (indexPatho?.[pathologySlug]?.title) return indexPatho[pathologySlug].title;
      if (item?.slug === pathologySlug && item?.title) return item.title;
      if (provisional?.title) return provisional.title;
      return pathologySlug || 'Pathologie';
    }

    if (isCaseInPathology) {
      if (navCrumb?.case?.title) return navCrumb.case.title;
      if (indexCase?.[caseSlug]?.title) return indexCase[caseSlug].title;
    }

    if (isPlainCase) {
      if (navCrumb?.case?.title) return navCrumb.case.title;
    }

    if (item?.slug === caseSlug && item?.title) return item.title;
    if (provisional?.title) return provisional.title;
    return caseSlug || 'Cas clinique';
  }, [
    isPathologyPage,
    isCaseInPathology,
    isPlainCase,
    navCrumb,
    indexPatho,
    indexCase,
    pathologySlug,
    caseSlug,
    item?.slug,
    item?.title,
    provisional?.title,
  ]);

  const instantPathologyTitle = useMemo(() => {
    if (!isPresentationNamespace) return null;

    if (navCrumb?.pathology?.title) return navCrumb.pathology.title;
    if (indexPatho?.[pathologySlug]?.title) return indexPatho[pathologySlug].title;

    if (parentPathology?.slug === pathologySlug && parentPathology?.title) return parentPathology.title;
    if (isPathologyPage && item?.slug === pathologySlug && item?.title) return item.title;

    return pathologySlug || 'Pathologie';
  }, [
    isPresentationNamespace,
    navCrumb,
    indexPatho,
    pathologySlug,
    parentPathology?.slug,
    parentPathology?.title,
    isPathologyPage,
    item?.slug,
    item?.title,
  ]);

  const breadcrumbItems = useMemo(() => {
    const base = [
      { label: 'Accueil', to: '/' },
      { label: 'Cas cliniques', to: '/cas-cliniques' },
    ];

    if (isPresentationNamespace) {
      base.push({ label: 'Présentation', to: `/cas-cliniques?type=presentation&page=1` });

      const pathoLabel = instantPathologyTitle || pathologySlug || 'Pathologie';
      const pathoTo = pathologySlug ? `/cas-cliniques/presentation/${pathologySlug}` : null;

      if (isPathologyPage) {
        base.push({ label: pathoLabel, to: null });
        return base;
      }

      base.push({ label: pathoLabel, to: pathoTo });
      base.push({ label: instantCurrentTitle, to: null });
      return base;
    }

    const crumbTypeLabel = typeLabelFromKey(effectiveType);
    if (crumbTypeLabel && effectiveType) {
      base.push({
        label: crumbTypeLabel,
        to: `/cas-cliniques?type=${encodeURIComponent(effectiveType)}&page=1`,
      });
    }

    base.push({ label: instantCurrentTitle, to: null });
    return base;
  }, [isPresentationNamespace, isPathologyPage, pathologySlug, effectiveType, instantPathologyTitle, instantCurrentTitle]);

  // Lightbox
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
  }, [item?.content, qaList?.length, quizList?.length, relatedCases?.length]);

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
      <Aside
        mode={isPresentationNamespace ? 'presentation' : 'cases'}
        currentType={isPresentationNamespace ? null : effectiveType}
        currentCaseSlug={isPresentationNamespace ? (isCaseInPathology ? caseSlug : null) : caseSlug}
        currentPathologySlug={isPresentationNamespace ? pathologySlug : null}
        collapsed={collapsed}
        collapseDone={collapseDone}
        setCollapseDone={setCollapseDone}
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
            <span className={`cd-chip cd-${effectiveType || 'qa'}`}>{typeLabel}</span>
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
          {/* ✅ titre toujours affiché même si content vide */}
          <div className="cd-content">
            <PageTitle description={item?.excerpt || ''}>{instantCurrentTitle}</PageTitle>
            {item?.content ? <CaseMarkdown>{item.content}</CaseMarkdown> : null}
          </div>

          {/* PATHOLOGY: cas associés */}
          {isPathologyPage && visibleRelatedCases.length > 0 && (
            <section className="cd-children">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <h2 className="cd-children-title">Cas associés</h2>

                {spoilerCounts.other > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowSpoilers((v) => !v)}
                    aria-pressed={showSpoilers ? 'true' : 'false'}
                    title="Afficher les quiz/Q-R liés (peut spoiler)"
                    style={{
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 10,
                      padding: '8px 10px',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {showSpoilers ? 'Masquer les quiz' : 'Afficher les quiz'}
                  </button>
                )}
              </div>

              {!showSpoilers && spoilerCounts.other > 0 && (
                <div className="cd-state" style={{ marginTop: 8 }}>
                  {spoilerCounts.pres} présentation(s) visible(s). {spoilerCounts.other} quiz/Q-R masqué(s) (spoiler).
                </div>
              )}

              <div className="cd-children-grid">
                {visibleRelatedCases.map((c) => (
                  <Link
                    key={c.slug}
                    to={`/cas-cliniques/presentation/${pathologySlug}/${c.slug}`}
                    state={{
                      breadcrumb: {
                        mode: 'presentation',
                        pathology: { slug: pathologySlug, title: instantPathologyTitle || pathologySlug },
                        case: { slug: c.slug, title: c.title || c.slug },
                      },
                      prefetch: { slug: c.slug, title: c.title || c.slug, type: c.type || 'presentation' },
                    }}
                    className="cd-child-card ui-card"
                    onMouseEnter={() => prefetchCase(c.slug, { publicationState: PUB_STATE }).catch(() => {})}
                    onFocus={() => prefetchCase(c.slug, { publicationState: PUB_STATE }).catch(() => {})}
                  >
                    {c.coverUrl && (
                      <img
                        className="cd-child-cover"
                        src={c.coverUrl}
                        alt={c.title || c.slug}
                        loading="lazy"
                        data-no-lightbox="1"
                      />
                    )}
                    <div className="cd-child-title">{c.title || c.slug}</div>
                    {c.excerpt && <div className="cd-child-excerpt">{c.excerpt}</div>}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* QA */}
          {qaList.length > 0 && (
            <section className="qa-section">
              <h2 className="qa-title">{isPathologyPage ? 'Questions (pathologie)' : 'Questions'}</h2>

              {qaList.map((qa, i) => {
                const qTxt = qa?.question || `Question ${i + 1}`;
                const ans = qa?.answer || '';
                return (
                  <details key={qa?.id ?? `${provisionalKeySlug ?? 'x'}-qa-${i}`} className="qa-item">
                    <summary className="qa-q">
                      <span className="qa-num">{i + 1}.</span>
                      <span className="qa-text">{qTxt}</span>
                    </summary>

                    <div className="qa-a">
                      <CaseMarkdown>{ans}</CaseMarkdown>
                    </div>
                  </details>
                );
              })}
            </section>
          )}

          {/* QUIZ */}
          {quizList.length > 0 && (
            <section className="quiz-section">
              <h2 className="quiz-title">{isPathologyPage ? 'Quiz (pathologie)' : 'Quiz'}</h2>

              {quizList.map((qb, i) => (
                <QuizBlock
                  key={qb?.id ?? `${provisionalKeySlug ?? 'x'}-quiz-${i}`}
                  block={qb}
                  index={i}
                  total={quizList.length}
                  seedKey={`${provisionalKeySlug ?? 'x'}-${qb?.id ?? i}`}
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
   Sidebar (Aside)
   ========================= */

function Aside({
  mode, // 'cases' | 'presentation'
  currentType, // cases only
  currentCaseSlug,
  currentPathologySlug,
  collapsed,
  collapseDone,
  setCollapseDone,
  onToggle,
  prefetchRelated,
  isNarrow,
  drawerView,
  setDrawerView,
  closeMobile,
}) {
  const [loadingList, setLoadingList] = useState(false);
  const [errList, setErrList] = useState('');

  const [caseList, setCaseList] = useState([]);
  const [pathoList, setPathoList] = useState([]);

  // refs pour savoir si une liste existe déjà, sans dépendances qui rerunnent tout
  const caseListRef = useRef([]);
  const pathoListRef = useRef([]);
  useEffect(() => {
    caseListRef.current = caseList;
  }, [caseList]);
  useEffect(() => {
    pathoListRef.current = pathoList;
  }, [pathoList]);

  const hasList = mode === 'cases'
    ? (Array.isArray(caseList) && caseList.length > 0)
    : (Array.isArray(pathoList) && pathoList.length > 0);

  const [expandedPathoSlug, setExpandedPathoSlug] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY_EXPANDED_PATHOLOGY) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (mode !== 'presentation') return;
    if (!currentPathologySlug) return;

    setExpandedPathoSlug((prev) => {
      if (prev === currentPathologySlug) return prev;
      try {
        localStorage.setItem(LS_KEY_EXPANDED_PATHOLOGY, currentPathologySlug);
      } catch {}
      return currentPathologySlug;
    });
  }, [mode, currentPathologySlug]);

  const saveExpandedPatho = (slug) => {
    try {
      localStorage.setItem(LS_KEY_EXPANDED_PATHOLOGY, slug || '');
    } catch {}
  };

  const prefetchedRef = useRef(new Set());
  const prefetchIntent = (kind, slug) => {
    if (!slug) return;
    const key = `${kind}:${slug}`;
    if (prefetchedRef.current.has(key)) return;
    prefetchedRef.current.add(key);

    const run =
      kind === 'pathology'
        ? () => prefetchPathology(slug, { publicationState: PUB_STATE }).catch(() => {})
        : () => prefetchCase(slug, { publicationState: PUB_STATE }).catch(() => {});

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 600 });
    } else {
      setTimeout(run, 0);
    }
  };

  // boot cases list from prefetch/session (cases mode)
  useEffect(() => {
    if (mode !== 'cases') return;

    let booted = false;

    if (Array.isArray(prefetchRelated) && currentType) {
      const list = prefetchRelated
        .filter((it) => it?.type === currentType && it?.slug)
        .sort(compareBySlugNumberAsc);

      if (list.length) {
        setCaseList(list);
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
            setCaseList(list);
            booted = true;
          }
        }
      } catch {}
    }

    // ✅ important: si on a déjà une liste, on ne montre pas de "Chargement…"
    if (!booted) setLoadingList(true);
    else setLoadingList(false);
    setErrList('');
  }, [mode, prefetchRelated, currentType]);

  // boot pathologies list from session (presentation mode)
  useEffect(() => {
    if (mode !== 'presentation') return;

    let booted = false;
    try {
      const boot = sessionStorage.getItem('cd-prefetch-pathologies');
      if (boot) {
        const parsed = JSON.parse(boot);
        if (Array.isArray(parsed) && parsed.length) {
          setPathoList(parsed);
          booted = true;
        }
      }
    } catch {}

    if (!booted) setLoadingList(true);
    else setLoadingList(false);
    setErrList('');
  }, [mode]);

  // load sidebar lists (refresh / fetch)
  useEffect(() => {
    let ignore = false;

    async function loadCases() {
      if (!currentType) {
        setCaseList([]);
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
            fields: ['title', 'slug', 'type', 'excerpt'],
            sort: 'slug:asc',
            pagination: { page: 1, pageSize: 500 },
          },
        });

        if (ignore) return;

        const rows = Array.isArray(res?.data) ? res.data : [];
        const normalized = rows.map(normalizeEntity).filter(Boolean).filter((it) => it.slug);

        normalized.sort(compareBySlugNumberAsc);
        setCaseList(normalized);

        try {
          sessionStorage.setItem(`cd-prefetch-${currentType}`, JSON.stringify(normalized));
        } catch {}
      } catch (e) {
        if (!ignore) setErrList(e?.message || 'Erreur de chargement');
      } finally {
        // ✅ on n’affiche "Chargement…" que si la liste est vide
        if (!ignore) setLoadingList(false);
      }
    }

    async function loadPathologies() {
      setErrList('');

      try {
        const res = await strapiFetch(PATHO_ENDPOINT, {
          params: {
            locale: 'all',
            publicationState: PUB_STATE,
            fields: ['title', 'slug', 'excerpt'],
            populate: {
              cases: { fields: ['title', 'slug', 'type'], sort: ['slug:asc'] },
            },
            sort: 'title:asc',
            pagination: { page: 1, pageSize: 400 },
          },
        });

        if (ignore) return;

        const rows = Array.isArray(res?.data) ? res.data : [];
        const normalized = rows.map(normalizeEntity).filter(Boolean).filter((it) => it.slug);

        const cooked = normalized.map((p) => {
          const kids = normalizeRelationArray(p?.cases).filter((c) => c?.slug);
          const presKids = kids.filter((c) => c?.type === 'presentation').sort(compareBySlugNumberAsc);
          return { ...p, _children: presKids };
        });

        cooked.sort((a, b) => {
          const ta = String(a?.title || a?.slug || '');
          const tb = String(b?.title || b?.slug || '');
          return ta.localeCompare(tb, 'fr', { sensitivity: 'base' });
        });

        setPathoList(cooked);

        // index breadcrumb
        try {
          const pathoIndex = {};
          const caseIndex = {};
          for (const p of cooked) {
            if (!p?.slug) continue;
            pathoIndex[p.slug] = { title: p.title || p.slug };
            const kids = Array.isArray(p._children) ? p._children : [];
            for (const c of kids) {
              if (!c?.slug) continue;
              caseIndex[c.slug] = {
                title: c.title || c.slug,
                pathologySlug: p.slug,
                pathologyTitle: p.title || p.slug,
              };
            }
          }
          sessionStorage.setItem('cd-patho-index', JSON.stringify({ pathoIndex, caseIndex }));
        } catch {}

        try {
          sessionStorage.setItem('cd-prefetch-pathologies', JSON.stringify(cooked));
        } catch {}
      } catch (e) {
        if (!ignore) setErrList(e?.message || 'Erreur de chargement');
      } finally {
        if (!ignore) setLoadingList(false);
      }
    }

    // ✅ IMPORTANT: ne pas repasser en "Chargement…" si une liste existe déjà
    const hasListNow =
      mode === 'cases'
        ? (Array.isArray(caseListRef.current) && caseListRef.current.length > 0)
        : (Array.isArray(pathoListRef.current) && pathoListRef.current.length > 0);

    if (!hasListNow) setLoadingList(true);

    if (mode === 'presentation') loadPathologies();
    else loadCases();

    return () => {
      ignore = true;
    };
  }, [mode, currentType]);

  const label =
    mode === 'presentation'
      ? 'Présentations'
      : currentType === 'qa'
        ? 'Cas Q/R'
        : currentType === 'quiz'
          ? 'Quiz'
          : 'Cas';

  const showNavInsteadOfCases = isNarrow && drawerView === 'nav';

  const onAsideTransitionEnd = (e) => {
    if (isNarrow) return;
    if (e.target !== e.currentTarget) return;
    if (e.propertyName !== 'width') return;
    if (collapsed) setCollapseDone(true);
  };

  return (
    <aside
      className={[
        'cd-side',
        collapsed ? 'is-collapsed' : '',
        collapsed && collapseDone ? 'is-collapse-done' : '',
      ].join(' ')}
      onTransitionEnd={onAsideTransitionEnd}
    >
      <div className="cd-side-inner">
        {showNavInsteadOfCases ? (
          <>
            <div className="cd-side-header">Menu</div>

            <ul className="cd-side-list">
              <li>
                <button type="button" className="cd-side-back" onClick={() => setDrawerView('cases')}>
                  ← Liste
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

            <div className="cd-side-header">{label}</div>

            {/* ✅ FIX: ne pas afficher "Chargement…" si la liste est déjà là */}
            {loadingList && !hasList && <div className="cd-side-state">Chargement…</div>}
            {errList && !loadingList && <div className="cd-side-state error">{errList}</div>}

            {!errList && mode === 'cases' && (
              <ul className="cd-side-list">
                {caseList.map((it) => {
                  const isCurrent = it.slug === currentCaseSlug;

                  return (
                    <li key={it.slug}>
                      {isCurrent ? (
                        <span className="cd-side-link active cd-is-current" aria-current="page">
                          <span className="cd-side-link-text">{it.title || it.slug}</span>
                        </span>
                      ) : (
                        <Link
                          className="cd-side-link"
                          to={`/cas-cliniques/${it.slug}`}
                          onClick={() => {
                            if (isNarrow) closeMobile();
                          }}
                          onMouseEnter={() => prefetchIntent('case', it.slug)}
                          onFocus={() => prefetchIntent('case', it.slug)}
                        >
                          <span className="cd-side-link-text">{it.title || it.slug}</span>
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {!errList && mode === 'presentation' && (
              <ul className="cd-side-list">
                {pathoList.map((p) => {
                  const isCurrentPatho = p.slug === currentPathologySlug && !currentCaseSlug;

                  const kids = Array.isArray(p._children) ? p._children : [];
                  const hasKids = kids.length > 0;
                  const isOpen = hasKids && expandedPathoSlug === p.slug;

                  const toggle = () => {
                    if (!hasKids) return;
                    setExpandedPathoSlug((prev) => {
                      const next = prev === p.slug ? '' : p.slug;
                      saveExpandedPatho(next);
                      return next;
                    });
                  };

                  return (
                    <li key={p.slug}>
                      <div
                        className={['cd-side-row', hasKids ? 'has-kids' : '', p.slug === currentPathologySlug ? 'is-active' : ''].join(' ')}
                        onClick={(e) => {
                          if (!hasKids) return;
                          if (e.target?.closest?.('.cd-side-caret')) return;
                          if (p.slug === currentPathologySlug) toggle();
                        }}
                      >
                        {isCurrentPatho ? (
                          <span className="cd-side-link active cd-is-current" aria-current="page">
                            <span className="cd-side-link-text">{p.title || p.slug}</span>
                          </span>
                        ) : (
                          <Link
                            className="cd-side-link"
                            to={`/cas-cliniques/presentation/${p.slug}`}
                            state={{
                              breadcrumb: {
                                mode: 'presentation',
                                pathology: { slug: p.slug, title: p.title || p.slug },
                                case: null,
                              },
                              prefetch: { slug: p.slug, title: p.title || p.slug, type: 'presentation' },
                            }}
                            onClick={() => {
                              if (hasKids) {
                                setExpandedPathoSlug(() => {
                                  saveExpandedPatho(p.slug);
                                  return p.slug;
                                });
                              }
                              if (isNarrow) closeMobile();
                            }}
                            onMouseEnter={() => prefetchIntent('pathology', p.slug)}
                            onFocus={() => prefetchIntent('pathology', p.slug)}
                          >
                            <span className="cd-side-link-text">{p.title || p.slug}</span>
                          </Link>
                        )}

                        <button
                          type="button"
                          className="cd-side-caret"
                          aria-label={isOpen ? 'Réduire' : 'Développer'}
                          aria-expanded={isOpen ? 'true' : 'false'}
                          disabled={!hasKids}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggle();
                          }}
                        />
                      </div>

                      {hasKids && (
                        <div className={['cd-side-sublist', isOpen ? 'is-open' : ''].join(' ')}>
                          <div className="cd-side-sublist-inner">
                            <div className="cd-side-children">
                              {kids.map((ch) => {
                                const isCurrentChild = p.slug === currentPathologySlug && ch.slug === currentCaseSlug;

                                return (
                                  <div key={ch.slug} className="cd-side-child">
                                    {isCurrentChild ? (
                                      <span className="cd-side-link cd-side-child-link active cd-is-current" aria-current="page">
                                        <span className="cd-side-link-text">{ch.title || ch.slug}</span>
                                      </span>
                                    ) : (
                                      <Link
                                        className="cd-side-link cd-side-child-link"
                                        to={`/cas-cliniques/presentation/${p.slug}/${ch.slug}`}
                                        state={{
                                          breadcrumb: {
                                            mode: 'presentation',
                                            pathology: { slug: p.slug, title: p.title || p.slug },
                                            case: { slug: ch.slug, title: ch.title || ch.slug },
                                          },
                                          prefetch: {
                                            slug: ch.slug,
                                            title: ch.title || ch.slug,
                                            type: ch.type || 'presentation',
                                          },
                                        }}
                                        onClick={() => {
                                          if (isNarrow) closeMobile();
                                        }}
                                        onMouseEnter={() => prefetchIntent('case', ch.slug)}
                                        onFocus={() => prefetchIntent('case', ch.slug)}
                                      >
                                        <span className="cd-side-link-text">{ch.title || ch.slug}</span>
                                      </Link>
                                    )}
                                  </div>
                                );
                              })}
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
            onClick={() => {
              if (collapsed && !collapseDone) return;
              onToggle();
            }}
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
