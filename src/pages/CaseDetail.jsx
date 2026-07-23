// src/pages/CaseDetail.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, NavLink, useLocation } from 'react-router-dom';

import PageTitle from '../components/PageTitle';
import Breadcrumbs from '../components/Breadcrumbs';
import QuizBlock from '../components/QuizBlock';
import CaseMarkdown from '../components/CaseMarkdown';
import CaseDetailOutline, { useCaseDetailOutline } from '../components/CaseDetailOutline';

import { strapiFetch, imgUrl, isAbortError } from '../lib/strapi';
import { getCaseFromCache, setCaseToCache, deleteCaseFromCache, prefetchCase } from '../lib/caseCache';
import {
  getPathologyFromCache,
  setPathologyToCache,
  deletePathologyFromCache,
  prefetchPathology,
} from '../lib/pathologyCache';

import { BottomExpandIcon, BottomCollapseIcon } from '../components/Icons';
import { useCaseDetailSidebar } from '../ui/CaseDetailSidebarContext';

import './CaseDetail.css';
import '../styles/AssociatedCasesList.css';

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const PATHO_ENDPOINT = import.meta.env.VITE_PATHO_ENDPOINT || '/pathologies';
const DOCS_ENDPOINT = import.meta.env.VITE_DOCS_ENDPOINT || '/doc-nodes';
const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';
const DOCS_DEFAULT_SUBJECT_SLUG = import.meta.env.VITE_DOCS_DEFAULT_SUBJECT_SLUG || 'moco';
const DOCS_DEFAULT_CHAPTER_SLUG = import.meta.env.VITE_DOCS_DEFAULT_CHAPTER_SLUG || 'medecine-orale';

const LS_KEY_COLLAPSE = 'cd-sidebar-collapsed';
const LS_KEY_SIDEBAR_VIEW = 'cd-sidebar-view';
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
  if (typeKey === 'presentation') return 'Présentation';
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
function normalizeRelationEntity(rel) {
  if (!rel) return null;
  if (rel?.data) return normalizeEntity(rel.data);
  return normalizeEntity(rel);
}

/** Badge helpers (pathologies.badges) */
function pickPrimaryBadge(badgesRel) {
  const list = normalizeRelationArray(badgesRel);
  const first = list.find((b) => b && (b.label || b.variant));
  if (!first?.label) return null;
  return { text: first.label, variant: first.variant || 'info' };
}
function ensureBadge(b) {
  if (!b || typeof b !== 'object') return null;
  const text = typeof b.text === 'string' ? b.text : typeof b.label === 'string' ? b.label : '';
  if (!text) return null;
  const variant = typeof b.variant === 'string' ? b.variant : 'info';
  return { text, variant };
}
function normalizeBadgesList(badgesRel) {
  const list = normalizeRelationArray(badgesRel)
    .map(ensureBadge)
    .filter(Boolean);

  return list.length ? list : [];
}
function firstBadgeFromList(list) {
  return Array.isArray(list) && list.length ? list[0] : null;
}

/** Autres appellations des pathologies Atlas */
function normalizeAliasesList(aliasesRel, pathologyTitle = '') {
  const titleKey = String(pathologyTitle || '').trim().toLocaleLowerCase('fr');
  const seen = new Set();

  return normalizeRelationArray(aliasesRel)
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (!entry || typeof entry !== 'object') return '';

      const value = entry.name ?? entry.alias ?? entry.title ?? entry.label ?? entry.value ?? entry.text;
      return typeof value === 'string' ? value.trim() : '';
    })
    .filter((name) => {
      if (!name) return false;
      const key = name.toLocaleLowerCase('fr');
      if (key === titleKey || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Galerie structurée des pathologies Atlas */
function normalizeGalleryList(galleryRel, pathologyTitle = '') {
  return normalizeRelationArray(galleryRel)
    .map((entry, index) => {
      const image = normalizeRelationEntity(entry?.image);
      if (!image) return null;

      // imgUrl() utilise "thumbnail" par défaut : demander explicitement
      // un format inexistant permet de retomber sur media.url, donc l’original.
      const fullImageUrl = imgUrl(image, 'original') || null;
      const imageUrl = imgUrl(image, 'large') || imgUrl(image, 'medium') || fullImageUrl;
      if (!imageUrl) return null;

      const fallbackAlt = pathologyTitle
        ? `${pathologyTitle} — image ${index + 1}`
        : `Image ${index + 1}`;

      return {
        ...entry,
        image,
        imageUrl,
        fullImageUrl,
        alt: entry?.alt || image?.alternativeText || entry?.title || fallbackAlt,
        title: typeof entry?.title === 'string' ? entry.title.trim() : '',
        caption: typeof entry?.caption === 'string' ? entry.caption.trim() : '',
        credit: typeof entry?.credit === 'string' ? entry.credit.trim() : '',
        sourceUrl: typeof entry?.sourceUrl === 'string' ? entry.sourceUrl.trim() : '',
      };
    })
    .filter(Boolean);
}

/* ===== Session cache helpers ===== */
const SESSION_CACHE_VERSION = 2;
const DOC_LIST_STALE_MS = 60_000;
const SESSION_MAX_AGE_MS = 30 * 60_000;
const SIDEBAR_LIST_STALE_MS = 45_000;
const SIDEBAR_LIST_MAX_AGE_MS = 10 * 60_000;

function readSessionEntry(key, { maxAgeMs = SESSION_MAX_AGE_MS } = {}) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const isEnvelope = parsed?.__cacheVersion === SESSION_CACHE_VERSION && 'data' in parsed;
    const data = isEnvelope ? parsed.data : parsed;
    const fetchedAt = isEnvelope ? Number(parsed.fetchedAt) || 0 : 0;

    if (fetchedAt && Date.now() - fetchedAt > maxAgeMs) {
      sessionStorage.removeItem(key);
      return null;
    }
    return { data, fetchedAt };
  } catch {
    return null;
  }
}

function writeSessionEntry(key, data) {
  if (!key || data === undefined || data === null) return;
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ __cacheVersion: SESSION_CACHE_VERSION, fetchedAt: Date.now(), data })
    );
  } catch {}
}

function isSessionEntryFresh(key, staleMs, maxAgeMs = SESSION_MAX_AGE_MS) {
  const entry = readSessionEntry(key, { maxAgeMs });
  return Boolean(entry?.fetchedAt && Date.now() - entry.fetchedAt <= staleMs);
}

function removeSessionEntry(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}

