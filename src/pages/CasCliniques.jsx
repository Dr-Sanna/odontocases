// src/pages/CasCliniques.jsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import { strapiFetch, imgUrl } from '../lib/strapi';
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

const PAGE_SIZE = 24;
const FALLBACK_PAGE_SIZE = 300;

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const PATHO_ENDPOINT = import.meta.env.VITE_PATHO_ENDPOINT || '/pathologies';

/* =========================
   Badges atlas (pathologies)
   ========================= */
const ATLAS_BADGE_TO_VARIANT = {
  'Tumeur bénigne': 'success',
  Technique: 'success',

  'Tumeur maligne': 'danger',

  Infectieux: 'warning',
  Traumatologie: 'warning',

  Viral: 'info',
  'Inflammatoire / immunitaire': 'info',
  'Auto-immun': 'info',
  'Lésion réactionnelle': 'info',

  "Anomalie d'éruption": 'secondary',
  'Kystes & pseudokystes': 'secondary',
  'Vasculaire / génétique': 'secondary',
};

function getAtlasBadge(atlasBadge) {
  if (!atlasBadge) return { text: 'Atlas', variant: 'info' };
  return {
    text: atlasBadge,
    variant: ATLAS_BADGE_TO_VARIANT[atlasBadge] || 'info',
  };
}

function normalizeNode(node) {
  return node?.attributes ? node.attributes : node;
}

