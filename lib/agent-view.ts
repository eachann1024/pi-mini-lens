import { diagramMarkdown, isMarkdownProse, minimalMarkdownTheme } from "./minimal-markdown.ts";
import { extractNoticeBody } from "./transcript-adapter.ts";
import { secondaryAccent } from "./minimal-theme.ts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { getMarkdownTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown, Text, sliceByColumn, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

type Theme = ExtensionContext["ui"]["theme"];
export const RUNNING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const runningGlyph = (now = Date.now()) => RUNNING_FRAMES[Math.floor(now / 100) % RUNNING_FRAMES.length];
export interface AgentCall {
  id: string;
  name: string;
  task: string;
  tool?: string;
  action?: string;
  state: "running" | "done" | "error";
  output?: string;
}
export function agentCallDisplay(call: AgentCall): { summary: string; detail: string } {
  if (isAgentTool(call.tool ?? call.name)) return {
    summary: `${call.tool ?? call.name} · ${call.action || "dispatch"} · ${call.state === "running" ? "waiting for receipt" : call.state === "error" ? "failed" : "returned"}`,
    detail: call.output ?? call.task,
  };
  const receipt = call.output?.match(/\bAsync workflow \[([^\]\n]+)\]/);
  if (receipt) return { summary: `Workflow ${receipt[1]} · dispatched`, detail: "" };
  return {
    summary: call.state !== "error" && /^(read|write|edit|bash|grep|find|ls)$/.test(call.name) ? call.task || call.output || "" : call.output ?? call.task,
    detail: call.state === "error" ? call.output ?? "" : "",
  };
}
export const isAgentTool = (name: string) => /^(subagent(?:_supervisor)?|agents?|get_subagent_result|steer_subagent|bg_wait)$/i.test(name);
export function agentCall(id: string, tool: string, args: unknown): AgentCall {
  const data = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const name = String(data.agent ?? data.subagent_type ?? data.agent_type ?? tool);
  return { id, name, tool, action: typeof data.action === "string" ? data.action : undefined, task: String(data.task ?? data.prompt ?? data.description ?? data.action ?? data.command ?? data.path ?? ""), state: "running" };
}
export function agentCallRows(calls: AgentCall[], theme: Theme, width: number, expanded: boolean,
  markdown: (text: string, width: number) => string[]): string[] {
  if (!calls.length || width < 1) return [];
  const running = calls.filter(call => call.state === "running").length;
  const errors = calls.filter(call => call.state === "error").length;
  const done = calls.length - running - errors;
  const header = `${expanded ? "⌄" : "›"} Agent calls · ${calls.length} total · ${running} running · ${done} returned${errors ? ` · ${errors} failed` : ""} · Ctrl+O`;
  const rows = [truncateToWidth(theme.fg(errors ? "error" : running ? "accent" : "muted", header), width)];
  if (expanded) calls.forEach((call, index) => {
    const color = call.state === "error" ? "error" : call.state === "done" ? "success" : "accent";
    const glyph = call.state === "error" ? "✗" : call.state === "done" ? "✓" : "●";
    rows.push(truncateToWidth(theme.fg(color, `${index === calls.length - 1 ? "└─" : "├─"} ${glyph} ${call.name}`), width));
    for (const text of [call.task, call.output]) {
      if (text) rows.push(...markdown(text, Math.max(1, width - 3)).map(row => truncateToWidth(`   ${row}`, width, "")));
    }
  });
  return rows;
}

const plain = (text: string) => text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim();

