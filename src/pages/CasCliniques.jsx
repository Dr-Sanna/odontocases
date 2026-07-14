// src/pages/CasCliniques.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import { strapiFetch, imgUrl, isAbortError } from '../lib/strapi';
import './CasCliniques.css';

/**
 * Hubs :
 * - /atlas            => Atlas (liste pathologies)
 * - /qr-quiz          => Picker "Choisissez un type de cas"
 * - /qr-quiz/tous     => Liste mix (Q/R + Quiz)
 * - /qr-quiz/qr       => Liste Q/R (Strapi type = "qa")
 * - /qr-quiz/quiz     => Liste Quiz (Strapi type = "quiz")
 *
 * Détails (via CasCliniquesRouter) :
 * - /atlas/:pathologySlug/:caseSlug?
 * - /qr-quiz/cas/:slug
 *
 * Strapi types (inchangés) : "qa" | "quiz" | "presentation"
 * UI : "Atlas" pour le type "presentation"
 */

const STRAPI_ATLAS_TYPE = 'presentation';
const STRAPI_QA_TYPE = 'qa';
const STRAPI_QUIZ_TYPE = 'quiz';

// "Tous" = mix Q/R + Quiz (pas un type Strapi)
const MIXED_KEY = 'mixed';

const PAGE_SIZE = 100;
const FALLBACK_PAGE_SIZE = 300;

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const PATHO_ENDPOINT = import.meta.env.VITE_PATHO_ENDPOINT || '/pathologies';


const LIST_CACHE = new Map();
const LIST_STALE_MS = Number(import.meta.env.VITE_LIST_CACHE_STALE_MS) || 20_000;
const LIST_MAX_AGE_MS = Number(import.meta.env.VITE_LIST_CACHE_MAX_AGE_MS) || 5 * 60_000;

function readListCache(key) {
  const entry = LIST_CACHE.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.at;
  if (age > LIST_MAX_AGE_MS) {
    LIST_CACHE.delete(key);
    return null;
  }
  return { ...entry, isFresh: age <= LIST_STALE_MS };
}

function writeListCache(key, items, total) {
  LIST_CACHE.set(key, { items: Array.isArray(items) ? items : [], total: Number(total) || 0, at: Date.now() });
}

function normalizeNode(node) {
  return node?.attributes ? node.attributes : node;
}

/* =========================
   Badges atlas (pathologies)
   Strapi : relation "badges"
   Supporte aussi anciens formats
   ========================= */

function normalizeBadges(badgesAny) {
  const list = Array.isArray(badgesAny)
    ? badgesAny
    : Array.isArray(badgesAny?.data)
      ? badgesAny.data
      : [];

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

  // déterministe
  badges.sort((a, b) => String(a.label).localeCompare(String(b.label), 'fr', { sensitivity: 'base' }));

  return {
    text: badges[0].label || 'Atlas',
    variant: badges[0].variant || 'info',
  };
}

function hasBadgeLabel(badgesAny, label) {
  const target = String(label || '').trim().toLowerCase();
  return normalizeBadges(badgesAny).some((b) => String(b.label).trim().toLowerCase() === target);
}

/**
 * Groupe "Type" (Atlas) = badge principal déterministe.
 * Règle anti-duplication : si plusieurs badges dont OPMD,
 * on choisit un badge non-OPMD si possible.
 */
function getGroupTypeLabel(badgesAny) {
  const badges = normalizeBadges(badgesAny);
  if (badges.length === 0) return 'Atlas';

  const nonOpmd = badges.filter((b) => String(b.label).trim().toLowerCase() !== 'opmd');
  const pool = nonOpmd.length ? nonOpmd : badges;

  pool.sort((a, b) => String(a.label).localeCompare(String(b.label), 'fr', { sensitivity: 'base' }));
  return pool[0]?.label || 'Atlas';
}

function getFirstLetter(title) {
  const t = String(title || '').trim();
  if (!t) return '#';

  const first = t[0]
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return /[A-Z]/.test(first) ? first : '#';
}

