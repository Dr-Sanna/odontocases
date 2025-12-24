// src/components/ClassificationDiagram.jsx
import { Link } from 'react-router-dom';
import './ClassificationDiagram.css';

function norm(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cssLenToPx(value) {
  const v = String(value || '').trim();
  if (!v) return 0;

  if (v.endsWith('px')) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  if (v.endsWith('rem')) {
    const n = parseFloat(v);
    const rootFs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return Number.isFinite(n) ? n * rootFs : 0;
  }

  if (v.endsWith('vw')) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? (n / 100) * (window.innerWidth || 0) : 0;
  }

  if (v.endsWith('vh')) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? (n / 100) * (window.innerHeight || 0) : 0;
  }

  // fallback: nombre nu = px
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function readCssVarPx(varName) {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName);
    return cssLenToPx(raw);
  } catch {
    return 0;
  }
}

function getNavbarHeightPx() {
  // Plus fiable si une navbar existe réellement dans le DOM
  const nav =
    document.querySelector('header.navbar') ||
    document.querySelector('.navbar') ||
    document.querySelector('header');

  const hDom = nav?.getBoundingClientRect?.().height || 0;
  if (hDom > 0) return hDom;

  // fallback: variable Docusaurus
  return readCssVarPx('--ifm-navbar-height');
}

function getScrollOffsetPx() {
  return Math.round(getNavbarHeightPx() + 14); // marge confort
}

function scrollToElWithOffset(el) {
  const offset = getScrollOffsetPx();
  const y = window.scrollY + el.getBoundingClientRect().top - offset;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

function scrollToHeadingText(text) {
  const wanted = norm(text);
  const headings = document.querySelectorAll(
    '.cd-content h1, .cd-content h2, .cd-content h3, .cd-content h4, .cd-content h5, .cd-content h6'
  );

  for (const h of headings) {
    if (norm(h.textContent || '') === wanted) {
      scrollToElWithOffset(h);
      return true;
    }
  }
  return false;
}

function Item({ label, anchor, to, className = '' }) {
  if (anchor) {
    return (
      <button
        type="button"
        className={`cdg-chip ${className}`}
        onClick={() => scrollToHeadingText(anchor)}
      >
        {label}
      </button>
    );
  }

  if (typeof to === 'string' && to.startsWith('/')) {
    return (
      <Link className={`cdg-chip ${className}`} to={to}>
        {label}
      </Link>
    );
  }

  if (typeof to === 'string' && (to.startsWith('https://') || to.startsWith('http://'))) {
    return (
      <a className={`cdg-chip ${className}`} href={to} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
  }

  return (
    <span className={`cdg-chip cdg-chip-disabled ${className}`} aria-disabled="true">
      {label}
    </span>
  );
}

export default function ClassificationDiagram({ title, left, right }) {
  return (
    <section className="cdg" aria-label={title || 'Diagramme de classification'}>
      {title ? (
        <div className="cdg-root">
          <span className="cdg-chip cdg-chip-h1">{title}</span>
        </div>
      ) : null}

      <div className="cdg-cols">
        {/* LEFT COLUMN */}
        <div className="cdg-col">
          <div className="cdg-h2">
            <Item
              label={left?.label || ''}
              anchor={left?.anchor}
              to={left?.to}
              className="cdg-chip-h2"
            />
          </div>

          {(left?.groups || []).map((g) => (
            <div key={g.label} className="cdg-group">
              <div className="cdg-h3">
                <Item label={g.label} anchor={g.anchor} to={g.to} className="cdg-chip-h3" />
              </div>

              <div className="cdg-list">
                {(g.items || []).map((it) => (
                  <Item
                    key={it.label}
                    label={it.label}
                    anchor={it.anchor}
                    to={it.to}
                    className="cdg-chip-h4"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* RIGHT COLUMN */}
        <div className="cdg-col">
          <div className="cdg-h2">
            <Item
              label={right?.label || ''}
              anchor={right?.anchor}
              to={right?.to}
              className="cdg-chip-h2"
            />
          </div>

          {(right?.groups || []).map((g) => (
            <div key={g.label} className="cdg-group">
              <div className="cdg-h3">
                <Item label={g.label} anchor={g.anchor} to={g.to} className="cdg-chip-h3" />
              </div>

              <div className="cdg-list">
                {(g.items || []).map((it) => (
                  <Item
                    key={it.label}
                    label={it.label}
                    anchor={it.anchor}
                    to={it.to}
                    className="cdg-chip-h4"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
