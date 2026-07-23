// src/pages/Aléatoire.jsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import CaseMarkdown from '../components/CaseMarkdown';
import { imgUrl, isAbortError, strapiFetch } from '../lib/strapi';

import './CasCliniques.css';
import './Aléatoire.css';

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';
const PUB_STATE = import.meta.env.DEV ? 'preview' : 'live';
const PAGE_SIZE = 500;

function normalizeNode(node) {
  if (!node) return null;
  if (node.attributes) return { id: node.id, ...node.attributes };
  return node;
}

function normalizeRelationArray(relation) {
  if (!relation) return [];
  if (Array.isArray(relation)) return relation.map(normalizeNode).filter(Boolean);
  if (Array.isArray(relation.data)) return relation.data.map(normalizeNode).filter(Boolean);
  if (Array.isArray(relation.results)) return relation.results.map(normalizeNode).filter(Boolean);
  return [];
}

function normalizeTrainingSummary(summary) {
  if (!summary) return null;
  const node = summary?.data ? normalizeNode(summary.data) : normalizeNode(summary);
  if (!node) return null;

  return {
    ...node,
    images: normalizeRelationArray(node.images),
  };
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function prepareCase(node) {
  const item = normalizeNode(node);
  if (!item?.slug) return null;

  const trainingSummary = normalizeTrainingSummary(item.training_summary);
  if (!trainingSummary?.enabled) return null;

  const summary = cleanText(trainingSummary.summary);
  const answer = cleanText(trainingSummary.answer);
  if (!summary || !answer) return null;

  const pathologies = normalizeRelationArray(item.pathologies)
    .filter((pathology) => pathology?.slug)
    .sort((a, b) =>
      String(a?.title || a?.slug || '').localeCompare(String(b?.title || b?.slug || ''), 'fr', {
        sensitivity: 'base',
      })
    );

  return {
    ...item,
    training_summary: {
      ...trainingSummary,
      summary,
      answer,
      correction: cleanText(trainingSummary.correction),
    },
    pathologies,
  };
}

async function fetchTrainingCases({ signal, filterEnabled = true } = {}) {
  const params = {
    locale: 'all',
    publicationState: PUB_STATE,
    fields: ['title', 'slug', 'type'],
    populate: {
      training_summary: {
        fields: ['enabled', 'summary', 'answer', 'biopsy_required', 'correction'],
        populate: {
          images: {
            fields: ['url', 'formats', 'alternativeText', 'caption', 'name', 'width', 'height'],
          },
        },
      },
      pathologies: {
        fields: ['title', 'slug'],
      },
    },
    sort: ['slug:asc'],
    pagination: { page: 1, pageSize: PAGE_SIZE },
  };

  if (filterEnabled) {
    params.filters = {
      training_summary: {
        enabled: { $eq: true },
      },
    };
  }

  return strapiFetch(CASES_ENDPOINT, {
    params,
    options: { signal },
  });
}

function getImageRatio(image) {
  const width = Number(image?.width);
  const height = Number(image?.height);
  if (width > 0 && height > 0) return width / height;
  return 1;
}

function getContainedArea(ratio, cellWidth, cellHeight) {
  if (!(cellWidth > 0) || !(cellHeight > 0) || !(ratio > 0)) return 0;

  const widthFromHeight = cellHeight * ratio;
  if (widthFromHeight <= cellWidth) return widthFromHeight * cellHeight;

  const heightFromWidth = cellWidth / ratio;
  return cellWidth * heightFromWidth;
}

/**
 * Choisit la grille qui affiche la plus grande surface réelle d’images.
 * Deux images horizontales seront donc généralement empilées, tandis que
 * deux images verticales seront placées côte à côte.
 */
function chooseImageColumns(images, containerWidth, containerHeight, gap = 7) {
  const count = images.length;
  if (count <= 1) return 1;

  const maxColumns = Math.min(count, 4);
  let bestColumns = 1;
  let bestScore = -1;

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rows = Math.ceil(count / columns);
    const cellWidth = Math.max(1, (containerWidth - gap * (columns - 1)) / columns);
    const cellHeight = Math.max(1, (containerHeight - gap * (rows - 1)) / rows);

    const score = images.reduce(
      (total, image) => total + getContainedArea(getImageRatio(image), cellWidth, cellHeight),
      0
    );

    if (score > bestScore) {
      bestScore = score;
      bestColumns = columns;
    }
  }

  return bestColumns;
}

