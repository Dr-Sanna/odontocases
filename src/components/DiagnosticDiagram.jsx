import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "./DiagnosticDiagram.css";

export class DiagnosticDiagramParseError extends Error {
  constructor(message, lineNumber = null) {
    super(message);
    this.name = "DiagnosticDiagramParseError";
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
    .replace(/^@diagnosticDiagram\s*/i, "")
    .trim();
}

export function isDiagnosticDiagramCodeBlock(language = "", source = "") {
  const lang = String(language || "")
    .toLowerCase()
    .replace(/^language-/, "")
    .trim();
  const raw = unwrapFence(source);

  return lang === "diagnosticdiagram" || /^@diagnosticDiagram\b/i.test(raw);
}

export function parseDiagnosticDiagramSource(source) {
  const diagram = {
    groups: [],
    followup: null,
    notes: [],
  };

  const lines = stripOptionalDirective(source)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  let mode = null;
  let currentGroup = null;
  let currentCard = null;
  let currentSection = null;
  let lastItem = null;

  const resetLocalContext = () => {
    currentCard = null;
    currentSection = null;
    lastItem = null;
  };

  const requireTitle = (title, directive, lineNumber) => {
    if (!title) {
      throw new DiagnosticDiagramParseError(
        `${directive} doit être suivi d’un titre.`,
        lineNumber
      );
    }
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();

    if (!trimmed || /^<!--.*-->$/.test(trimmed)) return;

    const groupMatch = trimmed.match(/^@group\s+(.+)$/i);
    if (groupMatch) {
      const title = cleanTitle(groupMatch[1]);
      requireTitle(title, "@group", lineNumber);
      currentGroup = { title, cards: [] };
      diagram.groups.push(currentGroup);
      mode = "group";
      resetLocalContext();
      return;
    }

    const followupMatch = trimmed.match(/^@followup(?:\s+(.+))?$/i);
    if (followupMatch) {
      const title = cleanTitle(followupMatch[1]);
      requireTitle(title, "@followup", lineNumber);
      if (diagram.followup) {
        throw new DiagnosticDiagramParseError(
          "Un seul bloc @followup est autorisé.",
          lineNumber
        );
      }
      diagram.followup = { title, sections: [] };
      mode = "followup";
      currentGroup = null;
      resetLocalContext();
      return;
    }

    if (/^@notes\s*$/i.test(trimmed)) {
      mode = "notes";
      currentGroup = null;
      resetLocalContext();
      return;
    }

    if (/^@/.test(trimmed)) {
      throw new DiagnosticDiagramParseError(
        `Directive inconnue : ${trimmed}`,
        lineNumber
      );
    }

    const cardMatch = trimmed.match(/^##\s+(.+)$/);
    if (cardMatch) {
      if (mode !== "group" || !currentGroup) {
        throw new DiagnosticDiagramParseError(
          "Un titre ## doit être placé après un @group.",
          lineNumber
        );
      }
      const title = cleanTitle(cardMatch[1]);
      requireTitle(title, "##", lineNumber);
      currentCard = { title, sections: [] };
      currentGroup.cards.push(currentCard);
      currentSection = null;
      lastItem = null;
      return;
    }

    const sectionMatch = trimmed.match(/^###\s+(.+)$/);
    if (sectionMatch) {
      const title = cleanTitle(sectionMatch[1]);
      requireTitle(title, "###", lineNumber);

      if (mode === "group") {
        if (!currentCard) {
          throw new DiagnosticDiagramParseError(
            "Un titre ### doit être placé dans une carte ##.",
            lineNumber
          );
        }
        currentSection = { title, items: [] };
        currentCard.sections.push(currentSection);
      } else if (mode === "followup" && diagram.followup) {
        currentSection = { title, items: [] };
        diagram.followup.sections.push(currentSection);
      } else {
        throw new DiagnosticDiagramParseError(
          "Un titre ### doit être placé dans une carte ou dans @followup.",
          lineNumber
        );
      }

      lastItem = null;
      return;
    }

    const itemMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (itemMatch) {
      const text = itemMatch[1].trim();
      if (!text) return;

      if (mode === "notes") {
        diagram.notes.push(text);
        lastItem = {
          owner: diagram.notes,
          index: diagram.notes.length - 1,
        };
        return;
      }

      if (!currentSection) {
        throw new DiagnosticDiagramParseError(
          "Une puce doit être placée sous un titre ###.",
          lineNumber
        );
      }

      currentSection.items.push(text);
      lastItem = {
        owner: currentSection.items,
        index: currentSection.items.length - 1,
      };
      return;
    }

    // Une ligne libre prolonge la dernière puce, comme dans le plugin Obsidian.
    if (lastItem) {
      lastItem.owner[lastItem.index] = `${lastItem.owner[lastItem.index]} ${trimmed}`.trim();
      return;
    }

    throw new DiagnosticDiagramParseError(
      "Ligne non reconnue. Utilise @group, ##, ###, une puce, @followup ou @notes.",
      lineNumber
    );
  });

  if (diagram.groups.length === 0) {
    throw new DiagnosticDiagramParseError(
      "Le diagramme doit contenir au moins un @group."
    );
  }

  diagram.groups.forEach((group) => {
    if (group.cards.length === 0) {
      throw new DiagnosticDiagramParseError(
        `Le groupe « ${group.title} » ne contient aucune carte ##.`
      );
    }

    group.cards.forEach((card) => {
      if (card.sections.length === 0) {
        throw new DiagnosticDiagramParseError(
          `La carte « ${card.title} » ne contient aucune rubrique ###.`
        );
      }
    });
  });

  if (diagram.followup && diagram.followup.sections.length === 0) {
    throw new DiagnosticDiagramParseError(
      `Le bloc « ${diagram.followup.title} » ne contient aucune rubrique ###.`
    );
  }

  return diagram;
}

function comparableTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function VisualHeading({ className, level, children }) {
  return (
    <div className={className} role="heading" aria-level={level}>
      {children}
    </div>
  );
}

const inlineMarkdownComponents = {
  p({ children }) {
    return <span className="dd-inline-fragment">{children}</span>;
  },
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
    return <code className="dd-inline-code">{children}</code>;
  },
};

function InlineMarkdown({ children }) {
  return (
    <span className="dd-inline-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={inlineMarkdownComponents}
        skipHtml
      >
        {String(children || "")}
      </ReactMarkdown>
    </span>
  );
}

function DiagramSection({ section, variant = "primary" }) {
  return (
    <section className={`dd-section dd-section--${variant}`}>
      <VisualHeading className="dd-section-title" level={4}>
        {section.title}
      </VisualHeading>

      <ul className="dd-list">
        {section.items.map((item, index) => (
          <li className="dd-list-item" key={`${section.title}:${index}`}>
            <InlineMarkdown>{item}</InlineMarkdown>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DiagramCard({ card, groupTitle }) {
  const titleIsRedundant =
    comparableTitle(card.title) === comparableTitle(groupTitle);

  return (
    <article
      className={`dd-card${titleIsRedundant ? " dd-card--title-redundant" : ""}`}
      aria-label={card.title}
    >
      {!titleIsRedundant && (
        <VisualHeading className="dd-card-title" level={3}>
          {card.title}
        </VisualHeading>
      )}

      <div className="dd-card-body">
        {card.sections.map((section, index) => (
          <DiagramSection
            section={section}
            key={`${card.title}:${section.title}:${index}`}
          />
        ))}
      </div>
    </article>
  );
}

function DiagnosticDiagramError({ error }) {
  const linePrefix = error?.lineNumber ? `Ligne ${error.lineNumber} — ` : "";

  return (
    <div className="diagnostic-diagram dd-error" role="alert">
      <strong className="dd-error-title">Diagramme diagnostique invalide</strong>
      <div className="dd-error-message">
        {linePrefix}
        {error?.message || "Erreur inconnue."}
      </div>
      <div className="dd-error-help">
        Structure attendue : @group → ## carte → ### rubrique → puces ; puis
        @followup et @notes si nécessaire.
      </div>
    </div>
  );
}

const DiagnosticDiagram = memo(function DiagnosticDiagram({ source = "" }) {
  const result = useMemo(() => {
    try {
      return { diagram: parseDiagnosticDiagramSource(source), error: null };
    } catch (error) {
      return { diagram: null, error };
    }
  }, [source]);

  if (result.error || !result.diagram) {
    return <DiagnosticDiagramError error={result.error} />;
  }

  const { diagram } = result;

  return (
    <div
      className="diagnostic-diagram"
      role="group"
      aria-label="Diagramme diagnostique"
    >
      <div className="dd-groups">
        {diagram.groups.map((group, groupIndex) => (
          <section
            className="dd-group"
            key={`${group.title}:${groupIndex}`}
            style={{
              "--dd-card-count": String(Math.max(1, group.cards.length)),
              "--dd-group-weight": String(Math.max(1, group.cards.length)),
            }}
          >
            <VisualHeading className="dd-group-title" level={2}>
              {group.title}
            </VisualHeading>
            <div className="dd-group-connector" aria-hidden="true" />

            <div className="dd-cards">
              {group.cards.map((card, cardIndex) => (
                <DiagramCard
                  card={card}
                  groupTitle={group.title}
                  key={`${group.title}:${card.title}:${cardIndex}`}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {diagram.followup && (
        <>
          <div className="dd-convergence" aria-hidden="true">
            <span className="dd-convergence-line" />
            <span className="dd-convergence-arrow">↓</span>
          </div>

          <section className="dd-followup">
            <VisualHeading className="dd-followup-title" level={2}>
              {diagram.followup.title}
            </VisualHeading>

            <div className="dd-followup-grid">
              {diagram.followup.sections.map((section, index) => (
                <DiagramSection
                  section={section}
                  variant="followup"
                  key={`${section.title}:${index}`}
                />
              ))}
            </div>
          </section>
        </>
      )}

      {diagram.notes.length > 0 && (
        <aside className="dd-notes">
          <div className="dd-notes-title" aria-hidden="true">
            Repères
          </div>
          <ul className="dd-notes-list">
            {diagram.notes.map((note, index) => (
              <li className="dd-note" key={`note:${index}`}>
                <InlineMarkdown>{note}</InlineMarkdown>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
});

export default DiagnosticDiagram;
