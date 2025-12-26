// src/components/CaseMarkdown.jsx
import { useEffect, useMemo, useRef, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";

import { ckeditorSchema } from "../lib/markdown/ckeditorSchema";
import { remarkObsidianCallouts } from "../lib/markdown/remarkObsidianCallouts";
import { remarkFigureCaptions } from "../lib/markdown/remarkFigureCaptions";

import ClassificationDiagram from "./ClassificationDiagram";

/* =========================
   Normalisation spécifique CKEditor
   ========================= */
function normalizeEscapedBlockquotes(src) {
  if (typeof src !== "string") return src;
  return src.replace(/^[ \t]*\\>\s?/gm, "> ");
}

/* =========================
   ✅ Fix ultra-ciblé pour H5 échappés
   ========================= */
function rehypePHash5ToH5() {
  const getText = (node) => {
    if (!node) return "";
    if (node.type === "text") return String(node.value || "");
    if (!node.children || !Array.isArray(node.children)) return "";
    return node.children.map(getText).join("");
  };

  const walk = (node, parent) => {
    if (!node) return;

    if (node.type === "element") {
      // Ne jamais transformer à l'intérieur d'un <pre><code>
      if (node.tagName === "pre" || node.tagName === "code") return;

      if (node.tagName === "p") {
        const raw = getText(node).replace(/\u00A0/g, "");
        const m = raw.match(/^\s*#####\s+(.+?)\s*$/);
        if (m && parent && Array.isArray(parent.children)) {
          const title = m[1];

          const h5Node = {
            type: "element",
            tagName: "h5",
            properties: {},
            children: [{ type: "text", value: title }],
          };

          const idx = parent.children.indexOf(node);
          if (idx !== -1) parent.children[idx] = h5Node;
          return;
        }
      }
    }

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) walk(child, node);
    }
  };

  return (tree) => {
    walk(tree, null);
  };
}

/* =========================
   RÉGLAGES
   ========================= */
const MOBILE_BP = 980;

const ROW_MIN_H = 150;
const ROW_MAX_H = 260;

const SAFETY_PX = 2;
const RATIO_FIT_CAP = 2.2;

const COL_MIN_W = { 1: 320, 2: 280, 3: 260, 4: 240 };
const COL_SOFT_MAX_W = { 1: 900, 2: 650, 3: 600, 4: 480 };

const COL_GUTTER = 14;

const STABLE_FRAMES_REQUIRED = 8;
const STABLE_TIMEOUT_MS = 1200;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function px(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
function isMobileNow() {
  if (typeof window === "undefined") return false;
  return (window.innerWidth || 0) <= MOBILE_BP;
}

function getIntrinsicSize(img) {
  if (!img) return null;

  if (img.naturalWidth && img.naturalHeight) {
    return { w: img.naturalWidth, h: img.naturalHeight };
  }

  const wAttr = parseFloat(img.getAttribute("width"));
  const hAttr = parseFloat(img.getAttribute("height"));
  if (wAttr > 0 && hAttr > 0) return { w: wAttr, h: hAttr };

  return null;
}

function clearSizing(img) {
  img.style.removeProperty("height");
  img.style.removeProperty("width");
  img.style.removeProperty("max-height");
  img.style.removeProperty("max-width");
}

function resetTableSizing(rootEl) {
  const imgs = rootEl.querySelectorAll("table td img");
  imgs.forEach((img) => clearSizing(img));

  const caps = rootEl.querySelectorAll("table td figcaption");
  caps.forEach((cap) => {
    cap.style.removeProperty("width");
    cap.style.removeProperty("max-width");
    cap.style.removeProperty("hyphens");
    cap.style.removeProperty("word-break");
    cap.style.removeProperty("overflow-wrap");
  });

  const rows = rootEl.querySelectorAll("table tr[data-cd-cols]");
  rows.forEach((r) => r.removeAttribute("data-cd-cols"));
}

function waitForImagesIn(rootEl) {
  const imgs = rootEl.querySelectorAll("table td img");
  const promises = Array.from(imgs).map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((res) => img.addEventListener("load", res, { once: true }));
  });
  return Promise.allSettled(promises);
}

function fitRatio(r) {
  if (!Number.isFinite(r) || r <= 0) return 1;
  return Math.min(r, RATIO_FIT_CAP);
}