/** pi-subagents stores a short activity preview; recover its matching raw tool input from the child session. */
const toolInputCache = new Map<string, { stamp: string; thinking: string; inputs: Array<{ name: string; value: string }> }>();
const singleLine = (value: string) => plain(value).replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ");
function childSessionData(sessionFile: unknown) {
  if (typeof sessionFile !== "string") return undefined;
  try {
    const stat = statSync(sessionFile);
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    let cached = toolInputCache.get(sessionFile);
    if (!cached || cached.stamp !== stamp) {
      const inputs: Array<{ name: string; value: string }> = [];
      let thinking = "";
      for (const line of readFileSync(sessionFile, "utf8").split(/\r?\n/)) {
        try {
          const entry = JSON.parse(line) as { type?: string; thinkingLevel?: string; message?: { role?: string; content?: Array<{ type?: string; name?: string; input?: Record<string, unknown>; arguments?: Record<string, unknown> }> } };
          if (entry.type === "thinking_level_change" && /^(off|minimal|low|medium|high|xhigh|max)$/.test(entry.thinkingLevel ?? "")) thinking = entry.thinkingLevel!;
          if (entry.message?.role !== "assistant") continue;
          for (const call of entry.message.content ?? []) {
            if (call.type !== "toolCall" || typeof call.name !== "string") continue;
            const input = call.arguments ?? call.input ?? {};
            const value = [input.path, input.command, input.pattern, input.query, input.task, input.prompt]
              .find((candidate): candidate is string => typeof candidate === "string") ?? "";
            if (value) inputs.push({ name: call.name, value: singleLine(value) });
          }
        } catch { /* A concurrently written session can end with a partial line. */ }
      }
      cached = { stamp, thinking, inputs };
      toolInputCache.set(sessionFile, cached);
    }
    return cached;
  } catch { return undefined; }
}
function rawToolInput(sessionFile: unknown, tool: unknown, preview: string): string {
  if (typeof tool !== "string" || !preview.endsWith("...")) return preview;
  const prefix = singleLine(preview.slice(0, -3));
  return [...(childSessionData(sessionFile)?.inputs ?? [])].reverse().find(input => input.name === tool && input.value.startsWith(prefix))?.value ?? preview;
}

const isAgentWidget = (source: string) => /^(?:[●○◉✓✗×\u2800-\u28ff]\s*)?(?:async subagent|Async agents|subagents\b|[│├└─\s]*async workflow)/i.test(source);
/** Presentation adapter for pi-subagents' independently updated widget.
 * Unknown widget formats pass through unchanged; no task state is inferred.
 */
