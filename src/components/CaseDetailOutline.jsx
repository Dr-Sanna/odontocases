import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const HEADING_SELECTOR = 'h2, h3, h4, h5';

function normalizeIdPart(value, fallback = 'section') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function buildGeneratedHeadingId({ heading, text, level, scopeKey }) {
  const scope = normalizeIdPart(scopeKey, 'article');
  const label = normalizeIdPart(text, `h${level}`);
  const base = `cd-${scope}-${label}`;

  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = document.getElementById(candidate);
    if (!existing || existing === heading) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function buildOutlineTree(items) {
  const roots = [];
  const stack = [];

  items.forEach((item) => {
    const node = { ...item, children: [] };

    while (stack.length && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);

    stack.push(node);
  });

  return roots;
}

const OUTLINE_TOP_GAP_PX = 24;

function cssLengthToPixels(value) {
  if (typeof window === 'undefined') return 0;

  const raw = String(value || '').trim();
  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric)) return 0;

  if (raw.endsWith('rem')) {
    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    return numeric * rootFontSize;
  }

  if (raw.endsWith('em')) {
    const bodyFontSize = Number.parseFloat(window.getComputedStyle(document.body).fontSize) || 16;
    return numeric * bodyFontSize;
  }

  return numeric;
}

function getStickyOffset() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 84;

  // La hauteur réellement rendue est prioritaire : la variable CSS vaut par
  // exemple "3.75rem", qu'un simple parseFloat interpréterait comme 3.75 px.
  const navbar = document.querySelector('.navbar');
  const renderedNavbarHeight = navbar?.getBoundingClientRect?.().height || 0;

  if (renderedNavbarHeight > 0) {
    return Math.ceil(renderedNavbarHeight + OUTLINE_TOP_GAP_PX);
  }

  const rootStyles = window.getComputedStyle(document.documentElement);
  const cssNavbarHeight = cssLengthToPixels(rootStyles.getPropertyValue('--ifm-navbar-height')) || 60;
  return Math.ceil(cssNavbarHeight + OUTLINE_TOP_GAP_PX);
}

export function useCaseDetailOutline(rootRef, scopeKey) {
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState('');
  const headingElementsRef = useRef([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      setItems([]);
      setActiveId('');
      headingElementsRef.current = [];
      return undefined;
    }

    let frame = 0;

    const updateActiveHeading = () => {
      const headings = headingElementsRef.current;
      if (!headings.length) {
        setActiveId('');
        return;
      }

      const offset = getStickyOffset();
      let nextActiveId = '';

      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= offset) nextActiveId = heading.id;
        else break;
      }

      setActiveId((current) => (current === nextActiveId ? current : nextActiveId));
    };

    const scan = () => {
      frame = 0;

      const headings = Array.from(root.querySelectorAll(HEADING_SELECTOR)).filter((heading) => {
        const text = heading.textContent?.replace(/\s+/g, ' ').trim();
        return Boolean(text);
      });

      const nextItems = headings.map((heading) => {
        const level = Number.parseInt(heading.tagName.slice(1), 10);
        const text = heading.textContent.replace(/\s+/g, ' ').trim();

        const hasGeneratedId = heading.dataset.cdGeneratedOutlineId === 'true';
        if (!heading.id || hasGeneratedId) {
          heading.id = buildGeneratedHeadingId({ heading, text, level, scopeKey });
          heading.dataset.cdGeneratedOutlineId = 'true';
        }

        return { id: heading.id, text, level };
      });

      headingElementsRef.current = headings;
      setItems(nextItems);
      updateActiveHeading();
    };

    const scheduleScan = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(scan);
    };

    scheduleScan();

    const observer = new MutationObserver(scheduleScan);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    let scrollFrame = 0;
    const onViewportChange = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        updateActiveHeading();
      });
    };

    window.addEventListener('scroll', onViewportChange, { passive: true });
    window.addEventListener('resize', onViewportChange);

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      window.removeEventListener('scroll', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [rootRef, scopeKey]);

  const scrollToHeading = useCallback((headingId) => {
    if (!headingId || typeof document === 'undefined') return;

    const heading = document.getElementById(headingId);
    if (!heading) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const targetTop = heading.getBoundingClientRect().top + window.scrollY - getStickyOffset();

    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    setActiveId(headingId);
  }, []);

  return { items, activeId, scrollToHeading };
}

function OutlineNodes({ nodes, activeId, onSelect, registerNode, depth = 0 }) {
  if (!nodes.length) return null;

  return (
    <ul className={depth === 0 ? 'cd-side-list cd-outline-list' : 'cd-outline-children'}>
      {nodes.map((node) => {
        const isActive = node.id === activeId;

        return (
          <li key={node.id} className={`cd-outline-item cd-outline-level-${node.level}`}>
            <button
              ref={(element) => registerNode?.(node.id, element)}
              type="button"
              className={['cd-side-link', 'cd-outline-link', isActive ? 'active' : ''].join(' ')}
              aria-current={isActive ? 'location' : undefined}
              onClick={() => onSelect?.(node.id)}
            >
              <span className="cd-side-link-text">{node.text}</span>
            </button>

            {node.children.length > 0 && (
              <OutlineNodes
                nodes={node.children}
                activeId={activeId}
                onSelect={onSelect}
                registerNode={registerNode}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function CaseDetailOutline({ items, activeId, onSelect }) {
  const tree = useMemo(() => buildOutlineTree(Array.isArray(items) ? items : []), [items]);
  const nodeRefs = useRef(new Map());

  const registerNode = useCallback((id, element) => {
    if (!id) return;
    if (element) nodeRefs.current.set(id, element);
    else nodeRefs.current.delete(id);
  }, []);

  useEffect(() => {
    if (!activeId) return undefined;

    const frame = window.requestAnimationFrame(() => {
      const activeButton = nodeRefs.current.get(activeId);
      const scroller = activeButton?.closest?.('.cd-outline-list');
      if (!activeButton || !scroller) return;

      const buttonRect = activeButton.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const edgeGap = 10;
      let nextScrollTop = null;

      if (buttonRect.top < scrollerRect.top + edgeGap) {
        nextScrollTop = scroller.scrollTop + buttonRect.top - scrollerRect.top - edgeGap;
      } else if (buttonRect.bottom > scrollerRect.bottom - edgeGap) {
        nextScrollTop = scroller.scrollTop + buttonRect.bottom - scrollerRect.bottom + edgeGap;
      }

      if (nextScrollTop === null) return;

      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      scroller.scrollTo({
        top: Math.max(0, nextScrollTop),
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeId, tree]);

  if (!tree.length) {
    return <div className="cd-side-state">Aucun plan dans cet article.</div>;
  }

  return (
    <nav className="cd-outline-nav" aria-label="Plan de l’article">
      <OutlineNodes
        nodes={tree}
        activeId={activeId}
        onSelect={onSelect}
        registerNode={registerNode}
      />
    </nav>
  );
}
