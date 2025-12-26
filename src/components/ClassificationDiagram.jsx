// src/components/ClassificationDiagram.jsx
import { Link } from "react-router-dom";
import { useEffect, useRef } from "react";
import "./ClassificationDiagram.css";

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cssLenToPx(value) {
  const v = String(value || "").trim();
  if (!v) return 0;

  if (v.endsWith("px")) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (v.endsWith("rem")) {
    const n = parseFloat(v);
    const rootFs =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return Number.isFinite(n) ? n * rootFs : 0;
  }
  if (v.endsWith("vw")) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? (n / 100) * (window.innerWidth || 0) : 0;
  }
  if (v.endsWith("vh")) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? (n / 100) * (window.innerHeight || 0) : 0;
  }

  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function readCssVarPx(varName) {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(
      varName
    );
    return cssLenToPx(raw);
  } catch {
    return 0;
  }
}

function getNavbarHeightPx() {
  const nav =
    document.querySelector("header.navbar") ||
    document.querySelector(".navbar") ||
    document.querySelector("header");

  const hDom = nav?.getBoundingClientRect?.().height || 0;
  if (hDom > 0) return hDom;

  return readCssVarPx("--ifm-navbar-height");
}

function getScrollOffsetPx() {
  return Math.round(getNavbarHeightPx() + 14);
}

