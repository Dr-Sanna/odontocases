import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const MobileDrawerContext = createContext(null);

export function MobileDrawerProvider({ children }) {
  const [navOpen, setNavOpen] = useState(false);

  const value = useMemo(
    () => ({
      navOpen,
      setNavOpen,
      openNav: () => setNavOpen(true),
      closeNav: () => setNavOpen(false),
      toggleNav: () => setNavOpen((v) => !v),
    }),
    [navOpen]
  );

  // Sécurité: si on repasse en desktop, on ferme
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 980px)');
    if (!mq) return;

    const onChange = () => {
      if (!mq.matches) setNavOpen(false);
    };

    onChange();
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  return <MobileDrawerContext.Provider value={value}>{children}</MobileDrawerContext.Provider>;
}

export function useMobileDrawer() {
  const ctx = useContext(MobileDrawerContext);
  if (!ctx) throw new Error('useMobileDrawer must be used within MobileDrawerProvider');
  return ctx;
}
