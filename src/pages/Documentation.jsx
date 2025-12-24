// src/pages/Documentation.jsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import { strapiFetch, imgUrl } from '../lib/strapi';
import './Documentation.css';

const DOCS_ENDPOINT = import.meta.env.VITE_DOCS_ENDPOINT || '/doc-nodes';
const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

const ROOT_TITLE = 'Documentation';
const ROOT_DESC =
  "Atlas de pathologies buccales, items principaux et risques médicaux à connaître dans la pratique quotidienne";

function safeJsonGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeJsonSet(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function getDocTitleFromIndex(slug) {
  if (!slug) return null;
  const idx = safeJsonGet('doc-index');
  return idx?.[slug]?.title || null;
}

function setDocTitleToIndex(slug, title) {
  if (!slug || !title) return;
  const idx = safeJsonGet('doc-index') || {};
  idx[slug] = { title };
  safeJsonSet('doc-index', idx);
}

function getListCacheKey(level, parentSlug) {
  return `doc-list:${level}:${parentSlug || 'root'}`;
}

function getCachedList(level, parentSlug) {
  const key = getListCacheKey(level, parentSlug);
  const cached = safeJsonGet(key);
  return Array.isArray(cached) ? cached : null;
}

function setCachedList(level, parentSlug, list) {
  if (!Array.isArray(list)) return;
  const key = getListCacheKey(level, parentSlug);
  safeJsonSet(key, list);
}

function normalizeEntity(node) {
  if (!node) return null;
  if (node.attributes) return { id: node.id, ...node.attributes };
  return node;
}

export default function Documentation() {
  const { subjectSlug = null, chapterSlug = null } = useParams();

  const isRoot = !subjectSlug && !chapterSlug;
  const level = isRoot ? 'subject' : !chapterSlug ? 'chapter' : 'item';
  const parentSlug = isRoot ? null : !chapterSlug ? subjectSlug : chapterSlug;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [list, setList] = useState(() => getCachedList(level, parentSlug) || []);

  // titre header depuis l’index (jamais fallback vers slug)
  const headerTitle = useMemo(() => {
    if (isRoot) return ROOT_TITLE;
    if (chapterSlug) return getDocTitleFromIndex(chapterSlug) || '';
    return getDocTitleFromIndex(subjectSlug) || '';
  }, [isRoot, subjectSlug, chapterSlug]);

  // si titre manquant (reload deep link), on fetch juste le titre du parent pour remplir l’index
  useEffect(() => {
    let ignore = false;

    async function hydrateParentTitleBySlug(slugToLoad) {
      if (!slugToLoad) return;
      if (getDocTitleFromIndex(slugToLoad)) return;

      try {
        const res = await strapiFetch(DOCS_ENDPOINT, {
          params: {
            locale: 'all',
            publicationState: PUB_STATE,
            filters: { slug: { $eq: slugToLoad } },
            fields: ['title', 'slug'],
            pagination: { page: 1, pageSize: 1 },
          },
        });

        if (ignore) return;

        const node = Array.isArray(res?.data) ? res.data[0] : null;
        const attrs = normalizeEntity(node);
        if (attrs?.slug && attrs?.title) setDocTitleToIndex(attrs.slug, attrs.title);
      } catch {
        // si ça échoue, on garde juste le skeleton (pas de slug)
      }
    }

    if (!isRoot) {
      const slug = chapterSlug || subjectSlug;
      hydrateParentTitleBySlug(slug);
    }

    return () => {
      ignore = true;
    };
  }, [isRoot, subjectSlug, chapterSlug]);

  // boot instant depuis cache quand on change de niveau
  useEffect(() => {
    const cached = getCachedList(level, parentSlug);
    if (cached) setList(cached);
    else setList([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, parentSlug]);

  useEffect(() => {
    let ignore = false;

    async function load() {
      setLoading(true);
      setError('');

      try {
        const filters = { level: { $eq: level } };
        if (parentSlug) filters.parent = { slug: { $eq: parentSlug } };

        const res = await strapiFetch(DOCS_ENDPOINT, {
          params: {
            locale: 'all',
            publicationState: PUB_STATE,
            filters,
            fields: ['title', 'slug', 'excerpt', 'level', 'updatedAt'],
            populate: { cover: { fields: ['url', 'formats'] } },
            sort: 'title:asc',
            pagination: { page: 1, pageSize: 500 },
          },
        });

        if (ignore) return;

        const rows = Array.isArray(res?.data) ? res.data : [];
        const normalized = rows
          .map(normalizeEntity)
          .filter(Boolean)
          .filter((n) => n?.slug);

        const cooked = normalized.map((n) => {
          const coverAttr = n?.cover?.data?.attributes || n?.cover || null;
          const coverUrl =
            imgUrl(coverAttr, 'medium') || imgUrl(coverAttr, 'thumbnail') || imgUrl(coverAttr) || '';
          return { ...n, coverUrl };
        });

        // index titres
        for (const n of cooked) {
          if (n?.slug && n?.title) setDocTitleToIndex(n.slug, n.title);
        }

        setList(cooked);
        setCachedList(level, parentSlug, cooked);
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
  }, [level, parentSlug]);

  const description = isRoot ? ROOT_DESC : '';

  return (
    <>
      <div className="page-header">
        <div className="container">
          {headerTitle ? (
            <PageTitle description={description}>{headerTitle}</PageTitle>
          ) : (
            <div className="doc-title-skel" aria-hidden="true">
              <div className="doc-sk-line doc-sk-h24 doc-sk-w55" />
              {isRoot ? (
                <div className="doc-sk-line doc-sk-h16 doc-sk-w90" />
              ) : (
                <div className="doc-header-spacer" />
              )}
            </div>
          )}

          {/* garde la hauteur de la description sur toutes les sous-routes */}
          {!isRoot && <div className="doc-header-spacer" aria-hidden="true" />}
        </div>
      </div>

      <div className="container">
        <section className="doc-grid">
          {loading && list.length === 0 && <div className="doc-state">Chargement…</div>}
          {!loading && error && <div className="doc-state error">{error}</div>}
          {!loading && !error && list.length === 0 && <div className="doc-state">Aucun contenu.</div>}

          {!error &&
            list.map((n) => {
              const title = n?.title || '';
              const slug = n?.slug || '';
              if (!slug) return null;

              let to = '/documentation';
              if (level === 'subject') to = `/documentation/${slug}`;
              if (level === 'chapter') to = `/documentation/${subjectSlug}/${slug}`;
              if (level === 'item') to = `/documentation/${subjectSlug}/${chapterSlug}/${slug}`;

              return (
                <Link
                  key={`${level}:${slug}`}
                  to={to}
                  className="doc-card ui-card"
                  state={{ prefetch: { slug, title, type: 'doc' } }}
                >
                  <div
                    className="doc-thumb"
                    style={n.coverUrl ? { backgroundImage: `url(${n.coverUrl})` } : undefined}
                    aria-hidden="true"
                  />
                  <div className="doc-body">
                    <div className="doc-meta">
                      <span className={`doc-chip doc-${level}`} aria-label={level} />

                    </div>
                    <h3 className="doc-title">{title}</h3>
                    {n?.excerpt ? <p className="doc-excerpt">{n.excerpt}</p> : null}
                  </div>
                </Link>
              );
            })}
        </section>
      </div>
    </>
  );
}
