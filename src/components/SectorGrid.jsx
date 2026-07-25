import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "./SectorGrid.css";

export class SectorGridParseError extends Error {
  constructor(message, lineNumber = null) {
    super(message);
    this.name = "SectorGridParseError";
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
    .replace(/^@sectorGrid\s*/i, "")
    .trim();
}

export function isSectorGridCodeBlock(language = "", source = "") {
  const lang = String(language || "")
    .toLowerCase()
    .replace(/^language-/, "")
    .trim();
  const raw = unwrapFence(source);

  return lang === "sectorgrid" || /^@sectorGrid\b/i.test(raw);
}

function createTextBlock() {
  return [];
}

function appendLine(target, rawLine) {
  if (!Array.isArray(target)) return;
  const line = String(rawLine || "").replace(/[ \t]+$/g, "");

  if (!line.trim()) {
    if (target.length > 0 && target[target.length - 1] !== "") {
      target.push("");
    }
    return;
  }

  target.push(line);
}

function markdownFromLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .join("\n")
    .replace(/^\s+|\s+$/g, "");
}

export function parseSectorGridSource(source) {
  const result = { sectors: [] };
  const lines = stripOptionalDirective(source)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  let currentSector = null;
  let currentTarget = null;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();

    if (/^<!--.*-->$/.test(trimmed)) return;

    const sectorMatch = trimmed.match(/^@sector\s+(.+)$/i);
    if (sectorMatch) {
      const title = cleanTitle(sectorMatch[1]);
      if (!title) {
        throw new SectorGridParseError(
          "@sector doit être suivi d’un identifiant.",
          lineNumber
        );
      }

      currentSector = {
        title,
        body: createTextBlock(),
        subzones: [],
      };
      result.sectors.push(currentSector);
      currentTarget = currentSector.body;
      return;
    }

    const subzoneMatch = trimmed.match(/^@subzone\s+(.+)$/i);
    if (subzoneMatch) {
      if (!currentSector) {
        throw new SectorGridParseError(
          "@subzone doit être placé après un @sector.",
          lineNumber
        );
      }

      const title = cleanTitle(subzoneMatch[1]);
      if (!title) {
        throw new SectorGridParseError(
          "@subzone doit être suivi d’un identifiant.",
          lineNumber
        );
      }

      const subzone = { title, body: createTextBlock() };
      currentSector.subzones.push(subzone);
      currentTarget = subzone.body;
      return;
    }

    if (/^@/.test(trimmed)) {
      throw new SectorGridParseError(
        `Directive inconnue : ${trimmed}`,
        lineNumber
      );
    }

    if (!trimmed) {
      appendLine(currentTarget, "");
      return;
    }

    if (!currentTarget) {
      throw new SectorGridParseError(
        "Le contenu doit commencer par une directive @sector.",
        lineNumber
      );
    }

    appendLine(currentTarget, rawLine);
  });

  if (result.sectors.length === 0) {
    throw new SectorGridParseError(
      "Le bloc doit contenir au moins un @sector."
    );
  }

  result.sectors.forEach((sector) => {
    const hasBody = Boolean(markdownFromLines(sector.body));
    const hasSubzones = sector.subzones.length > 0;

    if (!hasBody && !hasSubzones) {
      throw new SectorGridParseError(
        `Le secteur « ${sector.title} » ne contient aucun contenu.`
      );
    }

    sector.subzones.forEach((subzone) => {
      if (!markdownFromLines(subzone.body)) {
        throw new SectorGridParseError(
          `La sous-zone « ${subzone.title} » du secteur « ${sector.title} » est vide.`
        );
      }
    });
  });

  return result;
}

function VisualHeading({ className, level, children }) {
  return (
    <div className={className} role="heading" aria-level={level}>
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
    return <code className="sg-inline-code">{children}</code>;
  },
};

function MarkdownBlock({ lines, className = "sg-markdown" }) {
  const markdown = Array.isArray(lines)
    ? markdownFromLines(lines)
    : String(lines || "").trim();

  if (!markdown) return null;

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        skipHtml
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function SectorCard({ sector }) {
  return (
    <article className="sg-sector" aria-label={`Secteur ${sector.title}`}>
      <VisualHeading className="sg-sector-title" level={3}>
        Secteur {sector.title}
      </VisualHeading>

      <div className="sg-sector-body">
        <MarkdownBlock lines={sector.body} />
      </div>

      {sector.subzones.length > 0 && (
        <div className="sg-subzones">
          {sector.subzones.map((subzone, index) => (
            <section
              className="sg-subzone"
              key={`${subzone.title}:${index}`}
            >
              <VisualHeading className="sg-subzone-title" level={4}>
                {subzone.title}
              </VisualHeading>
              <MarkdownBlock
                lines={subzone.body}
                className="sg-subzone-content sg-markdown"
              />
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function SectorColumn({ sectors, columnKey }) {
  return (
    <div className="sg-column">
      {sectors.map(({ sector, originalIndex }) => (
        <SectorCard
          sector={sector}
          key={`${columnKey}:${sector.title}:${originalIndex}`}
        />
      ))}
    </div>
  );
}

function SectorGridError({ error }) {
  const linePrefix = error?.lineNumber ? `Ligne ${error.lineNumber} — ` : "";

  return (
    <div className="sector-grid sg-error" role="alert">
      <strong className="sg-error-title">Bloc de secteurs invalide</strong>
      <div className="sg-error-message">
        {linePrefix}
        {error?.message || "Erreur inconnue."}
      </div>
      <div className="sg-error-help">
        Directives disponibles : @sector et @subzone.
      </div>
    </div>
  );
}

const SectorGrid = memo(function SectorGrid({ source = "" }) {
  const result = useMemo(() => {
    try {
      return { data: parseSectorGridSource(source), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }, [source]);

  const desktopColumns = useMemo(() => {
    const indexed = (result.data?.sectors || []).map((sector, originalIndex) => ({
      sector,
      originalIndex,
    }));
    const splitIndex = Math.ceil(indexed.length / 2);

    return {
      left: indexed.slice(0, splitIndex),
      right: indexed.slice(splitIndex),
    };
  }, [result.data]);

  if (result.error || !result.data) {
    return <SectorGridError error={result.error} />;
  }

  return (
    <div
      className="sector-grid"
      role="group"
      aria-label="Délimitation des secteurs"
    >
      <div className="sg-layout-desktop">
        <SectorColumn sectors={desktopColumns.left} columnKey="left" />
        <SectorColumn sectors={desktopColumns.right} columnKey="right" />
      </div>

      <div className="sg-layout-mobile">
        {result.data.sectors.map((sector, index) => (
          <SectorCard sector={sector} key={`mobile:${sector.title}:${index}`} />
        ))}
      </div>
    </div>
  );
});

export default SectorGrid;
