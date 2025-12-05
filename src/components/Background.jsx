// src/components/Background.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './Background.css';

function computeVariant(pathname) {
  if (pathname === '/') return 'home';

  // ✅ si tu veux le cacher sur CaseDetail, garde ça
  // (background chargé mais invisible)
  if (pathname.startsWith('/cas-cliniques/')) return 'hidden';

  return 'secondary';
}

export default function Background() {
  const { pathname } = useLocation();
  const variant = useMemo(() => computeVariant(pathname), [pathname]);

  const prevVariantRef = useRef(variant);
  const [noTransition, setNoTransition] = useState(false);

  useEffect(() => {
    const prev = prevVariantRef.current;

    // ✅ pas de transition quand on repasse de secondary -> home
    if (prev === 'secondary' && variant === 'home') {
      setNoTransition(true);
      requestAnimationFrame(() => setNoTransition(false));
    }

    prevVariantRef.current = variant;
  }, [variant]);

  const src = `${import.meta.env.BASE_URL}background.png`;
  const className = [
    'global-background',
    variant,
    noTransition ? 'no-transition' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} aria-hidden="true">
      <img src={src} alt="" loading="eager" decoding="async" />
    </div>
  );
}