export function restyleAgentWidget(lines: string[], theme: Theme, width: number, expanded: boolean): string[] {
  const content = lines.map(plain).filter(Boolean);
  if (!content.length || !isAgentWidget(content[0])) return lines;
  const details = content.slice(1).map(line => line
    .replace(/^[│├└─\s]+/, "")
    .replace(/(?:[·•]\s*)?Press\s+ctrl\+.*$/i, "")
    .replace(/(?:[·•]\s*)?Ctrl\+Alt\+F\s+Fleet.*$/i, "").trim())
    .filter(line => line && !/^async workflow\b|^[…+] .*lines hidden\b/i.test(line));
  const isHeading = (line: string) => /^(?:[└├]─\s*)?[●○◉✓✗×◦■\u2800-\u28ff]\s/.test(line)
    && !/^[│⎿]/.test(line);
  const blocks: string[][] = [];
  for (const line of details) {
    if (!blocks.length || isHeading(line)) blocks.push([line]);
    else blocks[blocks.length - 1].push(line);
  }
  const isDone = (block: string[]) => /\b(complete|completed|done|success|succeeded)\b/i.test(block[0]) || /^✓/.test(block[0]);
  const isFailed = (block: string[]) => /\b(failed|error|rejected|stopped|cancelled|canceled|aborted)\b/i.test(block[0]) || /^[✗×]/.test(block[0]);
  const done = blocks.filter(block => isDone(block) && !isFailed(block)).length;
  const errors = blocks.filter(isFailed).length;
  const visible = blocks.filter(block => expanded || isFailed(block) || !isDone(block));
  const rows = [agentSummary(theme, width, blocks.length - done - errors, done, errors, expanded)];
  if (!blocks.length) rows.push(truncateToWidth(theme.fg("text", content[0]), width));
  const markdown = (text: string, available: number) => new Markdown(text, 0, 0, minimalMarkdownTheme(getMarkdownTheme()),
    { color: value => secondaryAccent(theme, value) }, { transform: diagramMarkdown }).render(Math.max(1, available));
  // ponytail: native widget exposes bounded live previews, not the full child transcript.
  visible.forEach((block, index) => {
    const heading = block[0].replace(/^(?:[└├]─\s*)?[●○◉✓✗×◦■\u2800-\u28ff]\s*/, "");
    const badge = heading.match(/\(([^()]+?)(?:\s*·\s*thinking\s+|[ :]+)(off|minimal|low|medium|high|xhigh|max)\)/)
      ?? heading.match(/\(([^()]+)\)(?=\s*(?:·|$))/);
    const title = heading.split(" · ")[0].replace(/\s*\([^()]*\)\s*$/, "");
    const identity = badge ? theme.fg("accent", theme.bold(title)) + theme.fg("muted", " · ") + theme.fg("accent", theme.bold(badge[1])) + (badge[2] ? theme.fg("muted", ` ${badge[2]}`) : "")
      : theme.fg("accent", theme.bold(heading.split(" · ")[0]));
    const activity = block.slice(1).filter(line => !/^(?:task|output)\s*:/i.test(line));
    const latest = activity.at(-1)?.replace(/^[⎿│]\s*/, "") || block.slice(1).find(line => /^task\s*:/i.test(line)) || heading;
    const glyph = /\b(failed|error|rejected)\b/i.test(heading) || /^[✗×]/.test(block[0]) ? "×"
      : /\b(running|active|starting|queued|pending)\b/i.test(heading) || /^[\u2800-\u28ff]/.test(block[0]) ? runningGlyph() : "●";
    const prefix = theme.fg("accent", index === visible.length - 1 ? "└─ " : "├─ ")
      + theme.fg(glyph === "×" ? "error" : "accent", glyph + " ") + identity + theme.fg("text", " : ");
    const summary = /\b(failed|error)\b/i.test(heading + " " + latest)
      ? theme.fg("error", latest)
      : markdown(latest, Math.max(1, visibleWidth(latest) + 1)).join(" ");
    rows.push(truncateToWidth(prefix + summary, width));
  });
  return rows;
}

function agentSummary(theme: Theme, width: number, running: number, done: number, errors: number, expanded: boolean): string {
  const label = `Sub Agent · running ${running}${done ? ` · done ${done}` : ""}${errors ? ` · failed ${errors}` : ""}${done ? ` · Ctrl+S ${expanded ? "collapse" : "expand"}` : ""}`;
  const summary = truncateToWidth(theme.fg(errors ? "error" : "muted", label), width);
  return " ".repeat(Math.max(0, width - visibleWidth(summary))) + summary;
}
const finishedAgent = (state: unknown) => /^(complete|completed|done|success|succeeded)$/.test(String(state));
const failedAgent = (node: Record<string, unknown>) => !!node.error || /^(failed|error|stopped|rejected|cancelled|canceled|aborted)$/.test(String(node.status ?? node.state));
const timestamp = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
function formatAgentElapsed(startedAt: number, endedAt: number): string {
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}
// Only hide the passive native agent summary, preserving the interactive fleet and external jobs/panes.
const isAgentFleetSummary = (lines: string[]) => {
  const content = lines.map(plain).filter(Boolean);
  return content.length === 1 && /^\d+ active agents?\b/.test(content[0])
    && !/\b(?:jobs?|panes?)\b/.test(content[0]);
};

