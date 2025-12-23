// src/lib/pathologyCache.js
import { strapiFetch, imgUrl } from './strapi';

const STORE = new Map();
const INFLIGHT = new Map();

const PATHO_ENDPOINT = import.meta.env.VITE_PATHO_ENDPOINT || '/pathologies';
const DEFAULT_PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

function storageKey(slug) {
  return `pathology-cache:${slug}`;
}

export function getPathologyFromCache(slug) {
  if (!slug) return null;
  if (STORE.has(slug)) return STORE.get(slug);

  try {
    const raw = sessionStorage.getItem(storageKey(slug));
    if (raw) {
      const val = JSON.parse(raw);
      STORE.set(slug, val);
      return val;
    }
  } catch {}
  return null;
}

export function setPathologyToCache(slug, data) {
  if (!slug || !data) return;
  STORE.set(slug, data);
  try {
    sessionStorage.setItem(storageKey(slug), JSON.stringify(data));
  } catch {}
}

function isCacheSufficient(cached) {
  if (!cached) return false;
  return Boolean(
    cached.content ||
      Array.isArray(cached.qa_blocks) ||
      Array.isArray(cached.quiz_blocks) ||
      Array.isArray(cached.cases)
  );
}

export async function prefetchPathology(slug, opts = {}) {
  if (!slug) return null;

  const cached = getPathologyFromCache(slug);
  if (isCacheSufficient(cached)) return cached;

  if (INFLIGHT.has(slug)) {
    try {
      return await INFLIGHT.get(slug);
    } catch {}
  }

  const publicationState = opts.publicationState || DEFAULT_PUB_STATE;

  const loadOnce = ({ withQa, withQuiz, withCases }) =>
    strapiFetch(PATHO_ENDPOINT, {
      params: {
        filters: { slug: { $eq: slug } },
        locale: 'all',
        publicationState,
        populate: {
          cover: { fields: ['url', 'formats'] },

          ...(withQa ? { qa_blocks: { populate: '*' } } : {}),
          ...(withQuiz ? { quiz_blocks: { populate: { propositions: true } } } : {}),

          ...(withCases
            ? {
                cases: {
                  fields: ['title', 'slug', 'excerpt', 'type'],
                  populate: { cover: { fields: ['url', 'formats'] } },
                  sort: ['slug:asc'],
                },
              }
            : {}),
        },
        fields: ['title', 'slug', 'excerpt', 'content', 'updatedAt', 'references', 'copyright'],
        pagination: { page: 1, pageSize: 1 },
      },
    });

  const p = (async () => {
    try {
      let res;

      try {
        res = await loadOnce({ withQa: true, withQuiz: true, withCases: true });
      } catch (err) {
        const msg = err?.message || '';
        const qaInvalid = /Invalid key qa_blocks/i.test(msg);
        const quizInvalid = /Invalid key quiz_blocks/i.test(msg);
        const casesInvalid = /Invalid key cases/i.test(msg);

        if (qaInvalid || quizInvalid || casesInvalid) {
          res = await loadOnce({
            withQa: !qaInvalid,
            withQuiz: !quizInvalid,
            withCases: !casesInvalid,
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
      setPathologyToCache(slug, full);
      return full;
    } finally {
      INFLIGHT.delete(slug);
    }
  })();

  INFLIGHT.set(slug, p);
  return p;
}