function compareBySlugAsc(aNode, bNode) {
  const a = normalizeNode(aNode);
  const b = normalizeNode(bNode);

  const sa = String(a?.slug ?? '');
  const sb = String(b?.slug ?? '');

  return sa.localeCompare(sb, 'fr', { numeric: true, sensitivity: 'base' });
}

function compareByTitleAsc(aNode, bNode) {
  const a = normalizeNode(aNode);
  const b = normalizeNode(bNode);

  const ta = String(a?.title ?? '').trim();
  const tb = String(b?.title ?? '').trim();

  // titres vides à la fin
  const aEmpty = !ta;
  const bEmpty = !tb;
  if (aEmpty && !bEmpty) return 1;
  if (!aEmpty && bEmpty) return -1;

  const c = ta.localeCompare(tb, 'fr', { numeric: true, sensitivity: 'base' });
  if (c !== 0) return c;

  const sa = String(a?.slug ?? '');
  const sb = String(b?.slug ?? '');
  return sa.localeCompare(sb, 'fr', { numeric: true, sensitivity: 'base' });
}

function typeLabel(type) {
  if (type === STRAPI_QA_TYPE) return 'Q/R';
  if (type === STRAPI_QUIZ_TYPE) return 'Quiz';
  return 'Atlas';
}

function badgeVariant(type) {
  if (type === STRAPI_QA_TYPE) return 'success';
  if (type === STRAPI_QUIZ_TYPE) return 'info';
  return 'danger';
}

/* -------- Recherche permissive -------- */

function normalizeSearch(s) {
  const base = String(s || '').trim().toLowerCase();
  const noAccents = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return { base, noAccents };
}

function singularizeFr(word) {
  let w = String(word || '');
  if (w.length <= 3) return w;
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && w.length > 3) return w.slice(0, -1);
  if (w.endsWith('x') && w.length > 3) return w.slice(0, -1);
  return w;
}

function buildVariants(q) {
  const { base, noAccents } = normalizeSearch(q);
  const baseSing = singularizeFr(base);
  const noAccSing = singularizeFr(noAccents);
  return Array.from(new Set([base, noAccents, baseSing, noAccSing].filter(Boolean)));
}

function buildOrFilterFromVariants(variants) {
  return variants.flatMap((v) => [
    { title: { $containsi: v } },
    { excerpt: { $containsi: v } },
    { slug: { $containsi: v } },
  ]);
}

function normForSearch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function itemMatchesQuery(item, q) {
  const nq = normForSearch(q);
  if (!nq) return true;

  const title = normForSearch(item?.title);
  const excerpt = normForSearch(item?.excerpt);
  const slug = normForSearch(item?.slug);

  return title.includes(nq) || excerpt.includes(nq) || slug.includes(nq);
}