function compareBySlugNumberAsc(aNode, bNode) {
  const a = normalizeNode(aNode);
  const b = normalizeNode(bNode);

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

export default function CasCliniques() {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  // ✅ toggle Cartes / Liste (persisté)
  const [view, setView] = useState(() => {
    const saved = localStorage.getItem('cc:view');
    return saved === 'list' ? 'list' : 'cards';
  });

  useEffect(() => {
    localStorage.setItem('cc:view', view);
  }, [view]);

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

    if (showTypePicker) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setError('');
      return () => {};
    }

    async function load() {
      setLoading(true);
      setError('');

      try {
        // Atlas => pathologies
        if (isAtlasHub && tab === STRAPI_ATLAS_TYPE) {
          const data = await strapiFetch(PATHO_ENDPOINT, {
            params: {
              populate: { cover: { fields: ['url', 'formats'] } },
              locale: 'all',
              filters: pathoFilters,
              sort: 'slug:asc',
              pagination: { page, pageSize: PAGE_SIZE },
              fields: ['title', 'slug', 'excerpt', 'updatedAt', 'atlasBadge'],
              publicationState: 'live',
            },
          });

          if (ignore) return;

          let list = Array.isArray(data?.data) ? data.data : [];
          let normalized = list.map(normalizeNode).filter((it) => it?.slug);

          if (q && normalized.length === 0) {
            const fallback = await strapiFetch(PATHO_ENDPOINT, {
              params: {
                populate: { cover: { fields: ['url', 'formats'] } },
                locale: 'all',
                filters: {},
                sort: 'slug:asc',
                pagination: { page: 1, pageSize: FALLBACK_PAGE_SIZE },
                fields: ['title', 'slug', 'excerpt', 'updatedAt', 'atlasBadge'],
                publicationState: 'live',
              },
            });

            const all = Array.isArray(fallback?.data) ? fallback.data : [];
            normalized = all
              .map(normalizeNode)
              .filter((it) => it?.slug)
              .filter((it) => itemMatchesQuery(it, q));
          }

          setItems(normalized.map((it) => ({ ...it, __entity: 'pathology' })));
          setTotal(data?.meta?.pagination?.total ?? normalized.length ?? 0);
          return;
        }

        // Q/R & Quiz => cases (qa/quiz ou mix)
        if (isQrQuizHub && (tab === STRAPI_QA_TYPE || tab === STRAPI_QUIZ_TYPE || tab === MIXED_KEY)) {
          const data = await strapiFetch(CASES_ENDPOINT, {
            params: {
              populate: { cover: { fields: ['url', 'formats'] } },
              locale: 'all',
              filters: caseFilters,
              sort: tab === MIXED_KEY ? 'title:asc' : 'slug:asc',
              pagination: { page, pageSize: PAGE_SIZE },
              fields: ['title', 'slug', 'type', 'excerpt', 'updatedAt'],
              publicationState: 'live',
            },
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
                sort: tab === MIXED_KEY ? 'title:asc' : 'slug:asc',
                pagination: { page: 1, pageSize: FALLBACK_PAGE_SIZE },
                fields: ['title', 'slug', 'type', 'excerpt', 'updatedAt'],
                publicationState: 'live',
              },
            });

            const all = Array.isArray(fallback?.data) ? fallback.data : [];
            normalized = all
              .map(normalizeNode)
              .filter((it) => it?.slug)
              .filter((it) => itemMatchesQuery(it, q));
          }

          setItems(normalized.map((it) => ({ ...it, __entity: 'case' })));
          setTotal(data?.meta?.pagination?.total ?? normalized.length ?? 0);
          return;
        }

        setItems([]);
        setTotal(0);
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
  }, [showTypePicker, isAtlasHub, isQrQuizHub, tab, page, q, variants, caseFilters, pathoFilters, caseTypeFilterOnly]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sortedItems = useMemo(() => {
    const arr = Array.isArray(items) ? [...items] : [];

    // en mode "Tous" => tri alphabétique par titre
    if (isQrQuizHub && tab === MIXED_KEY) {
      arr.sort(compareByTitleAsc);
      return arr;
    }

    // sinon => tri par numéro dans le slug
    arr.sort(compareBySlugNumberAsc);
    return arr;
  }, [items, isQrQuizHub, tab]);

  const title = isAtlasHub ? 'Atlas' : isQrQuizHub ? 'Q/R & Quiz' : 'Atlas';
  const description = isAtlasHub
    ? 'Atlas de pathologies orales.'
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
            <ViewToggle view={view} setView={setView} />
          </section>
        )}

        {!showTypePicker && (
          <>
            <section className={`cc-grid ${view === 'list' ? 'cc-grid--list' : ''}`} aria-label="Ressources">
              {loading && <div className="cc-state">Chargement…</div>}
              {error && !loading && <div className="cc-state error">{error}</div>}
              {!loading && !error && sortedItems.length === 0 && <div className="cc-state">Aucun résultat.</div>}

              {!loading &&
                !error &&
                sortedItems.length > 0 &&
                sortedItems.map((attrs, idx) => {
                  if (!attrs) return null;

                  const entity = attrs.__entity || (isAtlasHub ? 'pathology' : 'case');

                  const titleText = attrs?.title || 'Sans titre';
                  const slug = attrs?.slug || '';
                  const excerpt = attrs?.excerpt || '';

                  const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
                  const coverUrl = imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || '';

                  let toHref = null;

                  if (slug) {
                    if (entity === 'pathology') {
                      toHref = `/atlas/${slug}`;
                    } else {
                      toHref = `/qr-quiz/cas/${slug}`;
                    }
                  }

                  const isPathology = entity === 'pathology';
                  const atlasBadge = isPathology ? getAtlasBadge(attrs?.atlasBadge) : null;

                  const itemType = isPathology ? STRAPI_ATLAS_TYPE : attrs?.type || STRAPI_QA_TYPE;

                  const badgeText = isPathology ? atlasBadge.text : typeLabel(itemType);
                  const badgeVar = isPathology ? atlasBadge.variant : badgeVariant(itemType);

                  const Inner = (
                    <>
                      <div
                        className="cc-thumb"
                        style={{ backgroundImage: coverUrl ? `url(${coverUrl})` : undefined }}
                        aria-hidden="true"
                      >
                        <span className={`cc-thumb-badge badge badge-soft badge-${badgeVar}`}>{badgeText}</span>
                      </div>

                      <div className="cc-body">
                        <h3 className="cc-title">{titleText}</h3>

                        {view === 'list' ? (
                          excerpt ? <p className="cc-excerpt">{excerpt}</p> : null
                        ) : (
                          <span className="sr-only">{excerpt}</span>
                        )}
                      </div>
                    </>
                  );

                  const key = `${entity}:${slug || idx}`;
                  const cardClass = `cc-card ui-card ${view === 'list' ? 'cc-card--list' : ''}`;

                  return toHref ? (
                    <Link key={key} to={toHref} className={cardClass}>
                      {Inner}
                    </Link>
                  ) : (
                    <div key={key} className={`${cardClass} cc-card--disabled`} title="Slug manquant">
                      {Inner}
                    </div>
                  );
                })}
            </section>

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
          <span className="cc-typedesc">60 cas issus du SFCO</span>
        </Link>
      </div>
    </section>
  );
}
