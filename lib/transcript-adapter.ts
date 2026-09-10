import { Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";
import { attachStickyTool } from "./sticky-tool.ts";

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();

export function extractNoticeBody(message: unknown): string {
  const item = record(message);
  if (!item) return typeof message === "string" ? clean(message) : "";
  const details = record(item.details);
  if (details) {
    const event = record(details.event);
    const body = typeof details.requestBody === "string"
      ? details.requestBody
      : typeof event?.message === "string"
        ? event.message
        : typeof details.message === "string"
          ? details.message
          : undefined;
    if (body) {
      let cleanBody = stripVTControlCharacters(body).replace(/^UPDATE:\s*/i, "").trim();
      const failureReason = typeof event?.reason === "string" && ["tool_failures", "completion_guard"].includes(event.reason)
        ? event.reason === "tool_failures" ? "工具执行失败" : "任务完成受阻"
        : undefined;
      if (failureReason && !cleanBody.includes(failureReason)) cleanBody = `[${failureReason}] ${cleanBody}`;
      return cleanBody;
    }
  }
  const raw = typeof item.content === "string" ? item.content : "";
  if (raw) {
    const filtered = stripVTControlCharacters(raw)
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line
        && !/^(?:Subagent (?:progress update|needs a supervisor decision|control notice)|Supervisor (?:progress update|decision request))\b/i.test(line)
        && !/^(?:Run|Agent|Child index|Child target|Request ID|Live guidance|Reply with|Request):\s*/i.test(line)
        && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line)
      )
      .join("\n")
      .replace(/^UPDATE:\s*/i, "")
      .trim();
    if (filtered) return filtered;
  }
  return typeof item.content === "string" ? item.content : JSON.stringify(item.content ?? item, null, 2);
}

/** Only pi-subagents' known envelopes carry state; prose is never a status signal. */
export function supervisorNotice(message: unknown) {
  const item = record(message);
  if (item?.customType === "subagent-incremental-child-notify") {
    const content = typeof item.content === "string" ? item.content : undefined;
    const header = content?.match(/^Workflow child (completed|failed):\s+\*\*([^*\n]+)\*\*\s*$/m);
    if (!content || !header) return;
    const failed = header[1] === "failed";
    const error = content.match(/^Error:\s*([\s\S]*?)(?=^Status:|(?![\s\S]))/m)?.[1]
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !/^Run fan-out:/i.test(line))
      .join(" ");
    const childRunId = content.match(/^Child run:\s*([0-9a-f-]{36})\s*$/mi)?.[1];
    return {
      key: childRunId ? JSON.stringify(["incremental-child", childRunId]) : undefined,
      internal: false,
      alert: failed,
      state: failed ? "执行失败" : "已完成",
      color: failed ? "error" as const : "muted" as const,
      summary: error || (failed ? "子任务失败" : "子任务已完成"),
      label: clean(header[2]),
      showLabel: true,
      body: content,
    };
  }
  const details = record(item?.details);
  if (!details) return;
  const event = record(details.event);
  const request = item?.customType === "subagent_supervisor_request";
  if (request ? !["progress_update", "need_decision", "interview_request"].includes(String(details.reason))
    : item?.customType !== "subagent_control_notice" || !event || !["needs_attention", "active_long_running"].includes(String(event.type))) return;
  const data = request ? details : event!;
  const body = request ? details.requestBody : data.message;
  if (typeof body !== "string" || typeof data.agent !== "string") return;
  const internal = request ? details.reason !== "progress_update" || details.expectsReply === true : data.reason === "supervisor_request";
  const failed = !request && ["completion_guard", "tool_failures"].includes(String(data.reason));
  const attention = !request && data.type === "needs_attention" && !internal;
  const index = request ? data.childIndex : data.index;
  const runId = typeof data.runId === "string" && data.runId ? data.runId : undefined;
  // ponytail: aggregate only unambiguous run+child envelopes; nested/missing
  // addresses stay separate until the producer provides a shared child identity.
  const key = runId && Number.isInteger(index) && Number(index) >= 0
    && !data.nestedRunId && !data.nestingPath ? JSON.stringify([runId, index]) : undefined;
  return { key, runId, internal, alert: failed || attention,
    state: failed ? "执行失败" : attention ? "需要关注" : internal ? "内部协作" : "进度",
    color: failed ? "error" as const : attention ? "warning" as const : "muted" as const,
    summary: internal ? "代理间沟通已收纳" : clean(body).replace(/^UPDATE:\s*/i, "") || "暂无摘要",
    label: typeof data.label === "string" ? clean(data.label) : typeof data.taskPreview === "string" ? clean(data.taskPreview) : undefined,
    body: clean(body).replace(/^UPDATE:\s*/i, ""),
    agent: typeof data.agent === "string" ? data.agent : undefined,
  };
}