function buildSearch({ q, page }) {
  const sp = new URLSearchParams();
  if (q) sp.set('q', q);
  if (page && page > 1) sp.set('page', String(page));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/* -------- Mode depuis l’URL -------- */

function getHubAndSelection(pathname) {
  // hub atlas
  if (pathname === '/atlas' || pathname.startsWith('/atlas/')) {
    return { hub: 'atlas', selection: STRAPI_ATLAS_TYPE };
  }

  // hub qr-quiz
  if (pathname === '/qr-quiz' || pathname.startsWith('/qr-quiz/')) {
    const segs = pathname.split('/').filter(Boolean); // ['qr-quiz', ...]
    const sub = segs[1] || null; // 'tous' | 'qr' | 'quiz' | 'cas' | null
    if (sub === 'tous') return { hub: 'qr-quiz', selection: MIXED_KEY };
    if (sub === 'qr') return { hub: 'qr-quiz', selection: STRAPI_QA_TYPE };
    if (sub === 'quiz') return { hub: 'qr-quiz', selection: STRAPI_QUIZ_TYPE };
    return { hub: 'qr-quiz', selection: 'all' }; // root => TypePicker
  }

  return { hub: 'unknown', selection: 'all' };
}

function ViewToggle({ view, setView }) {
  return (
    <div className="cc-viewtoggle" role="group" aria-label="Affichage">
      <button
        type="button"
        className={`cc-viewbtn ${view === 'cards' ? 'active' : ''}`}
        onClick={() => setView('cards')}
        aria-pressed={view === 'cards'}
        aria-label="Affichage cartes"
        title="Cartes"
      >
        <svg className="cc-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
          />
        </svg>
      </button>

      <button
        type="button"
        className={`cc-viewbtn ${view === 'list' ? 'active' : ''}`}
        onClick={() => setView('list')}
        aria-pressed={view === 'list'}
        aria-label="Affichage liste"
        title="Liste"
      >
        <svg className="cc-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 6h2v2H4V6zm4 0h12v2H8V6zM4 11h2v2H4v-2zm4 0h12v2H8v-2zM4 16h2v2H4v-2zm4 0h12v2H8v-2z"
          />
        </svg>
      </button>
    </div>
  );
}

/* =========================
   Contrôles Atlas
   ========================= */

function AtlasControls({ atlasGroup, setAtlasGroup }) {
  return (
    <div className="cc-atlas-controls" role="group" aria-label="Contrôles Atlas">
      <div className="cc-atlas-control" role="group" aria-label="Afficher">
        <span className="cc-sortlabel">Afficher :</span>

        <button type="button" className="cc-sortbtn active" aria-pressed="true">
          Tous
        </button>
      </div>

      <div className="cc-atlas-control" role="group" aria-label="Grouper par">
        <span className="cc-sortlabel">Grouper par :</span>

        <button
          type="button"
          className={`cc-sortbtn ${atlasGroup === 'letter' ? 'active' : ''}`}
          onClick={() => setAtlasGroup('letter')}
          aria-pressed={atlasGroup === 'letter'}
        >
          Lettre
        </button>

        <button
          type="button"
          className={`cc-sortbtn ${atlasGroup === 'none' ? 'active' : ''}`}
          onClick={() => setAtlasGroup('none')}
          aria-pressed={atlasGroup === 'none'}
        >
          Aucun
        </button>
      </div>
    </div>
  );
}

export default function CasCliniques() {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const lastFocusAtRef = useRef(Date.now());
  const handledRefreshRef = useRef(0);

  useEffect(() => {
    const refreshAfterFocus = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocusAtRef.current < 10_000) return;
      lastFocusAtRef.current = now;
      setRefreshToken((v) => v + 1);
    };
    window.addEventListener('focus', refreshAfterFocus);
    document.addEventListener('visibilitychange', refreshAfterFocus);
    return () => {
      window.removeEventListener('focus', refreshAfterFocus);
      document.removeEventListener('visibilitychange', refreshAfterFocus);
    };
  }, []);

  // toggle Cartes / Liste (persisté)
  const [view, setView] = useState(() => {
    const saved = localStorage.getItem('cc:view');
    return saved === 'cards' ? 'cards' : 'list';
  });

  useEffect(() => {
    localStorage.setItem('cc:view', view);
  }, [view]);

  // Atlas : grouper par lettre par défaut, puis respecter la préférence utilisateur.
  const [atlasGroup, setAtlasGroup] = useState(() => {
    const saved = localStorage.getItem('atlas:group');
    return saved === 'none' ? 'none' : 'letter';
  }); // 'letter' | 'none'

  useEffect(() => {
    localStorage.setItem('atlas:group', atlasGroup);
    localStorage.setItem('atlas:show', 'all');
  }, [atlasGroup]);

  const q = searchParams.get('q') || '';
  const page = Number(searchParams.get('page') || 1);

  const { hub, selection } = getHubAndSelection(pathname);

  const isAtlasHub = hub === 'atlas';
  const isQrQuizHub = hub === 'qr-quiz';

  const showTypePicker = isQrQuizHub && selection === 'all';
  const tab = selection; // 'qa' | 'quiz' | 'mixed' | 'presentation' | 'all'

  const variants = useMemo(() => (q ? buildVariants(q) : []), [q]);

  const goPage = (p) => {
    const base = isAtlasHub
      ? '/atlas'
      : isQrQuizHub
        ? tab === MIXED_KEY
          ? '/qr-quiz/tous'
          : tab === STRAPI_QA_TYPE
            ? '/qr-quiz/qr'
            : '/qr-quiz/quiz'
        : '/';
    navigate(`${base}${buildSearch({ q, page: p })}`);
  };

  const caseTypeFilterOnly = useMemo(() => {
    const f = {};

    if (tab === MIXED_KEY) {
      f.type = { $in: [STRAPI_QA_TYPE, STRAPI_QUIZ_TYPE] };
      return f;
    }

    if (tab === STRAPI_QA_TYPE || tab === STRAPI_QUIZ_TYPE) {
      f.type = { $eq: tab };
    }
    return f;
  }, [tab]);

  const caseFilters = useMemo(() => {
    const f = { ...caseTypeFilterOnly };
    if (q) f.$or = buildOrFilterFromVariants(variants);
    return f;
  }, [caseTypeFilterOnly, q, variants]);

  const pathoFilters = useMemo(() => {
    const f = {};
    if (q) f.$or = buildOrFilterFromVariants(variants);
    return f;
  }, [q, variants]);

  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();
    const forceRefresh = handledRefreshRef.current !== refreshToken;
    handledRefreshRef.current = refreshToken;

    if (showTypePicker) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setError('');
      return () => controller.abort();
    }

    const cacheKey = `${isAtlasHub ? 'atlas' : 'cases'}:${tab}:${page}:${q}`;
    const cached = readListCache(cacheKey);
    if (cached) {
      setItems(cached.items);
      setTotal(cached.total);
      setLoading(false);
      setError('');
      if (cached.isFresh && !forceRefresh) return () => controller.abort();
    }

    async function load() {
      setLoading(true);
      setError('');

      try {
        // Atlas => pathologies
        if (isAtlasHub && tab === STRAPI_ATLAS_TYPE) {
          const data = await strapiFetch(PATHO_ENDPOINT, {
            params: {
              populate: {
                cover: { fields: ['url', 'formats'] },
                badges: { fields: ['label', 'variant'] },
              },
              locale: 'all',
              filters: pathoFilters,
              // Atlas doit être trié par title alphabétique
              sort: 'title:asc,slug:asc',
              pagination: { page, pageSize: PAGE_SIZE },
              fields: ['title', 'slug', 'excerpt', 'updatedAt'],
              publicationState: 'live',
            },
            options: { signal: controller.signal },
          });

          if (ignore) return;

          let list = Array.isArray(data?.data) ? data.data : [];
          let normalized = list.map(normalizeNode).filter((it) => it?.slug);

          if (q && normalized.length === 0) {
            const fallback = await strapiFetch(PATHO_ENDPOINT, {
              params: {
                populate: {
                  cover: { fields: ['url', 'formats'] },
                  badges: { fields: ['label', 'variant'] },
                },
                locale: 'all',
                filters: {},
                sort: 'title:asc,slug:asc',
                pagination: { page: 1, pageSize: FALLBACK_PAGE_SIZE },
                fields: ['title', 'slug', 'excerpt', 'updatedAt'],
                publicationState: 'live',
              },
              options: { signal: controller.signal },
            });

            if (ignore) return;
            const all = Array.isArray(fallback?.data) ? fallback.data : [];
            normalized = all
              .map(normalizeNode)
              .filter((it) => it?.slug)
              .filter((it) => itemMatchesQuery(it, q));
          }

          const nextItems = normalized.map((it) => ({ ...it, __entity: 'pathology' }));
          const nextTotal = data?.meta?.pagination?.total ?? normalized.length ?? 0;
          setItems(nextItems);
          setTotal(nextTotal);
          writeListCache(cacheKey, nextItems, nextTotal);
          return;
        }

        // Q/R & Quiz => cases
        if (isQrQuizHub && (tab === STRAPI_QA_TYPE || tab === STRAPI_QUIZ_TYPE || tab === MIXED_KEY)) {
          const data = await strapiFetch(CASES_ENDPOINT, {
            params: {
              populate: { cover: { fields: ['url', 'formats'] } },
              locale: 'all',
              filters: caseFilters,
              // Tous => title, QR/Quiz => slug
              sort: tab === MIXED_KEY ? 'title:asc,slug:asc' : 'slug:asc',
              pagination: { page, pageSize: PAGE_SIZE },
              fields: ['title', 'slug', 'type', 'excerpt', 'updatedAt'],
              publicationState: 'live',
            },
            options: { signal: controller.signal },
          });

          if (ignore) return;

          let list = Array.isArray(data?.data) ? data.data : [];
          let normalized = list.map(normalizeNode).filter((it) => it?.slug);

          if (q && normalized.length === 0) {
            const fallback = await strapiFetch(CASES_ENDPOINT, {
              params: {
                populate: { cover: { fields: ['url', 'formats'] } },
                locale: 'all',
                filters: caseTypeFilterOnly,
                sort: tab === MIXED_KEY ? 'title:asc,slug:asc' : 'slug:asc',
                pagination: { page: 1, pageSize: FALLBACK_PAGE_SIZE },
                fields: ['title', 'slug', 'type', 'excerpt', 'updatedAt'],
                publicationState: 'live',
              },
              options: { signal: controller.signal },
            });

            if (ignore) return;
            const all = Array.isArray(fallback?.data) ? fallback.data : [];
            normalized = all
              .map(normalizeNode)
              .filter((it) => it?.slug)
              .filter((it) => itemMatchesQuery(it, q));
          }

          const nextItems = normalized.map((it) => ({ ...it, __entity: 'case' }));
          const nextTotal = data?.meta?.pagination?.total ?? normalized.length ?? 0;
          setItems(nextItems);
          setTotal(nextTotal);
          writeListCache(cacheKey, nextItems, nextTotal);
          return;
        }

        setItems([]);
        setTotal(0);
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
  }, [showTypePicker, isAtlasHub, isQrQuizHub, tab, page, q, variants, caseFilters, pathoFilters, caseTypeFilterOnly, refreshToken]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Tri UI (cohérent avec tes règles)
  const sortedItems = useMemo(() => {
    const arr = Array.isArray(items) ? [...items] : [];

    // ATLAS => title
    if (isAtlasHub && tab === STRAPI_ATLAS_TYPE) {
      arr.sort(compareByTitleAsc);
      return arr;
    }

    // QR/QUIZ Tous => title
    if (isQrQuizHub && tab === MIXED_KEY) {
      arr.sort(compareByTitleAsc);
      return arr;
    }

    // QR ou Quiz => slug
    if (isQrQuizHub && (tab === STRAPI_QA_TYPE || tab === STRAPI_QUIZ_TYPE)) {
      arr.sort(compareBySlugAsc);
      return arr;
    }

    // fallback
    arr.sort(compareBySlugAsc);
    return arr;
  }, [items, isAtlasHub, isQrQuizHub, tab]);

  // Atlas : Afficher = Tous.
  const atlasVisibleItems = useMemo(() => {
    if (!(isAtlasHub && tab === STRAPI_ATLAS_TYPE)) return sortedItems;
    return [...sortedItems];
  }, [sortedItems, isAtlasHub, tab]);

  // Sections Atlas (groupement)
  const atlasSections = useMemo(() => {
    if (!(isAtlasHub && tab === STRAPI_ATLAS_TYPE)) return null;

    const list = atlasVisibleItems;

    if (atlasGroup === 'none') {
      return [{ key: 'all', label: null, items: list }];
    }

    const map = new Map();

    for (const it of list) {
      const label = getFirstLetter(it?.title);
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(it);
    }

    const labels = Array.from(map.keys()).sort((a, b) => String(a).localeCompare(String(b), 'fr', { sensitivity: 'base' }));

    return labels.map((label) => ({
      key: String(label),
      label,
      items: map.get(label),
    }));
  }, [isAtlasHub, tab, atlasVisibleItems, atlasGroup]);

  const title = isAtlasHub ? 'Atlas' : isQrQuizHub ? 'Q/R & Quiz' : 'Atlas';
  const description = isAtlasHub
    ? 'Atlas de pathologies orales, variations physiologiques de la muqueuse et cas cliniques associés.'
    : isQrQuizHub
      ? 'Cas cliniques interactifs.'
      : 'Atlas de pathologies orales.';

  // Chips : boutons (pas de lien)
  const showChips =
    !showTypePicker && isQrQuizHub && (tab === MIXED_KEY || tab === STRAPI_QA_TYPE || tab === STRAPI_QUIZ_TYPE);

  const onChip = (nextTab) => {
    const base =
      nextTab === MIXED_KEY ? '/qr-quiz/tous' : nextTab === STRAPI_QA_TYPE ? '/qr-quiz/qr' : '/qr-quiz/quiz';
    navigate(`${base}${buildSearch({ q, page: 1 })}`);
  };

  const renderItem = (attrs, idx) => {
    if (!attrs) return null;

    const entity = attrs.__entity || (isAtlasHub ? 'pathology' : 'case');

    const titleText = attrs?.title || 'Sans titre';
    const slug = attrs?.slug || '';
    const excerpt = attrs?.excerpt || '';

    const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
    const coverUrl = imgUrl(coverAttr, 'medium') || imgUrl(coverAttr, 'thumbnail') || imgUrl(coverAttr) || '';

    let toHref = null;
    if (slug) {
      toHref = entity === 'pathology' ? `/atlas/${slug}` : `/qr-quiz/cas/${slug}`;
    }

    const isPathology = entity === 'pathology';
    const isListView = view === 'list';
    const itemType = isPathology ? STRAPI_ATLAS_TYPE : attrs?.type || STRAPI_QA_TYPE;

    // Badges : Atlas = badges de pathologie ; Q/R & Quiz = badge de type de cas.
    const pathoBadges = isPathology ? normalizeBadges(attrs?.badges) : [];
    const badgesToRender = isPathology
      ? (pathoBadges.length ? pathoBadges : [{ label: 'Atlas', variant: 'info' }])
      : [{ label: typeLabel(itemType), variant: badgeVariant(itemType) }];

    // On garde un badge primaire pour le breadcrumb/prefetch.
    const primaryBadge = isPathology ? pickPrimaryBadge(attrs?.badges) : null;

    const key = `${entity}:${slug || idx}`;

    const linkState =
      entity === 'pathology'
        ? {
            breadcrumb: {
              mode: 'atlas',
              pathology: {
                slug,
                title: titleText,
                badge: primaryBadge,
                badges: badgesToRender,
              },
              case: null,
            },
            prefetch: {
              slug,
              title: titleText,
              type: 'presentation',
              badges: attrs?.badges ?? null,
            },
          }
        : {
            breadcrumb: { mode: 'qr-quiz', case: { slug, title: titleText } },
            prefetch: { slug, title: titleText, type: attrs?.type || null },
          };

    // Atlas : on utilise le même modèle de carte que Documentation.
    if (isPathology) {
      const cardClass = `doc-card ui-card ${isListView ? 'doc-card--list' : ''}`;

      const Inner = (
        <>
          <div
            className={coverUrl ? 'doc-thumb' : 'doc-thumb is-empty'}
            style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
            aria-hidden="true"
          >
            {!isListView && (
              <div className="doc-thumb-overlay">
                <div className="doc-thumb-badges">
                  {badgesToRender.map((b) => (
                    <span
                      key={`${b.variant}:${b.label}`}
                      className={`doc-thumb-badge badge badge-soft badge-${b.variant}`}
                    >
                      {b.label}
                    </span>
                  ))}
                </div>
                <h3 className="doc-thumb-title">{titleText}</h3>
              </div>
            )}
          </div>

          {isListView ? (
            <div className="doc-body">
              <h3 className="doc-title">
                <span className="doc-title-text">{titleText}</span>
              </h3>

              <div className="doc-title-badges">
                {badgesToRender.map((b) => (
                  <span
                    key={`${b.variant}:${b.label}`}
                    className={`doc-title-badge badge badge-soft-outline badge-${b.variant}`}
                  >
                    {b.label}
                  </span>
                ))}
              </div>

              {excerpt ? <p className="doc-excerpt">{excerpt}</p> : null}
            </div>
          ) : excerpt ? (
            <div className="doc-body">
              <p className="doc-excerpt">{excerpt}</p>
            </div>
          ) : null}
        </>
      );

      return toHref ? (
        <Link key={key} to={toHref} className={cardClass} state={linkState}>
          {Inner}
        </Link>
      ) : (
        <div key={key} className={`${cardClass} doc-card--disabled`} title="Slug manquant">
          {Inner}
        </div>
      );
    }

    // Q/R & Quiz : on conserve le style historique des cas cliniques.
    const Inner = (
      <>
        <div
          className="cc-thumb"
          style={{ backgroundImage: coverUrl ? `url(${coverUrl})` : undefined }}
          aria-hidden="true"
        >
          {view !== 'list' && (
            <div className="cc-thumb-badges">
              {badgesToRender.map((b) => (
                <span
                  key={`${b.variant}:${b.label}`}
                  className={`cc-thumb-badge badge badge-soft badge-${b.variant}`}
                >
                  {b.label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="cc-body">
          <h3 className="cc-title">
            <span className="cc-title-text">{titleText}</span>
          </h3>

          {view === 'list' && (
            <div className="cc-title-badges">
              {badgesToRender.map((b) => (
                <span
                  key={`${b.variant}:${b.label}`}
                  className={`cc-title-badge badge badge-soft-outline badge-${b.variant}`}
                >
                  {b.label}
                </span>
              ))}
            </div>
          )}

          {view === 'list' ? (excerpt ? <p className="cc-excerpt">{excerpt}</p> : null) : <span className="sr-only">{excerpt}</span>}
        </div>
      </>
    );

    const cardClass = `cc-card ui-card ${view === 'list' ? 'cc-card--list' : ''}`;

    return toHref ? (
      <Link key={key} to={toHref} className={cardClass} state={linkState}>
        {Inner}
      </Link>
    ) : (
      <div key={key} className={`${cardClass} cc-card--disabled`} title="Slug manquant">
        {Inner}
      </div>
    );
  };

  const isAtlasList = isAtlasHub && tab === STRAPI_ATLAS_TYPE;
  const listForEmptyCheck = isAtlasList ? atlasVisibleItems : sortedItems;

  return (
    <>
      <div className="page-header">
        <div className="container">
          <PageTitle description={description}>{title}</PageTitle>
        </div>
      </div>

      <div className="container">
        {showTypePicker && <TypePicker />}

        {showChips && (
          <section className="cc-toolbar cc-toolbar--top">
            <div className="cc-tabs" role="tablist" aria-label="Filtrer">
              <button
                type="button"
                className={`cc-tab ${tab === MIXED_KEY ? 'active' : ''}`}
                onClick={() => onChip(MIXED_KEY)}
                role="tab"
                aria-selected={tab === MIXED_KEY}
              >
                Tous
              </button>

              <button
                type="button"
                className={`cc-tab ${tab === STRAPI_QA_TYPE ? 'active' : ''}`}
                onClick={() => onChip(STRAPI_QA_TYPE)}
                role="tab"
                aria-selected={tab === STRAPI_QA_TYPE}
              >
                Q/R
              </button>

              <button
                type="button"
                className={`cc-tab ${tab === STRAPI_QUIZ_TYPE ? 'active' : ''}`}
                onClick={() => onChip(STRAPI_QUIZ_TYPE)}
                role="tab"
                aria-selected={tab === STRAPI_QUIZ_TYPE}
              >
                Quiz
              </button>
            </div>

            <ViewToggle view={view} setView={setView} />
          </section>
        )}

        {!showTypePicker && !showChips && (
          <section className="cc-toolbar cc-toolbar--views">
            {isAtlasHub && tab === STRAPI_ATLAS_TYPE ? (
              <AtlasControls atlasGroup={atlasGroup} setAtlasGroup={setAtlasGroup} />
            ) : (
              <span />
            )}

            <ViewToggle view={view} setView={setView} />
          </section>
        )}

        {!showTypePicker && (
          <>
            {/* États globaux */}
            {loading && <div className="cc-state">Chargement…</div>}
            {error && !loading && <div className="cc-state error">{error}</div>}
            {!loading && !error && listForEmptyCheck.length === 0 && <div className="cc-state">Aucun résultat.</div>}

            {/* Rendu */}
            {!loading && !error && listForEmptyCheck.length > 0 && (
              <>
                {isAtlasList && atlasSections && atlasGroup !== 'none' ? (
                  <div className="resource-groups cc-groups" aria-label="Ressources">
                    {atlasSections.map((section) => (
                      <div key={section.key} className="resource-group cc-group">
                        {section.label && (
                          <div className="resource-group-header cc-group-header" aria-hidden="true">
                            <span className="resource-group-title cc-group-title">{section.label}</span>
                            <div className="resource-group-rule cc-group-rule" />
                          </div>
                        )}

                        <section
                          className={`resource-grid doc-grid ${view === 'list' ? 'doc-grid--list' : ''}`}
                          aria-label={section.label ? `Groupe ${section.label}` : 'Ressources'}
                        >
                          {section.items.map(renderItem)}
                        </section>
                      </div>
                    ))}
                  </div>
                ) : (
                  <section
                    className={
                      isAtlasList
                        ? `resource-grid doc-grid ${view === 'list' ? 'doc-grid--list' : ''}`
                        : `resource-grid cc-grid ${view === 'list' ? 'cc-grid--list' : ''}`
                    }
                    aria-label="Ressources"
                  >
                    {(isAtlasList ? atlasVisibleItems : sortedItems).map(renderItem)}
                  </section>
                )}

                {pages > 1 && (
                  <nav className="cc-pagination" aria-label="Pagination">
                    <button disabled={page <= 1} onClick={() => goPage(page - 1)} type="button">
                      Précédent
                    </button>
                    <span>
                      Page {page} / {pages}
                    </span>
                    <button disabled={page >= pages} onClick={() => goPage(page + 1)} type="button">
                      Suivant
                    </button>
                  </nav>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function TypePicker() {
  return (
    <section className="cc-typepicker">
      <h3>Choisissez un type de cas</h3>
      <div className="cc-typegrid">
        <Link className="cc-typecard ui-card" to="/qr-quiz/tous" draggable="false">
          <span className="cc-type">Tous</span>
          <span className="cc-typedesc">Q/R + Quiz</span>
        </Link>

        <Link className="cc-typecard ui-card" to="/qr-quiz/qr" draggable="false">
          <span className="cc-type">Q/R</span>
          <span className="cc-typedesc">12 items d'internat issus du CNECO</span>
        </Link>

        <Link className="cc-typecard ui-card" to="/qr-quiz/quiz" draggable="false">
          <span className="cc-type">Quiz diagnostic</span>
          <span className="cc-typedesc">68 cas issus du SFCO</span>
        </Link>
      </div>
    </section>
  );
}
