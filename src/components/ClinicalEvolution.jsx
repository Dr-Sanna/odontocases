import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "./ClinicalEvolution.css";

export class ClinicalEvolutionParseError extends Error {
  constructor(message, lineNumber = null) {
    super(message);
    this.name = "ClinicalEvolutionParseError";
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
    .replace(/^@clinicalEvolution\s*/i, "")
    .trim();
}

export function isClinicalEvolutionCodeBlock(language = "", source = "") {
  const lang = String(language || "")
    .toLowerCase()
    .replace(/^language-/, "")
    .trim();
  const raw = unwrapFence(source);

  return lang === "clinicalevolution" || /^@clinicalEvolution\b/i.test(raw);
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

function createEvolutionSection(type, title, lineNumber) {
  return {
    type,
    title,
    duration: "",
    context: createTextBlock(),
    stages: [],
    profiles: [],
    lineNumber,
  };
}

export function parseClinicalEvolutionSource(source) {
  const result = {
    label: "Formes cliniques évolutives",
    acute: null,
    chronic: null,
  };

  const lines = stripOptionalDirective(source)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  let currentSection = null;
  let currentProfile = null;
  let currentStage = null;
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

    const acuteMatch = trimmed.match(/^@acute(?:\s+(.+))?$/i);
    if (acuteMatch) {
      if (result.acute) {
        throw new ClinicalEvolutionParseError(
          "Un seul bloc @acute est autorisé.",
          lineNumber
        );
      }
      result.acute = createEvolutionSection(
        "acute",
        cleanTitle(acuteMatch[1] || "Adénopathies aiguës"),
        lineNumber
      );
      currentSection = result.acute;
      currentProfile = null;
      currentStage = null;
      currentTarget = null;
      return;
    }

    const chronicMatch = trimmed.match(/^@chronic(?:\s+(.+))?$/i);
    if (chronicMatch) {
      if (result.chronic) {
        throw new ClinicalEvolutionParseError(
          "Un seul bloc @chronic est autorisé.",
          lineNumber
        );
      }
      result.chronic = createEvolutionSection(
        "chronic",
        cleanTitle(chronicMatch[1] || "Adénopathies chroniques"),
        lineNumber
      );
      currentSection = result.chronic;
      currentProfile = null;
      currentStage = null;
      currentTarget = null;
      return;
    }

    const durationMatch = trimmed.match(/^@duration\s+(.+)$/i);
    if (durationMatch) {
      if (!currentSection) {
        throw new ClinicalEvolutionParseError(
          "@duration doit suivre @acute ou @chronic.",
          lineNumber
        );
      }
      currentSection.duration = cleanTitle(durationMatch[1]);
      currentTarget = null;
      return;
    }

    if (/^@context\s*$/i.test(trimmed)) {
      if (!currentSection) {
        throw new ClinicalEvolutionParseError(
          "@context doit suivre @acute ou @chronic.",
          lineNumber
        );
      }
      currentTarget = currentSection.context;
      currentProfile = null;
      currentStage = null;
      return;
    }

    const stageMatch = trimmed.match(/^@stage\s+(.+)$/i);
    if (stageMatch) {
      if (!currentSection || currentSection.type !== "acute") {
        throw new ClinicalEvolutionParseError(
          "@stage doit être placé dans la partie @acute.",
          lineNumber
        );
      }
      const title = cleanTitle(stageMatch[1]);
      if (!title) {
        throw new ClinicalEvolutionParseError(
          "@stage doit être suivi d’un titre.",
          lineNumber
        );
      }
      const stage = {
        title,
        body: createTextBlock(),
        outcome: null,
        lineNumber,
      };
      currentSection.stages.push(stage);
      currentStage = stage;
      currentProfile = null;
      currentTarget = stage.body;
      return;
    }

    const outcomeMatch = trimmed.match(/^@outcome(?:\s+(.+))?$/i);
    if (outcomeMatch) {
      if (!currentStage) {
        throw new ClinicalEvolutionParseError(
          "@outcome doit suivre un @stage.",
          lineNumber
        );
      }
      if (currentStage.outcome) {
        throw new ClinicalEvolutionParseError(
          "Un seul @outcome est autorisé par stade.",
          lineNumber
        );
      }
      currentStage.outcome = {
        title: cleanTitle(outcomeMatch[1] || "Évolution"),
        body: createTextBlock(),
        lineNumber,
      };
      currentTarget = currentStage.outcome.body;
      return;
    }

    const profileMatch = trimmed.match(/^@profile\s+(.+)$/i);
    if (profileMatch) {
      if (!currentSection || currentSection.type !== "chronic") {
        throw new ClinicalEvolutionParseError(
          "@profile doit être placé dans la partie @chronic.",
          lineNumber
        );
      }
      const title = cleanTitle(profileMatch[1]);
      if (!title) {
        throw new ClinicalEvolutionParseError(
          "@profile doit être suivi d’un titre.",
          lineNumber
        );
      }
      const profile = {
        title,
        layout: "compact",
        summary: createTextBlock(),
        metas: [],
        sections: [],
        lineNumber,
      };
      currentSection.profiles.push(profile);
      currentProfile = profile;
      currentStage = null;
      currentTarget = profile.summary;
      return;
    }

    const layoutMatch = trimmed.match(/^@layout\s+(wide|compact)$/i);
    if (layoutMatch) {
      if (!currentProfile) {
        throw new ClinicalEvolutionParseError(
          "@layout doit suivre un @profile.",
          lineNumber
        );
      }
      currentProfile.layout = layoutMatch[1].toLowerCase();
      currentTarget = null;
      return;
    }

    if (/^@summary\s*$/i.test(trimmed)) {
      if (!currentProfile) {
        throw new ClinicalEvolutionParseError(
          "@summary doit suivre un @profile.",
          lineNumber
        );
      }
      currentTarget = currentProfile.summary;
      return;
    }

    const metaMatch = trimmed.match(/^@meta\s+(.+)$/i);
    if (metaMatch) {
      if (!currentProfile) {
        throw new ClinicalEvolutionParseError(
          "@meta doit suivre un @profile.",
          lineNumber
        );
      }
      const meta = {
        title: cleanTitle(metaMatch[1]),
        body: createTextBlock(),
        lineNumber,
      };
      currentProfile.metas.push(meta);
      currentTarget = meta.body;
      return;
    }

    const sectionMatch = trimmed.match(/^@section\s+(.+)$/i);
    if (sectionMatch) {
      if (!currentProfile) {
        throw new ClinicalEvolutionParseError(
          "@section doit suivre un @profile.",
          lineNumber
        );
      }
      const section = {
        title: cleanTitle(sectionMatch[1]),
        body: createTextBlock(),
        lineNumber,
      };
      currentProfile.sections.push(section);
      currentTarget = section.body;
      return;
    }

    if (/^@/.test(trimmed)) {
      throw new ClinicalEvolutionParseError(
        `Directive inconnue : ${trimmed}`,
        lineNumber
      );
    }

    if (!currentTarget) {
      throw new ClinicalEvolutionParseError(
        "Cette ligne doit suivre @context, @stage, @outcome, @profile, @summary, @meta ou @section.",
        lineNumber
      );
    }

    appendLine(currentTarget, rawLine);
  });