export function compactGoalCard(entry: unknown, theme: ExtensionContext["ui"]["theme"], width: number, expanded: boolean): string[] | undefined {
  const item = record(entry);
  if (item?.customType !== "pi-codex-goal") return;
  const data = record(item.data);
  const goal = record(data?.goal);
  const objective = typeof goal?.objective === "string" ? clean(goal.objective) : undefined;
  // Usage snapshots are rendered by the goal extension too, but are not cards
  // worth adding to the compact transcript.
  if (!objective || width <= 0) return;
  const status = typeof goal?.status === "string" ? clean(goal.status) : "active";
  const control = truncateToWidth(expanded ? "[收起]" : "[详情]", width, "");
  const title = theme.fg(expanded ? "accent" : "muted", `${control} ◉ Goal · ${status}`);
  const hint = theme.fg(expanded ? "accent" : "muted", " · Ctrl+O");
  const summary = truncateToWidth(objective, Math.max(0, width - visibleWidth(title) - visibleWidth(hint) - 3), "…");
  const rows = [truncateToWidth(`${title} · ${theme.fg(expanded ? "accent" : "text", summary)}${hint}`, width, "")];
  if (expanded) rows.push(...new Text(objective, 0, 0).render(Math.max(1, width)));
  return rows;
}

export function compactSupervisorNotice(message: unknown, theme: ExtensionContext["ui"]["theme"], width: number, expanded: boolean, label = "", history: unknown[] = [message]): string[] | undefined {
  const notice = supervisorNotice(message);
  if (!notice) return;
  if (width <= 0) return [];
  const { state, color, summary } = notice;
  const effectiveLabel = label || (notice.showLabel ? notice.label ?? "" : "");
  const control = truncateToWidth(expanded ? "[收起]" : "[详情]", width, "");
  const hint = " · Ctrl+O";
  let heading: string;
  let summaryText: string;
  if (expanded) {
    const statusGlyph = color === "error" ? theme.fg("error", "× " + state)
      : color === "warning" ? theme.fg("warning", "⚠ " + state)
      : theme.fg("accent", "ℹ " + state);
    const taskLabel = effectiveLabel ? theme.fg("accent", ` · ${truncateToWidth(effectiveLabel, 20)}`) : "";
    heading = theme.fg("accent", control) + " " + statusGlyph + taskLabel;
    summaryText = theme.fg("accent", summary);
  } else {
    const title = theme.fg(color, `${color === "error" ? "×" : color === "warning" ? "⚠" : "ℹ"} ${state}${effectiveLabel ? ` · ${truncateToWidth(effectiveLabel, 20)}` : ""}`);
    heading = theme.fg("muted", control) + " " + title;
    summaryText = theme.fg(color, summary);
  }
  const hintStyled = theme.fg(expanded ? "accent" : "muted", hint);
  const available = width - visibleWidth(heading) - visibleWidth(hint) - 3;
  const rows = available >= 24
    ? [heading + " · " + truncateToWidth(summaryText, available) + hintStyled]
    : [truncateToWidth(heading, width, ""), truncateToWidth(summaryText, Math.max(0, width - visibleWidth(hint)), "") + truncateToWidth(hintStyled, width, "")];
  if (expanded) {
    const bodies: string[] = [];
    for (const original of history) {
      const body = extractNoticeBody(original);
      if (body && !bodies.includes(body)) bodies.push(body);
    }
    for (const body of bodies) {
      rows.push(...new Text(body, 0, 0).render(Math.max(1, width)));
    }
  }
  return rows;
}

interface ContainerLike extends Component { children: Component[] }
function isContainer(value: unknown): value is ContainerLike {
  const node = value as Partial<ContainerLike> | null;
  return !!node && Array.isArray(node.children) && typeof node.render === "function" && typeof node.invalidate === "function";
}

