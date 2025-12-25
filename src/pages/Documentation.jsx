// src/pages/Documentation.jsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import {
  getPrefetchedBySlug,
  getPrefetchedChildren,
  isDocsPrimed,
  primeDocsEssentials,
  revalidateDocsEssentials,
} from '../lib/docsPrefetchStore';
import './Documentation.css';

const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

const ROOT_TITLE = 'Documentation';
// Note: sous-titre affiché uniquement sur /documentation (racine).
// Il sert à expliquer en une phrase le contenu de la section.
const ROOT_DESC =
  "Atlas de pathologies buccales, items principaux et risques médicaux à connaître dans la pratique quotidienne";

function labelForLevel(level) {
  if (level === 'subject') return 'Matière';
  if (level === 'chapter') return 'Chapitre';
  if (level === 'item') return 'Item';
  if (level === 'section') return 'Section';
  return 'Documentation';
}

function toDocLink({ level, slug, subjectSlug, chapterSlug }) {
  if (!slug) return '/documentation';
  if (level === 'subject') return `/documentation/${slug}`;
  if (level === 'chapter') return `/documentation/${subjectSlug}/${slug}`;
  if (level === 'item') return `/documentation/${subjectSlug}/${chapterSlug}/${slug}`;
  return '/documentation';
}

function compareByOrderThenTitle(a, b) {
  const ao = Number.isFinite(a?.order) ? a.order : Number.POSITIVE_INFINITY;
  const bo = Number.isFinite(b?.order) ? b.order : Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;

  const at = String(a?.title || '');
  const bt = String(b?.title || '');
  return at.localeCompare(bt, 'fr', { sensitivity: 'base' });
}

export default function Documentation() {
  const { subjectSlug = null, chapterSlug = null } = useParams();

  const isRoot = !subjectSlug && !chapterSlug;
  const level = isRoot ? 'subject' : !chapterSlug ? 'chapter' : 'item';
  const parentSlug = isRoot ? null : !chapterSlug ? subjectSlug : chapterSlug;

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ✅ instant: depuis store
  const [list, setList] = useState(() => {
    const fromStore = getPrefetchedChildren(level, parentSlug, { publicationState: PUB_STATE });
    return Array.isArray(fromStore) ? [...fromStore].sort(compareByOrderThenTitle) : [];
  });

  // ✅ titre dynamique (sans fallback vers slug)
  const headerTitle = useMemo(() => {
    if (isRoot) return ROOT_TITLE;

    const parentNode = getPrefetchedBySlug(parentSlug, { publicationState: PUB_STATE });
    return parentNode?.title || '';
  }, [isRoot, parentSlug]);

  const description = isRoot ? ROOT_DESC : '';

  // À chaque navigation interne : hydratation instant depuis store
  useEffect(() => {
    const fromStore = getPrefetchedChildren(level, parentSlug, { publicationState: PUB_STATE });
    if (Array.isArray(fromStore)) setList([...fromStore].sort(compareByOrderThenTitle));
    else setList([]);
    setError('');
  }, [level, parentSlug]);

  // Prime si besoin (accès direct sans passer par HomePage)
  useEffect(() => {
    if (isDocsPrimed({ publicationState: PUB_STATE })) return;

    let ignore = false;
    const ctrl = new AbortController();

    setLoading(true);
    primeDocsEssentials({ publicationState: PUB_STATE, signal: ctrl.signal })
      .then(() => {
        if (ignore) return;
        const fromStore = getPrefetchedChildren(level, parentSlug, { publicationState: PUB_STATE });
        if (Array.isArray(fromStore)) setList([...fromStore].sort(compareByOrderThenTitle));
      })
      .catch((e) => {
        if (!ignore) setError(e?.message || 'Erreur de chargement');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revalidate en arrière-plan à chaque changement de niveau/parent
  // ✅ pas de flash "Chargement…" si on a déjà une liste
  useEffect(() => {
    let ignore = false;
    const ctrl = new AbortController();

    const hasInstant = list.length > 0;
    if (!hasInstant) setLoading(true);

    revalidateDocsEssentials({ publicationState: PUB_STATE, signal: ctrl.signal })
      .then(() => {
        if (ignore) return;
        const fromStore = getPrefetchedChildren(level, parentSlug, { publicationState: PUB_STATE });
        if (Array.isArray(fromStore)) setList([...fromStore].sort(compareByOrderThenTitle));
      })
      .catch((e) => {
        if (!ignore) setError(e?.message || 'Erreur de chargement');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, parentSlug]);

  return (
    <>
      <div className="page-header">
        <div className="container">
          {headerTitle ? (
            <PageTitle description={description}>{headerTitle}</PageTitle>
          ) : (
            <div className="doc-title-skel" aria-hidden="true">
              <div className="doc-sk-line doc-sk-h24 doc-sk-w55" />
              {isRoot ? <div className="doc-sk-line doc-sk-h16 doc-sk-w90" /> : <div className="doc-header-spacer" />}
            </div>
          )}

          {/* garde la hauteur de la description sur toutes les sous-routes */}
          {!isRoot && <div className="doc-header-spacer" aria-hidden="true" />}
        </div>
      </div>

      <div className="container">
        <div className="doc-gridwrap">
          {/* overlay discret seulement si on a déjà quelque chose à afficher */}
          {loading && list.length > 0 && (
            <div className="doc-loading" aria-hidden="true">
              <div className="doc-loading-pill">Mise à jour…</div>
            </div>
          )}

          <section className="doc-grid">
            {loading && list.length === 0 && <div className="doc-state">Chargement…</div>}
            {!loading && error && <div className="doc-state error">{error}</div>}
            {!loading && !error && list.length === 0 && <div className="doc-state">Aucun contenu.</div>}

            {!error &&
              list.map((n) => {
                const title = n?.title || '';
                const slug = n?.slug || '';
                if (!slug) return null;

                const to = toDocLink({ level, slug, subjectSlug, chapterSlug });
                const badgeLabel = labelForLevel(level);

                return (
                  <Link
                    key={`${level}:${slug}`}
                    to={to}
                    className="doc-card ui-card"
                    state={{ prefetch: { slug, title, type: 'doc' } }}
                  >
                    <div
                      className={n?.coverUrl ? 'doc-thumb' : 'doc-thumb is-empty'}
                      style={n?.coverUrl ? { backgroundImage: `url(${n.coverUrl})` } : undefined}
                      aria-hidden="true"
                    >
                      <div className="doc-thumb-overlay">
                        <span className="badge badge-soft badge-secondary" aria-label={level}>
                          {badgeLabel}
                        </span>
                        <h3 className="doc-thumb-title">{title}</h3>
                      </div>
                    </div>

                    {n?.excerpt ? (
                      <div className="doc-body">
                        <p className="doc-excerpt">{n.excerpt}</p>
                      </div>
                    ) : null}
                  </Link>
                );
              })}
          </section>
        </div>
      </div>
    </>
  );
}
