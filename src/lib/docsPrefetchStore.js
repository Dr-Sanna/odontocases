// src/lib/docsPrefetchStore.js
import { strapiFetch, imgUrl } from './strapi';

const DOCS_ENDPOINT = import.meta.env.VITE_DOCS_ENDPOINT || '/doc-nodes';

const store = {
  // publicationState -> { primed: boolean, index: Map<string, array>, bySlug: Map<string, node>, at: number }
  byPub: new Map(),
  inflight: new Map(), // publicationState -> Promise
};

function normalizeEntity(node) {
  if (!node) return null;
  if (node.attributes) return { id: node.id, ...node.attributes };
  return node;
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
  return (
    imgUrl(coverAttr, 'medium') ||
    imgUrl(coverAttr, 'thumbnail') ||
    imgUrl(coverAttr) ||
    ''
  );
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

function compareByOrderThenTitle(a, b) {
  const ao = Number.isFinite(a?.order) ? a.order : Number.POSITIVE_INFINITY;
  const bo = Number.isFinite(b?.order) ? b.order : Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;

  const at = String(a?.title || '');
  const bt = String(b?.title || '');
  return at.localeCompare(bt, 'fr', { sensitivity: 'base' });
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

export function getPrefetchedChildren(level, parentSlug, { publicationState = 'live' } = {}) {
  const bucket = ensureBucket(publicationState);
  const k = keyOf(level, parentSlug);
  const arr = bucket.index.get(k);
  return Array.isArray(arr) ? arr : null;
}

export function getPrefetchedBySlug(slug, { publicationState = 'live' } = {}) {
  const bucket = ensureBucket(publicationState);
  return bucket.bySlug.get(slug) || null;
}

export function isDocsPrimed({ publicationState = 'live' } = {}) {
  const bucket = ensureBucket(publicationState);
  return Boolean(bucket.primed);
}

/**
 * Fetch “essentiel” en 1 appel :
 * - level in [subject, chapter, item]
 * - fields: title, slug, level, order, updatedAt
 * - parent.slug (pour indexer chapters/items)
 * - cover url
 */
export async function primeDocsEssentials({ publicationState = 'live', signal } = {}) {
  const bucket = ensureBucket(publicationState);

  if (bucket.primed) return bucket;

  if (store.inflight.has(publicationState)) return store.inflight.get(publicationState);

  const p = (async () => {
    const res = await strapiFetch(DOCS_ENDPOINT, {
      params: {
        locale: 'all',
        publicationState,
        filters: {
          level: { $in: ['subject', 'chapter', 'item'] },
        },
        fields: ['title', 'slug', 'level', 'order', 'updatedAt'],
        populate: {
          cover: { fields: ['url', 'formats'] },
          parent: { fields: ['slug', 'level'] },
        },
        sort: ['level:asc', 'order:asc', 'title:asc'],
        pagination: { page: 1, pageSize: 2000 },
      },
      options: { signal },
    });

    const rows = Array.isArray(res?.data) ? res.data : [];
    const normalized = rows
      .map(normalizeEntity)
      .filter(Boolean)
      .filter((n) => n?.slug && n?.level);

    // rebuild propre (important si rename / move / suppression)
    bucket.index = new Map();
    bucket.bySlug = new Map();

    for (const n of normalized) {
      const cooked = { ...n, coverUrl: cookCoverUrl(n) };
      upsertIndex(bucket, cooked);
    }

    bucket.primed = true;
    bucket.at = Date.now();

    return bucket;
  })();

  store.inflight.set(publicationState, p);

  try {
    return await p;
  } finally {
    store.inflight.delete(publicationState);
  }
}

/**
 * Revalidate : on refetch, on reconstruit l’index,
 * mais l’UI peut continuer à afficher le store pendant ce temps.
 */
export async function revalidateDocsEssentials({ publicationState = 'live', signal } = {}) {
  const bucket = ensureBucket(publicationState);

  const res = await strapiFetch(DOCS_ENDPOINT, {
    params: {
      locale: 'all',
      publicationState,
      filters: { level: { $in: ['subject', 'chapter', 'item'] } },
      fields: ['title', 'slug', 'level', 'order', 'updatedAt'],
      populate: {
        cover: { fields: ['url', 'formats'] },
        parent: { fields: ['slug', 'level'] },
      },
      sort: ['level:asc', 'order:asc', 'title:asc'],
      pagination: { page: 1, pageSize: 2000 },
    },
    options: { signal },
  });

  const rows = Array.isArray(res?.data) ? res.data : [];
  const normalized = rows
    .map(normalizeEntity)
    .filter(Boolean)
    .filter((n) => n?.slug && n?.level);

  bucket.index = new Map();
  bucket.bySlug = new Map();

  for (const n of normalized) {
    const cooked = { ...n, coverUrl: cookCoverUrl(n) };
    upsertIndex(bucket, cooked);
  }

  bucket.primed = true;
  bucket.at = Date.now();

  return bucket;
}
