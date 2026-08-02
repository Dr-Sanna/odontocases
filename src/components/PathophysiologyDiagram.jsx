import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "./PathophysiologyDiagram.css";

export class PathophysiologyDiagramParseError extends Error {
  constructor(message, lineNumber = null) {
    super(message);
    this.name = "PathophysiologyDiagramParseError";
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
    .replace(/^@pathophysiologyDiagram\s*/i, "")
    .trim();
}

export function isPathophysiologyDiagramCodeBlock(language = "", source = "") {
  const lang = String(language || "")
    .toLowerCase()
    .replace(/^language-/, "")
    .trim();
  const raw = unwrapFence(source);

  return (
    lang === "pathophysiologydiagram" ||
    /^@pathophysiologyDiagram\b/i.test(raw)
  );
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

function createNode(title, lineNumber) {
  return {
    title: cleanTitle(title),
    body: createTextBlock(),
    lineNumber,
  };
}

export function parsePathophysiologyDiagramSource(source) {
  const result = {
    label: "Diagramme physiopathologique",
    steps: [],
    balance: null,
    branches: [],
    outcome: null,
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

    const stepMatch = trimmed.match(/^@step\s+(.+)$/i);
    if (stepMatch) {
      const node = createNode(stepMatch[1], lineNumber);
      if (!node.title) {
        throw new PathophysiologyDiagramParseError(
          "@step doit être suivi d’un intitulé.",
          lineNumber
        );
      }
      result.steps.push(node);
      currentTarget = node.body;
      return;
    }

    const balanceMatch = trimmed.match(/^@balance\s+(.+)$/i);
    if (balanceMatch) {
      if (result.balance) {
        throw new PathophysiologyDiagramParseError(
          "Un seul @balance est autorisé.",
          lineNumber
        );
      }
      const node = createNode(balanceMatch[1], lineNumber);
      if (!node.title) {
        throw new PathophysiologyDiagramParseError(
          "@balance doit être suivi d’un intitulé.",
          lineNumber
        );
      }
      result.balance = node;
      currentTarget = node.body;
      return;
    }

    const branchMatch = trimmed.match(/^@branch\s+(.+)$/i);
    if (branchMatch) {
      const node = createNode(branchMatch[1], lineNumber);
      if (!node.title) {
        throw new PathophysiologyDiagramParseError(
          "@branch doit être suivi d’un intitulé.",
          lineNumber
        );
      }
      result.branches.push(node);
      currentTarget = node.body;
      return;
    }

    const outcomeMatch = trimmed.match(/^@outcome\s+(.+)$/i);
    if (outcomeMatch) {
      if (result.outcome) {
        throw new PathophysiologyDiagramParseError(
          "Un seul @outcome est autorisé.",
          lineNumber
        );
      }
      const node = createNode(outcomeMatch[1], lineNumber);
      if (!node.title) {
        throw new PathophysiologyDiagramParseError(
          "@outcome doit être suivi d’un intitulé.",
          lineNumber
        );
      }
      result.outcome = node;
      currentTarget = node.body;
      return;
    }

    if (/^@/.test(trimmed)) {
      throw new PathophysiologyDiagramParseError(
        `Directive inconnue : ${trimmed}`,
        lineNumber
      );
    }

    if (!currentTarget) {
      throw new PathophysiologyDiagramParseError(
        "Cette ligne doit suivre @step, @balance, @branch ou @outcome.",
        lineNumber
      );
    }

    appendLine(currentTarget, rawLine);
  });

  if (result.steps.length !== 3) {
    throw new PathophysiologyDiagramParseError(
      "Ce diagramme attend exactement trois étapes initiales avec @step."
    );
  }
  if (!result.balance) {
    throw new PathophysiologyDiagramParseError(
      "Ajoute un état central avec @balance."
    );
  }
  if (result.branches.length !== 2) {
    throw new PathophysiologyDiagramParseError(
      "Le diagramme doit contenir exactement deux évolutions avec @branch."
    );
  }
  if (!result.outcome) {
    throw new PathophysiologyDiagramParseError(
      "Ajoute l’issue finale avec @outcome."
    );
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
    return <code className="pdg-inline-code">{children}</code>;
  },
};

function MarkdownBlock({ lines, className = "" }) {
  const markdown = markdownFromLines(lines);
  if (!markdown) return null;

  return (
    <div className={`pdg-markdown ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function DiagramCard({ node, className = "", level = 4, nodeRef = null }) {
  return (
    <article ref={nodeRef} className={`pdg-card ${className}`.trim()}>
      <VisualHeading className="pdg-card-title" level={level}>
        {node.title}
      </VisualHeading>
      <MarkdownBlock lines={node.body} className="pdg-card-body" />
    </article>
  );
}

function relativeRect(element, containerRect) {
  if (!element || !containerRect) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - containerRect.left,
    right: rect.right - containerRect.left,
    top: rect.top - containerRect.top,
    bottom: rect.bottom - containerRect.top,
    width: rect.width,
    height: rect.height,
    centerX: rect.left - containerRect.left + rect.width / 2,
    centerY: rect.top - containerRect.top + rect.height / 2,
  };
}

function buildConnectorPaths(rects) {
  const { steps, balance, branches, outcome } = rects;
  if (
    steps.some((rect) => !rect) ||
    !balance ||
    branches.some((rect) => !rect) ||
    !outcome
  ) {
    return [];
  }

  const [process, pulpitis, necrosis] = steps;
  const [chronic, acute] = branches;
  const gap = 3;
  const railY = necrosis.bottom + Math.max(12, (balance.top - necrosis.bottom) * 0.36);
  const chronicEntryX = chronic.centerX;
  const acuteEntryX = Math.min(
    acute.right - acute.width * 0.18,
    Math.max(acute.left + acute.width * 0.18, necrosis.centerX)
  );
  const balanceY = balance.centerY;
  const crossY1 = chronic.top + Math.min(28, chronic.height * 0.34);
  const crossY2 = chronic.top + Math.min(58, chronic.height * 0.70);
  const chronicOutcomeX = chronic.right - chronic.width * 0.22;
  const acuteOutcomeX = acute.left + acute.width * 0.22;

  return [
    {
      key: "sequence-1",
      d: `M ${process.right + gap} ${process.centerY} H ${pulpitis.left - gap}`,
    },
    {
      key: "sequence-2",
      d: `M ${pulpitis.right + gap} ${pulpitis.centerY} H ${necrosis.left - gap}`,
    },
    {
      key: "necrosis-chronic",
      d: `M ${necrosis.centerX} ${railY} H ${chronicEntryX} V ${chronic.top - gap}`,
    },
    {
      key: "necrosis-acute",
      d: `M ${necrosis.centerX} ${necrosis.bottom + gap} V ${acute.top - gap}`,
    },
    {
      key: "balance-left",
      d: `M ${balance.left - gap} ${balanceY} H ${chronicEntryX}`,
    },
    {
      key: "balance-right",
      d: `M ${balance.right + gap} ${balanceY} H ${acuteEntryX}`,
    },
    {
      key: "branch-forward",
      d: `M ${chronic.right + gap} ${crossY1} H ${acute.left - gap}`,
    },
    {
      key: "branch-backward",
      d: `M ${acute.left - gap} ${crossY2} H ${chronic.right + gap}`,
    },
    {
      key: "chronic-outcome",
      d: `M ${chronicOutcomeX} ${chronic.bottom + gap} V ${outcome.top - gap}`,
    },
    {
      key: "acute-outcome",
      d: `M ${acuteOutcomeX} ${acute.bottom + gap} V ${outcome.top - gap}`,
    },
  ];
}

const PathophysiologyDiagram = memo(function PathophysiologyDiagram({
  source = "",
}) {
  const parsed = useMemo(() => {
    try {
      return { data: parsePathophysiologyDiagramSource(source), error: null };
    } catch (error) {
      return { data: null, error };
    }
  }, [source]);

  const canvasRef = useRef(null);
  const stepRefs = useRef([]);
  const balanceRef = useRef(null);
  const branchRefs = useRef([]);
  const outcomeRef = useRef(null);
  const [geometry, setGeometry] = useState({ width: 1, height: 1, paths: [] });
  const markerId = `pdg-arrow-${useId().replace(/:/g, "")}`;

  const updateGeometry = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !parsed.data) return;

    const containerRect = canvas.getBoundingClientRect();
    const rects = {
      steps: parsed.data.steps.map((_, index) =>
        relativeRect(stepRefs.current[index], containerRect)
      ),
      balance: relativeRect(balanceRef.current, containerRect),
      branches: parsed.data.branches.map((_, index) =>
        relativeRect(branchRefs.current[index], containerRect)
      ),
      outcome: relativeRect(outcomeRef.current, containerRect),
    };

    setGeometry({
      width: Math.max(1, containerRect.width),
      height: Math.max(1, containerRect.height),
      paths: buildConnectorPaths(rects),
    });
  }, [parsed.data]);

  useLayoutEffect(() => {
    if (!parsed.data || !canvasRef.current) return undefined;

    let frame = requestAnimationFrame(updateGeometry);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateGeometry);
    });

    observer.observe(canvasRef.current);
    stepRefs.current.forEach((node) => node && observer.observe(node));
    if (balanceRef.current) observer.observe(balanceRef.current);
    branchRefs.current.forEach((node) => node && observer.observe(node));
    if (outcomeRef.current) observer.observe(outcomeRef.current);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [parsed.data, updateGeometry]);

  if (parsed.error) {
    const linePrefix = parsed.error?.lineNumber
      ? `Ligne ${parsed.error.lineNumber} — `
      : "";

    return (
      <div className="pathophysiology-diagram pdg-error" role="alert">
        <strong className="pdg-error-title">
          Diagramme physiopathologique invalide
        </strong>
        <div className="pdg-error-message">
          {linePrefix}
          {String(parsed.error?.message || "Erreur inconnue.")}
        </div>
        <div className="pdg-error-help">
          Directives disponibles : @label, @step, @balance, @branch et
          @outcome.
        </div>
      </div>
    );
  }

  const data = parsed.data;

  return (
    <div
      className="pathophysiology-diagram pdg-react"
      role="group"
      aria-label={data.label}
    >
      <VisualHeading className="pdg-title" level={3}>
        {data.label}
      </VisualHeading>

      <div className="pdg-scroll">
        <div ref={canvasRef} className="pdg-canvas">
          <svg
            className="pdg-connectors"
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <marker
                id={markerId}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" className="pdg-marker" />
              </marker>
            </defs>
            {geometry.paths.map((path) => (
              <path
                key={path.key}
                d={path.d}
                className="pdg-connector"
                markerEnd={`url(#${markerId})`}
              />
            ))}
          </svg>

          <div className="pdg-sequence">
            {data.steps.map((step, index) => (
              <DiagramCard
                key={`${step.title}-${index}`}
                node={step}
                className="pdg-step-card"
                nodeRef={(node) => {
                  stepRefs.current[index] = node;
                }}
              />
            ))}
          </div>

          <div className="pdg-balance-wrap">
            <DiagramCard
              node={data.balance}
              className="pdg-balance-card"
              nodeRef={balanceRef}
            />
          </div>

          <div className="pdg-branches">
            {data.branches.map((branch, index) => (
              <DiagramCard
                key={`${branch.title}-${index}`}
                node={branch}
                className="pdg-branch-card"
                nodeRef={(node) => {
                  branchRefs.current[index] = node;
                }}
              />
            ))}
          </div>

          <div className="pdg-outcome-wrap">
            <DiagramCard
              node={data.outcome}
              className="pdg-outcome-card"
              level={3}
              nodeRef={outcomeRef}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

export default PathophysiologyDiagram;
