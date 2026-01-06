// src/pages/CaseDetail.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, NavLink, useLocation } from 'react-router-dom';

import PageTitle from '../components/PageTitle';
import Breadcrumbs from '../components/Breadcrumbs';
import QuizBlock from '../components/QuizBlock';
import CaseMarkdown from '../components/CaseMarkdown';

import { strapiFetch, imgUrl } from '../lib/strapi';
import { getCaseFromCache, setCaseToCache, prefetchCase } from '../lib/caseCache';
import { getPathologyFromCache, setPathologyToCache } from '../lib/pathologyCache';

import { BottomExpandIcon, BottomCollapseIcon } from '../components/Icons';
import { useCaseDetailSidebar } from '../ui/CaseDetailSidebarContext';

import './CaseDetail.css';

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const PATHO_ENDPOINT = import.meta.env.VITE_PATHO_ENDPOINT || '/pathologies';
const DOCS_ENDPOINT = import.meta.env.VITE_DOCS_ENDPOINT || '/doc-nodes';
const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

const LS_KEY_COLLAPSE = 'cd-sidebar-collapsed';
const LS_KEY_EXPANDED_PATHOLOGY = 'cd-expanded-pathology';
const LS_KEY_EXPANDED_DOC_ITEM = 'cd-expanded-doc-item';

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
  if (typeKey === 'presentation') return 'Atlas';
  if (typeKey === 'doc') return 'Documentation';
  return null;
}