// ponytail: pi-subagents status.json adapter; replace with an uncapped public snapshot API when available.
export function readAgentStatuses(sessionId: string, root = process.env.PI_SUBAGENTS_TEMP_ROOT?.trim()
  ? resolve(process.env.PI_SUBAGENTS_TEMP_ROOT) : join(tmpdir(), `pi-subagents-uid-${process.getuid?.()}`), previous: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!sessionId) return [];
  const directory = join(root, "async-subagent-runs");
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      if (!entry.isDirectory()) return [];
      try {
        const status = JSON.parse(readFileSync(join(directory, entry.name, "status.json"), "utf8"));
        return status && status.sessionId === sessionId && !status.displayDismissedAt ? [status] : [];
      } catch {
        // Retain the last valid snapshot during replacement; never flash an empty panel.
        return previous.filter(status => status.sessionId === sessionId && status.runId === entry.name);
      }
    });
  } catch { return previous.filter(status => status.sessionId === sessionId); }
}

export function currentAgentStatuses(statuses: Record<string, unknown>[], callsOrIds: unknown[]): Record<string, unknown>[] {
  const callIds = new Set<string>();
  const runIds = new Set<string>();
  for (const item of callsOrIds) {
    if (typeof item === "string") {
      callIds.add(item);
      const match = item.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
      if (match) runIds.add(match[1]);
    } else if (item && typeof item === "object") {
      const call = item as Record<string, unknown>;
      if (typeof call.id === "string") callIds.add(call.id);
      const text = `${call.output ?? ""} ${call.task ?? ""} ${call.action ?? ""}`;
      const matches = text.matchAll(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi);
      for (const m of matches) runIds.add(m[1]);
    }
  }
  const selected = new Set<string>();
  for (const status of statuses) {
    const runId = String(status.runId ?? "");
    const toolCallId = String(status.toolCallId ?? "");
    if ((toolCallId && callIds.has(toolCallId)) || (runId && runIds.has(runId))) {
      if (runId) selected.add(runId);
    }
  }
  for (let size = -1; size !== selected.size;) {
    size = selected.size;
    for (const status of statuses) {
      const parentId = String(status.parentWorkflowRunId ?? "");
      if (parentId && selected.has(parentId)) selected.add(String(status.runId));
    }
  }
  return statuses.filter(status => selected.has(String(status.runId)));
}

/** Associate each status only with the user turn that dispatched its tool call.
 * Status snapshots are session-wide and can update after later turns begin.
 */
export function agentStatusesByTurn(statuses: Record<string, unknown>[], turns: Array<{ agentCalls?: unknown[] }>): Map<number, Record<string, unknown>[]> {
  const assigned = new Map<number, Record<string, unknown>[]>();
  const claimed = new Set<string>();
  for (const [index, turn] of turns.entries()) {
    const matched = currentAgentStatuses(statuses, turn.agentCalls ?? []).filter(status => {
      const runId = String(status.runId ?? "");
      return !runId || !claimed.has(runId);
    });
    assigned.set(index, matched);
    for (const status of matched) {
      const runId = String(status.runId ?? "");
      if (runId) claimed.add(runId);
    }
  }
  return assigned;
}

