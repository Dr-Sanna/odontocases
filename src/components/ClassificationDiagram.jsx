// src/components/ClassificationDiagram.jsx
import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "./ClassificationDiagram.css";

/* =========================
   Utils
   ========================= */
function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseClassificationDiagramSource(source) {
  let raw = String(source || "").trim();
  if (!raw) return null;
  if (raw.startsWith("@classificationDiagram")) {
    raw = raw.replace(/^@classificationDiagram\s*/, "").trim();
  }
  if (!raw.startsWith("{")) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isClassificationDiagramCodeBlock(language = "", source = "") {
  const lang = String(language || "").toLowerCase().replace(/^language-/, "");
  const raw = String(source || "").trim();
  return lang === "classificationdiagram" || raw.startsWith("@classificationDiagram");
}

function cssLenToPx(value, fallback = 0) {
  const v = String(value || "").trim();
  if (!v) return fallback;

  if (v.endsWith("px")) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  if (v.endsWith("rem")) {
    const n = parseFloat(v);
    const rootFs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return Number.isFinite(n) ? n * rootFs : fallback;
  }
  if (v.endsWith("vw")) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? (n / 100) * (window.innerWidth || 0) : fallback;
  }
  if (v.endsWith("vh")) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? (n / 100) * (window.innerHeight || 0) : fallback;
  }

  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function cssPx(el, varName, fallback = 0) {
  try {
    const raw = getComputedStyle(el).getPropertyValue(varName);
    return cssLenToPx(raw, fallback);
  } catch {
    return fallback;
  }
}

function readCssVarPx(varName) {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName);
    return cssLenToPx(raw);
  } catch {
    return 0;
  }
}

function getNavbarHeightPx() {
  const nav =
    document.querySelector("header.navbar") ||
    document.querySelector(".navbar") ||
    document.querySelector("header");

  const hDom = nav?.getBoundingClientRect?.().height || 0;
  if (hDom > 0) return hDom;

  return readCssVarPx("--ifm-navbar-height");
}

function getScrollOffsetPx() {
  return Math.round(getNavbarHeightPx() + 14);
}

function scrollToElWithOffset(el) {
  const offset = getScrollOffsetPx();
  const y = window.scrollY + el.getBoundingClientRect().top - offset;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

function scrollToHeadingText(text) {
  const wanted = norm(text);
  const headings = document.querySelectorAll(
    ".cd-content h1, .cd-content h2, .cd-content h3, .cd-content h4, .cd-content h5, .cd-content h6"
  );

  for (const h of headings) {
    if (norm(h.textContent || "") === wanted) {
      scrollToElWithOffset(h);
      return true;
    }
  }
  return false;
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const r = Math.floor(x);
  if (r < min || r > max) return fallback;
  return r;
}

function normalizeDiagramPreset(value) {
  const p = String(value || "standard").trim().toLowerCase();
  if (p === "mind" || p === "mindmap" || p === "carte-mentale") return "mind";
  if (p === "tree" || p === "arbre") return "tree";
  if (p === "tree-left" || p === "arbre-gauche") return "tree-left";
  if (p === "tree-right" || p === "arbre-droit") return "tree-right";
  if (p === "flow-left" || p === "logigramme-gauche" || p === "logic-left") return "flow-left";
  if (p === "flow-right" || p === "logigramme-droit" || p === "logic-right") return "flow-right";
  if (p === "org" || p === "organigramme" || p === "organization") return "org";
  if (p === "timeline" || p === "chronologie" || p === "chronologie-verticale") return "timeline";
  return "standard";
}

const HEADING_DRIVEN_FORMAT = "headings-v2";
const LEGACY_HEADING_DRIVEN_FORMAT = "headings-v1";
const CDG_DEFAULT_LEVEL_STYLES = { h2: "stack", h3: "stack", h4: "stack", h5: "auto" };
const CDG_DEFAULT_LEVEL_ALIGNMENTS = { h2: "center", h3: "center", h4: "center", h5: "center", h6: "center" };
const CDG_DEFAULT_AUTOMATIC_PRESETS = { h3: "tree", h4: "tree" };
const CDG_DEFAULT_GLOBAL_PRESETS = { h3: "standard", h4: "standard" };

export function isHeadingDrivenClassificationDiagramSpec(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.source === "headings" &&
    (value.format === HEADING_DRIVEN_FORMAT || value.format === LEGACY_HEADING_DRIVEN_FORMAT || Number(value.version) >= 2)
  );
}

function cdgNormalizeLayoutMode(value) {
  return String(value || "").toLowerCase() === "automatic" ? "automatic" : "manual";
}

function cdgNormalizeAlignment(value) {
  const wanted = String(value || "center").toLowerCase();
  return wanted === "left" || wanted === "right" ? wanted : "center";
}

function cdgNormalizePresetRecord(value) {
  const output = {};
  if (!value || typeof value !== "object") return output;
  Object.entries(value).forEach(([key, preset]) => {
    const normalized = normalizeDiagramPreset(preset);
    if (key && normalized !== "standard") output[String(key)] = normalized;
  });
  return output;
}

const CDG_LOCAL_LEVEL_STYLES = new Set(["stack", "grid2", "grid3", "grid4"]);

function cdgNormalizeLevelStyle(value, fallback = null) {
  const wanted = String(value || "");
  return CDG_LOCAL_LEVEL_STYLES.has(wanted) ? wanted : fallback;
}

function cdgNormalizeLocalRule(rule, scope = "h2") {
  if (!rule || typeof rule !== "object") return null;
  const output = {};
  const preset = normalizeDiagramPreset(rule.preset);
  if (preset !== "standard") output.preset = preset;

  if (scope === "h2") {
    if (rule.h2Align != null) output.h2Align = cdgNormalizeAlignment(rule.h2Align);
    const h3Style = cdgNormalizeLevelStyle(rule.h3Style);
    const h4Style = cdgNormalizeLevelStyle(rule.h4Style);
    if (h3Style) output.h3Style = h3Style;
    if (h4Style) output.h4Style = h4Style;
    if (rule.h3Align != null) output.h3Align = cdgNormalizeAlignment(rule.h3Align);
    if (rule.h4Align != null) output.h4Align = cdgNormalizeAlignment(rule.h4Align);
  } else {
    const h4Style = cdgNormalizeLevelStyle(rule.h4Style);
    if (h4Style) output.h4Style = h4Style;
    if (rule.h3Align != null) output.h3Align = cdgNormalizeAlignment(rule.h3Align);
    if (rule.h4Align != null) output.h4Align = cdgNormalizeAlignment(rule.h4Align);
  }

  return Object.keys(output).length ? output : null;
}

function cdgNormalizeLocalRuleRecord(value, scope) {
  const output = {};
  if (!value || typeof value !== "object") return output;
  Object.entries(value).forEach(([key, rule]) => {
    const normalized = cdgNormalizeLocalRule(rule, scope);
    if (key && normalized) output[String(key)] = normalized;
  });
  return output;
}