/* =========================
   px -> vw/vh
   ========================= */
function pxToVw(pxVal) {
  const W = window.innerWidth || 1;
  return (pxVal / W) * 100;
}
function pxToVh(pxVal) {
  const H = window.innerHeight || 1;
  return (pxVal / H) * 100;
}
function setSizeVwVh(img, hPx, wPx) {
  clearSizing(img);

  const hVh = pxToVh(hPx);
  const wVw = pxToVw(wPx);

  img.style.setProperty("height", `${hVh}vh`, "important");
  img.style.setProperty("width", `${wVw}vw`, "important");
  img.style.setProperty("max-height", "none", "important");
  img.style.setProperty("max-width", "none", "important");
}

function normalizeNbspIn(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let t = walker.nextNode();
  while (t) {
    if (t.nodeValue && t.nodeValue.includes("\u00A0")) {
      t.nodeValue = t.nodeValue.replace(/\u00A0/g, " ");
    }
    t = walker.nextNode();
  }
}

/* =========================
   LAYOUT WIDTH
   ========================= */
function getUsableWidthFromLayout(rootEl) {
  const shell = rootEl.closest(".cd-shell") || document.querySelector(".cd-shell");
  const baseW =
    shell?.getBoundingClientRect?.().width ||
    document.documentElement.clientWidth ||
    window.innerWidth ||
    0;

  const side = document.querySelector(".cd-side");
  const sideW = side ? side.getBoundingClientRect().width : 0;

  const sideCS = side ? getComputedStyle(side) : null;
  const sideBorderR = sideCS ? px(sideCS.borderRightWidth) : 0;

  const main = rootEl.closest(".cd-main") || document.querySelector(".cd-main");
  const mainCS = main ? getComputedStyle(main) : null;
  const mainPad = mainCS ? px(mainCS.paddingLeft) + px(mainCS.paddingRight) : 0;

  const article = rootEl.closest(".casedetail") || document.querySelector(".casedetail");
  const artCS = article ? getComputedStyle(article) : null;
  const artPadR = artCS ? px(artCS.paddingRight) : 0;

  const SAFETY = 6;
  const usable = baseW - sideW - sideBorderR - mainPad - artPadR - SAFETY;
  return Math.max(0, usable);
}

function computeTargetW(cols, rootEl) {
  const c = Math.max(1, Math.min(4, cols));
  const usable = getUsableWidthFromLayout(rootEl);
  if (!usable) return 0;

  const raw = (usable - COL_GUTTER * (c - 1)) / c;
  const minW = COL_MIN_W[c] ?? 240;
  const softMax = COL_SOFT_MAX_W[c] ?? 520;

  return clamp(raw, minW, softMax);
}

/* =========================
   CAPTION WIDTH (vw)
   ========================= */
function applyCaptionWidth(img, imgWpx, ratio, cols, rootEl) {
  const fig = img.closest?.("figure");
  const cap = fig?.querySelector?.("figcaption");
  if (!cap) return;

  normalizeNbspIn(cap);

  cap.style.setProperty("hyphens", "none");
  cap.style.setProperty("word-break", "normal");
  cap.style.setProperty("overflow-wrap", "break-word");

  const td = img.closest?.("td");
  let tdInnerW = 0;

  if (td) {
    const cs = getComputedStyle(td);
    const padL = px(cs.paddingLeft);
    const padR = px(cs.paddingRight);
    tdInnerW = Math.max(0, td.getBoundingClientRect().width - padL - padR);
  }

  const fallbackW = computeTargetW(cols, rootEl) - SAFETY_PX;
  const capCeilWpx = tdInnerW > 0 ? tdInnerW : fallbackW;

  if (cols <= 1) {
    cap.style.removeProperty("width");
    cap.style.setProperty("max-width", `${pxToVw(imgWpx)}vw`, "important");
    return;
  }

  const relaxMult = ratio < 1.0 ? 2.5 : ratio > 2 ? 2 : 2;
  const wantedPx = Math.max(imgWpx, imgWpx * relaxMult);
  const capMaxWpx = Math.min(capCeilWpx, wantedPx);

  cap.style.removeProperty("width");
  cap.style.setProperty("max-width", `${pxToVw(capMaxWpx)}vw`, "important");
}

/* =========================
   LAYOUT ROW (vw/vh)
   ========================= */
