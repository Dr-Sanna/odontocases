/**
 * CasCliniques.jsx
 * ----------------
 * - Écran "TypePicker" quand type=all et pas de recherche (q vide)
 * - Liste Strapi paginée
 * - Tri par numéro dans le slug (ex: qa-01, qa-12, quiz-03…)
 * - Cartes CC : cover + titre (2 lignes max) + badge absolu sur image
 *   => className="cc-card ui-card" + cc-thumb/cc-thumb-badge/cc-body/cc-title
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import { strapiFetch, imgUrl } from '../lib/strapi';
import './CasCliniques.css';

const TYPE_TABS = [
  { key: 'all', label: 'Tous' },
  { key: 'qa', label: 'Q/R' },
  { key: 'quiz', label: 'Quiz' },
  { key: 'presentation', label: 'Présentation' },
];

const PAGE_SIZE = 12;
const MIXED_PAGE_SIZE = 80;
const FALLBACK_PAGE_SIZE = 300;

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const PATHO_ENDPOINT = import.meta.env.VITE_PATHO_ENDPOINT || '/pathologies';

function normalizeNode(node) {
  return node?.attributes ? node.attributes : node;
}

function normalizeRelationArray(rel) {
  if (!rel) return [];
  if (Array.isArray(rel)) return rel.map(normalizeNode).filter(Boolean);
  if (Array.isArray(rel.data)) return rel.data.map(normalizeNode).filter(Boolean);
  if (Array.isArray(rel?.results)) return rel.results.map(normalizeNode).filter(Boolean);
  return [];
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

function typeLabel(type) {
  if (type === 'qa') return 'Q/R';
  if (type === 'quiz') return 'Quiz';
  return 'Présentation';
}

function badgeVariant(type) {
  if (type === 'qa') return 'success';
  if (type === 'quiz') return 'info';
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

export default function CasCliniques() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  const [caseToPatho, setCaseToPatho] = useState({});

  const q = searchParams.get('q') || '';
  const tab = searchParams.get('type') || 'all';
  const page = Number(searchParams.get('page') || 1);

  const showTypePicker = tab === 'all' && !q;
  const isPresentationTab = tab === 'presentation';
  const isMixedSearch = tab === 'all' && !!q;

  const variants = useMemo(() => (q ? buildVariants(q) : []), [q]);

  const onTab = (key) => {
    const next = new URLSearchParams(searchParams);
    next.set('type', key);
    next.set('page', '1');
    setSearchParams(next, { replace: true });
  };

  const onPage = (p) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(p));
    setSearchParams(next);
  };

  const caseTypeFilterOnly = useMemo(() => {
    const f = {};
    if (tab !== 'all' && tab !== 'presentation') {
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
        if (isMixedSearch) {
          const [pathoData, caseData] = await Promise.all([
            strapiFetch(PATHO_ENDPOINT, {
              params: {
                populate: {
                  cover: { fields: ['url', 'formats'] },
                  cases: { fields: ['title', 'slug', 'type', 'excerpt'] },
                },
                locale: 'all',
                filters: {
                  $or: [
                    ...buildOrFilterFromVariants(variants),
                    ...variants.flatMap((v) => [
                      { cases: { title: { $containsi: v } } },
                      { cases: { excerpt: { $containsi: v } } },
                      { cases: { slug: { $containsi: v } } },
                    ]),
                  ],
                },
                sort: 'slug:asc',
                pagination: { page: 1, pageSize: MIXED_PAGE_SIZE },
                fields: ['title', 'slug', 'excerpt', 'updatedAt'],
                publicationState: 'live',
              },
            }),
            strapiFetch(CASES_ENDPOINT, {
              params: {
                populate: { cover: { fields: ['url', 'formats'] } },
                locale: 'all',
                filters: caseFilters,
                sort: 'slug:asc',
                pagination: { page: 1, pageSize: MIXED_PAGE_SIZE },
                fields: ['title', 'slug', 'type', 'excerpt', 'updatedAt'],
                publicationState: 'live',
              },
            }),
          ]);

          if (ignore) return;

          const pathoListRaw = Array.isArray(pathoData?.data) ? pathoData.data : [];
          const map = {};

          for (const pNode of pathoListRaw) {
            const p = normalizeNode(pNode);
            if (!p?.slug) continue;

            const kids = normalizeRelationArray(p?.cases);
            for (const c of kids) {
              const cc = normalizeNode(c);
              if (!cc?.slug) continue;
              if (!map[cc.slug]) map[cc.slug] = { slug: p.slug, title: p.title || p.slug };
            }
          }

          setCaseToPatho(map);

          const pathoList = pathoListRaw
            .map((n) => ({ ...normalizeNode(n), __entity: 'pathology' }))
            .filter((it) => it?.slug);

          const caseListRaw = Array.isArray(caseData?.data) ? caseData.data : [];
          const caseList = caseListRaw
            .map((n) => ({ ...normalizeNode(n), __entity: 'case' }))
            .filter((it) => it?.slug);

          let finalCaseList = caseList;

          if (q && finalCaseList.length === 0) {
            const fallback = await strapiFetch(CASES_ENDPOINT, {
              params: {
                populate: { cover: { fields: ['url', 'formats'] } },
                locale: 'all',
                filters: caseTypeFilterOnly,
                sort: 'slug:asc',
                pagination: { page: 1, pageSize: FALLBACK_PAGE_SIZE },
                fields: ['title', 'slug', 'type', 'excerpt', 'updatedAt'],
                publicationState: 'live',
              },
            });

            const all = Array.isArray(fallback?.data) ? fallback.data : [];
            finalCaseList = all
              .map((n) => ({ ...normalizeNode(n), __entity: 'case' }))
              .filter((it) => it?.slug)
              .filter((it) => itemMatchesQuery(it, q));
          }

          const seen = new Set();
          const merged = [];
          for (const it of [...pathoList, ...finalCaseList]) {
            const key = `${it.__entity}:${it.slug}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(it);
          }

          setItems(merged);
          setTotal(merged.length);
          return;
        }

        const endpoint = isPresentationTab ? PATHO_ENDPOINT : CASES_ENDPOINT;

        const baseParams = isPresentationTab
          ? {
              populate: { cover: { fields: ['url', 'formats'] } },
              locale: 'all',
              filters: pathoFilters,
              sort: 'slug:asc',
              pagination: { page, pageSize: PAGE_SIZE },
              fields: ['title', 'slug', 'excerpt', 'updatedAt'],
              publicationState: 'live',
            }
          : {
              populate: { cover: { fields: ['url', 'formats'] } },
              locale: 'all',
              filters: caseFilters,
              sort: 'slug:asc',
              pagination: { page, pageSize: PAGE_SIZE },
              fields: ['title', 'slug', 'type', 'excerpt', 'updatedAt'],
              publicationState: 'live',
            };

        const data = await strapiFetch(endpoint, { params: baseParams });
        if (ignore) return;

        let list = Array.isArray(data?.data) ? data.data : [];
        let normalized = list.map(normalizeNode).filter((it) => it?.slug);

        if (q && normalized.length === 0) {
          const fallback = await strapiFetch(endpoint, {
            params: {
              ...baseParams,
              filters: isPresentationTab ? {} : caseTypeFilterOnly,
              pagination: { page: 1, pageSize: FALLBACK_PAGE_SIZE },
            },
          });

          const all = Array.isArray(fallback?.data) ? fallback.data : [];
          normalized = all
            .map(normalizeNode)
            .filter((it) => it?.slug)
            .filter((it) => itemMatchesQuery(it, q));
        }

        setItems(normalized);
        setTotal(data?.meta?.pagination?.total ?? normalized.length ?? 0);
        setCaseToPatho({});
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
  }, [
    showTypePicker,
    page,
    isPresentationTab,
    isMixedSearch,
    q,
    variants,
    caseFilters,
    pathoFilters,
    caseTypeFilterOnly,
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sortedItems = useMemo(() => {
    const arr = Array.isArray(items) ? [...items] : [];
    arr.sort(compareBySlugNumberAsc);
    return arr;
  }, [items]);

  const prefetchByType = useMemo(() => {
    if (isPresentationTab || isMixedSearch) return {};
    const map = {};
    for (const it of sortedItems) {
      if (!it?.slug || !it?.type) continue;
      if (!map[it.type]) map[it.type] = [];
      map[it.type].push({ slug: it.slug, title: it.title, type: it.type });
    }
    for (const t of Object.keys(map)) map[t].sort(compareBySlugNumberAsc);
    return map;
  }, [sortedItems, isPresentationTab, isMixedSearch]);

  useEffect(() => {
    try {
      for (const [t, list] of Object.entries(prefetchByType)) {
        sessionStorage.setItem(`cd-prefetch-${t}`, JSON.stringify(list));
      }
    } catch {
      /* ignore */
    }
  }, [prefetchByType]);

  return (
    <>
      <div className="page-header">
        <div className="container">
          <PageTitle description="Bibliothèque de cas cliniques pour s'entraîner, adaptés à la pratique en pathologie orale.">
            Cas Cliniques
          </PageTitle>
        </div>
      </div>

      <div className="container">
        {showTypePicker && <TypePicker onPick={onTab} />}

        {!showTypePicker && (
          <section className="cc-toolbar">
            <div className="cc-tabs">
              {TYPE_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`cc-tab ${tab === t.key ? 'active' : ''}`}
                  onClick={() => onTab(t.key)}
                  type="button"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {!showTypePicker && (
          <>
            <section className="cc-grid">
              {loading && <div className="cc-state">Chargement…</div>}
              {error && !loading && <div className="cc-state error">{error}</div>}
              {!loading && !error && sortedItems.length === 0 && <div className="cc-state">Aucun résultat.</div>}

              {!loading &&
                !error &&
                sortedItems.length > 0 &&
                sortedItems.map((attrs, idx) => {
                  if (!attrs) return null;

                  const entity = attrs.__entity || (isPresentationTab ? 'pathology' : 'case');

                  const title = attrs?.title || 'Sans titre';
                  const slug = attrs?.slug || '';
                  const excerpt = attrs?.excerpt || '';

                  const type = entity === 'pathology' ? 'presentation' : attrs?.type || 'qa';

                  const relatedPrefetch =
                    entity === 'case' && !isPresentationTab && !isMixedSearch ? prefetchByType[type] || [] : [];

                  const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
                  const coverUrl = imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || '';

                  let toHref = null;
                  if (slug) {
                    if (entity === 'pathology') {
                      toHref = `/cas-cliniques/presentation/${slug}`;
                    } else if (type === 'presentation' && caseToPatho[slug]?.slug) {
                      toHref = `/cas-cliniques/presentation/${caseToPatho[slug].slug}/${slug}`;
                    } else {
                      toHref = `/cas-cliniques/${slug}`;
                    }
                  }

                  const linkState =
                    entity === 'pathology'
                      ? {
                          prefetch: { slug, title, coverUrl, excerpt, entity: 'pathology' },
                          breadcrumb: { mode: 'presentation', pathology: { slug, title }, case: null },
                        }
                      : type === 'presentation' && caseToPatho[slug]?.slug
                        ? {
                            prefetch: { slug, title, type, coverUrl, excerpt, entity: 'case' },
                            breadcrumb: {
                              mode: 'presentation',
                              pathology: caseToPatho[slug],
                              case: { slug, title },
                            },
                          }
                        : { prefetch: { slug, title, type, coverUrl, excerpt, entity: 'case' }, relatedPrefetch };

                  const Inner = (
                    <>
                      <div
                        className="cc-thumb"
                        style={{ backgroundImage: coverUrl ? `url(${coverUrl})` : undefined }}
                        aria-hidden="true"
                      >
                        <span className={`cc-thumb-badge badge badge-soft badge-${badgeVariant(type)}`}>
                          {typeLabel(type)}
                        </span>
                      </div>

                      <div className="cc-body">
                        <h3 className="cc-title">{title}</h3>
                      </div>
                    </>
                  );

                  const key = `${entity}:${slug || idx}`;

                  return toHref ? (
                    <Link key={key} to={toHref} state={linkState} className="cc-card ui-card">
                      {Inner}
                    </Link>
                  ) : (
                    <div key={key} className="cc-card ui-card cc-card--disabled" title="Slug manquant">
                      {Inner}
                    </div>
                  );
                })}
            </section>

            {!isMixedSearch && pages > 1 && (
              <nav className="cc-pagination">
                <button disabled={page <= 1} onClick={() => onPage(page - 1)} type="button">
                  Précédent
                </button>
                <span>
                  Page {page} / {pages}
                </span>
                <button disabled={page >= pages} onClick={() => onPage(page + 1)} type="button">
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

function TypePicker({ onPick }) {
  return (
    <section className="cc-typepicker">
      <h3>Choisissez un type de cas</h3>
      <div className="cc-typegrid">
        <button className="cc-typecard ui-card" onClick={() => onPick('qa')} type="button">
          <span className="cc-type">Q/R</span>
          <span className="cc-typedesc">12 items d'internat issus du CNECO</span>
        </button>
        <button className="cc-typecard ui-card" onClick={() => onPick('quiz')} type="button">
          <span className="cc-type">Quiz diagnostic</span>
          <span className="cc-typedesc">60 cas issus du SFCO</span>
        </button>
        <button className="cc-typecard ui-card" onClick={() => onPick('presentation')} type="button">
          <span className="cc-type">Présentation</span>
          <span className="cc-typedesc">Atlas de pathologies + cas issus de la littérature</span>
        </button>
      </div>
    </section>
  );
}
