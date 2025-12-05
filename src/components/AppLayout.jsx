// src/components/AppLayout.jsx
import { Outlet, useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import ScrollToTop from "./ScrollToTop";
import Background from "./Background";

export default function AppLayout() {
  const { pathname } = useLocation();
  const variant = pathname === "/" ? "home" : "secondary";

  return (
    <>
      <Navbar />
      <ScrollToTop />
      <Background variant={variant} />
      <Outlet />
    </>
  );
}
