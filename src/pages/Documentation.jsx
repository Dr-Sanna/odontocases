// src/pages/Documentation.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import {
  getPrefetchedBySlug,
  getPrefetchedChildren,
  isDocsFresh,
  primeDocsEssentials,
  revalidateDocsEssentials,
} from '../lib/docsPrefetchStore';
import './Documentation.css';

const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

const ROOT_TITLE = 'Documentation';
const ROOT_DESC =
  "Démarche diagnostique, items principaux en médecine orale et risques médicaux à connaître dans la pratique quotidienne";

const MEDICINE_ORAL_DESC = (
  <>
    Items de médecine orale triés et résumés, issus du Référentiel internat chirurgie orale, en accès libre sur le{' '}
    <a
      className="doc-description-link"
      href="https://www.cneco.education/referentiel-internat-chirurgie-orale-copy-3/"
      target="_blank"
      rel="noreferrer"
    >
      site du CNECO
    </a>
    .
  </>
);

// Page d’entrée de Documentation.
// La hiérarchie Strapi reste : subject MOCO -> chapter Médecine orale -> items.
// /documentation affiche une carte “Médecine orale” comme entrée de type Matière,
// puis le clic ouvre /documentation/moco/medecine-orale avec les items groupés.
const DEFAULT_SUBJECT_SLUG = import.meta.env.VITE_DOCS_DEFAULT_SUBJECT_SLUG || 'moco';
const DEFAULT_CHAPTER_SLUG = import.meta.env.VITE_DOCS_DEFAULT_CHAPTER_SLUG || 'medecine-orale';

const UNTHEMED_KEY = '__sans-theme__';
const UNTHEMED_THEME = {
  key: UNTHEMED_KEY,
  slug: UNTHEMED_KEY,
  title: 'Sans thème',
  order: Number.POSITIVE_INFINITY,
};

function labelForLevel(level) {
  if (level === 'subject') return 'Matière';
  if (level === 'chapter') return 'Chapitre';
  if (level === 'item') return 'Item';
  if (level === 'section') return 'Section';
  return 'Documentation';
}

function itemNumberFromSlug(slug) {
  const s = String(slug || '').trim();
  if (!s) return null;

  const direct = s.match(/^item[-_ ]?(\d+)$/i);
  if (direct?.[1]) return direct[1];

  const embedded = s.match(/(?:^|[-_ ])item[-_ ]?(\d+)(?:$|[-_ ])/i);
  if (embedded?.[1]) return embedded[1];

  return null;
}

function badgeLabelForNode(level, slug) {
  if (level !== 'item') return labelForLevel(level);

  const itemNumber = itemNumberFromSlug(slug);
  return itemNumber ? `Item ${itemNumber}` : 'Item';
}

function compareByOrderThenTitle(a, b) {
  const ao = Number.isFinite(a?.order) ? a.order : Number.POSITIVE_INFINITY;
  const bo = Number.isFinite(b?.order) ? b.order : Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;

  const at = String(a?.title || '');
  const bt = String(b?.title || '');
  return at.localeCompare(bt, 'fr', { sensitivity: 'base' });
}

function normalizeDocThemes(value) {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.data)
      ? value.data
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
    .filter((theme) => theme.title || theme.slug)
    .sort(compareByOrderThenTitle);
}