/** Pi 0.85.x private layout adapter. Never mutates the stored messages or child tree. */
export type NoticeRows = string[] & { handleMouse?: Component["handleMouse"] };
export type TurnNotices = ReadonlyMap<number, NoticeRows>;
interface TranscriptView extends Component {
  render(width: number, notices?: TurnNotices): string[];
  clearHover?(): boolean;
  pinnedTool?(): { id: string; y: number; line: string } | undefined;
  unpinTool?(): void;
  toggleTool?(id: string): void;
  pinnedSubagent?(): { id: string; y: number; line: string } | undefined;
  unpinSubagent?(): void;
  toggleSubagent?(id: string): void;
}
interface NoticeOptions {
  supervisor?: {
    theme: ExtensionContext["ui"]["theme"];
    expanded: () => boolean;
    handledRunIds?: () => Set<string>;
    onNotices?: (groups: Map<string | Component, { first: Component; messages: unknown[]; selected: unknown; notice: NonNullable<ReturnType<typeof supervisorNotice>> }>) => void;
  };
  /** Blocking extension prompts are native UI, never auto-expiring notices. */
  isPrompt?: (text: string) => boolean;
  isTransient?: (text: string) => boolean;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => () => void;
}

// Keep expiry across minimal-mode remounts without retaining discarded sessions.
const noticeTimes = new WeakMap<Component, { text: string; until: number }>();
export function attachTranscript(tui: unknown, view: TranscriptView, options: NoticeOptions = {}): (() => void) | undefined {
  const host = tui as { children?: unknown[]; mode?: string; viewportTop?: number };
  // Regular mode owns terminal scrollback. Replacing its whole document means a
  // streamed update to an older row forces TuiMainScreen's scrollback-clearing redraw.
  // Keep native transcript diffing there; fullscreen's ScrollView is safe to adapt.
  if (host.mode === "regular") return;
  // Both layouts retain this seven-container tree. Fail closed on unknown layouts.
  if (!Array.isArray(host.children) || host.children.length !== 7 || !host.children.every(isContainer)) return;
  const document = host.children[0] as ContainerLike;
  if (document.children.length !== 3 || !document.children.every(isContainer)) return;
  const [header, resources, chat] = document.children as ContainerLike[];
  // During /reload Pi replaces the editor with a reload notice until AFTER
  // session_start. The validated document/container layout remains unchanged.
  // Custom editors also need not expose getText; do not use editor contents
  // as a transcript identity check.
  const renderDescriptor = Object.getOwnPropertyDescriptor(document, "render");
  const mouseDescriptor = Object.getOwnPropertyDescriptor(document, "handleMouse");
  const originalRender = document.render;
  const originalMouse = document.handleMouse;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, delay) => {
    const timer = setTimeout(callback, delay);
    timer.unref();
    return () => clearTimeout(timer);
  });
  let cancelExpiry: (() => void) | undefined;
  const expandedNotices = new Map<string | Component, boolean>();
  let globalExpanded = options.supervisor?.expanded() ?? false;
  let prefixNotices: NoticeRows = [];
  let prefixNoticeOffset = 0;
  let viewOffset = 0;
  let viewHeight = 0;
  let stickyMinHeight = 0;
  let viewportTop = host.viewportTop;
  const render: Component["render"] = (width) => {
    cancelExpiry?.();
    cancelExpiry = undefined;
    const notices = new Map<number, NoticeRows>();
    const expanded = options.supervisor?.expanded() ?? false;
    if (expanded !== globalExpanded) { expandedNotices.clear(); globalExpanded = expanded; }
    const groups = new Map<string | Component, { first: Component; messages: unknown[]; selected: unknown; notice: NonNullable<ReturnType<typeof supervisorNotice>> }>();
    if (options.supervisor) for (const child of chat.children) {
      if (child.constructor.name !== "CustomMessageComponent") continue;
      const message = (child as unknown as { message?: unknown }).message;
      const notice = supervisorNotice(message);
      if (!notice) continue;
      const key = notice.key ?? child;
      const group = groups.get(key);
      if (!group) groups.set(key, { first: child, messages: [message], selected: message, notice });
      else {
        group.messages.push(message);
        // Ordinary updates must not bury a real failure/attention signal. These
        // envelopes have no resolution/completion signal; keep it in the summary.
        if (notice.color === "error" || (notice.alert && group.notice.color !== "error") || (!group.notice.alert && (!notice.internal || group.notice.internal))) {
          group.selected = message;
          group.notice = notice;
        }
      }
    }
    // String keys belong to aggregated supervisor notices; component keys belong
    // to independently rendered custom entries such as pi-codex-goal.
    for (const key of expandedNotices.keys()) if (typeof key === "string" && !groups.has(key)) expandedNotices.delete(key);
    options.supervisor?.onNotices?.(groups);
    const groupKeys = [...groups.keys()];
    const controls = new Map<number, Array<{ y: number; width: number; key: string | Component; expanded: boolean }>>();
    let turn = -1;
    let nextExpiry = Infinity;
    const time = now();
    for (const child of chat.children) {
      if (child.constructor.name === "UserMessageComponent") turn++;
      // Goal state is stored as a custom entry, not a user message. Adapt only
      // the known pi-codex-goal envelope so ordinary extension cards stay native.
      if (child.constructor.name === "CustomEntryComponent") {
        const goalRows = options.supervisor && compactGoalCard((child as unknown as { entry?: unknown }).entry, options.supervisor.theme, width, expandedNotices.get(child) ?? false);
        const rows = notices.get(turn) ?? [];
        if (!goalRows) {
          rows.push(...child.render(width));
          notices.set(turn, rows);
          continue;
        }
        const open = expandedNotices.get(child) ?? false;
        const targets = controls.get(turn) ?? [];
        targets.push({ y: rows.length, width, key: child, expanded: open });
        controls.set(turn, targets);
        rows.push(...goalRows);
        notices.set(turn, rows);
        continue;
      }
      // Completion receipts use Pi's custom renderer and must survive minimal mode.
      if (child.constructor.name === "CustomMessageComponent") {
        const rows = notices.get(turn) ?? [];
        const message = (child as unknown as { message?: unknown }).message;
        const notice = options.supervisor && supervisorNotice(message);
        const key = notice ? notice.key ?? child : child;
        const group = groups.get(key);
        if (group && group.first !== child) continue;
        if (group && options.supervisor) {
          const handled = options.supervisor.handledRunIds?.();
          if (handled && notice?.runId && handled.has(notice.runId)) continue;
          const open = expandedNotices.get(key) ?? expanded;
          const label = group.notice.showLabel
            ? group.notice.label ?? ""
            : groups.size > 1 ? group.notice.label || `任务 ${groupKeys.indexOf(key) + 1}` : "";
          const targets = controls.get(turn) ?? [];
          targets.push({ y: rows.length, width, key, expanded: open });
          controls.set(turn, targets);
          rows.push(...compactSupervisorNotice(group.selected, options.supervisor.theme, width, open, label, group.messages)!);
        } else rows.push(...child.render(width));
        notices.set(turn, rows);
        continue;
      }
      if (child.constructor.name !== "Text") continue;
      // Pi 0.85 Text stores the unwrapped styled source in text. Width changes
      // must not restart the timeout; setText updates must restart it.
      const source = (child as unknown as { text?: unknown }).text;
      if (typeof source === "string" && !options.isPrompt?.(source) && options.isTransient?.(source)) {
        let state = noticeTimes.get(child);
        if (!state || state.text !== source) {
          state = { text: source, until: time + 5000 };
          noticeTimes.set(child, state);
        }
        if (time >= state.until) continue;
        nextExpiry = Math.min(nextExpiry, state.until);
      }
      const rows = notices.get(turn) ?? [];
      rows.push(...child.render(width));
      notices.set(turn, rows);
    }
    if (Number.isFinite(nextExpiry)) {
      cancelExpiry = schedule(() => {
        cancelExpiry = undefined;
        (tui as { requestRender?: () => void }).requestRender?.();
      }, Math.max(0, nextExpiry - time));
    }
    for (const [turnIndex, targets] of controls) {
      notices.get(turnIndex)!.handleMouse = event => {
        if (event.button !== "left" || event.shift || event.ctrl || event.alt || (event.clickCount ?? 1) !== 1) return;
        const target = targets.find(target => event.y === target.y && event.x >= 0 && event.x < target.width);
        if (!target) return;
        if (event.type === "press") return { handled: true };
        if (event.type === "click") {
          expandedNotices.set(target.key, !target.expanded);
          return { handled: true, render: true };
        }
      };
    }
    const prefix = [...header.render(width), ...resources.render(width)];
    prefixNoticeOffset = prefix.length;
    prefixNotices = notices.get(-1) ?? [];
    prefix.push(...prefixNotices);
    if (viewportTop !== host.viewportTop || viewOffset !== prefix.length) view.clearHover?.();
    viewportTop = host.viewportTop;
    const rows = view.render(width, notices);
    viewOffset = prefix.length;
    viewHeight = rows.length;
    const result = [...prefix, ...rows];
    while (result.length < stickyMinHeight) result.push("");
    return result;
  };
  // Do not dispatch pointer events into invisible native message components.
  // Unhandled events still reach the parent ScrollView / selection machinery.
  const mouse: NonNullable<Component["handleMouse"]> = event => {
    const cleared = (event.type === "wheel" || event.y < viewOffset || event.y >= viewOffset + viewHeight) && view.clearHover?.();
    if (cleared && event.type === "move") return { handled: true, render: true };
    if (event.y >= prefixNoticeOffset && event.y < viewOffset) return prefixNotices.handleMouse?.({ ...event, y: event.y - prefixNoticeOffset });
    if (event.y < viewOffset || event.y >= viewOffset + viewHeight) return;
    return view.handleMouse?.({ ...event, y: event.y - viewOffset, height: viewHeight });
  };
  document.render = render;
  document.handleMouse = mouse;
  // Dock events never reach the document. Observe normalized events without
  // stealing wheel/selection or changing Pi's mouse protocol/listener order.
  const restoreDock = view.clearHover ? host.children.slice(1).map(child => {
    const dock = child as Component;
    const descriptor = Object.getOwnPropertyDescriptor(dock, "handleMouse");
    const original = dock.handleMouse;
    const handle: NonNullable<Component["handleMouse"]> = event => {
      const cleared = view.clearHover?.();
      const result = original?.call(dock, event);
      if (result) return cleared ? { ...result, render: true } : result;
      return cleared && event.type === "move" ? { handled: true, render: true } : undefined;
    };
    dock.handleMouse = handle;
    return () => {
      if (dock.handleMouse !== handle) return;
      if (descriptor) Object.defineProperty(dock, "handleMouse", descriptor);
      else delete dock.handleMouse;
    };
  }) : [];
  const hasStickyTool = view.pinnedTool && view.unpinTool && view.toggleTool;
  const hasStickySubagent = view.pinnedSubagent && view.unpinSubagent && view.toggleSubagent;
  const restoreSticky = hasStickyTool || hasStickySubagent ? attachStickyTool(tui, document, {
    pinnedTool: () => {
      const target = view.pinnedSubagent?.() ?? view.pinnedTool?.();
      if (!target) return;
      const kind = view.pinnedSubagent?.() ? "subagent" : "tool";
      return { ...target, id: `${kind}:${target.id}`, y: target.y + viewOffset };
    },
    unpinTool: () => {
      view.unpinSubagent?.();
      view.unpinTool?.();
    },
    toggleTool: id => {
      const [kind, targetId] = id.split(":", 2);
      if (kind === "subagent") view.toggleSubagent?.(targetId);
      else if (kind === "tool") view.toggleTool?.(targetId);
    },
  }, height => { stickyMinHeight = height; }) : undefined;
  return () => {
    restoreSticky?.();
    cancelExpiry?.();
    view.clearHover?.();
    for (const restore of restoreDock) restore();
    if (document.render === render) {
      if (renderDescriptor) Object.defineProperty(document, "render", renderDescriptor);
      else { delete (document as Partial<Component>).render; if (document.render !== originalRender) document.render = originalRender; }
    }
    if (document.handleMouse === mouse) {
      if (mouseDescriptor) Object.defineProperty(document, "handleMouse", mouseDescriptor);
      else { delete document.handleMouse; if (document.handleMouse !== originalMouse) document.handleMouse = originalMouse; }
    }
  };
}
