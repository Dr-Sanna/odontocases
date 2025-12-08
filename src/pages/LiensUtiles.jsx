import { useMemo, useState } from 'react';
import PageTitle from '../components/PageTitle';
import './LiensUtiles.css';

const RESOURCES = [
  {
    name: 'CNECO',
    url: 'https://www.cneco.education/',
    desc: "Plateforme de formation continue : cours, fiches et ressources en odonto-stomatologie.",
    tags: ['Cas cliniques', 'Documentation / fiches'],
  },
  {
    name: 'SFCO',
    url: 'https://societechirorale.com/',
    desc: 'Société savante en chirurgie orale : ressources professionnelles, fiches et contenus.',
    tags: ['Cas cliniques', 'Documentation / fiches'],
  },
  {
    name: 'Le CRAT',
    url: 'https://www.lecrat.fr/',
    desc: "Référence pour évaluer le risque médicamenteux pendant la grossesse et l’allaitement.",
    tags: ['Grossesse', 'Médicaments'],
  },
  {
    name: 'Dentibiotic',
    url: 'https://dentibiotic.fr/',
    desc: "Aide à la décision pour l’antibiothérapie (curative et prophylactique) en odontologie.",
    tags: ['Aide à la prescription', 'Médicaments'],
  },
  {
    name: 'Dentromatic',
    url: 'https://dentromatic.fr/',
    desc: 'Aide pratique pour les conduites à tenir (urgences, traumatologie, prescriptions).',
    tags: ['Aide à la prescription', 'Traumatologie'],
  },
  {
    name: 'Radiopaedia',
    url: 'https://radiopaedia.org/',
    desc: "Encyclopédie collaborative d’imagerie médicale avec de nombreux cas illustrés.",
    tags: ['Imagerie', 'Cas cliniques'],
  },
];


function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="lu-ext">
      <path
        fill="currentColor"
        d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z"
      />
      <path fill="currentColor" d="M5 5h6v2H7v10h10v-4h2v6H5V5z" />
    </svg>
  );
}

export default function LiensUtiles() {
  const [activeTag, setActiveTag] = useState('Toutes');

  const allTags = useMemo(() => {
    const set = new Set();
    for (const r of RESOURCES) for (const t of r.tags || []) set.add(t);
    return ['Toutes', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))];
  }, []);

  const filtered = useMemo(() => {
    if (activeTag === 'Toutes') return RESOURCES;
    return RESOURCES.filter((r) => (r.tags || []).includes(activeTag));
  }, [activeTag]);

  return (
    <>
      <div className="page-header">
        <div className="container">
          <PageTitle description="Sélection de ressources externes : recommandations, cours, outils cliniques.">
            Liens utiles
          </PageTitle>
        </div>
      </div>

      <div className="container">
        <div className="lu-toolbar" aria-label="Filtres">
          <div className="lu-chips" role="tablist" aria-label="Filtrer par catégorie">
            {allTags.map((t) => {
              const isActive = t === activeTag;
              return (
                <button
                  key={t}
                  type="button"
                  className={`lu-chip ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveTag(t)}
                  role="tab"
                  aria-selected={isActive}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <section className="lu-grid" aria-label="Ressources">
          {filtered.map((r) => (
            <a
              key={r.url}
              className="lu-card"
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <header className="lu-card-head">
                <div className="lu-title">
                  <span className="lu-name">{r.name}</span>
                </div>
                <ExternalIcon />
              </header>

              <p className="lu-desc">{r.desc}</p>

              <div className="lu-tags" aria-label="Mots-clés">
                {(r.tags || []).map((t) => (
                  <span key={t} className="lu-tag">
                    {t}
                  </span>
                ))}
              </div>

              <div className="lu-url" aria-hidden="true">
                {new URL(r.url).hostname.replace(/^www\./, '')}
              </div>
            </a>
          ))}
        </section>
      </div>
    </>
  );
}
