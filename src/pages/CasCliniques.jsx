/**
 * CasCliniques.jsx
 * ----------------
 * - Breadcrumb supprimé ici
 * - Tri des cartes par slug numérique (1,2,3…10)
 * - PAS d’excerpt affiché dans les cartes (cover + titre + chip)
 * - Passe à CaseDetail: prefetch (titre/type/coverUrl) + relatedPrefetch (liste triée)
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import Background from '../components/Background';
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

/** Tri par numéro trouvé dans le slug (asc). */
function compareBySlugNumberAsc(aNode, bNode) {
  const a = aNode?.attributes ? aNode.attributes : aNode;
  const b = bNode?.attributes ? bNode.attributes : bNode;
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

export default function CasCliniques() {
  const [searchParams, setSearchParams] = useSearchParams();

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [items, setItems]   = useState([]);
  const [total, setTotal]   = useState(0);

  // URL params
  const q    = searchParams.get('q')    || '';
  const tab  = searchParams.get('type') || 'all';
  const page = Number(searchParams.get('page') || 1);

  // Onglets
  const onTab = (key) => {
    const next = new URLSearchParams(searchParams);
    next.set('type', key);
    next.set('page', '1');
    setSearchParams(next, { replace: true });
  };
  // Pagination
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
        { title:   { $containsi: q } },
        { excerpt: { $containsi: q } },
      ];
    }
    return f;
  }, [tab, q]);

  const showTypePicker = tab === 'all' && !q;

  // Chargement
  useEffect(() => {
    let ignore = false;

    if (showTypePicker) {
      setItems([]); setTotal(0); setLoading(false); setError('');
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
            sort: 'updatedAt:desc', // on retriera côté front
            pagination: { page, pageSize: PAGE_SIZE },
            fields: ['title', 'slug', 'type', 'excerpt', 'updatedAt'],
            publicationState: 'live',
          },
        });
        if (!ignore) {
          const list = Array.isArray(data?.data) ? data.data : [];
          setItems(list);
          setTotal(data?.meta?.pagination?.total ?? list.length ?? 0);
        }
      } catch (e) {
        if (!ignore) setError(e.message || 'Erreur de chargement');
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => { ignore = true; };
  }, [filters, page, showTypePicker]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Tri front
  const sortedItems = useMemo(() => {
    const arr = Array.isArray(items) ? [...items] : [];
    arr.sort(compareBySlugNumberAsc);
    return arr;
  }, [items]);

  // Prépare des pré-listes par type (slug/title/type minimal), triées
  const prefetchByType = useMemo(() => {
    const map = {};
    const attrsList = sortedItems
      .map(n => (n?.attributes ? n.attributes : n))
      .filter(Boolean);

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
    } catch { /* ignore */ }
  }, [prefetchByType]);

  return (
    <>
      <Background variant="secondary" />

      {/* En-tête (sans breadcrumb) */}
      <div className="page-header">
        <div className="container">
          <PageTitle description="Entraînez-vous avec des cas cliniques illustrés, adaptés à la pratique en pathologie orale.">
            Cas Cliniques
          </PageTitle>
        </div>
      </div>

      <div className="container">
        {/* Sélecteur initial (3 cartes) */}
        {showTypePicker && <TypePicker onPick={onTab} />}

        {/* Onglets */}
        {!showTypePicker && (
          <section className="cc-toolbar">
            <div className="cc-tabs">
              {TYPE_TABS.map(t => (
                <button
                  key={t.key}
                  className={`cc-tab ${tab === t.key ? 'active' : ''}`}
                  onClick={() => onTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Grille */}
        {!showTypePicker && (
          <>
            <section className="cc-grid">
              {loading && <div className="cc-state">Chargement…</div>}
              {error && !loading && <div className="cc-state error">{error}</div>}

              {!loading && !error && sortedItems.length === 0 && (
                <div className="cc-state">Aucun résultat.</div>
              )}

              {!loading && !error && sortedItems.length > 0 && sortedItems.map((node) => {
                const attrs = node?.attributes ? node.attributes : node;
                if (!attrs) return null;

                const { title='Sans titre', slug='', type='qa', excerpt='' } = attrs;

                // Liste préchargée du même type (pour l’aside de CaseDetail)
                const relatedPrefetch = prefetchByType[type] || [];

                const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
                const url = imgUrl(coverAttr, 'medium') || imgUrl(coverAttr);
                const toHref = slug ? `/cas-cliniques/${slug}` : null;
                const typeLabel = type === 'qa' ? 'Q/R' : type === 'quiz' ? 'Quizz' : 'Présentation';

                const linkState = {
                  prefetch: { slug, title, type, coverUrl: url, excerpt }, // excerpt transmis mais non affiché
                  relatedPrefetch,
                };

                const Inner = (
                  <>
                    <div className="cc-thumb" style={{ backgroundImage: url ? `url(${url})` : undefined }} />
                    <div className="cc-body">
                      <div className="cc-meta">
                        <span className={`cc-chip cc-${type}`}>{typeLabel}</span>
                      </div>
                      <h3 className="cc-title">{title}</h3>
                      {/* ⬇️ on n'affiche pas l'excerpt pour garder des cartes compactes */}
                    </div>
                  </>
                );

                return toHref ? (
                  <Link key={node.id ?? `${slug || 'case'}-${Math.random()}`} to={toHref} state={linkState} className="cc-card">
                    {Inner}
                  </Link>
                ) : (
                  <div key={node.id ?? `${slug || 'case'}-${Math.random()}`} className="cc-card cc-card--disabled" title="Slug manquant">
                    {Inner}
                  </div>
                );
              })}
            </section>

            {pages > 1 && (
              <nav className="cc-pagination">
                <button disabled={page <= 1} onClick={() => onPage(page - 1)}>Précédent</button>
                <span>Page {page} / {pages}</span>
                <button disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivant</button>
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
        <button className="cc-typecard" onClick={() => onPick('qa')}>
          <span className="cc-type">Q/R</span>
          <span className="cc-typedesc">Question / Réponse guidée</span>
        </button>
        <button className="cc-typecard" onClick={() => onPick('quiz')}>
          <span className="cc-type">Quizz</span>
          <span className="cc-typedesc">Quizz interactif</span>
        </button>
        <button className="cc-typecard" onClick={() => onPick('presentation')}>
          <span className="cc-type">Présentation</span>
          <span className="cc-typedesc">Cas présenté simplement</span>
        </button>
      </div>
    </section>
  );
}
