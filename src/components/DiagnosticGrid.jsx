import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "./DiagnosticGrid.css";

export class DiagnosticGridParseError extends Error {
  constructor(message, lineNumber = null) {
    super(message);
    this.name = "DiagnosticGridParseError";
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
    .replace(/^@diagnosticGrid\s*/i, "")
    .trim();
}

export function isDiagnosticGridCodeBlock(language = "", source = "") {
  const lang = String(language || "")
    .toLowerCase()
    .replace(/^language-/, "")
    .trim();
  const raw = unwrapFence(source);

  return lang === "diagnosticgrid" || /^@diagnosticGrid\b/i.test(raw);
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

export function parseDiagnosticGridSource(source) {
  const result = {
    layout: null,
    cards: [],
    matrix: null,
  };

  const lines = stripOptionalDirective(source)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  let currentTarget = null;
  let currentMatrix = null;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();

    if (/^<!--.*-->$/.test(trimmed)) return;

    const layoutMatch = trimmed.match(/^@layout\s+(clinical|cards)$/i);
    if (layoutMatch) {
      if (result.layout) {
        throw new DiagnosticGridParseError(
          "Une seule directive @layout est autorisée.",
          lineNumber
        );
      }
      result.layout = layoutMatch[1].toLowerCase();
      currentTarget = null;
      currentMatrix = null;
      return;
    }

    const cardMatch = trimmed.match(/^@card\s+(.+)$/i);
    if (cardMatch) {
      if (!result.layout) {
        throw new DiagnosticGridParseError(
          "@card doit être placé après @layout.",
          lineNumber
        );
      }
      const title = cleanTitle(cardMatch[1]);
      if (!title) {
        throw new DiagnosticGridParseError(
          "@card doit être suivi d’un titre.",
          lineNumber
        );
      }
      const card = { title, body: createTextBlock() };
      result.cards.push(card);
      currentTarget = card.body;
      currentMatrix = null;
      return;
    }

    const matrixMatch = trimmed.match(/^@matrix\s+(.+)$/i);
    if (matrixMatch) {
      if (result.layout !== "clinical") {
        throw new DiagnosticGridParseError(
          "@matrix est réservé à @layout clinical.",
          lineNumber
        );
      }
      if (result.matrix) {
        throw new DiagnosticGridParseError(
          "Un seul bloc @matrix est autorisé.",
          lineNumber
        );
      }
      const title = cleanTitle(matrixMatch[1]);
      if (!title) {
        throw new DiagnosticGridParseError(
          "@matrix doit être suivi d’un titre.",
          lineNumber
        );
      }
      result.matrix = { title, criteria: [] };
      currentMatrix = result.matrix;
      currentTarget = null;
      return;
    }

    const criterionMatch = trimmed.match(/^@criterion\s+(.+)$/i);
    if (criterionMatch) {
      if (!currentMatrix) {
        throw new DiagnosticGridParseError(
          "@criterion doit être placé après @matrix.",
          lineNumber
        );
      }
      const title = cleanTitle(criterionMatch[1]);
      if (!title) {
        throw new DiagnosticGridParseError(
          "@criterion doit être suivi d’un titre.",
          lineNumber
        );
      }
      const criterion = { title, body: createTextBlock() };
      currentMatrix.criteria.push(criterion);
      currentTarget = criterion.body;
      return;
    }

    if (/^@/.test(trimmed)) {
      throw new DiagnosticGridParseError(
        `Directive inconnue : ${trimmed}`,
        lineNumber
      );
    }

    if (!trimmed) {
      appendLine(currentTarget, "");
      return;
    }

    if (!currentTarget) {
      const help = currentMatrix
        ? "Ajoute une directive @criterion avant son contenu."
        : "Le contenu doit être placé après @card ou @criterion.";
      throw new DiagnosticGridParseError(help, lineNumber);
    }

    appendLine(currentTarget, rawLine);
  });

  if (!result.layout) {
    throw new DiagnosticGridParseError(
      "Le bloc doit commencer par @layout clinical ou @layout cards."
    );
  }