function layoutRow(row, rootEl) {
  const imgs = Array.from(
    row.querySelectorAll("td figure.image img, td figure.cd-figure img, td > img")
  );
  if (imgs.length < 1) return;

  const items = [];
  for (const img of imgs) {
    const sz = getIntrinsicSize(img);
    if (!sz) continue;

    const ratio = sz.w / sz.h;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;

    items.push({ img, hReal: sz.h, ratio });
  }
  if (items.length < 1) return;

  const cols = items.length;
  row.setAttribute("data-cd-cols", String(cols));

  const targetW = computeTargetW(cols, rootEl) - SAFETY_PX;
  if (!targetW) return;

  const hMinReal = items.reduce((m, it) => Math.min(m, it.hReal), Infinity);
  const baseH = clamp(hMinReal, ROW_MIN_H, ROW_MAX_H);

  let hFit = Infinity;
  for (const it of items) {
    hFit = Math.min(hFit, targetW / fitRatio(it.ratio));
  }
  if (!Number.isFinite(hFit) || hFit <= 0) return;

  let H = Math.min(baseH, hFit);

  const usable = getUsableWidthFromLayout(rootEl);
  const availableRowW = Math.max(0, usable - SAFETY_PX * 2);

  const totalW =
    items.reduce((sum, it) => sum + H * it.ratio, 0) + COL_GUTTER * (cols - 1);

  if (availableRowW > 0 && totalW > availableRowW) {
    const scale = availableRowW / totalW;
    H = H * scale;
  }

  for (const it of items) {
    const W = H * it.ratio;
    setSizeVwVh(it.img, H, W);
    applyCaptionWidth(it.img, W, it.ratio, cols, rootEl);
  }
}

function layoutAllTables(rootEl) {
  const tables = rootEl.querySelectorAll(".cd-content table, table");
  tables.forEach((table) => {
    const rows = table.querySelectorAll("tr");
    rows.forEach((row) => layoutRow(row, rootEl));
  });
}

/* =========================
   Marquage des tables qui contiennent des images
   ========================= */
function markImageTables(rootEl) {
  const tables = rootEl.querySelectorAll(".cd-content table, table");
  tables.forEach((table) => {
    const hasImg = table.querySelector("td img, td figure.image img, td figure.cd-figure img");
    if (hasImg) table.classList.add("cd-imgtable");
    else table.classList.remove("cd-imgtable");
  });
}

/* =========================
   STABILISATION: attendre cd-main stable
   ========================= */
function getMainWidthSig(rootEl) {
  const main = rootEl.closest(".cd-main") || document.querySelector(".cd-main");
  const shell = rootEl.closest(".cd-shell") || document.querySelector(".cd-shell");
  const wMain = main?.getBoundingClientRect?.().width || 0;
  const wShell = shell?.getBoundingClientRect?.().width || 0;
  return `${Math.round(wMain)}|${Math.round(wShell)}|${window.innerWidth}|${window.innerHeight}`;
}

