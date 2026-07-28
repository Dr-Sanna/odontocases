import { useEffect, useRef, useState } from 'react';
import './FilterMenu.css';

export default function FilterMenu({ children, label = 'Filtres' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="display-filter-wrap" ref={rootRef}>
      <button
        type="button"
        className={`display-filterbtn ${open ? 'active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg className="display-filter-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 6h16M7 12h10M10 18h4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span>{label}</span>
      </button>

      {open && (
        <div
          className="display-filter-popover"
          role="dialog"
          aria-label="Options de filtrage"
          onClick={(event) => {
            // Laisse d'abord le bouton interne appliquer son changement
            // (setCaseGroup / setAtlasGroup / setDocGroup), puis ferme le menu.
            if (event.target.closest?.('button')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
