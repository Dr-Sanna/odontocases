import { createContext, useContext, useMemo, useState } from "react";

const Ctx = createContext(null);

export function CaseDetailSidebarProvider({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const value = useMemo(
    () => ({ mobileOpen, setMobileOpen }),
    [mobileOpen]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCaseDetailSidebar() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useCaseDetailSidebar must be used within CaseDetailSidebarProvider");
  }
  return ctx;
}
