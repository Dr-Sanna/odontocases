/**
 * CasCliniques.jsx
 * ----------------
 * - Écran "TypePicker" quand type=all et pas de recherche (q vide)
 * - Liste Strapi paginée
 * - Tri par numéro dans le slug (ex: qa-01, qa-12, quiz-03…)
 * - Cartes compactes (cover + titre + chip), pas d’excerpt affiché
 *
 * + 2 niveaux:
 * - quand q est vide: on demande à Strapi uniquement les cas racine (parent_case null)
 *   => pagination cohérente (les enfants ne comptent plus)
 * - quand q est renseigné: on laisse Strapi renvoyer aussi les enfants (recherche)
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

  // ✅ filtres Strapi (IMPORTANT : filtre racine côté API quand q est vide)
  const filters = useMemo(() => {
    const f = {};

    if (tab !== 'all') f.type = { $eq: tab };

    if (q) {
      f.$or = [{ title: { $containsi: q } }, { excerpt: { $containsi: q } }];
    } else {
      // ✅ on ne veut que les cas racine (les enfants ont parent_case != null)
      // Variante robuste:
      f.parent_case = { id: { $null: true } };

      // Si jamais Strapi n'aime pas id.$null, essaie plutôt:
      // f.parent_case = { $null: true };
    }

    return f;
  }, [tab, q]);

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
            populate: {
              cover: { fields: ['url', 'formats'] },
              parent_case: { fields: ['slug'] }, // utile pour debug + cohérence
            },
            locale: 'all',
            filters,
            sort: 'slug:asc',
            pagination: { page, pageSize: PAGE_SIZE },
            fields: ['title', 'slug', 'type', 'kind', 'excerpt', 'updatedAt'],
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

  const sortedItems = useMemo(() => {
    const arr = Array.isArray(items) ? [...items] : [];
    arr.sort(compareBySlugNumberAsc);
    return arr;
  }, [items]);

  // relatedPrefetch (basé sur ce que la page courante contient)
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

              {!loading && !error && sortedItems.length === 0 && (
                <div className="cc-state">Aucun résultat.</div>
              )}

              {!loading &&
                !error &&
                sortedItems.length > 0 &&
                sortedItems.map((node, idx) => {
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

                  const key = slug || `case-${idx}`;

                  return toHref ? (
                    <Link key={key} to={toHref} state={linkState} className="cc-card">
                      {Inner}
                    </Link>
                  ) : (
                    <div key={key} className="cc-card cc-card--disabled" title="Slug manquant">
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
        <button className="cc-typecard" onClick={() => onPick('qa')} type="button">
          <span className="cc-type">Q/R</span>
          <span className="cc-typedesc">12 items d'internat issus du CNECO</span>
        </button>
        <button className="cc-typecard" onClick={() => onPick('quiz')} type="button">
          <span className="cc-type">Quiz diagnostic</span>
          <span className="cc-typedesc">60 cas issus du SFCO</span>
        </button>
        <button className="cc-typecard" onClick={() => onPick('presentation')} type="button">
          <span className="cc-type">Présentation</span>
          <span className="cc-typedesc">Case Reports issus de la littérature</span>
        </button>
      </div>
    </section>
  );
}
