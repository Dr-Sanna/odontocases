// src/components/CaseMarkdown.jsx
import { useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

import { ckeditorSchema } from '../lib/markdown/ckeditorSchema';
import { remarkObsidianCallouts } from '../lib/markdown/remarkObsidianCallouts';
import { remarkFigureCaptions } from '../lib/markdown/remarkFigureCaptions';

function normalizeEscapedBlockquotes(src) {
  if (typeof src !== 'string') return src;
  return src.replace(/^[ \t]*\\>\s?/gm, '> ');
}

/* =========================
   RÉGLAGES
   ========================= */
const MOBILE_BREAKPOINT = 980;

// hauteur commune par ligne (clamp)
const ROW_MIN_H = 150;
const ROW_MAX_H = 260;

// marge sécurité
const SAFETY_PX = 2;

// cap ratio pour éviter pano extrême qui réduit trop la hauteur commune
const RATIO_FIT_CAP = 2.2;

// min/soft-max par nb colonnes (base)
const COL_MIN_W = { 1: 320, 2: 280, 3: 260, 4: 240 };
const COL_SOFT_MAX_W = { 1: 900, 2: 650, 3: 600, 4: 480 };

// espace entre colonnes (approx)
const COL_GUTTER = 14;

function isMobileNow() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function px(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function getIntrinsicSize(img) {
  if (!img) return null;

  if (img.naturalWidth && img.naturalHeight) return { w: img.naturalWidth, h: img.naturalHeight };

  const wAttr = parseFloat(img.getAttribute('width'));
  const hAttr = parseFloat(img.getAttribute('height'));
  if (wAttr > 0 && hAttr > 0) return { w: wAttr, h: hAttr };

  return null;
}

function clearSizing(img) {
  img.style.removeProperty('height');
  img.style.removeProperty('width');
  img.style.removeProperty('max-height');
  img.style.removeProperty('max-width');
}

function resetTableSizing(rootEl) {
  const imgs = rootEl.querySelectorAll('table td img');
  imgs.forEach((img) => clearSizing(img));

  const caps = rootEl.querySelectorAll('table td figcaption');
  caps.forEach((cap) => {
    cap.style.removeProperty('width');
    cap.style.removeProperty('max-width');
    cap.style.removeProperty('hyphens');
    cap.style.removeProperty('word-break');
    cap.style.removeProperty('overflow-wrap');
  });
}

function waitForImagesIn(rootEl) {
  const imgs = rootEl.querySelectorAll('table td img');
  const promises = Array.from(imgs).map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((res) => img.addEventListener('load', res, { once: true }));
  });
  return Promise.allSettled(promises);
}

function applyFixed(img, h, w) {
  clearSizing(img);
  img.style.setProperty('height', `${Math.round(h)}px`, 'important');
  img.style.setProperty('width', `${Math.round(w)}px`, 'important');
  img.style.setProperty('max-height', 'none', 'important');
  img.style.setProperty('max-width', 'none', 'important');
}

function normalizeNbspIn(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let t = walker.nextNode();
  while (t) {
    if (t.nodeValue && t.nodeValue.includes('\u00A0')) {
      t.nodeValue = t.nodeValue.replace(/\u00A0/g, ' ');
    }
    t = walker.nextNode();
  }
}

function getUsableWidthFromLayout(rootEl) {
  const shell = rootEl.closest('.cd-shell') || document.querySelector('.cd-shell');
  const baseW = shell?.getBoundingClientRect?.().width || document.documentElement.clientWidth || window.innerWidth || 0;

  const narrow = isMobileNow();

  const side = document.querySelector('.cd-side');
  const sideW = !narrow && side ? side.getBoundingClientRect().width : 0;

  const sideCS = side ? getComputedStyle(side) : null;
  const sideBorderR = sideCS ? px(sideCS.borderRightWidth) : 0;

  const main = rootEl.closest('.cd-main') || document.querySelector('.cd-main');
  const mainCS = main ? getComputedStyle(main) : null;
  const mainPad = mainCS ? px(mainCS.paddingLeft) + px(mainCS.paddingRight) : 0;

  const article = rootEl.closest('.casedetail') || document.querySelector('.casedetail');
  const artCS = article ? getComputedStyle(article) : null;
  const artPadR = artCS ? px(artCS.paddingRight) : 0;

  const SAFETY = 6;

  const usable = baseW - sideW - sideBorderR - mainPad - artPadR - SAFETY;
  return Math.max(0, usable);
}