function buildThemeSections(items) {
  const sortedItems = Array.isArray(items) ? [...items].sort(compareByOrderThenTitle) : [];
  const hasAtLeastOneTheme = sortedItems.some((item) => normalizeDocThemes(item?.doc_themes).length > 0);

  // Si aucun item n'a encore de thème, on garde l’affichage normal.
  if (!hasAtLeastOneTheme) return null;

  const map = new Map();

  for (const item of sortedItems) {
    const themes = normalizeDocThemes(item?.doc_themes);
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

  return Array.from(map.values())
    .map((section) => ({
      ...section,
      items: [...section.items].sort(compareByOrderThenTitle),
    }))
    .sort(compareByOrderThenTitle);
}

function buildPath(basePath, segments) {
  const cleanBase = (basePath || '').replace(/\/+$/, ''); // enlève trailing /
  const cleanSegs = (segments || []).filter(Boolean).map((s) => String(s).replace(/^\/+|\/+$/g, ''));
  const joined = [cleanBase, ...cleanSegs].filter(Boolean).join('/');
  return '/' + joined.replace(/^\/+/, '');
}

function ViewToggle({ view, setView }) {
  return (
    <div className="doc-viewtoggle" role="group" aria-label="Affichage">
      <button
        type="button"
        className={`doc-viewbtn ${view === 'cards' ? 'active' : ''}`}
        onClick={() => setView('cards')}
        aria-pressed={view === 'cards'}
        aria-label="Affichage cartes"
        title="Cartes"
      >
        <svg className="doc-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
          />
        </svg>
      </button>

      <button
        type="button"
        className={`doc-viewbtn ${view === 'list' ? 'active' : ''}`}
        onClick={() => setView('list')}
        aria-pressed={view === 'list'}
        aria-label="Affichage liste"
        title="Liste"
      >
        <svg className="doc-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 6h2v2H4V6zm4 0h12v2H8V6zM4 11h2v2H4v-2zm4 0h12v2H8v-2zM4 16h2v2H4v-2zm4 0h12v2H8v-2z"
          />
        </svg>
      </button>
    </div>
  );
}

function DocItemControls({ docGroup, setDocGroup }) {
  return (
    <div className="doc-atlas-controls" role="group" aria-label="Contrôles Documentation">
      <div className="doc-atlas-control" role="group" aria-label="Afficher">
        <span className="doc-sortlabel">Afficher :</span>

        <button type="button" className="doc-sortbtn active" aria-pressed="true">
          Tous
        </button>
      </div>

      <div className="doc-atlas-control" role="group" aria-label="Grouper par">
        <span className="doc-sortlabel">Grouper par :</span>

        <button
          type="button"
          className={`doc-sortbtn ${docGroup === 'theme' ? 'active' : ''}`}
          onClick={() => setDocGroup('theme')}
          aria-pressed={docGroup === 'theme'}
        >
          Thème
        </button>

        <button
          type="button"
          className={`doc-sortbtn ${docGroup === 'none' ? 'active' : ''}`}
          onClick={() => setDocGroup('none')}
          aria-pressed={docGroup === 'none'}
        >
          Aucun
        </button>
      </div>
    </div>
  );
}

export default function Documentation({ basePath = '/documentation', subjectSlug = null, chapterSlug = null }) {
  const isRoot = !subjectSlug && !chapterSlug;

  // Cas particulier demandé : /documentation reste une page d’entrée.
  // Elle affiche une carte “Médecine orale” qui pointe vers le vrai chapitre.
  const isDocumentationLanding = isRoot;
  const effectiveSubjectSlug = subjectSlug || DEFAULT_SUBJECT_SLUG;
  const effectiveChapterSlug = chapterSlug || DEFAULT_CHAPTER_SLUG;

  const level = isRoot ? 'chapter' : !chapterSlug ? 'chapter' : 'item';
  const parentSlug = isRoot ? DEFAULT_SUBJECT_SLUG : !chapterSlug ? subjectSlug : chapterSlug;

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
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

  const [view, setView] = useState(() => {
    const saved = localStorage.getItem('doc:view');
    return saved === 'list' ? 'list' : 'cards';
  });

  useEffect(() => {
    localStorage.setItem('doc:view', view);
  }, [view]);

  const [docGroup, setDocGroup] = useState(() => {
    const saved = localStorage.getItem('doc:group');
    return saved === 'none' ? 'none' : 'theme';
  });

  useEffect(() => {
    localStorage.setItem('doc:group', docGroup);
  }, [docGroup]);

  function getLandingCardsFromStore() {
    const chapters = getPrefetchedChildren('chapter', DEFAULT_SUBJECT_SLUG, { publicationState: PUB_STATE });

    if (Array.isArray(chapters) && chapters.length > 0) {
      const target = chapters.find((node) => node?.slug === DEFAULT_CHAPTER_SLUG);
      return target ? [target] : [];
    }

    const target = getPrefetchedBySlug(DEFAULT_CHAPTER_SLUG, { publicationState: PUB_STATE });
    return target ? [target] : [];
  }

  function getCurrentListFromStore() {
    if (isDocumentationLanding) return getLandingCardsFromStore();

    const fromStore = getPrefetchedChildren(level, parentSlug, { publicationState: PUB_STATE });
    return Array.isArray(fromStore) ? [...fromStore].sort(compareByOrderThenTitle) : [];
  }

  // ✅ instant: depuis store
  const [list, setList] = useState(() => getCurrentListFromStore());

  // ✅ titre dynamique
  const headerTitle = isRoot
    ? ROOT_TITLE
    : (getPrefetchedBySlug(parentSlug, { publicationState: PUB_STATE })?.title || '');

  const isMedicineOralItemsPage =
    !isDocumentationLanding &&
    level === 'item' &&
    effectiveSubjectSlug === DEFAULT_SUBJECT_SLUG &&
    effectiveChapterSlug === DEFAULT_CHAPTER_SLUG;

  const description = isRoot ? ROOT_DESC : isMedicineOralItemsPage ? MEDICINE_ORAL_DESC : '';

  const themeSections = useMemo(() => {
    if (isDocumentationLanding || level !== 'item') return null;
    return buildThemeSections(list);
  }, [isDocumentationLanding, level, list]);

  // Hydratation instant depuis store
  useEffect(() => {
    setList(getCurrentListFromStore());
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDocumentationLanding, level, parentSlug]);

  // Un seul flux de chargement : le store décide s'il est encore frais.
  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();
    const forceRefresh = handledRefreshRef.current !== refreshToken;
    handledRefreshRef.current = refreshToken;

    const instant = getCurrentListFromStore();
    setList(instant);
    setError('');

    if (!forceRefresh && isDocsFresh({ publicationState: PUB_STATE })) {
      setLoading(false);
      return () => controller.abort();
    }

    if (!instant.length) setLoading(true);

    const action = forceRefresh ? revalidateDocsEssentials : primeDocsEssentials;
    action({ publicationState: PUB_STATE, signal: controller.signal, force: forceRefresh })
      .then(() => {
        if (!ignore) setList(getCurrentListFromStore());
      })
      .catch((e) => {
        if (!ignore && e?.name !== 'AbortError') setError(e?.message || 'Erreur de chargement');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDocumentationLanding, level, parentSlug, refreshToken]);

  function toDocLink(slug) {
    if (!slug) return buildPath(basePath, []);

    // Sur /documentation, la carte Médecine orale pointe vers son vrai chemin.
    if (isDocumentationLanding) return buildPath(basePath, [DEFAULT_SUBJECT_SLUG, slug]);

    if (level === 'subject') return buildPath(basePath, [slug]);
    if (level === 'chapter') return buildPath(basePath, [effectiveSubjectSlug, slug]);
    if (level === 'item') return buildPath(basePath, [effectiveSubjectSlug, effectiveChapterSlug, slug]);
    return buildPath(basePath, []);
  }

  function renderDocCard(n) {
    const title = n?.title || '';
    const slug = n?.slug || '';
    if (!slug) return null;

    const to = toDocLink(slug);
    const badgeLabel = isDocumentationLanding ? 'Matière' : badgeLabelForNode(level, slug);
    const isListCard = !isDocumentationLanding && view === 'list';
    const cardClass = `doc-card ui-card ${isListCard ? 'doc-card--list' : ''}`;

    return (
      <Link
        key={`${level}:${to}`}
        to={to}
        className={cardClass}
        state={{ prefetch: { slug, title, type: 'doc' } }}
      >
        <div
          className={n?.coverUrl ? 'doc-thumb' : 'doc-thumb is-empty'}
          style={n?.coverUrl ? { backgroundImage: `url(${n.coverUrl})` } : undefined}
          aria-hidden="true"
        >
          {!isListCard && (
            <div className="doc-thumb-overlay">
              <span className="badge badge-soft badge-secondary" aria-label={level}>
                {badgeLabel}
              </span>
              <h3 className="doc-thumb-title">{title}</h3>
            </div>
          )}
        </div>

        {isListCard ? (
          <div className="doc-body">
            <h3 className="doc-title">
              <span className="doc-title-text">{title}</span>
            </h3>

            <div className="doc-title-badges">
              <span className="doc-title-badge badge badge-soft-outline badge-secondary" aria-label={level}>
                {badgeLabel}
              </span>
            </div>

            {n?.excerpt ? <p className="doc-excerpt">{n.excerpt}</p> : null}
          </div>
        ) : n?.excerpt ? (
          <div className="doc-body">
            <p className="doc-excerpt">{n.excerpt}</p>
          </div>
        ) : null}
      </Link>
    );
  }

  const hasContent = list.length > 0;
  const hasThemeSections = Array.isArray(themeSections) && themeSections.length > 0;
  const showViewToolbar = !isDocumentationLanding && level === 'item' && !loading && !error && hasContent;
  const useThemeSections = docGroup === 'theme' && hasThemeSections;

  return (
    <>
      <div className="page-header">
        <div className="container">
          {headerTitle ? (
            <PageTitle description={description}>{headerTitle}</PageTitle>
          ) : (
            <div className="doc-title-skel" aria-hidden="true">
              <div className="doc-sk-line doc-sk-h24 doc-sk-w55" />
              {isRoot ? <div className="doc-sk-line doc-sk-h16 doc-sk-w90" /> : null}
            </div>
          )}
        </div>
      </div>

      <div className="container">
        <div className="doc-gridwrap">
          {showViewToolbar && (
            <section className="doc-toolbar" aria-label="Options d’affichage">
              <DocItemControls docGroup={docGroup} setDocGroup={setDocGroup} />
              <ViewToggle view={view} setView={setView} />
            </section>
          )}

          {loading && list.length > 0 && (
            <div className="doc-loading" aria-hidden="true">
              <div className="doc-loading-pill">Mise à jour…</div>
            </div>
          )}

          {loading && list.length === 0 && <div className="doc-state">Chargement…</div>}
          {!loading && error && <div className="doc-state error">{error}</div>}
          {!loading && !error && !hasContent && <div className="doc-state">Aucun contenu.</div>}

          {!loading && !error && hasContent && (
            useThemeSections ? (
              <div className="resource-groups doc-groups" aria-label="Items de documentation par thème">
                {themeSections.map((section) => (
                  <div key={section.key} className="resource-group doc-group">
                    <div className="resource-group-header doc-group-header" aria-hidden="true">
                      <span className="resource-group-title doc-group-title">{section.label}</span>
                      <div className="resource-group-rule doc-group-rule" />
                    </div>

                    <section
                      className={`resource-grid doc-grid ${view === 'list' ? 'doc-grid--list' : ''}`}
                      aria-label={section.label}
                    >
                      {section.items.map(renderDocCard)}
                    </section>
                  </div>
                ))}
              </div>
            ) : (
              <section
                className={`resource-grid doc-grid ${!isDocumentationLanding && view === 'list' ? 'doc-grid--list' : ''}`}
                aria-label="Ressources"
              >
                {list.map(renderDocCard)}
              </section>
            )
          )}
        </div>
      </div>
    </>
  );
}