function scrollToElWithOffset(el) {
  const offset = getScrollOffsetPx();
  const y = window.scrollY + el.getBoundingClientRect().top - offset;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

function scrollToHeadingText(text) {
  const wanted = norm(text);
  const headings = document.querySelectorAll(
    ".cd-content h1, .cd-content h2, .cd-content h3, .cd-content h4, .cd-content h5, .cd-content h6"
  );

  for (const h of headings) {
    if (norm(h.textContent || "") === wanted) {
      scrollToElWithOffset(h);
      return true;
    }
  }
  return false;
}

function Item({ label, anchor, to, className = "" }) {
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

  if (typeof to === "string" && to.startsWith("/")) {
    return (
      <Link className={`cdg-chip ${className}`} to={to}>
        {label}
      </Link>
    );
  }

  if (
    typeof to === "string" &&
    (to.startsWith("https://") || to.startsWith("http://"))
  ) {
    return (
      <a
        className={`cdg-chip ${className}`}
        href={to}
        target="_blank"
        rel="noreferrer"
      >
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

/* =========================
   Spine cut (stack)
   ========================= */
function applySpineCut(rootEl) {
  if (!rootEl) return;

  const lists = rootEl.querySelectorAll('.cdg-list[data-layout="stack"]');
  lists.forEach((list) => {
    // ⚠️ descendants (car items sont dans .cdg-stack-row)
    const targets = list.querySelectorAll(".cdg-spine-target");
    const last = targets.length ? targets[targets.length - 1] : null;

    if (!last) {
      list.style.setProperty("--cdg-spine-height", "0px");
      return;
    }

    const listRect = list.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const lastCenterY = lastRect.top - listRect.top + lastRect.height / 2;

    const spineTop = 2;
    const height = Math.max(0, lastCenterY - spineTop);

    list.style.setProperty("--cdg-spine-top", `${spineTop}px`);
    list.style.setProperty("--cdg-spine-height", `${height}px`);
  });
}

function resolveLayout(node, autoThreshold = 6) {
  const explicit = node?.layout;
  if (explicit === "grid" || explicit === "stack") return explicit;

  const count =
    (Array.isArray(node?.items) ? node.items.length : 0) +
    (Array.isArray(node?.groups) ? node.groups.length : 0);

  return count >= autoThreshold ? "grid" : "stack";
}

function resolveCols(node, fallback = 2) {
  const c = Number(node?.columns);
  return Number.isFinite(c) && c >= 1 && c <= 4 ? c : fallback;
}

function resolveGroupCols(node, fallback = 1) {
  const c = Number(node?.groupColumns);
  return Number.isFinite(c) && c >= 1 && c <= 4 ? c : fallback;
}

/* =========================
   Recursive renderer
   ========================= */
function NodeBlock({ node, depth = 2 }) {
  if (!node) return null;

  const headingWrap =
    depth === 2 ? "cdg-h2" : depth === 3 ? "cdg-h3" : "cdg-h4";
  const headingChip =
    depth === 2 ? "cdg-chip-h2" : depth === 3 ? "cdg-chip-h3" : "cdg-chip-h4";

  const layout = resolveLayout(node);
  const cols = resolveCols(node, 2);
  const groupCols = resolveGroupCols(node, 1);

  const items = Array.isArray(node?.items) ? node.items : [];
  const groups = Array.isArray(node?.groups) ? node.groups : [];

  // items sous un H4 => H5
  const itemChip = depth >= 4 ? "cdg-chip-h5" : "cdg-chip-h4";

  return (
    <div className={`cdg-node cdg-depth-${depth}`}>
      {node.label ? (
        <div className={headingWrap}>
          <Item
            label={node.label}
            anchor={node.anchor}
            to={node.to}
            className={headingChip}
          />
        </div>
      ) : null}

      {/* ITEMS */}
      {items.length ? (
        layout === "grid" ? (
          <div
            className="cdg-list"
            data-layout="grid"
            style={{ "--cdg-cols": String(cols) }}
          >
            {items.map((it, i) => (
              <Item
                key={`${it.label}-${i}`}
                label={it.label}
                anchor={it.anchor}
                to={it.to}
                className={itemChip}
              />
            ))}
          </div>
        ) : (
          <div className="cdg-list" data-layout="stack">
            {items.map((it, i) => {
              const child = it?.children;
              const childItems = Array.isArray(child?.items) ? child.items : [];
              const childLayout = resolveLayout(child || { layout: "grid", items: childItems });
              const childCols = resolveCols(child, 2);

              // Le parent de children doit être H4, et ses enfants H5
              const parentChip = depth >= 3 ? "cdg-chip-h4" : "cdg-chip-h4";

              return (
                <div key={`${it.label}-${i}`} className="cdg-stack-row">
                  <Item
                    label={it.label}
                    anchor={it.anchor}
                    to={it.to}
                    className={`${parentChip} cdg-spine-target`}
                  />

                  {childItems.length ? (
                    <div
                      className="cdg-sublist"
                      data-layout={childLayout}
                      style={{ "--cdg-cols": String(childCols) }}
                    >
                      {childItems.map((c, ci) => (
                        <Item
                          key={`${c.label}-${ci}`}
                          label={c.label}
                          anchor={c.anchor}
                          to={c.to}
                          className="cdg-chip-h5"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {/* GROUPS */}
      {groups.length ? (
        <div
          className="cdg-groups"
          style={{ "--cdg-groups-cols": String(groupCols) }}
        >
          {groups.map((g, i) => (
            <NodeBlock
              key={`${g.label}-${i}`}
              node={g}
              depth={Math.min(depth + 1, 6)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ClassificationDiagram({ title, left, right, layout = "cols" }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const rootEl = rootRef.current;
    if (!rootEl) return;

    const raf = () => requestAnimationFrame(() => applySpineCut(rootEl));

    raf();

    const onResize = () => raf();
    window.addEventListener("resize", onResize);

    const ro = new ResizeObserver(() => raf());
    ro.observe(rootEl);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, [title, left, right, layout]);

  const topLayout = layout === "stack" ? "stack" : "cols";

  return (
    <section ref={rootRef} className="cdg" aria-label={title || "Diagramme de classification"}>
      {title ? (
        <div className="cdg-root">
          <span className="cdg-chip cdg-chip-h1">{title}</span>
        </div>
      ) : null}

      <div className="cdg-cols" data-layout={topLayout}>
        <div className="cdg-col">
          <NodeBlock node={left} depth={2} />
        </div>
        <div className="cdg-col">
          <NodeBlock node={right} depth={2} />
        </div>
      </div>
    </section>
  );
}