function agentChildren(statuses: Record<string, unknown>[]): Record<string, unknown>[] {
  const children = new Map<string, Record<string, unknown>>();
  const visit = (value: unknown, key: string) => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (typeof node.agent === "string") {
      const id = String(node.runId ?? (node.childId ? `${key}:${node.childId}` : key));
      const previous = children.get(id);
      children.set(id, { ...previous, ...node, displayId: id, model: node.model || previous?.model, thinking: node.thinking || previous?.thinking });
    }
    const inventory = node.workflowChildren as { children?: unknown[] } | undefined;
    if (Array.isArray(inventory?.children)) inventory.children.forEach((child, i) => visit(child, `${key}/steps/${i}`));
    if (Array.isArray(node.steps)) node.steps.forEach((child, i) => visit(child, `${key}/steps/${i}`));
    if (Array.isArray(node.children)) node.children.forEach((child, i) => visit(child, `${key}/children/${i}`));
  };
  // Workflow snapshots can lag behind the child. Merge their metadata first,
  // then apply the child's own snapshot regardless of directory iteration order.
  for (const status of [...statuses.filter(status => status.mode !== "single"), ...statuses.filter(status => status.mode === "single")]) {
    if (status.mode === "single" && Array.isArray(status.steps) && status.steps.length === 1) {
      const terminal = finishedAgent(status.state) || failedAgent(status);
      visit({ ...status.steps[0], runId: status.runId, startedAt: status.steps[0].startedAt ?? status.startedAt,
        notice: status.notice, noticeMessages: status.noticeMessages,
        ...(terminal ? { status: status.state, endedAt: status.steps[0].endedAt ?? status.endedAt, error: status.error ?? status.steps[0].error } : {}),
      }, String(status.runId));
    } else visit({ ...status, notice: status.notice, noticeMessages: status.noticeMessages }, String(status.runId));
  }
  return [...children.values()];
}

/** Retained for callers that share a render-state map across the current session. */
export type AgentDeadlines = Map<string, number>;

