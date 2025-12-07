/**
 * CasCliniques.jsx
 * ----------------
 * - Écran "TypePicker" quand type=all et pas de recherche (q vide)
 * - Liste Strapi paginée
 * - Tri par numéro dans le slug (ex: qa-01, qa-12, quiz-03…)
 * - Cartes compactes (cover + titre + chip), pas d’excerpt affiché
 * - Passage à CaseDetail : prefetch + relatedPrefetch (liste triée)
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import { strapiFetch, imgUrl } from '../lib/strapi';
import './CasCliniques.css';

const TYPE_TABS = [
  { key: 'all', label: 'Tous' },
  { key: 'qa', label: 'Q/R' },
  { key: 'quiz', label: 'Quizz' },
  { key: 'presentation', label: 'Présentation' },
];

const PAGE_SIZE = 12;
const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';

function normalizeNode(node) {
  return node?.attributes ? node.attributes : node;
}

/** Tri par numéro trouvé dans le slug (asc). Ex: qa-01, qa-12, quiz-03. */
function compareBySlugNumberAsc(aNode, bNode) {
  const a = normalizeNode(aNode);
  const b = normalizeNode(bNode);

  const sa = String(a?.slug ?? '');
  const sb = String(b?.slug ?? '');

  // prend le 1er groupe de chiffres rencontré
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
  if (type === 'quiz') return 'Quizz';
  return 'Présentation';
}

export default function CasCliniques() {
  const [searchParams, setSearchParams] = useSearchParams();

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  // URL params
  const q = searchParams.get('q') || '';
  const tab = searchParams.get('type') || 'all';
  const page = Number(searchParams.get('page') || 1);

  const showTypePicker = tab === 'all' && !q;

  // handlers URL
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

  // Filtres Strapi
  const filters = useMemo(() => {
    const f = {};
    if (tab !== 'all') f.type = { $eq: tab };
    if (q) {
      f.$or = [
        { title: { $containsi: q } },
        { excerpt: { $containsi: q } },
      ];
    }
    return f;
  }, [tab, q]);

  // Chargement
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
        const data = await strapiFetch(CASES_ENDPOINT, {
          params: {
            populate: { cover: { fields: ['url', 'formats'] } },
            locale: 'all',
            filters,
            // Si tes slugs sont "zéro-pad" (qa-01, qa-02...),
            // un sort lexicographique est déjà cohérent.
            // On retriera quand même côté front par sécurité.
            sort: 'slug:asc',
            pagination: { page, pageSize: PAGE_SIZE },
            fields: ['title', 'slug', 'type', 'excerpt', 'updatedAt'],
            publicationState: 'live',
          },
        });

        if (ignore) return;

        const list = Array.isArray(data?.data) ? data.data : [];
        setItems(list);
        setTotal(data?.meta?.pagination?.total ?? list.length ?? 0);
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
  }, [filters, page, showTypePicker]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Tri front (stabilise l’ordre, même si Strapi renvoie déjà trié)
  const sortedItems = useMemo(() => {
    const arr = Array.isArray(items) ? [...items] : [];
    arr.sort(compareBySlugNumberAsc);
    return arr;
  }, [items]);

  // Prépare des pré-listes par type (slug/title/type minimal), triées
  const prefetchByType = useMemo(() => {
    const map = {};
    const attrsList = sortedItems.map(normalizeNode).filter(Boolean);

    for (const it of attrsList) {
      if (!it?.slug || !it?.type) continue;
      if (!map[it.type]) map[it.type] = [];
      map[it.type].push({ slug: it.slug, title: it.title, type: it.type });
    }

    for (const t of Object.keys(map)) {
      map[t].sort(compareBySlugNumberAsc);
    }
    return map;
  }, [sortedItems]);

  // Cache léger en sessionStorage pour fallback depuis CaseDetail
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
          <PageTitle description="Entraînez-vous avec des cas cliniques illustrés, adaptés à la pratique en pathologie orale.">
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

              {!loading && !error && sortedItems.length === 0 && (
                <div className="cc-state">Aucun résultat.</div>
              )}

              {!loading && !error && sortedItems.length > 0 && sortedItems.map((node, idx) => {
                const attrs = normalizeNode(node);
                if (!attrs) return null;

                const { title = 'Sans titre', slug = '', type = 'qa', excerpt = '' } = attrs;

                const relatedPrefetch = prefetchByType[type] || [];

                const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
                const coverUrl = imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || '';

                const toHref = slug ? `/cas-cliniques/${slug}` : null;

                const linkState = {
                  prefetch: { slug, title, type, coverUrl, excerpt },
                  relatedPrefetch,
                };

                const Inner = (
                  <>
                    <div
                      className="cc-thumb"
                      style={{ backgroundImage: coverUrl ? `url(${coverUrl})` : undefined }}
                    />
                    <div className="cc-body">
                      <div className="cc-meta">
                        <span className={`cc-chip cc-${type}`}>{typeLabel(type)}</span>
                      </div>
                      <h3 className="cc-title">{title}</h3>
                    </div>
                  </>
                );

                // ✅ clé stable : slug en priorité (ton vrai identifiant), sinon fallback index
                const key = slug || `case-${idx}`;

                return toHref ? (
                  <Link key={key} to={toHref} state={linkState} className="cc-card">
                    {Inner}
                  </Link>
                ) : (
                  <div
                    key={key}
                    className="cc-card cc-card--disabled"
                    title="Slug manquant"
                  >
                    {Inner}
                  </div>
                );
              })}
            </section>

            {pages > 1 && (
              <nav className="cc-pagination">
                <button disabled={page <= 1} onClick={() => onPage(page - 1)} type="button">
                  Précédent
                </button>
                <span>Page {page} / {pages}</span>
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
        <button className="cc-typecard" onClick={() => onPick('qa')} type="button">
          <span className="cc-type">Q/R</span>
          <span className="cc-typedesc">12 articles issus du CNECO</span>
        </button>
        <button className="cc-typecard" onClick={() => onPick('quiz')} type="button">
          <span className="cc-type">Quizz</span>
          <span className="cc-typedesc">Quizz interactif</span>
        </button>
        <button className="cc-typecard" onClick={() => onPick('presentation')} type="button">
          <span className="cc-type">Présentation</span>
          <span className="cc-typedesc">Cas présenté simplement</span>
        </button>
      </div>
    </section>
  );
}
