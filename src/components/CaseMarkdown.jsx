// src/components/CaseMarkdown.jsx
import { useEffect, useMemo, useRef, memo, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";

import { ckeditorSchema } from "../lib/markdown/ckeditorSchema";
import { remarkObsidianCallouts } from "../lib/markdown/remarkObsidianCallouts";
import { remarkFigureCaptions } from "../lib/markdown/remarkFigureCaptions";

import "./DiagnosticOrientationTable.css";

import ClassificationDiagram, {
  isHeadingDrivenClassificationDiagramSpec,
  parseClassificationDiagramHeadingTree,
  resolveHeadingDrivenClassificationDiagramSpec,
} from "./ClassificationDiagram";
import DiagnosticDiagram, {
  isDiagnosticDiagramCodeBlock,
} from "./DiagnosticDiagram";
import DefinitionGrid, {
  isDefinitionGridCodeBlock,
} from "./DefinitionGrid";
import SectorGrid, {
  isSectorGridCodeBlock,
} from "./SectorGrid";
import DiagnosticGrid, {
  isDiagnosticGridCodeBlock,
} from "./DiagnosticGrid";
import EtiologyGrid, {
  isEtiologyGridCodeBlock,
} from "./EtiologyGrid";
import ClinicalPathway, {
  isClinicalPathwayCodeBlock,
} from "./ClinicalPathway";
import PathophysiologyDiagram, {
  isPathophysiologyDiagramCodeBlock,
} from "./PathophysiologyDiagram";
import ClinicalEvolution, {
  isClinicalEvolutionCodeBlock,
} from "./ClinicalEvolution";
import ClinicalLayout, {
  isClinicalLayoutCodeBlock,
} from "./ClinicalLayout";


function appendSanitizeAttributes(schema, tagName, attributes) {
  const current = Array.isArray(schema?.attributes?.[tagName])
    ? schema.attributes[tagName]
    : [];
  const currentStrings = new Set(
    current.filter((entry) => typeof entry === "string")
  );
  const additions = attributes.filter(
    (attribute) => !currentStrings.has(attribute)
  );

  return {
    ...schema,
    attributes: {
      ...(schema?.attributes || {}),
      [tagName]: [...current, ...additions],
    },
  };
}

/*
 * Les callouts sont construits par Remark puis passent par rehype-sanitize.
 * Ces attributs permettent de conserver :
 * - la variante [!info|points-cles] ;
 * - la classe du séparateur <div class="callout-divider"></div>.
 */
const caseMarkdownSanitizeSchema = appendSanitizeAttributes(
  appendSanitizeAttributes(
    ckeditorSchema,
    "div",
    [
      "className",
      "dataCallout",
      "dataCalloutMetadata",
      "data-callout",
      "data-callout-metadata",
    ]
  ),
  "img",
  [
    "dataOdontoCite",
    "dataOdontoCredit",
    "dataOdontoCaption",
    "data-odonto-cite",
    "data-odonto-credit",
    "data-odonto-caption",
  ]
);

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

/*
 * Mesure le véritable contenu disponible pour CaseMarkdown.
 *
 * Les marges horizontales de la page sont portées par .cd-article-inner,
 * pas par .cd-main. Recalculer la largeur depuis la fenêtre et la sidebar
 * ignorait donc ces paddings et produisait des images plus larges que
 * .cd-content.
 *
 * Le div racine de CaseMarkdown est un bloc qui occupe exactement la largeur
 * disponible dans .cd-entry-body. Sa largeur reste correcte même lorsqu'un
 * tableau enfant déborde.
 */
function getContentBoxWidth(el) {
  if (!el) return 0;

  const cs = getComputedStyle(el);
  const rectW =
    el.getBoundingClientRect?.().width ||
    el.clientWidth ||
    0;

  const paddingX = px(cs.paddingLeft) + px(cs.paddingRight);
  const borderX = px(cs.borderLeftWidth) + px(cs.borderRightWidth);

  return Math.max(0, rectW - paddingX - borderX);
}

function getUsableWidthFromLayout(rootEl) {
  const candidates = [
    rootEl,
    rootEl?.closest?.(".cd-entry-body"),
    rootEl?.closest?.(".cd-content"),
    rootEl?.closest?.(".cd-article-inner"),
  ];

  for (const candidate of candidates) {
    const width = getContentBoxWidth(candidate);
    if (width > 0) return Math.max(0, width - 6);
  }

  const fallback =
    document.documentElement.clientWidth ||
    window.innerWidth ||
    0;

  return Math.max(0, fallback - 6);
}

/*
 * Réserve la place réellement prise par les paddings et bordures des cellules.
 * Sans cela, la somme des images pouvait tenir mathématiquement dans
 * .cd-content tout en faisant dépasser le tableau une fois les cellules
 * ajoutées.
 */
function getRowHorizontalOverhead(row) {
  if (!row) return 0;

  const cells = Array.from(row.children).filter((cell) => {
    const tag = String(cell?.tagName || "").toLowerCase();
    return tag === "td" || tag === "th";
  });

  let overhead = 0;

  for (const cell of cells) {
    const cs = getComputedStyle(cell);
    overhead +=
      px(cs.paddingLeft) +
      px(cs.paddingRight) +
      px(cs.borderLeftWidth) +
      px(cs.borderRightWidth);
  }

  const table = row.closest?.("table");
  if (table) {
    const tableCS = getComputedStyle(table);
    overhead +=
      px(tableCS.borderLeftWidth) +
      px(tableCS.borderRightWidth);
  }

  return overhead;
}

function computeTargetW(cols, rootEl, row = null) {
  const c = Math.max(1, Math.min(4, cols));
  const usable = getUsableWidthFromLayout(rootEl);
  if (!usable) return 0;

  const availableForImages = Math.max(
    0,
    usable - getRowHorizontalOverhead(row)
  );
  if (!availableForImages) return 0;

  const raw = availableForImages / c;
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

  const row = img.closest?.("tr");
  const fallbackW = Math.max(
    0,
    computeTargetW(cols, rootEl, row) - SAFETY_PX
  );
  const capCeilWpx =
    tdInnerW > 0 && fallbackW > 0
      ? Math.min(tdInnerW, fallbackW)
      : Math.max(tdInnerW, fallbackW);

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
    row.querySelectorAll("td img")
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

  const targetW = computeTargetW(cols, rootEl, row) - SAFETY_PX;
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
  const rowOverhead = getRowHorizontalOverhead(row);
  const availableRowW = Math.max(
    0,
    usable - rowOverhead - SAFETY_PX * 2
  );

  const totalW = items.reduce(
    (sum, it) => sum + H * it.ratio,
    0
  );

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
   Documentation — métadonnées iconographiques V22
   ========================= */
function referenceNumberForCitekey(referenceNumbers, citekey) {
  if (!referenceNumbers || !citekey) return null;
  if (referenceNumbers instanceof Map) return referenceNumbers.get(citekey) || null;
  if (typeof referenceNumbers === "object") return referenceNumbers[citekey] || null;
  return null;
}

function cleanupDocumentImageMetadata(rootEl) {
  if (!rootEl) return;
  rootEl
    .querySelectorAll(
      ".cd-doc-image-meta-generated, .cd-doc-image-generated-caption, .cd-doc-image-generated-figcaption"
    )
    .forEach((node) => node.remove());
}

function elementHasVisibleCaptionText(element) {
  if (!element) return false;
  const clone = element.cloneNode(true);
  clone
    .querySelectorAll?.(
      ".cd-doc-image-meta-generated, .cd-doc-image-generated-caption, .cd-doc-image-generated-figcaption"
    )
    .forEach((node) => node.remove());
  return Boolean(String(clone.textContent || "").trim());
}

function isLikelyStandaloneCaption(element) {
  if (!element) return false;
  if (element.tagName === "FIGCAPTION") return elementHasVisibleCaptionText(element);
  if (element.classList?.contains("clx-step-caption")) return elementHasVisibleCaptionText(element);

  if (element.tagName === "P" && !element.querySelector("img")) {
    const text = String(element.textContent || "").trim();
    if (!text) return false;

    const significantChildren = Array.from(element.children || []).filter(
      (child) => child.tagName !== "BR"
    );

    if (
      significantChildren.length > 0 &&
      significantChildren.every((child) => child.tagName === "EM" || child.tagName === "I")
    ) {
      return true;
    }
  }

  return false;
}

function imageVisualBlock(img) {
  if (!img) return null;
  const paragraph = img.closest("p");

  if (paragraph && paragraph.querySelectorAll("img").length === 1) {
    const textWithoutImage = String(paragraph.textContent || "").trim();
    if (!textWithoutImage) return paragraph;
  }

  return img;
}

function createDocumentImageReferenceLink(referenceNumber) {
  if (!referenceNumber) return null;

  const link = document.createElement("a");
  link.className = "cd-doc-image-reference-link";
  link.href = `#cd-reference-${referenceNumber}`;
  link.setAttribute("aria-label", `Voir la source ${referenceNumber}`);
  link.textContent = `[${referenceNumber}]`;
  return link;
}

function createDocumentImageCredit(credit, referenceNumber) {
  if (!credit && !referenceNumber) return null;

  const meta = document.createElement("div");
  meta.className = "cd-doc-image-credit cd-doc-image-meta-generated";

  if (credit) {
    const author = document.createElement("span");
    author.textContent = credit;
    meta.appendChild(author);
  }

  const link = createDocumentImageReferenceLink(referenceNumber);
  if (link) {
    if (credit) meta.appendChild(document.createTextNode(" "));
    meta.appendChild(link);
  }

  return meta;
}

function createFallbackCaption(caption) {
  if (!caption) return null;

  const node = document.createElement("div");
  node.className = "cd-doc-image-caption-fallback cd-doc-image-generated-caption";
  node.textContent = caption;
  return node;
}

function decorateLesionPanelImage(img, registryCaption, credit, referenceNumber) {
  // @panel lesions peut contenir plusieurs images via @gallery.
  // V22 ajoutait les crédits après la galerie entière : avec @gallery 3,
  // les trois auteurs se retrouvaient donc empilés sous la même colonne.
  //
  // V23 crée au contraire une unité visuelle PAR image et place son éventuelle
  // légende + son auteur directement dans cette unité.
  const gallery =
    img.closest(".clx-lesion-table-image .clx-image-gallery") ||
    img.closest(".clx-lesion-image.clx-image-gallery");

  if (!gallery) return false;

  let unit = img.closest(".cd-doc-lesion-image-unit");

  if (!unit || !gallery.contains(unit)) {
    unit = document.createElement("span");
    unit.className = "cd-doc-lesion-image-unit";

    const parent = img.parentNode;
    if (!parent) return false;

    parent.insertBefore(unit, img);
    unit.appendChild(img);
  }

  // Les helpers génériques créent des <div>. Dans une galerie Markdown,
  // l'image est souvent dans un <p>; on utilise ici des <span> blocs afin de
  // conserver une structure HTML propre à l'intérieur du paragraphe.
  if (registryCaption) {
    const fallback = document.createElement("span");
    fallback.className =
      "cd-doc-image-caption-fallback cd-doc-image-generated-caption";
    fallback.textContent = registryCaption;
    unit.appendChild(fallback);
  }

  if (credit || referenceNumber) {
    const meta = document.createElement("span");
    meta.className = "cd-doc-image-credit cd-doc-image-meta-generated";

    if (credit) {
      const author = document.createElement("span");
      author.textContent = credit;
      meta.appendChild(author);
    }

    const link = createDocumentImageReferenceLink(referenceNumber);
    if (link) {
      if (credit) meta.appendChild(document.createTextNode(" "));
      meta.appendChild(link);
    }

    unit.appendChild(meta);
  }

  return true;
}

function decorateOneDocumentImage(img, referenceNumbers) {
  const citekey = String(img?.dataset?.odontoCite || "").trim();
  const credit = String(img?.dataset?.odontoCredit || "").trim();
  const registryCaption = String(img?.dataset?.odontoCaption || "").trim();
  const referenceNumber = referenceNumberForCitekey(referenceNumbers, citekey);

  if (!credit && !registryCaption && !referenceNumber) return;

  // Cas particulier explicitement géré : clinicalLayout @panel lesions.
  if (decorateLesionPanelImage(img, registryCaption, credit, referenceNumber)) {
    return;
  }

  const figure = img.closest("figure");

  if (figure) {
    let caption = Array.from(figure.children || []).find(
      (child) => child.tagName === "FIGCAPTION"
    );

    if (caption) {
      const hasExistingCaption = elementHasVisibleCaptionText(caption);

      // Un @caption/@subcaption déjà présent reste toujours prioritaire.
      if (!hasExistingCaption && registryCaption) {
        const fallback = createFallbackCaption(registryCaption);
        if (fallback) caption.appendChild(fallback);
      }

      const meta = createDocumentImageCredit(credit, referenceNumber);
      if (meta) caption.appendChild(meta);
      return;
    }

    caption = document.createElement("figcaption");
    caption.className = "cd-doc-image-generated-figcaption";

    const fallback = createFallbackCaption(registryCaption);
    const meta = createDocumentImageCredit(credit, referenceNumber);

    if (fallback) caption.appendChild(fallback);
    if (meta) caption.appendChild(meta);

    if (caption.childNodes.length) {
      const imageContainer =
        img.closest(".clx-step-image") ||
        img.closest(".clx-step-image-markdown") ||
        imageVisualBlock(img);

      if (
        imageContainer &&
        imageContainer !== figure &&
        imageContainer.parentElement === figure
      ) {
        imageContainer.insertAdjacentElement("afterend", caption);
      } else {
        figure.appendChild(caption);
      }
    }
    return;
  }

  const visualBlock = imageVisualBlock(img);
  const next = visualBlock?.nextElementSibling || null;
  const existingCaption = isLikelyStandaloneCaption(next) ? next : null;
  const meta = createDocumentImageCredit(credit, referenceNumber);

  if (existingCaption) {
    if (meta) existingCaption.insertAdjacentElement("afterend", meta);
    return;
  }

  const fallback = createFallbackCaption(registryCaption);
  let cursor = visualBlock;

  if (fallback && cursor?.insertAdjacentElement) {
    cursor.insertAdjacentElement("afterend", fallback);
    cursor = fallback;
  }
  if (meta && cursor?.insertAdjacentElement) {
    cursor.insertAdjacentElement("afterend", meta);
  }
}

function decorateDocumentImages(rootEl, referenceNumbers) {
  if (!rootEl) return;
  cleanupDocumentImageMetadata(rootEl);

  rootEl
    .querySelectorAll(
      "img[data-odonto-cite], img[data-odonto-credit], img[data-odonto-caption]"
    )
    .forEach((img) => decorateOneDocumentImage(img, referenceNumbers));
}

/* =========================
   Diagram injection helper
   ========================= */
function textFromReactChildren(children) {
  if (children == null) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textFromReactChildren).join("");
  if (isValidElement(children)) return textFromReactChildren(children.props?.children);
  return "";
}

function unwrapFence(rawText) {
  let raw = String(rawText ?? "").trim();
  const fenced = raw.match(/^```([^\n`]*)\n([\s\S]*?)\n```$/);
  if (fenced) raw = String(fenced[2] || "").trim();
  return raw;
}

function renderPathophysiologyDiagramFromCode(className, codeChildren) {
  const raw = textFromReactChildren(codeChildren).replace(/\n$/, "");
  if (!isPathophysiologyDiagramCodeBlock(className, raw)) return null;
  return <PathophysiologyDiagram source={raw} />;
}

function renderDiagnosticDiagramFromCode(className, codeChildren) {
  const raw = textFromReactChildren(codeChildren).replace(/\n$/, "");
  if (!isDiagnosticDiagramCodeBlock(className, raw)) return null;
  return <DiagnosticDiagram source={raw} />;
}

function renderDefinitionGridFromCode(className, codeChildren) {
  const raw = textFromReactChildren(codeChildren).replace(/\n$/, "");
  if (!isDefinitionGridCodeBlock(className, raw)) return null;
  return <DefinitionGrid source={raw} />;
}

function renderSectorGridFromCode(className, codeChildren) {
  const raw = textFromReactChildren(codeChildren).replace(/\n$/, "");
  if (!isSectorGridCodeBlock(className, raw)) return null;
  return <SectorGrid source={raw} />;
}

function renderDiagnosticGridFromCode(className, codeChildren) {
  const raw = textFromReactChildren(codeChildren).replace(/\n$/, "");
  if (!isDiagnosticGridCodeBlock(className, raw)) return null;
  return <DiagnosticGrid source={raw} />;
}

function renderEtiologyGridFromCode(className, codeChildren) {
  const raw = textFromReactChildren(codeChildren).replace(/\n$/, "");
  if (!isEtiologyGridCodeBlock(className, raw)) return null;
  return <EtiologyGrid source={raw} />;
}

function renderClinicalPathwayFromCode(className, codeChildren) {
  const raw = textFromReactChildren(codeChildren).replace(/\n$/, "");
  if (!isClinicalPathwayCodeBlock(className, raw)) return null;
  return <ClinicalPathway source={raw} />;
}

function renderClinicalEvolutionFromCode(className, codeChildren) {
  const raw = textFromReactChildren(codeChildren).replace(/\n$/, "");
  if (!isClinicalEvolutionCodeBlock(className, raw)) return null;
  return <ClinicalEvolution source={raw} />;
}

function renderClinicalLayoutFromCode(className, codeChildren) {
  const raw = textFromReactChildren(codeChildren).replace(/\n$/, "");
  if (!isClinicalLayoutCodeBlock(className, raw)) return null;
  return <ClinicalLayout source={raw} />;
}

function parseClassificationDiagramBlock(rawText) {
  let raw = unwrapFence(rawText);
  if (!raw) return null;

  if (raw.startsWith("@classificationDiagram")) {
    raw = raw.replace(/^@classificationDiagram\s*/m, "").trim();
  }

  if (!raw.startsWith("{")) return null;

  const spec = JSON.parse(raw);
  if (!spec || typeof spec !== "object") return null;
  return spec;
}

function isClassificationDiagramBlock(className, rawText) {
  const lang = String(className || "")
    .toLowerCase()
    .replace(/^language-/, "")
    .trim();

  const raw = unwrapFence(rawText);

  return lang === "classificationdiagram" || raw.startsWith("@classificationDiagram");
}

function renderClassificationDiagramFromCode(
  className,
  codeChildren,
  scopeKey,
  headingTree,
  specCache
) {
  const raw = textFromReactChildren(codeChildren).replace(/\n$/, "");
  if (!isClassificationDiagramBlock(className, raw)) return null;

  let resolved = specCache?.get(raw);
  if (!resolved) {
    const spec = parseClassificationDiagramBlock(raw);
    if (!spec) return null;

    resolved = isHeadingDrivenClassificationDiagramSpec(spec)
      ? resolveHeadingDrivenClassificationDiagramSpec(spec, headingTree)
      : spec;

    specCache?.set(raw, resolved);
  }

  return <ClassificationDiagram {...resolved} scopeKey={scopeKey} />;
}

/* =========================
   Component (memoized)
   ========================= */
const CaseMarkdown = memo(function CaseMarkdown({ children, scopeKey = "", referenceNumbers = null }) {
  const containerRef = useRef(null);

  const source = useMemo(
    () => normalizeEscapedBlockquotes(String(children ?? "")),
    [children]
  );

  const diagramHeadingTree = useMemo(() => {
    const usesHeadingDrivenDiagram =
      /["']source["']\s*:\s*["']headings["']/.test(source) &&
      (source.includes("@classificationDiagram") || /```\s*classificationdiagram\b/i.test(source));
    return usesHeadingDrivenDiagram ? parseClassificationDiagramHeadingTree(source) : [];
  }, [source]);

  const diagramSpecCache = useMemo(() => new Map(), [source, diagramHeadingTree]);

  const mdComponents = useMemo(
    () => ({
      pre({ children: preChildren, ...props }) {
        const onlyChild = Array.isArray(preChildren) ? preChildren[0] : preChildren;

        if (isValidElement(onlyChild)) {
          const clinicalLayout = renderClinicalLayoutFromCode(
            onlyChild.props?.className,
            onlyChild.props?.children
          );
          if (clinicalLayout) return clinicalLayout;

          const clinicalEvolution = renderClinicalEvolutionFromCode(
            onlyChild.props?.className,
            onlyChild.props?.children
          );
          if (clinicalEvolution) return clinicalEvolution;

          const clinicalPathway = renderClinicalPathwayFromCode(
            onlyChild.props?.className,
            onlyChild.props?.children
          );
          if (clinicalPathway) return clinicalPathway;

          const pathophysiologyDiagram = renderPathophysiologyDiagramFromCode(
            onlyChild.props?.className,
            onlyChild.props?.children
          );
          if (pathophysiologyDiagram) return pathophysiologyDiagram;

          const etiologyGrid = renderEtiologyGridFromCode(
            onlyChild.props?.className,
            onlyChild.props?.children
          );
          if (etiologyGrid) return etiologyGrid;

          const diagnosticGrid = renderDiagnosticGridFromCode(
            onlyChild.props?.className,
            onlyChild.props?.children
          );
          if (diagnosticGrid) return diagnosticGrid;

          const sectorGrid = renderSectorGridFromCode(
            onlyChild.props?.className,
            onlyChild.props?.children
          );
          if (sectorGrid) return sectorGrid;

          const definitionGrid = renderDefinitionGridFromCode(
            onlyChild.props?.className,
            onlyChild.props?.children
          );
          if (definitionGrid) return definitionGrid;

          const diagnosticDiagram = renderDiagnosticDiagramFromCode(
            onlyChild.props?.className,
            onlyChild.props?.children
          );
          if (diagnosticDiagram) return diagnosticDiagram;

          try {
            const diagram = renderClassificationDiagramFromCode(
              onlyChild.props?.className,
              onlyChild.props?.children,
              scopeKey,
              diagramHeadingTree,
              diagramSpecCache
            );
            if (diagram) return diagram;
          } catch (e) {
            return (
              <pre style={{ whiteSpace: "pre-wrap", opacity: 0.9 }}>
                Erreur diagramme JSON: {String(e?.message || e)}
              </pre>
            );
          }
        }

        return <pre {...props}>{preChildren}</pre>;
      },

      code({ inline, className, children: codeChildren, node, ...props }) {
        if (!inline) {
          const clinicalLayout = renderClinicalLayoutFromCode(
            className,
            codeChildren
          );
          if (clinicalLayout) return clinicalLayout;

          const clinicalEvolution = renderClinicalEvolutionFromCode(
            className,
            codeChildren
          );
          if (clinicalEvolution) return clinicalEvolution;

          const clinicalPathway = renderClinicalPathwayFromCode(
            className,
            codeChildren
          );
          if (clinicalPathway) return clinicalPathway;

          const pathophysiologyDiagram = renderPathophysiologyDiagramFromCode(
            className,
            codeChildren
          );
          if (pathophysiologyDiagram) return pathophysiologyDiagram;

          const etiologyGrid = renderEtiologyGridFromCode(
            className,
            codeChildren
          );
          if (etiologyGrid) return etiologyGrid;

          const diagnosticGrid = renderDiagnosticGridFromCode(
            className,
            codeChildren
          );
          if (diagnosticGrid) return diagnosticGrid;

          const sectorGrid = renderSectorGridFromCode(
            className,
            codeChildren
          );
          if (sectorGrid) return sectorGrid;

          const definitionGrid = renderDefinitionGridFromCode(
            className,
            codeChildren
          );
          if (definitionGrid) return definitionGrid;

          const diagnosticDiagram = renderDiagnosticDiagramFromCode(
            className,
            codeChildren
          );
          if (diagnosticDiagram) return diagnosticDiagram;

          try {
            const diagram = renderClassificationDiagramFromCode(
              className,
              codeChildren,
              scopeKey,
              diagramHeadingTree,
              diagramSpecCache
            );
            if (diagram) return diagram;
          } catch (e) {
            return (
              <code className={className} {...props}>
                Erreur diagramme JSON: {String(e?.message || e)}
              </code>
            );
          }
        }

        return (
          <code className={className} {...props}>
            {codeChildren}
          </code>
        );
      },
    }),
    [scopeKey, diagramHeadingTree, diagramSpecCache]
  );

  const mdRemarkPlugins = useMemo(
    () => [remarkGfm, remarkFigureCaptions, remarkObsidianCallouts],
    []
  );

  const mdRehypePlugins = useMemo(
    () => [
      rehypeRaw,
      rehypePHash5ToH5,
      [rehypeSanitize, caseMarkdownSanitizeSchema],
      rehypeSlug,
    ],
    []
  );

  useEffect(() => {
    const rootEl = containerRef.current;
    if (!rootEl) return undefined;

    decorateDocumentImages(rootEl, referenceNumbers);

    return () => {
      cleanupDocumentImageMetadata(rootEl);
    };
  }, [source, referenceNumbers]);

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
