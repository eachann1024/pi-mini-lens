import { ScrollView, VStack, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { createRequire } from "node:module";
import type { getLayoutNode as GetLayoutNode } from "@earendil-works/pi-tui/dist/layout-node.js";

interface StickyToolView {
  pinnedTool(): { id: string; y: number; line: string; autoScroll?: boolean } | undefined;
  unpinTool(): void;
  toggleTool(id: string): void;
}

/** ponytail: Pi 0.85 layoutRoot + optional internal layout-node export;
 * replace discovery with a public primary-scroll/layout getter when available. */
export function attachStickyTool(tui: unknown, document: Component, view: StickyToolView, setMinHeight: (height: number) => void = () => {}): (() => void) | undefined {
  const host = tui as { mode?: string; terminal?: { rows: number }; layoutRoot?: Component; setLayoutRoot?: (root: Component) => void; requestRender?: () => void };
  if (host.mode !== "fullscreen" || !host.layoutRoot || !host.setLayoutRoot || !host.requestRender) return;
  let getNode: typeof GetLayoutNode;
  try { getNode = createRequire(import.meta.url)("@earendil-works/pi-tui/dist/layout-node.js").getLayoutNode; }
  catch { return; }
  if (typeof getNode !== "function") return;
  const originalRoot = host.layoutRoot;
  let scroll: ScrollView | undefined;
  let primaries = 0;
  const seen = new Set<Component>();
  const inspect = (component: Component): boolean => {
    if (seen.has(component)) return false;
    seen.add(component);
    const node = getNode(component);
    if (!node) return true;
    if (node.type === "scroll") {
      if (node.state.primary) {
        primaries++;
        if (component instanceof ScrollView && node.component === document) scroll = component;
      }
      return true;
    }
    if (node.type !== "vstack" || !(component instanceof VStack)) return false;
    return node.entries.every(entry => inspect(entry.component));
  };
  try { if (!inspect(originalRoot) || primaries !== 1 || !scroll) return; }
  catch { return; }
  const transcript = scroll;
  const requestRender = () => host.requestRender!();
  let currentId: string | undefined;
  let previousY: number | undefined;
  let previousTop = transcript.scrollTop;
  let shown: { id: string; line: string } | undefined;
  const heading: Component = {
    invalidate() {},
    render(width) {
      // Measure the unchanged document before moving the existing ScrollView.
      setMinHeight(0);
      const lines = document.render(transcript.getContentWidth(width));
      const target = view.pinnedTool();
      if (!target) {
        currentId = undefined;
        shown = undefined;
        previousY = undefined;
        return [];
      }
      if (target.autoScroll === false) {
        // SubAgent details expand where they were clicked. Do not reserve a
        // heading row or move the viewport until its original row scrolls past.
        currentId = target.id;
        previousY = target.y;
        previousTop = transcript.scrollTop;
        shown = transcript.scrollTop > target.y ? target : undefined;
        setMinHeight(0);
        return shown ? [truncateToWidth(width < 5 ? "▾" : shown.line, width, "")] : [];
      }
      // The next viewport can grow before ScrollView exposes its new height.
      // Reserve a terminal-height tail so resize/dock shrink cannot clamp past
      // the heading or silently resume follow-end at the reading position.
      const minHeight = target.y + 1 + Math.max(1, host.terminal?.rows ?? transcript.viewportHeight);
      // Short results need trailing space to align the heading without hiding text.
      setMinHeight(minHeight);
      if (target.id !== currentId) {
        currentId = target.id;
        transcript.updateLayout(Math.max(lines.length, minHeight), Math.max(1, transcript.viewportHeight - (shown ? 0 : 1)), requestRender);
        transcript.scrollTo(target.y + 1, { disableFollow: true });
      } else if (previousY !== undefined && target.y !== previousY && shown) {
        transcript.updateLayout(Math.max(lines.length, minHeight), transcript.viewportHeight, requestRender);
        transcript.scrollTo(transcript.scrollTop + target.y - previousY, { disableFollow: true });
      } else if (target.y === previousY && transcript.scrollTop < target.y && transcript.scrollTop < previousTop) {
        view.unpinTool();
        setMinHeight(0);
        currentId = undefined;
        shown = undefined;
        return [];
      }
      previousY = target.y;
      previousTop = transcript.scrollTop;
      // At the original heading, use its document row rather than duplicating it.
      shown = transcript.scrollTop > target.y ? target : undefined;
      return shown ? [truncateToWidth(width < 5 ? "▾" : shown.line, width, "")] : [];
    },
    handleMouse(event) {
      if (!shown) return;
      if (event.type === "wheel") {
        transcript.scrollBy(event.wheelDelta ?? 0);
        return { handled: true, render: true };
      }
      // Dedicated layout row: never dispatch its clicks into underlying links.
      if (event.button === "left" && !event.shift && !event.ctrl && !event.alt) {
        if (event.type === "press") return { handled: true };
        if (event.type === "click") {
          view.toggleTool(shown.id);
          return { handled: true, render: true };
        }
      }
    },
  };
  const section = new VStack([
    { component: heading, basis: "auto", shrink: 0 },
    { component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
  ]);
  const replace = (component: Component): Component => {
    if (component === transcript) return section;
    const node = getNode(component);
    if (node?.type !== "vstack") return component;
    const entries = node.entries.map(entry => ({ ...entry, component: replace(entry.component) }));
    return entries.some((entry, index) => entry.component !== node.entries[index].component)
      ? new VStack(entries, { gap: node.gap, align: node.align }) : component;
  };
  const root = replace(originalRoot);
  host.setLayoutRoot(root);
  return () => {
    view.unpinTool();
    setMinHeight(0);
    if (host.layoutRoot === root) host.setLayoutRoot!(originalRoot);
  };
}
