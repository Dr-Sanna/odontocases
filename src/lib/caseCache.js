// src/lib/caseCache.js
// --------------------
// Mini cache (mémoire + sessionStorage) pour les cas Strapi
// + helpers de préchargement utilisés par CaseDetail/Aside.
//
// Exporte :
//   - getCaseFromCache(slug)
//   - setCaseToCache(slug, data)
//   - prefetchCase(slug, { publicationState } )
//
// Comportement :
//   - Retour immédiat depuis le cache si possible
//   - Préchargement "détail" : content + qa_blocks + quiz_blocks + cover
//     + relations de 2e niveau : child_cases + parent_case (si présentes côté Strapi)
//   - Fallback si le serveur ne connaît pas certaines clés (qa_blocks / quiz_blocks / child_cases / parent_case)
//   - Dé-duplique les requêtes en cours (inflight)

import { strapiFetch, imgUrl } from './strapi';

const STORE = new Map(); // cache mémoire
const INFLIGHT = new Map(); // promesses en cours pour éviter les doublons

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const DEFAULT_PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

function storageKey(slug) {
  return `case-cache:${slug}`;
}

export function getCaseFromCache(slug) {
  if (!slug) return null;
  if (STORE.has(slug)) return STORE.get(slug);

  try {
    const raw = sessionStorage.getItem(storageKey(slug));
    if (raw) {
      const val = JSON.parse(raw);
      STORE.set(slug, val);
      return val;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setCaseToCache(slug, data) {
  if (!slug || !data) return;
  STORE.set(slug, data);

  try {
    sessionStorage.setItem(storageKey(slug), JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function isCacheSufficient(cached) {
  if (!cached) return false;

  // "suffisant" = on a déjà du contenu ou au moins un des blocs/relations utiles
  return Boolean(
    cached.content ||
      Array.isArray(cached.qa_blocks) ||
      Array.isArray(cached.quiz_blocks) ||
      Array.isArray(cached.child_cases)
  );
}

/**
 * Précharge un cas "détail".
 * Ne refait rien si le cache possède déjà une version suffisante.
 * @param {string} slug
 * @param {{publicationState?: 'live'|'preview'}} opts
 * @returns {Promise<object|null>}
 */
export async function prefetchCase(slug, opts = {}) {
  if (!slug) return null;

  const cached = getCaseFromCache(slug);
  if (isCacheSufficient(cached)) return cached;

  // Dé-duplique : si une requête est déjà en cours pour ce slug, on l'attend.
  if (INFLIGHT.has(slug)) {
    try {
      return await INFLIGHT.get(slug);
    } catch {
      /* retentera plus bas */
    }
  }

  const publicationState = opts.publicationState || DEFAULT_PUB_STATE;

  const loadOnce = ({ withQa, withQuiz, withChildren, withParent }) =>
    strapiFetch(CASES_ENDPOINT, {
      params: {
        filters: { slug: { $eq: slug } },
        locale: 'all',
        publicationState,
        populate: {
          cover: { fields: ['url', 'formats'] },

          ...(withQa ? { qa_blocks: { populate: '*' } } : {}),

          ...(withQuiz
            ? { quiz_blocks: { populate: { propositions: true } } }
            : {}),

          ...(withChildren
            ? {
                child_cases: {
                  fields: ['title', 'slug', 'excerpt', 'type', 'kind'],
                  populate: { cover: { fields: ['url', 'formats'] } },
                  sort: ['title:asc'],
                },
              }
            : {}),

          ...(withParent
            ? {
                parent_case: { fields: ['title', 'slug', 'type', 'kind'] },
              }
            : {}),
        },
        fields: ['title', 'slug', 'type', 'kind', 'excerpt', 'content', 'updatedAt'],
        pagination: { page: 1, pageSize: 1 },
      },
    });

  const p = (async () => {
    try {
      let res;

      try {
        res = await loadOnce({
          withQa: true,
          withQuiz: true,
          withChildren: true,
          withParent: true,
        });
      } catch (err) {
        const msg = err?.message || '';

        const qaInvalid = /Invalid key qa_blocks/i.test(msg);
        const quizInvalid = /Invalid key quiz_blocks/i.test(msg);
        const childInvalid = /Invalid key child_cases/i.test(msg);
        const parentInvalid = /Invalid key parent_case/i.test(msg);

        if (qaInvalid || quizInvalid || childInvalid || parentInvalid) {
          res = await loadOnce({
            withQa: !qaInvalid,
            withQuiz: !quizInvalid,
            withChildren: !childInvalid,
            withParent: !parentInvalid,
          });
        } else {
          throw err;
        }
      }

      const node = Array.isArray(res?.data) ? res.data[0] : null;
      const attrs = node?.attributes ? node.attributes : node;
      if (!attrs) return null;

      const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
      const coverUrl =
        imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || null;

      const full = { ...attrs, coverUrl };
      setCaseToCache(slug, full);
      return full;
    } finally {
      INFLIGHT.delete(slug);
    }
  })();

  INFLIGHT.set(slug, p);
  return p;
}
