// src/pages/CasCliniques.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import FilterMenu from '../components/FilterMenu';
import { strapiFetch, imgUrl, isAbortError } from '../lib/strapi';
import { useQuizCount } from '../lib/trainingStatsStore';
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

// Ordre pédagogique de l’Atlas. Les catégories inconnues restent acceptées et
// sont placées ensuite par ordre alphabétique, ce qui évite de rendre le rendu
// fragile si une nouvelle catégorie est ajoutée dans Strapi.
const ATLAS_CATEGORY_ORDER = [
  'Variations anatomiques, physiologiques et états bénins fréquents',
  'Anomalies du développement et pathologies dentaires',
  'Pathologies gingivales et parodontales',
  // Nouvelle organisation : les vrais kystes et les pseudokystes/cavités
  // peuvent vivre dans deux catégories voisines. L'ancien intitulé reste
  // accepté pendant la migration des fiches.
  'Kystes des maxillaires',
  'Kystes et pseudokystes des maxillaires',
  'Pseudokystes et cavités osseuses des maxillaires',
  'Tumeurs et autres lésions osseuses ou odontogènes des maxillaires',
  'Lésions réactionnelles et traumatiques des tissus mous',
  'Pathologies des glandes salivaires',
  'Pathologies infectieuses et complications',
  'Pathologies inflammatoires, immunitaires, bulleuses et ulcéreuses',
  'Troubles oraux potentiellement malins',
  'Pathologies des lèvres et périorales',
  'Tumeurs bénignes des tissus mous et de la muqueuse',
  'Tumeurs malignes de la cavité orale',
  'Lésions pigmentées et vasculaires',
  'Maladies systémiques, génétiques et hématologiques à manifestations orales',
  'Douleurs, troubles fonctionnels et signes cervico-faciaux',
];

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
    'Kystes odontogènes du développement',
    'Kystes non odontogènes du développement',
    'Kystes odontogènes inflammatoires',
    'Kystes liés à l’éruption',
  ],
  // Compatibilité pendant la migration vers deux grandes catégories.
  'Kystes et pseudokystes des maxillaires': [
    'Kystes odontogènes du développement',
    'Kystes non odontogènes du développement',
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
      category: String(entry?.category || '').trim(),
      subcategory: String(entry?.subcategory || '').trim(),
    }))
    .filter((entry) => entry.category);
}

function makeOrderMap(values) {
  return new Map((Array.isArray(values) ? values : []).map((value, index) => [value, index]));
}

const ATLAS_CATEGORY_ORDER_MAP = makeOrderMap(ATLAS_CATEGORY_ORDER);
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

function buildAtlasCategorySections(items) {
  const source = Array.isArray(items) ? items : [];
  const categories = new Map();

  for (const item of source) {
    const classifications = normalizeClassifications(item?.classification);
    const targets = classifications.length
      ? classifications
      : [{ category: UNCLASSIFIED_ATLAS_CATEGORY, subcategory: '' }];

    for (const classification of targets) {
      const categoryLabel = classification.category || UNCLASSIFIED_ATLAS_CATEGORY;
      const subcategoryLabel = classification.subcategory || '';

      if (!categories.has(categoryLabel)) {
        categories.set(categoryLabel, {
          key: categoryLabel,
          label: categoryLabel,
          directItems: [],
          directSeen: new Set(),
          subcategories: new Map(),
        });
      }

      const category = categories.get(categoryLabel);

      if (!subcategoryLabel) {
        pushUniqueAtlasItem(category.directItems, category.directSeen, item);
        continue;
      }

      if (!category.subcategories.has(subcategoryLabel)) {
        category.subcategories.set(subcategoryLabel, {
          key: `${categoryLabel}::${subcategoryLabel}`,
          label: subcategoryLabel,
          items: [],
          seen: new Set(),
        });
      }

      const subcategory = category.subcategories.get(subcategoryLabel);
      pushUniqueAtlasItem(subcategory.items, subcategory.seen, item);
    }
  }

  return Array.from(categories.values())
    .sort((a, b) => compareAtlasLabels(a.label, b.label, ATLAS_CATEGORY_ORDER_MAP))
    .map((category) => {
      const subOrder = ATLAS_SUBCATEGORY_ORDER_MAP[category.label] || null;
      return {
        key: category.key,
        label: category.label,
        directItems: category.directItems.sort(compareByTitleAsc),
        subcategories: Array.from(category.subcategories.values())
          .sort((a, b) => compareAtlasLabels(a.label, b.label, subOrder))
          .map((subcategory) => ({
            key: subcategory.key,
            label: subcategory.label,
            items: subcategory.items.sort(compareByTitleAsc),
          })),
      };
    });
}