function badgeVariantFromKey(typeKey) {
  if (typeKey === 'qa') return 'success';
  if (typeKey === 'quiz') return 'info';
  if (typeKey === 'doc') return 'secondary';
  return 'danger';
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

/* =========================
   Badges (pathologies)
   - supporte badges: [ ... ] (ton API)
   - supporte badges: { data: [...] } (relation Strapi)
   ========================= */
function normalizeBadges(badgesAny) {
  const list = Array.isArray(badgesAny) ? badgesAny : Array.isArray(badgesAny?.data) ? badgesAny.data : [];

  return list
    .map((n) => (n?.attributes ? n.attributes : n))
    .filter(Boolean)
    .map((b) => ({
      label: String(b?.label || '').trim(),
      variant: String(b?.variant || 'info').trim() || 'info',
    }))
    .filter((b) => b.label);
}

function pickPrimaryBadge(badgesAny) {
  const badges = normalizeBadges(badgesAny);
  if (badges.length === 0) return { text: 'Atlas', variant: 'info' };

  badges.sort((a, b) => String(a.label).localeCompare(String(b.label), 'fr', { sensitivity: 'base' }));
  return { text: badges[0].label || 'Atlas', variant: badges[0].variant || 'info' };
}

/* ===== DOC session helpers (perf only) ===== */
function getDocNodeFromSession(slug) {
  if (!slug) return null;
  try {
    const raw = sessionStorage.getItem(`docnode:${slug}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function setDocNodeToSession(slug, data) {
  if (!slug || !data) return;
  try {
    sessionStorage.setItem(`docnode:${slug}`, JSON.stringify(data));
  } catch {}
}
function getDocItemsFromSession(chapterSlug) {
  if (!chapterSlug) return null;
  try {
    const raw = sessionStorage.getItem(`doc-items:${chapterSlug}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function setDocItemsToSession(chapterSlug, list) {
  if (!chapterSlug || !Array.isArray(list)) return;
  try {
    sessionStorage.setItem(`doc-items:${chapterSlug}`, JSON.stringify(list));
  } catch {}
}
function getDocSectionsForItemFromSession(itemSlug) {
  if (!itemSlug) return null;
  try {
    const raw = sessionStorage.getItem(`doc-sections:${itemSlug}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function setDocSectionsForItemToSession(itemSlug, list) {
  if (!itemSlug || !Array.isArray(list)) return;
  try {
    sessionStorage.setItem(`doc-sections:${itemSlug}`, JSON.stringify(list));
  } catch {}
}
function getDocSectionsByChapterFromSession(chapterSlug) {
  if (!chapterSlug) return null;
  try {
    const raw = sessionStorage.getItem(`doc-sectionsByChapter:${chapterSlug}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
function setDocSectionsByChapterToSession(chapterSlug, map) {
  if (!chapterSlug || !map) return;
  try {
    sessionStorage.setItem(`doc-sectionsByChapter:${chapterSlug}`, JSON.stringify(map));
  } catch {}
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

function getParentSlugSafe(node) {
  const p = node?.parent;
  if (!p) return null;
  if (typeof p === 'string') return p;
  if (p?.slug) return p.slug;
  if (p?.data?.attributes?.slug) return p.data.attributes.slug;
  if (p?.data?.slug) return p.data.slug;
  return null;
}

/* ===== Stable sorting for docs (cache + fetch) ===== */
function toOrder(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
}
function sortByOrderThenTitle(a, b) {
  const ao = toOrder(a?.order);
  const bo = toOrder(b?.order);
  if (ao !== bo) return ao - bo;

  const ta = String(a?.title || a?.slug || '');
  const tb = String(b?.title || b?.slug || '');
  return ta.localeCompare(tb, 'fr', { sensitivity: 'base' });
}
function sortListSafe(arr) {
  const list = Array.isArray(arr) ? [...arr] : [];
  list.sort(sortByOrderThenTitle);
  return list;
}

/** construit un chemin à partir d’un basePath ('' ou '/documentation') + segments */
function buildPath(basePath, segments) {
  const cleanBase = (basePath || '').replace(/\/+$/, '');
  const cleanSegs = (segments || []).filter(Boolean).map((s) => String(s).replace(/^\/+|\/+$/g, ''));
  const joined = [cleanBase, ...cleanSegs].filter(Boolean).join('/');
  return '/' + joined.replace(/^\/+/, '');
}

function hasMeaningfulContentLike(obj) {
  if (!obj) return false;
  if (typeof obj?.content === 'string' && obj.content.trim().length > 0) return true;
  if (typeof obj?.excerpt === 'string' && obj.excerpt.trim().length > 0) return true;
  if (Array.isArray(obj?.qa_blocks) && obj.qa_blocks.length) return true;
  if (Array.isArray(obj?.quiz_blocks) && obj.quiz_blocks.length) return true;
  if (typeof obj?.references === 'string' && obj.references.trim().length > 0) return true;
  if (typeof obj?.copyright === 'string' && obj.copyright.trim().length > 0) return true;
  return false;
}

/* =========================
   Page
   ========================= */

export default function CaseDetail(props) {
  const params = useParams();
  const location = useLocation();

  const kind = props?.kind || null;

  // basePath docs: '/documentation' OU '' (URL courte)
  const docBasePath =
    typeof props?.basePath === 'string'
      ? props.basePath
      : location.pathname === '/documentation' || location.pathname.startsWith('/documentation/')
        ? '/documentation'
        : '';

  // DOC slugs
  const subjectSlug = props?.subjectSlug ?? params.subjectSlug ?? null;
  const chapterSlug = props?.chapterSlug ?? params.chapterSlug ?? null;
  const docItemSlug = props?.itemSlug ?? params.itemSlug ?? null;
  const docSectionSlug = props?.sectionSlug ?? params.sectionSlug ?? null;

  // doc: si router a explicitement envoyé kind="doc", c’est la source de vérité
  const isDocNamespace =
    kind === 'doc' ||
    (location.pathname.startsWith('/documentation') && Boolean(subjectSlug && chapterSlug && docItemSlug));

  const isDocItemPage = isDocNamespace && !docSectionSlug;
  const docDisplaySlug = isDocNamespace ? (docSectionSlug || docItemSlug) : null;

  // CASE slugs
  const pathologySlug = !isDocNamespace ? (props?.pathologySlug ?? params.pathologySlug ?? null) : null;
  const caseSlug = !isDocNamespace ? (props?.caseSlug ?? params.caseSlug ?? props?.slug ?? params.slug ?? null) : null;

  const isPresentationNamespace = Boolean(pathologySlug);
  const isPathologyPage = isPresentationNamespace && !caseSlug;
  const isCaseInPathology = isPresentationNamespace && Boolean(caseSlug);
  const isPlainCase = !isPresentationNamespace && !isDocNamespace;

  const isNarrow = useIsNarrow(980);
  const { mobileOpen, setMobileOpen } = useCaseDetailSidebar();
  const [drawerView, setDrawerView] = useState('cases');

  const navCrumb = location.state?.breadcrumb || null;
  const pre = location.state?.prefetch || null;

  const expectedSlug = useMemo(() => {
    if (isDocNamespace) return docDisplaySlug;
    if (isPathologyPage) return pathologySlug;
    if (isCaseInPathology) return caseSlug;
    return caseSlug;
  }, [isDocNamespace, docDisplaySlug, isPathologyPage, pathologySlug, isCaseInPathology, caseSlug]);

  const provisional = useMemo(() => {
    if (!pre || !expectedSlug) return null;
    return pre.slug === expectedSlug ? pre : null;
  }, [pre, expectedSlug]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // item = dernier résultat (cache/provisional/fetch) pour le slug attendu
  const [item, setItem] = useState(() => {
    const key = expectedSlug;
    if (!key) return null;

    if (isDocNamespace) return getDocNodeFromSession(key) || (hasMeaningfulContentLike(provisional) ? provisional : null);
    if (isPathologyPage)
      return getPathologyFromCache(key) || (hasMeaningfulContentLike(provisional) ? provisional : null);
    return getCaseFromCache(key) || (hasMeaningfulContentLike(provisional) ? provisional : null);
  });

  // displayItem = ce qui reste affiché tant que le nouveau n’est pas prêt (stale-while-revalidate)
  const [displayItem, setDisplayItem] = useState(() => item || null);
  const [isReplacing, setIsReplacing] = useState(false);

  const itemMatchesRoute = Boolean(item?.slug && expectedSlug && item.slug === expectedSlug);
  const displayMatchesRoute = Boolean(displayItem?.slug && expectedSlug && displayItem.slug === expectedSlug);

  // DOC: sections du current ITEM affiché (pas celui en cours de fetch)
  const [docCurrentItemSections, setDocCurrentItemSections] = useState(() => {
    if (!isDocNamespace || !docItemSlug) return [];
    return getDocSectionsForItemFromSession(docItemSlug) || [];
  });

  // parent pathology (utile sur /atlas/:patho/:case) - pour l’affichage courant
  const [parentPathology, setParentPathology] = useState(() => {
    if (!isCaseInPathology || !pathologySlug) return null;
    return getPathologyFromCache(pathologySlug) || null;
  });

  // stableType seulement pour les cas classiques (affichage)
  const [stableType, setStableType] = useState(() => {
    if (!isPlainCase) return null;
    return getCaseFromCache(caseSlug)?.type || provisional?.type || null;
  });

  useEffect(() => {
    if (isPlainCase && displayItem?.type) setStableType(displayItem.type);
  }, [displayItem?.type, isPlainCase]);

  // Dès que l’URL change, on garde l’ancien affichage et on marque "remplacement en cours"
  useEffect(() => {
    if (!expectedSlug) return;
    if (!displayItem?.slug) {
      setIsReplacing(true);
      return;
    }
    if (displayItem.slug !== expectedSlug) setIsReplacing(true);
  }, [expectedSlug, displayItem?.slug]);

  // Quand le bon item est prêt, on "commit" dans displayItem d’un coup
  useEffect(() => {
    if (itemMatchesRoute && item) {
      setDisplayItem(item);
      setIsReplacing(false);
    }
  }, [itemMatchesRoute, item]);

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
  }, [caseSlug, pathologySlug, docItemSlug, docSectionSlug, isNarrow, setMobileOpen]);

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
    const coverUrl = imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || null;

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
            badges: { fields: ['label', 'variant'] }, // ✅ badges
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
      res = await loadOnce({ withQa: true, withQuiz: true, withCases });
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
    const coverUrl = imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || null;

    const rel = normalizeRelationArray(attrs?.cases).map((c) => {
      const cCoverAttr = c?.cover?.data?.attributes || c?.cover || null;
      const cCoverUrl = imgUrl(cCoverAttr, 'medium') || imgUrl(cCoverAttr, 'thumbnail') || imgUrl(cCoverAttr) || null;
      return { ...c, coverUrl: cCoverUrl || null };
    });

    return { ...attrs, coverUrl: coverUrl || null, cases: rel };
  }

  async function loadDocNodeBySlug(slugToLoad) {
    const res = await strapiFetch(DOCS_ENDPOINT, {
      params: {
        filters: { slug: { $eq: slugToLoad } },
        locale: 'all',
        publicationState: PUB_STATE,
        populate: {
          cover: { fields: ['url', 'formats'] },
          parent: { populate: { parent: { populate: { parent: true } } } },
        },
        fields: ['title', 'slug', 'level', 'excerpt', 'content', 'updatedAt', 'references', 'copyright'],
        pagination: { page: 1, pageSize: 1 },
      },
    });

    const node = Array.isArray(res?.data) ? res.data[0] : null;
    const attrs = normalizeEntity(node);
    if (!attrs) return null;

    const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
    const coverUrl = imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || null;

    return { ...attrs, coverUrl: coverUrl || null };
  }

  async function loadDocSectionsForItem(itemSlugToLoad) {
    if (!itemSlugToLoad) return [];

    const cached = getDocSectionsForItemFromSession(itemSlugToLoad);
    if (cached) return sortListSafe(cached);

    const res = await strapiFetch(DOCS_ENDPOINT, {
      params: {
        locale: 'all',
        publicationState: PUB_STATE,
        filters: { level: { $eq: 'section' }, parent: { slug: { $eq: itemSlugToLoad } } },
        fields: ['title', 'slug', 'level', 'excerpt', 'updatedAt', 'order'],
        populate: { cover: { fields: ['url', 'formats'] } },
        sort: ['order:asc', 'title:asc'],
        pagination: { page: 1, pageSize: 500 },
      },
    });

    const rows = Array.isArray(res?.data) ? res.data : [];
    const normalized = rows.map(normalizeEntity).filter(Boolean).filter((it) => it.slug);

    const cooked = normalized.map((s) => {
      const coverAttr = s?.cover?.data?.attributes || s?.cover || null;
      const coverUrl = imgUrl(coverAttr, 'medium') || imgUrl(coverAttr, 'thumbnail') || imgUrl(coverAttr) || null;
      return { ...s, coverUrl: coverUrl || null };
    });

    const sorted = sortListSafe(cooked);
    setDocSectionsForItemToSession(itemSlugToLoad, sorted);
    return sorted;
  }

  // ---------- main load (ne vide jamais displayItem) ----------
  useEffect(() => {
    let ignore = false;

    const slugToLoad = expectedSlug;
    if (!slugToLoad) {
      setError('Slug manquant.');
      setLoading(false);
      return () => {};
    }

    setError('');

    // cache instant
    const cached = isDocNamespace
      ? getDocNodeFromSession(slugToLoad)
      : isPathologyPage
        ? getPathologyFromCache(slugToLoad)
        : getCaseFromCache(slugToLoad);

    // Si on a le cache complet, on commit immédiatement (pas de trou)
    if (cached?.slug === slugToLoad) {
      setItem(cached);
      setLoading(false);
      setDisplayItem(cached);
      setIsReplacing(false);
    } else {
      if (provisional?.slug === slugToLoad && hasMeaningfulContentLike(provisional)) {
        setItem(provisional);
      } else {
        setItem((prev) => (prev?.slug === slugToLoad ? prev : prev));
      }
      setLoading(true);
    }

    async function load() {
      try {
        if (isDocNamespace) {
          const fullDoc = await loadDocNodeBySlug(slugToLoad);
          if (ignore) return;

          if (!fullDoc) {
            setError('Document introuvable ou non publié.');
            return;
          }

          setItem(fullDoc);
          setDocNodeToSession(slugToLoad, fullDoc);

          if (isDocItemPage && docItemSlug) {
            const secs = await loadDocSectionsForItem(docItemSlug);
            if (ignore) return;
            setDocCurrentItemSections(secs);
          }

          return;
        }

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
          // ✅ parent complet avec badges (sans cases)
          const parentPromise = pathologySlug
            ? loadPathologyBySlug(pathologySlug, { withCases: false }).catch(() => null)
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

          if (parent) {
            setParentPathology(parent);
            if (pathologySlug) setPathologyToCache(pathologySlug, parent);
          } else if (pathologySlug) {
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
  }, [
    expectedSlug,

    isDocNamespace,
    isDocItemPage,
    docItemSlug,
    docSectionSlug,

    pathologySlug,
    caseSlug,
    isPathologyPage,
    isCaseInPathology,
  ]);

  // ---------- type + labels (basés sur l’affichage) ----------
  const effectiveType = useMemo(() => {
    if (isDocNamespace) return 'doc';
    if (isPresentationNamespace) return 'presentation';
    return displayItem?.type || provisional?.type || stableType || null;
  }, [isDocNamespace, isPresentationNamespace, displayItem?.type, provisional?.type, stableType]);

  const typeLabel = useMemo(() => {
    if (effectiveType === 'qa') return 'Q/R';
    if (effectiveType === 'quiz') return 'Quiz';
    if (effectiveType === 'doc') return 'Documentation';
    return 'Atlas';
  }, [effectiveType]);

  // ✅ badge de pathologie (au lieu de "Atlas") dans le namespace /atlas
  const pathologyBadge = useMemo(() => {
    if (!isPresentationNamespace) return null;
    const srcBadges = isPathologyPage ? displayItem?.badges : parentPathology?.badges;
    return pickPrimaryBadge(srcBadges);
  }, [isPresentationNamespace, isPathologyPage, displayItem?.badges, parentPathology?.badges]);

  const qaList = !isDocNamespace && Array.isArray(displayItem?.qa_blocks) ? displayItem.qa_blocks : [];
  const quizList = !isDocNamespace && Array.isArray(displayItem?.quiz_blocks) ? displayItem.quiz_blocks : [];

  const relatedCases = useMemo(() => {
    if (!isPathologyPage) return [];
    return Array.isArray(displayItem?.cases) ? displayItem.cases : [];
  }, [isPathologyPage, displayItem?.cases]);

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

  // ---------- breadcrumb / titres ----------
  const cdIndex = useMemo(() => safeGetSessionJson('cd-patho-index'), []);
  const indexPatho = cdIndex?.pathoIndex || {};
  const indexCase = cdIndex?.caseIndex || {};

  const displayTitle = useMemo(() => {
    if (isDocNamespace) return displayItem?.title || displayItem?.slug || 'Documentation';
    if (isPathologyPage) return displayItem?.title || displayItem?.slug || 'Pathologie';
    if (isPresentationNamespace && isCaseInPathology) return displayItem?.title || displayItem?.slug || 'Cas clinique';
    return displayItem?.title || displayItem?.slug || 'Cas clinique';
  }, [isDocNamespace, isPathologyPage, isPresentationNamespace, isCaseInPathology, displayItem?.title, displayItem?.slug]);

  const targetTitle = useMemo(() => {
    if (!expectedSlug) return null;

    if (isDocNamespace) {
      if (itemMatchesRoute && item?.title) return item.title;
      if (provisional?.title) return provisional.title;
      return expectedSlug;
    }

    if (isPathologyPage) {
      if (navCrumb?.pathology?.title) return navCrumb.pathology.title;
      if (indexPatho?.[pathologySlug]?.title) return indexPatho[pathologySlug].title;
      if (itemMatchesRoute && item?.title) return item.title;
      if (provisional?.title) return provisional.title;
      return pathologySlug || expectedSlug;
    }

    if (isCaseInPathology) {
      if (navCrumb?.case?.title) return navCrumb.case.title;
      if (indexCase?.[caseSlug]?.title) return indexCase[caseSlug].title;
      if (itemMatchesRoute && item?.title) return item.title;
      if (provisional?.title) return provisional.title;
      return caseSlug || expectedSlug;
    }

    if (navCrumb?.case?.title) return navCrumb.case.title;
    if (itemMatchesRoute && item?.title) return item.title;
    if (provisional?.title) return provisional.title;
    return caseSlug || expectedSlug;
  }, [
    expectedSlug,
    isDocNamespace,
    isPathologyPage,
    isCaseInPathology,
    navCrumb,
    indexPatho,
    indexCase,
    pathologySlug,
    caseSlug,
    itemMatchesRoute,
    item?.title,
    provisional?.title,
  ]);

  const instantPathologyTitle = useMemo(() => {
    if (!isPresentationNamespace) return null;

    if (navCrumb?.pathology?.title) return navCrumb.pathology.title;
    if (indexPatho?.[pathologySlug]?.title) return indexPatho[pathologySlug].title;
    if (parentPathology?.slug === pathologySlug && parentPathology?.title) return parentPathology.title;
    return pathologySlug || 'Pathologie';
  }, [isPresentationNamespace, navCrumb, indexPatho, pathologySlug, parentPathology?.slug, parentPathology?.title]);

  const docCrumb = useMemo(() => {
    if (!isDocNamespace) return null;

    const chain = [];
    let cur = itemMatchesRoute ? item : displayItem;
    for (let i = 0; i < 6; i += 1) {
      if (!cur) break;
      chain.push({ slug: cur.slug, title: cur.title || cur.slug, level: cur.level || '' });
      const p = cur?.parent?.data?.attributes || cur?.parent || null;
      cur = p || null;
    }
    const rev = [...chain].reverse();

    const subject =
      rev.find((x) => x.level === 'subject') ||
      (subjectSlug ? { slug: subjectSlug, title: subjectSlug, level: 'subject' } : null);

    const chapter =
      rev.find((x) => x.level === 'chapter') ||
      (chapterSlug ? { slug: chapterSlug, title: chapterSlug, level: 'chapter' } : null);

    const theItem =
      rev.find((x) => x.level === 'item') ||
      (docItemSlug ? { slug: docItemSlug, title: docItemSlug, level: 'item' } : null);

    const theSection =
      rev.find((x) => x.level === 'section') ||
      (docSectionSlug ? { slug: docSectionSlug, title: docSectionSlug, level: 'section' } : null);

    return { subject, chapter, theItem, theSection };
  }, [isDocNamespace, itemMatchesRoute, item, displayItem, subjectSlug, chapterSlug, docItemSlug, docSectionSlug]);

  const qrHubTo = useMemo(() => {
    if (effectiveType === 'qa') return '/qr-quiz/qr';
    if (effectiveType === 'quiz') return '/qr-quiz/quiz';
    return '/qr-quiz/tous';
  }, [effectiveType]);

  const breadcrumbItems = useMemo(() => {
    if (isDocNamespace) {
      const base = [
        { label: 'Accueil', to: '/' },
        { label: 'Documentation', to: '/documentation' },
      ];

      if (docCrumb?.subject) {
        base.push({
          label: docCrumb.subject.title,
          to: buildPath(docBasePath, [docCrumb.subject.slug]),
        });
      }

      if (docCrumb?.chapter && subjectSlug) {
        base.push({
          label: docCrumb.chapter.title,
          to: buildPath(docBasePath, [subjectSlug, docCrumb.chapter.slug]),
        });
      }

      if (docCrumb?.theItem && subjectSlug && chapterSlug) {
        base.push({
          label: docCrumb.theItem.title,
          to: docSectionSlug ? buildPath(docBasePath, [subjectSlug, chapterSlug, docCrumb.theItem.slug]) : null,
        });
      }

      if (docSectionSlug && docCrumb?.theSection) base.push({ label: docCrumb.theSection.title, to: null });

      return base;
    }

    // hubs atlas
    if (isPresentationNamespace) {
      const base = [
        { label: 'Accueil', to: '/' },
        { label: 'Atlas', to: '/atlas' },
      ];

      const pathoLabel = instantPathologyTitle || pathologySlug || 'Pathologie';
      const pathoTo = pathologySlug ? `/atlas/${pathologySlug}` : null;

      if (isPathologyPage) {
        base.push({ label: pathoLabel, to: null });
        return base;
      }

      base.push({ label: pathoLabel, to: pathoTo });
      base.push({ label: targetTitle || 'Cas clinique', to: null });
      return base;
    }

    // plain case (qa/quiz) => hub /qr-quiz
    const base = [
      { label: 'Accueil', to: '/' },
      { label: 'Q/R & Quiz', to: '/qr-quiz' },
    ];

    const crumbTypeLabel = typeLabelFromKey(effectiveType);
    if (crumbTypeLabel && (effectiveType === 'qa' || effectiveType === 'quiz')) {
      base.push({ label: crumbTypeLabel, to: qrHubTo });
    }

    base.push({ label: targetTitle || 'Cas clinique', to: null });
    return base;
  }, [
    isDocNamespace,
    docCrumb,
    docBasePath,
    subjectSlug,
    chapterSlug,
    docSectionSlug,

    isPresentationNamespace,
    isPathologyPage,
    pathologySlug,
    instantPathologyTitle,
    targetTitle,

    effectiveType,
    qrHubTo,
  ]);

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
  }, [
    displayItem?.content,
    qaList?.length,
    quizList?.length,
    visibleRelatedCases?.length,
    docCurrentItemSections?.length,
  ]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const drawerOpen = isNarrow && mobileOpen;

  const docChildSections = useMemo(() => {
    if (!isDocItemPage) return [];
    return Array.isArray(docCurrentItemSections) ? docCurrentItemSections : [];
  }, [isDocItemPage, docCurrentItemSections]);

  const showExtras = Boolean(displayItem?.references || displayItem?.copyright);
  const markdownScopeKey = String(displayItem?.slug || displayItem?.id || 'x');

  return (
    <div className={['cd-shell', collapsed ? 'is-collapsed' : '', drawerOpen ? 'is-drawer-open' : ''].join(' ')}>
      <Aside
        mode={isDocNamespace ? 'docs' : isPresentationNamespace ? 'presentation' : 'cases'}
        currentType={isPresentationNamespace || isDocNamespace ? null : effectiveType}
        currentCaseSlug={
          isPresentationNamespace ? (isCaseInPathology ? caseSlug : null) : isPlainCase ? caseSlug : null
        }
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
        docBasePath={docBasePath}
        docSubjectSlug={subjectSlug}
        docChapterSlug={chapterSlug}
        docItemSlug={docItemSlug}
        docSectionSlug={docSectionSlug}
        currentDocSections={docCurrentItemSections}
        setCurrentDocSections={setDocCurrentItemSections}
        pubState={PUB_STATE}
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

          <div className="cd-type-badge">
            {isPresentationNamespace ? (
              <span className={`badge badge-soft-outline badge-${pathologyBadge?.variant || 'info'}`}>
                {pathologyBadge?.text || 'Atlas'}
              </span>
            ) : (
              <span className={`badge badge-soft-outline badge-${badgeVariantFromKey(effectiveType || 'qa')}`}>
                {typeLabel}
              </span>
            )}
          </div>
        </div>

        {error && <div className="cd-state error">{error}</div>}

        <article className="casedetail" ref={contentRef}>
          <div className="cd-content">
            <PageTitle description={displayItem?.excerpt || ''}>{displayTitle}</PageTitle>

            {displayItem?.content ? (
              <CaseMarkdown scopeKey={markdownScopeKey}>{displayItem.content}</CaseMarkdown>
            ) : (
              !displayItem && !error && <div className="cd-state">Chargement…</div>
            )}
          </div>

          {/* DOC children */}
          {isDocNamespace && displayMatchesRoute && isDocItemPage && docChildSections.length > 0 && (
            <section className="cd-children">
              <h2 className="cd-children-title">Sections</h2>

              <div className="cd-children-grid">
                {docChildSections.map((s) => {
                  const to = buildPath(docBasePath, [subjectSlug, chapterSlug, docItemSlug, s.slug]);
                  return (
                    <Link
                      key={s.slug}
                      to={to}
                      className="cd-child-card ui-card"
                      state={{ prefetch: { slug: s.slug, title: s.title || s.slug, type: 'doc' } }}
                    >
                      {s.coverUrl && (
                        <img
                          className="cd-child-cover"
                          src={s.coverUrl}
                          alt={s.title || s.slug}
                          loading="lazy"
                          data-no-lightbox="1"
                        />
                      )}
                      <div className="cd-child-title">{s.title || s.slug}</div>
                      {s.excerpt && <div className="cd-child-excerpt">{s.excerpt}</div>}
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* PATHO children */}
          {!isDocNamespace && isPathologyPage && displayMatchesRoute && relatedCases.length > 0 && (
            <section className="cd-children cd-related">
              <div className="cd-related-head">
                <h2 className="cd-children-title">Cas associés</h2>

                {spoilerCounts.other > 0 && (
                  <button
                    type="button"
                    className="cd-related-spoil-btn"
                    onClick={() => setShowSpoilers((v) => !v)}
                    aria-pressed={showSpoilers ? 'true' : 'false'}
                    title="Afficher les quiz/Q-R liés (peut spoiler)"
                  >
                    {showSpoilers ? 'Masquer quiz' : 'Afficher quiz (spoil)'}
                  </button>
                )}
              </div>

              <div className="cd-children-grid">
                {visibleRelatedCases.map((c) => (
                  <Link
                    key={c.slug}
                    to={`/atlas/${pathologySlug}/${c.slug}`}
                    state={{
                      breadcrumb: {
                        mode: 'atlas',
                        pathology: { slug: pathologySlug, title: instantPathologyTitle || pathologySlug },
                        case: { slug: c.slug, title: c.title || c.slug },
                      },
                      prefetch: { slug: c.slug, title: c.title || c.slug, type: c.type || 'presentation' },
                    }}
                    className="cd-child-card ui-card"
                    onMouseEnter={() => prefetchCase(c.slug, { publicationState: PUB_STATE }).catch(() => {})}
                    onFocus={() => prefetchCase(c.slug, { publicationState: PUB_STATE }).catch(() => {})}
                    onPointerDown={() => prefetchCase(c.slug, { publicationState: PUB_STATE }).catch(() => {})}
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
          {!isDocNamespace && displayMatchesRoute && qaList.length > 0 && (
            <section className="qa-section">
              <h2 className="qa-title">{isPathologyPage ? 'Questions (pathologie)' : 'Questions'}</h2>

              {qaList.map((qa, i) => {
                const qTxt = qa?.question || `Question ${i + 1}`;
                const ans = qa?.answer || '';
                return (
                  <details key={qa?.id ?? `${markdownScopeKey}-qa-${i}`} className="qa-item">
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
          {!isDocNamespace && displayMatchesRoute && quizList.length > 0 && (
            <section className="quiz-section">
              <h2 className="quiz-title">{isPathologyPage ? 'Quiz (pathologie)' : 'Quiz'}</h2>

              {quizList.map((qb, i) => (
                <QuizBlock
                  key={qb?.id ?? `${markdownScopeKey}-quiz-${i}`}
                  block={qb}
                  index={i}
                  total={quizList.length}
                  seedKey={`${markdownScopeKey}-${qb?.id ?? i}`}
                  Markdown={CaseMarkdown}
                />
              ))}
            </section>
          )}

          {/* EXTRAS */}
          {displayMatchesRoute && showExtras && (
            <section className="cd-extras">
              {displayItem?.references && (
                <div className="cd-references">
                  <h3>Références</h3>
                  <CaseMarkdown>{displayItem.references}</CaseMarkdown>
                </div>
              )}

              {displayItem?.copyright && (
                <div className="cd-copyright">
                  <h3>Copyright</h3>
                  <CaseMarkdown>{displayItem.copyright}</CaseMarkdown>
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
  mode,
  currentType,
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

  docBasePath,
  docSubjectSlug,
  docChapterSlug,
  docItemSlug,
  docSectionSlug,
  currentDocSections,
  setCurrentDocSections,
  pubState,
}) {
  const [loadingList, setLoadingList] = useState(false);
  const [errList, setErrList] = useState('');

  const [caseList, setCaseList] = useState([]);
  const [pathoList, setPathoList] = useState([]);

  // DOCS
  const [docItems, setDocItems] = useState(() => (docChapterSlug ? getDocItemsFromSession(docChapterSlug) || [] : []));
  const [docSectionsByItem, setDocSectionsByItem] = useState(() => {
    const map = {};
    if (docItemSlug && Array.isArray(currentDocSections) && currentDocSections.length) {
      map[docItemSlug] = sortListSafe(currentDocSections);
    }
    const byChap = docChapterSlug ? getDocSectionsByChapterFromSession(docChapterSlug) : null;
    if (byChap && typeof byChap === 'object') {
      for (const [k, v] of Object.entries(byChap)) {
        if (Array.isArray(v)) map[k] = sortListSafe(v);
      }
    }
    return map;
  });

  const caseListRef = useRef([]);
  const pathoListRef = useRef([]);
  const docItemsRef = useRef([]);
  useEffect(() => {
    caseListRef.current = caseList;
  }, [caseList]);
  useEffect(() => {
    pathoListRef.current = pathoList;
  }, [pathoList]);
  useEffect(() => {
    docItemsRef.current = docItems;
  }, [docItems]);

  // persist "currentDocSections" into local map (for stable chevrons)
  useEffect(() => {
    if (mode !== 'docs') return;
    if (!docItemSlug) return;
    if (!Array.isArray(currentDocSections)) return;

    setDocSectionsByItem((prev) => ({
      ...prev,
      [docItemSlug]: sortListSafe(currentDocSections),
    }));
  }, [mode, docItemSlug, currentDocSections]);

  const hasList =
    mode === 'cases'
      ? Array.isArray(caseList) && caseList.length > 0
      : mode === 'presentation'
        ? Array.isArray(pathoList) && pathoList.length > 0
        : Array.isArray(docItems) && docItems.length > 0;

  // PRESENTATION expanded
  const [expandedPathoSlug, setExpandedPathoSlug] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY_EXPANDED_PATHOLOGY) || '';
    } catch {
      return '';
    }
  });
  const saveExpandedPatho = (slug) => {
    try {
      localStorage.setItem(LS_KEY_EXPANDED_PATHOLOGY, slug || '');
    } catch {}
  };

  // DOC expanded item
  const [expandedDocItemSlug, setExpandedDocItemSlug] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY_EXPANDED_DOC_ITEM) || '';
    } catch {
      return '';
    }
  });
  const saveExpandedDocItem = (slug) => {
    try {
      localStorage.setItem(LS_KEY_EXPANDED_DOC_ITEM, slug || '');
    } catch {}
  };

  useEffect(() => {
    if (mode !== 'presentation') return;
    if (!currentPathologySlug) return;

    setExpandedPathoSlug((prev) => {
      if (prev === currentPathologySlug) return prev;
      saveExpandedPatho(currentPathologySlug);
      return currentPathologySlug;
    });
  }, [mode, currentPathologySlug]);

  useEffect(() => {
    if (mode !== 'docs') return;
    if (!docItemSlug) return;

    setExpandedDocItemSlug((prev) => {
      if (prev === docItemSlug) return prev;
      saveExpandedDocItem(docItemSlug);
      return docItemSlug;
    });
  }, [mode, docItemSlug]);

  // Prefetch for cases/pathologies
  const prefetchedRef = useRef(new Set());
  const prefetchIntent = (kind, slug) => {
    if (!slug) return;
    const key = `${kind}:${slug}`;
    if (prefetchedRef.current.has(key)) return;
    prefetchedRef.current.add(key);

    const run =
      kind === 'pathology'
        ? () => {
            // ici on conserve le prefetch "léger" existant, car le badge s’affiche en header via parentPathology (chargée full)
            // donc pas besoin d’alourdir la sidebar
            // Si tu veux badges dans la sidebar, on pourra ajouter populate badges ici aussi.
            // eslint-disable-next-line no-throw-literal
            throw null;
          }
        : () => prefetchCase(slug, { publicationState: pubState }).catch(() => {});

    if (kind === 'pathology') {
      // pas de prefetchPathology importé ici (volontaire)
      return;
    }

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 600 });
    } else {
      setTimeout(run, 0);
    }
  };

  // ---- DOC loaders ----
  async function loadDocItems() {
    if (!docChapterSlug) {
      setDocItems([]);
      return [];
    }

    const cached = getDocItemsFromSession(docChapterSlug);
    if (cached && cached.length) {
      const sorted = sortListSafe(cached);
      setDocItems(sorted);
      return sorted;
    }

    const res = await strapiFetch(DOCS_ENDPOINT, {
      params: {
        locale: 'all',
        publicationState: pubState,
        filters: { level: { $eq: 'item' }, parent: { slug: { $eq: docChapterSlug } } },
        fields: ['title', 'slug', 'level', 'order'],
        populate: { cover: { fields: ['url', 'formats'] } },
        sort: ['order:asc', 'title:asc'],
        pagination: { page: 1, pageSize: 500 },
      },
    });

    const rows = Array.isArray(res?.data) ? res.data : [];
    const normalized = rows.map(normalizeEntity).filter(Boolean).filter((it) => it.slug);

    const cooked = normalized.map((d) => {
      const coverAttr = d?.cover?.data?.attributes || d?.cover || null;
      const coverUrl = imgUrl(coverAttr, 'thumbnail') || imgUrl(coverAttr) || null;
      return { ...d, coverUrl: coverUrl || null };
    });

    const sorted = sortListSafe(cooked);
    setDocItemsToSession(docChapterSlug, sorted);
    setDocItems(sorted);
    return sorted;
  }

  async function loadDocSectionsForChapter(chapterSlugToLoad) {
    if (!chapterSlugToLoad) return {};

    const cached = getDocSectionsByChapterFromSession(chapterSlugToLoad);
    if (cached && typeof cached === 'object') {
      const nextMap = {};
      for (const [k, v] of Object.entries(cached)) nextMap[k] = sortListSafe(v);
      return nextMap;
    }

    const res = await strapiFetch(DOCS_ENDPOINT, {
      params: {
        locale: 'all',
        publicationState: pubState,
        filters: {
          level: { $eq: 'section' },
          parent: { parent: { slug: { $eq: chapterSlugToLoad } } },
        },
        fields: ['title', 'slug', 'level', 'excerpt', 'updatedAt', 'order'],
        populate: {
          cover: { fields: ['url', 'formats'] },
          parent: { fields: ['slug'] },
        },
        sort: ['order:asc', 'title:asc'],
        pagination: { page: 1, pageSize: 1200 },
      },
    });

    const rows = Array.isArray(res?.data) ? res.data : [];
    const normalized = rows.map(normalizeEntity).filter(Boolean).filter((it) => it.slug);

    const map = {};
    for (const s of normalized) {
      const parentSlug = getParentSlugSafe(s);
      if (!parentSlug) continue;

      const coverAttr = s?.cover?.data?.attributes || s?.cover || null;
      const coverUrl = imgUrl(coverAttr, 'medium') || imgUrl(coverAttr, 'thumbnail') || imgUrl(coverAttr) || null;

      const cooked = { ...s, coverUrl: coverUrl || null };
      if (!map[parentSlug]) map[parentSlug] = [];
      map[parentSlug].push(cooked);
    }

    const sortedMap = {};
    for (const [k, v] of Object.entries(map)) sortedMap[k] = sortListSafe(v);

    setDocSectionsByChapterToSession(chapterSlugToLoad, sortedMap);
    return sortedMap;
  }

  // ---- boot cases list (cases mode) ----
  useEffect(() => {
    if (mode !== 'cases') return;

    let booted = false;

    if (Array.isArray(prefetchRelated) && currentType) {
      const list = prefetchRelated.filter((it) => it?.type === currentType && it?.slug).sort(compareBySlugNumberAsc);
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

    setLoadingList(!booted);
    setErrList('');
  }, [mode, prefetchRelated, currentType]);

  // ---- boot pathologies list (presentation mode) ----
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

    setLoadingList(!booted);
    setErrList('');
  }, [mode]);

  // ---- boot docs (fast paint) ----
  useEffect(() => {
    if (mode !== 'docs') return;
    if (!docChapterSlug) return;

    setErrList('');

    const cachedItemsRaw = getDocItemsFromSession(docChapterSlug) || [];
    const cachedMap = getDocSectionsByChapterFromSession(docChapterSlug);

    if (cachedMap && typeof cachedMap === 'object') {
      const nextMap = {};
      for (const [k, v] of Object.entries(cachedMap)) nextMap[k] = sortListSafe(v);
      setDocSectionsByItem((prev) => ({ ...prev, ...nextMap }));
    }

    if (cachedItemsRaw.length) {
      const cachedItems = sortListSafe(cachedItemsRaw).map((it) => {
        const hasFromMap = Array.isArray(cachedMap?.[it.slug]) && cachedMap[it.slug].length > 0;
        return { ...it, __hasSections: Boolean(hasFromMap) };
      });
      setDocItems(cachedItems);
    } else {
      setDocItems([]);
    }

    if (docItemSlug) {
      const cachedSecs = getDocSectionsForItemFromSession(docItemSlug);
      if (cachedSecs && Array.isArray(cachedSecs) && typeof setCurrentDocSections === 'function') {
        setCurrentDocSections(sortListSafe(cachedSecs));
      }
    }

    setLoadingList(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, docChapterSlug, docItemSlug]);

  // ---- load sidebar lists (always refresh) ----
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
            publicationState: pubState,
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
        if (!ignore) setLoadingList(false);
      }
    }

    async function loadPathologies() {
      setErrList('');

      try {
        const res = await strapiFetch(PATHO_ENDPOINT, {
          params: {
            locale: 'all',
            publicationState: pubState,
            fields: ['title', 'slug', 'excerpt'],
            populate: { cases: { fields: ['title', 'slug', 'type'], sort: ['slug:asc'] } },
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

    async function loadDocs() {
      if (!docChapterSlug) {
        setDocItems([]);
        setLoadingList(false);
        setErrList('');
        return;
      }

      setErrList('');

      try {
        const items = await loadDocItems();
        const chapterMap = await loadDocSectionsForChapter(docChapterSlug);

        if (ignore) return;

        setDocSectionsByItem((prev) => ({ ...prev, ...chapterMap }));

        const fresh = sortListSafe(items).map((it) => ({
          ...it,
          __hasSections: Array.isArray(chapterMap?.[it.slug]) && chapterMap[it.slug].length > 0,
        }));

        setDocItems((prev) => {
          const prevBySlug = new Map((Array.isArray(prev) ? prev : []).map((x) => [x.slug, x]));
          return fresh.map((it) => {
            const old = prevBySlug.get(it.slug);
            const keepTrue = Boolean(old?.__hasSections);
            return { ...it, __hasSections: keepTrue || Boolean(it.__hasSections) };
          });
        });

        if (docItemSlug) {
          const secs = chapterMap?.[docItemSlug] || [];
          const sortedSecs = sortListSafe(secs);
          if (typeof setCurrentDocSections === 'function') setCurrentDocSections(sortedSecs);
          if (Array.isArray(sortedSecs)) setDocSectionsForItemToSession(docItemSlug, sortedSecs);
        }
      } catch (e) {
        if (!ignore) setErrList(e?.message || 'Erreur de chargement');
      } finally {
        if (!ignore) setLoadingList(false);
      }
    }

    const hasListNow =
      mode === 'cases'
        ? Array.isArray(caseListRef.current) && caseListRef.current.length > 0
        : mode === 'presentation'
          ? Array.isArray(pathoListRef.current) && pathoListRef.current.length > 0
          : Array.isArray(docItemsRef.current) && docItemsRef.current.length > 0;

    if (!hasListNow) setLoadingList(true);

    if (mode === 'presentation') loadPathologies();
    else if (mode === 'docs') loadDocs();
    else loadCases();

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentType, docChapterSlug, docItemSlug, pubState]);

  const label =
    mode === 'presentation'
      ? 'Atlas'
      : mode === 'docs'
        ? 'Items'
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
      className={['cd-side', collapsed ? 'is-collapsed' : '', collapsed && collapseDone ? 'is-collapse-done' : ''].join(
        ' '
      )}
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
                <NavLink className="cd-side-link" to="/atlas" onClick={closeMobile}>
                  Atlas
                </NavLink>
              </li>

              <li>
                <NavLink className="cd-side-link" to="/qr-quiz" onClick={closeMobile}>
                  Q/R &amp; Quiz
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

            {loadingList && !hasList && <div className="cd-side-state">Chargement…</div>}
            {errList && !loadingList && <div className="cd-side-state error">{errList}</div>}

            {/* DOCS */}
            {!errList && mode === 'docs' && docSubjectSlug && docChapterSlug && (
              <ul className="cd-side-list">
                {docItems.map((it) => {
                  const isInItem = it.slug === docItemSlug;
                  const isOpen = expandedDocItemSlug === it.slug;

                  const knownSections =
                    it.slug === docItemSlug
                      ? Array.isArray(currentDocSections)
                        ? sortListSafe(currentDocSections)
                        : []
                      : docSectionsByItem[it.slug] || [];

                  const hasKids = (Array.isArray(knownSections) && knownSections.length > 0) || Boolean(it.__hasSections);

                  const isCurrentItemPage = it.slug === docItemSlug && !docSectionSlug;
                  const isInChild = it.slug === docItemSlug && Boolean(docSectionSlug);

                  const toggle = () => {
                    if (!hasKids) return;
                    setExpandedDocItemSlug((prev) => {
                      const next = prev === it.slug ? '' : it.slug;
                      saveExpandedDocItem(next);
                      return next;
                    });
                  };

                  const itemTo = buildPath(docBasePath, [docSubjectSlug, docChapterSlug, it.slug]);

                  return (
                    <li key={it.slug}>
                      <div
                        className={[
                          'cd-side-row',
                          hasKids ? 'has-kids' : '',
                          isInItem ? 'is-active' : '',
                          isInChild ? 'has-active-child' : '',
                        ].join(' ')}
                      >
                        {isCurrentItemPage ? (
                          <span className="cd-side-link active cd-is-current" aria-current="page">
                            <span className="cd-side-link-text">{it.title || it.slug}</span>
                          </span>
                        ) : (
                          <Link
                            className="cd-side-link"
                            to={itemTo}
                            state={{ prefetch: { slug: it.slug, title: it.title || it.slug, type: 'doc' } }}
                            onClick={() => {
                              if (hasKids) {
                                setExpandedDocItemSlug(() => {
                                  saveExpandedDocItem(it.slug);
                                  return it.slug;
                                });
                              }
                              if (isNarrow) closeMobile();
                            }}
                          >
                            <span className="cd-side-link-text">{it.title || it.slug}</span>
                          </Link>
                        )}

                        {hasKids ? (
                          <button
                            type="button"
                            className="cd-side-caret"
                            aria-label={isOpen ? 'Réduire' : 'Développer'}
                            aria-expanded={isOpen ? 'true' : 'false'}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggle();
                            }}
                          />
                        ) : null}
                      </div>

                      {hasKids && (
                        <div className={['cd-side-sublist', isOpen ? 'is-open' : ''].join(' ')}>
                          <div className="cd-side-sublist-inner">
                            <div className="cd-side-children">
                              {knownSections.map((s) => {
                                const isCurrentSection = it.slug === docItemSlug && s.slug === docSectionSlug;
                                const to = buildPath(docBasePath, [docSubjectSlug, docChapterSlug, it.slug, s.slug]);

                                return (
                                  <div key={s.slug} className="cd-side-child">
                                    {isCurrentSection ? (
                                      <span
                                        className="cd-side-link cd-side-child-link active cd-is-current"
                                        aria-current="page"
                                      >
                                        <span className="cd-side-link-text">{s.title || s.slug}</span>
                                      </span>
                                    ) : (
                                      <Link
                                        className="cd-side-link cd-side-child-link"
                                        to={to}
                                        state={{ prefetch: { slug: s.slug, title: s.title || s.slug, type: 'doc' } }}
                                        onClick={() => {
                                          if (isNarrow) closeMobile();
                                        }}
                                      >
                                        <span className="cd-side-link-text">{s.title || s.slug}</span>
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

            {/* CASES (qa/quiz) */}
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
                          to={`/qr-quiz/cas/${it.slug}`}
                          state={{
                            prefetch: { slug: it.slug, title: it.title || it.slug, type: it.type || currentType || null },
                            breadcrumb: { mode: 'qr-quiz', case: { slug: it.slug, title: it.title || it.slug } },
                          }}
                          onClick={() => {
                            if (isNarrow) closeMobile();
                          }}
                          onMouseEnter={() => prefetchIntent('case', it.slug)}
                          onFocus={() => prefetchIntent('case', it.slug)}
                          onPointerDown={() => prefetchIntent('case', it.slug)}
                        >
                          <span className="cd-side-link-text">{it.title || it.slug}</span>
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* PRESENTATION (atlas) */}
            {!errList && mode === 'presentation' && (
              <ul className="cd-side-list">
                {pathoList.map((p) => {
                  const isCurrentPatho = p.slug === currentPathologySlug && !currentCaseSlug;

                  const kids = Array.isArray(p._children) ? p._children : [];
                  const hasKids = kids.length > 0;
                  const isOpen = hasKids && expandedPathoSlug === p.slug;

                  const isInChild = p.slug === currentPathologySlug && Boolean(currentCaseSlug);

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
                        className={[
                          'cd-side-row',
                          hasKids ? 'has-kids' : '',
                          p.slug === currentPathologySlug ? 'is-active' : '',
                          isInChild ? 'has-active-child' : '',
                        ].join(' ')}
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
                            to={`/atlas/${p.slug}`}
                            state={{
                              breadcrumb: {
                                mode: 'atlas',
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
                            onPointerDown={() => prefetchIntent('pathology', p.slug)}
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
                                      <span
                                        className="cd-side-link cd-side-child-link active cd-is-current"
                                        aria-current="page"
                                      >
                                        <span className="cd-side-link-text">{ch.title || ch.slug}</span>
                                      </span>
                                    ) : (
                                      <Link
                                        className="cd-side-link cd-side-child-link"
                                        to={`/atlas/${p.slug}/${ch.slug}`}
                                        state={{
                                          breadcrumb: {
                                            mode: 'atlas',
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
                                        onPointerDown={() => prefetchIntent('case', ch.slug)}
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
