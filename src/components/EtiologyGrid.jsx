import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "./EtiologyGrid.css";

export class EtiologyGridParseError extends Error {
  constructor(message, lineNumber = null) {
    super(message);
    this.name = "EtiologyGridParseError";
    this.lineNumber = lineNumber;
  }
}

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
    .replace(/^@etiologyGrid\s*/i, "")
    .trim();
}

export function isEtiologyGridCodeBlock(language = "", source = "") {
  const lang = String(language || "")
    .toLowerCase()
    .replace(/^language-/, "")
    .trim();
  const raw = unwrapFence(source);

  return lang === "etiologygrid" || /^@etiologyGrid\b/i.test(raw);
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

function createEtiologyEntry(title, lineNumber = null) {
  return {
    title: cleanTitle(title),
    id: "",
    layout: "compact",
    summary: createTextBlock(),
    metas: [],
    sections: [],
    details: [],
    lineNumber,
  };
}

function etiologySlug(value) {
  return (
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/['’]/g, "-")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "affection"
  );
}

function validateEtiologyEntry(entry) {
  const hasSummary = Boolean(markdownFromLines(entry.summary));
  const hasMeta = entry.metas.some((item) => markdownFromLines(item.body));
  const hasSection = entry.sections.some((item) => markdownFromLines(item.body));
  const hasDetails = entry.details.some(
    (item) =>
      markdownFromLines(item.body) ||
      item.subsections.some((subsection) => markdownFromLines(subsection.body))
  );

  if (!entry.title) {
    throw new EtiologyGridParseError(
      "@etiology doit être suivi d’un titre.",
      entry.lineNumber
    );
  }

  if (!hasSummary && !hasMeta && !hasSection && !hasDetails) {
    throw new EtiologyGridParseError(
      `La fiche « ${entry.title} » est vide.`,
      entry.lineNumber
    );
  }

  entry.metas.forEach((item) => {
    if (!markdownFromLines(item.body)) {
      throw new EtiologyGridParseError(
        `La métadonnée « ${item.title} » de « ${entry.title} » est vide.`
      );
    }
  });

  entry.sections.forEach((item) => {
    if (!markdownFromLines(item.body)) {
      throw new EtiologyGridParseError(
        `La section « ${item.title} » de « ${entry.title} » est vide.`
      );
    }
  });

  entry.details.forEach((detail) => {
    if (!markdownFromLines(detail.body) && detail.subsections.length === 0) {
      throw new EtiologyGridParseError(
        `Le bloc détaillé « ${detail.title} » de « ${entry.title} » est vide.`
      );
    }

    detail.subsections.forEach((subsection) => {
      if (!markdownFromLines(subsection.body)) {
        throw new EtiologyGridParseError(
          `La sous-section « ${subsection.title} » de « ${entry.title} » est vide.`
        );
      }
    });
  });

  if (!entry.id) entry.id = `etiology-${etiologySlug(entry.title)}`;
  return entry;
}

export function parseEtiologyGridSource(source) {
  const result = {
    columns: 2,
    label: "Affections étiologiques",
    entries: [],
  };

  const lines = stripOptionalDirective(source)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  let currentEntry = null;
  let currentTarget = null;
  let currentDetail = null;
  let entriesStarted = false;

  const requireEntry = (directive, lineNumber) => {
    if (!currentEntry) {
      throw new EtiologyGridParseError(
        `${directive} doit être placé après @etiology.`,
        lineNumber
      );
    }
  };

  const requireTitle = (title, directive, lineNumber) => {
    if (!title) {
      throw new EtiologyGridParseError(
        `${directive} doit être suivi d’un titre.`,
        lineNumber
      );
    }
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = String(rawLine || "").trim();

    if (/^<!--.*-->$/.test(trimmed)) return;

    if (!trimmed) {
      if (currentTarget) appendLine(currentTarget, rawLine);
      return;
    }

    if (trimmed.startsWith("#") && !currentEntry) return;

    const columnsMatch = trimmed.match(/^@columns\s+(\d+)$/i);
    if (columnsMatch) {
      if (entriesStarted) {
        throw new EtiologyGridParseError(
          "@columns doit être placé avant le premier @etiology.",
          lineNumber
        );
      }
      const columns = Number(columnsMatch[1]);
      if (![2, 3, 4].includes(columns)) {
        throw new EtiologyGridParseError(
          "@columns accepte 2, 3 ou 4.",
          lineNumber
        );
      }
      result.columns = columns;
      return;
    }

    const labelMatch = trimmed.match(/^@label\s+(.+)$/i);
    if (labelMatch) {
      if (entriesStarted) {
        throw new EtiologyGridParseError(
          "@label doit être placé avant le premier @etiology.",
          lineNumber
        );
      }
      result.label = cleanTitle(labelMatch[1]) || result.label;
      return;
    }

    const etiologyMatch = trimmed.match(/^@etiology\s+(.+)$/i);
    if (etiologyMatch) {
      const title = cleanTitle(etiologyMatch[1]);
      requireTitle(title, "@etiology", lineNumber);
      currentEntry = createEtiologyEntry(title, lineNumber);
      result.entries.push(currentEntry);
      currentTarget = currentEntry.summary;
      currentDetail = null;
      entriesStarted = true;
      return;
    }

    const layoutMatch = trimmed.match(/^@layout\s+(.+)$/i);
    if (layoutMatch) {
      requireEntry("@layout", lineNumber);
      const wanted = cleanTitle(layoutMatch[1]).toLowerCase();
      if (!["compact", "wide", "standard"].includes(wanted)) {
        throw new EtiologyGridParseError(
          "@layout accepte compact ou wide.",
          lineNumber
        );
      }
      currentEntry.layout = wanted === "standard" ? "wide" : wanted;
      currentTarget = currentEntry.summary;
      currentDetail = null;
      return;
    }

    const idMatch = trimmed.match(/^@id\s+(.+)$/i);
    if (idMatch) {
      requireEntry("@id", lineNumber);
      const id = etiologySlug(idMatch[1]);
      currentEntry.id = id.startsWith("etiology-") ? id : `etiology-${id}`;
      return;
    }

    if (/^@summary\s*$/i.test(trimmed)) {
      requireEntry("@summary", lineNumber);
      currentTarget = currentEntry.summary;
      currentDetail = null;
      return;
    }

    const metaMatch = trimmed.match(/^@meta\s+(.+)$/i);
    if (metaMatch) {
      requireEntry("@meta", lineNumber);
      const title = cleanTitle(metaMatch[1]);
      requireTitle(title, "@meta", lineNumber);
      const meta = { title, body: createTextBlock() };
      currentEntry.metas.push(meta);
      currentTarget = meta.body;
      currentDetail = null;
      return;
    }

    const sectionMatch = trimmed.match(/^@section\s+(.+)$/i);
    if (sectionMatch) {
      requireEntry("@section", lineNumber);
      const title = cleanTitle(sectionMatch[1]);
      requireTitle(title, "@section", lineNumber);
      const section = { title, body: createTextBlock() };
      currentEntry.sections.push(section);
      currentTarget = section.body;
      currentDetail = null;
      return;
    }

    const detailsMatch = trimmed.match(/^@details(?:\s+(.+))?$/i);
    if (detailsMatch) {
      requireEntry("@details", lineNumber);
      const title = cleanTitle(
        detailsMatch[1] || "Détails complémentaires"
      );
      const detail = {
        title,
        body: createTextBlock(),
        subsections: [],
        open: false,
      };
      currentEntry.details.push(detail);
      currentDetail = detail;
      currentTarget = detail.body;
      return;
    }

    if (/^@open\s*$/i.test(trimmed)) {
      requireEntry("@open", lineNumber);
      if (!currentDetail) {
        throw new EtiologyGridParseError(
          "@open doit être placé après @details.",
          lineNumber
        );
      }
      currentDetail.open = true;
      return;
    }

    const subsectionMatch = trimmed.match(/^@subsection\s+(.+)$/i);
    if (subsectionMatch) {
      requireEntry("@subsection", lineNumber);
      if (!currentDetail) {
        throw new EtiologyGridParseError(
          "@subsection doit être placé dans un bloc @details.",
          lineNumber
        );
      }
      const title = cleanTitle(subsectionMatch[1]);
      requireTitle(title, "@subsection", lineNumber);
      const subsection = { title, body: createTextBlock() };
      currentDetail.subsections.push(subsection);
      currentTarget = subsection.body;
      return;
    }

    if (/^@/.test(trimmed)) {
      throw new EtiologyGridParseError(
        `Directive inconnue : ${trimmed}`,
        lineNumber
      );
    }

    if (!currentEntry || !currentTarget) {
      throw new EtiologyGridParseError(
        "Le contenu doit commencer par @etiology après les options globales.",
        lineNumber
      );
    }

    appendLine(currentTarget, rawLine);
  });

  if (result.entries.length === 0) {
    throw new EtiologyGridParseError(
      "Ajoute au moins une affection avec @etiology."
    );
  }

  result.entries = result.entries.map(validateEtiologyEntry);
  return result;
}

function VisualHeading({ className, level, id, children, ...props }) {
  return (
    <div
      className={className}
      role="heading"
      aria-level={level}
      id={id}
      {...props}
    >
      {children}
    </div>
  );
}

const markdownComponents = {
  a({ children, href, ...props }) {
    const external = /^https?:\/\//i.test(String(href || ""));
    return (
      <a
        href={href}
        {...props}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {children}
      </a>
    );
  },
  code({ children }) {
    return <code className="etg-inline-code">{children}</code>;
  },
};

function MarkdownBlock({ lines, className = "" }) {
  const source = markdownFromLines(lines);
  if (!source) return null;

  return (
    <div className={`etg-markdown ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

function EtiologyMeta({ meta }) {
  return (
    <div className="etg-meta-item">
      <div className="etg-meta-label">{meta.title}</div>
      <MarkdownBlock lines={meta.body} className="etg-meta-content" />
    </div>
  );
}

function EtiologySection({ section }) {
  return (
    <section className="etg-section">
      <VisualHeading className="etg-section-title" level={5}>
        {section.title}
      </VisualHeading>
      <MarkdownBlock lines={section.body} className="etg-section-content" />
    </section>
  );
}

function EtiologyDetail({ detail }) {
  return (
    <details className="etg-details" open={detail.open || undefined}>
      <summary className="etg-details-summary">{detail.title}</summary>
      <div className="etg-details-body">
        <MarkdownBlock lines={detail.body} className="etg-details-intro" />

        {detail.subsections.length > 0 && (
          <div className="etg-subsections">
            {detail.subsections.map((subsection, index) => (
              <section
                className="etg-subsection"
                key={`${subsection.title}-${index}`}
              >
                <VisualHeading className="etg-subsection-title" level={5}>
                  {subsection.title}
                </VisualHeading>
                <MarkdownBlock
                  lines={subsection.body}
                  className="etg-subsection-content"
                />
              </section>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function EtiologyEntry({ entry }) {
  return (
    <article
      className={`etg-entry etg-layout-${entry.layout}`}
      role="group"
      aria-labelledby={entry.id}
    >
      <VisualHeading
        className="etg-entry-title"
        level={4}
        id={entry.id}
        data-etiology-title={entry.title}
      >
        {entry.title}
      </VisualHeading>

      <div className="etiology-card etg-entry-card">
        {entry.metas.length > 0 && (
          <div className="etg-meta-grid">
            {entry.metas.map((meta, index) => (
              <EtiologyMeta meta={meta} key={`${meta.title}-${index}`} />
            ))}
          </div>
        )}

        <MarkdownBlock lines={entry.summary} className="etg-summary" />

        {entry.sections.length > 0 && (
          <div
            className="etg-sections"
            style={{ "--etg-section-count": entry.sections.length }}
          >
            {entry.sections.map((section, index) => (
              <EtiologySection
                section={section}
                key={`${section.title}-${index}`}
              />
            ))}
          </div>
        )}

        {entry.details.length > 0 && (
          <div className="etg-details-list">
            {entry.details.map((detail, index) => (
              <EtiologyDetail
                detail={detail}
                key={`${detail.title}-${index}`}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

const EtiologyGrid = memo(function EtiologyGrid({ source = "" }) {
  const parsed = useMemo(() => {
    try {
      return { data: parseEtiologyGridSource(source), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }, [source]);

  if (parsed.error) {
    const linePrefix = parsed.error?.lineNumber
      ? `Ligne ${parsed.error.lineNumber} — `
      : "";

    return (
      <div className="etiology-grid etg-error" role="alert">
        <strong className="etg-error-title">Grille étiologique invalide</strong>
        <div className="etg-error-message">
          {linePrefix}
          {String(parsed.error?.message || "Erreur inconnue.")}
        </div>
        <div className="etg-error-help">
          Directives disponibles : @columns, @label, @etiology, @layout,
          @id, @summary, @meta, @section, @details, @open et @subsection.
        </div>
      </div>
    );
  }

  const data = parsed.data;

  return (
    <div
      className="etiology-grid etg-unified-grid"
      style={{ "--etg-grid-columns": data.columns || 2 }}
      role="group"
      aria-label={data.label || "Affections étiologiques"}
    >
      {data.entries.map((entry, index) => (
        <EtiologyEntry entry={entry} key={`${entry.id}-${index}`} />
      ))}
    </div>
  );
});

export default EtiologyGrid;