function cdgNormalizeHeadingConfig(value = {}) {
  const sourceVersion = Number(value?.version) || 2;
  const levelStyles = value?.levelStyles && typeof value.levelStyles === "object" ? value.levelStyles : {};
  const levelAlignments = value?.levelAlignments && typeof value.levelAlignments === "object" ? value.levelAlignments : {};
  const automaticPresets = value?.automaticPresets && typeof value.automaticPresets === "object" ? value.automaticPresets : {};
  const globalPresets = value?.globalPresets && typeof value.globalPresets === "object" ? value.globalPresets : {};
  const localPresets = value?.localPresets && typeof value.localPresets === "object" ? value.localPresets : {};
  const localRules = value?.localRules && typeof value.localRules === "object" ? value.localRules : {};
  const legacyAutomatic = sourceVersion < 3 && cdgNormalizeLayoutMode(value?.layoutMode) === "automatic";
  const normalizedLocalPresets = {
    h2: cdgNormalizePresetRecord(localPresets.h2),
    h3: cdgNormalizePresetRecord(localPresets.h3),
  };
  const normalizedLocalRules = {
    h2: cdgNormalizeLocalRuleRecord(localRules.h2, "h2"),
    h3: cdgNormalizeLocalRuleRecord(localRules.h3, "h3"),
  };
  Object.entries(normalizedLocalPresets.h2).forEach(([key, preset]) => {
    normalizedLocalRules.h2[key] = { ...(normalizedLocalRules.h2[key] || {}), preset };
  });
  Object.entries(normalizedLocalPresets.h3).forEach(([key, preset]) => {
    normalizedLocalRules.h3[key] = { ...(normalizedLocalRules.h3[key] || {}), preset };
  });
  return {
    title: String(value?.title || "Diagramme de classification"),
    visibleLevels: value?.visibleLevels && typeof value.visibleLevels === "object" ? value.visibleLevels : null,
    showSkeleton: value?.showSkeleton !== false,
    showSkeletonPrimary: value?.showSkeletonPrimary !== false,
    showSkeletonSecondary: value?.showSkeletonSecondary !== false,
    showSkeletonTertiary: value?.showSkeletonTertiary !== false,
    showBorders: value?.showBorders !== false,
    levelStyles: { ...CDG_DEFAULT_LEVEL_STYLES, ...levelStyles },
    levelAlignments: {
      h2: cdgNormalizeAlignment(levelAlignments.h2),
      h3: cdgNormalizeAlignment(levelAlignments.h3),
      h4: cdgNormalizeAlignment(levelAlignments.h4),
      h5: cdgNormalizeAlignment(levelAlignments.h5),
      h6: cdgNormalizeAlignment(levelAlignments.h6),
    },
    globalPresets: {
      h3: normalizeDiagramPreset(globalPresets.h3 || (legacyAutomatic ? automaticPresets.h3 : CDG_DEFAULT_GLOBAL_PRESETS.h3)),
      h4: normalizeDiagramPreset(globalPresets.h4 || (legacyAutomatic ? automaticPresets.h4 : CDG_DEFAULT_GLOBAL_PRESETS.h4)),
    },
    localPresets: normalizedLocalPresets,
    localRules: normalizedLocalRules,
  };
}

function cdgStableHeadingSegment(nodes, index) {
  const list = Array.isArray(nodes) ? nodes : [];
  const node = list[index];
  const label = norm(node?.text || "heading") || "heading";
  let occurrence = 0;
  for (let i = 0; i < index; i += 1) {
    if (norm(list[i]?.text || "") === label) occurrence += 1;
  }
  return `${encodeURIComponent(label)}~${occurrence}`;
}

