// src/pages/CasCliniques.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import FilterMenu from '../components/FilterMenu';
import { strapiFetch, imgUrl, isAbortError } from '../lib/strapi';
import { useQuizCount } from '../lib/trainingStatsStore';
import './DisplayShared.css';
import './CasCliniques.css';

/**
 * Hubs :
 * - /atlas                         => Atlas (liste des pathologies)
 * - /entrainement                  => choix du mode d'entraînement
 * - /entrainement/qr               => cas Q/R (Strapi type = "qa")
 * - /entrainement/quiz             => quiz (Strapi type = "quiz")
 * - /entrainement/presentation    => présentations (Strapi type = "presentation")
 * - /entrainement/aleatoire        => composant de tirage aléatoire (routeur séparé)
 *
 * Détails (via CasCliniquesRouter) :
 * - /atlas/:pathologySlug/:caseSlug?
 * - /entrainement/cas/:slug
 */

const ATLAS_KEY = 'atlas';
const STRAPI_QA_TYPE = 'qa';
const STRAPI_QUIZ_TYPE = 'quiz';
const STRAPI_PRESENTATION_TYPE = 'presentation';
const RANDOM_KEY = 'random';

const PAGE_SIZE = 100;
const ATLAS_BATCH_SIZE = 100;
const FALLBACK_PAGE_SIZE = 300;

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const PATHO_ENDPOINT = import.meta.env.VITE_PATHO_ENDPOINT || '/pathologies';
const ATLAS_TAXONOMY_ENDPOINT = import.meta.env.VITE_ATLAS_TAXONOMY_ENDPOINT || '/atlas-taxonomy';
const TRAINING_STATS_PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';
const CASE_THEME_RELATION = import.meta.env.VITE_CASE_THEME_RELATION || 'doc_themes';

const UNTHEMED_KEY = '__sans-theme__';
const UNTHEMED_THEME = {
  key: UNTHEMED_KEY,
  slug: UNTHEMED_KEY,
  title: 'Sans thème',
  order: Number.POSITIVE_INFINITY,
};


const UNCLASSIFIED_ATLAS_CATEGORY = 'Sans catégorie';

// Les grandes catégories de l’Atlas sont triées automatiquement par ordre
// alphabétique français. Aucun ordre de catégorie n’est maintenu manuellement ici.
const ATLAS_SUBCATEGORY_ORDER = {
  'Variations anatomiques, physiologiques et états bénins fréquents': [
    'Variations anatomiques et physiologiques orales',
    'Variations et affections bénignes de la langue',
  ],
  'Anomalies du développement et pathologies dentaires': [
    'Anomalies du développement',
    'Anomalies dentaires et de l’éruption',
    'Altérations et traumatismes dentaires',
  ],
  'Pathologies gingivales et parodontales': [
    'Gingivites et maladies parodontales inflammatoires',
    'Accroissements et hyperplasies gingivales',
  ],
  'Kystes des maxillaires': [
    'Kystes du développement',
    'Kystes odontogènes inflammatoires',
    'Kystes liés à l’éruption',
  ],
  // Compatibilité pendant la migration vers deux grandes catégories.
  'Kystes et pseudokystes des maxillaires': [
    'Kystes du développement',
    'Kystes odontogènes inflammatoires',
    'Kystes liés à l’éruption',
    'Pseudokystes et cavités osseuses',
  ],
  'Tumeurs et autres lésions osseuses ou odontogènes des maxillaires': [
    'Tumeurs odontogènes bénignes épithéliales',
    'Tumeurs odontogènes bénignes mixtes',
    'Tumeurs odontogènes bénignes mésenchymateuses',
    'Lésions à cellules géantes',
    'Lésions fibro-osseuses et dysplasies',
    'Tumeurs osseuses bénignes',
    'Lésions osseuses réactionnelles ou iatrogènes',
    'Tumeurs odontogènes malignes',
    'Tumeurs osseuses malignes',
    'Autres tumeurs bénignes des maxillaires',
  ],
  'Lésions réactionnelles et traumatiques des tissus mous': [
    'Hyperplasies et pseudotumeurs réactionnelles',
    'Lésions traumatiques et frictionnelles',
    'Lésions thermiques et irritatives',
    'Lésions iatrogènes des tissus mous',
  ],
  'Pathologies des glandes salivaires': [
    'Pathologies obstructives et rétentionnelles',
    'Pathologies inflammatoires et infectieuses',
    'Pathologies réactionnelles et ischémiques',
    'Troubles fonctionnels',
    'Tumeurs salivaires bénignes',
    'Tumeurs salivaires malignes',
  ],
  'Pathologies infectieuses et complications': [
    'Infections odontogènes',
    'Complications infectieuses à distance',
    'Autres infections bactériennes',
    'Infections virales',
    'Infections fongiques',
  ],
  'Pathologies inflammatoires, immunitaires, bulleuses et ulcéreuses': [
    'Pathologies aphteuses',
    'Pathologies bulleuses',
    'Pathologies immuno-inflammatoires',
    'Autres lésions inflammatoires',
  ],
  'Pathologies des lèvres et périorales': [
    'Chéilites',
    'Lésions vasculaires',
    'Lésions cutanéo-labiales et périorales',
  ],
  'Tumeurs bénignes des tissus mous et de la muqueuse': [
    'Tumeurs épithéliales',
    'Tumeurs mésenchymateuses',
    'Tumeurs d’histogenèse particulière ou incertaine',
  ],
  'Tumeurs malignes de la cavité orale': [
    'Tumeurs épithéliales',
    'Tumeurs mélanocytaires',
    'Tumeurs vasculaires et mésenchymateuses',
    'Métastases',
    'Hémopathies malignes',
  ],
  'Lésions pigmentées et vasculaires': [
    'Pigmentations',
    'Lésions vasculaires',
  ],
  'Maladies systémiques, génétiques et hématologiques à manifestations orales': [
    'Maladies inflammatoires et immunitaires systémiques',
    'Maladies hématologiques et immunitaires',
    'Maladies et syndromes génétiques',
    'Syndromes auto-inflammatoires',
    'Maladies osseuses systémiques',
  ],
  'Douleurs, troubles fonctionnels et signes cervico-faciaux': [
    'Douleurs et troubles fonctionnels',
    'Signes cliniques cervico-faciaux',
  ],
};


const LIST_CACHE = new Map();
const LIST_STALE_MS = Number(import.meta.env.VITE_LIST_CACHE_STALE_MS) || 20_000;
const LIST_MAX_AGE_MS = Number(import.meta.env.VITE_LIST_CACHE_MAX_AGE_MS) || 5 * 60_000;

// La taxonomie change rarement : on la conserve en mémoire entre Atlas et CaseDetail.
// Cela évite un nouvel aller-retour réseau à chaque retour vers /atlas.
let ATLAS_TAXONOMY_CACHE = null;
let ATLAS_TAXONOMY_CACHE_AT = 0;
const ATLAS_TAXONOMY_CACHE_STALE_MS = 5 * 60_000;

function readListCache(key) {
  const entry = LIST_CACHE.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.at;
  if (age > LIST_MAX_AGE_MS) {
    LIST_CACHE.delete(key);
    return null;
  }
  return { ...entry, isFresh: age <= LIST_STALE_MS };
}

function writeListCache(key, items, total) {
  LIST_CACHE.set(key, { items: Array.isArray(items) ? items : [], total: Number(total) || 0, at: Date.now() });
}

function normalizeNode(node) {
  return node?.attributes ? node.attributes : node;
}

/* =========================
   Badges atlas (pathologies)
   Strapi : relation "badges"
   Supporte aussi anciens formats
   ========================= */

function normalizeBadges(badgesAny) {
  const list = Array.isArray(badgesAny)
    ? badgesAny
    : Array.isArray(badgesAny?.data)
      ? badgesAny.data
      : [];

  return list
    .map((n) => (n?.attributes ? n.attributes : n))
    .filter(Boolean)
    .map((b) => ({
      label: String(b?.label || '').trim(),
      variant: String(b?.variant || 'info').trim() || 'info',
    }))
    .filter((b) => b.label);
}


function normalizeClassifications(value) {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.data)
      ? value.data
      : value
        ? [value]
        : [];

  return list
    .map((node) => (node?.attributes ? node.attributes : node))
    .filter(Boolean)
    .map((entry) => ({
      categoryId: String(entry?.categoryId || '').trim(),
      category: String(entry?.category || '').trim(),
      subcategoryId: String(entry?.subcategoryId || '').trim(),
      subcategory: String(entry?.subcategory || '').trim(),
      subdivisionId: String(entry?.subdivisionId || '').trim(),
      subdivision: String(entry?.subdivision || '').trim(),
    }))
    .filter((entry) => entry.category || entry.categoryId);
}

