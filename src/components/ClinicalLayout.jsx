import { memo, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

import "./ClinicalLayout.css";

export class ClinicalLayoutParseError extends Error {
  constructor(message, lineNumber = null) {
    super(message);
    this.name = "ClinicalLayoutParseError";
    this.lineNumber = lineNumber;
  }
}

const PANEL_TYPES = new Set(["grid", "steps", "comparison", "profiles", "media", "lesions", "matrix", "gallery", "shared"]);

function cleanTitle(value) {
  return String(value || "").trim();
}

function unwrapFence(rawText) {
  let raw = String(rawText ?? "").trim();
  const fenced = raw.match(/^```([^\n`]*)\n([\s\S]*?)\n```$/);
  if (fenced) raw = String(fenced[2] || "").trim();
  return raw;
}

function stripOptionalDirective(rawText) {
  return unwrapFence(rawText)
    .replace(/^@clinicalLayout\s*/i, "")
    .trim();
}

export function isClinicalLayoutCodeBlock(language = "", source = "") {
  const lang = String(language || "")
    .toLowerCase()
    .replace(/^language-/, "")
    .trim();
  const raw = unwrapFence(source);

  return lang === "clinicallayout" || /^@clinicalLayout\b/i.test(raw);
}

function createTextBlock() {
  return [];
}

function appendLine(target, rawLine) {
  if (!Array.isArray(target)) return;
  const line = String(rawLine || "").replace(/[ \t]+$/g, "");

  if (!line.trim()) {
    if (target.length > 0 && target[target.length - 1] !== "") target.push("");
    return;
  }

  target.push(line);
}

function markdownFromLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .join("\n")
    .replace(/^\s+|\s+$/g, "");
}


function splitJoinedBody(lines) {
  const source = markdownFromLines(lines).replace(/\r\n?/g, "\n").trim();
  if (!source) return { lead: "", rest: "" };

  const parts = source
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  const lead = parts.shift() || "";
  const rest = parts.join("\n\n").trim();
  return { lead, rest };
}

function JoinedComparisonPanel({ panel }) {
  const columns = Math.max(1, Number(panel.columns) || panel.items.length || 1);
  const tableStyle = { "--clx-columns": String(columns) };
  const cells = [];
  const joinedRowCount = 3;

  const pushCell = (content, kind, rowIndex, colIndex) => {
    const empty = content === null || content === undefined;
    const classes = [
      "clx-joined-cell",
      `clx-joined-${kind}`,
      colIndex === 0 ? "clx-joined-first-col" : "",
      rowIndex === 0 ? "clx-joined-first-row" : "",
    ].filter(Boolean).join(" ");

    cells.push(
      <div
        className={classes}
        data-item-index={String(colIndex)}
        data-row-index={String(rowIndex)}
        data-empty={empty ? "true" : "false"}
        style={{ "--clx-mobile-order": String(colIndex * joinedRowCount + rowIndex) }}
        key={`${kind}-${rowIndex}-${colIndex}`}
      >
        {content}
      </div>
    );
  };

  panel.items.forEach((item, colIndex) => {
    pushCell(<div className="clx-item-title" role="heading" aria-level="4">{item.title}</div>, "title", 0, colIndex);
  });
  panel.items.forEach((item, colIndex) => {
    const { lead } = splitJoinedBody(item.body);
    pushCell(lead ? <MarkdownBlock source={lead} className="clx-joined-lead-markdown" /> : null, "meta", 1, colIndex);
  });
  panel.items.forEach((item, colIndex) => {
    const { rest } = splitJoinedBody(item.body);
    pushCell(rest ? <MarkdownBlock source={rest} className="clx-joined-body-markdown" /> : null, "body", 2, colIndex);
  });

  return <div className="clx-joined-table" data-columns={String(columns)} style={tableStyle}>{cells}</div>;
}

function normalizeColumns(value, fallback = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(4, Math.floor(number)));
}

function normalizeFieldKey(value) {
  return cleanTitle(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");
}

function ensureItemField(item, label) {
  const cleanLabel = cleanTitle(label);
  const key = normalizeFieldKey(cleanLabel);
  if (!key) return null;
  if (!item.fields[key]) {
    item.fields[key] = createTextBlock();
    item.fieldLabels[key] = cleanLabel;
    item.fieldOrder.push(key);
  }
  return item.fields[key];
}

function itemFieldSource(item, label) {
  const key = normalizeFieldKey(label);
  const custom = markdownFromLines(item?.fields?.[key]);
  if (custom) return custom;
  if (key === normalizeFieldKey("Définition")) {
    return markdownFromLines(item?.definition) || markdownFromLines(item?.body);
  }
  if (key === normalizeFieldKey("Orientation diagnostique")) {
    return markdownFromLines(item?.orientation);
  }
  return "";
}

function resolvePanelRows(panel) {
  const explicit = (Array.isArray(panel?.rowLabels) ? panel.rowLabels : [])
    .map(cleanTitle)
    .filter(Boolean);
  if (explicit.length) return [...new Set(explicit)];

  const rows = [];
  const seen = new Set();
  for (const item of panel?.items || []) {
    for (const key of item.fieldOrder || []) {
      const label = item.fieldLabels?.[key] || key;
      const normalized = normalizeFieldKey(label);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        rows.push(label);
      }
    }
  }

  const hasLegacyDefinition = (panel?.items || []).some(
    (item) => Boolean(markdownFromLines(item.definition) || markdownFromLines(item.body))
  );
  const hasLegacyOrientation = (panel?.items || []).some(
    (item) => Boolean(markdownFromLines(item.orientation))
  );
  if (hasLegacyDefinition && !seen.has(normalizeFieldKey("Définition"))) rows.unshift("Définition");
  if (hasLegacyOrientation && !seen.has(normalizeFieldKey("Orientation diagnostique"))) {
    rows.push("Orientation diagnostique");
  }
  return rows;
}

function createPanel(type, title, lineNumber) {
  return {
    type,
    title,
    columns: type === "steps" ? 3 : 2,
    ratio: [65, 35],
    matrixDirection: "columns",
    intro: createTextBlock(),
    rowLabels: [],
    itemLabel: type === "lesions" ? "Lésion" : "Élément",
    joined: false,
    sharedTitle: "Contenu commun",
    sharedBody: createTextBlock(),
    items: [],
    lineNumber,
  };
}

export function parseClinicalLayoutSource(source) {
  const result = {
    label: "Données cliniques structurées",
    intro: createTextBlock(),
    footer: createTextBlock(),
    panels: [],
  };

  const lines = stripOptionalDirective(source)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  let currentPanel = null;
  let currentItem = null;
  let currentTarget = null;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = String(rawLine || "").trim();

    if (/^<!--.*-->$/.test(trimmed)) return;

    if (!trimmed) {
      if (currentTarget) appendLine(currentTarget, rawLine);
      return;
    }

    const labelMatch = trimmed.match(/^@label\s+(.+)$/i);
    if (labelMatch) {
      result.label = cleanTitle(labelMatch[1]) || result.label;
      currentTarget = null;
      return;
    }

    if (/^@intro\s*$/i.test(trimmed)) {
      currentPanel = null;
      currentItem = null;
      currentTarget = result.intro;
      return;
    }

    if (/^@footer\s*$/i.test(trimmed)) {
      currentPanel = null;
      currentItem = null;
      currentTarget = result.footer;
      return;
    }

    const panelMatch = trimmed.match(/^@panel\s+(grid|steps|comparison|profiles|media|lesions|matrix|gallery|shared)(?:\s+(.+))?$/i);
    if (panelMatch) {
      const type = panelMatch[1].toLowerCase();
      const title = cleanTitle(panelMatch[2] || "");
      const panel = createPanel(type, title, lineNumber);
      result.panels.push(panel);
      currentPanel = panel;
      currentItem = null;
      currentTarget = null;
      return;
    }

    if (/^@joined\s*$/i.test(trimmed)) {
      if (!currentPanel || !["comparison", "profiles"].includes(currentPanel.type)) {
        throw new ClinicalLayoutParseError(" doit suivre un  comparison ou profiles.", lineNumber);
      }
      currentPanel.joined = true;
      currentTarget = null;
      return;
    }

    const columnsMatch = trimmed.match(/^@columns\s+([1-4])$/i);
    if (columnsMatch) {
      if (!currentPanel) {
        throw new ClinicalLayoutParseError("@columns doit suivre un @panel.", lineNumber);
      }
      currentPanel.columns = normalizeColumns(columnsMatch[1], currentPanel.columns);
      currentTarget = null;
      return;
    }

    const matrixDirectionMatch = trimmed.match(/^@matrixDirection\s+(columns|rows)$/i);
    if (matrixDirectionMatch) {
      if (!currentPanel || currentPanel.type !== "matrix") {
        throw new ClinicalLayoutParseError("@matrixDirection doit suivre un @panel matrix.", lineNumber);
      }
      currentPanel.matrixDirection = matrixDirectionMatch[1].toLowerCase();
      currentTarget = null;
      return;
    }

    const itemLabelMatch = trimmed.match(/^@itemLabel\s+(.+)$/i);
    if (itemLabelMatch) {
      if (!currentPanel || !["lesions", "matrix"].includes(currentPanel.type)) {
        throw new ClinicalLayoutParseError("@itemLabel doit suivre un @panel lesions ou matrix.", lineNumber);
      }
      currentPanel.itemLabel = cleanTitle(itemLabelMatch[1]) || currentPanel.itemLabel;
      currentTarget = null;
      return;
    }

    if (/^@rows\s*$/i.test(trimmed)) {
      if (!currentPanel || !["lesions", "matrix"].includes(currentPanel.type)) {
        throw new ClinicalLayoutParseError("@rows doit suivre un @panel lesions ou matrix.", lineNumber);
      }
      currentItem = null;
      currentTarget = currentPanel.rowLabels;
      return;
    }

    const ratioMatch = trimmed.match(/^@ratio\s+(\d+(?:[.,]\d+)?)\s*[:/]\s*(\d+(?:[.,]\d+)?)$/i);
    if (ratioMatch) {
      if (!currentPanel || currentPanel.type !== "media") {
        throw new ClinicalLayoutParseError("@ratio doit suivre un @panel media.", lineNumber);
      }
      const main = Number(String(ratioMatch[1]).replace(",", "."));
      const side = Number(String(ratioMatch[2]).replace(",", "."));
      if (!(main > 0) || !(side > 0)) {
        throw new ClinicalLayoutParseError("@ratio attend deux valeurs positives, par exemple 65:35.", lineNumber);
      }
      currentPanel.ratio = [main, side];
      currentTarget = null;
      return;
    }

    if (/^@panelIntro\s*$/i.test(trimmed)) {
      if (!currentPanel) {
        throw new ClinicalLayoutParseError("@panelIntro doit suivre un @panel.", lineNumber);
      }
      currentItem = null;
      currentTarget = currentPanel.intro;
      return;
    }

    const sharedTitleMatch = trimmed.match(/^@sharedTitle\s+(.+)$/i);
    if (sharedTitleMatch) {
      if (!currentPanel || currentPanel.type !== "shared") {
        throw new ClinicalLayoutParseError("@sharedTitle doit suivre un @panel shared.", lineNumber);
      }
      currentPanel.sharedTitle = cleanTitle(sharedTitleMatch[1]) || currentPanel.sharedTitle;
      currentItem = null;
      currentTarget = null;
      return;
    }

    if (/^@shared\s*$/i.test(trimmed)) {
      if (!currentPanel || currentPanel.type !== "shared") {
        throw new ClinicalLayoutParseError("@shared doit suivre un @panel shared.", lineNumber);
      }
      currentItem = null;
      currentTarget = currentPanel.sharedBody;
      return;
    }

    const figureMatch = trimmed.match(/^@figure(?:H([2-6]))?(?:\s+(.+))?$/i);
    if (figureMatch) {
      if (!currentPanel || currentPanel.type !== "gallery") {
        throw new ClinicalLayoutParseError("@figure ou @figureH4 doit suivre un @panel gallery.", lineNumber);
      }
      const headingLevel = figureMatch[1] ? Number(figureMatch[1]) : null;
      const explicitTitle = cleanTitle(figureMatch[2] || "");
      if (headingLevel && !explicitTitle) {
        throw new ClinicalLayoutParseError(
          `@figureH${headingLevel} doit être suivi d’un titre.`,
          lineNumber
        );
      }
      if (!headingLevel && explicitTitle) {
        throw new ClinicalLayoutParseError(
          "Utilise @figureH4 Titre pour afficher un titre au-dessus d’une image.",
          lineNumber
        );
      }
      const item = {
        title: explicitTitle || `Illustration ${currentPanel.items.length + 1}`,
        headingLevel,
        layout: "compact",
        body: createTextBlock(),
        image: createTextBlock(),
        caption: createTextBlock(),
        definition: createTextBlock(),
        orientation: createTextBlock(),
        fields: {},
        fieldLabels: {},
        fieldOrder: [],
        galleryColumns: 1,
        connector: "",
        lineNumber,
      };
      currentPanel.items.push(item);
      currentItem = item;
      currentTarget = item.image;
      return;
    }

    const itemMatch = trimmed.match(/^@(item|step)(?:H([2-6]))?\s+(.+)$/i);
    if (itemMatch) {
      if (!currentPanel) {
        throw new ClinicalLayoutParseError("@item, @itemH4, @step ou @stepH4 doit suivre un @panel.", lineNumber);
      }
      const directive = itemMatch[1].toLowerCase();
      const headingLevel = itemMatch[2] ? Number(itemMatch[2]) : null;
      if (currentPanel.type === "steps" && directive !== "step") {
        throw new ClinicalLayoutParseError("Utilise @step ou @stepH4 dans un panneau de type steps.", lineNumber);
      }
      if (currentPanel.type !== "steps" && directive !== "item") {
        throw new ClinicalLayoutParseError("Utilise @item ou @itemH4 dans ce type de panneau.", lineNumber);
      }
      const title = cleanTitle(itemMatch[3]);
      if (!title) {
        throw new ClinicalLayoutParseError(`@${directive}${headingLevel ? `H${headingLevel}` : ""} doit être suivi d’un titre.`, lineNumber);
      }
      const item = {
        title,
        headingLevel,
        layout: "compact",
        body: createTextBlock(),
        image: createTextBlock(),
        caption: createTextBlock(),
        definition: createTextBlock(),
        orientation: createTextBlock(),
        fields: {},
        fieldLabels: {},
        fieldOrder: [],
        galleryColumns: 1,
        connector: "",
        lineNumber,
      };
      currentPanel.items.push(item);
      currentItem = item;
      currentTarget = item.body;
      return;
    }

    const galleryMatch = trimmed.match(/^@gallery\s+([1-4])$/i);
    if (galleryMatch) {
      if (!currentPanel || currentPanel.type !== "lesions" || !currentItem) {
        throw new ClinicalLayoutParseError("@gallery doit suivre un @item dans un panneau lesions.", lineNumber);
      }
      currentItem.galleryColumns = normalizeColumns(galleryMatch[1], 1);
      currentTarget = currentItem.image;
      return;
    }

    if (/^@image\s*$/i.test(trimmed)) {
      if (!currentPanel || !["lesions", "steps", "gallery"].includes(currentPanel.type) || !currentItem) {
        throw new ClinicalLayoutParseError("@image doit suivre un élément compatible dans un panneau lesions, steps ou gallery.", lineNumber);
      }
      currentTarget = currentItem.image;
      return;
    }

    const captionMatch = trimmed.match(/^@caption(?:\s+(.+))?$/i);
    if (captionMatch) {
      if (!currentPanel || !["steps", "gallery"].includes(currentPanel.type) || !currentItem) {
        throw new ClinicalLayoutParseError("@caption doit suivre une image dans un panneau steps ou gallery.", lineNumber);
      }
      currentTarget = currentItem.caption;
      const inlineCaption = cleanTitle(captionMatch[1] || "");
      if (inlineCaption) appendLine(currentTarget, inlineCaption);
      return;
    }

    if (/^@definition\s*$/i.test(trimmed)) {
      if (!currentPanel || currentPanel.type !== "lesions" || !currentItem) {
        throw new ClinicalLayoutParseError("@definition doit suivre un @item dans un panneau lesions.", lineNumber);
      }
      currentTarget = currentItem.definition;
      return;
    }

    if (/^@orientation\s*$/i.test(trimmed)) {
      if (!currentPanel || currentPanel.type !== "lesions" || !currentItem) {
        throw new ClinicalLayoutParseError("@orientation doit suivre un @item dans un panneau lesions.", lineNumber);
      }
      currentTarget = currentItem.orientation;
      return;
    }

    const fieldMatch = trimmed.match(/^@field\s+(.+)$/i);
    if (fieldMatch) {
      if (!currentPanel || !["lesions", "matrix"].includes(currentPanel.type) || !currentItem) {
        throw new ClinicalLayoutParseError("@field doit suivre un @item dans un panneau lesions ou matrix.", lineNumber);
      }
      const fieldTarget = ensureItemField(currentItem, fieldMatch[1]);
      if (!fieldTarget) {
        throw new ClinicalLayoutParseError("@field doit être suivi d’un intitulé.", lineNumber);
      }
      currentTarget = fieldTarget;
      return;
    }

    const connectorMatch = trimmed.match(/^@connector\s+(.+)$/i);
    if (connectorMatch) {
      if (!currentPanel || currentPanel.type !== "steps" || !currentItem) {
        throw new ClinicalLayoutParseError("@connector doit suivre un @step dans un panneau steps.", lineNumber);
      }
      currentItem.connector = cleanTitle(connectorMatch[1]);
      if (!currentItem.connector) {
        throw new ClinicalLayoutParseError("@connector doit être suivi d’un libellé.", lineNumber);
      }
      currentTarget = currentItem.body;
      return;
    }

    const layoutMatch = trimmed.match(/^@layout\s+(wide|compact)$/i);
    if (layoutMatch) {
      if (!currentItem) {
        throw new ClinicalLayoutParseError("@layout doit suivre un @item ou un @step.", lineNumber);
      }
      currentItem.layout = layoutMatch[1].toLowerCase();
      currentTarget = currentItem.body;
      return;
    }

    if (/^@/.test(trimmed)) {
      throw new ClinicalLayoutParseError(`Directive inconnue : ${trimmed}`, lineNumber);
    }

    if (!currentTarget) {
      throw new ClinicalLayoutParseError(
        "Cette ligne doit suivre @intro, @footer, @panelIntro, @item ou @step.",
        lineNumber
      );
    }

    appendLine(currentTarget, rawLine);
  });

  const hasIntro = Boolean(markdownFromLines(result.intro));
  const hasFooter = Boolean(markdownFromLines(result.footer));
  if (!hasIntro && !hasFooter && result.panels.length === 0) {
    throw new ClinicalLayoutParseError("Ajoute au moins un @intro ou un @panel.");
  }

  result.panels.forEach((panel) => {
    if (!PANEL_TYPES.has(panel.type)) {
      throw new ClinicalLayoutParseError(`Type de panneau inconnu : ${panel.type}`, panel.lineNumber);
    }
    if (!panel.items.length) {
      throw new ClinicalLayoutParseError(
        `Le panneau « ${panel.title || panel.type} » doit contenir au moins un ${panel.type === "steps" ? "@step" : "@item"}.`,
        panel.lineNumber
      );
    }
    if (panel.type === "media" && panel.items.length !== 2) {
      throw new ClinicalLayoutParseError(
        `Le panneau média « ${panel.title || "sans titre"} » doit contenir exactement deux @item : le contenu puis l’illustration.`,
        panel.lineNumber
      );
    }
    if (panel.type === "shared" && !markdownFromLines(panel.sharedBody)) {
      throw new ClinicalLayoutParseError(
        `Le panneau partagé « ${panel.title || "sans titre"} » doit contenir un bloc @shared.`,
        panel.lineNumber
      );
    }
    panel.items.forEach((item) => {
      if (panel.type === "lesions") {
        const rows = resolvePanelRows(panel);
        const hasFieldContent = rows.some((row) => Boolean(itemFieldSource(item, row)));
        if (!hasFieldContent) {
          throw new ClinicalLayoutParseError(`Ajoute au moins un @field à l’élément « ${item.title} ».`, item.lineNumber);
        }
        return;
      }
      if (panel.type === "matrix") {
        const rows = resolvePanelRows(panel);
        const hasFieldContent = rows.some((row) => Boolean(itemFieldSource(item, row)));
        if (!hasFieldContent) {
          throw new ClinicalLayoutParseError(`Ajoute au moins un @field à l’élément « ${item.title} ».`, item.lineNumber);
        }
        return;
      }
      if (panel.type === "steps") {
        if (!markdownFromLines(item.body) && !markdownFromLines(item.image)) {
          throw new ClinicalLayoutParseError(`L’étape « ${item.title} » doit contenir du texte ou une @image.`, item.lineNumber);
        }
        return;
      }
      if (panel.type === "gallery") {
        if (!markdownFromLines(item.image)) {
          throw new ClinicalLayoutParseError(`Ajoute une image à l’illustration ${panel.items.indexOf(item) + 1}.`, item.lineNumber);
        }
        return;
      }
      if (panel.type === "shared") {
        if (!markdownFromLines(item.body)) {
          throw new ClinicalLayoutParseError(`L’élément « ${item.title} » doit contenir une description.`, item.lineNumber);
        }
        return;
      }
      if (!markdownFromLines(item.body)) {
        throw new ClinicalLayoutParseError(`L’élément « ${item.title} » est vide.`, item.lineNumber);
      }
    });
  });

  return result;
}

function MarkdownBlock({ source, className = "" }) {
  if (!source) return null;
  return (
    <div className={`clx-markdown ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{source}</ReactMarkdown>
    </div>
  );
}