/** One snapshot drives both the inline count and its uncapped child rows. */
export function liveAgentView(statuses: Record<string, unknown>[], theme: Theme, width: number, expanded = false, _activeOnly = false,
  deadlines: AgentDeadlines = new Map(), now = Date.now(), expandedIds?: Set<string>,
  subagentControls?: Array<{ runId: string; y: number; width: number; line: string }>) {
  // readAgentStatuses already scopes snapshots to the active session. Keep each
  // current-session terminal snapshot so its title and expandable details remain
  // available after the run completes; no separate archive is created.
  const all = agentChildren(statuses);
  const errors = all.filter(failedAgent).length;
  const done = all.filter(child => !failedAgent(child) && finishedAgent(child.status ?? child.state)).length;
  const rows: string[] = [];
  const text = (value: unknown) => typeof value === "string" ? plain(value).replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ") : "";
  const bodyText = (value: unknown) => typeof value === "string"
    ? plain(value).replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, " ").trim() : "";
  const renderBody = (source: string, available: number) => {
    if (isMarkdownProse(source)) return new Markdown(source, 0, 0, minimalMarkdownTheme(getMarkdownTheme()),
      { color: value => theme.fg("text", value) }, { transform: diagramMarkdown }).render(Math.max(1, available));
    const rows: string[] = [];
    for (const sourceLine of source.split(/\r?\n/)) {
      let line = sourceLine;
      do {
        const row = truncateToWidth(line, Math.max(1, available), "");
        rows.push(row);
        line = line.slice(row.length);
      } while (line);
    }
    return rows;
  };
  if (width > 0) all.forEach((child, index) => {
    const runKey = String(child.runId ?? child.displayId);
    const isChildExpanded = expanded || (expandedIds?.has(runKey) ?? false);
    const notice = child.notice as { summary?: string; state?: string; color?: "error" | "warning" | "muted"; alert?: boolean; internal?: boolean } | undefined;
    const model = text(child.model).split("/").at(-1) || "";
    const suffix = model.match(/:(off|minimal|low|medium|high|xhigh|max)$/);
    const level = text(child.thinking) || suffix?.[1] || childSessionData(child.sessionFile)?.thinking || "?";
    const output = Array.isArray(child.recentOutput) ? child.recentOutput.at(-1) : undefined;
    const tools = Array.isArray(child.recentTools) ? child.recentTools.filter(tool => tool && typeof tool === "object") : [];
    const latest = tools.at(-1);
    const latestArgs = rawToolInput(child.sessionFile, latest?.tool, text(latest?.args));
    const activity = notice?.summary
      || text(child.error)
      || [text(child.currentTool), text(child.currentPath || child.currentToolArgs)].filter(Boolean).join(" ")
      || [text(latest?.tool), latestArgs].filter(Boolean).join(" ")
      || text(output) || text(child.description) || "waiting";
    // Tool inputs are literal code, not Markdown (heredocs can contain HTML-like text).
    const body = latest || child.currentTool ? text(activity) : text(new Markdown(activity, 0, 0, minimalMarkdownTheme(getMarkdownTheme()), undefined, { transform: diagramMarkdown })
      .render(Math.max(1, visibleWidth(activity) + 1)).join(" "));
    const state = text(child.status ?? child.state) || "waiting";
    const terminal = failedAgent(child) || finishedAgent(state);
    const isRunning = /^(running|active|starting|queued|pending)$/.test(state);
    const glyph = failedAgent(child) || notice?.color === "error" ? "×"
      : notice?.color === "warning" ? "⚠"
      : finishedAgent(state) ? "✓"
      : isRunning ? runningGlyph(now) : "●";
    const color = "text";
    // Status snapshots, not the dispatch tool receipt, define a child run's lifecycle.
    // Preserve a terminal observation when an older pi-subagents status omits endedAt.
    const elapsedKey = `elapsed:${runKey}`;
    const startedAt = timestamp(child.startedAt) ?? deadlines.get(elapsedKey) ?? now;
    if (!timestamp(child.startedAt)) deadlines.set(elapsedKey, startedAt);
    const endedAt = terminal ? timestamp(child.endedAt) ?? deadlines.get(`${elapsedKey}:ended`) ?? now : now;
    if (terminal) deadlines.set(`${elapsedKey}:ended`, endedAt);
    const elapsed = formatAgentElapsed(startedAt, endedAt);
    const heading = truncateToWidth(theme.fg(color, `${index === all.length - 1 ? "└─" : "├─"} ${glyph} `)
      + theme.fg("accent", theme.bold("SubAgent"))
      + theme.fg(color, ` • ${suffix ? model.slice(0, -suffix[0].length) : model}`)
      + (level ? theme.fg("muted", ` ${level}`) : "") + theme.fg(terminal ? "muted" : "success", ` ${elapsed}`) + theme.fg(color, " : "), width, "…");
    const bodyBudget = Math.max(0, width - visibleWidth(heading));
    const overflow = Math.max(0, visibleWidth(body) - bodyBudget);
    const offset = !terminal && overflow ? Math.max(0, Math.floor(Math.max(0, now - (typeof latest?.endMs === "number" ? latest.endMs : typeof child.lastActivityAt === "number" ? child.lastActivityAt : 0)) / 250) % (overflow + 9) - 4) : 0;
    const progress = bodyBudget ? sliceByColumn(body, Math.min(overflow, offset), bodyBudget, true) : "";
    const row = heading + theme.fg(color, progress);
    const line = row + " ".repeat(Math.max(0, width - visibleWidth(row)));
    subagentControls?.push({ runId: runKey, y: rows.length, width, line });
    rows.push(line);
    if (isChildExpanded) {
      const messages = Array.isArray(child.noticeMessages) ? child.noticeMessages : [];
      const bodies: string[] = [];
      for (const msg of messages) {
        const b = extractNoticeBody(msg);
        if (b && !bodies.includes(b)) bodies.push(b);
      }
      // Some completed runs have no supervisor notice. Their snapshot still
      // carries recent output, which is the in-session detail shown on expand.
      if (!bodies.length && Array.isArray(child.recentOutput)) {
        for (const output of child.recentOutput) {
          const b = bodyText(output);
          if (b && !bodies.includes(b)) bodies.push(b);
        }
      }
      if (!bodies.length && !terminal) {
        // Live runs may have tool activity but no output or supervisor notice yet.
        const detail = activity === "waiting" ? "等待子代理输出…" : activity;
        rows.push(...new Text(detail, 0, 0).render(Math.max(1, width - 3))
          .map(line => truncateToWidth(`   ${line}`, width)));
      }
      for (const textBody of bodies) {
        // Child/supervisor bodies are Markdown prose; tool logs and JSON are
        // not placed in this semantic body channel.
        for (const line of renderBody(textBody, Math.max(1, width - 3))) {
          rows.push(truncateToWidth(`   ${line}`, width));
        }
      }
    }
  });
  return { rows, total: all.length, done, errors, running: all.length - done - errors };
}

