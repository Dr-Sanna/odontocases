// src/lib/docCache.js
// Cache mémoire léger pour les listes d'enfants documentaires.
import { strapiFetch, imgUrl } from './strapi';

const DOCS_ENDPOINT = import.meta.env.VITE_DOCS_ENDPOINT || '/doc-nodes';
const FRESH_MS = Number(import.meta.env.VITE_DOC_LIST_CACHE_STALE_MS) || 60_000;
const MAX_AGE_MS = Number(import.meta.env.VITE_DOC_LIST_CACHE_MAX_AGE_MS) || 10 * 60_000;

const mem = new Map(); // key -> { list, at }
const inflight = new Map(); // key -> Promise

const keyOf = (parentSlug, level, pubState) => `doc:${pubState}:${level}:${parentSlug || '__root__'}`;

function normalizeNode(node) {
  if (!node) return null;
  if (node.attributes) return { id: node.id, ...node.attributes };
  return node;
}

function cookList(raw) {
  const list = (Array.isArray(raw) ? raw : [])
    .map(normalizeNode)
    .filter(Boolean)
    .filter((x) => x?.slug);

  return list.map((n) => {
    const coverAttr = n?.cover?.data?.attributes || n?.cover || null;
    const coverUrl = imgUrl(coverAttr, 'medium') || imgUrl(coverAttr, 'thumbnail') || imgUrl(coverAttr) || '';
    return { ...n, coverUrl };
  });
}

function getEntry(parentSlug, level, publicationState) {
  const k = keyOf(parentSlug, level, publicationState);
  const entry = mem.get(k);
  if (!entry) return null;
  if (Date.now() - entry.at > MAX_AGE_MS) {
    mem.delete(k);
    return null;
  }
  return entry;
}

export function getCachedChildren(parentSlug, level, { publicationState = 'live' } = {}) {
  return getEntry(parentSlug, level, publicationState)?.list || null;
}

export function isCachedChildrenFresh(parentSlug, level, { publicationState = 'live' } = {}) {
  const entry = getEntry(parentSlug, level, publicationState);
  return Boolean(entry && Date.now() - entry.at <= FRESH_MS);
}

export function setCachedChildren(parentSlug, level, list, { publicationState = 'live' } = {}) {
  const k = keyOf(parentSlug, level, publicationState);
  mem.set(k, { list: Array.isArray(list) ? list : [], at: Date.now() });
}

export function invalidateCachedChildren(parentSlug, level, { publicationState = 'live' } = {}) {
  mem.delete(keyOf(parentSlug, level, publicationState));
}

export function clearDocChildrenCache() {
  mem.clear();
  inflight.clear();
}

export async function fetchChildren(
  parentSlug,
  level,
  { signal, publicationState = 'live', pageSize = 500, force = false } = {}
) {
  const k = keyOf(parentSlug, level, publicationState);
  const cached = getCachedChildren(parentSlug, level, { publicationState });
  if (!force && cached && isCachedChildrenFresh(parentSlug, level, { publicationState })) return cached;
  if (inflight.has(k)) return inflight.get(k);

  const promise = (async () => {
    const filters =
      level === 'subject'
        ? { level: { $eq: 'subject' }, parent: { $null: true } }
        : { level: { $eq: level }, parent: { slug: { $eq: parentSlug } } };

    const res = await strapiFetch(DOCS_ENDPOINT, {
      params: {
        filters,
        sort: ['order:asc', 'title:asc'],
        fields: ['title', 'slug', 'excerpt', 'level', 'updatedAt', 'order'],
        populate: { cover: { fields: ['url', 'formats'] } },
        pagination: { page: 1, pageSize },
        publicationState,
        locale: 'all',
      },
      options: signal ? { signal } : undefined,
    });

    const listRaw = Array.isArray(res?.data) ? res.data : [];
    const cooked = cookList(listRaw);
    setCachedChildren(parentSlug, level, cooked, { publicationState });
    return cooked;
  })();

  inflight.set(k, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(k);
  }
}

export function prefetchChildren(parentSlug, level, { publicationState = 'live' } = {}) {
  if (isCachedChildrenFresh(parentSlug, level, { publicationState })) return;
  fetchChildren(parentSlug, level, { publicationState }).catch(() => {});
}
