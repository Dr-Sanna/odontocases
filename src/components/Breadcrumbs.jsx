/**
 * Breadcrumbs
 * -----------
 * Fil d’Ariane simple et neutre (pas d'offset, pas de padding latéral).
 * L’offset et les marges latérales sont gérés par le wrapper .page-header + .container.
 */
import { Link } from 'react-router-dom';
import './Breadcrumbs.css';

export default function Breadcrumbs({ items = [] }) {
  return (
    <nav className="breadcrumbs" aria-label="Fil d’Ariane">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="bc-item">
            {it.to && !last ? (
              <Link to={it.to}>{it.label}</Link>
            ) : (
              <span aria-current="page">{it.label}</span>
            )}
            {!last && <span className="bc-sep">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