  if (!result.acute && !result.chronic) {
    throw new ClinicalEvolutionParseError(
      "Ajoute une partie @acute et/ou @chronic."
    );
  }

  if (result.acute) {
    if (!result.acute.stages.length) {
      throw new ClinicalEvolutionParseError(
        "La partie aiguë doit contenir au moins un @stage.",
        result.acute.lineNumber
      );
    }
    result.acute.stages.forEach((stage) => {
      if (!markdownFromLines(stage.body)) {
        throw new ClinicalEvolutionParseError(
          `Le stade « ${stage.title} » est vide.`,
          stage.lineNumber
        );
      }
      if (stage.outcome && !markdownFromLines(stage.outcome.body)) {
        throw new ClinicalEvolutionParseError(
          `L’évolution « ${stage.outcome.title} » est vide.`,
          stage.outcome.lineNumber
        );
      }
    });
  }

  if (result.chronic) {
    if (!result.chronic.profiles.length) {
      throw new ClinicalEvolutionParseError(
        "La partie chronique doit contenir au moins un @profile.",
        result.chronic.lineNumber
      );
    }
    result.chronic.profiles.forEach((profile) => {
      const hasContent =
        Boolean(markdownFromLines(profile.summary)) ||
        profile.metas.some((meta) => Boolean(markdownFromLines(meta.body))) ||
        profile.sections.some((section) =>
          Boolean(markdownFromLines(section.body))
        );

      if (!hasContent) {
        throw new ClinicalEvolutionParseError(
          `Le profil « ${profile.title} » est vide.`,
          profile.lineNumber
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
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
        {...props}
      >
        {children}
      </a>
    );
  },
  code({ inline, children, ...props }) {
    return inline ? (
      <code className="cev-inline-code" {...props}>
        {children}
      </code>
    ) : (
      <code {...props}>{children}</code>
    );
  },
};

function MarkdownBlock({ source, className = "" }) {
  if (!source) return null;
  return (
    <div className={`cev-markdown ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

function sectionFormsTitle(section) {
  if (section?.type === "acute") {
    return "Formes cliniques des adénopathies aiguës";
  }
  if (section?.type === "chronic") {
    return "Formes cliniques des adénopathies chroniques";
  }
  return `Formes cliniques — ${section?.title || ""}`;
}

function EvolutionOverview({ sections }) {
  return (
    <div
      className="cev-overview"
      style={{ "--cev-overview-count": sections.length }}
    >
      {sections.map((section) => (
        <section
          className={`cev-overview-item cev-overview-${section.type}`}
          key={section.type}
        >
          <div className="cev-overview-header">
            <VisualHeading className="cev-overview-title" level={4}>
              {section.title}
            </VisualHeading>
            {section.duration ? (
              <div className="cev-duration">{section.duration}</div>
            ) : null}
          </div>
          <MarkdownBlock
            source={markdownFromLines(section.context)}
            className="cev-overview-context"
          />
        </section>
      ))}
    </div>
  );
}

function AcuteEvolution({ section }) {
  return (
    <section className="cev-section cev-acute-section">
      <VisualHeading className="cev-section-title" level={3}>
        {sectionFormsTitle(section)}
      </VisualHeading>

      <div
        className="cev-timeline"
        style={{ "--cev-stage-count": section.stages.length }}
      >
        {section.stages.map((stage, index) => (
          <div className="cev-stage-sequence" key={`${stage.title}-${index}`}>
            <article className="cev-stage">
              <div className="cev-stage-number">{index + 1}</div>
              <VisualHeading className="cev-stage-title" level={4}>
                {stage.title}
              </VisualHeading>
              <MarkdownBlock
                source={markdownFromLines(stage.body)}
                className="cev-stage-body"
              />

              {stage.outcome ? (
                <div className="cev-outcome">
                  <div className="cev-outcome-title">{stage.outcome.title}</div>
                  <MarkdownBlock
                    source={markdownFromLines(stage.outcome.body)}
                    className="cev-outcome-body"
                  />
                </div>
              ) : null}
            </article>

            {index < section.stages.length - 1 ? (
              <div className="cev-stage-arrow" aria-hidden="true">
                →
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function ChronicProfile({ profile }) {
  return (
    <article className={`cev-profile cev-profile-${profile.layout}`}>
      <VisualHeading className="cev-profile-title" level={4}>
        {profile.title}
      </VisualHeading>

      {profile.metas.length > 0 ? (
        <div
          className="cev-meta-grid"
          style={{ "--cev-meta-count": profile.metas.length }}
        >
          {profile.metas.map((meta, index) => (
            <div className="cev-meta" key={`${meta.title}-${index}`}>
              <div className="cev-meta-title">{meta.title}</div>
              <MarkdownBlock
                source={markdownFromLines(meta.body)}
                className="cev-meta-body"
              />
            </div>
          ))}
        </div>
      ) : null}

      <MarkdownBlock
        source={markdownFromLines(profile.summary)}
        className="cev-profile-summary"
      />

      {profile.sections.length > 0 ? (
        <div
          className="cev-profile-sections"
          style={{ "--cev-section-count": profile.sections.length }}
        >
          {profile.sections.map((profileSection, index) => (
            <section
              className="cev-profile-section"
              key={`${profileSection.title}-${index}`}
            >
              <VisualHeading className="cev-profile-section-title" level={5}>
                {profileSection.title}
              </VisualHeading>
              <MarkdownBlock
                source={markdownFromLines(profileSection.body)}
                className="cev-profile-section-body"
              />
            </section>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ChronicEvolution({ section }) {
  return (
    <section className="cev-section cev-chronic-section">
      <VisualHeading className="cev-section-title" level={3}>
        {sectionFormsTitle(section)}
      </VisualHeading>

      <div className="cev-profiles">
        {section.profiles.map((profile, index) => (
          <ChronicProfile profile={profile} key={`${profile.title}-${index}`} />
        ))}
      </div>
    </section>
  );
}

const ClinicalEvolution = memo(function ClinicalEvolution({ source = "" }) {
  const parsed = useMemo(() => {
    try {
      return { data: parseClinicalEvolutionSource(source), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }, [source]);

  if (parsed.error) {
    const linePrefix = parsed.error?.lineNumber
      ? `Ligne ${parsed.error.lineNumber} — `
      : "";

    return (
      <div className="clinical-evolution cev-error" role="alert">
        <strong className="cev-error-title">
          Formes cliniques évolutives invalides
        </strong>
        <div className="cev-error-message">
          {linePrefix}
          {String(parsed.error?.message || "Erreur inconnue.")}
        </div>
        <div className="cev-error-help">
          Directives : @label, @acute, @chronic, @duration, @context, @stage,
          @outcome, @profile, @layout, @summary, @meta et @section.
        </div>
      </div>
    );
  }

  const { data } = parsed;
  const sections = [data.acute, data.chronic].filter(Boolean);

  return (
    <div
      className="clinical-evolution cev"
      role="group"
      aria-label={data.label || "Formes cliniques évolutives"}
    >
      <EvolutionOverview sections={sections} />
      {data.acute ? <AcuteEvolution section={data.acute} /> : null}
      {data.chronic ? <ChronicEvolution section={data.chronic} /> : null}
    </div>
  );
});

export default ClinicalEvolution;
