/**
 * CaseDetail.jsx
 * --------------
 * - Content (Markdown) + images cliquables (lightbox)
 * - Q/R : H2 "Questions", numérotation "1. ", flèche turquoise animée
 * - Sidebar animée (rail), tri numérique, prefetch
 * - Puce de type AU-DESSUS du titre
 * - Padding droite global sur tout le contenu (lecture + QA + extras)
 * - Nouveaux champs : references, copyright (affichés après les questions)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import Breadcrumbs from '../components/Breadcrumbs';
import { strapiFetch, imgUrl } from '../lib/strapi';
import { getCaseFromCache, setCaseToCache, prefetchCase } from '../lib/caseCache';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { BottomExpandIcon, BottomCollapseIcon } from '../components/Icons';
import './CaseDetail.css';

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const LS_KEY_COLLAPSE = 'cd-sidebar-collapsed';
const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';

/** Tri numérique par slug (extrait le premier groupe de chiffres). */
function compareBySlugNumberAsc(a, b) {
  const sa = String(a?.slug ?? '');
  const sb = String(b?.slug ?? '');
  const na = sa.match(/\d+/);
  const nb = sb.match(/\d+/);
  const ai = na ? parseInt(na[0], 10) : Number.POSITIVE_INFINITY;
  const bi = nb ? parseInt(nb[0], 10) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(ai) && Number.isFinite(bi)) {
    if (ai !== bi) return ai - bi;
    return sa.localeCompare(sb, 'fr', { numeric: true, sensitivity: 'base' });
  }
  if (Number.isFinite(ai)) return -1;
  if (Number.isFinite(bi)) return 1;
  return sa.localeCompare(sb, 'fr', { numeric: true, sensitivity: 'base' });
}

// Petite icône flèche (utilisée pour chaque question)
function QaArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z" />
    </svg>
  );
}