  if (result.cards.length === 0 && !result.matrix) {
    throw new DiagnosticGridParseError(
      "Le bloc ne contient aucun @card ni @matrix."
    );
  }

  result.cards.forEach((card) => {
    if (!markdownFromLines(card.body)) {
      throw new DiagnosticGridParseError(
        `La fiche « ${card.title} » est vide.`
      );
    }
  });

  if (result.layout === "cards" && result.matrix) {
    throw new DiagnosticGridParseError(
      "@layout cards ne peut pas contenir de bloc @matrix."
    );
  }

  if (result.matrix) {
    if (result.matrix.criteria.length === 0) {
      throw new DiagnosticGridParseError(
        `La matrice « ${result.matrix.title} » ne contient aucun @criterion.`
      );
    }

    result.matrix.criteria.forEach((criterion) => {
      if (!markdownFromLines(criterion.body)) {
        throw new DiagnosticGridParseError(
          `Le critère « ${criterion.title} » est vide.`
        );
      }
    });
  }

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
    return <code className="dxg-inline-code">{children}</code>;
  },
};

function MarkdownBlock({ lines, className = "dxg-markdown" }) {
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

function DiagnosticCard({ card }) {
  return (
    <article className="dxg-card" aria-label={card.title}>
      <VisualHeading className="dxg-card-title" level={3}>
        {card.title}
      </VisualHeading>
      <div className="dxg-card-body">
        <MarkdownBlock lines={card.body} />
      </div>
    </article>
  );
}

function DiagnosticMatrix({ matrix }) {
  return (
    <section className="dxg-matrix" aria-label={matrix.title}>
      <VisualHeading className="dxg-matrix-title" level={3}>
        {matrix.title}
      </VisualHeading>

      <div className="dxg-matrix-rows">
        {matrix.criteria.map((criterion, index) => (
          <section
            className="dxg-criterion"
            key={`${criterion.title}:${index}`}
          >
            <VisualHeading className="dxg-criterion-title" level={4}>
              {criterion.title}
            </VisualHeading>
            <MarkdownBlock
              lines={criterion.body}
              className="dxg-criterion-content dxg-markdown"
            />
          </section>
        ))}
      </div>
    </section>
  );
}

function DiagnosticGridError({ error }) {
  const linePrefix = error?.lineNumber ? `Ligne ${error.lineNumber} — ` : "";

  return (
    <div className="diagnostic-grid dxg-error" role="alert">
      <strong className="dxg-error-title">Bloc de diagnostic invalide</strong>
      <div className="dxg-error-message">
        {linePrefix}
        {error?.message || "Erreur inconnue."}
      </div>
      <div className="dxg-error-help">
        Directives disponibles : @layout clinical|cards, @card, @matrix et
        @criterion.
      </div>
    </div>
  );
}

const DiagnosticGrid = memo(function DiagnosticGrid({ source = "" }) {
  const parsed = useMemo(() => {
    try {
      return { data: parseDiagnosticGridSource(source), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }, [source]);

  if (parsed.error) {
    return <DiagnosticGridError error={parsed.error} />;
  }

  const { data } = parsed;
  const maxColumns = data.layout === "clinical" ? 2 : 3;
  const cardColumns = Math.max(1, Math.min(data.cards.length, maxColumns));
  const cardsClass = data.layout === "clinical"
    ? "dxg-clinical-cards"
    : "dxg-cards";

  return (
    <div
      className={`diagnostic-grid dxg-layout-${data.layout}`}
      role="group"
      aria-label={
        data.layout === "clinical"
          ? "Diagnostic clinique"
          : "Diagnostic paraclinique"
      }
    >
      {data.cards.length > 0 && (
        <div
          className={cardsClass}
          style={{ "--dxg-columns": cardColumns }}
        >
          {data.cards.map((card, index) => (
            <DiagnosticCard card={card} key={`${card.title}:${index}`} />
          ))}
        </div>
      )}

      {data.matrix && <DiagnosticMatrix matrix={data.matrix} />}
    </div>
  );
});

export default DiagnosticGrid;
