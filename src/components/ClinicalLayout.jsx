import { memo, useMemo } from "react";
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

const PANEL_TYPES = new Set(["grid", "steps", "comparison", "profiles", "media"]);

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

function normalizeColumns(value, fallback = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(4, Math.floor(number)));
}

function createPanel(type, title, lineNumber) {
  return {
    type,
    title,
    columns: type === "steps" ? 3 : 2,
    ratio: [65, 35],
    intro: createTextBlock(),
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

    const panelMatch = trimmed.match(/^@panel\s+(grid|steps|comparison|profiles|media)(?:\s+(.+))?$/i);
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

    const columnsMatch = trimmed.match(/^@columns\s+([1-4])$/i);
    if (columnsMatch) {
      if (!currentPanel) {
        throw new ClinicalLayoutParseError("@columns doit suivre un @panel.", lineNumber);
      }
      currentPanel.columns = normalizeColumns(columnsMatch[1], currentPanel.columns);
      currentTarget = null;
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

    const itemMatch = trimmed.match(/^@(item|step)\s+(.+)$/i);
    if (itemMatch) {
      if (!currentPanel) {
        throw new ClinicalLayoutParseError("@item ou @step doit suivre un @panel.", lineNumber);
      }
      const directive = itemMatch[1].toLowerCase();
      if (currentPanel.type === "steps" && directive !== "step") {
        throw new ClinicalLayoutParseError("Utilise @step dans un panneau de type steps.", lineNumber);
      }
      if (currentPanel.type !== "steps" && directive !== "item") {
        throw new ClinicalLayoutParseError("Utilise @item dans ce type de panneau.", lineNumber);
      }
      const title = cleanTitle(itemMatch[2]);
      if (!title) {
        throw new ClinicalLayoutParseError(`@${directive} doit être suivi d’un titre.`, lineNumber);
      }
      const item = {
        title,
        layout: "compact",
        body: createTextBlock(),
        lineNumber,
      };
      currentPanel.items.push(item);
      currentItem = item;
      currentTarget = item.body;
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
    panel.items.forEach((item) => {
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

function ItemCard({ item, panelType, index }) {
  const classes = [
    "clx-item",
    `clx-item-${panelType}`,
    item.layout === "wide" ? "clx-item-wide" : "clx-item-compact",
  ].join(" ");

  if (panelType === "steps") {
    return (
      <article className={classes}>
        <div className="clx-step-number" aria-hidden="true">{index + 1}</div>
        <div className="clx-step-content">
          <div className="clx-step-title" role="heading" aria-level="4">{item.title}</div>
          <MarkdownBlock source={markdownFromLines(item.body)} className="clx-step-body" />
        </div>
      </article>
    );
  }

  return (
    <article className={classes}>
      <div className="clx-item-title" role="heading" aria-level="4">{item.title}</div>
      <MarkdownBlock source={markdownFromLines(item.body)} className="clx-item-body" />
    </article>
  );
}

function Panel({ panel }) {
  const isSteps = panel.type === "steps";
  const isMedia = panel.type === "media";
  const panelStyle = {
    "--clx-columns": String(panel.columns),
    "--clx-media-main": `${panel.ratio?.[0] || 65}fr`,
    "--clx-media-side": `${panel.ratio?.[1] || 35}fr`,
  };

  return (
    <section className={`clx-panel clx-panel-${panel.type}`}>
      {panel.title ? (
        <div className="clx-panel-title" role="heading" aria-level="3">{panel.title}</div>
      ) : null}

      {markdownFromLines(panel.intro) ? (
        <MarkdownBlock source={markdownFromLines(panel.intro)} className="clx-panel-intro" />
      ) : null}

      <div className={isSteps ? "clx-steps" : "clx-items"} style={panelStyle}>
        {panel.items.map((item, index) => {
          const slotClass = isSteps
            ? "clx-step-sequence"
            : [
                "clx-item-slot",
                item.layout === "wide" ? "clx-item-slot-wide" : "",
                isMedia ? "clx-media-slot" : "",
                isMedia && index === 0 ? "clx-media-slot-content" : "",
                isMedia && index === 1 ? "clx-media-slot-visual" : "",
              ].filter(Boolean).join(" ");

          return (
          <div className={slotClass} key={`${item.title}-${index}`}>
            <ItemCard item={item} panelType={panel.type} index={index} />
            {isSteps && index < panel.items.length - 1 ? (
              <div className="clx-step-arrow" aria-hidden="true">→</div>
            ) : null}
          </div>
          );
        })}
      </div>
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
          Directives : @label, @intro, @footer, @panel, @columns, @ratio, @panelIntro, @item, @step et @layout.
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
