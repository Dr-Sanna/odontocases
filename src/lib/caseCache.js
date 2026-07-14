// src/lib/caseCache.js
// Cache détail des cas : mémoire + sessionStorage, TTL, déduplication et invalidation.
import { strapiFetch, imgUrl } from './strapi';

const STORE = new Map(); // cacheKey -> { data, fetchedAt }
const INFLIGHT = new Map(); // cacheKey -> Promise

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const DEFAULT_PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';
const CACHE_VERSION = 2;
const FRESH_MS = Number(import.meta.env.VITE_DETAIL_CACHE_STALE_MS) || 30_000;
const MAX_AGE_MS = Number(import.meta.env.VITE_DETAIL_CACHE_MAX_AGE_MS) || 15 * 60_000;

function keyOf(slug, publicationState = DEFAULT_PUB_STATE) {
  return `${publicationState}:${slug}`;
}

function storageKey(slug, publicationState = DEFAULT_PUB_STATE) {
  return `odontocases:v${CACHE_VERSION}:case:${publicationState}:${slug}`;
}

function legacyStorageKey(slug) {
  return `case-cache:${slug}`;
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.__cacheVersion === CACHE_VERSION && value.data) {
    return { data: value.data, fetchedAt: Number(value.fetchedAt) || 0 };
  }
  // Ancien format : utilisable pour un affichage instantané, mais immédiatement stale.
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
      deleteCaseFromCache(slug, { publicationState });
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
      deleteCaseFromCache(slug, { publicationState });
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

export function getCaseCacheEntry(slug, { publicationState = DEFAULT_PUB_STATE } = {}) {
  const entry = readEntry(slug, publicationState);
  if (!entry) return null;
  return {
    data: entry.data,
    fetchedAt: entry.fetchedAt,
    isFresh: Boolean(entry.fetchedAt && Date.now() - entry.fetchedAt <= FRESH_MS),
  };
}

export function getCaseFromCache(slug, opts = {}) {
  return getCaseCacheEntry(slug, opts)?.data || null;
}

export function isCaseCacheFresh(slug, opts = {}) {
  return Boolean(getCaseCacheEntry(slug, opts)?.isFresh);
}

export function setCaseToCache(slug, data, { publicationState = DEFAULT_PUB_STATE } = {}) {
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

export function deleteCaseFromCache(slug, { publicationState = DEFAULT_PUB_STATE } = {}) {
  if (!slug) return;
  STORE.delete(keyOf(slug, publicationState));
  INFLIGHT.delete(keyOf(slug, publicationState));
  try {
    sessionStorage.removeItem(storageKey(slug, publicationState));
    sessionStorage.removeItem(legacyStorageKey(slug));
  } catch {}
}

export function clearCaseCache() {
  STORE.clear();
  INFLIGHT.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i) || '';
      if (key.startsWith(`odontocases:v${CACHE_VERSION}:case:`) || key.startsWith('case-cache:')) {
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
      Array.isArray(cached.quiz_blocks)
  );
}

/** Précharge un cas détaillé sans conserver indéfiniment une ancienne version. */
export async function prefetchCase(slug, opts = {}) {
  if (!slug) return null;

  const publicationState = opts.publicationState || DEFAULT_PUB_STATE;
  const cacheKey = keyOf(slug, publicationState);
  const cachedEntry = getCaseCacheEntry(slug, { publicationState });
  const cached = cachedEntry?.data || null;

  if (!opts.force && cachedEntry?.isFresh && isCacheSufficient(cached)) return cached;
  if (INFLIGHT.has(cacheKey)) return INFLIGHT.get(cacheKey);

  const loadOnce = ({ withQa, withQuiz }) =>
    strapiFetch(CASES_ENDPOINT, {
      params: {
        filters: { slug: { $eq: slug } },
        locale: 'all',
        publicationState,
        populate: {
          cover: { fields: ['url', 'formats'] },
          ...(withQa ? { qa_blocks: { populate: '*' } } : {}),
          ...(withQuiz ? { quiz_blocks: { populate: { propositions: true } } } : {}),
        },
        fields: ['title', 'slug', 'type', 'excerpt', 'content', 'updatedAt', 'credits', 'references', 'copyright'],
        pagination: { page: 1, pageSize: 1 },
      },
      options: opts.signal ? { signal: opts.signal } : undefined,
    });

  const promise = (async () => {
    try {
      let res;
      try {
        res = await loadOnce({ withQa: true, withQuiz: true });
      } catch (err) {
        const msg = err?.message || '';
        const qaInvalid = /Invalid key qa_blocks/i.test(msg);
        const quizInvalid = /Invalid key quiz_blocks/i.test(msg);
        if (!qaInvalid && !quizInvalid) throw err;
        res = await loadOnce({ withQa: !qaInvalid, withQuiz: !quizInvalid });
      }

      const node = Array.isArray(res?.data) ? res.data[0] : null;
      const attrs = node?.attributes ? node.attributes : node;
      if (!attrs) {
        deleteCaseFromCache(slug, { publicationState });
        return null;
      }

      const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
      const coverUrl = imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || null;
      const full = { ...attrs, coverUrl };
      setCaseToCache(slug, full, { publicationState });
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
