// src/lib/docsPrefetchStore.js
import { strapiFetch, imgUrl } from './strapi';

const DOCS_ENDPOINT = import.meta.env.VITE_DOCS_ENDPOINT || '/doc-nodes';
const FRESH_MS = Number(import.meta.env.VITE_DOCS_INDEX_STALE_MS) || 2 * 60_000;
const MAX_AGE_MS = Number(import.meta.env.VITE_DOCS_INDEX_MAX_AGE_MS) || 30 * 60_000;

const store = {
  // publicationState -> { primed, index, bySlug, at }
  byPub: new Map(),
  inflight: new Map(),
};

function normalizeEntity(node) {
  if (!node) return null;
  if (node.attributes) return { id: node.id, ...node.attributes };
  return node;
}

function normalizeRelationList(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
  return list.map(normalizeEntity).filter(Boolean);
}

function parentSlugOf(n) {
  const p = n?.parent;
  if (!p) return null;
  if (typeof p === 'string') return p;
  if (p?.slug) return p.slug;
  if (p?.data?.attributes?.slug) return p.data.attributes.slug;
  if (p?.data?.slug) return p.data.slug;
  return null;
}

function cookCoverUrl(n) {
  const coverAttr = n?.cover?.data?.attributes || n?.cover || null;
  return imgUrl(coverAttr, 'medium') || imgUrl(coverAttr, 'thumbnail') || imgUrl(coverAttr) || '';
}

function compareByOrderThenTitle(a, b) {
  const ao = Number.isFinite(a?.order) ? a.order : Number.POSITIVE_INFINITY;
  const bo = Number.isFinite(b?.order) ? b.order : Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return String(a?.title || '').localeCompare(String(b?.title || ''), 'fr', { sensitivity: 'base' });
}

function cookDocThemes(n) {
  return normalizeRelationList(n?.doc_themes)
    .map((theme) => ({
      id: theme?.id ?? null,
      title: String(theme?.title || '').trim(),
      slug: String(theme?.slug || '').trim(),
      order: Number.isFinite(theme?.order) ? theme.order : Number.POSITIVE_INFINITY,
    }))
    .filter((theme) => theme.title || theme.slug)
    .sort(compareByOrderThenTitle);
}

function ensureBucket(publicationState) {
  if (!store.byPub.has(publicationState)) {
    store.byPub.set(publicationState, {
      primed: false,
      index: new Map(),
      bySlug: new Map(),
      at: 0,
    });
  }
  return store.byPub.get(publicationState);
}

function keyOf(level, parentSlug) {
  return `${level}:${parentSlug || '__root__'}`;
}

function upsertIndex(bucket, node) {
  if (!node?.slug || !node?.level) return;
  bucket.bySlug.set(node.slug, node);

  const pSlug = node.level === 'subject' ? null : parentSlugOf(node);
  const k = keyOf(node.level, pSlug);
  if (!bucket.index.has(k)) bucket.index.set(k, []);

  const arr = bucket.index.get(k);
  const i = arr.findIndex((x) => x?.slug === node.slug);
  if (i === -1) arr.push(node);
  else arr[i] = node;
  arr.sort(compareByOrderThenTitle);
}

function cookDocNode(n) {
  return { ...n, coverUrl: cookCoverUrl(n), doc_themes: cookDocThemes(n) };
}

function docsEssentialParams(publicationState) {
  return {
    locale: 'all',
    publicationState,
    filters: { level: { $in: ['subject', 'chapter', 'item'] } },
    fields: ['title', 'slug', 'level', 'order', 'updatedAt', 'excerpt'],
    populate: {
      cover: { fields: ['url', 'formats'] },
      parent: { fields: ['slug', 'level'] },
      doc_themes: { fields: ['title', 'slug', 'order'] },
    },
    sort: ['level:asc', 'order:asc', 'title:asc'],
    pagination: { page: 1, pageSize: 2000 },
  };
}

function rebuildBucket(bucket, rows) {
  const normalized = rows
    .map(normalizeEntity)
    .filter(Boolean)
    .filter((n) => n?.slug && n?.level);

  // Reconstruction complète : les suppressions/renommages disparaissent réellement.
  bucket.index = new Map();
  bucket.bySlug = new Map();
  for (const n of normalized) upsertIndex(bucket, cookDocNode(n));
  bucket.primed = true;
  bucket.at = Date.now();
  return bucket;
}

function bucketAge(bucket) {
  return bucket?.at ? Date.now() - bucket.at : Number.POSITIVE_INFINITY;
}

export function getPrefetchedChildren(level, parentSlug, { publicationState = 'live' } = {}) {
  const bucket = ensureBucket(publicationState);
  const arr = bucket.index.get(keyOf(level, parentSlug));
  return Array.isArray(arr) ? arr : null;
}

export function getPrefetchedBySlug(slug, { publicationState = 'live' } = {}) {
  return ensureBucket(publicationState).bySlug.get(slug) || null;
}

export function isDocsPrimed({ publicationState = 'live' } = {}) {
  const bucket = ensureBucket(publicationState);
  return Boolean(bucket.primed && bucketAge(bucket) <= MAX_AGE_MS);
}

export function isDocsFresh({ publicationState = 'live', maxAgeMs = FRESH_MS } = {}) {
  const bucket = ensureBucket(publicationState);
  return Boolean(bucket.primed && bucketAge(bucket) <= maxAgeMs);
}

export function invalidateDocsEssentials({ publicationState = 'live', clear = false } = {}) {
  const bucket = ensureBucket(publicationState);
  bucket.at = 0;
  if (clear) {
    bucket.primed = false;
    bucket.index = new Map();
    bucket.bySlug = new Map();
  }
}

async function refreshDocsEssentials({ publicationState = 'live', signal, force = false, maxAgeMs = FRESH_MS } = {}) {
  const bucket = ensureBucket(publicationState);
  if (!force && bucket.primed && bucketAge(bucket) <= maxAgeMs) return bucket;
  if (store.inflight.has(publicationState)) return store.inflight.get(publicationState);

  const promise = (async () => {
    const res = await strapiFetch(DOCS_ENDPOINT, {
      params: docsEssentialParams(publicationState),
      options: signal ? { signal } : undefined,
    });
    return rebuildBucket(bucket, Array.isArray(res?.data) ? res.data : []);
  })();

  store.inflight.set(publicationState, promise);
  try {
    return await promise;
  } finally {
    store.inflight.delete(publicationState);
  }
}

/** Premier chargement ou revalidation si le store n'est plus frais. */
export function primeDocsEssentials(opts = {}) {
  return refreshDocsEssentials(opts);
}

/** Revalidation explicite ; force=false évite les gros refetchs répétés pendant la navigation. */
export function revalidateDocsEssentials(opts = {}) {
  return refreshDocsEssentials(opts);
}
