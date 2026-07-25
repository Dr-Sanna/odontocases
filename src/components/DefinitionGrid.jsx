import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "./DefinitionGrid.css";

export class DefinitionGridParseError extends Error {
  constructor(message, lineNumber = null) {
    super(message);
    this.name = "DefinitionGridParseError";
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
    .replace(/^@definitionGrid\s*/i, "")
    .trim();
}

export function isDefinitionGridCodeBlock(language = "", source = "") {
  const lang = String(language || "")
    .toLowerCase()
    .replace(/^language-/, "")
    .trim();
  const raw = unwrapFence(source);

  return lang === "definitiongrid" || /^@definitionGrid\b/i.test(raw);
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

export function parseDefinitionGridSource(source) {
  const result = {
    definitions: [],
    sections: [],
  };

  const lines = stripOptionalDirective(source)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  let mode = null;
  let currentDefinition = null;
  let currentSection = null;
  let currentTarget = null;

  const requireTitle = (title, directive, lineNumber) => {
    if (!title) {
      throw new DefinitionGridParseError(
        `${directive} doit être suivi d’un titre.`,
        lineNumber
      );
    }
  };

  const requireDefinition = (directive, lineNumber) => {
    if (!currentDefinition) {
      throw new DefinitionGridParseError(
        `${directive} doit être placé dans un bloc @definition.`,
        lineNumber
      );
    }
  };

  const requireSection = (directive, lineNumber) => {
    if (!currentSection) {
      throw new DefinitionGridParseError(
        `${directive} doit être placé dans un bloc @section.`,
        lineNumber
      );
    }
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();

    if (/^<!--.*-->$/.test(trimmed)) return;

    const definitionMatch = trimmed.match(/^@definition\s+(.+)$/i);
    if (definitionMatch) {
      const title = cleanTitle(definitionMatch[1]);
      requireTitle(title, "@definition", lineNumber);
      currentDefinition = {
        title,
        body: createTextBlock(),
        extras: [],
      };
      result.definitions.push(currentDefinition);
      currentSection = null;
      currentTarget = currentDefinition.body;
      mode = "definition";
      return;
    }

    const labelMatch = trimmed.match(/^@label\s+(.+)$/i);
    if (labelMatch) {
      requireDefinition("@label", lineNumber);
      const title = cleanTitle(labelMatch[1]);
      requireTitle(title, "@label", lineNumber);
      const label = { type: "label", title, body: createTextBlock() };
      currentDefinition.extras.push(label);
      currentTarget = label.body;
      mode = "definition-label";
      return;
    }

    const badgeMatch = trimmed.match(/^@badge\s+(.+)$/i);
    if (badgeMatch) {
      requireDefinition("@badge", lineNumber);
      const text = cleanTitle(badgeMatch[1]);
      requireTitle(text, "@badge", lineNumber);
      currentDefinition.extras.push({ type: "badge", text });
      currentTarget = null;
      mode = "definition-badge";
      return;
    }

    const sectionMatch = trimmed.match(/^@section\s+(.+)$/i);
    if (sectionMatch) {
      const title = cleanTitle(sectionMatch[1]);
      requireTitle(title, "@section", lineNumber);
      currentSection = {
        title,
        body: createTextBlock(),
        columns: [],
        intro: null,
        comparisons: [],
      };
      result.sections.push(currentSection);
      currentDefinition = null;
      currentTarget = currentSection.body;
      mode = "section";
      return;
    }

    if (/^@columns\s*$/i.test(trimmed)) {
      requireSection("@columns", lineNumber);
      currentTarget = null;
      mode = "columns";
      return;
    }

    const introMatch = trimmed.match(/^@intro\s+(.+)$/i);
    if (introMatch) {
      requireSection("@intro", lineNumber);
      const title = cleanTitle(introMatch[1]);
      requireTitle(title, "@intro", lineNumber);
      if (currentSection.intro) {
        throw new DefinitionGridParseError(
          "Un seul bloc @intro est autorisé par @section.",
          lineNumber
        );
      }
      currentSection.intro = { title, body: createTextBlock() };
      currentTarget = currentSection.intro.body;
      mode = "intro";
      return;
    }

    const comparisonMatch = trimmed.match(/^@comparison\s+(.+)$/i);
    if (comparisonMatch) {
      requireSection("@comparison", lineNumber);
      const title = cleanTitle(comparisonMatch[1]);
      requireTitle(title, "@comparison", lineNumber);
      const comparison = { title, body: createTextBlock() };
      currentSection.comparisons.push(comparison);
      currentTarget = comparison.body;
      mode = "comparison";
      return;
    }

    const columnMatch = trimmed.match(/^###\s+(.+)$/);
    if (columnMatch) {
      requireSection("###", lineNumber);
      if (mode !== "columns") {
        throw new DefinitionGridParseError(
          "Un titre ### doit être placé après @columns.",
          lineNumber
        );
      }
      const title = cleanTitle(columnMatch[1]);
      requireTitle(title, "###", lineNumber);
      const column = { title, body: createTextBlock() };
      currentSection.columns.push(column);
      currentTarget = column.body;
      return;
    }

    if (/^@/.test(trimmed)) {
      throw new DefinitionGridParseError(
        `Directive inconnue : ${trimmed}`,
        lineNumber
      );
    }

    if (!trimmed) {
      appendLine(currentTarget, "");
      return;
    }

    if (!currentTarget) {
      const expected =
        mode === "columns"
          ? "Ajoute un titre ### après @columns avant d’écrire son contenu."
          : "Cette ligne n’est rattachée à aucun bloc de contenu.";
      throw new DefinitionGridParseError(expected, lineNumber);
    }

    appendLine(currentTarget, rawLine);
  });

  if (result.definitions.length === 0 && result.sections.length === 0) {
    throw new DefinitionGridParseError(
      "Le bloc doit contenir au moins un @definition ou un @section."
    );
  }

  result.definitions.forEach((definition) => {
    const hasBody = Boolean(markdownFromLines(definition.body));
    const hasExtra = definition.extras.some((extra) => {
      if (extra.type === "badge") return Boolean(extra.text);
      return Boolean(markdownFromLines(extra.body));
    });

    if (!hasBody && !hasExtra) {
      throw new DefinitionGridParseError(
        `La définition « ${definition.title} » ne contient aucun contenu.`
      );
    }
  });

  result.sections.forEach((section) => {
    if (section.columns.length === 1) {
      throw new DefinitionGridParseError(
        `La section « ${section.title} » contient une seule colonne. Ajoute une seconde rubrique ### ou supprime @columns.`
      );
    }

    if (section.columns.some((column) => !markdownFromLines(column.body))) {
      throw new DefinitionGridParseError(
        `Une colonne de la section « ${section.title} » est vide.`
      );
    }

    if (
      section.comparisons.some(
        (comparison) => !markdownFromLines(comparison.body)
      )
    ) {
      throw new DefinitionGridParseError(
        `Un bloc @comparison de la section « ${section.title} » est vide.`
      );
    }
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
    return <code className="dfg-inline-code">{children}</code>;
  },
};

function MarkdownBlock({ lines, className = "dfg-markdown" }) {
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

function DefinitionCard({ definition }) {
  return (
    <article className="dfg-definition" aria-label={definition.title}>
      <VisualHeading className="dfg-definition-title" level={3}>
        {definition.title}
      </VisualHeading>

      <div className="dfg-definition-body">
        <MarkdownBlock lines={definition.body} />

        {definition.extras.map((extra, index) => {
          if (extra.type === "label") {
            return (
              <div className="dfg-label" key={`label:${extra.title}:${index}`}>
                <div className="dfg-label-title">{extra.title}</div>
                <MarkdownBlock
                  lines={extra.body}
                  className="dfg-label-content dfg-markdown"
                />
              </div>
            );
          }

          return (
            <div className="dfg-badge" key={`badge:${extra.text}:${index}`}>
              {extra.text}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function DefinitionColumn({ column }) {
  return (
    <section className="dfg-column">
      <VisualHeading className="dfg-column-title" level={4}>
        {column.title}
      </VisualHeading>
      <MarkdownBlock lines={column.body} />
    </section>
  );
}

function DefinitionComparison({ comparison, headingLevel = 5 }) {
  return (
    <section className="dfg-comparison">
      <VisualHeading className="dfg-comparison-title" level={headingLevel}>
        {comparison.title}
      </VisualHeading>
      <div className="dfg-comparison-body">
        <MarkdownBlock lines={comparison.body} />
      </div>
    </section>
  );
}

function DefinitionSection({ section }) {
  return (
    <article className="dfg-section" aria-label={section.title}>
      <VisualHeading className="dfg-section-title" level={3}>
        {section.title}
      </VisualHeading>

      <div className="dfg-section-body">
        <MarkdownBlock lines={section.body} />

        {section.columns.length > 0 && (
          <div
            className="dfg-columns"
            style={{ "--dfg-column-count": String(section.columns.length) }}
          >
            {section.columns.map((column, index) => (
              <DefinitionColumn
                column={column}
                key={`${column.title}:${index}`}
              />
            ))}
          </div>
        )}

        {section.intro && (
          <section
            className={`dfg-intro${
              section.comparisons.length > 0 ? " dfg-intro--with-comparisons" : ""
            }`}
          >
            <VisualHeading className="dfg-intro-title" level={4}>
              {section.intro.title}
            </VisualHeading>
            <MarkdownBlock lines={section.intro.body} />

            {section.comparisons.length > 0 && (
              <div
                className="dfg-comparisons dfg-comparisons--nested"
                style={{
                  "--dfg-comparison-count": String(section.comparisons.length),
                }}
              >
                {section.comparisons.map((comparison, index) => (
                  <DefinitionComparison
                    comparison={comparison}
                    headingLevel={5}
                    key={`${comparison.title}:${index}`}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {!section.intro && section.comparisons.length > 0 && (
          <div
            className="dfg-comparisons dfg-comparisons--standalone"
            style={{
              "--dfg-comparison-count": String(section.comparisons.length),
            }}
          >
            {section.comparisons.map((comparison, index) => (
              <DefinitionComparison
                comparison={comparison}
                headingLevel={4}
                key={`${comparison.title}:${index}`}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function DefinitionGridError({ error }) {
  const linePrefix = error?.lineNumber ? `Ligne ${error.lineNumber} — ` : "";

  return (
    <div className="definition-grid dfg-error" role="alert">
      <strong className="dfg-error-title">Bloc de définitions invalide</strong>
      <div className="dfg-error-message">
        {linePrefix}
        {error?.message || "Erreur inconnue."}
      </div>
      <div className="dfg-error-help">
        Directives disponibles : @definition, @label, @badge, @section,
        @columns, ###, @intro et @comparison.
      </div>
    </div>
  );
}

const DefinitionGrid = memo(function DefinitionGrid({ source = "" }) {
  const result = useMemo(() => {
    try {
      return { data: parseDefinitionGridSource(source), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }, [source]);

  if (result.error || !result.data) {
    return <DefinitionGridError error={result.error} />;
  }

  const { data } = result;

  return (
    <div
      className="definition-grid"
      role="group"
      aria-label="Fiches de définitions"
    >
      {data.definitions.length > 0 && (
        <div
          className="dfg-definitions"
          style={{
            "--dfg-definition-count": String(data.definitions.length),
          }}
        >
          {data.definitions.map((definition, index) => (
            <DefinitionCard
              definition={definition}
              key={`${definition.title}:${index}`}
            />
          ))}
        </div>
      )}

      {data.sections.map((section, index) => (
        <DefinitionSection
          section={section}
          key={`${section.title}:${index}`}
        />
      ))}
    </div>
  );
});

export default DefinitionGrid;