export function liveAgentRows(statuses: Record<string, unknown>[], theme: Theme, width: number, expanded = false, deadlines: AgentDeadlines = new Map()): string[] {
  const view = liveAgentView(statuses, theme, width, expanded, false, deadlines);
  return width > 0 && view.total ? [agentSummary(theme, width, view.running, view.done, view.errors, expanded), ...view.rows] : [];
}

/** Pi 0.85 widget containers: preserve unrelated widgets and their lifecycle. */
export function attachAgentWidgets(tui: unknown, theme: Theme, expanded: () => boolean, statuses?: () => Record<string, unknown>[], inline = false): () => void {
  const host = tui as { children?: Array<Component & { children?: Component[] }> };
  if (host.children?.length !== 7) return () => {};
  const restores: Array<() => void> = [];
  const deadlines: AgentDeadlines = new Map();
  for (const index of [3, 5]) {
    const container = host.children[index];
    if (!Array.isArray(container?.children)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(container, "render");
    const mouseDescriptor = Object.getOwnPropertyDescriptor(container, "handleMouse");
    const render = (width: number) => {
      const live = !inline && statuses ? liveAgentRows(statuses(), theme, width, expanded(), deadlines) : [];
      let inserted = false;
      const rows = container.children!.flatMap(child => {
        const original = child.render(width);
        if (inline && (isAgentWidget(original.map(plain).find(Boolean) ?? "") || isAgentFleetSummary(original))) return [];
        if (statuses && live.length && isAgentFleetSummary(original)) return [];
        const source = original.map(plain).find(Boolean) ?? "";
        const agentWidget = isAgentWidget(source);
        if (statuses && agentWidget) {
          if (inserted || index !== 3) return [];
          inserted = true;
          return live;
        }
        return restyleAgentWidget(original, theme, width, expanded());
      });
      if (index === 3 && !inserted) rows.push(...live);
      return rows;
    };
    const mouse: NonNullable<Component["handleMouse"]> = (event) => {
      let y = 0;
      let inserted = false;
      const live = !inline && statuses ? liveAgentRows(statuses(), theme, event.width, expanded(), deadlines) : [];

      for (const child of container.children!) {
        const original = child.render(event.width);
        if (inline && (isAgentWidget(original.map(plain).find(Boolean) ?? "") || isAgentFleetSummary(original))) continue;
        if (statuses && live.length && isAgentFleetSummary(original)) continue;
        const agentWidget = isAgentWidget(original.map(plain).find(Boolean) ?? "");
        const shown = statuses && agentWidget ? (index === 3 && !inserted ? live : [])
          : restyleAgentWidget(original, theme, event.width, expanded());
        if (agentWidget) inserted = true;
        if (event.y >= y && event.y < y + shown.length) {
          // Do not route clicks into native controls hidden by the compact view.
          return shown === original ? child.handleMouse?.({ ...event, y: event.y - y, height: shown.length }) : undefined;
        }
        y += shown.length;
      }
    };
    container.render = render;
    container.handleMouse = mouse;
    restores.push(() => {
      if (container.handleMouse === mouse) {
        if (mouseDescriptor) Object.defineProperty(container, "handleMouse", mouseDescriptor);
        else delete container.handleMouse;
      }
      if (container.render !== render) return;
      if (descriptor) Object.defineProperty(container, "render", descriptor);
      else delete (container as Partial<Component>).render;
    });
  }
  return () => { deadlines.clear(); restores.forEach(restore => restore()); };
}