export default function Aleatoire() {
  const screenRef = useRef(null);
  const imagesGridRef = useRef(null);
  const [cases, setCases] = useState([]);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [imageColumns, setImageColumns] = useState(1);
  const [lightbox, setLightbox] = useState(null);

  const currentCase = position < cases.length ? cases[position] : null;
  const sessionComplete = !loading && cases.length > 0 && position >= cases.length;

  const startSession = useCallback((sourceCases) => {
    setCases(shuffle(sourceCases));
    setPosition(0);
    setRevealed(false);
  }, []);

  // La page de révision occupe exactement la hauteur restante sous la navbar.
  useLayoutEffect(() => {
    const screen = screenRef.current;
    if (!screen || typeof window === 'undefined') return undefined;

    const fitToViewport = () => {
      const top = Math.max(0, screen.getBoundingClientRect().top);
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      screen.style.setProperty('--aleatoire-screen-height', `${Math.max(420, viewportHeight - top)}px`);
    };

    fitToViewport();
    window.addEventListener('resize', fitToViewport);
    window.visualViewport?.addEventListener('resize', fitToViewport);

    return () => {
      window.removeEventListener('resize', fitToViewport);
      window.visualViewport?.removeEventListener('resize', fitToViewport);
    };
  }, []);

  useEffect(() => {
    document.body.classList.add('aleatoire-route');
    return () => document.body.classList.remove('aleatoire-route');
  }, []);

  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError('');

      try {
        let response;

        try {
          response = await fetchTrainingCases({ signal: controller.signal, filterEnabled: true });
        } catch (firstError) {
          // Selon la version/configuration Strapi, le filtre sur un champ de composant
          // peut être refusé. On retente alors sans ce filtre, puis on filtre côté React.
          if (firstError?.status !== 400) throw firstError;
          response = await fetchTrainingCases({ signal: controller.signal, filterEnabled: false });
        }

        if (ignore) return;

        const rows = Array.isArray(response?.data) ? response.data : [];
        const eligibleCases = rows.map(prepareCase).filter(Boolean);
        startSession(eligibleCases);
      } catch (loadError) {
        if (!ignore && !isAbortError(loadError)) {
          setCases([]);
          setPosition(0);
          setError(loadError?.message || 'Impossible de charger les cas d’entraînement.');
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [reloadToken, startSession]);

  const images = useMemo(() => {
    const list = currentCase?.training_summary?.images;
    return Array.isArray(list) ? list : [];
  }, [currentCase]);

  const pathologies = useMemo(() => {
    const list = currentCase?.pathologies;
    return Array.isArray(list) ? list : [];
  }, [currentCase]);

  // La disposition gauche/droite ou haut/bas dépend des proportions réelles
  // des images et de la place disponible dans le panneau.
  useLayoutEffect(() => {
    const grid = imagesGridRef.current;
    if (!grid || images.length === 0) {
      setImageColumns(1);
      return undefined;
    }

    const updateLayout = () => {
      const rect = grid.getBoundingClientRect();
      const nextColumns = chooseImageColumns(images, rect.width, rect.height);
      setImageColumns((current) => (current === nextColumns ? current : nextColumns));
    };

    updateLayout();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateLayout) : null;
    observer?.observe(grid);
    window.addEventListener('resize', updateLayout);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateLayout);
    };
  }, [images]);

  useEffect(() => {
    setLightbox(null);
  }, [currentCase?.slug]);

  useEffect(() => {
    if (!lightbox) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setLightbox(null);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [lightbox]);

  const densityClass = useMemo(() => {
    if (!currentCase) return '';

    const summaryLength = currentCase.training_summary.summary.length;
    const correctionLength = currentCase.training_summary.correction.length;
    let score = 0;

    if (summaryLength > 520) score += 2;
    else if (summaryLength > 280) score += 1;

    if (images.length >= 4) score += 1;

    if (revealed && correctionLength > 420) score += 2;
    else if (revealed && correctionLength > 220) score += 1;

    if (pathologies.length > 1) score += 1;

    if (score >= 3) return 'is-very-dense';
    if (score >= 1) return 'is-dense';
    return '';
  }, [currentCase, images.length, pathologies.length, revealed]);

  const showNext = () => {
    setRevealed(false);
    setPosition((value) => value + 1);
  };

  const restartSession = () => {
    startSession(cases);
  };

  const handlePrimaryAction = () => {
    if (!revealed) {
      setRevealed(true);
      return;
    }
    showNext();
  };

  return (
    <div ref={screenRef} className="aleatoire-app">
      <main className="aleatoire-viewport">
        {loading ? <div className="aleatoire-state ui-card">Chargement des cas compatibles…</div> : null}

        {!loading && error ? (
          <div className="aleatoire-state ui-card">
            <p className="cc-state error">{error}</p>
            <button
              type="button"
              className="aleatoire-button aleatoire-button--primary"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              Réessayer
            </button>
          </div>
        ) : null}

        {!loading && !error && cases.length === 0 ? (
          <div className="aleatoire-state ui-card">
            <h2>Aucun cas disponible</h2>
            <p>Aucun cas ne possède un résumé d’entraînement activé avec un résumé et une réponse.</p>
          </div>
        ) : null}

        {sessionComplete ? (
          <div className="aleatoire-state ui-card">
            <h2>Session terminée</h2>
            <p>Tu as parcouru les {cases.length} cas disponibles sans répétition.</p>
            <button type="button" className="aleatoire-button aleatoire-button--primary" onClick={restartSession}>
              Recommencer une session
            </button>
          </div>
        ) : null}

        {!loading && !error && currentCase ? (
          <article
            className={`aleatoire-flashcard ${images.length > 0 ? 'has-images' : 'has-no-images'} ${
              revealed ? 'is-revealed' : ''
            } ${densityClass}`}
          >
            <span className="aleatoire-progress" aria-label={`Cas ${position + 1} sur ${cases.length}`}>
              {position + 1}<span aria-hidden="true"> / </span>{cases.length}
            </span>

            {images.length > 0 ? (
              <section className="aleatoire-media" aria-label="Images cliniques">
                <div
                  ref={imagesGridRef}
                  className="aleatoire-images"
                  style={{ '--aleatoire-image-columns': imageColumns }}
                >
                  {images.map((image, index) => {
                    const fullUrl = imgUrl(image, 'original') || imgUrl(image);
                    const displayUrl = imgUrl(image, 'medium') || imgUrl(image, 'small') || fullUrl;
                    if (!displayUrl) return null;

                    const alt = image.alternativeText || image.caption || image.name || `Image clinique ${index + 1}`;

                    return (
                      <button
                        key={image.documentId || image.id || `${displayUrl}-${index}`}
                        type="button"
                        className="aleatoire-image-button"
                        aria-label={`Agrandir l’image clinique ${index + 1}`}
                        onClick={() =>
                          setLightbox({
                            src: fullUrl || displayUrl,
                            alt,
                          })
                        }
                      >
                        <img src={displayUrl} alt={alt} loading={index === 0 ? 'eager' : 'lazy'} />
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className="aleatoire-stage">
              <div className={`aleatoire-panels ${revealed ? 'is-revealed' : ''}`}>
                <section className="aleatoire-clinical-panel" aria-label="Résumé clinique">
                  <span className="aleatoire-eyebrow">Situation clinique</span>

                  <div className="aleatoire-summary">
                    <CaseMarkdown scopeKey={`training-summary-${currentCase.slug}`}>
                      {currentCase.training_summary.summary}
                    </CaseMarkdown>
                  </div>

                  <div className="aleatoire-question">
                    <p>Quel est votre diagnostic&nbsp;?</p>
                  </div>
                </section>

                {revealed ? (
                  <section className="aleatoire-diagnosis-panel" aria-live="polite">
                    <div className="aleatoire-answer">
                      <span className="aleatoire-eyebrow">Diagnostic</span>
                      <p>{currentCase.training_summary.answer}</p>
                    </div>

                    {currentCase.training_summary.biopsy_required ? (
                      <div className="aleatoire-biopsy" role="note">
                        <strong>Biopsie nécessaire</strong>
                        <span>Une confirmation histologique était indispensable.</span>
                      </div>
                    ) : null}

                    {currentCase.training_summary.correction ? (
                      <div className="aleatoire-correction">
                        <span className="aleatoire-section-label">À retenir</span>
                        <CaseMarkdown scopeKey={`training-correction-${currentCase.slug}`}>
                          {currentCase.training_summary.correction}
                        </CaseMarkdown>
                      </div>
                    ) : null}

                    {pathologies.length > 0 ? (
                      <div className="aleatoire-resources" aria-label="Ressources liées">
                        {pathologies.map((pathology) => {
                          const pathologyTitle = pathology.title || pathology.slug;
                          return (
                            <div
                              className="aleatoire-resource-group"
                              key={pathology.documentId || pathology.id || pathology.slug}
                            >
                              <Link
                                className="aleatoire-resource-link"
                                to={`/atlas/${pathology.slug}/${currentCase.slug}`}
                                title={`Voir le cas complet dans ${pathologyTitle}`}
                              >
                                Cas complet
                                {pathologies.length > 1 ? ` · ${pathologyTitle}` : ''}
                              </Link>
                              <Link
                                className="aleatoire-resource-link"
                                to={`/atlas/${pathology.slug}`}
                                title={`Voir la fiche ${pathologyTitle}`}
                              >
                                Fiche Atlas
                                {pathologies.length > 1 ? ` · ${pathologyTitle}` : ''}
                              </Link>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="aleatoire-missing-relation">
                        Aucun lien Atlas ne peut être construit pour ce cas.
                      </p>
                    )}
                  </section>
                ) : null}
              </div>
            </div>

            <footer className="aleatoire-actionbar">
              <span className="aleatoire-action-hint">
                {revealed ? 'Diagnostic révélé' : 'Réfléchis avant de révéler la réponse'}
              </span>

              <button
                type="button"
                className="aleatoire-button aleatoire-button--primary aleatoire-primary-action"
                onClick={handlePrimaryAction}
              >
                {!revealed
                  ? 'Afficher la réponse'
                  : position + 1 < cases.length
                    ? 'Cas suivant →'
                    : 'Terminer la session'}
              </button>
            </footer>
          </article>
        ) : null}
      </main>

      {lightbox ? (
        <div
          className="aleatoire-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Aperçu de l’image"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="aleatoire-lightbox-close"
            aria-label="Fermer l’aperçu"
            onClick={() => setLightbox(null)}
          >
            ×
          </button>
          <img
            className="aleatoire-lightbox-image"
            src={lightbox.src}
            alt={lightbox.alt}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
