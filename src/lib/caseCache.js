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
//   - Préchargement complet (content + qa_blocks + cover)
//   - Fallback sans qa_blocks si le serveur ne connaît pas encore la clé
//   - Dé-duplique les requêtes en cours (inflight)

import { strapiFetch, imgUrl } from './strapi';

const STORE = new Map();       // cache mémoire
const INFLIGHT = new Map();    // promesses en cours pour éviter les doublons

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
  } catch { /* ignore */ }
  return null;
}

export function setCaseToCache(slug, data) {
  if (!slug || !data) return;
  STORE.set(slug, data);
  try {
    sessionStorage.setItem(storageKey(slug), JSON.stringify(data));
  } catch { /* ignore */ }
}

/**
 * Précharge un cas complet (content + qa_blocks + cover).
 * Ne refait rien si le cache possède déjà du contenu significatif.
 * @param {string} slug
 * @param {{publicationState?: 'live'|'preview'}} opts
 * @returns {Promise<object|null>}
 */
export async function prefetchCase(slug, opts = {}) {
  if (!slug) return null;

  // Si le cache contient déjà une version "complète", on la retourne.
  const cached = getCaseFromCache(slug);
  if (cached && (cached.content || Array.isArray(cached.qa_blocks))) return cached;

  // Dé-duplique : si une requête est déjà en cours pour ce slug, on l'attend.
  if (INFLIGHT.has(slug)) {
    try { return await INFLIGHT.get(slug); }
    catch { /* retentera plus bas */ }
  }

  const publicationState = opts.publicationState || DEFAULT_PUB_STATE;

  // Helper interne avec/sans populate qa_blocks
  const loadOnce = (withQa) =>
    strapiFetch(CASES_ENDPOINT, {
      params: {
        filters: { slug: { $eq: slug } },
        locale: 'all',
        publicationState,
        populate: withQa
          ? {
              cover: { fields: ['url', 'formats'] },
              qa_blocks: { populate: '*' },
            }
          : { cover: { fields: ['url', 'formats'] } },
        fields: ['title', 'slug', 'type', 'excerpt', 'content', 'updatedAt'],
        pagination: { page: 1, pageSize: 1 },
      },
    });

  const p = (async () => {
    try {
      let res;
      try {
        res = await loadOnce(true);
      } catch (err) {
        const msg = err?.message || '';
        if (/Invalid key qa_blocks/i.test(msg)) {
          res = await loadOnce(false);
        } else {
          throw err;
        }
      }

      const node  = Array.isArray(res?.data) ? res.data[0] : null;
      const attrs = node?.attributes ? node.attributes : node;
      if (!attrs) return null;

      const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
      const coverUrl  =
        imgUrl(coverAttr, 'large') ||
        imgUrl(coverAttr, 'medium') ||
        imgUrl(coverAttr) ||
        null;

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
