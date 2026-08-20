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
    groups: [],
    graph: null,
  };

  const lines = stripOptionalDirective(source)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  let currentTarget = null;
  let currentGroup = null;

  const ensureGraphMode = (lineNumber) => {
    if (!result.graph) {
      throw new PathophysiologyDiagramParseError(
        "Ajoute @graph avant @node, @edge, @titleStyle ou @frame.",
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

    const labelMatch = trimmed.match(/^@label\s+(.+)$/i);
    if (labelMatch) {
      result.label = cleanTitle(labelMatch[1]) || result.label;
      currentTarget = null;
      return;
    }

    const graphMatch = trimmed.match(/^@graph(?:\s+(\d+))?\s*$/i);
    if (graphMatch) {
      if (result.graph) {
        throw new PathophysiologyDiagramParseError(
          "Un seul @graph est autorisé.",
          lineNumber
        );
      }
      const columns = Math.max(1, Math.min(24, Number(graphMatch[1]) || 12));
      result.graph = {
        columns,
        nodes: [],
        edges: [],
        titleStyle: "bar",
        frame: false,
      };
      currentGroup = null;
      currentTarget = null;
      return;
    }

    const titleStyleMatch = trimmed.match(/^@titleStyle\s+(bar|plain)$/i);
    if (titleStyleMatch) {
      ensureGraphMode(lineNumber);
      result.graph.titleStyle = titleStyleMatch[1].toLowerCase();
      currentTarget = null;
      return;
    }

    const frameMatch = trimmed.match(/^@frame(?:\s+(on|off|true|false))?\s*$/i);
    if (frameMatch) {
      ensureGraphMode(lineNumber);
      const value = (frameMatch[1] || "on").toLowerCase();
      result.graph.frame = value === "on" || value === "true";
      currentTarget = null;
      return;
    }

    const nodeMatch = trimmed.match(
      /^@node\s+([A-Za-z0-9_-]+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([A-Za-z-]+)\s*\|\s*(.+)$/i
    );
    if (nodeMatch) {
      ensureGraphMode(lineNumber);
      const [, id, rowRaw, columnRaw, spanRaw, toneRaw, titleRaw] = nodeMatch;
      const row = Math.max(1, Number(rowRaw));
      const column = Math.max(1, Number(columnRaw));
      const span = Math.max(1, Number(spanRaw));
      const tone = String(toneRaw || "default").toLowerCase();
      const allowedTones = new Set([
        "default",
        "blue",
        "blue-solid",
        "orange",
        "yellow",
      ]);

      if (!allowedTones.has(tone)) {
        throw new PathophysiologyDiagramParseError(
          `Teinte inconnue « ${tone} ». Utilise default, blue, blue-solid, orange ou yellow.`,
          lineNumber
        );
      }
      if (column > result.graph.columns || column + span - 1 > result.graph.columns) {
        throw new PathophysiologyDiagramParseError(
          `Le nœud « ${id} » dépasse la grille de ${result.graph.columns} colonnes.`,
          lineNumber
        );
      }
      if (result.graph.nodes.some((node) => node.id === id)) {
        throw new PathophysiologyDiagramParseError(
          `L’identifiant « ${id} » est déjà utilisé.`,
          lineNumber
        );
      }

      const title = cleanTitle(titleRaw).replace(/\\n/g, "\n");
      if (!title) {
        throw new PathophysiologyDiagramParseError(
          "@node doit se terminer par un intitulé.",
          lineNumber
        );
      }

      const node = {
        ...createNode(title, lineNumber),
        id,
        row,
        column,
        span,
        tone,
      };
      result.graph.nodes.push(node);
      currentGroup = null;
      currentTarget = node.body;
      return;
    }

    const edgeMatch = trimmed.match(
      /^@edge\s+([A-Za-z0-9_-]+)\s*->\s*([A-Za-z0-9_-]+)(?:\s*\|\s*([A-Za-z-]+))?(?:\s*\|\s*([A-Za-z-]+))?\s*$/i
    );
    if (edgeMatch) {
      ensureGraphMode(lineNumber);
      const allowedTones = new Set(["default", "blue", "orange", "yellow"]);
      const allowedRoutes = new Set(["auto", "horizontal", "vertical"]);
      let tone = "default";
      let route = "auto";

      [edgeMatch[3], edgeMatch[4]].forEach((token) => {
        if (!token) return;
        const value = String(token).toLowerCase();

        if (allowedTones.has(value) && tone === "default") {
          tone = value;
          return;
        }
        if (allowedRoutes.has(value) && route === "auto") {
          route = value;
          return;
        }
        if (allowedTones.has(value) || allowedRoutes.has(value)) {
          throw new PathophysiologyDiagramParseError(
            `Directive @edge redondante ou ambiguë « ${value} ».`,
            lineNumber
          );
        }
        throw new PathophysiologyDiagramParseError(
          `Paramètre de liaison inconnu « ${value} ». Utilise une teinte (default, blue, orange, yellow) et/ou un trajet (auto, horizontal, vertical).`,
          lineNumber
        );
      });

      result.graph.edges.push({
        from: edgeMatch[1],
        to: edgeMatch[2],
        tone,
        route,
        lineNumber,
      });
      currentTarget = null;
      return;
    }

    if (result.graph) {
      if (/^@/.test(trimmed)) {
        throw new PathophysiologyDiagramParseError(
          `Directive inconnue en mode @graph : ${trimmed}`,
          lineNumber
        );
      }
      if (!currentTarget) {
        throw new PathophysiologyDiagramParseError(
          "Cette ligne doit suivre un @node en mode @graph.",
          lineNumber
        );
      }
      appendLine(currentTarget, rawLine);
      return;
    }

    const groupMatch = trimmed.match(/^@group\s+(.+)$/i);
    if (groupMatch) {
      const node = createNode(groupMatch[1], lineNumber);
      if (!node.title) {
        throw new PathophysiologyDiagramParseError(
          "@group doit être suivi d’un intitulé.",
          lineNumber
        );
      }
      currentGroup = { ...node, branches: [] };
      result.groups.push(currentGroup);
      currentTarget = currentGroup.body;
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
      currentGroup = null;
      currentTarget = node.body;
      return;
    }

    const balanceMatch = trimmed.match(/^@balance\s+(.+)$/i);
    if (balanceMatch) {
      if (result.balance) {
        throw new PathophysiologyDiagramParseError(
          "Un seul @balance est autorisé dans un diagramme séquentiel.",
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
      currentGroup = null;
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
      if (currentGroup) currentGroup.branches.push(node);
      else result.branches.push(node);
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
      currentGroup = null;
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
        "Cette ligne doit suivre @step, @balance, @branch, @group ou @outcome.",
        lineNumber
      );
    }

    appendLine(currentTarget, rawLine);
  });

  if (result.graph) {
    if (
      result.steps.length ||
      result.balance ||
      result.branches.length ||
      result.outcome ||
      result.groups.length
    ) {
      throw new PathophysiologyDiagramParseError(
        "Un diagramme utilisant @graph ne peut pas être mélangé avec @step, @balance, @branch, @outcome ou @group."
      );
    }
    if (result.graph.nodes.length === 0) {
      throw new PathophysiologyDiagramParseError(
        "Le mode @graph doit contenir au moins un @node."
      );
    }

    const ids = new Set(result.graph.nodes.map((node) => node.id));
    const invalidEdge = result.graph.edges.find(
      (edge) => !ids.has(edge.from) || !ids.has(edge.to)
    );
    if (invalidEdge) {
      throw new PathophysiologyDiagramParseError(
        `La liaison ${invalidEdge.from} -> ${invalidEdge.to} référence un nœud inexistant.`,
        invalidEdge.lineNumber
      );
    }
    return result;
  }

  if (result.groups.length > 0) {
    if (
      result.steps.length ||
      result.balance ||
      result.branches.length ||
      result.outcome
    ) {
      throw new PathophysiologyDiagramParseError(
        "Un diagramme utilisant @group ne peut pas mélanger @step, @balance, @outcome ou des @branch placés hors d’un @group."
      );
    }

    const emptyGroup = result.groups.find((group) => group.branches.length === 0);
    if (emptyGroup) {
      throw new PathophysiologyDiagramParseError(
        `Le groupe « ${emptyGroup.title} » doit contenir au moins un @branch.`,
        emptyGroup.lineNumber
      );
    }
    return result;
  }

  if (result.steps.length === 0 && !result.balance) {
    throw new PathophysiologyDiagramParseError(
      "Ajoute au moins un @step (ou un @balance) pour définir le point de départ du diagramme."
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
  if (!node) return null;
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

function plainPath(key, d, tone = "default", marker = true) {
  return { key, d, tone, marker };
}

function buildLegacyConnectorPaths(rects) {
  const { steps, balance, branches, outcome } = rects;
  if (
    !Array.isArray(steps) ||
    steps.length !== 3 ||
    steps.some((rect) => !rect) ||
    !balance ||
    !Array.isArray(branches) ||
    branches.length !== 2 ||
    branches.some((rect) => !rect) ||
    !outcome
  ) {
    return [];
  }

  const [process, pulpitis, necrosis] = steps;
  const [chronic, acute] = branches;
  const gap = 3;
  const railY =
    necrosis.bottom + Math.max(12, (balance.top - necrosis.bottom) * 0.36);
  const chronicEntryX = chronic.centerX;
  const acuteEntryX = Math.min(
    acute.right - acute.width * 0.18,
    Math.max(acute.left + acute.width * 0.18, necrosis.centerX)
  );
  const balanceY = balance.centerY;
  const crossY1 = chronic.top + Math.min(28, chronic.height * 0.34);
  const crossY2 = chronic.top + Math.min(58, chronic.height * 0.7);

  return [
    plainPath("legacy-1", `M ${process.right + gap} ${process.centerY} H ${pulpitis.left - gap}`),
    plainPath("legacy-2", `M ${pulpitis.right + gap} ${pulpitis.centerY} H ${necrosis.left - gap}`),
    plainPath("legacy-3", `M ${necrosis.centerX} ${railY} H ${chronicEntryX} V ${chronic.top - gap}`),
    plainPath("legacy-4", `M ${necrosis.centerX} ${necrosis.bottom + gap} V ${acute.top - gap}`),
    plainPath("legacy-5", `M ${balance.left - gap} ${balanceY} H ${chronicEntryX}`),
    plainPath("legacy-6", `M ${balance.right + gap} ${balanceY} H ${acuteEntryX}`),
    plainPath("legacy-7", `M ${chronic.right + gap} ${crossY1} H ${acute.left - gap}`),
    plainPath("legacy-8", `M ${acute.left - gap} ${crossY2} H ${chronic.right + gap}`),
    plainPath("legacy-9", `M ${chronic.right - chronic.width * 0.22} ${chronic.bottom + gap} V ${outcome.top - gap}`),
    plainPath("legacy-10", `M ${acute.left + acute.width * 0.22} ${acute.bottom + gap} V ${outcome.top - gap}`),
  ];
}

function buildFlexibleConnectorPaths(rects) {
  const { steps = [], balance = null, branches = [], outcome = null } = rects;
  const paths = [];
  const gap = 3;

  for (let index = 0; index < steps.length - 1; index += 1) {
    const from = steps[index];
    const to = steps[index + 1];
    if (!from || !to) continue;
    paths.push(
      plainPath(
        `flex-step-${index}`,
        `M ${from.right + gap} ${from.centerY} H ${to.left - gap}`
      )
    );
  }

  const lastStep = steps.length ? steps[steps.length - 1] : null;
  if (lastStep && balance) {
    paths.push(
      plainPath(
        "flex-balance",
        `M ${lastStep.centerX} ${lastStep.bottom + gap} V ${balance.top - gap}`
      )
    );
  }

  const pivot = balance || lastStep;
  if (pivot && branches.length) {
    const validBranches = branches.filter(Boolean);
    if (validBranches.length) {
      const firstTop = Math.min(...validBranches.map((rect) => rect.top));
      const railY = pivot.bottom + Math.max(14, (firstTop - pivot.bottom) * 0.42);
      validBranches.forEach((branch, index) => {
        paths.push(
          plainPath(
            `flex-branch-${index}`,
            `M ${pivot.centerX} ${pivot.bottom + gap} V ${railY} H ${branch.centerX} V ${branch.top - gap}`
          )
        );
      });
    }
  }

  if (outcome) {
    const validBranches = branches.filter(Boolean);
    if (validBranches.length) {
      validBranches.forEach((branch, index) => {
        const verticalGap = Math.max(14, outcome.top - branch.bottom);
        const railOffset = Math.min(verticalGap * 0.58, 22 + index * 4);
        const railY = branch.bottom + railOffset;
        paths.push(
          plainPath(
            `flex-outcome-${index}`,
            `M ${branch.centerX} ${branch.bottom + gap} V ${railY} H ${outcome.centerX} V ${outcome.top - gap}`
          )
        );
      });
    } else if (pivot) {
      paths.push(
        plainPath(
          "flex-outcome-pivot",
          `M ${pivot.centerX} ${pivot.bottom + gap} V ${outcome.top - gap}`
        )
      );
    }
  }

  return paths;
}

function buildGroupedConnectorPaths(groups) {
  const paths = [];
  const gap = 3;

  (Array.isArray(groups) ? groups : []).forEach((group, groupIndex) => {
    if (!group?.parent) return;
    const branches = (group.branches || []).filter(Boolean);
    if (!branches.length) return;
    const firstTop = Math.min(...branches.map((rect) => rect.top));
    const railY =
      group.parent.bottom + Math.max(14, (firstTop - group.parent.bottom) * 0.45);

    branches.forEach((branch, branchIndex) => {
      paths.push(
        plainPath(
          `group-${groupIndex}-${branchIndex}`,
          `M ${group.parent.centerX} ${group.parent.bottom + gap} V ${railY} H ${branch.centerX} V ${branch.top - gap}`
        )
      );
    });
  });

  return paths;
}

function buildGraphConnectorPath(from, to, edge = null) {
  if (!from || !to) return "";
  const route = edge?.route || "auto";
  const gap = 4;
  const horizontalOverlap =
    Math.min(from.right, to.right) - Math.max(from.left, to.left);
  const verticalOverlap =
    Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);
  const overlapCenterY =
    verticalOverlap > 0
      ? Math.max(from.top, to.top) + verticalOverlap / 2
      : null;
  const overlapCenterX =
    horizontalOverlap > 0
      ? Math.max(from.left, to.left) + horizontalOverlap / 2
      : null;

  const buildHorizontal = (y) => {
    if (from.centerX <= to.centerX) {
      return `M ${from.right + gap} ${y} H ${to.left - gap}`;
    }
    return `M ${from.left - gap} ${y} H ${to.right + gap}`;
  };

  const buildVertical = (x) => {
    if (from.centerY <= to.centerY) {
      return `M ${x} ${from.bottom + gap} V ${to.top - gap}`;
    }
    return `M ${x} ${from.top - gap} V ${to.bottom + gap}`;
  };

  if (route === "horizontal" && verticalOverlap > 0) {
    return buildHorizontal(overlapCenterY);
  }
  if (route === "vertical" && horizontalOverlap > 0) {
    return buildVertical(overlapCenterX);
  }

  if (verticalOverlap > 0) {
    return buildHorizontal(overlapCenterY);
  }

  if (from.centerY <= to.centerY) {
    const startY = from.bottom + gap;
    const endY = to.top - gap;
    if (horizontalOverlap > 0) {
      return buildVertical(overlapCenterX ?? from.centerX);
    }
    const distance = Math.max(0, endY - startY);
    const railOffset = Math.min(
      Math.max(14, distance * 0.34),
      Math.max(14, distance - 16)
    );
    const railY = startY + railOffset;
    return `M ${from.centerX} ${startY} V ${railY} H ${to.centerX} V ${endY}`;
  }

  const startY = from.top - gap;
  const endY = to.bottom + gap;
  if (horizontalOverlap > 0) {
    return buildVertical(overlapCenterX ?? from.centerX);
  }
  const distance = Math.max(0, startY - endY);
  const railOffset = Math.min(
    Math.max(14, distance * 0.34),
    Math.max(14, distance - 16)
  );
  const railY = startY - railOffset;
  return `M ${from.centerX} ${startY} V ${railY} H ${to.centerX} V ${endY}`;
}

function buildGraphGeometry(graph, nodeElements, containerRect) {
  const rects = new Map();
  nodeElements.forEach((element, id) => {
    rects.set(id, relativeRect(element, containerRect));
  });

  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const paths = [];
  const handledEdges = new Set();
  const outgoingBySource = new Map();
  const gap = 4;

  edges.forEach((edge, index) => {
    if (!outgoingBySource.has(edge.from)) outgoingBySource.set(edge.from, []);
    outgoingBySource.get(edge.from).push({ edge, index });
  });

  outgoingBySource.forEach((entries, sourceId) => {
    const sourceRect = rects.get(sourceId);
    if (!sourceRect) return;

    const downwardByTone = new Map();
    entries.forEach((entry) => {
      const targetRect = rects.get(entry.edge.to);
      if (!targetRect || targetRect.top <= sourceRect.bottom + 2) return;
      const tone = entry.edge.tone || "default";
      if (!downwardByTone.has(tone)) downwardByTone.set(tone, []);
      downwardByTone.get(tone).push({ ...entry, targetRect });
    });

    downwardByTone.forEach((branchEntries, tone) => {
      if (branchEntries.length < 2) return;

      const nearestTargetTop = Math.min(
        ...branchEntries.map(({ targetRect }) => targetRect.top)
      );
      const startY = sourceRect.bottom + gap;
      const endLimit = nearestTargetTop - gap;
      const available = endLimit - startY;
      const minimumShaft = 22;
      if (available < minimumShaft + 8) return;

      const railOffset = Math.min(
        Math.max(10, available * 0.22),
        Math.max(10, available - minimumShaft)
      );
      const railY = startY + railOffset;
      const targetCenters = branchEntries.map(({ targetRect }) => targetRect.centerX);
      const railLeft = Math.min(sourceRect.centerX, ...targetCenters);
      const railRight = Math.max(sourceRect.centerX, ...targetCenters);

      paths.push(
        plainPath(
          `graph-${sourceId}-${tone}-rail`,
          `M ${sourceRect.centerX} ${startY} V ${railY} M ${railLeft} ${railY} H ${railRight}`,
          tone,
          false
        )
      );

      branchEntries.forEach(({ index, targetRect }) => {
        const dropStartY = railY;
        const dropEndY = targetRect.top - gap;
        if (dropEndY <= dropStartY) return;

        paths.push(
          plainPath(
            `graph-${sourceId}-${tone}-drop-${index}`,
            `M ${targetRect.centerX} ${dropStartY} V ${dropEndY}`,
            tone,
            true
          )
        );
        handledEdges.add(index);
      });
    });
  });

  edges.forEach((edge, index) => {
    if (handledEdges.has(index)) return;
    const d = buildGraphConnectorPath(rects.get(edge.from), rects.get(edge.to), edge);
    if (!d) return;
    paths.push(
      plainPath(
        `graph-edge-${index}-${edge.from}-${edge.to}`,
        d,
        edge.tone || "default",
        true
      )
    );
  });

  return paths;
}

function getMode(data) {
  if (data?.graph) return "graph";
  if (Array.isArray(data?.groups) && data.groups.length > 0) return "grouped";
  if (
    data?.steps?.length === 3 &&
    data.balance &&
    data?.branches?.length === 2 &&
    data.outcome
  ) {
    return "legacy";
  }
  return "flexible";
}

function MarkerDefs({ markerIds }) {
  const markers = [
    [markerIds.default, "pdg-marker"],
    [markerIds.blue, "pdg-marker pdg-marker-blue"],
    [markerIds.orange, "pdg-marker pdg-marker-orange"],
    [markerIds.yellow, "pdg-marker pdg-marker-yellow"],
  ];

  return (
    <defs>
      {markers.map(([id, className]) => (
        <marker
          key={id}
          id={id}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" className={className} />
        </marker>
      ))}
    </defs>
  );
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

  const data = parsed.data;
  const mode = data ? getMode(data) : "flexible";

  const canvasRef = useRef(null);
  const stepRefs = useRef([]);
  const balanceRef = useRef(null);
  const branchRefs = useRef([]);
  const outcomeRef = useRef(null);
  const groupRefs = useRef([]);
  const graphNodeRefs = useRef(new Map());

  const [geometry, setGeometry] = useState({ width: 1, height: 1, paths: [] });
  const markerBase = `pdg-arrow-${useId().replace(/:/g, "")}`;
  const markerIds = useMemo(
    () => ({
      default: markerBase,
      blue: `${markerBase}-blue`,
      orange: `${markerBase}-orange`,
      yellow: `${markerBase}-yellow`,
    }),
    [markerBase]
  );

  const updateGeometry = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const containerRect = canvas.getBoundingClientRect();
    let paths = [];

    if (mode === "graph") {
      paths = buildGraphGeometry(data.graph, graphNodeRefs.current, containerRect);
    } else if (mode === "grouped") {
      const groups = data.groups.map((group, groupIndex) => {
        const refs = groupRefs.current[groupIndex] || { parent: null, branches: [] };
        return {
          parent: relativeRect(refs.parent, containerRect),
          branches: group.branches.map((_, branchIndex) =>
            relativeRect(refs.branches?.[branchIndex], containerRect)
          ),
        };
      });
      paths = buildGroupedConnectorPaths(groups);
    } else {
      const rects = {
        steps: data.steps.map((_, index) =>
          relativeRect(stepRefs.current[index], containerRect)
        ),
        balance: relativeRect(balanceRef.current, containerRect),
        branches: data.branches.map((_, index) =>
          relativeRect(branchRefs.current[index], containerRect)
        ),
        outcome: relativeRect(outcomeRef.current, containerRect),
      };
      paths =
        mode === "legacy"
          ? buildLegacyConnectorPaths(rects)
          : buildFlexibleConnectorPaths(rects);
    }

    setGeometry({
      width: Math.max(1, containerRect.width),
      height: Math.max(1, containerRect.height),
      paths,
    });
  }, [data, mode]);

  useLayoutEffect(() => {
    if (!data || !canvasRef.current) return undefined;

    let frame = requestAnimationFrame(updateGeometry);
    const observed = [canvasRef.current];

    if (mode === "graph") {
      observed.push(...graphNodeRefs.current.values());
    } else if (mode === "grouped") {
      groupRefs.current.forEach((group) => {
        if (!group) return;
        observed.push(group.parent, ...(group.branches || []));
      });
    } else {
      observed.push(
        ...stepRefs.current,
        balanceRef.current,
        ...branchRefs.current,
        outcomeRef.current
      );
    }

    if (typeof ResizeObserver === "undefined") {
      const onResize = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(updateGeometry);
      };
      window.addEventListener("resize", onResize);
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", onResize);
      };
    }

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateGeometry);
    });

    observed.filter(Boolean).forEach((node) => observer.observe(node));

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [data, mode, updateGeometry]);

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
          Directives disponibles : @label, @step, @balance, @branch, @outcome,
          @group, @graph, @node, @edge, @titleStyle et @frame.
        </div>
      </div>
    );
  }

  const rootClasses = [
    "pathophysiology-diagram",
    "pdg-react",
    `pdg-${mode}`,
    mode === "graph" && data.graph.frame ? "pdg-framed" : "",
    mode === "graph" && data.graph.titleStyle === "plain" ? "pdg-title-plain" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const canvasClasses = [
    "pdg-canvas",
    mode === "graph" ? "pdg-graph-canvas" : "",
    mode === "grouped" ? "pdg-grouped-canvas" : "",
  ]
    .filter(Boolean)
    .join(" ");

  let canvasMinWidth = null;
  if (mode === "graph") {
    canvasMinWidth = `${Math.max(46, data.graph.columns * 4.2)}rem`;
  } else if (mode === "grouped") {
    const totalBranches = data.groups.reduce(
      (sum, group) => sum + group.branches.length,
      0
    );
    canvasMinWidth = `${Math.max(46, data.groups.length * 25, totalBranches * 11)}rem`;
  } else if (mode === "flexible") {
    const widestCount = Math.max(data.steps.length, data.branches.length, 1);
    canvasMinWidth = `${Math.max(46, widestCount * 12)}rem`;
  }

  const canvasStyle = canvasMinWidth
    ? { "--pdg-canvas-min-width": canvasMinWidth }
    : undefined;

  const markerForTone = (tone) => markerIds[tone] || markerIds.default;

  const outgoingCounts = new Map();
  if (mode === "graph") {
    (data.graph.edges || []).forEach((edge) => {
      outgoingCounts.set(edge.from, (outgoingCounts.get(edge.from) || 0) + 1);
    });
  }
  const fanOutSources = new Set(
    [...outgoingCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([id]) => id)
  );
  const fanOutTargets = new Set(
    mode === "graph"
      ? (data.graph.edges || [])
          .filter((edge) => fanOutSources.has(edge.from))
          .map((edge) => edge.to)
      : []
  );

  return (
    <div className={rootClasses} role="group" aria-label={data.label}>
      <VisualHeading className="pdg-title" level={3}>
        {data.label}
      </VisualHeading>

      <div className="pdg-scroll">
        <div ref={canvasRef} className={canvasClasses} style={canvasStyle}>
          <svg
            className="pdg-connectors"
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <MarkerDefs markerIds={markerIds} />
            {geometry.paths.map((path) => (
              <path
                key={path.key}
                d={path.d}
                className={`pdg-connector pdg-edge-${path.tone || "default"}`}
                markerEnd={path.marker ? `url(#${markerForTone(path.tone)})` : undefined}
              />
            ))}
          </svg>

          {mode === "graph" && (
            <div
              className="pdg-graph-grid"
              style={{
                "--pdg-graph-columns": String(data.graph.columns),
                "--pdg-graph-row-gap": fanOutSources.size > 0 ? "2.8rem" : "2rem",
              }}
            >
              {data.graph.nodes.map((node) => (
                <div
                  key={node.id}
                  className={`pdg-graph-node-wrap${
                    fanOutTargets.has(node.id) ? " pdg-fanout-target" : ""
                  }`}
                  style={{
                    gridColumn: `${node.column} / span ${node.span}`,
                    gridRow: String(node.row),
                  }}
                >
                  <DiagramCard
                    node={node}
                    className={`pdg-graph-card pdg-tone-${node.tone}`}
                    nodeRef={(element) => {
                      if (element) graphNodeRefs.current.set(node.id, element);
                      else graphNodeRefs.current.delete(node.id);
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {mode === "grouped" && (
            <div
              className="pdg-groups"
              style={{ "--pdg-group-count": String(data.groups.length) }}
            >
              {data.groups.map((group, groupIndex) => (
                <section className="pdg-group" key={`${group.title}-${groupIndex}`}>
                  <div className="pdg-group-parent">
                    <DiagramCard
                      node={group}
                      className="pdg-group-card"
                      nodeRef={(element) => {
                        if (!groupRefs.current[groupIndex]) {
                          groupRefs.current[groupIndex] = { parent: null, branches: [] };
                        }
                        groupRefs.current[groupIndex].parent = element;
                      }}
                    />
                  </div>
                  <div
                    className="pdg-group-branches"
                    style={{
                      "--pdg-group-branch-count": String(group.branches.length),
                    }}
                  >
                    {group.branches.map((branch, branchIndex) => (
                      <DiagramCard
                        key={`${branch.title}-${branchIndex}`}
                        node={branch}
                        className="pdg-branch-card"
                        nodeRef={(element) => {
                          if (!groupRefs.current[groupIndex]) {
                            groupRefs.current[groupIndex] = { parent: null, branches: [] };
                          }
                          groupRefs.current[groupIndex].branches[branchIndex] = element;
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {(mode === "legacy" || mode === "flexible") && (
            <>
              <div
                className="pdg-sequence"
                style={{ "--pdg-step-count": String(Math.max(1, data.steps.length)) }}
              >
                {data.steps.map((step, index) => (
                  <DiagramCard
                    key={`${step.title}-${index}`}
                    node={step}
                    className="pdg-step-card"
                    nodeRef={(element) => {
                      stepRefs.current[index] = element;
                    }}
                  />
                ))}
              </div>

              {data.balance && (
                <div className="pdg-balance-wrap">
                  <DiagramCard
                    node={data.balance}
                    className="pdg-balance-card"
                    nodeRef={balanceRef}
                  />
                </div>
              )}

              {data.branches.length > 0 && (
                <div
                  className="pdg-branches"
                  style={{ "--pdg-branch-count": String(data.branches.length) }}
                >
                  {data.branches.map((branch, index) => (
                    <DiagramCard
                      key={`${branch.title}-${index}`}
                      node={branch}
                      className="pdg-branch-card"
                      nodeRef={(element) => {
                        branchRefs.current[index] = element;
                      }}
                    />
                  ))}
                </div>
              )}

              {data.outcome && (
                <div className="pdg-outcome-wrap">
                  <DiagramCard
                    node={data.outcome}
                    className="pdg-outcome-card"
                    level={3}
                    nodeRef={outcomeRef}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default PathophysiologyDiagram;
