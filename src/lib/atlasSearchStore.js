import { strapiFetch } from './strapi';

const PATHO_ENDPOINT = import.meta.env.VITE_PATHO_ENDPOINT || '/pathologies';
const ATLAS_TAXONOMY_ENDPOINT = import.meta.env.VITE_ATLAS_TAXONOMY_ENDPOINT || '/atlas-taxonomy';
const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';
const PAGE_SIZE = 100;

let atlasSearchIndex = null;
let atlasSearchPromise = null;

function normalizeNode(node) {
  return node?.attributes ? { id: node.id, ...node.attributes } : node;
}

function normalizeRelationArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeNode).filter(Boolean);
  if (Array.isArray(value?.data)) return value.data.map(normalizeNode).filter(Boolean);
  if (Array.isArray(value?.results)) return value.results.map(normalizeNode).filter(Boolean);
  return [];
}

function normalizeAliases(value, title = '') {
  const titleKey = normalizeSearchText(title);
  const seen = new Set();

  return normalizeRelationArray(value)
    .map((entry) => String(entry?.name || '').trim())
    .filter(Boolean)
    .filter((alias) => {
      const key = normalizeSearchText(alias);
      if (!key || key === titleKey || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeClassifications(value) {
  return normalizeRelationArray(value)
    .map((entry) => ({
      categoryId: String(entry?.categoryId || '').trim(),
    }))
    .filter((entry) => entry.categoryId);
}

function taxonomyPayloadFromResponse(response) {
  const entity = normalizeNode(response?.data) || normalizeNode(response);
  const taxonomy = entity?.taxonomy;
  return taxonomy && typeof taxonomy === 'object' && !Array.isArray(taxonomy) ? taxonomy : null;
}

function buildPublishedCategoryIds(taxonomy) {
  if (!taxonomy || typeof taxonomy !== 'object') return new Set();

  // Un ancien JSON dépourvu de `enabled` reste publié par compatibilité.
  const publishedTabIds = new Set(
    (Array.isArray(taxonomy.tabs) ? taxonomy.tabs : [])
      .filter((tab) => tab?.enabled !== false)
      .map((tab) => String(tab?.id || '').trim())
      .filter(Boolean)
  );

  const categoryIds = new Set();
  for (const category of Array.isArray(taxonomy.categories) ? taxonomy.categories : []) {
    const categoryId = String(category?.id || '').trim();
    if (!categoryId) continue;

    const categoryTabs = (Array.isArray(category?.tabs) ? category.tabs : [])
      .map((tabId) => String(tabId || '').trim())
      .filter(Boolean);

    if (categoryTabs.some((tabId) => publishedTabIds.has(tabId))) {
      categoryIds.add(categoryId);
    }
  }

  return categoryIds;
}

export function normalizeSearchText(value) {
  return String(value || '')
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchableTokens(value) {
  return normalizeSearchText(value).split(' ').filter(Boolean);
}

function containsEveryToken(text, tokens) {
  if (!tokens.length) return false;
  const normalized = normalizeSearchText(text);
  return tokens.every((token) => normalized.includes(token));
}

function resultIdentity(item) {
  return String(item?.documentId || item?.id || item?.slug || '');
}

function cookPathology(node) {
  const item = normalizeNode(node);
  if (!item?.slug) return null;

  return {
    ...item,
    title: String(item.title || item.slug).trim(),
    slug: String(item.slug).trim(),
    aliases: normalizeAliases(item.aliases, item.title),
    classification: normalizeClassifications(item.classification),
  };
}

function compareTitle(a, b) {
  return String(a?.title || '').localeCompare(String(b?.title || ''), 'fr', {
    sensitivity: 'base',
    numeric: true,
  });
}

async function fetchIndexPage(page) {
  return strapiFetch(PATHO_ENDPOINT, {
    params: {
      locale: 'all',
      publicationState: PUB_STATE,
      fields: ['title', 'slug', 'updatedAt'],
      populate: {
        cover: { fields: ['url', 'formats', 'alternativeText', 'name'] },
        aliases: { fields: ['name'] },
        classification: { fields: ['categoryId'] },
      },
      sort: 'title:asc,slug:asc',
      pagination: { page, pageSize: PAGE_SIZE },
    },
  });
}

async function fetchPublishedCategoryIds() {
  const response = await strapiFetch(ATLAS_TAXONOMY_ENDPOINT, {
    params: { fields: ['taxonomy'] },
  });

  return buildPublishedCategoryIds(taxonomyPayloadFromResponse(response));
}

async function fetchAllIndexRows() {
  const first = await fetchIndexPage(1);
  const firstRows = Array.isArray(first?.data) ? first.data : [];
  const pageCount = Math.max(1, Number(first?.meta?.pagination?.pageCount) || 1);

  const rest = pageCount > 1
    ? await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, index) => fetchIndexPage(index + 2))
      )
    : [];

  const rows = [...firstRows];
  rest.forEach((response) => {
    if (Array.isArray(response?.data)) rows.push(...response.data);
  });

  return rows;
}

async function fetchAtlasSearchIndex() {
  // Taxonomie et index léger sont chargés en parallèle. La taxonomie sert uniquement
  // à exclure les fiches qui ne sont rattachées qu'à des tabs en brouillon.
  const [rows, publishedCategoryIds] = await Promise.all([
    fetchAllIndexRows(),
    fetchPublishedCategoryIds(),
  ]);

  const byId = new Map();

  rows
    .map(cookPathology)
    .filter(Boolean)
    .filter((item) =>
      item.classification.some((entry) => publishedCategoryIds.has(entry.categoryId))
    )
    .forEach((item) => {
      const key = resultIdentity(item) || item.slug;
      if (!byId.has(key)) byId.set(key, item);
    });

  return Array.from(byId.values()).sort(compareTitle);
}

export function getAtlasSearchIndexIfReady() {
  return atlasSearchIndex;
}

export async function loadAtlasSearchIndex() {
  if (atlasSearchIndex) return atlasSearchIndex;
  if (atlasSearchPromise) return atlasSearchPromise;

  atlasSearchPromise = fetchAtlasSearchIndex()
    .then((index) => {
      atlasSearchIndex = index;
      return index;
    })
    .finally(() => {
      atlasSearchPromise = null;
    });

  return atlasSearchPromise;
}

export function primeAtlasSearchIndex() {
  return loadAtlasSearchIndex();
}

function scoreCandidate(item, rawQuery) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return null;

  const tokens = searchableTokens(query);
  const title = normalizeSearchText(item?.title);
  const slug = normalizeSearchText(item?.slug);
  const aliases = Array.isArray(item?.aliases) ? item.aliases : [];
  const normalizedAliases = aliases.map((alias) => ({ raw: alias, value: normalizeSearchText(alias) }));

  if (title === query) return { score: 0, kind: 'title', value: item.title };
  if (title.startsWith(query)) return { score: 10, kind: 'title', value: item.title };

  const aliasExact = normalizedAliases.find((alias) => alias.value === query);
  if (aliasExact) return { score: 20, kind: 'alias', value: aliasExact.raw };

  const aliasStarts = normalizedAliases.find((alias) => alias.value.startsWith(query));
  if (aliasStarts) return { score: 30, kind: 'alias', value: aliasStarts.raw };

  if (title.includes(query)) return { score: 40, kind: 'title', value: item.title };

  const aliasContains = normalizedAliases.find((alias) => alias.value.includes(query));
  if (aliasContains) return { score: 50, kind: 'alias', value: aliasContains.raw };

  if (containsEveryToken(title, tokens)) return { score: 60, kind: 'title', value: item.title };

  const aliasTokens = aliases.find((alias) => containsEveryToken(alias, tokens));
  if (aliasTokens) return { score: 70, kind: 'alias', value: aliasTokens };

  // Le slug reste un dernier filet technique, sans être affiché comme champ de recherche.
  if (slug.includes(query)) return { score: 80, kind: 'slug', value: item.slug };

  return null;
}

export function searchAtlasIndex(index, query, { limit = Infinity } = {}) {
  const source = Array.isArray(index) ? index : [];
  const q = normalizeSearchText(query);
  if (!q) return [];

  const ranked = [];
  for (const item of source) {
    const match = scoreCandidate(item, q);
    if (!match) continue;
    ranked.push({ item, match });
  }

  ranked.sort((a, b) => {
    if (a.match.score !== b.match.score) return a.match.score - b.match.score;
    return compareTitle(a.item, b.item);
  });

  return ranked.slice(0, limit).map(({ item, match }) => ({
    ...item,
    _searchMatch: match,
  }));
}

export function searchAtlasPathologiesSync(query, options) {
  if (!atlasSearchIndex) return [];
  return searchAtlasIndex(atlasSearchIndex, query, options);
}

export async function searchAtlasPathologies(query, options) {
  const index = await loadAtlasSearchIndex();
  return searchAtlasIndex(index, query, options);
}
