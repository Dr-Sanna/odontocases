import { NavLink, useLocation } from 'react-router-dom';
import { useMobileDrawer } from '../ui/MobileDrawerContext';
import './MobileNavDrawer.css';

export default function MobileNavDrawer() {
  const { pathname } = useLocation();
  const isCaseDetail = /^\/cas-cliniques\/[^/]+/.test(pathname);

  const { isOpen, panel, close } = useMobileDrawer();

  // Sur CaseDetail, c'est CaseDetail qui rend son drawer (cases/nav)
  if (isCaseDetail) return null;

  const openNav = isOpen && panel === 'nav';
  if (!openNav) return null;

  return (
    <>
      <div
        className="mnav-scrim"
        role="button"
        tabIndex={0}
        aria-label="Fermer le menu"
        onClick={close}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') close();
        }}
      />

      <aside className="mnav-drawer" aria-label="Menu">
        <div className="mnav-header">Menu</div>

        <nav className="mnav-list">
          <NavLink to="/cas-cliniques" className="mnav-link" onClick={close}>
            Cas Cliniques
          </NavLink>
          <NavLink to="/randomisation" className="mnav-link" onClick={close}>
            Randomisation
          </NavLink>
          <NavLink to="/documentation" className="mnav-link" onClick={close}>
            Documentation
          </NavLink>
          <NavLink to="/liens-utiles" className="mnav-link" onClick={close}>
            Liens Utiles
          </NavLink>
        </nav>
      </aside>
    </>
  );
}