function cdgStableHeadingHash(value) {
  let hash = 2166136261;
  const input = String(value || "");
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cdgStableHeadingKey(roots, rootIndex, childIndex = null) {
  const rootList = Array.isArray(roots) ? roots : [];
  if (!Number.isInteger(rootIndex) || !rootList[rootIndex]) return "";
  const rootNode = rootList[rootIndex];
  const rootRaw = cdgStableHeadingSegment(rootList, rootIndex);
  const rootKey = rootNode.__cdgStableKey || `h2:${cdgStableHeadingHash(rootRaw)}`;
  if (!Number.isInteger(childIndex)) return rootKey;
  const children = Array.isArray(rootNode?.children) ? rootNode.children : [];
  if (!children[childIndex]) return "";
  const childRaw = `${rootRaw}/${cdgStableHeadingSegment(children, childIndex)}`;
  return children[childIndex].__cdgStableKey || `h3:${cdgStableHeadingHash(childRaw)}`;
}

function cdgAnnotateStableHeadingKeys(roots) {
  const rootList = Array.isArray(roots) ? roots : [];
  rootList.forEach((root, rootIndex) => {
    const rootRaw = cdgStableHeadingSegment(rootList, rootIndex);
    const rootKey = `h2:${cdgStableHeadingHash(rootRaw)}`;
    root.__cdgStableKey = rootKey;
    root.__cdgParentH2Key = rootKey;
    const children = Array.isArray(root?.children) ? root.children : [];
    children.forEach((child, childIndex) => {
      const childRaw = `${rootRaw}/${cdgStableHeadingSegment(children, childIndex)}`;
      const childKey = `h3:${cdgStableHeadingHash(childRaw)}`;
      child.__cdgStableKey = childKey;
      child.__cdgParentH2Key = rootKey;
      child.__cdgParentH3Key = childKey;
      const annotateDescendants = (nodes) => {
        (Array.isArray(nodes) ? nodes : []).forEach((descendant) => {
          descendant.__cdgParentH2Key = rootKey;
          descendant.__cdgParentH3Key = childKey;
          annotateDescendants(descendant.children);
        });
      };
      annotateDescendants(child.children);
    });
  });
  return rootList;
}

function cdgAlignmentForLevel(alignments, level) {
  const n = Number(level) || 2;
  const key = n <= 2 ? "h2" : n === 3 ? "h3" : n === 4 ? "h4" : n === 5 ? "h5" : "h6";
  return cdgNormalizeAlignment(alignments?.[key]);
}

function cdgAlignmentForNode(node, config = {}) {
  const level = Number(node?.level || 0) || 2;
  const alignments = config?.levelAlignments || CDG_DEFAULT_LEVEL_ALIGNMENTS;
  const localRules = config?.localRules || { h2: {}, h3: {} };
  const h2Key = node?.__cdgParentH2Key || (level === 2 ? node?.__cdgStableKey : "");
  const h3Key = node?.__cdgParentH3Key || (level === 3 ? node?.__cdgStableKey : "");
  const h2Rule = h2Key ? localRules?.h2?.[h2Key] : null;
  const h3Rule = h3Key ? localRules?.h3?.[h3Key] : null;

  if (level <= 2 && h2Rule?.h2Align) return cdgNormalizeAlignment(h2Rule.h2Align);
  if (level === 3) return cdgNormalizeAlignment(h3Rule?.h3Align || h2Rule?.h3Align || alignments.h3);
  if (level === 4) return cdgNormalizeAlignment(h3Rule?.h4Align || h2Rule?.h4Align || alignments.h4);
  return cdgAlignmentForLevel(alignments, level);
}

function cdgAlignmentClass(value) {
  return `cdg-align-${cdgNormalizeAlignment(value)}`;
}

function cdgDecodeBasicHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function cdgStripInlineMarkdown(value) {
  return cdgDecodeBasicHtmlEntities(value)
    .replace(/\s+#+\s*$/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cdgParseMarkdownHeadings(text, minLevel = 2, maxLevel = 6) {
  const lines = String(text || "").split(/\r?\n/);
  const headings = [];
  let inFence = false;
  let fenceMarker = null;
  let htmlTableDepth = 0;

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const line = lines[lineNo];
    const tableContext = htmlTableDepth > 0 || /<(?:table|thead|tbody|tfoot|tr|td|th)\b/i.test(line);
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      const markerChar = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = markerChar;
      } else if (markerChar === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;

    const foundOnLine = [];
    const md = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (md) {
      const level = md[1].length;
      if (level >= minLevel && level <= maxLevel) {
        const headingText = cdgStripInlineMarkdown(md[2]);
        if (headingText) foundOnLine.push({ level, text: headingText, line: lineNo, column: line.indexOf(md[0]), source: "markdown" });
      }
    }

    const htmlRe = /<h([1-6])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;
    let match;
    while ((match = htmlRe.exec(line)) !== null) {
      const level = Number(match[1]);
      if (level < minLevel || level > maxLevel) continue;
      const headingText = cdgStripInlineMarkdown(match[2]);
      if (!headingText) continue;
      foundOnLine.push({ level, text: headingText, line: lineNo, column: match.index, source: "html", inHtmlTable: tableContext });
    }

    const openCount = (line.match(/<table\b/gi) || []).length;
    const closeCount = (line.match(/<\/table>/gi) || []).length;
    htmlTableDepth = Math.max(0, htmlTableDepth + openCount - closeCount);

    foundOnLine
      .sort((a, b) => (a.column || 0) - (b.column || 0))
      .forEach((heading) => headings.push({ ...heading, children: [] }));
  }

  return headings;
}

function cdgBuildHeadingTree(headings) {
  const roots = [];
  const stack = [];
  for (const heading of headings || []) {
    const node = { ...heading, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

export function parseClassificationDiagramHeadingTree(markdownSource) {
  return cdgBuildHeadingTree(cdgParseMarkdownHeadings(markdownSource, 2, 6));
}

function cdgFilterVisibleLevels(nodes, visibleLevels) {
  const output = [];
  for (const node of nodes || []) {
    if (!node) continue;
    const children = cdgFilterVisibleLevels(node.children || [], visibleLevels);
    const visible = visibleLevels?.[String(node.level)] !== false;
    if (visible) output.push({ ...node, children });
    else output.push(...children);
  }
  return output;
}

function cdgColumnsForStyle(style, fallback = 2) {
  if (style === "grid4") return 4;
  if (style === "grid3") return 3;
  if (style === "grid2") return 2;
  return fallback;
}

function cdgLayoutForStyle(style, count = 0) {
  if (style === "grid2" || style === "grid3" || style === "grid4") return "grid";
  if (style === "auto") return count >= 6 ? "grid" : "stack";
  return "stack";
}

function cdgLevelKey(level) {
  const n = clampInt(level, 2, 6, 5);
  if (n <= 2) return "h2";
  if (n === 3) return "h3";
  if (n === 4) return "h4";
  return "h5";
}

function cdgStyleForLevel(styles, level) {
  return styles[cdgLevelKey(level)] || CDG_DEFAULT_LEVEL_STYLES[cdgLevelKey(level)] || "stack";
}

function cdgApplyStyle(target, style, count) {
  const layout = cdgLayoutForStyle(style, count);
  target.layout = layout;
  if (layout === "grid") target.columns = cdgColumnsForStyle(style, 2);
}

function cdgChunkIndexes(count, columns) {
  const cols = Math.max(1, Math.min(4, Number(columns) || 1));
  const output = [];
  for (let index = 0; index < count; index += cols) {
    const items = Array.from({ length: cols }, (_, offset) => (index + offset < count ? index + offset : null));
    output.push({ columns: cols, items });
  }
  return output;
}

function cdgMakePresetRows(count, preset, fallbackColumns = 1) {
  const n = Math.max(0, Number(count) || 0);
  const wanted = normalizeDiagramPreset(preset);
  if (!n) return [{ columns: 1, items: [null] }];
  if (wanted === "standard") return cdgChunkIndexes(n, Math.max(1, Math.min(4, Number(fallbackColumns) || 1, n)));
  if (wanted === "timeline") return Array.from({ length: n }, (_, index) => ({ columns: 1, items: [index] }));
  if (wanted === "mind" || wanted === "tree") return cdgChunkIndexes(n, n === 1 ? 1 : 2);
  if (wanted === "tree-left") return Array.from({ length: n }, (_, index) => ({ columns: 2, items: [index, null] }));
  if (wanted === "tree-right") return Array.from({ length: n }, (_, index) => ({ columns: 2, items: [null, index] }));
  if (wanted === "flow-right" || wanted === "flow-left") return Array.from({ length: n }, (_, index) => ({ columns: 1, items: [index] }));
  if (wanted === "org") return cdgChunkIndexes(n, Math.max(1, Math.min(4, n)));
  return cdgChunkIndexes(n, Math.max(1, Math.min(4, Number(fallbackColumns) || 1, n)));
}

function cdgToItem(node, config, context = {}) {
  const item = { label: node.text, anchor: node.text, level: node.level, align: cdgAlignmentForNode(node, config) };
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length) {
    const child = { items: children.map((entry) => cdgToItem(entry, config, context)) };
    const style = cdgStyleForLevel(config.levelStyles, children[0]?.level || Math.min((node.level || 4) + 1, 6));
    cdgApplyStyle(child, style, child.items.length);
    item.children = child;
  }
  return item;
}

function cdgToNode(node, config, context = {}) {
  const output = { label: node.text, anchor: node.text, level: node.level, align: cdgAlignmentForNode(node, config) };
  const children = Array.isArray(node.children) ? node.children : [];
  const level = Number(node.level);
  const isConfiguredLevel = level === 2 || level === 3;

  if (isConfiguredLevel && children.length) {
    const childKey = level === 2 ? "h3" : "h4";
    const h2Key = node?.__cdgParentH2Key || (level === 2 ? node?.__cdgStableKey : "");
    const h3Key = node?.__cdgParentH3Key || (level === 3 ? node?.__cdgStableKey : "");
    const h2Rule = h2Key ? config.localRules?.h2?.[h2Key] || {} : {};
    const h3Rule = h3Key ? config.localRules?.h3?.[h3Key] || {} : {};
    const inheritedH4Style = cdgNormalizeLevelStyle(h2Rule.h4Style, config.levelStyles.h4 || "stack");
    const manualStyle = level === 2
      ? cdgNormalizeLevelStyle(h2Rule.h3Style, config.levelStyles.h3 || "stack")
      : cdgNormalizeLevelStyle(h3Rule.h4Style, inheritedH4Style);
    const stableKey = level === 2
      ? (node?.__cdgStableKey || cdgStableHeadingKey(context.roots, context.rootIndex))
      : (node?.__cdgStableKey || cdgStableHeadingKey(context.roots, context.rootIndex, context.childIndex));
    const localBucket = level === 2 ? config.localPresets.h2 : config.localPresets.h3;
    const localRule = level === 2 ? h2Rule : h3Rule;
    const preset = normalizeDiagramPreset(localRule.preset || localBucket?.[stableKey] || config.globalPresets[childKey] || "standard");
    const columns = cdgColumnsForStyle(manualStyle, 1);
    output.mixedItems = "customRows";
    output.diagramPreset = preset;
    output.skeletonStyle = preset;
    output.mixedRows = cdgMakePresetRows(children.length, preset, columns)
      .map((row) => ({
        columns: row.columns,
        childStyle: preset === "standard" ? (level === 2 ? inheritedH4Style : config.levelStyles.h5) : "stack",
        nodes: row.items.map((index) => {
          if (index == null) return null;
          const childContext = level === 2
            ? { ...context, childIndex: index }
            : context;
          return cdgToNode(children[index], config, childContext);
        }),
      }))
      .filter((row) => row.nodes.some(Boolean));
    return output;
  }

  const groups = [];
  const items = [];
  children.forEach((child) => {
    if (Array.isArray(child.children) && child.children.length) groups.push(child);
    else items.push(child);
  });

  if (groups.length) {
    const style = cdgStyleForLevel(config.levelStyles, groups[0]?.level || Math.min((node.level || 2) + 1, 6));
    output.groupColumns = cdgLayoutForStyle(style, groups.length) === "grid" ? cdgColumnsForStyle(style, 2) : 1;
    output.groups = groups.map((group) => cdgToNode(group, config, context));
  }
  if (items.length) {
    output.items = items.map((item) => cdgToItem(item, config, context));
    const style = cdgStyleForLevel(config.levelStyles, items[0]?.level || Math.min((node.level || 2) + 1, 6));
    cdgApplyStyle(output, style, output.items.length);
  }
  if (groups.length && items.length) output.mixedItems = "integrated";
  return output;
}

export function resolveHeadingDrivenClassificationDiagramSpec(spec, headingTree) {
  if (!isHeadingDrivenClassificationDiagramSpec(spec)) return spec;
  const config = cdgNormalizeHeadingConfig(spec);
  const sourceRoots = cdgAnnotateStableHeadingKeys(Array.isArray(headingTree) ? headingTree : []);
  const roots = cdgFilterVisibleLevels(sourceRoots, config.visibleLevels);
  const h2Style = config.levelStyles.h2 || "stack";
  const diagram = {
    title: config.title,
    showSkeleton: config.showSkeleton,
    showSkeletonPrimary: config.showSkeletonPrimary,
    showSkeletonSecondary: config.showSkeletonSecondary,
    showSkeletonTertiary: config.showSkeletonTertiary,
    showBorders: config.showBorders,
    visibleLevels: config.visibleLevels || undefined,
    layout: h2Style === "grid2" || h2Style === "grid3" || h2Style === "grid4" ? "grid" : "stack",
    rootColumns: cdgColumnsForStyle(h2Style, 2),
    items: roots.map((root, rootIndex) => cdgToNode(root, config, { roots, rootIndex })),
  };
  return diagram;
}

function skeletonSideForPresetSlot(presetValue, slotIndex, columns = 1) {
  const preset = normalizeDiagramPreset(presetValue);
  const cols = Math.max(1, Number(columns) || 1);
  const slot = Number(slotIndex) || 0;

  if (preset === "tree-left") return slot === 0 ? "left" : "axis";
  if (preset === "tree-right") return slot === 0 ? "axis" : "right";
  if (preset === "flow-left") return "left";
  if (preset === "flow-right") return "right";
  if (preset === "tree") return cols > 1 && slot < cols / 2 ? "left" : "right";
  if (preset === "mind") return cols > 1 && slot < cols / 2 ? "left" : "right";
  return "center";
}

function skeletonLevelKind(level) {
  const n = Number(level);
  if (n === 2) return "primary";
  if (n === 3) return "secondary";
  if (n === 4) return "tertiary";
  return "primary";
}

/* =========================
   SVG skeleton geometry
   ========================= */
function rectRelativeTo(rect, parentRect) {
  const left = rect.left - parentRect.left;
  const top = rect.top - parentRect.top;
  const width = rect.width;
  const height = rect.height;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    cx: left + width / 2,
    cy: top + height / 2,
  };
}

function svgEl(doc, tag) {
  return doc.createElementNS("http://www.w3.org/2000/svg", tag);
}

function addSvgLine(svg, x1, y1, x2, y2, width, color) {
  if (![x1, y1, x2, y2].every(Number.isFinite)) return;
  const line = svgEl(svg.ownerDocument, "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", String(width));
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  svg.appendChild(line);
}

function addSvgPath(svg, d, width, color) {
  const path = svgEl(svg.ownerDocument, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", String(width));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
}

function firstDirectHeadingChip(el) {
  if (!el) return null;
  return (
    el.querySelector?.(":scope > :is(.cdg-h2,.cdg-h3,.cdg-h4,.cdg-h5) > .cdg-chip") ||
    el.querySelector?.(":scope > .cdg-timeline-group > .cdg-timeline-group-item:first-child > .cdg-node > :is(.cdg-h2,.cdg-h3,.cdg-h4,.cdg-h5) > .cdg-chip") ||
    null
  );
}

function directSkeletonRowsForNode(node) {
  if (!node) return [];
  return Array.from(node.querySelectorAll(":scope > .cdg-mixed-rows > .cdg-h3-skeleton-row"));
}

function directSkeletonSlotsForRow(row) {
  if (!row) return [];
  return Array.from(row.children).filter((child) => child.classList?.contains("cdg-node"));
}

function collectDirectSkeletonChips(node) {
  const parentRect = node.getBoundingClientRect();
  const rows = directSkeletonRowsForNode(node);
  const out = [];

  rows.forEach((row, rowIndex) => {
    directSkeletonSlotsForRow(row).forEach((slot, slotIndex) => {
      if (slot.classList?.contains("is-empty")) return;
      const chip = firstDirectHeadingChip(slot);
      if (!chip) return;
      const chipRect = rectRelativeTo(chip.getBoundingClientRect(), parentRect);
      const side = slot.dataset?.skeletonSide || skeletonSideForPresetSlot(node.dataset.diagramPreset, slotIndex, row.dataset?.skeletonCols || 1);
      out.push({ row, slot, chip, rowIndex, slotIndex, side, chipRect });
    });
  });

  if (!out.length) {
    const balanced = node.querySelector(":scope > .cdg-balanced-columns");
    const columnItems = balanced ? Array.from(balanced.children).filter((child) => child.classList?.contains("cdg-balanced-column-item")) : [];
    columnItems.forEach((slot, slotIndex) => {
      const childNode = slot.querySelector(":scope > .cdg-node");
      const chip = firstDirectHeadingChip(childNode);
      if (!chip) return;
      const chipRect = rectRelativeTo(chip.getBoundingClientRect(), parentRect);
      out.push({ row: balanced, slot, chip, rowIndex: 0, slotIndex, side: null, chipRect });
    });
  }

  out.sort((a, b) => a.chipRect.cy - b.chipRect.cy || a.chipRect.cx - b.chipRect.cx);
  return out;
}

function drawBranchToAxis(svg, chipRect, axisX, side, y, width, color) {
  const yy = Number.isFinite(y) ? y : chipRect.cy;
  if (side === "left") addSvgLine(svg, chipRect.right, yy, axisX, yy, width, color);
  else if (side === "right") addSvgLine(svg, axisX, yy, chipRect.left, yy, width, color);
  else addSvgLine(svg, axisX, Math.min(yy, chipRect.top), axisX, Math.max(yy, chipRect.top), width, color);
}

function skeletonEnabledForNode(rootEl, node) {
  if (!rootEl || !node) return false;
  if (rootEl.classList.contains("cdg-no-skeleton")) return false;
  const level = Number(node.dataset?.cdgLevel || node.dataset?.skeletonLevel || 2);
  if (level === 2 && rootEl.classList.contains("cdg-no-skeleton-primary")) return false;
  if (level === 3 && rootEl.classList.contains("cdg-no-skeleton-secondary")) return false;
  if (level === 4 && rootEl.classList.contains("cdg-no-skeleton-tertiary")) return false;
  return true;
}

function renderPresetSkeletonSvg(rootEl, node) {
  const preset = normalizeDiagramPreset(node?.dataset?.diagramPreset || node?.dataset?.skeletonStyle || "standard");
  if (!node) return;
  if (!skeletonEnabledForNode(rootEl, node)) return;

  const doc = node.ownerDocument;
  const parentRect = node.getBoundingClientRect();
  if (!parentRect.width || !parentRect.height) return;

  node.querySelectorAll(":scope > .cdg-skeleton-svg-overlay").forEach((el) => el.remove());

  const headingChip = firstDirectHeadingChip(node);
  if (!headingChip) return;
  const heading = rectRelativeTo(headingChip.getBoundingClientRect(), parentRect);
  const chips = collectDirectSkeletonChips(node);
  if (!chips.length) return;

  const computed = doc.defaultView?.getComputedStyle?.(node);
  const color = (computed?.getPropertyValue("--cdg-line-color") || "rgba(2, 6, 23, 0.10)").trim();
  const headingWrap = headingChip.closest?.(".cdg-h2,.cdg-h3,.cdg-h4,.cdg-h5");
  const isMajor = headingWrap?.classList?.contains("cdg-h2");
  const width = isMajor ? cssPx(node, "--cdg-skeleton-major-width", 3) : cssPx(node, "--cdg-skeleton-minor-width", 2);

  const svg = svgEl(doc, "svg");
  svg.classList.add("cdg-skeleton-svg-overlay");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", `0 0 ${Math.max(1, parentRect.width)} ${Math.max(1, parentRect.height)}`);
  svg.setAttribute("preserveAspectRatio", "none");

  const first = chips[0];
  const last = chips[chips.length - 1];
  const axisX = heading.cx;
  const gap = Math.max(10, cssPx(node, "--cdg-gap-group", 12));

  if (preset === "standard" || preset === "tree" || preset === "tree-left" || preset === "tree-right" || preset === "timeline") {
    const axisStartY = heading.bottom;
    const axisEndY = Math.max(axisStartY, last.chipRect.cy);
    addSvgLine(svg, axisX, axisStartY, axisX, axisEndY, width, color);

    if (preset !== "timeline") {
      chips.forEach((entry) => {
        const deltaX = entry.chipRect.cx - axisX;
        const side =
          preset === "tree-left"
            ? "left"
            : preset === "tree-right"
              ? "right"
              : entry.side === "left" || entry.side === "right"
                ? entry.side
                : Math.abs(deltaX) < 2
                  ? "center"
                  : deltaX < 0
                    ? "left"
                    : "right";
        if (side !== "center") drawBranchToAxis(svg, entry.chipRect, axisX, side, entry.chipRect.cy, width, color);
      });
    }
  } else if (preset === "flow-left" || preset === "flow-right") {
    const isLeft = preset === "flow-left";
    const childEdge = isLeft
      ? Math.max(...chips.map((entry) => entry.chipRect.right))
      : Math.min(...chips.map((entry) => entry.chipRect.left));
    let trunkX = isLeft ? (childEdge + heading.left) / 2 : (heading.right + childEdge) / 2;
    if (!Number.isFinite(trunkX)) trunkX = isLeft ? heading.left - gap : heading.right + gap;
    if (isLeft && trunkX >= heading.left) trunkX = heading.left - gap;
    if (!isLeft && trunkX <= heading.right) trunkX = heading.right + gap;

    addSvgLine(svg, trunkX, first.chipRect.cy, trunkX, last.chipRect.cy, width, color);
    chips.forEach((entry) => {
      if (isLeft) addSvgLine(svg, entry.chipRect.right, entry.chipRect.cy, trunkX, entry.chipRect.cy, width, color);
      else addSvgLine(svg, trunkX, entry.chipRect.cy, entry.chipRect.left, entry.chipRect.cy, width, color);
    });
    if (isLeft) addSvgLine(svg, trunkX, heading.cy, heading.left, heading.cy, width, color);
    else addSvgLine(svg, heading.right, heading.cy, trunkX, heading.cy, width, color);
  } else if (preset === "org") {
    const rows = directSkeletonRowsForNode(node);
    const orgStemVisualGap = Math.max(4, cssPx(node, "--cdg-org-stem-visual-gap", 6));
    const rowInfos = rows
      .map((row) => {
        const entries = chips.filter((entry) => entry.row === row);
        if (!entries.length) return null;
        const centers = entries.map((entry) => entry.chipRect.cx);
        const tops = entries.map((entry) => entry.chipRect.top);
        return {
          row,
          entries,
          y: Math.min(...tops) - orgStemVisualGap,
          minX: Math.min(...centers),
          maxX: Math.max(...centers),
        };
      })
      .filter(Boolean);

    if (rowInfos.length) {
      const firstY = Math.max(heading.bottom, rowInfos[0].y);
      const lastY = Math.max(firstY, rowInfos[rowInfos.length - 1].y);
      addSvgLine(svg, axisX, heading.bottom, axisX, lastY, width, color);
      rowInfos.forEach((info) => {
        const y = Math.max(heading.bottom, info.y);
        addSvgLine(svg, info.minX, y, info.maxX, y, width, color);
        info.entries.forEach((entry) => addSvgLine(svg, entry.chipRect.cx, y, entry.chipRect.cx, entry.chipRect.top, width, color));
      });
    }
  } else if (preset === "mind") {
    chips.forEach((entry) => {
      const side = entry.side === "left" || entry.side === "right" ? entry.side : entry.chipRect.cx < heading.cx ? "left" : "right";
      const sx = side === "left" ? heading.left : heading.right;
      const sy = heading.cy;
      const ex = side === "left" ? entry.chipRect.right : entry.chipRect.left;
      const ey = entry.chipRect.cy;
      const c1x = sx + (ex - sx) * 0.45;
      const c2x = sx + (ex - sx) * 0.55;
      addSvgPath(svg, `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ey}, ${ex} ${ey}`, width, color);
    });
  }

  node.insertBefore(svg, node.firstChild);
}

function applyDiagramSkeletonSvg(rootEl) {
  if (!rootEl || !rootEl.isConnected) return;
  rootEl.querySelectorAll(".cdg-skeleton-svg-overlay").forEach((el) => el.remove());
  if (rootEl.classList?.contains("cdg-no-skeleton")) return;
  rootEl.classList.add("cdg-svg-skeletons");
  rootEl
    .querySelectorAll('.cdg-h3-skeleton-node[data-diagram-preset]')
    .forEach((node) => renderPresetSkeletonSvg(rootEl, node));
}

function applyTimelineGroupSkeletonCut(rootEl) {
  if (!rootEl || !rootEl.isConnected) return;
  rootEl.querySelectorAll(".cdg-timeline-group").forEach((group) => {
    const chips = Array.from(
      group.querySelectorAll(":scope > .cdg-timeline-group-item > .cdg-node > :is(.cdg-h2,.cdg-h3,.cdg-h4,.cdg-h5) > .cdg-chip")
    );
    if (!chips.length) {
      group.style.setProperty("--cdg-timeline-height", "0px");
      return;
    }
    const groupRect = group.getBoundingClientRect();
    const first = chips[0].getBoundingClientRect();
    const last = chips[chips.length - 1].getBoundingClientRect();
    const top = first.top - groupRect.top + first.height / 2;
    const bottom = last.top - groupRect.top + last.height / 2;
    group.style.setProperty("--cdg-timeline-top", `${Math.max(0, top)}px`);
    group.style.setProperty("--cdg-timeline-height", `${Math.max(0, bottom - top)}px`);
  });
}

function applySideTreeLayoutVars(rootEl) {
  if (!rootEl || !rootEl.isConnected) return;
  rootEl
    .querySelectorAll('.cdg-h3-skeleton-node[data-diagram-preset="tree-left"], .cdg-h3-skeleton-node[data-diagram-preset="tree-right"]')
    .forEach((node) => {
      const headingChip = firstDirectHeadingChip(node);
      if (!headingChip) return;
      const rect = headingChip.getBoundingClientRect?.();
      if (!rect || !Number.isFinite(rect.width)) return;

      const computed = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
      const rawColumnGap = computed?.columnGap || "10px";
      const columnGap = Number.parseFloat(rawColumnGap);
      const gap = Number.isFinite(columnGap) ? columnGap : 10;
      const branchGap = cssPx(node, "--cdg-side-tree-branch-gap", 8);

      const shift = Math.max(0, rect.width / 2 + gap - branchGap);
      node.style.setProperty("--cdg-side-tree-shift", `${shift.toFixed(2)}px`);
    });
}

function refreshDiagramGeometry(rootEl) {
  if (!rootEl || !rootEl.isConnected) return;
  applySpineCut(rootEl);
  applyTimelineGroupSkeletonCut(rootEl);
  applySideTreeLayoutVars(rootEl);
  applyDiagramSkeletonSvg(rootEl);
}

function scheduleDiagramGeometryRefresh(rootEl) {
  if (!rootEl) return () => {};
  let cancelled = false;
  const run = () => {
    if (!cancelled) refreshDiagramGeometry(rootEl);
  };

  requestAnimationFrame(() => {
    run();
    requestAnimationFrame(run);
  });
  const timeouts = [40, 120, 260, 520, 900].map((delay) => window.setTimeout(run, delay));

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => requestAnimationFrame(run)) : null;
  if (ro) {
    ro.observe(rootEl);
    rootEl.querySelectorAll?.('.cdg-h3-skeleton-node[data-diagram-preset], .cdg-timeline-group').forEach((node) => ro.observe(node));
  }

  return () => {
    cancelled = true;
    timeouts.forEach((id) => window.clearTimeout(id));
    ro?.disconnect();
  };
}

/* =========================
   UI primitive
   ========================= */
function Item({ label, anchor, to, className = "" }) {
  if (anchor) {
    return (
      <button
        type="button"
        className={`cdg-chip ${className}`}
        onClick={() => scrollToHeadingText(anchor)}
      >
        {label}
      </button>
    );
  }

  if (typeof to === "string" && to.startsWith("/")) {
    return (
      <Link className={`cdg-chip ${className}`} to={to}>
        {label}
      </Link>
    );
  }

  if (typeof to === "string" && (to.startsWith("https://") || to.startsWith("http://"))) {
    return (
      <a className={`cdg-chip ${className}`} href={to} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
  }

  return (
    <span className={`cdg-chip cdg-chip-disabled ${className}`} aria-disabled="true">
      {label}
    </span>
  );
}

function MaskedChip({ className = "", placeholder = "Afficher", onReveal }) {
  return (
    <button type="button" className={`cdg-chip ${className}`} onClick={onReveal}>
      {placeholder}
    </button>
  );
}

/* =========================
   Spine cut (stack)
   ========================= */
function applySpineCut(rootEl) {
  if (!rootEl) return;

  const lists = rootEl.querySelectorAll('.cdg-list[data-layout="stack"]');

  lists.forEach((list) => {
    const targets = list.querySelectorAll(".cdg-spine-target");
    const last = targets.length ? targets[targets.length - 1] : null;

    if (!last) {
      list.style.setProperty("--cdg-spine-height", "0px");
      return;
    }

    const listRect = list.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const lastCenterY = lastRect.top - listRect.top + lastRect.height / 2;

    const spineTop = 2;
    const height = Math.max(0, lastCenterY - spineTop);

    list.style.setProperty("--cdg-spine-top", `${spineTop}px`);
    list.style.setProperty("--cdg-spine-height", `${height}px`);
  });
}

/* =========================
   Layout resolvers
   ========================= */
function resolveLayout(node, autoThreshold = 6) {
  const explicit = node?.layout;
  if (explicit === "grid" || explicit === "stack") return explicit;

  const count =
    (Array.isArray(node?.items) ? node.items.length : 0) +
    (Array.isArray(node?.groups) ? node.groups.length : 0);

  return count >= autoThreshold ? "grid" : "stack";
}

function resolveCols(node, fallback = 2) {
  const c = Number(node?.columns);
  return Number.isFinite(c) && c >= 1 && c <= 4 ? c : fallback;
}

function resolveGroupCols(node, fallback = 1) {
  const c = Number(node?.groupColumns);
  return Number.isFinite(c) && c >= 1 && c <= 4 ? c : fallback;
}

/* =========================
   Hiérarchie sans toucher aux JSON :
   - si un node n’a pas de label => wrapper structurel => depth inchangé
   ========================= */
function nextDepthForGroup(parentNode, currentDepth) {
  const isStructuralWrapper = !parentNode?.label;
  return isStructuralWrapper ? currentDepth : Math.min(currentDepth + 1, 6);
}

/* =========================
   Training (React only)
   ========================= */
const MIN_LEVEL = -1;
const MAX_LEVEL = 2;

function hideLabelsFromDepth(level) {
  if (level <= 0) return 999;
  if (level === 1) return 3;
  return 2;
}

function collectHideTargets(node, depth, path, level, out) {
  if (!node) return;

  if (node?.groupType === "timeline" && Array.isArray(node.nodes)) {
    node.nodes.forEach((child, i) => collectHideTargets(child, child?.level || depth, `${path}/timeline/${i}`, level, out));
    return;
  }

  const items = Array.isArray(node?.items) ? node.items : [];
  const groups = Array.isArray(node?.groups) ? node.groups : [];

  const fromDepth = hideLabelsFromDepth(level);
  if (node?.label && depth >= fromDepth) out.push(`${path}/label`);

  if (level >= 0) {
    for (let i = 0; i < items.length; i++) {
      out.push(`${path}/item/${i}`);

      const it = items[i];

      if (it?.children?.items && Array.isArray(it.children.items)) {
        for (let ci = 0; ci < it.children.items.length; ci++) {
          out.push(`${path}/item/${i}/children/item/${ci}`);
        }
      }

      if (it?.children?.groups && Array.isArray(it.children.groups)) {
        for (let gi = 0; gi < it.children.groups.length; gi++) {
          collectHideTargets(
            it.children.groups[gi],
            Math.min(depth + 2, 6),
            `${path}/item/${i}/children/group/${gi}`,
            level,
            out
          );
        }
      }
    }
  }

  if (Array.isArray(node?.mixedRows)) {
    for (let ri = 0; ri < node.mixedRows.length; ri++) {
      const row = node.mixedRows[ri];
      const nodes = Array.isArray(row?.nodes) ? row.nodes : [];
      for (let ni = 0; ni < nodes.length; ni++) {
        collectHideTargets(nodes[ni], nodes[ni]?.level || Math.min(depth + 1, 6), `${path}/row/${ri}/node/${ni}`, level, out);
      }
    }
  }

  for (let gi = 0; gi < groups.length; gi++) {
    const nd = nextDepthForGroup(node, depth);
    collectHideTargets(groups[gi], nd, `${path}/group/${gi}`, level, out);
  }
}

function headingWrapClass(level) {
  const n = Number(level) || 2;
  if (n <= 2) return "cdg-h2";
  if (n === 3) return "cdg-h3";
  if (n === 4) return "cdg-h4";
  return "cdg-h5";
}

function headingChipClass(level) {
  const n = Number(level) || 2;
  if (n <= 2) return "cdg-chip-h2";
  if (n === 3) return "cdg-chip-h3";
  if (n === 4) return "cdg-chip-h4";
  if (n === 5) return "cdg-chip-h5";
  return "cdg-chip-h6";
}

function itemChipClass(parentLevel) {
  const n = Number(parentLevel) || 2;
  if (n >= 5) return "cdg-chip-h6";
  if (n >= 4) return "cdg-chip-h5";
  return "cdg-chip-h4";
}

/* =========================
   Child renderer
   ========================= */
function ChildBlock({ child, depth, path, trainingOn, hidden, reveal }) {
  if (!child) return null;

  const childItems = Array.isArray(child?.items) ? child.items : [];
  const childGroups = Array.isArray(child?.groups) ? child.groups : [];

  const childLayout = resolveLayout(child);
  const childCols = resolveCols(child, 2);
  const childGroupCols = resolveGroupCols(child, 1);

  const childChip = depth >= 4 ? "cdg-chip-h6" : "cdg-chip-h5";

  return (
    <div className="cdg-subwrap">
      {childItems.length ? (
        <div className="cdg-sublist" data-layout={childLayout} style={{ "--cdg-cols": String(childCols) }}>
          {childItems.map((c, ci) => {
            const id = `${path}/item/${ci}`;
            const isHidden = trainingOn && hidden.has(id);

            return isHidden ? (
              <MaskedChip key={id} className={`${childChip} ${cdgAlignmentClass(c.align)}`} onReveal={() => reveal(id)} />
            ) : (
              <Item key={id} label={c.label} anchor={c.anchor} to={c.to} className={`${childChip} ${cdgAlignmentClass(c.align)}`} />
            );
          })}
        </div>
      ) : null}

      {childGroups.length ? (
        <div className="cdg-groups" style={{ "--cdg-groups-cols": String(childGroupCols) }}>
          {childGroups.map((g, gi) => (
            <NodeBlock
              key={`${path}/group/${gi}`}
              node={g}
              depth={Math.min(depth + 2, 6)}
              path={`${path}/group/${gi}`}
              trainingOn={trainingOn}
              hidden={hidden}
              reveal={reveal}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* =========================
   Recursive renderer
   ========================= */
function NodeBlock({ node, depth = 2, path = "root", trainingOn, hidden, reveal, skeletonSide = null }) {
  if (!node) return <div className={`cdg-node cdg-depth-${depth} is-empty`} data-skeleton-side={skeletonSide || undefined} />;

  const headingLevel = node.level || depth;

  if (node.groupType === "timeline" && Array.isArray(node.nodes)) {
    return (
      <div
        className={`cdg-node cdg-depth-${headingLevel} cdg-timeline-group-node`}
        data-cdg-level={String(Math.max(2, Number(headingLevel) - 1))}
        data-skeleton-side={skeletonSide || undefined}
      >
        <div className="cdg-timeline-group">
          {node.nodes.map((childNode, groupIndex) => (
            <div key={`${path}/timeline/${groupIndex}`} className="cdg-timeline-group-item">
              <NodeBlock
                node={childNode}
                depth={headingLevel}
                path={`${path}/timeline/${groupIndex}`}
                trainingOn={trainingOn}
                hidden={hidden}
                reveal={reveal}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const headingWrap = headingWrapClass(headingLevel);
  const headingChip = `${headingChipClass(headingLevel)} ${cdgAlignmentClass(node.align)}`;
  const layout = resolveLayout(node);
  const cols = resolveCols(node, 2);
  const groupCols = resolveGroupCols(node, 1);

  const items = Array.isArray(node?.items) ? node.items : [];
  const groups = Array.isArray(node?.groups) ? node.groups : [];
  const customRowMode = node.mixedItems === "customRows" && Array.isArray(node.mixedRows);
  const diagramPreset = normalizeDiagramPreset(node.diagramPreset || node.skeletonStyle || "standard");
  const standardColumnMode = customRowMode && diagramPreset === "standard";
  const standardColumnCount = standardColumnMode
    ? Math.max(
        1,
        ...node.mixedRows.map((row) => Math.max(1, Number(row?.columns) || (Array.isArray(row?.nodes) ? row.nodes.length : 1)))
      )
    : 1;
  const standardColumnNodes = standardColumnMode
    ? node.mixedRows.flatMap((row, rowIndex) =>
        (Array.isArray(row?.nodes) ? row.nodes : [])
          .map((childNode, childIndex) => ({ childNode, rowIndex, childIndex }))
          .filter((entry) => Boolean(entry.childNode))
      )
    : [];

  const itemChip = itemChipClass(headingLevel);

  const labelId = `${path}/label`;
  const labelHidden = trainingOn && hidden.has(labelId);

  const rootClasses = [`cdg-node`, `cdg-depth-${headingLevel}`];
  if (customRowMode && Number(headingLevel) <= 4) rootClasses.push("cdg-h3-skeleton-node");

  return (
    <div
      className={rootClasses.join(" ")}
      data-cdg-level={String(headingLevel)}
      data-skeleton-level={customRowMode ? String(headingLevel) : undefined}
      data-diagram-preset={customRowMode ? diagramPreset : undefined}
      data-skeleton-style={customRowMode ? diagramPreset : undefined}
      data-skeleton-side={skeletonSide || undefined}
    >
      {node.label ? (
        <div className={headingWrap}>
          {labelHidden ? (
            <MaskedChip className={headingChip} onReveal={() => reveal(labelId)} />
          ) : (
            <Item label={node.label} anchor={node.anchor} to={node.to} className={headingChip} />
          )}
        </div>
      ) : null}

      {customRowMode ? (
        standardColumnMode ? (
          <div
            className="cdg-balanced-columns cdg-standard-columns"
            style={{ "--cdg-balanced-cols": String(Math.min(4, standardColumnCount)) }}
          >
            {standardColumnNodes.map(({ childNode, rowIndex, childIndex }, flatIndex) => (
              <div key={`${path}/balanced/${flatIndex}`} className="cdg-balanced-column-item">
                <NodeBlock
                  node={childNode}
                  depth={childNode?.level || Math.min(headingLevel + 1, 6)}
                  path={`${path}/row/${rowIndex}/node/${childIndex}`}
                  trainingOn={trainingOn}
                  hidden={hidden}
                  reveal={reveal}
                />
              </div>
            ))}
          </div>
        ) : (
          <div
            className="cdg-mixed-rows cdg-mixed-rows-custom cdg-h3-skeleton"
            data-diagram-preset={diagramPreset}
            data-skeleton-style={diagramPreset}
          >
            {node.mixedRows.map((row, rowIndex) => {
              const rowNodes = Array.isArray(row?.nodes) ? row.nodes : [];
              const rowCols = clampInt(row?.columns, 1, 4, rowNodes.length || 1);
              const visibleSlots = Math.max(rowCols, rowNodes.length || 0);
              const slots = Array.from({ length: visibleSlots }, (_, i) => rowNodes[i] ?? null);
              return (
                <div
                  key={`${path}/row/${rowIndex}`}
                  className={`cdg-mixed-row cdg-mixed-row-${rowIndex + 1} cdg-h3-skeleton-row`}
                  data-skeleton-cols={String(rowCols)}
                  data-skeleton-style={diagramPreset}
                  data-diagram-preset={diagramPreset}
                  style={{ "--cdg-row-cols": String(rowCols) }}
                >
                  {slots.map((childNode, childIndex) => {
                    const side = skeletonSideForPresetSlot(diagramPreset, childIndex, rowCols);
                    return (
                      <NodeBlock
                        key={`${path}/row/${rowIndex}/node/${childIndex}`}
                        node={childNode}
                        depth={childNode?.level || Math.min(headingLevel + 1, 6)}
                        path={`${path}/row/${rowIndex}/node/${childIndex}`}
                        trainingOn={trainingOn}
                        hidden={hidden}
                        reveal={reveal}
                        skeletonSide={side}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {!customRowMode && items.length ? (
        layout === "grid" ? (
          <div className="cdg-list" data-layout="grid" style={{ "--cdg-cols": String(cols) }}>
            {items.map((it, i) => {
              const id = `${path}/item/${i}`;
              const isHidden = trainingOn && hidden.has(id);

              return isHidden ? (
                <MaskedChip key={id} className={`${itemChip} ${cdgAlignmentClass(it.align)}`} onReveal={() => reveal(id)} />
              ) : (
                <Item key={id} label={it.label} anchor={it.anchor} to={it.to} className={`${itemChip} ${cdgAlignmentClass(it.align)}`} />
              );
            })}
          </div>
        ) : (
          <div className="cdg-list" data-layout="stack">
            {items.map((it, i) => {
              const id = `${path}/item/${i}`;
              const isHidden = trainingOn && hidden.has(id);

              return (
                <div key={id} className="cdg-stack-row">
                  {isHidden ? (
                    <MaskedChip className={`${itemChip} ${cdgAlignmentClass(it.align)} cdg-spine-target`} onReveal={() => reveal(id)} />
                  ) : (
                    <Item
                      label={it.label}
                      anchor={it.anchor}
                      to={it.to}
                      className={`${itemChip} ${cdgAlignmentClass(it.align)} cdg-spine-target`}
                    />
                  )}

                  {it?.children ? (
                    <ChildBlock
                      child={it.children}
                      depth={headingLevel}
                      path={`${path}/item/${i}/children`}
                      trainingOn={trainingOn}
                      hidden={hidden}
                      reveal={reveal}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {!customRowMode && groups.length ? (
        <div className="cdg-groups" style={{ "--cdg-groups-cols": String(groupCols) }}>
          {groups.map((g, i) => {
            const nd = nextDepthForGroup(node, headingLevel);
            return (
              <NodeBlock
                key={`${path}/group/${i}`}
                node={g}
                depth={nd}
                path={`${path}/group/${i}`}
                trainingOn={trainingOn}
                hidden={hidden}
                reveal={reveal}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* =========================
   Root
   ========================= */
export default function ClassificationDiagram({
  title,
  layout = "cols",
  left,
  right,
  items,
  rootColumns = 2,
  showSkeleton = true,
  showSkeletonPrimary,
  showSkeletonSecondary,
  showSkeletonTertiary,
  showBorders = true,

  // ✅ ajouté : change quand tu changes d’item via la liste
  scopeKey = "",
}) {
  const rootRef = useRef(null);

  const legacySkeletonVisible = showSkeleton !== false;
  const skeletonPrimary = legacySkeletonVisible && showSkeletonPrimary !== false;
  const skeletonSecondary = legacySkeletonVisible && showSkeletonSecondary !== false;
  const skeletonTertiary = legacySkeletonVisible && showSkeletonTertiary !== false;

  const hasRootItems = useMemo(() => Array.isArray(items) && items.length > 0, [items]);

  const safeRootCols = clampInt(rootColumns, 1, 4, 2);
  const topLayout = layout === "stack" ? "stack" : "cols";

  // Training
  const [trainingOn, setTrainingOn] = useState(false);
  const [maskLevel, setMaskLevel] = useState(0);
  const [revealed, setRevealed] = useState(() => new Set());

  // ✅ NOUVEAU : si on change d’item (via sidebar), on sort de l’entraînement
  useEffect(() => {
    setTrainingOn(false);
    setMaskLevel(0);
    setRevealed(new Set());
  }, [scopeKey]);

  const rootNodes = useMemo(() => {
    if (hasRootItems) {
      return items.map((n, i) => ({ node: n, depth: 2, path: `root/node/${i}` }));
    }
    return [
      { node: left, depth: 2, path: "root/left" },
      { node: right, depth: 2, path: "root/right" },
    ];
  }, [hasRootItems, items, left, right]);

  const baseHidden = useMemo(() => {
    if (!trainingOn) return new Set();
    if (maskLevel === -1) return new Set();

    const targets = [];
    for (const r of rootNodes) {
      collectHideTargets(r.node, r.depth, r.path, maskLevel, targets);
    }
    return new Set(targets);
  }, [trainingOn, rootNodes, maskLevel]);

  const hidden = useMemo(() => {
    if (!trainingOn) return new Set();
    const s = new Set(baseHidden);
    for (const id of revealed) s.delete(id);
    return s;
  }, [trainingOn, baseHidden, revealed]);

  const reveal = useCallback((id) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const incLevel = useCallback(() => {
    setRevealed(new Set());
    setMaskLevel((v) => (v >= MAX_LEVEL ? v : v + 1));
  }, []);

  const decLevel = useCallback(() => {
    setMaskLevel((v) => Math.max(MIN_LEVEL, v - 1));
  }, []);

  useEffect(() => {
    const rootEl = rootRef.current;
    if (!rootEl) return undefined;

    const cleanupGeometry = scheduleDiagramGeometryRefresh(rootEl);
    const onResize = () => requestAnimationFrame(() => refreshDiagramGeometry(rootEl));
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      cleanupGeometry?.();
    };
  }, [title, layout, left, right, items, rootColumns, trainingOn, maskLevel, revealed, skeletonPrimary, skeletonSecondary, skeletonTertiary]);

  const canMinus = maskLevel < MAX_LEVEL || revealed.size > 0;
  const canPlus = maskLevel > MIN_LEVEL;

  const rootClasses = ["cdg"];
  if (!skeletonPrimary) rootClasses.push("cdg-no-skeleton-primary");
  if (!skeletonSecondary) rootClasses.push("cdg-no-skeleton-secondary");
  if (!skeletonTertiary) rootClasses.push("cdg-no-skeleton-tertiary");
  if (!skeletonPrimary && !skeletonSecondary && !skeletonTertiary) rootClasses.push("cdg-no-skeleton");
  if (showBorders === false) rootClasses.push("cdg-no-borders");

  return (
    <section ref={rootRef} className={rootClasses.join(" ")} aria-label={title || "Diagramme de classification"}>
      {title ? (
        <div className="cdg-root cdg-root--with-controls">
          <span className="cdg-chip cdg-chip-h1">{title}</span>

          <div className="cdg-root-controls">
            {trainingOn ? (
              <>
                <button
                  type="button"
                  className="cdg-chip cdg-chip-h6"
                  onClick={incLevel}
                  disabled={!canMinus}
                  aria-disabled={!canMinus}
                  title={maskLevel >= MAX_LEVEL ? "Remasquer" : "Augmenter le masquage"}
                >
                  -
                </button>

                <button
                  type="button"
                  className="cdg-chip cdg-chip-h6"
                  onClick={decLevel}
                  disabled={!canPlus}
                  aria-disabled={!canPlus}
                  title="Réduire le masquage"
                >
                  +
                </button>

                <button
                  type="button"
                  className="cdg-chip cdg-chip-h6"
                  onClick={() => {
                    setTrainingOn(false);
                    setMaskLevel(0);
                    setRevealed(new Set());
                  }}
                  title="Quitter le mode entraînement (tout est affiché)"
                >
                  Quitter
                </button>
              </>
            ) : (
              <button
                type="button"
                className="cdg-chip cdg-chip-h6 cdg-training-toggle"
                onClick={() => {
                  setTrainingOn(true);
                  setMaskLevel(0);
                  setRevealed(new Set());
                }}
                title="Activer le mode entraînement"
              >
                Entraînement
              </button>
            )}
          </div>
        </div>
      ) : null}

      {hasRootItems ? (
        <div
          className="cdg-root-items"
          data-layout={layout === "grid" ? "grid" : "stack"}
          data-columns={layout === "grid" ? String(safeRootCols) : undefined}
          style={layout === "grid" ? { "--cdg-cols": String(safeRootCols) } : undefined}
        >
          {items.map((n, i) => (
            <NodeBlock
              key={`root/node/${i}`}
              node={n}
              depth={2}
              path={`root/node/${i}`}
              trainingOn={trainingOn}
              hidden={hidden}
              reveal={reveal}
            />
          ))}
        </div>
      ) : (
        <div className="cdg-cols" data-layout={topLayout}>
          <div className="cdg-col">
            <NodeBlock node={left} depth={2} path="root/left" trainingOn={trainingOn} hidden={hidden} reveal={reveal} />
          </div>
          <div className="cdg-col">
            <NodeBlock
              node={right}
              depth={2}
              path="root/right"
              trainingOn={trainingOn}
              hidden={hidden}
              reveal={reveal}
            />
          </div>
        </div>
      )}
    </section>
  );
}