function docNodeKey(slug) {
  return `docnode:${PUB_STATE}:${slug}`;
}
function docItemsKey(chapterSlug) {
  return `doc-items:${PUB_STATE}:${chapterSlug}`;
}
function docSectionsKey(itemSlug) {
  return `doc-sections:${PUB_STATE}:${itemSlug}`;
}
function docSectionsByChapterKey(chapterSlug) {
  return `doc-sectionsByChapter:${PUB_STATE}:${chapterSlug}`;
}
function sidebarListKey(name) {
  return `cd-list:v${SESSION_CACHE_VERSION}:${PUB_STATE}:${name}`;
}

function getDocNodeFromSession(slug) {
  if (!slug) return null;
  return readSessionEntry(docNodeKey(slug))?.data || null;
}
function setDocNodeToSession(slug, data) {
  if (slug && data) writeSessionEntry(docNodeKey(slug), data);
}
function removeDocNodeFromSession(slug) {
  if (slug) removeSessionEntry(docNodeKey(slug));
}
function getDocItemsFromSession(chapterSlug) {
  if (!chapterSlug) return null;
  const data = readSessionEntry(docItemsKey(chapterSlug))?.data;
  return Array.isArray(data) ? data : null;
}
function isDocItemsSessionFresh(chapterSlug) {
  return Boolean(chapterSlug && isSessionEntryFresh(docItemsKey(chapterSlug), DOC_LIST_STALE_MS));
}
function setDocItemsToSession(chapterSlug, list) {
  if (chapterSlug && Array.isArray(list)) writeSessionEntry(docItemsKey(chapterSlug), list);
}
function getDocSectionsForItemFromSession(itemSlug) {
  if (!itemSlug) return null;
  const data = readSessionEntry(docSectionsKey(itemSlug))?.data;
  return Array.isArray(data) ? data : null;
}
function isDocSectionsSessionFresh(itemSlug) {
  return Boolean(itemSlug && isSessionEntryFresh(docSectionsKey(itemSlug), DOC_LIST_STALE_MS));
}
function setDocSectionsForItemToSession(itemSlug, list) {
  if (itemSlug && Array.isArray(list)) writeSessionEntry(docSectionsKey(itemSlug), list);
}
function getDocSectionsByChapterFromSession(chapterSlug) {
  if (!chapterSlug) return null;
  const data = readSessionEntry(docSectionsByChapterKey(chapterSlug))?.data;
  return data && typeof data === 'object' ? data : null;
}
function isDocSectionsByChapterSessionFresh(chapterSlug) {
  return Boolean(chapterSlug && isSessionEntryFresh(docSectionsByChapterKey(chapterSlug), DOC_LIST_STALE_MS));
}
function setDocSectionsByChapterToSession(chapterSlug, map) {
  if (chapterSlug && map) writeSessionEntry(docSectionsByChapterKey(chapterSlug), map);
}
function getSidebarListFromSession(name) {
  const data = readSessionEntry(sidebarListKey(name), { maxAgeMs: SIDEBAR_LIST_MAX_AGE_MS })?.data;
  return Array.isArray(data) ? data : null;
}
function isSidebarListFresh(name) {
  return isSessionEntryFresh(sidebarListKey(name), SIDEBAR_LIST_STALE_MS, SIDEBAR_LIST_MAX_AGE_MS);
}
function setSidebarListToSession(name, list) {
  if (Array.isArray(list)) writeSessionEntry(sidebarListKey(name), list);
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

function isDefaultDocsChapter(subjectSlug, chapterSlug) {
  return subjectSlug === DOCS_DEFAULT_SUBJECT_SLUG && chapterSlug === DOCS_DEFAULT_CHAPTER_SLUG;
}

function buildDocPublicPath(
  basePath,
  { subjectSlug, chapterSlug, itemSlug = null, sectionSlug = null }
) {
  const segments = isDefaultDocsChapter(subjectSlug, chapterSlug)
    ? [chapterSlug, itemSlug, sectionSlug]
    : [subjectSlug, chapterSlug, itemSlug, sectionSlug];

  return buildPath(basePath, segments);
}

function hasMeaningfulContentLike(obj) {
  if (!obj) return false;
  if (typeof obj?.content === 'string' && obj.content.trim().length > 0) return true;
  if (typeof obj?.excerpt === 'string' && obj.excerpt.trim().length > 0) return true;
  if (Array.isArray(obj?.qa_blocks) && obj.qa_blocks.length) return true;
  if (Array.isArray(obj?.quiz_blocks) && obj.quiz_blocks.length) return true;
  if (Array.isArray(obj?.gallery) && obj.gallery.length) return true;
  if (typeof obj?.credits === 'string' && obj.credits.trim().length > 0) return true;
  if (typeof obj?.references === 'string' && obj.references.trim().length > 0) return true;
  if (typeof obj?.copyright === 'string' && obj.copyright.trim().length > 0) return true;
  return false;
}

function getCreditsMarkdown(item) {
  if (!item) return '';

  const credits = typeof item?.credits === 'string' ? item.credits.trim() : '';
  if (credits) return credits;

  const references = typeof item?.references === 'string' ? item.references.trim() : '';
  const copyright = typeof item?.copyright === 'string' ? item.copyright.trim() : '';

  if (!references && !copyright) return '';

  return [references, copyright].filter(Boolean).join('\n\n');
}

function mergeCreditsMarkdown(...items) {
  const seen = new Set();
  const blocks = [];

  items.forEach((creditItem) => {
    const markdown = getCreditsMarkdown(creditItem);
    if (!markdown) return;

    const dedupeKey = markdown.replace(/\s+/g, ' ').trim();
    if (seen.has(dedupeKey)) return;

    seen.add(dedupeKey);
    blocks.push(markdown);
  });

  return blocks.join('\n\n');
}

/* =========================
   Icône des cas cliniques associés
   ========================= */
function AssociatedCaseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6.5 3.5h7.2L18 7.8V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M13.5 3.8V8h4.2" />
      <path d="M11.5 11v6" />
      <path d="M8.5 14h6" />
    </svg>
  );
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
  const [refreshToken, setRefreshToken] = useState(0);
  const lastVisibilityRefreshRef = useRef(Date.now());

  // Quand on revient du back-office Strapi (autre onglet), revalide la fiche.
  useEffect(() => {
    const requestRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastVisibilityRefreshRef.current < 10_000) return;
      lastVisibilityRefreshRef.current = now;
      setRefreshToken((v) => v + 1);
    };

    window.addEventListener('focus', requestRefresh);
    document.addEventListener('visibilitychange', requestRefresh);
    return () => {
      window.removeEventListener('focus', requestRefresh);
      document.removeEventListener('visibilitychange', requestRefresh);
    };
  }, []);

  // item = dernier résultat (cache/provisional/fetch) pour le slug attendu
  const [item, setItem] = useState(() => {
    const key = expectedSlug;
    if (!key) return null;

    if (isDocNamespace) return getDocNodeFromSession(key) || (hasMeaningfulContentLike(provisional) ? provisional : null);
    if (isPathologyPage)
      return getPathologyFromCache(key, { publicationState: PUB_STATE }) || (hasMeaningfulContentLike(provisional) ? provisional : null);
    return getCaseFromCache(key, { publicationState: PUB_STATE }) || (hasMeaningfulContentLike(provisional) ? provisional : null);
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
    return getPathologyFromCache(pathologySlug, { publicationState: PUB_STATE }) || null;
  });

  // stableType seulement pour les cas classiques (affichage)
  const [stableType, setStableType] = useState(() => {
    if (!isPlainCase) return null;
    return getCaseFromCache(caseSlug, { publicationState: PUB_STATE })?.type || provisional?.type || null;
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
  async function loadCaseBySlug(slugToLoad, { signal } = {}) {
    const loadOnce = ({ withQa, withQuiz }) =>
      strapiFetch(CASES_ENDPOINT, {
        params: {
          filters: { slug: { $eq: slugToLoad } },
          locale: 'all',
          publicationState: PUB_STATE,
          populate: {
            cover: { fields: ['url', 'formats', 'alternativeText', 'name'] },
            ...(withQa ? { qa_blocks: { populate: '*' } } : {}),
            ...(withQuiz ? { quiz_blocks: { populate: { propositions: true } } } : {}),
          },
          fields: ['title', 'slug', 'type', 'excerpt', 'content', 'updatedAt', 'credits', 'references', 'copyright'],
          pagination: { page: 1, pageSize: 1 },
        },
        options: signal ? { signal } : undefined,
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
    const coverFullUrl = imgUrl(coverAttr, 'original') || null;
    const coverUrl = imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || coverFullUrl;
    const coverAlt = coverAttr?.alternativeText || attrs?.title || coverAttr?.name || '';

    return {
      ...attrs,
      coverUrl: coverUrl || null,
      coverFullUrl: coverFullUrl || coverUrl || null,
      coverAlt,
    };
  }

  async function loadPathologyBySlug(slugToLoad, { withCases = true, signal } = {}) {
    const loadOnce = ({ withQa, withQuiz, withCases: withCasesInner, withGallery, withAliases }) =>
      strapiFetch(PATHO_ENDPOINT, {
        params: {
          filters: { slug: { $eq: slugToLoad } },
          locale: 'all',
          publicationState: PUB_STATE,
          populate: {
            cover: { fields: ['url', 'formats', 'alternativeText', 'name'] },
            badges: { fields: ['label', 'variant'] }, // ✅ badges
            ...(withAliases ? { aliases: { fields: ['name'] } } : {}),
            ...(withGallery
              ? {
                  gallery: {
                    fields: ['alt', 'caption', 'credit', 'sourceUrl', 'title'],
                    populate: {
                      image: {
                        fields: ['url', 'formats', 'alternativeText', 'caption', 'name'],
                      },
                    },
                  },
                }
              : {}),
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
          fields: ['title', 'slug', 'excerpt', 'content', 'updatedAt', 'credits', 'references', 'copyright'],
          pagination: { page: 1, pageSize: 1 },
        },
        options: signal ? { signal } : undefined,
      });

    let res;
    try {
      res = await loadOnce({ withQa: true, withQuiz: true, withCases, withGallery: true, withAliases: true });
    } catch (err) {
      const msg = err?.message || '';
      const qaInvalid = /Invalid key qa_blocks/i.test(msg);
      const quizInvalid = /Invalid key quiz_blocks/i.test(msg);
      const casesInvalid = /Invalid key cases/i.test(msg);
      const galleryInvalid = /Invalid key gallery/i.test(msg);
      const aliasesInvalid = /Invalid key aliases/i.test(msg);

      if (qaInvalid || quizInvalid || casesInvalid || galleryInvalid || aliasesInvalid) {
        res = await loadOnce({
          withQa: !qaInvalid,
          withQuiz: !quizInvalid,
          withCases: withCases && !casesInvalid,
          withGallery: !galleryInvalid,
          withAliases: !aliasesInvalid,
        });
      } else {
        throw err;
      }
    }

    const node = Array.isArray(res?.data) ? res.data[0] : null;
    const attrs = normalizeEntity(node);
    if (!attrs) return null;

    const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
    const coverFullUrl = imgUrl(coverAttr, 'original') || null;
    const coverUrl = imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || coverFullUrl;
    const coverAlt = coverAttr?.alternativeText || attrs?.title || coverAttr?.name || '';

    const rel = normalizeRelationArray(attrs?.cases).map((c) => {
      const cCoverAttr = c?.cover?.data?.attributes || c?.cover || null;
      const cCoverUrl = imgUrl(cCoverAttr, 'medium') || imgUrl(cCoverAttr, 'thumbnail') || imgUrl(cCoverAttr) || null;
      return { ...c, coverUrl: cCoverUrl || null };
    });

    const gallery = normalizeGalleryList(attrs?.gallery, attrs?.title || slugToLoad);
    const aliases = normalizeAliasesList(attrs?.aliases, attrs?.title || slugToLoad);

    return {
      ...attrs,
      coverUrl: coverUrl || null,
      coverFullUrl: coverFullUrl || coverUrl || null,
      coverAlt,
      cases: rel,
      gallery,
      aliases,
    };
  }

  async function loadDocNodeBySlug(slugToLoad, { signal } = {}) {
    const res = await strapiFetch(DOCS_ENDPOINT, {
      params: {
        filters: { slug: { $eq: slugToLoad } },
        locale: 'all',
        publicationState: PUB_STATE,
        populate: {
          cover: { fields: ['url', 'formats', 'alternativeText', 'name'] },
          parent: {
            fields: ['title', 'slug', 'level', 'credits', 'references', 'copyright'],
            populate: {
              parent: {
                fields: ['title', 'slug', 'level'],
                populate: {
                  parent: { fields: ['title', 'slug', 'level'] },
                },
              },
            },
          },
        },
        fields: ['title', 'slug', 'level', 'excerpt', 'content', 'updatedAt', 'credits', 'references', 'copyright', 'sectionsHeading'],
        pagination: { page: 1, pageSize: 1 },
      },
      options: signal ? { signal } : undefined,
    });

    const node = Array.isArray(res?.data) ? res.data[0] : null;
    const attrs = normalizeEntity(node);
    if (!attrs) return null;

    const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
    const coverFullUrl = imgUrl(coverAttr, 'original') || null;
    const coverUrl = imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || coverFullUrl;
    const coverAlt = coverAttr?.alternativeText || attrs?.title || coverAttr?.name || '';

    return {
      ...attrs,
      coverUrl: coverUrl || null,
      coverFullUrl: coverFullUrl || coverUrl || null,
      coverAlt,
    };
  }

  async function loadDocSectionsForItem(itemSlugToLoad, { signal, force = false } = {}) {
    if (!itemSlugToLoad) return [];

    const cached = getDocSectionsForItemFromSession(itemSlugToLoad);
    if (!force && cached && isDocSectionsSessionFresh(itemSlugToLoad)) return sortListSafe(cached);

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
      options: signal ? { signal } : undefined,
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

  // ---------- main load : affichage instantané + revalidation annulable ----------
  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();

    const slugToLoad = expectedSlug;
    if (!slugToLoad) {
      setItem(null);
      setDisplayItem(null);
      setError('Slug manquant.');
      setLoading(false);
      setIsReplacing(false);
      return () => controller.abort();
    }

    setError('');

    const cached = isDocNamespace
      ? getDocNodeFromSession(slugToLoad)
      : isPathologyPage
        ? getPathologyFromCache(slugToLoad, { publicationState: PUB_STATE })
        : getCaseFromCache(slugToLoad, { publicationState: PUB_STATE });

    // Paint instantané depuis le cache, mais une requête réseau reste lancée.
    if (cached?.slug === slugToLoad) {
      setItem(cached);
      setDisplayItem(cached);
      setIsReplacing(false);
      setLoading(false);
    } else {
      setItem(provisional?.slug === slugToLoad && hasMeaningfulContentLike(provisional) ? provisional : null);
      setLoading(true);
    }

    const markMissing = (message) => {
      if (isDocNamespace) {
        removeDocNodeFromSession(slugToLoad);
        if (docItemSlug) {
          removeSessionEntry(docSectionsKey(docItemSlug));
          setDocCurrentItemSections([]);
        }
      } else if (isPathologyPage) {
        deletePathologyFromCache(slugToLoad, { publicationState: PUB_STATE });
        setParentPathology(null);
      } else {
        deleteCaseFromCache(slugToLoad, { publicationState: PUB_STATE });
      }

      setItem(null);
      setDisplayItem(null);
      setIsReplacing(false);
      setError(message);
    };

    async function load() {
      try {
        if (isDocNamespace) {
          const fullDoc = await loadDocNodeBySlug(slugToLoad, { signal: controller.signal });
          if (ignore) return;
          if (!fullDoc) {
            markMissing('Document introuvable ou non publié.');
            return;
          }

          setItem(fullDoc);
          setDocNodeToSession(slugToLoad, fullDoc);

          if (isDocItemPage && docItemSlug) {
            const secs = await loadDocSectionsForItem(docItemSlug, { signal: controller.signal, force: true });
            if (!ignore) setDocCurrentItemSections(secs);
          }
          return;
        }

        if (isPathologyPage) {
          const fullPatho = await loadPathologyBySlug(pathologySlug, {
            withCases: true,
            signal: controller.signal,
          });
          if (ignore) return;
          if (!fullPatho) {
            markMissing('Pathologie introuvable ou non publiée.');
            return;
          }

          setItem(fullPatho);
          setPathologyToCache(pathologySlug, fullPatho, { publicationState: PUB_STATE });
          return;
        }

        if (isCaseInPathology) {
          const parentPromise = pathologySlug
            ? prefetchPathology(pathologySlug, { publicationState: PUB_STATE }).catch(() => null)
            : Promise.resolve(null);

          const fullCase = await loadCaseBySlug(caseSlug, { signal: controller.signal });
          if (ignore) return;
          if (!fullCase) {
            markMissing('Cas introuvable ou non publié.');
            return;
          }

          // Le cas s'affiche sans attendre le chargement de la pathologie parente.
          setItem(fullCase);
          setCaseToCache(caseSlug, fullCase, { publicationState: PUB_STATE });

          parentPromise.then((parent) => {
            if (ignore) return;
            if (parent) setParentPathology(parent);
            else if (pathologySlug) {
              const fromCache = getPathologyFromCache(pathologySlug, { publicationState: PUB_STATE });
              if (fromCache) setParentPathology(fromCache);
            }
          });
          return;
        }

        const full = await loadCaseBySlug(caseSlug, { signal: controller.signal });
        if (ignore) return;
        if (!full) {
          markMissing('Cas introuvable ou non publié.');
          return;
        }

        setItem(full);
        setCaseToCache(caseSlug, full, { publicationState: PUB_STATE });
      } catch (e) {
        if (!ignore && !isAbortError(e)) setError(e?.message || 'Erreur de chargement');
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    expectedSlug,
    refreshToken,
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
    if (effectiveType === 'presentation') return 'Présentation';
    if (effectiveType === 'doc') return 'Documentation';
    return 'Cas clinique';
  }, [effectiveType]);

  const qaList = !isDocNamespace && Array.isArray(displayItem?.qa_blocks) ? displayItem.qa_blocks : [];
  const quizList = !isDocNamespace && Array.isArray(displayItem?.quiz_blocks) ? displayItem.quiz_blocks : [];

  const pathologyGallery = useMemo(() => {
    if (!isPathologyPage) return [];
    return Array.isArray(displayItem?.gallery) ? displayItem.gallery : [];
  }, [isPathologyPage, displayItem?.gallery]);

  const pathologyAliases = useMemo(() => {
    if (!isPathologyPage) return [];
    return normalizeAliasesList(displayItem?.aliases, displayItem?.title || displayItem?.slug || '');
  }, [isPathologyPage, displayItem?.aliases, displayItem?.title, displayItem?.slug]);

  const relatedCases = useMemo(() => {
    if (!isPathologyPage) return [];
    return Array.isArray(displayItem?.cases) ? displayItem.cases : [];
  }, [isPathologyPage, displayItem?.cases]);

  const visibleRelatedCases = useMemo(() => {
    if (!isPathologyPage) return [];
    const arr = Array.isArray(relatedCases) ? [...relatedCases] : [];
    arr.sort(compareBySlugNumberAsc);
    return arr;
  }, [isPathologyPage, relatedCases]);

  // ---------- breadcrumb / titres ----------
  const cdIndex = useMemo(() => safeGetSessionJson('cd-patho-index'), []);
  const indexPatho = cdIndex?.pathoIndex || {};
  const indexCase = cdIndex?.caseIndex || {};

  // ✅ badges instantanés (évite le flash "Atlas" quand on a déjà l’info via state/index/cache)
  const instantBadges = useMemo(() => {
    if (!isPresentationNamespace) return [];

    const sources = [
      // Les données fraîchement revalidées doivent primer sur les index de navigation.
      parentPathology?.badges,
      displayItem?.badges,
      navCrumb?.pathology?.badges,
      indexPatho?.[pathologySlug]?.badges,
      indexCase?.[caseSlug]?.pathologyBadges,
      provisional?.badges,
    ];

    for (const source of sources) {
      const list = normalizeBadgesList(source);
      if (list.length) return list;
    }

    const singleSources = [
      pickPrimaryBadge(parentPathology?.badges),
      pickPrimaryBadge(displayItem?.badges),
      navCrumb?.pathology?.badge,
      indexPatho?.[pathologySlug]?.badge,
      indexCase?.[caseSlug]?.pathologyBadge,
    ];

    for (const source of singleSources) {
      const badge = ensureBadge(source);
      if (badge) return [badge];
    }

    return [];
  }, [
    isPresentationNamespace,
    navCrumb,
    indexPatho,
    indexCase,
    pathologySlug,
    caseSlug,
    parentPathology?.badges,
    displayItem?.badges,
    provisional?.badges,
  ]);

  const pathologyBadges = useMemo(() => {
    if (!isPresentationNamespace) return [];
    return instantBadges.length ? instantBadges : [{ text: 'Atlas', variant: 'info' }];
  }, [isPresentationNamespace, instantBadges]);

  const pathologyBadge = useMemo(() => firstBadgeFromList(pathologyBadges), [pathologyBadges]);

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
      if (itemMatchesRoute && item?.title) return item.title;
      if (navCrumb?.pathology?.title) return navCrumb.pathology.title;
      if (indexPatho?.[pathologySlug]?.title) return indexPatho[pathologySlug].title;
      if (provisional?.title) return provisional.title;
      return pathologySlug || expectedSlug;
    }

    if (isCaseInPathology) {
      if (itemMatchesRoute && item?.title) return item.title;
      if (navCrumb?.case?.title) return navCrumb.case.title;
      if (indexCase?.[caseSlug]?.title) return indexCase[caseSlug].title;
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

    if (parentPathology?.slug === pathologySlug && parentPathology?.title) return parentPathology.title;
    if (navCrumb?.pathology?.title) return navCrumb.pathology.title;
    if (indexPatho?.[pathologySlug]?.title) return indexPatho[pathologySlug].title;
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

  const trainingHubTo = useMemo(() => {
    if (effectiveType === 'qa') return '/entrainement/qr';
    if (effectiveType === 'quiz') return '/entrainement/quiz';
    if (effectiveType === 'presentation') return '/entrainement/presentation';
    return '/entrainement';
  }, [effectiveType]);

  const breadcrumbItems = useMemo(() => {
    if (isDocNamespace) {
      const base = [
        { label: 'Accueil', to: '/' },
        { label: 'Documentation', to: '/documentation' },
      ];

      const isDefaultMedicineOral = isDefaultDocsChapter(subjectSlug, chapterSlug);

      if (docCrumb?.subject && !isDefaultMedicineOral) {
        base.push({
          label: docCrumb.subject.title,
          to: buildPath(docBasePath, [docCrumb.subject.slug]),
        });
      }

      if (docCrumb?.chapter && subjectSlug) {
        base.push({
          label: docCrumb.chapter.title,
          to: buildDocPublicPath(docBasePath, {
            subjectSlug,
            chapterSlug: docCrumb.chapter.slug,
          }),
        });
      }

      if (docCrumb?.theItem && subjectSlug && chapterSlug) {
        base.push({
          label: docCrumb.theItem.title,
          to: docSectionSlug
            ? buildDocPublicPath(docBasePath, {
                subjectSlug,
                chapterSlug,
                itemSlug: docCrumb.theItem.slug,
              })
            : null,
        });
      }

      if (docSectionSlug && docCrumb?.theSection) base.push({ label: docCrumb.theSection.title, to: null });

      return base;
    }

    // ✅ nouveaux hubs
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

    // Cas d’entraînement autonome (Q/R, quiz ou présentation).
    const base = [
      { label: 'Accueil', to: '/' },
      { label: 'Entraînement', to: '/entrainement' },
    ];

    const crumbTypeLabel = typeLabelFromKey(effectiveType);
    if (
      crumbTypeLabel &&
      (effectiveType === 'qa' || effectiveType === 'quiz' || effectiveType === 'presentation')
    ) {
      base.push({ label: crumbTypeLabel, to: trainingHubTo });
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
    trainingHubTo,
  ]);

  // Lightbox + plan de l'article
  const [lightbox, setLightbox] = useState(null);
  const contentRef = useRef(null);
  const outlineRootRef = useRef(null);
  const markdownScopeKey = String(displayItem?.slug || displayItem?.id || expectedSlug || 'x');
  const {
    items: outlineItems,
    activeId: activeOutlineId,
    scrollToHeading: scrollToOutlineHeading,
  } = useCaseDetailOutline(outlineRootRef, markdownScopeKey);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const onClick = (e) => {
      const t = e.target;
      if (!t || t.tagName !== 'IMG') return;
      if (t.dataset?.noLightbox === '1') return;
      if (t.closest?.('.cd-child-card')) return;

      e.preventDefault();
      setLightbox({ src: t.dataset?.lightboxSrc || t.src, alt: t.alt || '' });
    };

    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [
    displayItem?.content,
    qaList?.length,
    quizList?.length,
    pathologyGallery?.length,
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

  const docSectionsHeading = useMemo(() => {
    if (!isDocItemPage) return 'Sections';
    const value = typeof displayItem?.sectionsHeading === 'string' ? displayItem.sectionsHeading.trim() : '';
    return value || 'Sections';
  }, [isDocItemPage, displayItem?.sectionsHeading]);

  const docParentItem = useMemo(() => {
    if (!isDocNamespace || displayItem?.level !== 'section') return null;

    const parent = normalizeRelationEntity(displayItem?.parent);
    return parent?.level === 'item' ? parent : null;
  }, [isDocNamespace, displayItem]);

  const creditsMarkdown =
    isDocNamespace && displayItem?.level === 'section'
      ? mergeCreditsMarkdown(docParentItem, displayItem)
      : getCreditsMarkdown(displayItem);
  const showExtras = Boolean(creditsMarkdown);

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
        refreshToken={refreshToken}
        outlineItems={outlineItems}
        activeOutlineId={activeOutlineId}
        onOutlineNavigate={scrollToOutlineHeading}
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
        <article className="casedetail" ref={contentRef}>
          <div className="cd-content" ref={outlineRootRef}>
            <div className="cd-entry-top">
              <div className="cd-page-header">
                <Breadcrumbs items={breadcrumbItems} />
              </div>

              <div className="cd-entry-heading-copy">
                <div className="cd-type-badge">
                  {isPresentationNamespace ? (
                    <div className="cd-type-badges" aria-label="Badges de pathologie">
                      {pathologyBadges.map((badge, index) => (
                        <span
                          key={`${badge.variant || 'info'}:${badge.text || 'Atlas'}:${index}`}
                          className={`badge badge-soft-outline badge-${badge.variant || 'info'}`}
                        >
                          {badge.text || 'Atlas'}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className={`badge badge-soft-outline badge-${badgeVariantFromKey(effectiveType || 'qa')}`}>
                      {typeLabel}
                    </span>
                  )}
                </div>

                <div className="cd-entry-hero-copy">
                  <PageTitle description={displayItem?.excerpt || ''}>{displayTitle}</PageTitle>

                  {isPathologyPage && pathologyAliases.length > 0 && (
                    <div className="cd-aliases" aria-label="Autres appellations de la pathologie">
                      <span className="cd-aliases-label">
                        {pathologyAliases.length > 1 ? 'Autres appellations :' : 'Autre appellation :'}
                      </span>
                      <span className="cd-aliases-list">
                        {pathologyAliases.map((alias) => (
                          <span key={alias} className="cd-alias">{alias}</span>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {error && <div className="cd-state error">{error}</div>}

            <div className="cd-entry-hero">
              <div className="cd-entry-body">
                {displayItem?.content ? (
                  <CaseMarkdown scopeKey={markdownScopeKey}>{displayItem.content}</CaseMarkdown>
                ) : (
                  !displayItem && !error && <div className="cd-state">Chargement…</div>
                )}
              </div>
            </div>
          </div>

          {/* DOC children */}
          {isDocNamespace && displayMatchesRoute && isDocItemPage && docChildSections.length > 0 && (
            <section className="cd-children cd-doc-sections" aria-labelledby="cd-doc-sections-title">
              <div className="cd-doc-sections-heading">
                <h2 id="cd-doc-sections-title" className="cd-children-title">
                  {docSectionsHeading}
                </h2>
              </div>

              <ol className="cd-children-grid cd-doc-sections-grid">
                {docChildSections.map((s, index) => {
                  const to = buildDocPublicPath(docBasePath, {
                    subjectSlug,
                    chapterSlug,
                    itemSlug: docItemSlug,
                    sectionSlug: s.slug,
                  });
                  const sectionNumber = String(index + 1).padStart(2, '0');
                  return (
                    <li key={s.slug} className="cd-doc-section-item">
                      <Link
                        to={to}
                        className="cd-child-card ui-card cd-doc-section-card"
                        state={{ prefetch: { slug: s.slug, title: s.title || s.slug, type: 'doc' } }}
                        aria-label={`Section ${index + 1} : ${s.title || s.slug}`}
                      >
                        <div className="cd-doc-section-card-top" aria-hidden="true">
                          <span className="cd-doc-section-number">{sectionNumber}</span>

                          <span className="cd-doc-section-visual">
                            {s.coverUrl ? (
                              <img
                                className="cd-doc-section-cover"
                                src={s.coverUrl}
                                alt=""
                                loading="lazy"
                                data-no-lightbox="1"
                              />
                            ) : (
                              <svg className="cd-doc-section-icon" viewBox="0 0 24 24">
                                <path d="M7 3.75h7.35L18 7.4v12.85H7V3.75Z" />
                                <path d="M14 3.75V7.8h4" />
                                <path d="M9.75 11h5.5M9.75 14h5.5M9.75 17h3.4" />
                              </svg>
                            )}
                          </span>
                        </div>

                        <div className="cd-doc-section-content">
                          <div className="cd-child-title cd-doc-section-title">{s.title || s.slug}</div>
                          {s.excerpt && <div className="cd-child-excerpt cd-doc-section-excerpt">{s.excerpt}</div>}
                        </div>

                        <span className="cd-doc-section-arrow" aria-hidden="true">
                          <svg viewBox="0 0 24 24">
                            <path d="M5 12h13M13 7l5 5-5 5" />
                          </svg>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {/* PATHO gallery */}
          {!isDocNamespace && isPathologyPage && displayMatchesRoute && pathologyGallery.length > 0 && (
            <section className="cd-pathology-gallery" aria-labelledby="cd-pathology-gallery-title">
              <h2 id="cd-pathology-gallery-title" className="cd-children-title">
                Galerie
              </h2>

              <div className="cd-pathology-gallery-grid">
                {pathologyGallery.map((galleryItem, index) => {
                  const captionId = `cd-gallery-caption-${markdownScopeKey}-${index}`;
                  const hasCaption = Boolean(
                    galleryItem.title || galleryItem.caption || galleryItem.credit || galleryItem.sourceUrl
                  );

                  return (
                    <figure key={galleryItem.id ?? `${galleryItem.imageUrl}-${index}`} className="cd-gallery-item">
                      <button
                        type="button"
                        className="cd-gallery-image-button"
                        onClick={() =>
                          setLightbox({
                            src: galleryItem.fullImageUrl || galleryItem.imageUrl,
                            alt: galleryItem.alt || '',
                          })
                        }
                        aria-label={`Agrandir ${galleryItem.alt || `l’image ${index + 1}`}`}
                        aria-describedby={hasCaption ? captionId : undefined}
                      >
                        <img
                          className="cd-gallery-image"
                          src={galleryItem.imageUrl}
                          alt={galleryItem.alt || ''}
                          loading="lazy"
                          data-no-lightbox="1"
                        />
                      </button>

                      {hasCaption && (
                        <figcaption id={captionId} className="cd-gallery-caption">
                          {galleryItem.title && <strong className="cd-gallery-title">{galleryItem.title}</strong>}
                          {galleryItem.caption && <span>{galleryItem.caption}</span>}
                          {(galleryItem.credit || galleryItem.sourceUrl) && (
                            <small className="cd-gallery-credit">
                              {galleryItem.credit && <span>{galleryItem.credit}</span>}
                              {galleryItem.credit && galleryItem.sourceUrl && <span aria-hidden="true"> · </span>}
                              {galleryItem.sourceUrl && (
                                <a href={galleryItem.sourceUrl} target="_blank" rel="noreferrer">
                                  Source
                                </a>
                              )}
                            </small>
                          )}
                        </figcaption>
                      )}
                    </figure>
                  );
                })}
              </div>
            </section>
          )}

          {/* Cas cliniques associés à la pathologie Atlas */}
          {!isDocNamespace && isPathologyPage && displayMatchesRoute && relatedCases.length > 0 && (
            <section className="cd-children cd-related" aria-labelledby="cd-related-cases-title">
              <div className="cd-related-head">
                <h2 id="cd-related-cases-title" className="cd-children-title">
                  Cas cliniques associés
                </h2>
              </div>

              <ul className="cd-associated-cases-list">
                {visibleRelatedCases.map((c) => (
                  <li key={c.slug} className="cd-associated-case-item">
                    <Link
                      to={`/atlas/${pathologySlug}/${c.slug}`}
                      state={{
                        breadcrumb: {
                          mode: 'atlas',
                          pathology: {
                            slug: pathologySlug,
                            title: instantPathologyTitle || pathologySlug,
                            badge: pathologyBadge, // ✅ compat : premier badge
                            badges: pathologyBadges, // ✅ liste complète pour l'entête
                          },
                          case: { slug: c.slug, title: c.title || c.slug },
                        },
                        prefetch: { slug: c.slug, title: c.title || c.slug, type: c.type || 'presentation' },
                      }}
                      className="cd-associated-case-link"
                      onMouseEnter={() => prefetchCase(c.slug, { publicationState: PUB_STATE }).catch(() => {})}
                      onFocus={() => prefetchCase(c.slug, { publicationState: PUB_STATE }).catch(() => {})}
                      onPointerDown={() => prefetchCase(c.slug, { publicationState: PUB_STATE }).catch(() => {})}
                    >
                      <span className="cd-associated-case-icon" aria-hidden="true">
                        <AssociatedCaseIcon />
                      </span>
                      <span className="cd-associated-case-title">{c.title || c.slug}</span>
                    </Link>
                  </li>
                ))}
              </ul>
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
              <div className="cd-references cd-credits">
                <h3>Sources et crédits</h3>
                <CaseMarkdown>{creditsMarkdown}</CaseMarkdown>
              </div>
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
  refreshToken,
  outlineItems,
  activeOutlineId,
  onOutlineNavigate,
}) {
  const [loadingList, setLoadingList] = useState(false);
  const [errList, setErrList] = useState('');
  const [sidebarView, setSidebarView] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY_SIDEBAR_VIEW) === 'outline' ? 'outline' : 'list';
    } catch {
      return 'list';
    }
  });

  const selectSidebarView = (nextView) => {
    const normalizedView = nextView === 'outline' ? 'outline' : 'list';
    setSidebarView(normalizedView);

    try {
      localStorage.setItem(LS_KEY_SIDEBAR_VIEW, normalizedView);
    } catch {}
  };

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
  const handledSidebarRefreshRef = useRef(refreshToken);
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

    if (kind === 'pathology') return; // no-op (pas de throw)

    const connection = typeof navigator !== 'undefined' ? navigator.connection : null;
    if (connection?.saveData || connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g') return;

    const run = () => prefetchCase(slug, { publicationState: pubState }).catch(() => {});
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 600 });
    } else {
      setTimeout(run, 0);
    }
  };

  // ---- DOC loaders ----
  async function loadDocItems({ signal, force = false } = {}) {
    if (!docChapterSlug) {
      setDocItems([]);
      return [];
    }

    const cached = getDocItemsFromSession(docChapterSlug);
    if (!force && cached && isDocItemsSessionFresh(docChapterSlug)) {
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
      options: signal ? { signal } : undefined,
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

  async function loadDocSectionsForChapter(chapterSlugToLoad, { signal, force = false } = {}) {
    if (!chapterSlugToLoad) return {};

    const cached = getDocSectionsByChapterFromSession(chapterSlugToLoad);
    if (!force && cached && typeof cached === 'object' && isDocSectionsByChapterSessionFresh(chapterSlugToLoad)) {
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
      options: signal ? { signal } : undefined,
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
      const cached = getSidebarListFromSession(`cases:${currentType}`) || safeGetSessionJson(`cd-prefetch-${currentType}`);
      if (Array.isArray(cached) && cached.length) {
        const list = cached.filter((it) => it?.slug).sort(compareBySlugNumberAsc);
        setCaseList(list);
        booted = true;
      }
    }

    setLoadingList(!booted);
    setErrList('');
  }, [mode, prefetchRelated, currentType]);

  // ---- boot pathologies list (presentation mode) ----
  useEffect(() => {
    if (mode !== 'presentation') return;

    let booted = false;
    const cached = getSidebarListFromSession('pathologies') || safeGetSessionJson('cd-prefetch-pathologies');
    if (Array.isArray(cached) && cached.length) {
      setPathoList(cached);
      booted = true;
    }

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
    const controller = new AbortController();
    const forceRefresh = handledSidebarRefreshRef.current !== refreshToken;
    handledSidebarRefreshRef.current = refreshToken;

    async function loadCases() {
      if (!currentType) {
        setCaseList([]);
        setLoadingList(false);
        setErrList('');
        return;
      }

      setErrList('');

      const cached = getSidebarListFromSession(`cases:${currentType}`);
      if (!forceRefresh && cached && isSidebarListFresh(`cases:${currentType}`)) {
        setCaseList(cached.filter((it) => it?.slug).sort(compareBySlugNumberAsc));
        setLoadingList(false);
        return;
      }

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
          options: { signal: controller.signal },
        });

        if (ignore) return;

        const rows = Array.isArray(res?.data) ? res.data : [];
        const normalized = rows.map(normalizeEntity).filter(Boolean).filter((it) => it.slug);

        normalized.sort(compareBySlugNumberAsc);
        setCaseList(normalized);

        setSidebarListToSession(`cases:${currentType}`, normalized);
        removeSessionEntry(`cd-prefetch-${currentType}`);
      } catch (e) {
        if (!ignore && !isAbortError(e)) setErrList(e?.message || 'Erreur de chargement');
      } finally {
        if (!ignore) setLoadingList(false);
      }
    }

    async function loadPathologies() {
      setErrList('');

      const cached = getSidebarListFromSession('pathologies');
      if (!forceRefresh && cached && isSidebarListFresh('pathologies')) {
        setPathoList(cached);
        setLoadingList(false);
        return;
      }

      try {
        const res = await strapiFetch(PATHO_ENDPOINT, {
          params: {
            locale: 'all',
            publicationState: pubState,
            fields: ['title', 'slug', 'excerpt'],
            populate: {
              badges: { fields: ['label', 'variant'] }, // ✅ AJOUT
              cases: { fields: ['title', 'slug', 'type'], sort: ['slug:asc'] },
            },
            sort: 'title:asc',
            pagination: { page: 1, pageSize: 400 },
          },
          options: { signal: controller.signal },
        });

        if (ignore) return;

        const rows = Array.isArray(res?.data) ? res.data : [];
        const normalized = rows.map(normalizeEntity).filter(Boolean).filter((it) => it.slug);

        const cooked = normalized.map((p) => {
          const kids = normalizeRelationArray(p?.cases).filter((c) => c?.slug).sort(compareBySlugNumberAsc);
          return { ...p, _children: kids };
        });

        cooked.sort((a, b) => {
          const ta = String(a?.title || a?.slug || '');
          const tb = String(b?.title || b?.slug || '');
          return ta.localeCompare(tb, 'fr', { sensitivity: 'base' });
        });

        setPathoList(cooked);

        // ✅ index + badges pour affichage instant dans l'entête
        try {
          const pathoIndex = {};
          const caseIndex = {};
          for (const p of cooked) {
            if (!p?.slug) continue;

            const badges = normalizeBadgesList(p?.badges);
            const badge = firstBadgeFromList(badges);

            pathoIndex[p.slug] = {
              title: p.title || p.slug,
              badge: badge || null,
              badges,
            };

            const kids = Array.isArray(p._children) ? p._children : [];
            for (const c of kids) {
              if (!c?.slug) continue;
              caseIndex[c.slug] = {
                title: c.title || c.slug,
                pathologySlug: p.slug,
                pathologyTitle: p.title || p.slug,
                pathologyBadge: badge || null,
                pathologyBadges: badges,
              };
            }
          }
          sessionStorage.setItem('cd-patho-index', JSON.stringify({ pathoIndex, caseIndex }));
        } catch {}

        setSidebarListToSession('pathologies', cooked);
        removeSessionEntry('cd-prefetch-pathologies');
      } catch (e) {
        if (!ignore && !isAbortError(e)) setErrList(e?.message || 'Erreur de chargement');
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
        const [items, chapterMap] = await Promise.all([
          loadDocItems({ signal: controller.signal, force: forceRefresh }),
          loadDocSectionsForChapter(docChapterSlug, { signal: controller.signal, force: forceRefresh }),
        ]);

        if (ignore) return;

        // Le résultat réseau est autoritaire : les sections supprimées doivent disparaître.
        setDocSectionsByItem(chapterMap);

        const fresh = sortListSafe(items).map((it) => ({
          ...it,
          __hasSections: Array.isArray(chapterMap?.[it.slug]) && chapterMap[it.slug].length > 0,
        }));
        setDocItems(fresh);

        if (docItemSlug) {
          const secs = chapterMap?.[docItemSlug] || [];
          const sortedSecs = sortListSafe(secs);
          if (typeof setCurrentDocSections === 'function') setCurrentDocSections(sortedSecs);
          if (Array.isArray(sortedSecs)) setDocSectionsForItemToSession(docItemSlug, sortedSecs);
        }
      } catch (e) {
        if (!ignore && !isAbortError(e)) setErrList(e?.message || 'Erreur de chargement');
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
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentType, docChapterSlug, docItemSlug, pubState, refreshToken]);

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
                <button
                  type="button"
                  className="cd-side-back"
                  onClick={() => {
                    setDrawerView('cases');
                  }}
                >
                  ← Liste
                </button>
              </li>

              <li>
                <NavLink className="cd-side-link" to="/atlas" onClick={closeMobile}>
                  Atlas
                </NavLink>
              </li>

              <li>
                <NavLink className="cd-side-link" to="/entrainement" onClick={closeMobile}>
                  Entraînement
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

            <div className="cd-side-view-switch" role="group" aria-label="Affichage de la barre latérale">
              <button
                type="button"
                aria-pressed={sidebarView === 'list'}
                className={sidebarView === 'list' ? 'is-active' : ''}
                onClick={() => selectSidebarView('list')}
              >
                Liste
              </button>
              <button
                type="button"
                aria-pressed={sidebarView === 'outline'}
                className={sidebarView === 'outline' ? 'is-active' : ''}
                onClick={() => selectSidebarView('outline')}
              >
                Plan
              </button>
            </div>

            {sidebarView === 'outline' && (
              <CaseDetailOutline
                items={outlineItems}
                activeId={activeOutlineId}
                onSelect={(headingId) => {
                  if (typeof onOutlineNavigate === 'function') onOutlineNavigate(headingId);
                  if (isNarrow) closeMobile();
                }}
              />
            )}

            {sidebarView === 'list' && loadingList && !hasList && <div className="cd-side-state">Chargement…</div>}
            {sidebarView === 'list' && errList && !loadingList && (
              <div className="cd-side-state error">{errList}</div>
            )}

            {/* DOCS */}
            {sidebarView === 'list' && !errList && mode === 'docs' && docSubjectSlug && docChapterSlug && (
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

                  const itemTo = buildDocPublicPath(docBasePath, {
                    subjectSlug: docSubjectSlug,
                    chapterSlug: docChapterSlug,
                    itemSlug: it.slug,
                  });

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
                                const to = buildDocPublicPath(docBasePath, {
                                  subjectSlug: docSubjectSlug,
                                  chapterSlug: docChapterSlug,
                                  itemSlug: it.slug,
                                  sectionSlug: s.slug,
                                });

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

            {/* CAS D’ENTRAÎNEMENT (Q/R, quiz ou présentation) */}
            {sidebarView === 'list' && !errList && mode === 'cases' && (
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
                          to={`/entrainement/cas/${it.slug}`}
                          state={{
                            prefetch: { slug: it.slug, title: it.title || it.slug, type: it.type || currentType || null },
                            breadcrumb: { mode: 'entrainement', case: { slug: it.slug, title: it.title || it.slug } },
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
            {sidebarView === 'list' && !errList && mode === 'presentation' && (
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

                  const badges = normalizeBadgesList(p?.badges);
                  const badge = firstBadgeFromList(badges);

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
                                pathology: { slug: p.slug, title: p.title || p.slug, badge: badge || null, badges },
                                case: null,
                              },
                              prefetch: { slug: p.slug, title: p.title || p.slug, type: 'presentation', badges: p?.badges ?? null },
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
                                            pathology: { slug: p.slug, title: p.title || p.slug, badge: badge || null, badges },
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