/*
 * Répartition des panneaux de sous-catégories dans deux colonnes réelles.
 *
 * On n'utilise volontairement plus CSS Multi-column (`column-count`) :
 * selon le contenu et le navigateur, plusieurs panneaux pouvaient rester
 * empilés dans la colonne de gauche. Ici, React calcule une répartition
 * équilibrée et déterministe à partir du nombre de lésions.
 *
 * L'ordre pédagogique original est conservé dans `__atlasPanelOrder` afin
 * de pouvoir le restaurer sur tablette/mobile lorsque l'affichage repasse
 * sur une seule colonne.
 */
function estimateAtlasSubcategoryPanelWeight(subcategory, view) {
  const itemCount = Math.max(1, Array.isArray(subcategory?.items) ? subcategory.items.length : 0);
  const titleLength = String(subcategory?.label || '').length;
  const extraTitleLines = Math.max(0, Math.ceil(titleLength / 44) - 1);

  // En vue cartes, un panneau affiche 2 lésions par rangée sur grand écran.
  const lesionRows = view === 'cards' ? Math.ceil(itemCount / 2) : itemCount;

  return lesionRows + 0.58 + extraTitleLines * 0.28;
}

function balanceAtlasSubcategoryColumns(subcategories, view) {
  const source = Array.isArray(subcategories) ? subcategories : [];

  const decorated = source.map((subcategory, index) => ({
    ...subcategory,
    __atlasPanelOrder: index,
    __atlasPanelWeight: estimateAtlasSubcategoryPanelWeight(subcategory, view),
  }));

  if (decorated.length <= 1) {
    return [decorated, []];
  }

  // Les catégories de l'Atlas ont peu de sous-groupes (actuellement <= 10).
  // On peut donc tester toutes les répartitions possibles, en gardant le
  // premier panneau à gauche, et choisir celle dont les hauteurs estimées
  // sont les plus proches. Au-delà de 12 panneaux, fallback glouton.
  if (decorated.length <= 12) {
    const first = decorated[0];
    const rest = decorated.slice(1);
    const combinations = 1 << rest.length;

    let best = null;

    for (let mask = 0; mask < combinations; mask += 1) {
      const columns = [[first], []];
      const weights = [first.__atlasPanelWeight, 0];

      for (let i = 0; i < rest.length; i += 1) {
        const columnIndex = (mask >> i) & 1;
        columns[columnIndex].push(rest[i]);
        weights[columnIndex] += rest[i].__atlasPanelWeight;
      }

      // Avec plusieurs panneaux, on veut réellement utiliser les deux colonnes.
      if (columns[1].length === 0) continue;

      const heightDifference = Math.abs(weights[0] - weights[1]);
      const countDifference = Math.abs(columns[0].length - columns[1].length);

      // La hauteur prime très largement ; le nombre de panneaux ne sert
      // qu'à départager des solutions visuellement proches.
      const score = heightDifference + countDifference * 0.06;

      if (!best || score < best.score) {
        best = { columns, score };
      }
    }

    if (best) return best.columns;
  }

  // Fallback déterministe pour une éventuelle catégorie très fragmentée.
  const columns = [[], []];
  const weights = [0, 0];

  for (const subcategory of decorated) {
    const columnIndex = weights[0] <= weights[1] ? 0 : 1;
    columns[columnIndex].push(subcategory);
    weights[columnIndex] += subcategory.__atlasPanelWeight;
  }

  return columns;
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

    return { hub: 'training', selection: 'all' };
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

function AtlasControls({ atlasGroup, setAtlasGroup, showBadges, setShowBadges }) {
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

      <div className="atlas-ui-control" role="group" aria-label="Afficher les badges">
        <span className="cc-sortlabel">Badges :</span>

        <button
          type="button"
          className={`cc-sortbtn ${showBadges ? 'active' : ''}`}
          onClick={() => setShowBadges(true)}
          aria-pressed={showBadges}
        >
          Afficher
        </button>

        <button
          type="button"
          className={`cc-sortbtn ${!showBadges ? 'active' : ''}`}
          onClick={() => setShowBadges(false)}
          aria-pressed={!showBadges}
        >
          Masquer
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
  const lastFocusAtRef = useRef(Date.now());
  const handledRefreshRef = useRef(0);

  useEffect(() => {
    const refreshAfterFocus = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocusAtRef.current < 10_000) return;
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

  // Atlas : les badges sont visibles par défaut, avec préférence persistée.
  const [atlasShowBadges, setAtlasShowBadges] = useState(() => {
    const saved = localStorage.getItem('atlas:badges');
    return saved !== 'hidden';
  });

  useEffect(() => {
    localStorage.setItem('atlas:badges', atlasShowBadges ? 'shown' : 'hidden');
  }, [atlasShowBadges]);

  const [caseGroup, setCaseGroup] = useState(() => {
    const saved = localStorage.getItem('cases:group');
    return saved === 'none' ? 'none' : 'theme';
  }); // 'theme' | 'none'

  useEffect(() => {
    localStorage.setItem('cases:group', caseGroup);
  }, [caseGroup]);

  const q = searchParams.get('q') || '';
  const page = Number(searchParams.get('page') || 1);

  const { hub, selection } = getHubAndSelection(pathname);

  const isAtlasHub = hub === 'atlas';
  const isTrainingHub = hub === 'training';

  const showTypePicker = isTrainingHub && selection === 'all';
  const tab = selection; // 'atlas' | 'qa' | 'quiz' | 'presentation' | 'all'

  const variants = useMemo(() => (q ? buildVariants(q) : []), [q]);

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

    const cacheKey = isAtlasHub
      ? `atlas:${tab}:all:${q}`
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
          const fetchAllPathologies = async (filters) => {
            const all = [];
            let currentPage = 1;
            let pageCount = 1;
            let reportedTotal = null;

            do {
              const data = await strapiFetch(PATHO_ENDPOINT, {
                params: {
                  populate: {
                    cover: { fields: ['url', 'formats'] },
                    // `badges` reste chargé pour les données complètes utilisées par CaseDetail / breadcrumb.
                    badges: { fields: ['label', 'variant'] },
                    // `atlasBadges` est la relation dédiée aux badges visibles sur les cartes de l'Atlas.
                    atlasBadges: { fields: ['label', 'variant'] },
                    classification: { fields: ['category', 'subcategory'] },
                  },
                  locale: 'all',
                  filters,
                  // Atlas trié alphabétiquement sur l'ensemble des lots.
                  sort: 'title:asc,slug:asc',
                  pagination: { page: currentPage, pageSize: ATLAS_BATCH_SIZE },
                  fields: ['title', 'slug', 'excerpt', 'updatedAt'],
                  publicationState: 'live',
                },
                options: { signal: controller.signal },
              });

              if (ignore) return null;

              const batch = Array.isArray(data?.data) ? data.data : [];
              all.push(...batch);

              const pagination = data?.meta?.pagination || {};
              const metaPageCount = Number(pagination.pageCount);
              const metaTotal = Number(pagination.total);

              if (Number.isFinite(metaTotal)) reportedTotal = metaTotal;

              if (Number.isFinite(metaPageCount) && metaPageCount > 0) {
                pageCount = metaPageCount;
              } else {
                // Sécurité pour un backend qui ne renverrait pas pageCount.
                pageCount = batch.length < ATLAS_BATCH_SIZE ? currentPage : currentPage + 1;
              }

              currentPage += 1;
            } while (currentPage <= pageCount);

            return {
              data: all,
              total: reportedTotal ?? all.length,
            };
          };

          const result = await fetchAllPathologies(pathoFilters);
          if (ignore || !result) return;

          let normalized = result.data.map(normalizeNode).filter((it) => it?.slug);
          let nextTotal = result.total;

          // Recherche permissive historique : si le filtre Strapi ne trouve rien,
          // on charge l'Atlas complet puis on applique la recherche côté client.
          if (q && normalized.length === 0) {
            const fallback = await fetchAllPathologies({});
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

  // Atlas : Afficher = Tous.
  const atlasVisibleItems = useMemo(() => {
    if (!(isAtlasHub && tab === ATLAS_KEY)) return sortedItems;
    return [...sortedItems];
  }, [sortedItems, isAtlasHub, tab]);

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

  // Atlas : classification pédagogique Catégorie > Sous-catégorie.
  // Une même pathologie peut apparaître dans plusieurs branches si plusieurs
  // composants `classification` sont présents dans Strapi.
  const atlasCategorySections = useMemo(() => {
    if (!(isAtlasHub && tab === ATLAS_KEY)) return null;
    return buildAtlasCategorySections(atlasVisibleItems);
  }, [isAtlasHub, tab, atlasVisibleItems]);


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
      ? 'Q/R, quiz diagnostiques, présentations et tirage aléatoire de cas cliniques.'
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

  const renderItem = (attrs, idx) => {
    if (!attrs) return null;

    const entity = attrs.__entity || (isAtlasHub ? 'pathology' : 'case');

    const titleText = attrs?.title || 'Sans titre';
    const slug = attrs?.slug || '';
    const excerpt = attrs?.excerpt || '';

    const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
    const coverUrl = imgUrl(coverAttr, 'medium') || imgUrl(coverAttr, 'thumbnail') || imgUrl(coverAttr) || '';

    let toHref = null;
    if (slug) {
      toHref = entity === 'pathology' ? `/atlas/${slug}` : `/entrainement/cas/${slug}`;
    }

    const isPathology = entity === 'pathology';
    const isListView = view === 'list';

    // Deux jeux de badges distincts :
    // - `badges` = badges complets de la pathologie, conservés pour CaseDetail / breadcrumb ;
    // - `atlasBadges` = badges contextuels, seuls affichés sur les cartes de l'Atlas.
    const pathoBadges = isPathology ? normalizeBadges(attrs?.badges) : [];
    const atlasBadges = isPathology ? normalizeBadges(attrs?.atlasBadges) : [];
    const badgesToRender = isPathology && atlasShowBadges ? atlasBadges : [];

    // Les données de navigation conservent les badges complets, indépendamment de l'affichage Atlas.
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

    // Atlas : carte entièrement isolée des styles Documentation / Entraînement.
    // Les classes `atlas-ui-*` permettent de faire évoluer l'Atlas sans modifier
    // les cartes ou séparateurs partagés utilisés ailleurs sur le site.
    if (isPathology) {
      const cardClass = `atlas-ui-lesion-card ${
        isListView ? 'atlas-ui-lesion-card--list' : 'atlas-ui-lesion-card--cards'
      }`;

      const Inner = (
        <>
          <div
            className={coverUrl ? 'atlas-ui-lesion-thumb' : 'atlas-ui-lesion-thumb atlas-ui-lesion-thumb--empty'}
            style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
            aria-hidden="true"
          />

          <div className="atlas-ui-lesion-body">
            <h3 className="atlas-ui-lesion-title">{titleText}</h3>

            {badgesToRender.length > 0 && (
              <div className="atlas-ui-lesion-badges">
                {badgesToRender.map((b) => (
                  <span
                    key={`${b.variant}:${b.label}`}
                    className={`atlas-ui-lesion-badge badge badge-soft-outline badge-${b.variant}`}
                  >
                    {b.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      );

      return toHref ? (
        <Link key={key} to={toHref} className={cardClass} state={linkState}>
          {Inner}
        </Link>
      ) : (
        <div
          key={key}
          className={`${cardClass} atlas-ui-lesion-card--disabled`}
          title="Slug manquant"
        >
          {Inner}
        </div>
      );
    }

    // Entraînement : même modèle visuel que les cartes Documentation, sans badge redondant.
    const cardClass = `doc-card doc-card--training ui-card ${isListView ? 'doc-card--list' : ''}`;

    const Inner = (
      <>
        <div
          className={coverUrl ? 'doc-thumb' : 'doc-thumb is-empty'}
          style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
          aria-hidden="true"
        >
          {!isListView && (
            <div className="doc-thumb-overlay">
              <h3 className="doc-thumb-title">{titleText}</h3>
            </div>
          )}
        </div>

        {isListView ? (
          <div className="doc-body">
            <h3 className="doc-title">
              <span className="doc-title-text">{titleText}</span>
            </h3>

            {excerpt ? <p className="doc-excerpt">{excerpt}</p> : null}
          </div>
        ) : excerpt ? (
          <div className="doc-body">
            <p className="doc-excerpt">{excerpt}</p>
          </div>
        ) : null}
      </>
    );

    return toHref ? (
      <Link key={key} to={toHref} className={cardClass} state={linkState}>
        {Inner}
      </Link>
    ) : (
      <div key={key} className={`${cardClass} doc-card--disabled`} title="Slug manquant">
        {Inner}
      </div>
    );
  };


  const renderAtlasSubcategoryColumns = (category) => {
    const subcategories = Array.isArray(category?.subcategories) ? category.subcategories : [];
    if (subcategories.length === 0) return null;

    const columns = balanceAtlasSubcategoryColumns(subcategories, view);
    const isSingle = subcategories.length === 1;

    return (
      <div
        className={`atlas-ui-subcategory-columns ${
          isSingle ? 'atlas-ui-subcategory-columns--single' : ''
        }`}
      >
        {columns.map((column, columnIndex) => (
          <div
            key={`${category.key}:column:${columnIndex}`}
            className={`atlas-ui-subcategory-column atlas-ui-subcategory-column--${columnIndex + 1} ${
              column.length === 0 ? 'atlas-ui-subcategory-column--empty' : ''
            }`}
          >
            {column.map((subcategory) => (
              <section
                key={subcategory.key}
                className="atlas-ui-subcategory-panel"
                aria-label={subcategory.label}
                style={{ '--atlas-panel-order': subcategory.__atlasPanelOrder }}
              >
                <div className="atlas-ui-subcategory-heading">
                  <h3 className="atlas-ui-subcategory-title">{subcategory.label}</h3>
                  <span className="atlas-ui-subcategory-count">
                    {subcategory.items.length}{' '}
                    {subcategory.items.length > 1 ? 'lésions' : 'lésion'}
                  </span>
                </div>

                <div
                  className={`atlas-ui-lesion-grid atlas-ui-lesion-grid--panel atlas-ui-lesion-grid--${view}`}
                >
                  {subcategory.items.map(renderItem)}
                </div>
              </section>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const isAtlasList = isAtlasHub && tab === ATLAS_KEY;
  const listForEmptyCheck = isAtlasList ? atlasVisibleItems : sortedItems;

  return (
    <>
      {!showChips && (
        <div className="page-header display-page-header">
          <div className="container">
            <div className="display-page-header-row">
              <div className="display-page-header-copy">
                <PageTitle description={description}>{title}</PageTitle>
              </div>

              {isAtlasHub && tab === ATLAS_KEY && (
                <div className="display-page-header-actions" aria-label="Options d’affichage de l’Atlas">
                  <FilterMenu>
                    <AtlasControls
                      atlasGroup={atlasGroup}
                      setAtlasGroup={setAtlasGroup}
                      showBadges={atlasShowBadges}
                      setShowBadges={setAtlasShowBadges}
                    />
                  </FilterMenu>
                  <ViewToggle view={view} setView={setView} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`container ${showChips ? 'cc-training-active' : ''}`}>
        {showTypePicker && <TypePicker />}

        {showChips && (
          <section className="cc-toolbar cc-toolbar--top cc-training-toolbar">
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

              <button
                type="button"
                className={`cc-tab ${tab === RANDOM_KEY ? 'active' : ''}`}
                onClick={() => onChip(RANDOM_KEY)}
                role="tab"
                aria-selected={tab === RANDOM_KEY}
              >
                Aléatoire
              </button>
            </div>

            <div className="display-toolbar-actions" aria-label="Options d’affichage">
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
        )}

        {!showTypePicker && (
          <>
            {/* États globaux */}
            {loading && <div className="cc-state">Chargement…</div>}
            {error && !loading && <div className="cc-state error">{error}</div>}
            {!loading && !error && listForEmptyCheck.length === 0 && <div className="cc-state">Aucun résultat.</div>}

            {/* Rendu */}
            {!loading && !error && listForEmptyCheck.length > 0 && (
              <>
                {isAtlasList && atlasGroup === 'category' && atlasCategorySections ? (
                  <div
                    className={`atlas-ui-taxonomy atlas-ui-taxonomy--${view}`}
                    aria-label="Pathologies par catégorie"
                  >
                    {atlasCategorySections.map((category) => (
                      <section
                        key={category.key}
                        className="atlas-ui-category"
                        aria-label={category.label}
                      >
                        <div className="atlas-ui-category-heading">
                          <h2 className="atlas-ui-category-title">{category.label}</h2>
                          <div className="atlas-ui-category-rule" aria-hidden="true" />
                        </div>

                        {category.directItems.length > 0 && (
                          <div
                            className={`atlas-ui-lesion-grid atlas-ui-lesion-grid--flat atlas-ui-lesion-grid--${view}`}
                            aria-label={`${category.label} — lésions`}
                          >
                            {category.directItems.map(renderItem)}
                          </div>
                        )}

                        {renderAtlasSubcategoryColumns(category)}
                      </section>
                    ))}
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
                          className={`atlas-ui-lesion-grid atlas-ui-lesion-grid--flat atlas-ui-lesion-grid--${view}`}
                        >
                          {section.items.map(renderItem)}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : isAtlasList ? (
                  <section
                    className={`atlas-ui-lesion-grid atlas-ui-lesion-grid--flat atlas-ui-lesion-grid--${view} atlas-ui-ungrouped`}
                    aria-label="Pathologies"
                  >
                    {atlasVisibleItems.map(renderItem)}
                  </section>
                ) : useCaseThemeSections ? (
                  <div
                    className="resource-groups cc-training-groups"
                    aria-label="Cas cliniques par thème"
                  >
                    {caseThemeSections.map((section) => (
                      <div key={section.key} className="resource-group">
                        <div className="resource-group-header" aria-hidden="true">
                          <span className="resource-group-title">{section.label}</span>
                          <div className="resource-group-rule" />
                        </div>

                        <section
                          className={`resource-grid doc-grid cc-resource-grid ${view === 'list' ? 'doc-grid--list' : ''}`}
                          aria-label={section.label}
                        >
                          {section.items.map(renderItem)}
                        </section>
                      </div>
                    ))}
                  </div>
                ) : (
                  <section
                    className={`resource-grid doc-grid cc-resource-grid ${view === 'list' ? 'doc-grid--list' : ''}`}
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
