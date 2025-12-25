// src/lib/docCache.js
import { strapiFetch, imgUrl } from './strapi';

const DOCS_ENDPOINT = import.meta.env.VITE_DOCS_ENDPOINT || '/doc-nodes';

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
    const coverUrl =
      imgUrl(coverAttr, 'medium') || imgUrl(coverAttr, 'thumbnail') || imgUrl(coverAttr) || '';
    return { ...n, coverUrl };
  });
}

export function getCachedChildren(parentSlug, level, { publicationState = 'live' } = {}) {
  const k = keyOf(parentSlug, level, publicationState);
  const entry = mem.get(k);
  return entry?.list || null;
}

export function setCachedChildren(parentSlug, level, list, { publicationState = 'live' } = {}) {
  const k = keyOf(parentSlug, level, publicationState);
  mem.set(k, { list: Array.isArray(list) ? list : [], at: Date.now() });
}

export async function fetchChildren(
  parentSlug,
  level,
  { signal, publicationState = 'live', pageSize = 500 } = {}
) {
  const k = keyOf(parentSlug, level, publicationState);

  // dédoublonnage si plusieurs composants demandent pareil
  if (inflight.has(k)) return inflight.get(k);

  const p = (async () => {
    const filters =
      level === 'subject'
        ? { level: { $eq: 'subject' }, parent: { $null: true } }
        : { level: { $eq: level }, parent: { slug: { $eq: parentSlug } } };

    const res = await strapiFetch(DOCS_ENDPOINT, {
      params: {
        filters,
        // tri Strapi + fallback tri front dans Documentation.jsx si besoin
        sort: ['order:asc', 'title:asc'],
        fields: ['title', 'slug', 'excerpt', 'level', 'updatedAt', 'order'],
        populate: { cover: { fields: ['url', 'formats'] } },
        pagination: { page: 1, pageSize },
        publicationState,
        locale: 'all',
      },
      options: { signal },
    });

    const listRaw = Array.isArray(res?.data) ? res.data : [];
    const cooked = cookList(listRaw);

    setCachedChildren(parentSlug, level, cooked, { publicationState });
    return cooked;
  })();

  inflight.set(k, p);

  try {
    return await p;
  } finally {
    inflight.delete(k);
  }
}

export function prefetchChildren(parentSlug, level, { publicationState = 'live' } = {}) {
  // ne force rien côté UI, juste warm du cache
  fetchChildren(parentSlug, level, { publicationState }).catch(() => {});
}