function computeTargetW(cols, rootEl) {
  const c = Math.max(1, Math.min(4, cols));
  const usable = getUsableWidthFromLayout(rootEl);
  if (!usable) return 0;

  const raw = (usable - COL_GUTTER * (c - 1)) / c;
  const minW = COL_MIN_W[c] ?? 240;
  const softMax = COL_SOFT_MAX_W[c] ?? 520;

  return clamp(raw, minW, softMax);
}

function fitRatio(r) {
  if (!Number.isFinite(r) || r <= 0) return 1;
  return Math.min(r, RATIO_FIT_CAP);
}

/* =========================
   CAPTION WIDTH
   - 1 colonne: caption = image
   - 2–4 colonnes: caption peut dépasser un peu l'image
   - plafond = largeur intérieure réelle du TD
   - pas de hyphenation
   ========================= */
function applyCaptionWidth(img, imgW, ratio, cols, rootEl) {
  const fig = img.closest?.('figure');
  const cap = fig?.querySelector?.('figcaption');
  if (!cap) return;

  normalizeNbspIn(cap);

  // pas d'hyphenation
  cap.style.setProperty('hyphens', 'none');
  cap.style.setProperty('word-break', 'normal');
  cap.style.setProperty('overflow-wrap', 'break-word'); // coupe sans tirets

  // largeur intérieure réelle du TD (si dispo)
  const td = img.closest?.('td');
  let tdInnerW = 0;

  if (td) {
    const cs = getComputedStyle(td);
    const padL = px(cs.paddingLeft);
    const padR = px(cs.paddingRight);
    tdInnerW = Math.max(0, td.getBoundingClientRect().width - padL - padR);
  }

  // fallback (rare)
  const fallbackW = computeTargetW(cols, rootEl) - SAFETY_PX;
  const capCeilW = tdInnerW > 0 ? tdInnerW : fallbackW;

  if (cols <= 1) {
    cap.style.removeProperty('width');
    cap.style.setProperty('max-width', `${Math.round(imgW)}px`, 'important');
    return;
  }

  // 2–4 colonnes: dépassement autorisé
  // (plus si portrait, peu si pano)
  const relaxMult =
    ratio < 1.0 ? 2.5 :
    ratio > 2 ? 2 :
    2;

  const wanted = Math.max(imgW, imgW * relaxMult);
  const capMaxW = Math.min(capCeilW, wanted);

  cap.style.removeProperty('width');
  cap.style.setProperty('max-width', `${Math.round(capMaxW)}px`, 'important');
}

/* =========================
   LAYOUT ROW (ANTI-DÉBORDEMENT)
   ========================= */
function layoutRow(row, rootEl) {
  const imgs = Array.from(row.querySelectorAll('td figure.image img, td figure.cd-figure img, td > img'));
  if (imgs.length < 1) return;

  const items = [];
  for (const img of imgs) {
    const sz = getIntrinsicSize(img);
    if (!sz) continue;

    const ratio = sz.w / sz.h;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;

    items.push({ img, hReal: sz.h, ratio });
  }
  if (items.length < 1) return;

  const cols = items.length;

  const targetW = computeTargetW(cols, rootEl) - SAFETY_PX;
  if (!targetW) return;

  const hMinReal = items.reduce((m, it) => Math.min(m, it.hReal), Infinity);
  const baseH = clamp(hMinReal, ROW_MIN_H, ROW_MAX_H);

  let hFit = Infinity;
  for (const it of items) {
    hFit = Math.min(hFit, targetW / fitRatio(it.ratio));
  }
  if (!Number.isFinite(hFit) || hFit <= 0) return;

  let H = Math.min(baseH, hFit);

  // anti-débordement global de la ligne (sur l'espace réellement dispo)
  const usable = getUsableWidthFromLayout(rootEl);
  const availableRowW = Math.max(0, usable - SAFETY_PX * 2);

  const totalW = items.reduce((sum, it) => sum + H * it.ratio, 0) + COL_GUTTER * (cols - 1);

  if (availableRowW > 0 && totalW > availableRowW) {
    const scale = availableRowW / totalW;
    H = H * scale;
  }

  for (const it of items) {
    const W = H * it.ratio;
    applyFixed(it.img, H, W);
    applyCaptionWidth(it.img, W, it.ratio, cols, rootEl);
  }
}