function normalizeAtlasTaxonomy(value) {
  const node = normalizeNode(value?.data ?? value);
  const taxonomy = node?.taxonomy ?? value?.taxonomy ?? null;

  if (!taxonomy || typeof taxonomy !== 'object' || Array.isArray(taxonomy)) return null;
  return taxonomy;
}

function buildAtlasTaxonomyIndex(taxonomy) {
  if (!taxonomy || typeof taxonomy !== 'object') return null;

  const tabs = (Array.isArray(taxonomy.tabs) ? taxonomy.tabs : [])
    .map((tab) => ({
      id: String(tab?.id || '').trim(),
      label: String(tab?.label || '').trim(),
    }))
    .filter((tab) => tab.id && tab.label);

  const categories = [];
  const categoryById = new Map();
  const subcategoryById = new Map();
  const subdivisionById = new Map();

  for (const category of Array.isArray(taxonomy.categories) ? taxonomy.categories : []) {
    const id = String(category?.id || '').trim();
    if (!id) continue;

    const normalizedCategory = {
      id,
      label: String(category?.label || id).trim() || id,
      tabs: Array.from(
        new Set((Array.isArray(category?.tabs) ? category.tabs : []).map((tabId) => String(tabId || '').trim()).filter(Boolean))
      ),
    };

    categories.push(normalizedCategory);
    categoryById.set(id, normalizedCategory);

    for (const subcategory of Array.isArray(category?.subcategories) ? category.subcategories : []) {
      const subId = String(subcategory?.id || '').trim();
      if (!subId) continue;

      subcategoryById.set(subId, {
        id: subId,
        label: String(subcategory?.label || subId).trim() || subId,
        categoryId: id,
      });

      for (const subdivision of Array.isArray(subcategory?.subdivisions) ? subcategory.subdivisions : []) {
        const divId = String(subdivision?.id || '').trim();
        if (!divId) continue;

        subdivisionById.set(divId, {
          id: divId,
          label: String(subdivision?.label || divId).trim() || divId,
          subcategoryId: subId,
          categoryId: id,
        });
      }
    }
  }

  return { tabs, categories, categoryById, subcategoryById, subdivisionById };
}

function resolveAtlasClassification(entry, taxonomyIndex) {
  if (!entry) return entry;
  if (!taxonomyIndex) return entry;

  const categoryId = String(entry.categoryId || '').trim();
  const subcategoryId = String(entry.subcategoryId || '').trim();
  const subdivisionId = String(entry.subdivisionId || '').trim();

  return {
    ...entry,
    category: taxonomyIndex.categoryById.get(categoryId)?.label || entry.category || categoryId,
    subcategory: taxonomyIndex.subcategoryById.get(subcategoryId)?.label || entry.subcategory || subcategoryId,
    subdivision: taxonomyIndex.subdivisionById.get(subdivisionId)?.label || entry.subdivision || subdivisionId,
  };
}

function itemBelongsToAtlasCategories(item, allowedCategoryIds) {
  if (!(allowedCategoryIds instanceof Set) || allowedCategoryIds.size === 0) return false;
  return normalizeClassifications(item?.classification).some((entry) => allowedCategoryIds.has(entry.categoryId));
}

function normalizeGeneralFor(value) {
  const list = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === false || value === ''
      ? []
      : [value];

  return Array.from(
    new Set(
      list
        .map((entry) => {
          if (typeof entry === 'string' || typeof entry === 'number') {
            return String(entry).trim();
          }
          if (entry && typeof entry === 'object') {
            return String(entry.id || entry.key || entry.target || '').trim();
          }
          return '';
        })
        .filter(Boolean)
    )
  );
}


function makeOrderMap(values) {
  return new Map((Array.isArray(values) ? values : []).map((value, index) => [value, index]));
}

const ATLAS_SUBCATEGORY_ORDER_MAP = Object.fromEntries(
  Object.entries(ATLAS_SUBCATEGORY_ORDER).map(([category, values]) => [category, makeOrderMap(values)])
);

function compareAtlasLabels(a, b, orderMap = null) {
  const aLabel = String(a || '');
  const bLabel = String(b || '');

  if (aLabel === UNCLASSIFIED_ATLAS_CATEGORY && bLabel !== UNCLASSIFIED_ATLAS_CATEGORY) return 1;
  if (bLabel === UNCLASSIFIED_ATLAS_CATEGORY && aLabel !== UNCLASSIFIED_ATLAS_CATEGORY) return -1;

  if (orderMap) {
    const ai = orderMap.has(aLabel) ? orderMap.get(aLabel) : Number.POSITIVE_INFINITY;
    const bi = orderMap.has(bLabel) ? orderMap.get(bLabel) : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
  }

  return aLabel.localeCompare(bLabel, 'fr', { sensitivity: 'base', numeric: true });
}

function itemIdentity(item) {
  return String(item?.documentId || item?.id || item?.slug || item?.title || '');
}

function pushUniqueAtlasItem(target, seen, item) {
  const key = itemIdentity(item);
  if (key && seen.has(key)) return;
  if (key) seen.add(key);
  target.push(item);
}

function buildAtlasCategorySections(items, taxonomyIndex = null, allowedCategoryIds = null) {
  const source = Array.isArray(items) ? items : [];
  const categories = new Map();

  for (const item of source) {
    const classifications = normalizeClassifications(item?.classification);
    const generalTargets = new Set(normalizeGeneralFor(item?.generalFor));
    const targets = (classifications.length
      ? classifications
      : [{
          categoryId: '',
          category: UNCLASSIFIED_ATLAS_CATEGORY,
          subcategoryId: '',
          subcategory: '',
          subdivisionId: '',
          subdivision: '',
        }])
      .map((classification) => resolveAtlasClassification(classification, taxonomyIndex));

    for (const classification of targets) {
      if (allowedCategoryIds instanceof Set) {
        if (!classification.categoryId || !allowedCategoryIds.has(classification.categoryId)) continue;
      }
      const categoryId = classification.categoryId || '';
      const categoryLabel = classification.category || categoryId || UNCLASSIFIED_ATLAS_CATEGORY;
      const categoryKey = categoryId || `label:${categoryLabel}`;

      const subcategoryId = classification.subcategoryId || '';
      const subcategoryLabel = classification.subcategory || subcategoryId || '';
      const subcategoryKey = subcategoryId || (subcategoryLabel ? `${categoryKey}::label:${subcategoryLabel}` : '');

      const subdivisionId = classification.subdivisionId || '';
      const subdivisionLabel = classification.subdivision || subdivisionId || '';
      const subdivisionKey = subdivisionId || (subdivisionLabel ? `${subcategoryKey}::label:${subdivisionLabel}` : '');

      if (!categories.has(categoryKey)) {
        categories.set(categoryKey, {
          key: categoryKey,
          id: categoryId || null,
          label: categoryLabel,
          generalItems: [],
          generalSeen: new Set(),
          directItems: [],
          directSeen: new Set(),
          subcategories: new Map(),
        });
      }

      const category = categories.get(categoryKey);

      if (!subcategoryLabel) {
        const isCategoryGeneral =
          (categoryId && generalTargets.has(categoryId)) ||
          (!categoryId && generalTargets.has(categoryLabel));

        if (isCategoryGeneral) {
          pushUniqueAtlasItem(category.generalItems, category.generalSeen, item);
        } else {
          pushUniqueAtlasItem(category.directItems, category.directSeen, item);
        }
        continue;
      }

      if (!category.subcategories.has(subcategoryKey)) {
        category.subcategories.set(subcategoryKey, {
          key: subcategoryKey,
          id: subcategoryId || null,
          label: subcategoryLabel,
          generalItems: [],
          generalSeen: new Set(),
          directItems: [],
          directSeen: new Set(),
          subdivisions: new Map(),
        });
      }

      const subcategory = category.subcategories.get(subcategoryKey);

      if (!subdivisionLabel) {
        const isSubcategoryGeneral =
          (subcategoryId && generalTargets.has(subcategoryId)) ||
          (!subcategoryId && generalTargets.has(subcategoryLabel));

        if (isSubcategoryGeneral) {
          pushUniqueAtlasItem(subcategory.generalItems, subcategory.generalSeen, item);
        } else {
          pushUniqueAtlasItem(subcategory.directItems, subcategory.directSeen, item);
        }
        continue;
      }

      if (!subcategory.subdivisions.has(subdivisionKey)) {
        subcategory.subdivisions.set(subdivisionKey, {
          key: subdivisionKey,
          id: subdivisionId || null,
          label: subdivisionLabel,
          generalItems: [],
          generalSeen: new Set(),
          directItems: [],
          directSeen: new Set(),
        });
      }

      const subdivision = subcategory.subdivisions.get(subdivisionKey);
      const isSubdivisionGeneral =
        (subdivisionId && generalTargets.has(subdivisionId)) ||
        (!subdivisionId && generalTargets.has(subdivisionLabel));

      if (isSubdivisionGeneral) {
        pushUniqueAtlasItem(subdivision.generalItems, subdivision.generalSeen, item);
      } else {
        pushUniqueAtlasItem(subdivision.directItems, subdivision.directSeen, item);
      }
    }
  }

  return Array.from(categories.values())
    .sort((a, b) => compareAtlasLabels(a.label, b.label))
    .map((category) => {
      const subOrder = ATLAS_SUBCATEGORY_ORDER_MAP[category.label] || null;

      return {
        key: category.key,
        id: category.id,
        label: category.label,
        generalItems: category.generalItems.sort(compareByTitleAsc),
        directItems: category.directItems.sort(compareByTitleAsc),
        subcategories: Array.from(category.subcategories.values())
          .sort((a, b) => compareAtlasLabels(a.label, b.label, subOrder))
          .map((subcategory) => ({
            key: subcategory.key,
            id: subcategory.id,
            label: subcategory.label,
            generalItems: subcategory.generalItems.sort(compareByTitleAsc),
            directItems: subcategory.directItems.sort(compareByTitleAsc),
            subdivisions: Array.from(subcategory.subdivisions.values())
              // L'ordre d'apparition est conservé pour les subdivisions déjà renvoyées par Strapi.
              .map((subdivision) => ({
                key: subdivision.key,
                id: subdivision.id,
                label: subdivision.label,
                generalItems: subdivision.generalItems.sort(compareByTitleAsc),
                directItems: subdivision.directItems.sort(compareByTitleAsc),
              })),
          })),
      };
    });
}