function waitForStableLayout(rootEl) {
  const start = performance.now();
  let stable = 0;
  let last = "";

  return new Promise((resolve) => {
    const tick = () => {
      const sig = getMainWidthSig(rootEl);
      if (sig === last && sig !== "0|0|0|0") stable += 1;
      else stable = 0;

      last = sig;

      if (stable >= STABLE_FRAMES_REQUIRED) return resolve();
      if (performance.now() - start > STABLE_TIMEOUT_MS) return resolve();

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });
}

/* =========================
   relayout loop
   ========================= */
function runRelayoutLoop(relayoutFn, durationMs = 420) {
  const start = performance.now();
  let rafId = 0;

  const tick = (now) => {
    relayoutFn();
    if (now - start < durationMs) rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

/* =========================
   Diagram injection helper
   ========================= */
function parseClassificationDiagramBlock(rawText) {
  const raw = String(rawText ?? "").trim();
  if (!raw.startsWith("@classificationDiagram")) return null;

  const jsonText = raw.replace(/^@classificationDiagram\s*/m, "").trim();
  if (!jsonText) return null;

  const spec = JSON.parse(jsonText);
  if (!spec || typeof spec !== "object") return null;
  return spec;
}

/* =========================
   Component (memoized)
   ========================= */
const CaseMarkdown = memo(function CaseMarkdown({ children }) {
  const containerRef = useRef(null);

  const source = useMemo(
    () => normalizeEscapedBlockquotes(String(children ?? "")),
    [children]
  );

  // ✅ stable objects to avoid rebuilding ReactMarkdown subtree unnecessarily
  const mdComponents = useMemo(
    () => ({
      code({ inline, className, children: codeChildren, ...props }) {
        const lang = String(className || "").replace("language-", "").trim();
        const raw = String(codeChildren ?? "").replace(/\n$/, "");

        // injection via bloc plaintext + @classificationDiagram + JSON
        if (!inline && lang === "plaintext") {
          try {
            const spec = parseClassificationDiagramBlock(raw);
            if (spec) return <ClassificationDiagram {...spec} />;
          } catch (e) {
            return (
              <pre style={{ whiteSpace: "pre-wrap", opacity: 0.9 }}>
                Erreur diagramme JSON: {String(e?.message || e)}
              </pre>
            );
          }
        }

        if (inline) {
          return (
            <code className={className} {...props}>
              {codeChildren}
            </code>
          );
        }

        return (
          <pre>
            <code className={className} {...props}>
              {codeChildren}
            </code>
          </pre>
        );
      },
    }),
    []
  );

  const mdRemarkPlugins = useMemo(
    () => [remarkGfm, remarkFigureCaptions, remarkObsidianCallouts],
    []
  );

  const mdRehypePlugins = useMemo(
    () => [
      rehypeRaw,
      rehypePHash5ToH5,
      [rehypeSanitize, ckeditorSchema],
      rehypeSlug,
    ],
    []
  );

  useEffect(() => {
    let cancelled = false;
    const rootEl = containerRef.current;
    if (!rootEl) return;

    const relayout = () => {
      if (cancelled) return;

      markImageTables(rootEl);

      if (isMobileNow()) {
        resetTableSizing(rootEl);
        return;
      }

      layoutAllTables(rootEl);
      layoutAllTables(rootEl);
    };

    const run = async () => {
      await waitForImagesIn(rootEl);
      if (cancelled) return;

      await waitForStableLayout(rootEl);
      if (cancelled) return;

      requestAnimationFrame(() => {
        if (!cancelled) relayout();
      });
    };

    run();

    const ro = new ResizeObserver(() => relayout());
    ro.observe(rootEl);

    const shell = rootEl.closest(".cd-shell") || document.querySelector(".cd-shell");
    const side = document.querySelector(".cd-side");
    const main = rootEl.closest(".cd-main") || document.querySelector(".cd-main");

    if (shell) ro.observe(shell);
    if (side) ro.observe(side);
    if (main) ro.observe(main);

    let stopLoop = null;
    const startLoop = () => {
      if (stopLoop) stopLoop();
      stopLoop = runRelayoutLoop(() => {
        if (!cancelled) relayout();
      }, 450);
    };

    const onTransitionRun = (e) => {
      if (cancelled) return;
      if (e.propertyName !== "width" && e.propertyName !== "grid-template-columns") return;
      startLoop();
    };

    const onTransitionEnd = (e) => {
      if (cancelled) return;
      if (e.propertyName !== "width" && e.propertyName !== "grid-template-columns") return;
      relayout();
      if (stopLoop) {
        const s = stopLoop;
        stopLoop = null;
        s();
      }
    };

    if (shell) {
      shell.addEventListener("transitionrun", onTransitionRun);
      shell.addEventListener("transitionend", onTransitionEnd);
    }
    if (side) {
      side.addEventListener("transitionrun", onTransitionRun);
      side.addEventListener("transitionend", onTransitionEnd);
    }

    let t = null;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => relayout(), 80);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      ro.disconnect();

      window.removeEventListener("resize", onResize);
      if (t) clearTimeout(t);

      if (shell) {
        shell.removeEventListener("transitionrun", onTransitionRun);
        shell.removeEventListener("transitionend", onTransitionEnd);
      }
      if (side) {
        side.removeEventListener("transitionrun", onTransitionRun);
        side.removeEventListener("transitionend", onTransitionEnd);
      }

      if (stopLoop) stopLoop();
    };
  }, [source]);

  return (
    <div ref={containerRef}>
      <ReactMarkdown
        remarkPlugins={mdRemarkPlugins}
        rehypePlugins={mdRehypePlugins}
        components={mdComponents}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});

export default CaseMarkdown;
