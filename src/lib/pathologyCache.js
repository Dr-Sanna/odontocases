// src/lib/pathologyCache.js
// Cache détail des pathologies : mémoire + sessionStorage, TTL, déduplication et invalidation.
import { strapiFetch, imgUrl } from './strapi';

const STORE = new Map();
const INFLIGHT = new Map();

const PATHO_ENDPOINT = import.meta.env.VITE_PATHO_ENDPOINT || '/pathologies';
const DEFAULT_PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';
const CACHE_VERSION = 2;
const FRESH_MS = Number(import.meta.env.VITE_DETAIL_CACHE_STALE_MS) || 30_000;
const MAX_AGE_MS = Number(import.meta.env.VITE_DETAIL_CACHE_MAX_AGE_MS) || 15 * 60_000;

function keyOf(slug, publicationState = DEFAULT_PUB_STATE) {
  return `${publicationState}:${slug}`;
}

function storageKey(slug, publicationState = DEFAULT_PUB_STATE) {
  return `odontocases:v${CACHE_VERSION}:pathology:${publicationState}:${slug}`;
}

function legacyStorageKey(slug) {
  return `pathology-cache:${slug}`;
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.__cacheVersion === CACHE_VERSION && value.data) {
    return { data: value.data, fetchedAt: Number(value.fetchedAt) || 0 };
  }
  return { data: value, fetchedAt: 0 };
}

function isExpired(entry, now = Date.now()) {
  return Boolean(entry?.fetchedAt && now - entry.fetchedAt > MAX_AGE_MS);
}

function readEntry(slug, publicationState = DEFAULT_PUB_STATE) {
  if (!slug) return null;
  const cacheKey = keyOf(slug, publicationState);
  const memory = STORE.get(cacheKey);
  if (memory) {
    if (isExpired(memory)) {
      deletePathologyFromCache(slug, { publicationState });
      return null;
    }
    return memory;
  }

  try {
    const raw = sessionStorage.getItem(storageKey(slug, publicationState));
    const legacyRaw = raw || sessionStorage.getItem(legacyStorageKey(slug));
    if (!legacyRaw) return null;

    const entry = normalizeEntry(JSON.parse(legacyRaw));
    if (!entry) return null;
    if (isExpired(entry)) {
      deletePathologyFromCache(slug, { publicationState });
      return null;
    }

    STORE.set(cacheKey, entry);
    if (!raw) {
      sessionStorage.setItem(
        storageKey(slug, publicationState),
        JSON.stringify({ __cacheVersion: CACHE_VERSION, ...entry })
      );
      sessionStorage.removeItem(legacyStorageKey(slug));
    }
    return entry;
  } catch {
    return null;
  }
}

export function getPathologyCacheEntry(slug, { publicationState = DEFAULT_PUB_STATE } = {}) {
  const entry = readEntry(slug, publicationState);
  if (!entry) return null;
  return {
    data: entry.data,
    fetchedAt: entry.fetchedAt,
    isFresh: Boolean(entry.fetchedAt && Date.now() - entry.fetchedAt <= FRESH_MS),
  };
}

export function getPathologyFromCache(slug, opts = {}) {
  return getPathologyCacheEntry(slug, opts)?.data || null;
}

export function isPathologyCacheFresh(slug, opts = {}) {
  return Boolean(getPathologyCacheEntry(slug, opts)?.isFresh);
}

export function setPathologyToCache(slug, data, { publicationState = DEFAULT_PUB_STATE } = {}) {
  if (!slug || !data) return;
  const entry = { data, fetchedAt: Date.now() };
  STORE.set(keyOf(slug, publicationState), entry);
  try {
    sessionStorage.setItem(
      storageKey(slug, publicationState),
      JSON.stringify({ __cacheVersion: CACHE_VERSION, ...entry })
    );
    sessionStorage.removeItem(legacyStorageKey(slug));
  } catch {}
}

export function deletePathologyFromCache(slug, { publicationState = DEFAULT_PUB_STATE } = {}) {
  if (!slug) return;
  STORE.delete(keyOf(slug, publicationState));
  INFLIGHT.delete(keyOf(slug, publicationState));
  try {
    sessionStorage.removeItem(storageKey(slug, publicationState));
    sessionStorage.removeItem(legacyStorageKey(slug));
  } catch {}
}

export function clearPathologyCache() {
  STORE.clear();
  INFLIGHT.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i) || '';
      if (key.startsWith(`odontocases:v${CACHE_VERSION}:pathology:`) || key.startsWith('pathology-cache:')) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {}
}

function isCacheSufficient(cached) {
  if (!cached) return false;
  return Boolean(
    (typeof cached.content === 'string' && cached.content.length > 0) ||
      Array.isArray(cached.qa_blocks) ||
      Array.isArray(cached.quiz_blocks) ||
      Array.isArray(cached.cases)
  );
}

export async function prefetchPathology(slug, opts = {}) {
  if (!slug) return null;

  const publicationState = opts.publicationState || DEFAULT_PUB_STATE;
  const cacheKey = keyOf(slug, publicationState);
  const cachedEntry = getPathologyCacheEntry(slug, { publicationState });
  const cached = cachedEntry?.data || null;

  if (!opts.force && cachedEntry?.isFresh && isCacheSufficient(cached)) return cached;
  if (INFLIGHT.has(cacheKey)) return INFLIGHT.get(cacheKey);

  const loadOnce = ({ withQa, withQuiz, withCases }) =>
    strapiFetch(PATHO_ENDPOINT, {
      params: {
        filters: { slug: { $eq: slug } },
        locale: 'all',
        publicationState,
        populate: {
          cover: { fields: ['url', 'formats'] },
          badges: { fields: ['label', 'variant'] },
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
        fields: ['title', 'slug', 'excerpt', 'content', 'updatedAt', 'credits', 'references', 'copyright'],
        pagination: { page: 1, pageSize: 1 },
      },
      options: opts.signal ? { signal: opts.signal } : undefined,
    });

  const promise = (async () => {
    try {
      let res;
      try {
        res = await loadOnce({ withQa: true, withQuiz: true, withCases: true });
      } catch (err) {
        const msg = err?.message || '';
        const qaInvalid = /Invalid key qa_blocks/i.test(msg);
        const quizInvalid = /Invalid key quiz_blocks/i.test(msg);
        const casesInvalid = /Invalid key cases/i.test(msg);
        if (!qaInvalid && !quizInvalid && !casesInvalid) throw err;
        res = await loadOnce({
          withQa: !qaInvalid,
          withQuiz: !quizInvalid,
          withCases: !casesInvalid,
        });
      }

      const node = Array.isArray(res?.data) ? res.data[0] : null;
      const attrs = node?.attributes ? node.attributes : node;
      if (!attrs) {
        deletePathologyFromCache(slug, { publicationState });
        return null;
      }

      const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
      const coverUrl = imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || null;
      const full = { ...attrs, coverUrl };
      setPathologyToCache(slug, full, { publicationState });
      return full;
    } catch (error) {
      if (cached && opts.allowStaleOnError !== false) return cached;
      throw error;
    } finally {
      INFLIGHT.delete(cacheKey);
    }
  })();

  INFLIGHT.set(cacheKey, promise);
  return promise;
}