function ItemHeading({ item, className, defaultLevel = 4 }) {
  const explicitLevel = Number(item?.headingLevel);
  const hasExplicitLevel = explicitLevel >= 2 && explicitLevel <= 6;
  const level = hasExplicitLevel ? explicitLevel : defaultLevel;

  if (hasExplicitLevel) {
    const HeadingTag = `h${level}`;
    return (
      <HeadingTag
        className={className}
        data-clx-heading-title={item.title}
      >
        {item.title}
      </HeadingTag>
    );
  }

  return (
    <div className={className} role="heading" aria-level={String(level)}>
      {item.title}
    </div>
  );
}

function StepFigure({ item }) {
  const imageSource = markdownFromLines(item.image);
  if (!imageSource) return null;
  const captionSource = markdownFromLines(item.caption);

  return (
    <figure className="clx-step-figure">
      <div className="clx-step-image">
        <MarkdownBlock source={imageSource} className="clx-step-image-markdown" />
      </div>
      {captionSource ? (
        <figcaption className="clx-step-caption">
          <MarkdownBlock source={captionSource} className="clx-step-caption-markdown" />
        </figcaption>
      ) : null}
    </figure>
  );
}

function LesionImageBlock({ item, className = "" }) {
  const source = markdownFromLines(item.image);
  if (!source) return null;
  return (
    <div
      className={`clx-markdown clx-image-gallery ${className}`.trim()}
      data-gallery-columns={String(item.galleryColumns || 1)}
      style={{ "--clx-gallery-columns": String(item.galleryColumns || 1) }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{source}</ReactMarkdown>
    </div>
  );
}

function ItemCard({ item, panelType, index, panel = null }) {
  const hasStepImage = panelType === "steps" && Boolean(markdownFromLines(item.image));
  const classes = [
    "clx-item",
    `clx-item-${panelType}`,
    item.layout === "wide" ? "clx-item-wide" : "clx-item-compact",
    hasStepImage ? "clx-item-has-media" : "",
  ].filter(Boolean).join(" ");

  if (panelType === "steps") {
    return (
      <article className={classes}>
        <div className="clx-step-header">
          <div className="clx-step-number" aria-hidden="true">{index + 1}</div>
          <ItemHeading item={item} className="clx-step-title" />
        </div>
        <MarkdownBlock source={markdownFromLines(item.body)} className="clx-step-body" />
        <StepFigure item={item} />
      </article>
    );
  }

  if (panelType === "lesions") {
    const rows = resolvePanelRows(panel).filter((label) => Boolean(itemFieldSource(item, label)));
    return (
      <article className={classes}>
        <ItemHeading item={item} className="clx-item-title" />
        <LesionImageBlock item={item} className="clx-lesion-image" />
        <div className="clx-lesion-content">
          {rows.map((label, rowIndex) => (
            <section
              className={`clx-lesion-section${normalizeFieldKey(label) === normalizeFieldKey("Orientation diagnostique") ? " clx-lesion-orientation" : ""}`}
              key={`${item.title}-${label}-${rowIndex}`}
            >
              <div className="clx-lesion-label">{label}</div>
              <MarkdownBlock source={itemFieldSource(item, label)} />
            </section>
          ))}
        </div>
      </article>
    );
  }

  if (panelType === "matrix") {
    const rows = resolvePanelRows(panel).filter((label) => Boolean(itemFieldSource(item, label)));
    return (
      <article className={`${classes} clx-item-lesions clx-item-matrix`}>
        <ItemHeading item={item} className="clx-item-title" />
        <div className="clx-lesion-content clx-matrix-content">
          {rows.map((label, rowIndex) => (
            <section className="clx-lesion-section clx-matrix-section" key={`${item.title}-${label}-${rowIndex}`}>
              <div className="clx-lesion-label">{label}</div>
              <MarkdownBlock source={itemFieldSource(item, label)} />
            </section>
          ))}
        </div>
      </article>
    );
  }

  return (
    <article className={classes}>
      <ItemHeading item={item} className="clx-item-title" />
      <MarkdownBlock source={markdownFromLines(item.body)} className="clx-item-body" />
    </article>
  );
}


function chunkItems(items, size) {
  const safeSize = Math.max(1, Number(size) || 1);
  const chunks = [];
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
}

function LesionComparisonTable({ items, columns, title, groupIndex, panel }) {
  const effectiveColumns = Math.max(1, Math.min(columns, items.length));
  const tableStyle = { "--clx-columns": String(effectiveColumns) };
  const rows = resolvePanelRows(panel).filter(
    (label) => items.some((item) => Boolean(itemFieldSource(item, label)))
  );

  return (
    <div
      className="clx-lesion-table"
      data-columns={String(effectiveColumns)}
      style={tableStyle}
      role="table"
      aria-label={title || `Comparaison — groupe ${groupIndex + 1}`}
    >
      <div className="clx-lesion-table-row clx-lesion-title-row" role="row">
        <div className="clx-lesion-corner" role="columnheader">
          {panel.itemLabel || "Lésion"}
        </div>
        {items.map((item, index) => (
          <div
            className="clx-lesion-column-title"
            role="columnheader"
            key={`title-${groupIndex}-${item.title}-${index}`}
          >
            {item.title}
          </div>
        ))}
      </div>

      {items.some((item) => Boolean(markdownFromLines(item.image))) ? (
        <div className="clx-lesion-table-row clx-lesion-image-row" role="row">
          <div className="clx-lesion-row-label clx-lesion-row-label-empty" role="rowheader">
            Illustration
          </div>
          {items.map((item, index) => (
            <div
              className="clx-lesion-table-image"
              data-gallery-columns={String(item.galleryColumns || 1)}
              role="cell"
              key={`image-${groupIndex}-${item.title}-${index}`}
            >
              <LesionImageBlock item={item} />
            </div>
          ))}
        </div>
      ) : null}

      {rows.map((label, rowIndex) => {
        const isOrientation = normalizeFieldKey(label) === normalizeFieldKey("Orientation diagnostique");
        return (
          <div
            className={`clx-lesion-table-row clx-lesion-data-row${isOrientation ? " clx-lesion-orientation-row" : ""}`}
            role="row"
            key={`row-${groupIndex}-${label}-${rowIndex}`}
          >
            <div className="clx-lesion-row-label" role="rowheader">{label}</div>
            {items.map((item, index) => (
              <div className="clx-lesion-table-text" role="cell" key={`field-${groupIndex}-${label}-${item.title}-${index}`}>
                <MarkdownBlock source={itemFieldSource(item, label)} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}


function LesionComparison({ panel }) {
  const groups = chunkItems(panel.items, panel.columns);
  const layoutRef = useRef(null);

  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return undefined;

    const columns = Math.max(1, Math.min(4, Number(panel.columns) || 2));
    const breakpoints = { 1: 0, 2: 480, 3: 560, 4: 760 };
    const breakpoint = breakpoints[columns] || 560;

    const update = () => {
      const width = element.getBoundingClientRect?.().width || element.clientWidth || 0;
      if (width <= 0) return;
      element.dataset.view = breakpoint > 0 && width < breakpoint ? "cards" : "table";
    };

    element.dataset.view = "table";
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [panel.columns]);

  return (
    <div
      ref={layoutRef}
      className="clx-lesion-layout"
      data-view="table"
      data-columns={String(panel.columns)}
      style={{ "--clx-columns": String(panel.columns) }}
    >
      <div className="clx-lesion-tables" data-columns={String(panel.columns)}>
        {groups.map((items, groupIndex) => (
          <LesionComparisonTable
            items={items}
            columns={panel.columns}
            title={panel.title}
            groupIndex={groupIndex}
            panel={panel}
            key={`lesion-table-${groupIndex}-${items.map((item) => item.title).join("-")}`}
          />
        ))}
      </div>

      <div className="clx-lesion-mobile" aria-label={panel.title || "Lésions"}>
        {panel.items.map((item, index) => (
          <div className="clx-item-slot" key={`mobile-${item.title}-${index}`}>
            <ItemCard item={item} panelType="lesions" index={index} panel={panel} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MatrixComparisonTable({ items, columns, title, groupIndex, panel }) {
  const effectiveColumns = Math.max(1, Math.min(columns, items.length));
  const rows = resolvePanelRows(panel).filter(
    (label) => items.some((item) => Boolean(itemFieldSource(item, label)))
  );

  return (
    <div
      className="clx-lesion-table clx-matrix-table"
      data-columns={String(effectiveColumns)}
      style={{ "--clx-columns": String(effectiveColumns) }}
      role="table"
      aria-label={title || `Matrice — groupe ${groupIndex + 1}`}
    >
      <div className="clx-lesion-table-row clx-lesion-title-row" role="row">
        <div className="clx-lesion-corner" role="columnheader">{panel.itemLabel || "Élément"}</div>
        {items.map((item, index) => (
          <div className="clx-lesion-column-title" role="columnheader" key={`matrix-title-${groupIndex}-${item.title}-${index}`}>
            {item.title}
          </div>
        ))}
      </div>

      {rows.map((label, rowIndex) => (
        <div className="clx-lesion-table-row clx-lesion-data-row clx-matrix-data-row" role="row" key={`matrix-row-${groupIndex}-${label}-${rowIndex}`}>
          <div className="clx-lesion-row-label" role="rowheader">{label}</div>
          {items.map((item, index) => (
            <div className="clx-lesion-table-text" role="cell" key={`matrix-field-${groupIndex}-${label}-${item.title}-${index}`}>
              <MarkdownBlock source={itemFieldSource(item, label)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MatrixRowsTable({ panel }) {
  const rows = resolvePanelRows(panel).filter(
    (label) => panel.items.some((item) => Boolean(itemFieldSource(item, label)))
  );
  const fieldColumns = Math.max(1, rows.length);

  return (
    <div
      className="clx-lesion-table clx-matrix-table clx-matrix-table-rows"
      data-columns={String(fieldColumns)}
      style={{ "--clx-columns": String(fieldColumns) }}
      role="table"
      aria-label={panel.title || "Matrice comparative"}
    >
      <div className="clx-lesion-table-row clx-lesion-title-row" role="row">
        <div className="clx-lesion-corner" role="columnheader">{panel.itemLabel || "Élément"}</div>
        {rows.map((label, index) => (
          <div className="clx-lesion-column-title" role="columnheader" key={`matrix-row-header-${label}-${index}`}>
            {label}
          </div>
        ))}
      </div>

      {panel.items.map((item, itemIndex) => (
        <div className="clx-lesion-table-row clx-lesion-data-row clx-matrix-data-row" role="row" key={`matrix-item-row-${item.title}-${itemIndex}`}>
          <div className="clx-lesion-row-label clx-matrix-item-title" role="rowheader">{item.title}</div>
          {rows.map((label, fieldIndex) => (
            <div className="clx-lesion-table-text" role="cell" key={`matrix-item-field-${item.title}-${label}-${fieldIndex}`}>
              <MarkdownBlock source={itemFieldSource(item, label)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MatrixComparison({ panel }) {
  const rowDirection = panel.matrixDirection === "rows";
  const rows = resolvePanelRows(panel).filter(
    (label) => panel.items.some((item) => Boolean(itemFieldSource(item, label)))
  );
  const groups = rowDirection ? [panel.items] : chunkItems(panel.items, panel.columns);
  const responsiveColumns = rowDirection ? Math.max(1, rows.length) : panel.columns;
  const layoutRef = useRef(null);

  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return undefined;
    const columns = Math.max(1, Math.min(4, Number(responsiveColumns) || 2));
    const breakpoints = { 1: 0, 2: 480, 3: 620, 4: 780 };
    const breakpoint = breakpoints[columns] || 620;
    const update = () => {
      const width = element.getBoundingClientRect?.().width || element.clientWidth || 0;
      if (width > 0) element.dataset.view = breakpoint > 0 && width < breakpoint ? "cards" : "table";
    };
    element.dataset.view = "table";
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [responsiveColumns]);

  return (
    <div
      ref={layoutRef}
      className={`clx-lesion-layout clx-matrix-layout${rowDirection ? " clx-matrix-layout-rows" : ""}`}
      data-view="table"
      data-columns={String(responsiveColumns)}
      data-matrix-direction={rowDirection ? "rows" : "columns"}
    >
      <div className="clx-lesion-tables clx-matrix-tables" data-columns={String(responsiveColumns)}>
        {rowDirection ? (
          <MatrixRowsTable panel={panel} />
        ) : groups.map((items, groupIndex) => (
          <MatrixComparisonTable
            items={items}
            columns={panel.columns}
            title={panel.title}
            groupIndex={groupIndex}
            panel={panel}
            key={`matrix-table-${groupIndex}-${items.map((item) => item.title).join("-")}`}
          />
        ))}
      </div>
      <div className="clx-lesion-mobile clx-matrix-mobile" aria-label={panel.title || "Matrice comparative"}>
        {panel.items.map((item, index) => (
          <div className="clx-item-slot" key={`matrix-mobile-${item.title}-${index}`}>
            <ItemCard item={item} panelType="matrix" index={index} panel={panel} />
          </div>
        ))}
      </div>
    </div>
  );
}


function StepSequence({ panel, panelStyle }) {
  const sequenceRef = useRef(null);

  useEffect(() => {
    const sequence = sequenceRef.current;
    if (!sequence) return undefined;

    let frameId = 0;

    const updateImageHeight = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        if (!sequence.isConnected) return;

        /*
         * On calcule la plus grande hauteur commune permettant à
         * toutes les images de conserver leur ratio sans dépasser la largeur
         * de leur cadre. La hauteur visible des images devient donc identique,
         * sans recadrage ni intervention de CaseMarkdown.
         */
        const entries = Array.from(sequence.querySelectorAll(".clx-step-image img"))
          .map((image) => {
            const frame = image.closest(".clx-step-image");
            const naturalWidth = image.naturalWidth || Number(image.getAttribute("width")) || 0;
            const naturalHeight = image.naturalHeight || Number(image.getAttribute("height")) || 0;
            const frameWidth = frame?.getBoundingClientRect?.().width || frame?.clientWidth || 0;
            const computedMaxHeight = frame
              ? Number.parseFloat(getComputedStyle(frame).maxHeight)
              : 0;

            if (!(naturalWidth > 0) || !(naturalHeight > 0) || !(frameWidth > 0)) return null;
            return {
              fitHeight: frameWidth / (naturalWidth / naturalHeight),
              maxHeight: computedMaxHeight > 0 ? computedMaxHeight : Infinity,
            };
          })
          .filter(Boolean);

        if (!entries.length) return;

        const commonHeight = Math.min(
          ...entries.map((entry) => entry.fitHeight),
          ...entries.map((entry) => entry.maxHeight)
        );

        if (Number.isFinite(commonHeight) && commonHeight > 0) {
          const nextHeight = Math.max(1, Math.floor(commonHeight));
          const currentHeight = Number.parseFloat(
            sequence.style.getPropertyValue("--clx-step-image-height")
          );
          if (!Number.isFinite(currentHeight) || Math.abs(currentHeight - nextHeight) > 0.5) {
            sequence.style.setProperty("--clx-step-image-height", `${nextHeight}px`);
          }
        }
      });
    };

    const images = Array.from(sequence.querySelectorAll(".clx-step-image img"));
    images.forEach((image) => {
      if (!image.complete) image.addEventListener("load", updateImageHeight);
    });

    updateImageHeight();

    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updateImageHeight)
      : null;
    observer?.observe(sequence);
    sequence.querySelectorAll(".clx-step-image").forEach((frame) => observer?.observe(frame));

    window.addEventListener("resize", updateImageHeight);

    return () => {
      cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener("resize", updateImageHeight);
      images.forEach((image) => image.removeEventListener("load", updateImageHeight));
    };
  }, [panel]);

  return (
    <div ref={sequenceRef} className="clx-steps" style={panelStyle}>
      {panel.items.map((item, index) => (
        <div className="clx-step-sequence" key={`${item.title}-${index}`}>
          <ItemCard item={item} panelType={panel.type} index={index} panel={panel} />
          {index < panel.items.length - 1 ? (
            <div
              className="clx-step-arrow"
              aria-hidden={item.connector ? undefined : "true"}
              aria-label={item.connector || undefined}
            >
              {item.connector ? (
                <span className="clx-step-connector-label">{item.connector}</span>
              ) : null}
              <span className="clx-step-arrow-symbol" aria-hidden="true">→</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function GalleryPanel({ panel, panelStyle }) {
  const galleryRef = useRef(null);

  useEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery) return undefined;

    let frameId = 0;
    const updateImageHeight = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        if (!gallery.isConnected) return;
        const entries = Array.from(gallery.querySelectorAll(".clx-step-image img"))
          .map((image) => {
            const frame = image.closest(".clx-step-image");
            const naturalWidth = image.naturalWidth || Number(image.getAttribute("width")) || 0;
            const naturalHeight = image.naturalHeight || Number(image.getAttribute("height")) || 0;
            const frameWidth = frame?.getBoundingClientRect?.().width || frame?.clientWidth || 0;
            const computedMaxHeight = frame ? Number.parseFloat(getComputedStyle(frame).maxHeight) : 0;
            if (!(naturalWidth > 0) || !(naturalHeight > 0) || !(frameWidth > 0)) return null;
            return {
              fitHeight: frameWidth / (naturalWidth / naturalHeight),
              maxHeight: computedMaxHeight > 0 ? computedMaxHeight : Infinity,
            };
          })
          .filter(Boolean);

        if (!entries.length) return;
        const commonHeight = Math.min(
          ...entries.map((entry) => entry.fitHeight),
          ...entries.map((entry) => entry.maxHeight)
        );
        if (Number.isFinite(commonHeight) && commonHeight > 0) {
          gallery.style.setProperty("--clx-step-image-height", `${Math.max(1, Math.floor(commonHeight))}px`);
        }
      });
    };

    const images = Array.from(gallery.querySelectorAll(".clx-step-image img"));
    images.forEach((image) => {
      if (!image.complete) image.addEventListener("load", updateImageHeight);
    });
    updateImageHeight();

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateImageHeight) : null;
    observer?.observe(gallery);
    gallery.querySelectorAll(".clx-step-image").forEach((frame) => observer?.observe(frame));
    window.addEventListener("resize", updateImageHeight);

    return () => {
      cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener("resize", updateImageHeight);
      images.forEach((image) => image.removeEventListener("load", updateImageHeight));
    };
  }, [panel]);

  return (
    <div ref={galleryRef} className="clx-gallery-grid" style={panelStyle}>
      {panel.items.map((item, index) => (
        <div className="clx-gallery-item" key={`gallery-${item.title}-${index}`}>
          {Number(item.headingLevel) >= 2 && Number(item.headingLevel) <= 6 ? (
            <ItemHeading item={item} className="clx-gallery-title" defaultLevel={4} />
          ) : null}
          <StepFigure item={item} />
        </div>
      ))}
    </div>
  );
}

function SharedPanel({ panel }) {
  const sharedSource = markdownFromLines(panel.sharedBody);

  return (
    <div
      className="clx-shared-layout"
      role="group"
      aria-label={panel.title || "Données avec contenu commun"}
    >
      <section className="clx-shared-card clx-shared-card-items">
        <div
          className="clx-shared-card-title"
          role="heading"
          aria-level="3"
        >
          {panel.title || "Éléments"}
        </div>

        <div className="clx-shared-items">
          {panel.items.map((item, index) => (
            <article className="clx-shared-row" key={`${item.title}-${index}`}>
              <div className="clx-shared-item-title">
                <ItemHeading
                  item={item}
                  className="clx-shared-item-heading"
                  defaultLevel={4}
                />
              </div>
              <MarkdownBlock
                source={markdownFromLines(item.body)}
                className="clx-shared-item-body"
              />
            </article>
          ))}
        </div>
      </section>

      <section className="clx-shared-card clx-shared-card-common">
        <div
          className="clx-shared-card-title"
          role="heading"
          aria-level="3"
        >
          {panel.sharedTitle || "Contenu commun"}
        </div>

        <div className="clx-shared-common">
          <MarkdownBlock
            source={sharedSource}
            className="clx-shared-common-markdown"
          />
        </div>
      </section>
    </div>
  );
}

function Panel({ panel }) {
  const isSteps = panel.type === "steps";
  const isMedia = panel.type === "media";
  const isLesions = panel.type === "lesions";
  const isMatrix = panel.type === "matrix";
  const isGallery = panel.type === "gallery";
  const isShared = panel.type === "shared";
  const panelStyle = {
    "--clx-columns": String(panel.columns),
    "--clx-media-main": `${panel.ratio?.[0] || 65}fr`,
    "--clx-media-side": `${panel.ratio?.[1] || 35}fr`,
  };

  return (
    <section className={`clx-panel clx-panel-${panel.type}`} data-joined={panel.joined ? "true" : "false"}>
      {panel.title && !isShared ? (
        <div className="clx-panel-title" role="heading" aria-level="3">{panel.title}</div>
      ) : null}

      {markdownFromLines(panel.intro) ? (
        <MarkdownBlock source={markdownFromLines(panel.intro)} className="clx-panel-intro" />
      ) : null}

      {isLesions ? (
        <LesionComparison panel={panel} />
      ) : isMatrix ? (
        <MatrixComparison panel={panel} />
      ) : panel.type === "comparison" && panel.joined ? (
        <JoinedComparisonPanel panel={panel} />
      ) : isSteps ? (
        <StepSequence panel={panel} panelStyle={panelStyle} />
      ) : isGallery ? (
        <GalleryPanel panel={panel} panelStyle={panelStyle} />
      ) : isShared ? (
        <SharedPanel panel={panel} />
      ) : (
        <div className="clx-items" style={panelStyle}>
          {panel.items.map((item, index) => {
            const slotClass = [
              "clx-item-slot",
              item.layout === "wide" ? "clx-item-slot-wide" : "",
              isMedia ? "clx-media-slot" : "",
              isMedia && index === 0 ? "clx-media-slot-content" : "",
              isMedia && index === 1 ? "clx-media-slot-visual" : "",
            ].filter(Boolean).join(" ");

            return (
              <div className={slotClass} key={`${item.title}-${index}`}>
                <ItemCard item={item} panelType={panel.type} index={index} panel={panel} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const ClinicalLayout = memo(function ClinicalLayout({ source }) {
  const parsed = useMemo(() => {
    try {
      return { data: parseClinicalLayoutSource(source), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }, [source]);

  if (parsed.error) {
    const prefix = parsed.error.lineNumber ? `Ligne ${parsed.error.lineNumber} — ` : "";
    return (
      <div className="clinical-layout clx-error" role="alert">
        <strong>Données cliniques structurées invalides</strong>
        <div>{prefix}{String(parsed.error.message || parsed.error)}</div>
        <div className="clx-error-help">
          Directives : @label, @intro, @footer, @panel (dont matrix, gallery et shared), @joined, @columns, @matrixDirection, @ratio, @panelIntro, @sharedTitle, @shared, @itemLabel, @rows, @item, @itemH4, @step, @stepH4, @figure, @figureH4, @layout, @connector, @gallery, @image, @caption, @field, @definition et @orientation.
        </div>
      </div>
    );
  }

  const { data } = parsed;
  return (
    <div className="clinical-layout" role="group" aria-label={data.label}>
      {markdownFromLines(data.intro) ? (
        <MarkdownBlock source={markdownFromLines(data.intro)} className="clx-intro" />
      ) : null}

      {data.panels.map((panel, index) => (
        <Panel panel={panel} key={`${panel.type}-${panel.title}-${index}`} />
      ))}

      {markdownFromLines(data.footer) ? (
        <MarkdownBlock source={markdownFromLines(data.footer)} className="clx-footer" />
      ) : null}
    </div>
  );
});

export default ClinicalLayout;
