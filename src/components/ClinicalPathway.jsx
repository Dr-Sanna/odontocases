import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "./ClinicalPathway.css";

export class ClinicalPathwayParseError extends Error {
  constructor(message, lineNumber = null) {
    super(message);
    this.name = "ClinicalPathwayParseError";
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
    .replace(/^@clinicalPathway\s*/i, "")
    .trim();
}

export function isClinicalPathwayCodeBlock(language = "", source = "") {
  const lang = String(language || "")
    .toLowerCase()
    .replace(/^language-/, "")
    .trim();
  const raw = unwrapFence(source);

  return lang === "clinicalpathway" || /^@clinicalPathway\b/i.test(raw);
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

function normalizeClinicalBranchKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "oui" || key === "yes") return "yes";
  if (key === "non" || key === "no") return "no";
  return key.replace(/[^a-z0-9_-]+/g, "-") || "branch";
}

function clinicalBranchLabel(key, raw) {
  if (key === "yes") return "Oui";
  if (key === "no") return "Non";
  const clean = cleanTitle(raw || key);
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "Branche";
}

export function parseClinicalPathwaySource(source) {
  const result = {
    label: "Conduite clinique",
    intro: createTextBlock(),
    flowTitle: "Démarche décisionnelle",
    steps: [],
    decision: null,
    branches: [],
    note: createTextBlock(),
    orientationTitle: "Orientation selon l’hémogramme",
    orientations: [],
  };

  const lines = stripOptionalDirective(source)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

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
      currentTarget = result.intro;
      return;
    }

    const flowTitleMatch = trimmed.match(/^@flowTitle\s+(.+)$/i);
    if (flowTitleMatch) {
      result.flowTitle = cleanTitle(flowTitleMatch[1]) || result.flowTitle;
      currentTarget = null;
      return;
    }

    const stepMatch = trimmed.match(/^@step\s+(.+)$/i);
    if (stepMatch) {
      const title = cleanTitle(stepMatch[1]);
      if (!title) {
        throw new ClinicalPathwayParseError(
          "@step doit être suivi d’un intitulé.",
          lineNumber
        );
      }
      const step = { title, body: createTextBlock(), lineNumber };
      result.steps.push(step);
      currentTarget = step.body;
      return;
    }

    const decisionMatch = trimmed.match(/^@decision\s+(.+)$/i);
    if (decisionMatch) {
      if (result.decision) {
        throw new ClinicalPathwayParseError(
          "Un seul @decision est autorisé par bloc.",
          lineNumber
        );
      }
      const title = cleanTitle(decisionMatch[1]);
      if (!title) {
        throw new ClinicalPathwayParseError(
          "@decision doit être suivi d’une question.",
          lineNumber
        );
      }
      result.decision = { title, body: createTextBlock(), lineNumber };
      currentTarget = result.decision.body;
      return;
    }

    const branchMatch = trimmed.match(/^@branch\s+(\S+)(?:\s+(.+))?$/i);
    if (branchMatch) {
      if (!result.decision) {
        throw new ClinicalPathwayParseError(
          "@branch doit être placé après @decision.",
          lineNumber
        );
      }
      const rawKey = branchMatch[1];
      const key = normalizeClinicalBranchKey(rawKey);
      const branch = {
        key,
        label: clinicalBranchLabel(key, rawKey),
        title: cleanTitle(branchMatch[2] || ""),
        body: createTextBlock(),
        lineNumber,
      };
      result.branches.push(branch);
      currentTarget = branch.body;
      return;
    }

    if (/^@note\s*$/i.test(trimmed)) {
      currentTarget = result.note;
      return;
    }

    const orientationTitleMatch = trimmed.match(/^@orientationTitle\s+(.+)$/i);
    if (orientationTitleMatch) {
      result.orientationTitle =
        cleanTitle(orientationTitleMatch[1]) || result.orientationTitle;
      currentTarget = null;
      return;
    }

    const orientationMatch = trimmed.match(/^@orientation\s+(.+)$/i);
    if (orientationMatch) {
      const title = cleanTitle(orientationMatch[1]);
      if (!title) {
        throw new ClinicalPathwayParseError(
          "@orientation doit être suivi d’un résultat ou d’une situation.",
          lineNumber
        );
      }
      const orientation = { title, body: createTextBlock(), lineNumber };
      result.orientations.push(orientation);
      currentTarget = orientation.body;
      return;
    }

    if (/^@/.test(trimmed)) {
      throw new ClinicalPathwayParseError(
        `Directive inconnue : ${trimmed}`,
        lineNumber
      );
    }

    if (!currentTarget) {
      throw new ClinicalPathwayParseError(
        "Cette ligne doit suivre @intro, @step, @decision, @branch, @note ou @orientation.",
        lineNumber
      );
    }

    appendLine(currentTarget, rawLine);
  });

  const hasFlow =
    result.steps.length > 0 || Boolean(result.decision) || result.branches.length > 0;
  const hasOrientations = result.orientations.length > 0;

  if (!hasFlow && !hasOrientations) {
    throw new ClinicalPathwayParseError(
      "Ajoute au moins un @step, un @decision ou une @orientation."
    );
  }

  if (result.decision && result.branches.length < 2) {
    throw new ClinicalPathwayParseError(
      "Une décision doit comporter au moins deux branches avec @branch."
    );
  }

  result.branches.forEach((branch) => {
    if (!markdownFromLines(branch.body)) {
      throw new ClinicalPathwayParseError(
        `La branche « ${branch.label} » ne contient aucune conduite à tenir.`,
        branch.lineNumber
      );
    }
  });

  result.orientations.forEach((orientation) => {
    if (!markdownFromLines(orientation.body)) {
      throw new ClinicalPathwayParseError(
        `L’orientation « ${orientation.title} » ne contient aucune conduite.`,
        orientation.lineNumber
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
    return <code className="cpg-inline-code">{children}</code>;
  },
};

function MarkdownBlock({ lines, className = "" }) {
  const markdown = markdownFromLines(lines);
  if (!markdown) return null;

  return (
    <div className={`cpg-markdown ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function ClinicalStep({ step, number }) {
  return (
    <div className="cpg-step-row">
      <div className="cpg-step-number" aria-hidden="true">
        {number}
      </div>
      <div className="cpg-step-card">
        <VisualHeading className="cpg-step-title" level={4}>
          {step.title}
        </VisualHeading>
        <MarkdownBlock lines={step.body} className="cpg-step-body" />
      </div>
    </div>
  );
}

function ClinicalBranch({ branch }) {
  return (
    <article className={`cpg-branch cpg-branch-${branch.key}`}>
      <div className="cpg-branch-label">{branch.label}</div>
      {branch.title && (
        <VisualHeading className="cpg-branch-title" level={4}>
          {branch.title}
        </VisualHeading>
      )}
      <MarkdownBlock lines={branch.body} className="cpg-branch-body" />
    </article>
  );
}

function ClinicalOrientation({ orientation }) {
  return (
    <div className="cpg-orientation-row" role="row">
      <div className="cpg-orientation-result" role="cell">
        {orientation.title}
      </div>
      <MarkdownBlock
        lines={orientation.body}
        className="cpg-orientation-action"
      />
    </div>
  );
}

const ClinicalPathway = memo(function ClinicalPathway({ source = "" }) {
  const parsed = useMemo(() => {
    try {
      return { data: parseClinicalPathwaySource(source), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }, [source]);

  if (parsed.error) {
    const linePrefix = parsed.error?.lineNumber
      ? `Ligne ${parsed.error.lineNumber} — `
      : "";

    return (
      <div className="clinical-pathway cpg-error" role="alert">
        <strong className="cpg-error-title">Conduite clinique invalide</strong>
        <div className="cpg-error-message">
          {linePrefix}
          {String(parsed.error?.message || "Erreur inconnue.")}
        </div>
        <div className="cpg-error-help">
          Directives disponibles : @label, @intro, @flowTitle, @step,
          @decision, @branch, @note, @orientationTitle et @orientation.
        </div>
      </div>
    );
  }

  const data = parsed.data;
  const hasFlow =
    data.steps.length > 0 || Boolean(data.decision) || data.branches.length > 0;
  let sectionNumber = 1;

  return (
    <div
      className="clinical-pathway cpg-react"
      role="group"
      aria-label={data.label || "Conduite clinique"}
    >
      <MarkdownBlock lines={data.intro} className="cpg-intro" />

      {hasFlow && (
        <section className="cpg-panel cpg-flow-panel">
          <VisualHeading className="cpg-panel-title" level={3}>
            {sectionNumber++}. {data.flowTitle}
          </VisualHeading>

          {data.steps.length > 0 && (
            <div className="cpg-steps">
              {data.steps.map((step, index) => (
                <div className="cpg-step-sequence" key={`${step.title}-${index}`}>
                  <ClinicalStep step={step} number={index + 1} />
                  {(index < data.steps.length - 1 || data.decision) && (
                    <div className="cpg-flow-arrow" aria-hidden="true">
                      ↓
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {data.decision && (
            <div className="cpg-decision">
              <VisualHeading className="cpg-decision-title" level={4}>
                {data.decision.title}
              </VisualHeading>
              <MarkdownBlock
                lines={data.decision.body}
                className="cpg-decision-body"
              />
            </div>
          )}

          {data.branches.length > 0 && (
            <div
              className="cpg-branches"
              style={{ "--cpg-branch-count": data.branches.length }}
            >
              {data.branches.map((branch, index) => (
                <ClinicalBranch branch={branch} key={`${branch.key}-${index}`} />
              ))}
            </div>
          )}

          <MarkdownBlock lines={data.note} className="cpg-note" />
        </section>
      )}

      {data.orientations.length > 0 && (
        <section className="cpg-panel cpg-orientation-panel">
          <VisualHeading className="cpg-panel-title" level={3}>
            {sectionNumber}. {data.orientationTitle}
          </VisualHeading>

          <div className="cpg-orientation-table" role="table">
            <div className="cpg-orientation-header" role="row">
              <div className="cpg-orientation-head" role="columnheader">
                Résultat / situation
              </div>
              <div className="cpg-orientation-head" role="columnheader">
                Orientation / examen
              </div>
            </div>

            {data.orientations.map((orientation, index) => (
              <ClinicalOrientation
                orientation={orientation}
                key={`${orientation.title}-${index}`}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
});

export default ClinicalPathway;