function layoutAllTables(rootEl) {
  const tables = rootEl.querySelectorAll('.cd-content table, table');
  tables.forEach((table) => {
    const rows = table.querySelectorAll('tr');
    rows.forEach((row) => layoutRow(row, rootEl));
  });
}

function runRelayoutLoop(relayoutFn, durationMs = 420) {
  const start = performance.now();
  let rafId = 0;

  const tick = (now) => {
    relayoutFn();
    if (now - start < durationMs) rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

export default function CaseMarkdown({ children }) {
  const containerRef = useRef(null);
  const source = useMemo(() => normalizeEscapedBlockquotes(String(children ?? '')), [children]);

  useEffect(() => {
    let cancelled = false;
    const rootEl = containerRef.current;
    if (!rootEl) return;

    const relayout = () => {
      if (cancelled) return;

      if (isMobileNow()) {
        resetTableSizing(rootEl);
        return;
      }

      layoutAllTables(rootEl);
      layoutAllTables(rootEl);
    };

    const run = async () => {
      await waitForImagesIn(rootEl);
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (!cancelled) relayout();
      });
    };

    run();

    const ro = new ResizeObserver(() => relayout());
    ro.observe(rootEl);

    const shell = rootEl.closest('.cd-shell') || document.querySelector('.cd-shell');
    const side = document.querySelector('.cd-side');
    const main = rootEl.closest('.cd-main') || document.querySelector('.cd-main');

    if (shell) ro.observe(shell);
    if (side) ro.observe(side);
    if (main) ro.observe(main);

    let stopLoop = null;
    const startLoop = () => {
      if (stopLoop) stopLoop();
      stopLoop = runRelayoutLoop(() => {
        if (!cancelled) relayout();
      }, 450);
    };

    const onTransitionRun = (e) => {
      if (cancelled) return;
      if (e.propertyName !== 'width' && e.propertyName !== 'grid-template-columns') return;
      startLoop();
    };

    const onTransitionEnd = (e) => {
      if (cancelled) return;
      if (e.propertyName !== 'width' && e.propertyName !== 'grid-template-columns') return;
      relayout();
      if (stopLoop) {
        const s = stopLoop;
        stopLoop = null;
        s();
      }
    };

    if (shell) {
      shell.addEventListener('transitionrun', onTransitionRun);
      shell.addEventListener('transitionend', onTransitionEnd);
    }
    if (side) {
      side.addEventListener('transitionrun', onTransitionRun);
      side.addEventListener('transitionend', onTransitionEnd);
    }

    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const onMqChange = () => relayout();
    if (mq.addEventListener) mq.addEventListener('change', onMqChange);
    else mq.addListener(onMqChange);

    let t = null;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => relayout(), 80);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      ro.disconnect();

      window.removeEventListener('resize', onResize);
      if (t) clearTimeout(t);

      if (shell) {
        shell.removeEventListener('transitionrun', onTransitionRun);
        shell.removeEventListener('transitionend', onTransitionEnd);
      }
      if (side) {
        side.removeEventListener('transitionrun', onTransitionRun);
        side.removeEventListener('transitionend', onTransitionEnd);
      }

      if (mq.removeEventListener) mq.removeEventListener('change', onMqChange);
      else mq.removeListener(onMqChange);

      if (stopLoop) stopLoop();
    };
  }, [source]);

  return (
    <div ref={containerRef}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFigureCaptions, remarkObsidianCallouts]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, ckeditorSchema]]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