export default function CaseDetail() {
  const { slug } = useParams();
  const location = useLocation();
  const pre = location.state?.prefetch;
  const provisional = pre && pre.slug === slug ? pre : null;

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [item, setItem]       = useState(() => {
    const cached = getCaseFromCache(slug);
    if (cached) return cached;
    if (provisional) return provisional;
    return null;
  });

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(LS_KEY_COLLAPSE) === '1'; } catch { return false; }
  });
  const toggleSidebar = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(LS_KEY_COLLAPSE, next ? '1' : '0'); } catch {}
      return next;
    });
  };

  // Chargement (cache instantané + fetch silencieux)
  useEffect(() => {
    let ignore = false;

    const cached = getCaseFromCache(slug);
    if (cached) {
      setItem(cached);
      setLoading(false);
    } else if (provisional) {
      setItem(provisional);
      setLoading(true);
    } else {
      setItem(null);
      setLoading(true);
    }

    async function loadWithPopulate(populateQa) {
      return strapiFetch(CASES_ENDPOINT, {
        params: {
          filters: { slug: { $eq: slug } },
          locale: 'all',
          publicationState: PUB_STATE,
          populate: populateQa
            ? { cover: { fields: ['url', 'formats'] }, qa_blocks: { populate: '*' } }
            : { cover: { fields: ['url', 'formats'] } },
          fields: [
            'title', 'slug', 'type', 'excerpt', 'content', 'updatedAt',
            'references', 'copyright'
          ],
          pagination: { page: 1, pageSize: 1 },
        },
      });
    }

    async function load() {
      setError('');
      try {
        let res;
        try {
          res = await loadWithPopulate(true);
        } catch (err) {
          const msg = err?.message || '';
          if (/Invalid key qa_blocks/i.test(msg)) res = await loadWithPopulate(false);
          else throw err;
        }

        const node  = Array.isArray(res?.data) ? res.data[0] : null;
        const attrs = node?.attributes ? node.attributes : node;

        if (!ignore) {
          if (!attrs) setError('Cas introuvable ou non publié.');
          else {
            const coverAttr = attrs?.cover?.data?.attributes || attrs?.cover || null;
            const apiCover  = imgUrl(coverAttr, 'large') || imgUrl(coverAttr, 'medium') || imgUrl(coverAttr) || null;
            const full = { ...attrs, coverUrl: apiCover || item?.coverUrl || null };
            setItem(full);
            setCaseToCache(slug, full);
          }
        }
      } catch (e) {
        if (!ignore) setError(e.message || 'Erreur de chargement');
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => { ignore = true; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeLabel = useMemo(() => (
    item?.type === 'qa' ? 'Q/R' :
    item?.type === 'quiz' ? 'Quizz' : 'Présentation'
  ), [item?.type]);

  const qaList = Array.isArray(item?.qa_blocks) ? item.qa_blocks : [];

  // Lightbox pour les images du contenu
  const [lightbox, setLightbox] = useState(null); // {src, alt} | null
  const contentRef = useRef(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onClick = (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG') {
        e.preventDefault();
        setLightbox({ src: t.src, alt: t.alt || '' });
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [item?.content]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  return (
    <div className={`cd-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <AsideSameType
        currentSlug={slug}
        currentType={item?.type}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        prefetchRelated={location.state?.relatedPrefetch || null}
      />

      <main className="cd-main">
        <div className="page-header">
          <Breadcrumbs
            items={[
              { label: 'Accueil', to: '/' },
              { label: 'Cas cliniques', to: '/cas-cliniques' },
              { label: item?.title || 'Cas clinique', to: null },
            ]}
          />

          {/* Puce AU-DESSUS du titre */}
          <div className="cd-type-chip">
            <span className={`cd-chip cd-${item?.type || 'qa'}`}>{typeLabel}</span>
          </div>

          <PageTitle description={item?.excerpt || ''}>
            {item?.title || 'Cas clinique'}
          </PageTitle>
        </div>

        {error && <div className="cd-state error">{error}</div>}

        <article className="casedetail" ref={contentRef}>
          {/* Content (MARKDOWN) avec images cliquables */}
          {item?.content && (
            <div className="cd-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {item.content}
              </ReactMarkdown>
            </div>
          )}

          {/* Q/R */}
          {qaList.length > 0 && (
            <section className="qa-section">
              <h2 className="qa-title">Questions</h2>
              {qaList.map((qa, i) => {
                const q = qa?.question || `Question ${i + 1}`;
                const ans = qa?.answer || '';
                return (
                  <details key={qa?.id ?? i} className="qa-item">
                    <summary className="qa-q">
                      <span className="qa-arrow" aria-hidden="true"><QaArrow /></span>
                      <span className="qa-num">{i + 1}.</span>
                      <span className="qa-text">{q}</span>
                    </summary>
                    <div className="qa-a">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                        {ans}
                      </ReactMarkdown>
                    </div>
                  </details>
                );
              })}
            </section>
          )}

          {/* Extras : Références & Copyright (après les questions) */}
          {(item?.references || item?.copyright) && (
            <section className="cd-extras">
              {item?.references && (
                <div className="cd-references">
                  <h3>Références</h3>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                    {item.references}
                  </ReactMarkdown>
                </div>
              )}
              {item?.copyright && (
                <div className="cd-copyright">
                  <h3>Copyright</h3>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                    {item.copyright}
                  </ReactMarkdown>
                </div>
              )}
            </section>
          )}
        </article>
      </main>

      {/* Lightbox */}
      {lightbox && (
        <div className="lb-backdrop" onClick={() => setLightbox(null)} role="button" aria-label="Fermer l’aperçu" tabIndex={0}>
          <img className="lb-img" src={lightbox.src} alt={lightbox.alt} />
        </div>
      )}
    </div>
  );
}

/**
 * AsideSameType (identique, préfetch + animation)
 */
function AsideSameType({ currentSlug, currentType, collapsed, onToggle, prefetchRelated }) {
  const [related, setRelated] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [errList, setErrList] = useState('');

  const [anim, setAnim] = useState(''); // '', 'opening', 'closing'
  const animTimerRef = useRef(null);

  const handleToggle = () => {
    const nextCollapsed = !collapsed;
    setAnim(nextCollapsed ? 'closing' : 'opening');
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => {
      setAnim('');
      animTimerRef.current = null;
    }, 240);
    onToggle();
  };
  useEffect(() => () => { if (animTimerRef.current) clearTimeout(animTimerRef.current); }, []);

  // Boot instantané via prefetch/session
  useEffect(() => {
    let booted = false;

    if (Array.isArray(prefetchRelated) && currentType) {
      const list = prefetchRelated
        .filter(it => it?.type === currentType && it?.slug)
        .sort(compareBySlugNumberAsc);
      if (list.length) { setRelated(list); booted = true; }
    }
    if (!booted && currentType) {
      try {
        const raw = sessionStorage.getItem(`cd-prefetch-${currentType}`);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length) {
            const list = arr.filter(it => it?.slug).sort(compareBySlugNumberAsc);
            setRelated(list);
            booted = true;
          }
        }
      } catch {}
    }
    setLoadingList(!booted);
  }, [prefetchRelated, currentType]);

  // Fetch complet (rafraîchit la liste)
  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!currentType) { setRelated([]); return; }
      setErrList('');

      try {
        const res = await strapiFetch(CASES_ENDPOINT, {
          params: {
            locale: 'all',
            publicationState: PUB_STATE,
            filters: { type: { $eq: currentType } },
            fields: ['title', 'slug', 'type'],
            sort: 'title:asc',
            pagination: { page: 1, pageSize: 100 },
          },
        });
        if (ignore) return;

        const list = Array.isArray(res?.data) ? res.data : [];
        const normalized = list
          .map(n => (n?.attributes ? n.attributes : n))
          .filter(Boolean)
          .filter(it => it.slug);

        normalized.sort(compareBySlugNumberAsc);
        setRelated(normalized);

        try { sessionStorage.setItem(`cd-prefetch-${currentType}`, JSON.stringify(normalized)); } catch {}
      } catch (e) {
        if (!ignore) setErrList(e.message || 'Erreur de chargement');
      } finally {
        if (!ignore) setLoadingList(false);
      }
    }
    load();
    return () => { ignore = true; };
  }, [currentType]);

  // Prefetch des cas listés (limite 20)
  useEffect(() => {
    if (!Array.isArray(related) || related.length === 0) return;
    const limited = related.slice(0, 20);
    for (const it of limited) {
      if (!it?.slug || it.slug === currentSlug) continue;
      prefetchCase(it.slug, { publicationState: PUB_STATE }).catch(() => {});
    }
  }, [related, currentSlug]);

  const labelType =
    currentType === 'qa' ? 'Cas Q/R' :
    currentType === 'quiz' ? 'Quizz' :
    currentType === 'presentation' ? 'Présentations' : 'Cas';

  const showOverlay = collapsed || anim !== '';
  const isAnimating = anim !== '';
  const overlayShowsExpand = collapsed || anim === 'closing';

  return (
    <aside className={`cd-side ${collapsed ? 'is-collapsed' : ''} ${anim} ${isAnimating ? 'is-animating' : ''}`}>
      <div className="cd-side-inner">
        <div className="cd-side-scroll">
          <div className="cd-side-header">{labelType}</div>

          {loadingList && <div className="cd-side-state">Chargement…</div>}
          {errList && !loadingList && <div className="cd-side-state error">{errList}</div>}

          {!errList && (
            <ul className="cd-side-list">
              {related.map((it) => {
                const active = it.slug === currentSlug;
                return (
                  <li key={it.slug}>
                    {active ? (
                      <span className="cd-side-link active" aria-current="page">{it.title || it.slug}</span>
                    ) : (
                      <Link
                        className="cd-side-link"
                        to={`/cas-cliniques/${it.slug}`}
                        onMouseEnter={() => prefetchCase(it.slug, { publicationState: PUB_STATE }).catch(() => {})}
                        onFocus={() => prefetchCase(it.slug, { publicationState: PUB_STATE }).catch(() => {})}
                      >
                        {it.title || it.slug}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {showOverlay ? (
          <div
            className="cd-side-toggle"
            title={overlayShowsExpand ? 'Développer la barre latérale' : 'Réduire la barre latérale'}
            aria-label={overlayShowsExpand ? 'Développer la barre latérale' : 'Réduire la barre latérale'}
            role="button"
            tabIndex={0}
            onClick={isAnimating ? undefined : handleToggle}
            onKeyDown={(e) => {
              if (!isAnimating && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleToggle(); }
            }}
          >
            {overlayShowsExpand
              ? <BottomExpandIcon className="expandButtonIcon_H1n0" />
              : <BottomCollapseIcon className="collapseSidebarButtonIcon_DI0B" />
            }
          </div>
        ) : (
          <button
            type="button"
            title="Réduire la barre latérale"
            aria-label="Réduire la barre latérale"
            className="cd-side-toggle"
            onClick={handleToggle}
            disabled={isAnimating}
          >
            <BottomCollapseIcon className="collapseSidebarButtonIcon_DI0B" />
          </button>
        )}
      </div>
    </aside>
  );
}
