// src/lib/markdown/remarkFigureCaptions.js

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[&<>"]/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    return "&quot;";
  });
}

function isCalloutStart(blockquoteNode) {
  if (!blockquoteNode || blockquoteNode.type !== "blockquote") return false;
  const firstParagraph = blockquoteNode.children?.[0];
  const firstChild = firstParagraph?.children?.[0];
  if (!firstParagraph || firstParagraph.type !== "paragraph") return false;
  if (!firstChild || firstChild.type !== "text") return false;
  return /^\s*\[\!(\w+)\]([+-])?\s*(.*?)\s*$/i.test(firstChild.value);
}

// Extraction texte "simple" (on ignore la mise en forme Markdown dans la caption)
function extractText(node) {
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node.type === "text") return node.value || "";
  if (node.type === "break") return "\n";
  if (node.children) return extractText(node.children);
  return "";
}

// Règle de sécurité (optionnelle) pour le cas "image seule"
function looksLikeCaptionText(s) {
  return /^(figure|fig\.|caption)\b/i.test((s || "").trim());
}

function paragraphIsOnlyImage(p) {
  return (
    p &&
    p.type === "paragraph" &&
    Array.isArray(p.children) &&
    p.children.length === 1 &&
    p.children[0]?.type === "image"
  );
}

/** Détecte un bloc HTML qui est un <table> contenant des <img> */
function htmlIsImageTable(node) {
  if (!node || node.type !== "html") return false;
  const v = String(node.value || "");
  return /<table[\s>]/i.test(v) && /<\/table>/i.test(v) && /<img\b/i.test(v);
}

/** Pour les tableaux: on accepte tout blockquote non-callout comme caption (si non vide) */
function looksLikeGroupCaptionText(s) {
  return Boolean((s || "").trim());
}

export function remarkFigureCaptions() {
  return (tree) => {
    function walk(parent) {
      if (!parent || !Array.isArray(parent.children)) return;

      for (let i = 0; i < parent.children.length; i++) {
        const node = parent.children[i];

        // récursif (listes, etc.)
        if (node && Array.isArray(node.children)) walk(node);

        // =========================
        // CAS 1: image seule + blockquote(s) = figcaption
        // =========================
        if (paragraphIsOnlyImage(node)) {
          let j = i + 1;
          const captionNodes = [];

          while (j < parent.children.length) {
            const sib = parent.children[j];
            if (!sib || sib.type !== "blockquote") break;
            if (isCalloutStart(sib)) break;

            const txt = extractText(sib).trim();
            if (!looksLikeCaptionText(txt)) break;

            captionNodes.push(sib);
            j++;
          }

          if (captionNodes.length === 0) continue;

          const img = node.children[0];
          const src = escapeHtml(String(img.url || ""));
          const alt = escapeHtml(String(img.alt || ""));
          const title = img.title ? escapeHtml(String(img.title)) : "";

          const captionText = captionNodes
            .map((bq) => extractText(bq).trim())
            .filter(Boolean)
            .join("\n");

          const figcaptionHtml = `<figcaption class="cd-figcaption">${escapeHtml(
            captionText
          )}</figcaption>`;
          const titleAttr = title ? ` title="${title}"` : "";

          const figureHtml =
            `<figure class="cd-figure">` +
            `<img src="${src}" alt="${alt}"${titleAttr} loading="lazy" />` +
            figcaptionHtml +
            `</figure>`;

          parent.children[i] = { type: "html", value: figureHtml };
          parent.children.splice(i + 1, captionNodes.length);
          continue;
        }

        // =========================
        // CAS 2: <table> (HTML) + blockquote = caption de groupe
        // =========================
        if (htmlIsImageTable(node)) {
          let j = i + 1;
          const captionNodes = [];

          while (j < parent.children.length) {
            const sib = parent.children[j];
            if (!sib || sib.type !== "blockquote") break;
            if (isCalloutStart(sib)) break;

            const txt = extractText(sib).trim();
            if (!looksLikeGroupCaptionText(txt)) break;

            captionNodes.push(sib);
            j++;
          }

          if (captionNodes.length === 0) continue;

          const captionText = captionNodes
            .map((bq) => extractText(bq).trim())
            .filter(Boolean)
            .join("\n");

          const figcaptionHtml = `<figcaption class="cd-figcaption">${escapeHtml(
            captionText
          )}</figcaption>`;

          // node.value contient déjà ton <table>...</table>
          const groupFigureHtml =
            `<figure class="cd-figure cd-figure-group">` +
            `${String(node.value || "")}` +
            figcaptionHtml +
            `</figure>`;

          parent.children[i] = { type: "html", value: groupFigureHtml };
          parent.children.splice(i + 1, captionNodes.length);
          continue;
        }
      }
    }

    walk(tree);
  };
}
