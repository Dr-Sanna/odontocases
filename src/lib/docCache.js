// src/lib/docCache.js
import { strapiFetch } from './strapi';

const DOCS_ENDPOINT = import.meta.env.VITE_DOCS_ENDPOINT || '/doc-nodes';

const mem = new Map();
const ssKey = (parentSlug, level) => `doc-children:${parentSlug || '__root__'}:${level}`;

export function getCachedChildren(parentSlug, level) {
  const k = ssKey(parentSlug, level);
  if (mem.has(k)) return mem.get(k);

  try {
    const raw = sessionStorage.getItem(k);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    mem.set(k, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function setCachedChildren(parentSlug, level, list) {
  const k = ssKey(parentSlug, level);
  mem.set(k, list);
  try {
    sessionStorage.setItem(k, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function normalizeNode(node) {
  return node?.attributes ? node.attributes : node;
}

export async function fetchChildren(parentSlug, level, { signal } = {}) {
  const filters =
    level === 'subject'
      ? { level: { $eq: 'subject' }, parent: { $null: true } }
      : { level: { $eq: level }, parent: { slug: { $eq: parentSlug } } };

  const res = await strapiFetch(DOCS_ENDPOINT, {
    params: {
      filters,
      sort: 'title:asc',
      fields: ['title', 'slug', 'excerpt', 'level', 'updatedAt'],
      populate: { cover: { fields: ['url', 'formats'] } },
      pagination: { page: 1, pageSize: 200 },
      publicationState: 'live',
      locale: 'all',
    },
    options: { signal },
  });

  const listRaw = Array.isArray(res?.data) ? res.data : [];
  const list = listRaw.map(normalizeNode).filter((x) => x?.slug);

  setCachedChildren(parentSlug, level, list);
  return list;
}