function getCaseThemesValue(item) {
  return (
    item?.[CASE_THEME_RELATION] ??
    item?.doc_themes ??
    item?.doc_theme ??
    item?.doctheme ??
    item?.docthemes ??
    null
  );
}

function normalizeDocThemes(value) {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.data)
      ? value.data
      : value
        ? [value]
        : [];

  return list
    .map((node) => (node?.attributes ? { id: node.id, ...node.attributes } : node))
    .filter(Boolean)
    .map((theme) => ({
      id: theme?.id ?? null,
      slug: String(theme?.slug || '').trim(),
      title: String(theme?.title || '').trim(),
      order: Number.isFinite(theme?.order) ? theme.order : Number.POSITIVE_INFINITY,
    }))
    .filter((theme) => theme.title || theme.slug);
}

function compareThemeSections(a, b) {
  const ao = Number.isFinite(a?.order) ? a.order : Number.POSITIVE_INFINITY;
  const bo = Number.isFinite(b?.order) ? b.order : Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;

  return String(a?.label || '').localeCompare(String(b?.label || ''), 'fr', {
    sensitivity: 'base',
    numeric: true,
  });
}

function buildCaseThemeSections(items) {
  const source = Array.isArray(items) ? items : [];
  const hasAtLeastOneTheme = source.some(
    (item) => normalizeDocThemes(getCaseThemesValue(item)).length > 0
  );

  if (!hasAtLeastOneTheme) return null;

  const map = new Map();

  for (const item of source) {
    const themes = normalizeDocThemes(getCaseThemesValue(item));
    const targets = themes.length ? themes : [UNTHEMED_THEME];

    for (const theme of targets) {
      const key = theme.slug || theme.title || UNTHEMED_KEY;

      if (!map.has(key)) {
        map.set(key, {
          key,
          label: theme.title || theme.slug || 'Sans thème',
          order: Number.isFinite(theme.order) ? theme.order : Number.POSITIVE_INFINITY,
          items: [],
        });
      }

      map.get(key).items.push(item);
    }
  }

  return Array.from(map.values()).sort(compareThemeSections);
}

function pickPrimaryBadge(badgesAny) {
  const badges = normalizeBadges(badgesAny);

  if (badges.length === 0) return null;

  // déterministe
  badges.sort((a, b) => String(a.label).localeCompare(String(b.label), 'fr', { sensitivity: 'base' }));

  return {
    text: badges[0].label,
    variant: badges[0].variant || 'info',
  };
}

function hasBadgeLabel(badgesAny, label) {
  const target = String(label || '').trim().toLowerCase();
  return normalizeBadges(badgesAny).some((b) => String(b.label).trim().toLowerCase() === target);
}

/**
 * Groupe "Type" (Atlas) = badge principal déterministe.
 * Règle anti-duplication : si plusieurs badges dont OPMD,
 * on choisit un badge non-OPMD si possible.
 */
function getGroupTypeLabel(badgesAny) {
  const badges = normalizeBadges(badgesAny);
  if (badges.length === 0) return 'Atlas';

  const nonOpmd = badges.filter((b) => String(b.label).trim().toLowerCase() !== 'opmd');
  const pool = nonOpmd.length ? nonOpmd : badges;

  pool.sort((a, b) => String(a.label).localeCompare(String(b.label), 'fr', { sensitivity: 'base' }));
  return pool[0]?.label || 'Atlas';
}

function getFirstLetter(title) {
  const t = String(title || '').trim();
  if (!t) return '#';

  const first = t[0]
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return /[A-Z]/.test(first) ? first : '#';
}

function compareBySlugAsc(aNode, bNode) {
  const a = normalizeNode(aNode);
  const b = normalizeNode(bNode);

  const sa = String(a?.slug ?? '');
  const sb = String(b?.slug ?? '');

  return sa.localeCompare(sb, 'fr', { numeric: true, sensitivity: 'base' });
}

function compareByTitleAsc(aNode, bNode) {
  const a = normalizeNode(aNode);
  const b = normalizeNode(bNode);

  const ta = String(a?.title ?? '').trim();
  const tb = String(b?.title ?? '').trim();

  // titres vides à la fin
  const aEmpty = !ta;
  const bEmpty = !tb;
  if (aEmpty && !bEmpty) return 1;
  if (!aEmpty && bEmpty) return -1;

  const c = ta.localeCompare(tb, 'fr', { numeric: true, sensitivity: 'base' });
  if (c !== 0) return c;

  const sa = String(a?.slug ?? '');
  const sb = String(b?.slug ?? '');
  return sa.localeCompare(sb, 'fr', { numeric: true, sensitivity: 'base' });
}

/* -------- Recherche permissive -------- */

function normalizeSearch(s) {
  const base = String(s || '').trim().toLowerCase();
  const noAccents = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return { base, noAccents };
}

function singularizeFr(word) {
  let w = String(word || '');
  if (w.length <= 3) return w;
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && w.length > 3) return w.slice(0, -1);
  if (w.endsWith('x') && w.length > 3) return w.slice(0, -1);
  return w;
}

function buildVariants(q) {
  const { base, noAccents } = normalizeSearch(q);
  const baseSing = singularizeFr(base);
  const noAccSing = singularizeFr(noAccents);
  return Array.from(new Set([base, noAccents, baseSing, noAccSing].filter(Boolean)));
}

function buildOrFilterFromVariants(variants) {
  return variants.flatMap((v) => [
    { title: { $containsi: v } },
    { excerpt: { $containsi: v } },
    { slug: { $containsi: v } },
  ]);
}

function normForSearch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function itemMatchesQuery(item, q) {
  const nq = normForSearch(q);
  if (!nq) return true;

  const title = normForSearch(item?.title);
  const excerpt = normForSearch(item?.excerpt);
  const slug = normForSearch(item?.slug);

  return title.includes(nq) || excerpt.includes(nq) || slug.includes(nq);
}

