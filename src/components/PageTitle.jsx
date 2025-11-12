/**
 * PageTitle
 * ----------
 * Titre standard pour les pages internes (Cas cliniques, Documentation, etc.).
 * - Prend automatiquement en compte la hauteur de la Navbar (--ifm-navbar-height).
 * - `spacing`: "default" (compact) | "loose" (un peu plus d'air).
 */

import './PageTitle.css';

export default function PageTitle({ children, description, spacing = 'default' }) {
  return (
    <header
      className={[
        'pagetitle',
        spacing === 'loose' ? 'pagetitle--loose' : 'pagetitle--default',
      ].join(' ')}
    >
      <div className="pagetitle__inner">
        <h1 className="pagetitle__title">{children}</h1>
        {description && <p className="pagetitle__desc">{description}</p>}
      </div>
    </header>
  );
}
