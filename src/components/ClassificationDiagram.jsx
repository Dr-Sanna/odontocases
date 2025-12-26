// src/components/ClassificationDiagram.jsx
import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "./ClassificationDiagram.css";

/* =========================
   Utils
   ========================= */
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
    const rootFs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
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
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName);
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

/* =========================
   UI primitive
   ========================= */
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

  if (typeof to === "string" && (to.startsWith("https://") || to.startsWith("http://"))) {
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

function MaskedChip({ className = "", placeholder = "Afficher", onReveal }) {
  return (
    <button type="button" className={`cdg-chip ${className}`} onClick={onReveal}>
      {placeholder}
    </button>
  );
}

/* =========================
   Spine cut (stack)
   ========================= */
function applySpineCut(rootEl) {
  if (!rootEl) return;

  const lists = rootEl.querySelectorAll('.cdg-list[data-layout="stack"]');

  lists.forEach((list) => {
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

/* =========================
   Layout resolvers
   ========================= */
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

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const r = Math.floor(x);
  if (r < min || r > max) return fallback;
  return r;
}

/* =========================
   Hiérarchie sans toucher aux JSON :
   - si un node n’a pas de label => wrapper structurel => depth inchangé
   ========================= */
function nextDepthForGroup(parentNode, currentDepth) {
  const isStructuralWrapper = !parentNode?.label;
  return isStructuralWrapper ? currentDepth : Math.min(currentDepth + 1, 6);
}

/* =========================
   Training (React only)
   ========================= */
const MIN_LEVEL = -1;
const MAX_LEVEL = 2;

function hideLabelsFromDepth(level) {
  if (level <= 0) return 999;
  if (level === 1) return 3;
  return 2;
}

function collectHideTargets(node, depth, path, level, out) {
  if (!node) return;

  const items = Array.isArray(node?.items) ? node.items : [];
  const groups = Array.isArray(node?.groups) ? node.groups : [];

  const fromDepth = hideLabelsFromDepth(level);
  if (node?.label && depth >= fromDepth) out.push(`${path}/label`);

  if (level >= 0) {
    for (let i = 0; i < items.length; i++) {
      out.push(`${path}/item/${i}`);

      const it = items[i];

      if (it?.children?.items && Array.isArray(it.children.items)) {
        for (let ci = 0; ci < it.children.items.length; ci++) {
          out.push(`${path}/item/${i}/children/item/${ci}`);
        }
      }

      if (it?.children?.groups && Array.isArray(it.children.groups)) {
        for (let gi = 0; gi < it.children.groups.length; gi++) {
          collectHideTargets(
            it.children.groups[gi],
            Math.min(depth + 2, 6),
            `${path}/item/${i}/children/group/${gi}`,
            level,
            out
          );
        }
      }
    }
  }

  for (let gi = 0; gi < groups.length; gi++) {
    const nd = nextDepthForGroup(node, depth);
    collectHideTargets(groups[gi], nd, `${path}/group/${gi}`, level, out);
  }
}

/* =========================
   Child renderer
   ========================= */
function ChildBlock({ child, depth, path, trainingOn, hidden, reveal }) {
  if (!child) return null;

  const childItems = Array.isArray(child?.items) ? child.items : [];
  const childGroups = Array.isArray(child?.groups) ? child.groups : [];

  const childLayout = resolveLayout(child);
  const childCols = resolveCols(child, 2);
  const childGroupCols = resolveGroupCols(child, 1);

  const childChip = depth >= 4 ? "cdg-chip-h6" : "cdg-chip-h5";

  return (
    <div className="cdg-subwrap">
      {childItems.length ? (
        <div className="cdg-sublist" data-layout={childLayout} style={{ "--cdg-cols": String(childCols) }}>
          {childItems.map((c, ci) => {
            const id = `${path}/item/${ci}`;
            const isHidden = trainingOn && hidden.has(id);

            return isHidden ? (
              <MaskedChip key={id} className={childChip} onReveal={() => reveal(id)} />
            ) : (
              <Item key={id} label={c.label} anchor={c.anchor} to={c.to} className={childChip} />
            );
          })}
        </div>
      ) : null}

      {childGroups.length ? (
        <div className="cdg-groups" style={{ "--cdg-groups-cols": String(childGroupCols) }}>
          {childGroups.map((g, gi) => (
            <NodeBlock
              key={`${path}/group/${gi}`}
              node={g}
              depth={Math.min(depth + 2, 6)}
              path={`${path}/group/${gi}`}
              trainingOn={trainingOn}
              hidden={hidden}
              reveal={reveal}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* =========================
   Recursive renderer
   ========================= */
function NodeBlock({ node, depth = 2, path = "root", trainingOn, hidden, reveal }) {
  if (!node) return null;

  const headingWrap = depth === 2 ? "cdg-h2" : depth === 3 ? "cdg-h3" : depth === 4 ? "cdg-h4" : "cdg-h5";
  const headingChip = depth === 2 ? "cdg-chip-h2" : depth === 3 ? "cdg-chip-h3" : depth === 4 ? "cdg-chip-h4" : "cdg-chip-h5";

  const layout = resolveLayout(node);
  const cols = resolveCols(node, 2);
  const groupCols = resolveGroupCols(node, 1);

  const items = Array.isArray(node?.items) ? node.items : [];
  const groups = Array.isArray(node?.groups) ? node.groups : [];

  const itemChip = depth >= 5 ? "cdg-chip-h6" : depth >= 4 ? "cdg-chip-h5" : "cdg-chip-h4";

  const labelId = `${path}/label`;
  const labelHidden = trainingOn && hidden.has(labelId);

  return (
    <div className={`cdg-node cdg-depth-${depth}`}>
      {node.label ? (
        <div className={headingWrap}>
          {labelHidden ? (
            <MaskedChip className={headingChip} onReveal={() => reveal(labelId)} />
          ) : (
            <Item label={node.label} anchor={node.anchor} to={node.to} className={headingChip} />
          )}
        </div>
      ) : null}

      {items.length ? (
        layout === "grid" ? (
          <div className="cdg-list" data-layout="grid" style={{ "--cdg-cols": String(cols) }}>
            {items.map((it, i) => {
              const id = `${path}/item/${i}`;
              const isHidden = trainingOn && hidden.has(id);

              return isHidden ? (
                <MaskedChip key={id} className={itemChip} onReveal={() => reveal(id)} />
              ) : (
                <Item key={id} label={it.label} anchor={it.anchor} to={it.to} className={itemChip} />
              );
            })}
          </div>
        ) : (
          <div className="cdg-list" data-layout="stack">
            {items.map((it, i) => {
              const id = `${path}/item/${i}`;
              const isHidden = trainingOn && hidden.has(id);

              return (
                <div key={id} className="cdg-stack-row">
                  {isHidden ? (
                    <MaskedChip className={`${itemChip} cdg-spine-target`} onReveal={() => reveal(id)} />
                  ) : (
                    <Item
                      label={it.label}
                      anchor={it.anchor}
                      to={it.to}
                      className={`${itemChip} cdg-spine-target`}
                    />
                  )}

                  {it?.children ? (
                    <ChildBlock
                      child={it.children}
                      depth={depth}
                      path={`${path}/item/${i}/children`}
                      trainingOn={trainingOn}
                      hidden={hidden}
                      reveal={reveal}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {groups.length ? (
        <div className="cdg-groups" style={{ "--cdg-groups-cols": String(groupCols) }}>
          {groups.map((g, i) => {
            const nd = nextDepthForGroup(node, depth);
            return (
              <NodeBlock
                key={`${path}/group/${i}`}
                node={g}
                depth={nd}
                path={`${path}/group/${i}`}
                trainingOn={trainingOn}
                hidden={hidden}
                reveal={reveal}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* =========================
   Root
   ========================= */
export default function ClassificationDiagram({
  title,
  layout = "cols",
  left,
  right,
  items,
  rootColumns = 2,

  // ✅ ajouté : change quand tu changes d’item via la liste
  scopeKey = "",
}) {
  const rootRef = useRef(null);

  const hasRootItems = useMemo(() => Array.isArray(items) && items.length > 0, [items]);

  const safeRootCols = clampInt(rootColumns, 1, 4, 2);
  const topLayout = layout === "stack" ? "stack" : "cols";

  // Training
  const [trainingOn, setTrainingOn] = useState(false);
  const [maskLevel, setMaskLevel] = useState(0);
  const [revealed, setRevealed] = useState(() => new Set());

  // ✅ NOUVEAU : si on change d’item (via sidebar), on sort de l’entraînement
  useEffect(() => {
    setTrainingOn(false);
    setMaskLevel(0);
    setRevealed(new Set());
  }, [scopeKey]);

  const rootNodes = useMemo(() => {
    if (hasRootItems) {
      return items.map((n, i) => ({ node: n, depth: 2, path: `root/node/${i}` }));
    }
    return [
      { node: left, depth: 2, path: "root/left" },
      { node: right, depth: 2, path: "root/right" },
    ];
  }, [hasRootItems, items, left, right]);

  const baseHidden = useMemo(() => {
    if (!trainingOn) return new Set();
    if (maskLevel === -1) return new Set();

    const targets = [];
    for (const r of rootNodes) {
      collectHideTargets(r.node, r.depth, r.path, maskLevel, targets);
    }
    return new Set(targets);
  }, [trainingOn, rootNodes, maskLevel]);

  const hidden = useMemo(() => {
    if (!trainingOn) return new Set();
    const s = new Set(baseHidden);
    for (const id of revealed) s.delete(id);
    return s;
  }, [trainingOn, baseHidden, revealed]);

  const reveal = useCallback((id) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const incLevel = useCallback(() => {
    setRevealed(new Set());
    setMaskLevel((v) => (v >= MAX_LEVEL ? v : v + 1));
  }, []);

  const decLevel = useCallback(() => {
    setMaskLevel((v) => Math.max(MIN_LEVEL, v - 1));
  }, []);

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
  }, [title, layout, left, right, items, rootColumns, trainingOn, maskLevel, revealed]);

  const canMinus = maskLevel < MAX_LEVEL || revealed.size > 0;
  const canPlus = maskLevel > MIN_LEVEL;

  return (
    <section ref={rootRef} className="cdg" aria-label={title || "Diagramme de classification"}>
      {title ? (
        <div className="cdg-root cdg-root--with-controls">
          <span className="cdg-chip cdg-chip-h1">{title}</span>

          <div className="cdg-root-controls">
            {trainingOn ? (
              <>
                <button
                  type="button"
                  className="cdg-chip cdg-chip-h6"
                  onClick={incLevel}
                  disabled={!canMinus}
                  aria-disabled={!canMinus}
                  title={maskLevel >= MAX_LEVEL ? "Remasquer" : "Augmenter le masquage"}
                >
                  -
                </button>

                <button
                  type="button"
                  className="cdg-chip cdg-chip-h6"
                  onClick={decLevel}
                  disabled={!canPlus}
                  aria-disabled={!canPlus}
                  title="Réduire le masquage"
                >
                  +
                </button>

                <button
                  type="button"
                  className="cdg-chip cdg-chip-h6"
                  onClick={() => {
                    setTrainingOn(false);
                    setMaskLevel(0);
                    setRevealed(new Set());
                  }}
                  title="Quitter le mode entraînement (tout est affiché)"
                >
                  Quitter
                </button>
              </>
            ) : (
              <button
                type="button"
                className="cdg-chip cdg-chip-h6 cdg-training-toggle"
                onClick={() => {
                  setTrainingOn(true);
                  setMaskLevel(0);
                  setRevealed(new Set());
                }}
                title="Activer le mode entraînement"
              >
                Entraînement
              </button>
            )}
          </div>
        </div>
      ) : null}

      {hasRootItems ? (
        <div
          className="cdg-root-items"
          data-layout={layout === "grid" ? "grid" : "stack"}
          style={layout === "grid" ? { "--cdg-cols": String(safeRootCols) } : undefined}
        >
          {items.map((n, i) => (
            <NodeBlock
              key={`root/node/${i}`}
              node={n}
              depth={2}
              path={`root/node/${i}`}
              trainingOn={trainingOn}
              hidden={hidden}
              reveal={reveal}
            />
          ))}
        </div>
      ) : (
        <div className="cdg-cols" data-layout={topLayout}>
          <div className="cdg-col">
            <NodeBlock node={left} depth={2} path="root/left" trainingOn={trainingOn} hidden={hidden} reveal={reveal} />
          </div>
          <div className="cdg-col">
            <NodeBlock
              node={right}
              depth={2}
              path="root/right"
              trainingOn={trainingOn}
              hidden={hidden}
              reveal={reveal}
            />
          </div>
        </div>
      )}
    </section>
  );
}