function buildSearch({ q, page }) {
  const sp = new URLSearchParams();
  if (q) sp.set('q', q);
  if (page && page > 1) sp.set('page', String(page));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/* -------- Mode depuis l’URL -------- */

function getHubAndSelection(pathname) {
  if (pathname === '/atlas' || pathname.startsWith('/atlas/')) {
    return { hub: 'atlas', selection: ATLAS_KEY };
  }

  if (pathname === '/entrainement' || pathname.startsWith('/entrainement/')) {
    const segs = pathname.split('/').filter(Boolean);
    const sub = segs[1] || null;

    if (sub === 'qr') return { hub: 'training', selection: STRAPI_QA_TYPE };
    if (sub === 'quiz') return { hub: 'training', selection: STRAPI_QUIZ_TYPE };
    if (sub === 'presentation') return { hub: 'training', selection: STRAPI_PRESENTATION_TYPE };

    // /entrainement ouvre désormais directement le mode Quiz.
    return { hub: 'training', selection: STRAPI_QUIZ_TYPE };
  }

  return { hub: 'unknown', selection: 'all' };
}

function ViewToggle({ view, setView }) {
  return (
    <div className="cc-viewtoggle" role="group" aria-label="Affichage">
      <button
        type="button"
        className={`cc-viewbtn ${view === 'cards' ? 'active' : ''}`}
        onClick={() => setView('cards')}
        aria-pressed={view === 'cards'}
        aria-label="Affichage cartes"
        title="Cartes"
      >
        <svg className="cc-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
          />
        </svg>
      </button>

      <button
        type="button"
        className={`cc-viewbtn ${view === 'list' ? 'active' : ''}`}
        onClick={() => setView('list')}
        aria-pressed={view === 'list'}
        aria-label="Affichage liste"
        title="Liste"
      >
        <svg className="cc-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 6h2v2H4V6zm4 0h12v2H8V6zM4 11h2v2H4v-2zm4 0h12v2H8v-2zM4 16h2v2H4v-2zm4 0h12v2H8v-2z"
          />
        </svg>
      </button>
    </div>
  );
}

/* =========================
   Contrôles Atlas
   ========================= */

function AtlasControls({ atlasGroup, setAtlasGroup }) {
  return (
    <div className="atlas-ui-controls" role="group" aria-label="Contrôles Atlas">
      <div className="atlas-ui-control" role="group" aria-label="Grouper par">
        <span className="cc-sortlabel">Grouper par :</span>

        <button
          type="button"
          className={`cc-sortbtn ${atlasGroup === 'category' ? 'active' : ''}`}
          onClick={() => setAtlasGroup('category')}
          aria-pressed={atlasGroup === 'category'}
        >
          Catégorie
        </button>

        <button
          type="button"
          className={`cc-sortbtn ${atlasGroup === 'letter' ? 'active' : ''}`}
          onClick={() => setAtlasGroup('letter')}
          aria-pressed={atlasGroup === 'letter'}
        >
          Lettre
        </button>

        <button
          type="button"
          className={`cc-sortbtn ${atlasGroup === 'none' ? 'active' : ''}`}
          onClick={() => setAtlasGroup('none')}
          aria-pressed={atlasGroup === 'none'}
        >
          Aucun
        </button>
      </div>
    </div>
  );
}

function CaseControls({ caseGroup, setCaseGroup, groupLabel = 'Thème' }) {
  return (
    <div className="cc-case-controls" role="group" aria-label="Contrôles des cas cliniques">
      <div className="cc-case-control" role="group" aria-label="Grouper par">
        <span className="cc-sortlabel">Grouper par :</span>

        <button
          type="button"
          className={`cc-sortbtn ${caseGroup === 'theme' ? 'active' : ''}`}
          onClick={() => setCaseGroup('theme')}
          aria-pressed={caseGroup === 'theme'}
        >
          {groupLabel}
        </button>

        <button
          type="button"
          className={`cc-sortbtn ${caseGroup === 'none' ? 'active' : ''}`}
          onClick={() => setCaseGroup('none')}
          aria-pressed={caseGroup === 'none'}
        >
          Aucun
        </button>
      </div>
    </div>
  );
}

export default function CasCliniques() {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [atlasTaxonomy, setAtlasTaxonomy] = useState(null);
  const [atlasTaxonomyLoading, setAtlasTaxonomyLoading] = useState(false);
  const [atlasTaxonomyError, setAtlasTaxonomyError] = useState('');
  const lastFocusAtRef = useRef(Date.now());
  const handledRefreshRef = useRef(0);

  useEffect(() => {
    const refreshAfterFocus = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocusAtRef.current < 5 * 60_000) return;
      lastFocusAtRef.current = now;
      setRefreshToken((v) => v + 1);
    };
    window.addEventListener('focus', refreshAfterFocus);
    document.addEventListener('visibilitychange', refreshAfterFocus);
    return () => {
      window.removeEventListener('focus', refreshAfterFocus);
      document.removeEventListener('visibilitychange', refreshAfterFocus);
    };
  }, []);

  // toggle Cartes / Liste (persisté)
  const [view, setView] = useState(() => {
    const saved = localStorage.getItem('cc:view');
    return saved === 'cards' ? 'cards' : 'list';
  });

  useEffect(() => {
    localStorage.setItem('cc:view', view);
  }, [view]);

  // Atlas : classement pédagogique par catégorie par défaut.
  // La clé v2 permet de ne pas réutiliser l'ancien défaut « Lettre » mémorisé.
  const [atlasGroup, setAtlasGroup] = useState(() => {
    const saved = localStorage.getItem('atlas:group:v2');
    return ['category', 'letter', 'none'].includes(saved) ? saved : 'category';
  }); // 'category' | 'letter' | 'none'

  useEffect(() => {
    localStorage.setItem('atlas:group:v2', atlasGroup);
    localStorage.setItem('atlas:show', 'all');
  }, [atlasGroup]);

  const [caseGroup, setCaseGroup] = useState(() => {
    const saved = localStorage.getItem('cases:group');
    return saved === 'none' ? 'none' : 'theme';
  }); // 'theme' | 'none'

  useEffect(() => {
    localStorage.setItem('cases:group', caseGroup);
  }, [caseGroup]);

  const q = searchParams.get('q') || '';
  const page = Number(searchParams.get('page') || 1);
  const requestedAtlasTab = searchParams.get('tab') || '';

  const { hub, selection } = getHubAndSelection(pathname);

  const isAtlasHub = hub === 'atlas';
  const isTrainingHub = hub === 'training';

  // Ancien sélecteur de quatre gros boutons conservé dans le code, mais plus utilisé.
  const showTypePicker = false;
  const tab = selection; // 'atlas' | 'qa' | 'quiz' | 'presentation'

  const atlasTaxonomyIndex = useMemo(() => buildAtlasTaxonomyIndex(atlasTaxonomy), [atlasTaxonomy]);
  const atlasTabs = atlasTaxonomyIndex?.tabs || [];
  const defaultAtlasTabId =
    atlasTabs.find((entry) => entry.id === 'tab_medecine_orale')?.id || atlasTabs[0]?.id || '';
  const activeAtlasTabId = atlasTabs.some((entry) => entry.id === requestedAtlasTab)
    ? requestedAtlasTab
    : defaultAtlasTabId;

  const activeAtlasCategoryIds = useMemo(() => {
    if (!atlasTaxonomyIndex || !activeAtlasTabId) return new Set();
    return new Set(
      atlasTaxonomyIndex.categories
        .filter((category) => category.tabs.includes(activeAtlasTabId))
        .map((category) => category.id)
    );
  }, [atlasTaxonomyIndex, activeAtlasTabId]);

  const variants = useMemo(() => (q ? buildVariants(q) : []), [q]);

  // La route historique /entrainement devient une entrée directe vers le Quiz.
  useEffect(() => {
    if (pathname !== '/entrainement') return;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    navigate(`/entrainement/quiz${suffix}`, { replace: true });
  }, [pathname, q, navigate]);

  const goPage = (p) => {
    const base = isAtlasHub
      ? '/atlas'
      : isTrainingHub
        ? tab === STRAPI_QA_TYPE
          ? '/entrainement/qr'
          : tab === STRAPI_QUIZ_TYPE
            ? '/entrainement/quiz'
            : '/entrainement/presentation'
        : '/';

    navigate(`${base}${buildSearch({ q, page: p })}`);
  };

  const caseTypeFilterOnly = useMemo(() => {
    const f = {};

    if (
      tab === STRAPI_QA_TYPE ||
      tab === STRAPI_QUIZ_TYPE ||
      tab === STRAPI_PRESENTATION_TYPE
    ) {
      f.type = { $eq: tab };
    }

    return f;
  }, [tab]);

  const caseFilters = useMemo(() => {
    const f = { ...caseTypeFilterOnly };
    if (q) f.$or = buildOrFilterFromVariants(variants);
    return f;
  }, [caseTypeFilterOnly, q, variants]);

  const pathoFilters = useMemo(() => {
    const f = {};
    if (q) f.$or = buildOrFilterFromVariants(variants);
    return f;
  }, [q, variants]);

  // Atlas : on ne demande à Strapi que les pathologies appartenant aux
  // catégories du tab actif. Le filtrage client reste conservé comme sécurité,
  // mais il n'est plus responsable de charger les 200+ fiches à chaque entrée.
  const atlasCategoryOnlyFilters = useMemo(() => {
    if (!(isAtlasHub && tab === ATLAS_KEY)) return {};
    const categoryIds = Array.from(activeAtlasCategoryIds);
    if (categoryIds.length === 0) return {};

    return {
      classification: {
        categoryId: { $in: categoryIds },
      },
    };
  }, [isAtlasHub, tab, activeAtlasCategoryIds]);

  const atlasPathoFilters = useMemo(() => ({
    ...atlasCategoryOnlyFilters,
    ...pathoFilters,
  }), [atlasCategoryOnlyFilters, pathoFilters]);

  useEffect(() => {
    if (!isAtlasHub) return undefined;

    let ignore = false;
    const controller = new AbortController();
    const now = Date.now();
    const cachedTaxonomy = ATLAS_TAXONOMY_CACHE;
    const cacheIsFresh =
      cachedTaxonomy && now - ATLAS_TAXONOMY_CACHE_AT <= ATLAS_TAXONOMY_CACHE_STALE_MS;

    if (cachedTaxonomy) {
      setAtlasTaxonomy(cachedTaxonomy);
      setAtlasTaxonomyLoading(false);
      setAtlasTaxonomyError('');
    }

    // Au premier affichage ou lors d'un retour récent depuis CaseDetail, la copie
    // mémoire suffit. Un refresh explicite/focus ancien force néanmoins une mise à jour.
    if (cacheIsFresh && refreshToken === 0) return () => controller.abort();

    async function loadAtlasTaxonomy() {
      if (!cachedTaxonomy) setAtlasTaxonomyLoading(true);
      setAtlasTaxonomyError('');

      try {
        const data = await strapiFetch(ATLAS_TAXONOMY_ENDPOINT, {
          params: { fields: ['taxonomy'] },
          options: { signal: controller.signal },
        });

        if (ignore) return;
        const taxonomy = normalizeAtlasTaxonomy(data);
        if (!taxonomy) throw new Error('Taxonomie Atlas absente ou invalide.');

        ATLAS_TAXONOMY_CACHE = taxonomy;
        ATLAS_TAXONOMY_CACHE_AT = Date.now();
        setAtlasTaxonomy(taxonomy);
      } catch (e) {
        if (!ignore && !isAbortError(e) && !cachedTaxonomy) {
          setAtlasTaxonomyError(e?.message || 'Erreur de chargement de la taxonomie Atlas');
        }
      } finally {
        if (!ignore && !cachedTaxonomy) setAtlasTaxonomyLoading(false);
      }
    }

    loadAtlasTaxonomy();
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [isAtlasHub, refreshToken]);


  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();
    const forceRefresh = handledRefreshRef.current !== refreshToken;
    handledRefreshRef.current = refreshToken;

    if (showTypePicker) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setError('');
      return () => controller.abort();
    }

    // Pour l'Atlas, la taxonomie est nécessaire avant de connaître les catégories
    // à demander au backend. On évite donc le gros fetch non filtré de l'ancienne version.
    if (isAtlasHub && (!atlasTaxonomyIndex || !activeAtlasTabId)) {
      setItems([]);
      setTotal(0);
      setLoading(Boolean(atlasTaxonomyLoading));
      setError('');
      return () => controller.abort();
    }

    if (isAtlasHub && activeAtlasCategoryIds.size === 0) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setError('');
      return () => controller.abort();
    }

    const cacheKey = isAtlasHub
      ? `atlas:${activeAtlasTabId}:all:${q}`
      : `cases:${tab}:${page}:${q}`;
    const cached = readListCache(cacheKey);
    const isBackgroundRefresh = Boolean(cached);

    if (cached) {
      // Stale-while-revalidate : on conserve le contenu déjà affiché pendant
      // un rafraîchissement (notamment au retour sur l'onglet du navigateur).
      // Cela évite que la hauteur de la page s'effondre et que le scroll remonte.
      setItems(cached.items);
      setTotal(cached.total);
      setLoading(false);
      setError('');
      if (cached.isFresh && !forceRefresh) return () => controller.abort();
    }

    async function load() {
      // Le loader plein écran n'est utile que lorsqu'il n'y a encore rien à afficher.
      // Si une copie en cache existe, le fetch se fait silencieusement en arrière-plan.
      if (!isBackgroundRefresh) setLoading(true);
      setError('');

      try {
        // Atlas => toutes les pathologies, sans pagination côté interface.
        // On récupère les pages Strapi par lots puis on les fusionne. Cela reste
        // fiable même si le backend impose une limite maximale par requête.
        if (isAtlasHub && tab === ATLAS_KEY) {
          const fetchAtlasPage = (filters, requestedPage) =>
            strapiFetch(PATHO_ENDPOINT, {
              params: {
                populate: {
                  cover: { fields: ['url', 'formats'] },
                  badges: { fields: ['label', 'variant'] },
                  classification: {
                    fields: [
                      'categoryId',
                      'category',
                      'subcategoryId',
                      'subcategory',
                      'subdivisionId',
                      'subdivision',
                    ],
                  },
                },
                locale: 'all',
                filters,
                sort: 'title:asc,slug:asc',
                pagination: { page: requestedPage, pageSize: ATLAS_BATCH_SIZE },
                fields: ['title', 'slug', 'excerpt', 'updatedAt', 'generalFor'],
                publicationState: 'live',
              },
              options: { signal: controller.signal },
            });

          const fetchAllPathologies = async (filters) => {
            // La première page nous donne pageCount ; les pages suivantes sont ensuite
            // récupérées en parallèle plutôt qu'une par une.
            const first = await fetchAtlasPage(filters, 1);
            if (ignore) return null;

            const firstBatch = Array.isArray(first?.data) ? first.data : [];
            const pagination = first?.meta?.pagination || {};
            const metaPageCount = Number(pagination.pageCount);
            const pageCount = Number.isFinite(metaPageCount) && metaPageCount > 0 ? metaPageCount : 1;
            const metaTotal = Number(pagination.total);

            if (pageCount <= 1) {
              return {
                data: firstBatch,
                total: Number.isFinite(metaTotal) ? metaTotal : firstBatch.length,
              };
            }

            const remainingPages = await Promise.all(
              Array.from({ length: pageCount - 1 }, (_, index) => fetchAtlasPage(filters, index + 2))
            );
            if (ignore) return null;

            const all = [...firstBatch];
            for (const pageData of remainingPages) {
              if (Array.isArray(pageData?.data)) all.push(...pageData.data);
            }

            return {
              data: all,
              total: Number.isFinite(metaTotal) ? metaTotal : all.length,
            };
          };

          const result = await fetchAllPathologies(atlasPathoFilters);
          if (ignore || !result) return;

          let normalized = result.data.map(normalizeNode).filter((it) => it?.slug);
          let nextTotal = result.total;

          // Recherche permissive historique : si le filtre Strapi ne trouve rien,
          // on charge l'Atlas complet puis on applique la recherche côté client.
          if (q && normalized.length === 0) {
            const fallback = await fetchAllPathologies(atlasCategoryOnlyFilters);
            if (ignore || !fallback) return;

            normalized = fallback.data
              .map(normalizeNode)
              .filter((it) => it?.slug)
              .filter((it) => itemMatchesQuery(it, q));
            nextTotal = normalized.length;
          }

          const nextItems = normalized.map((it) => ({ ...it, __entity: 'pathology' }));
          setItems(nextItems);
          setTotal(nextTotal);
          writeListCache(cacheKey, nextItems, nextTotal);
          return;
        }

        // Entraînement => cas Q/R, quiz ou présentations
        if (
          isTrainingHub &&
          (tab === STRAPI_QA_TYPE || tab === STRAPI_QUIZ_TYPE || tab === STRAPI_PRESENTATION_TYPE)
        ) {
          const data = await strapiFetch(CASES_ENDPOINT, {
            params: {
              populate: {
                cover: { fields: ['url', 'formats'] },
                [CASE_THEME_RELATION]: { fields: ['title', 'slug', 'order'] },
              },
              locale: 'all',
              filters: caseFilters,
              // Les présentations sont triées par titre ; Q/R et Quiz conservent le tri historique par slug.
              sort: tab === STRAPI_PRESENTATION_TYPE ? 'title:asc,slug:asc' : 'slug:asc',
              pagination: { page, pageSize: PAGE_SIZE },
              fields: ['title', 'slug', 'type', 'excerpt', 'updatedAt'],
              publicationState: 'live',
            },
            options: { signal: controller.signal },
          });

          if (ignore) return;

          let list = Array.isArray(data?.data) ? data.data : [];
          let normalized = list.map(normalizeNode).filter((it) => it?.slug);

          if (q && normalized.length === 0) {
            const fallback = await strapiFetch(CASES_ENDPOINT, {
              params: {
                populate: {
                  cover: { fields: ['url', 'formats'] },
                  [CASE_THEME_RELATION]: { fields: ['title', 'slug', 'order'] },
                },
                locale: 'all',
                filters: caseTypeFilterOnly,
                sort: tab === STRAPI_PRESENTATION_TYPE ? 'title:asc,slug:asc' : 'slug:asc',
                pagination: { page: 1, pageSize: FALLBACK_PAGE_SIZE },
                fields: ['title', 'slug', 'type', 'excerpt', 'updatedAt'],
                publicationState: 'live',
              },
              options: { signal: controller.signal },
            });

            if (ignore) return;
            const all = Array.isArray(fallback?.data) ? fallback.data : [];
            normalized = all
              .map(normalizeNode)
              .filter((it) => it?.slug)
              .filter((it) => itemMatchesQuery(it, q));
          }

          const nextItems = normalized.map((it) => ({ ...it, __entity: 'case' }));
          const nextTotal = data?.meta?.pagination?.total ?? normalized.length ?? 0;
          setItems(nextItems);
          setTotal(nextTotal);
          writeListCache(cacheKey, nextItems, nextTotal);
          return;
        }

        setItems([]);
        setTotal(0);
      } catch (e) {
        if (!ignore && !isAbortError(e)) {
          // En cas d'échec d'un refresh en arrière-plan, on garde la dernière
          // liste valide à l'écran au lieu de la remplacer par un état d'erreur.
          if (!isBackgroundRefresh) {
            setError(e?.message || 'Erreur de chargement');
          }
        }
      } finally {
        if (!ignore && !isBackgroundRefresh) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [
    showTypePicker,
    isAtlasHub,
    isTrainingHub,
    tab,
    page,
    q,
    variants,
    caseFilters,
    pathoFilters,
    atlasPathoFilters,
    atlasCategoryOnlyFilters,
    atlasTaxonomyIndex,
    atlasTaxonomyLoading,
    activeAtlasTabId,
    activeAtlasCategoryIds,
    caseTypeFilterOnly,
    refreshToken,
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Tri UI (cohérent avec tes règles)
  const sortedItems = useMemo(() => {
    const arr = Array.isArray(items) ? [...items] : [];

    // ATLAS => title
    if (isAtlasHub && tab === ATLAS_KEY) {
      arr.sort(compareByTitleAsc);
      return arr;
    }

    // Présentation => title
    if (isTrainingHub && tab === STRAPI_PRESENTATION_TYPE) {
      arr.sort(compareByTitleAsc);
      return arr;
    }

    // Q/R ou Quiz => slug
    if (isTrainingHub && (tab === STRAPI_QA_TYPE || tab === STRAPI_QUIZ_TYPE)) {
      arr.sort(compareBySlugAsc);
      return arr;
    }

    // fallback
    arr.sort(compareBySlugAsc);
    return arr;
  }, [items, isAtlasHub, isTrainingHub, tab]);

  // Atlas : n'afficher que les pathologies appartenant aux catégories du tab actif.
  const atlasVisibleItems = useMemo(() => {
    if (!(isAtlasHub && tab === ATLAS_KEY)) return sortedItems;
    if (!atlasTaxonomyIndex || !activeAtlasTabId) return [];
    return sortedItems.filter((item) => itemBelongsToAtlasCategories(item, activeAtlasCategoryIds));
  }, [sortedItems, isAtlasHub, tab, atlasTaxonomyIndex, activeAtlasTabId, activeAtlasCategoryIds]);

  // Atlas : sections alphabétiques (ancien affichage, conservé comme option).
  const atlasLetterSections = useMemo(() => {
    if (!(isAtlasHub && tab === ATLAS_KEY)) return null;

    const map = new Map();

    for (const it of atlasVisibleItems) {
      const label = getFirstLetter(it?.title);
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(it);
    }

    const labels = Array.from(map.keys()).sort((a, b) =>
      String(a).localeCompare(String(b), 'fr', { sensitivity: 'base' })
    );

    return labels.map((label) => ({
      key: String(label),
      label,
      items: map.get(label),
    }));
  }, [isAtlasHub, tab, atlasVisibleItems]);

  // Atlas : classification pédagogique Catégorie > Sous-catégorie > Subdivision facultative.
  // Une même pathologie peut apparaître dans plusieurs branches si plusieurs
  // composants `classification` sont présents dans Strapi.
  const atlasCategorySections = useMemo(() => {
    if (!(isAtlasHub && tab === ATLAS_KEY)) return null;
    return buildAtlasCategorySections(atlasVisibleItems, atlasTaxonomyIndex, activeAtlasCategoryIds);
  }, [isAtlasHub, tab, atlasVisibleItems, atlasTaxonomyIndex, activeAtlasCategoryIds]);


  const caseThemeSections = useMemo(() => {
    if (
      !isTrainingHub ||
      !(
        tab === STRAPI_QA_TYPE ||
        tab === STRAPI_QUIZ_TYPE ||
        tab === STRAPI_PRESENTATION_TYPE
      )
    ) {
      return null;
    }

    return buildCaseThemeSections(sortedItems);
  }, [isTrainingHub, tab, sortedItems]);

  const useCaseThemeSections =
    caseGroup === 'theme' &&
    Array.isArray(caseThemeSections) &&
    caseThemeSections.length > 0;

  const title = isAtlasHub ? 'Atlas' : isTrainingHub ? 'Entraînement' : 'Atlas';
  const description = isAtlasHub
    ? 'Atlas de pathologies orales, variations physiologiques de la muqueuse et cas cliniques associés.'
    : isTrainingHub
      ? 'Bibliothèque de cas cliniques : quiz diagnostiques, questions rédactionnelles et présentations de cas issus de la littérature.'
      : 'Atlas de pathologies orales.';

  // Navigation entre les modes d'entraînement.
  const showChips =
    !showTypePicker &&
    isTrainingHub &&
    (tab === STRAPI_QA_TYPE || tab === STRAPI_QUIZ_TYPE || tab === STRAPI_PRESENTATION_TYPE);

  const onChip = (nextTab) => {
    if (nextTab === RANDOM_KEY) {
      navigate('/entrainement/aleatoire');
      return;
    }

    const base =
      nextTab === STRAPI_QA_TYPE
        ? '/entrainement/qr'
        : nextTab === STRAPI_QUIZ_TYPE
          ? '/entrainement/quiz'
          : '/entrainement/presentation';

    navigate(`${base}${buildSearch({ q, page: 1 })}`);
  };

  const onAtlasTab = (nextTabId) => {
    if (!nextTabId) return;
    const params = new URLSearchParams(searchParams);
    params.set('tab', nextTabId);
    params.delete('page');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    navigate(`/atlas${suffix}`);
  };

  const renderItem = (attrs, idx) => {
    if (!attrs) return null;

    const entity = attrs.__entity || (isAtlasHub ? 'pathology' : 'case');

    const titleText = attrs?.title || 'Sans titre';
    const slug = attrs?.slug || '';

    const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
    const coverUrl = imgUrl(coverAttr, 'medium') || imgUrl(coverAttr, 'thumbnail') || imgUrl(coverAttr) || '';

    let toHref = null;
    if (slug) {
      toHref = entity === 'pathology' ? `/atlas/${slug}` : `/entrainement/cas/${slug}`;
    }

    const isPathology = entity === 'pathology';
    const isListView = view === 'list';

    // Les badges complets restent transmis au détail de la pathologie, mais ne sont
    // plus affichés sur les cartes de l'Atlas.
    const pathoBadges = isPathology ? normalizeBadges(attrs?.badges) : [];

    // Les données de navigation conservent les badges complets pour CaseDetail.
    const primaryBadge = isPathology ? pickPrimaryBadge(attrs?.badges) : null;

    const key = `${entity}:${slug || idx}`;

    const linkState =
      entity === 'pathology'
        ? {
            breadcrumb: {
              mode: 'atlas',
              pathology: {
                slug,
                title: titleText,
                badge: primaryBadge,
                badges: pathoBadges,
              },
              case: null,
            },
            prefetch: {
              slug,
              title: titleText,
              type: 'presentation',
              badges: attrs?.badges ?? null,
            },
          }
        : {
            breadcrumb: { mode: 'entrainement', case: { slug, title: titleText } },
            prefetch: { slug, title: titleText, type: attrs?.type || null },
          };

    // Atlas et Entraînement utilisent volontairement exactement le même
    // composant visuel. Les seules différences sont les données affichées
    // (par exemple les badges Atlas), jamais les classes ni la structure CSS.
    const cardClass = `display-card ${isListView ? 'display-card--list' : 'display-card--cards'}`;

    const Inner = (
      <>
        <div
          className={coverUrl ? 'display-card-thumb' : 'display-card-thumb display-card-thumb--empty'}
          aria-hidden="true"
        >
          {coverUrl && (
            <img
              className="display-card-thumb-img"
              src={coverUrl}
              alt=""
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              draggable="false"
            />
          )}
        </div>

        <div className="display-card-body">
          <h3 className="display-card-title">{titleText}</h3>

        </div>
      </>
    );

    return toHref ? (
      <Link key={key} to={toHref} className={cardClass} state={linkState} draggable="false">
        {Inner}
      </Link>
    ) : (
      <div key={key} className={`${cardClass} display-card--disabled`} title="Slug manquant">
        {Inner}
      </div>
    );
  };

  const renderGeneralPathologyLink = (attrs, idx) => {
    if (!attrs?.slug) return null;

    const titleText = attrs?.title || 'Fiche générale';
    const slug = attrs.slug;
    const pathoBadges = normalizeBadges(attrs?.badges);
    const primaryBadge = pickPrimaryBadge(attrs?.badges);

    return (
      <Link
        key={`atlas-general:${slug || idx}`}
        to={`/atlas/${slug}`}
        className="atlas-ui-general-pathology-link"
        aria-label={`Ouvrir la fiche générale : ${titleText}`}
        title={titleText}
        state={{
          breadcrumb: {
            mode: 'atlas',
            pathology: {
              slug,
              title: titleText,
              badge: primaryBadge,
              badges: pathoBadges,
            },
            case: null,
          },
          prefetch: {
            slug,
            title: titleText,
            type: 'presentation',
            badges: attrs?.badges ?? null,
          },
        }}
      >
        <span className="atlas-ui-general-pathology-kicker">Fiche générale</span>
      </Link>
    );
  };

  const renderAtlasSubcategories = (category) => {
    const subcategories = Array.isArray(category?.subcategories) ? category.subcategories : [];
    if (subcategories.length === 0) return null;

    return (
      <div className="atlas-ui-subcategory-stack">
        {subcategories.map((subcategory) => {
          const generalItems = Array.isArray(subcategory?.generalItems) ? subcategory.generalItems : [];
          const directItems = Array.isArray(subcategory?.directItems) ? subcategory.directItems : [];
          const subdivisions = Array.isArray(subcategory?.subdivisions) ? subcategory.subdivisions : [];
          const hasSubdivisions = subdivisions.length > 0;
          const showGeneralInHeading = view === 'list' && generalItems.length > 0;

          // En vue Cartes, la fiche générale reste une carte normale : seule la vue
          // Liste la déplace dans le cartouche bleu de sous-catégorie.
          const contentDirectItems = view === 'list'
            ? directItems
            : [...generalItems, ...directItems].sort(compareByTitleAsc);

          // En desktop / vue Liste, la partie droite du cartouche de sous-catégorie
          // reprend les subdivisions. Leur hauteur relative suit approximativement
          // le nombre de rangées de lésions (3 lésions par rangée).
          const subdivisionRows = [];
          if (contentDirectItems.length > 0 && hasSubdivisions) {
            subdivisionRows.push({
              key: `${subcategory.key}::__direct__`,
              label: '',
              rowWeight: Math.max(1, Math.ceil(contentDirectItems.length / 3)),
              isDirect: true,
            });
          }
          for (const subdivision of subdivisions) {
            const subdivisionGeneralItems = Array.isArray(subdivision?.generalItems)
              ? subdivision.generalItems
              : [];
            const subdivisionDirectItems = Array.isArray(subdivision?.directItems)
              ? subdivision.directItems
              : [];

            subdivisionRows.push({
              key: subdivision.key,
              label: subdivision.label,
              generalItems: subdivisionGeneralItems,
              rowWeight: Math.max(1, Math.ceil(subdivisionDirectItems.length / 3)),
              isDirect: false,
            });
          }

          const subdivisionTemplateRows = subdivisionRows.length
            ? subdivisionRows.map((row) => `${row.rowWeight}fr`).join(' ')
            : undefined;

          return (
            <section
              key={subcategory.key}
              className={`atlas-ui-subcategory-panel ${
                hasSubdivisions ? 'atlas-ui-subcategory-panel--has-subdivisions' : ''
              } ${showGeneralInHeading ? 'atlas-ui-subcategory-panel--has-general' : ''}`}
              aria-label={subcategory.label}
            >
              <div
                className="atlas-ui-subcategory-heading"
                style={
                  subdivisionTemplateRows
                    ? { '--atlas-ui-subdivision-template-rows': subdivisionTemplateRows }
                    : undefined
                }
              >
                <div className="atlas-ui-subcategory-main">
                  <h3 className="atlas-ui-subcategory-title">{subcategory.label}</h3>

                  {showGeneralInHeading && (
                    <div className="atlas-ui-general-pathology-list" aria-label="Fiche générale">
                      {generalItems.map(renderGeneralPathologyLink)}
                    </div>
                  )}
                </div>

                {subdivisionRows.length > 0 && (
                  <div className="atlas-ui-subcategory-subdivision-rail" aria-label="Subdivisions">
                    {subdivisionRows.map((row) => {
                      const hasSubdivisionGeneral = !row.isDirect && row.generalItems?.length > 0;

                      return (
                        <div
                          key={row.key}
                          className={`atlas-ui-subcategory-subdivision-segment ${
                            row.isDirect ? 'atlas-ui-subcategory-subdivision-segment--direct' : ''
                          } ${
                            hasSubdivisionGeneral
                              ? 'atlas-ui-subcategory-subdivision-segment--has-general'
                              : ''
                          }`}
                          aria-hidden={row.isDirect ? 'true' : undefined}
                        >
                          {!row.isDirect && (
                            <>
                              <span className="atlas-ui-subcategory-subdivision-label">{row.label}</span>

                              {view === 'list' && hasSubdivisionGeneral && (
                                <div
                                  className="atlas-ui-subdivision-general-pathology-list"
                                  aria-label="Fiche générale"
                                >
                                  {row.generalItems.map(renderGeneralPathologyLink)}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="atlas-ui-subcategory-content">
                {contentDirectItems.length > 0 && (
                  <div
                    className={`display-grid display-grid--panel display-grid--${view}`}
                  >
                    {contentDirectItems.map(renderItem)}
                  </div>
                )}

                {subdivisions.map((subdivision) => {
                  const subdivisionGeneralItems = Array.isArray(subdivision?.generalItems)
                    ? subdivision.generalItems
                    : [];
                  const subdivisionDirectItems = Array.isArray(subdivision?.directItems)
                    ? subdivision.directItems
                    : [];
                  const subdivisionContentItems = view === 'list'
                    ? subdivisionDirectItems
                    : [...subdivisionGeneralItems, ...subdivisionDirectItems].sort(compareByTitleAsc);

                  return (
                    <section
                      key={subdivision.key}
                      className="atlas-ui-subdivision-block"
                      aria-label={`${subcategory.label} — ${subdivision.label}`}
                    >
                      <h4 className="atlas-ui-subdivision-title">{subdivision.label}</h4>

                      {view === 'list' && subdivisionGeneralItems.length > 0 && (
                        <div
                          className="atlas-ui-subdivision-general-pathology-list atlas-ui-subdivision-general-pathology-list--content"
                          aria-label="Fiche générale"
                        >
                          {subdivisionGeneralItems.map(renderGeneralPathologyLink)}
                        </div>
                      )}

                      {subdivisionContentItems.length > 0 && (
                        <div
                          className={`display-grid display-grid--panel display-grid--${view}`}
                        >
                          {subdivisionContentItems.map(renderItem)}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    );
  };

  const isAtlasList = isAtlasHub && tab === ATLAS_KEY;
  const listForEmptyCheck = isAtlasList ? atlasVisibleItems : sortedItems;
  const effectiveLoading = loading || (isAtlasHub && atlasTaxonomyLoading);
  const effectiveError = error || (isAtlasHub ? atlasTaxonomyError : '');

  return (
    <>
      {(isAtlasHub || showChips) && (
        <div className="page-header display-page-header">
          <div className="container">
            <div className="display-page-header-row">
              <div className="display-page-header-copy">
                <PageTitle description={description}>{title}</PageTitle>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="container">
        {showTypePicker && <TypePicker />}

        {isAtlasHub && atlasTabs.length > 0 && (
          <section className="cc-toolbar cc-toolbar--top cc-training-toolbar display-tabbar">
            <div className="cc-tabs" role="tablist" aria-label="Sections de l’Atlas">
              {atlasTabs.map((atlasTab) => (
                <button
                  key={atlasTab.id}
                  type="button"
                  className={`cc-tab ${activeAtlasTabId === atlasTab.id ? 'active' : ''}`}
                  onClick={() => onAtlasTab(atlasTab.id)}
                  role="tab"
                  aria-selected={activeAtlasTabId === atlasTab.id}
                >
                  {atlasTab.label}
                </button>
              ))}
            </div>

            <div className="display-tabbar-actions" aria-label="Options d’affichage de l’Atlas">
              <FilterMenu>
                <AtlasControls atlasGroup={atlasGroup} setAtlasGroup={setAtlasGroup} />
              </FilterMenu>
              <ViewToggle view={view} setView={setView} />
            </div>
          </section>
        )}

        {showChips && (
          <>
            <section className="cc-toolbar cc-toolbar--top cc-training-toolbar display-tabbar">
              <div className="cc-tabs" role="tablist" aria-label="Modes d’entraînement">
              <button
                type="button"
                className={`cc-tab ${tab === STRAPI_QA_TYPE ? 'active' : ''}`}
                onClick={() => onChip(STRAPI_QA_TYPE)}
                role="tab"
                aria-selected={tab === STRAPI_QA_TYPE}
              >
                Q/R
              </button>

              <button
                type="button"
                className={`cc-tab ${tab === STRAPI_QUIZ_TYPE ? 'active' : ''}`}
                onClick={() => onChip(STRAPI_QUIZ_TYPE)}
                role="tab"
                aria-selected={tab === STRAPI_QUIZ_TYPE}
              >
                Quiz
              </button>

              <button
                type="button"
                className={`cc-tab ${tab === STRAPI_PRESENTATION_TYPE ? 'active' : ''}`}
                onClick={() => onChip(STRAPI_PRESENTATION_TYPE)}
                role="tab"
                aria-selected={tab === STRAPI_PRESENTATION_TYPE}
              >
                Présentation
              </button>

              {/*
                Fonction Aléatoire temporairement masquée.
                Le mécanisme et la route sont conservés : une nouvelle fonction
                aléatoire sera remise en place ultérieurement.

                <button
                  type="button"
                  className={`cc-tab ${tab === RANDOM_KEY ? 'active' : ''}`}
                  onClick={() => onChip(RANDOM_KEY)}
                  role="tab"
                  aria-selected={tab === RANDOM_KEY}
                >
                  Aléatoire
                </button>
              */}
              </div>

              <div className="display-tabbar-actions" aria-label="Options d’affichage de l’Entraînement">
                <FilterMenu>
                  <CaseControls
                    caseGroup={caseGroup}
                    setCaseGroup={setCaseGroup}
                    groupLabel={
                      tab === STRAPI_QUIZ_TYPE || tab === STRAPI_PRESENTATION_TYPE
                        ? 'Localisation'
                        : 'Thème'
                    }
                  />
                </FilterMenu>
                <ViewToggle view={view} setView={setView} />
              </div>
            </section>
          </>
        )}

        {!showTypePicker && (
          <>
            {/* États globaux */}
            {effectiveLoading && <div className="cc-state">Chargement…</div>}
            {effectiveError && !effectiveLoading && <div className="cc-state error">{effectiveError}</div>}
            {!effectiveLoading && !effectiveError && listForEmptyCheck.length === 0 && <div className="cc-state">Aucun résultat.</div>}

            {/* Rendu */}
            {!effectiveLoading && !effectiveError && listForEmptyCheck.length > 0 && (
              <>
                {isAtlasList && atlasGroup === 'category' && atlasCategorySections ? (
                  <div
                    className={`atlas-ui-taxonomy atlas-ui-taxonomy--${view}`}
                    aria-label="Pathologies par catégorie"
                  >
                    {atlasCategorySections.map((category) => {
                      const categoryGeneralItems = Array.isArray(category?.generalItems)
                        ? category.generalItems
                        : [];
                      const categoryDirectItems = Array.isArray(category?.directItems)
                        ? category.directItems
                        : [];
                      const showCategoryGeneralInHeading =
                        view === 'list' && categoryGeneralItems.length > 0;

                      // Comme pour les sous-catégories : en vue Liste, la fiche générale
                      // est retirée de la grille et devient une puce dans le bandeau bleu.
                      // En vue Cartes, elle reste une carte Atlas normale.
                      const categoryContentItems = view === 'list'
                        ? categoryDirectItems
                        : [...categoryGeneralItems, ...categoryDirectItems].sort(compareByTitleAsc);

                      return (
                        <section
                          key={category.key}
                          className={`display-section atlas-ui-category ${
                            showCategoryGeneralInHeading ? 'atlas-ui-category--has-general' : ''
                          }`}
                          aria-label={category.label}
                        >
                          <div className="display-section-heading">
                            <h2 className="display-section-title">{category.label}</h2>

                            {showCategoryGeneralInHeading && (
                              <div
                                className="atlas-ui-category-general-pathology-list"
                                aria-label="Fiche générale"
                              >
                                {categoryGeneralItems.map(renderGeneralPathologyLink)}
                              </div>
                            )}
                          </div>

                          {categoryContentItems.length > 0 && (
                            <div
                              className={`display-grid display-grid--flat display-grid--${view}`}
                              aria-label={`${category.label} — lésions`}
                            >
                              {categoryContentItems.map(renderItem)}
                            </div>
                          )}

                          {renderAtlasSubcategories(category)}
                        </section>
                      );
                    })}
                  </div>
                ) : isAtlasList && atlasGroup === 'letter' && atlasLetterSections ? (
                  <div
                    className={`atlas-ui-letters atlas-ui-letters--${view}`}
                    aria-label="Pathologies par lettre"
                  >
                    {atlasLetterSections.map((section) => (
                      <section
                        key={section.key}
                        className="atlas-ui-letter-section"
                        aria-label={`Lettre ${section.label}`}
                      >
                        <h2 className="atlas-ui-letter-title">{section.label}</h2>

                        <div
                          className={`display-grid display-grid--flat display-grid--${view}`}
                        >
                          {section.items.map(renderItem)}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : isAtlasList ? (
                  <section
                    className={`display-grid display-grid--flat display-grid--${view} atlas-ui-ungrouped`}
                    aria-label="Pathologies"
                  >
                    {atlasVisibleItems.map(renderItem)}
                  </section>
                ) : useCaseThemeSections ? (
                  <div
                    className="display-sections"
                    aria-label="Cas cliniques par thème"
                  >
                    {caseThemeSections.map((section) => (
                      <section key={section.key} className="display-section">
                        <div className="display-section-heading">
                          <h2 className="display-section-title">{section.label}</h2>
                        </div>

                        <section
                          className={`display-grid display-grid--flat display-grid--${view}`}
                          aria-label={section.label}
                        >
                          {section.items.map(renderItem)}
                        </section>
                      </section>
                    ))}
                  </div>
                ) : (
                  <section
                    className={`display-grid display-grid--flat display-grid--${view}`}
                    aria-label="Ressources"
                  >
                    {sortedItems.map(renderItem)}
                  </section>
                )}

                {!isAtlasHub && pages > 1 && (
                  <nav className="cc-pagination" aria-label="Pagination">
                    <button disabled={page <= 1} onClick={() => goPage(page - 1)} type="button">
                      Précédent
                    </button>
                    <span>
                      Page {page} / {pages}
                    </span>
                    <button disabled={page >= pages} onClick={() => goPage(page + 1)} type="button">
                      Suivant
                    </button>
                  </nav>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function TrainingModeIcon({ mode }) {
  if (mode === 'qr') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 4.5h9a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H9l-3.8 3v-3.25A3 3 0 0 1 3 10.5v-3a3 3 0 0 1 1.5-3Z" />
        <path d="M13.5 11.5h4a3 3 0 0 1 3 3v1a3 3 0 0 1-2.2 2.9V21l-3.2-2.5h-2.6a3 3 0 0 1-3-3" />
      </svg>
    );
  }

  if (mode === 'quiz') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 4.5h8" />
        <path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z" />
        <path d="M7 5.5H5.5A1.5 1.5 0 0 0 4 7v13h16V7a1.5 1.5 0 0 0-1.5-1.5H17" />
        <path d="m8 11 1.5 1.5L12 10" />
        <path d="M14 11h3" />
        <path d="m8 16 1.5 1.5L12 15" />
        <path d="M14 16h3" />
      </svg>
    );
  }

  if (mode === 'presentation') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 3.5h7L18.5 8v12.5h-12Z" />
        <path d="M13.5 3.5V8h5" />
        <path d="M9 12h7" />
        <path d="M9 15h7" />
        <path d="M9 18h4.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h3.2a4 4 0 0 1 3.25 1.67l3.1 4.33A4 4 0 0 0 16.8 14.7H20" />
      <path d="m17 11.7 3 3-3 3" />
      <path d="M4 17h3.2a4 4 0 0 0 3.25-1.67l3.1-4.33A4 4 0 0 1 16.8 9.3H20" />
      <path d="m17 6.3 3 3-3 3" />
    </svg>
  );
}

function TrainingModeCard({ to, mode, title, description }) {
  return (
    <Link className="cc-typecard cc-training-card ui-card" to={to} draggable="false">
      <span className="cc-training-icon" aria-hidden="true">
        <TrainingModeIcon mode={mode} />
      </span>

      <span className="cc-type">{title}</span>
      <span className="cc-typedesc">{description}</span>
    </Link>
  );
}

function TypePicker() {
  const quizCount = useQuizCount({ publicationState: TRAINING_STATS_PUB_STATE });

  const quizDescription =
    quizCount === null
      ? 'Cas issus du SFCO'
      : quizCount === 1
        ? '1 cas issu du SFCO'
        : `${quizCount} cas issus du SFCO`;

  return (
    <section className="cc-typepicker cc-typepicker--training">
      <h3>Choisissez un mode d'entraînement</h3>

      <div className="cc-typegrid cc-typegrid--training">
        <TrainingModeCard
          to="/entrainement/qr"
          mode="qr"
          title="Q/R"
          description="12 items d'internat issus du CNECO"
        />

        <TrainingModeCard
          to="/entrainement/quiz"
          mode="quiz"
          title="Quiz diagnostic"
          description={quizDescription}
        />

        <TrainingModeCard
          to="/entrainement/presentation"
          mode="presentation"
          title="Présentation"
          description="Case reports issus de la littérature"
        />

        <TrainingModeCard
          to="/entrainement/aleatoire"
          mode="aleatoire"
          title="Aléatoire"
          description="Réviser avec un résumé clinique express"
        />
      </div>
    </section>
  );
}
