import { agentCall, attachAgentWidgets, type AgentCall } from "../lib/agent-view.ts";
import { CONFIG_DIR_NAME, getSettingsListTheme, getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { attachTranscript } from "../lib/transcript-adapter.ts";
import { diagramMarkdown } from "../lib/minimal-markdown.ts";
import { minimalSurface } from "../lib/minimal-theme.ts";
import { Container, Markdown, matchesKey, isKeyRelease, isKeyRepeat, type SettingItem, SettingsList, Text, type TuiMouseEvent, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SETTINGS_FILE_NAME = "mini-lens.json";

export interface MiniLensSettings {
  "mini-lens-model-show": boolean;
  "mini-lens-thinking-show": boolean;
  "mini-lens-ch-show": boolean;
  "mini-lens-session-tokens-show": boolean;
  "mini-lens-cache-tokens-show": boolean;
  "mini-lens-cost-show": boolean;
  "mini-lens-mcp-show": boolean;
  "mini-lens-context-show": boolean;
  "mini-lens-context-dots-show": boolean;
  "mini-lens-context-percent-show": boolean;
  "mini-lens-speed-show": boolean;
  "mini-lens-speed-unit-show": boolean;
  "mini-lens-minimal-show": boolean;
  "mini-lens-minimal-thinking-show": boolean;
  "mini-lens-minimal-tools-show": boolean;
  "mini-lens-minimal-output-show": boolean;
  "mini-lens-minimal-skills-show": boolean;
  onboardingCompleted: boolean;
}

export const DEFAULT_SETTINGS: Readonly<MiniLensSettings> = {
  "mini-lens-model-show": true,
  "mini-lens-thinking-show": true,
  "mini-lens-ch-show": true,
  "mini-lens-session-tokens-show": true,
  "mini-lens-cache-tokens-show": true,
  "mini-lens-cost-show": true,
  "mini-lens-mcp-show": false,
  "mini-lens-context-show": true,
  "mini-lens-context-dots-show": false,
  "mini-lens-context-percent-show": true,
  "mini-lens-speed-show": true,
  "mini-lens-speed-unit-show": true,
  "mini-lens-minimal-show": true,
  "mini-lens-minimal-thinking-show": true,
  "mini-lens-minimal-tools-show": true,
  "mini-lens-minimal-output-show": true,
  "mini-lens-minimal-skills-show": true,
  onboardingCompleted: false,
};

const SETTING_IDS = Object.keys(DEFAULT_SETTINGS) as Array<keyof MiniLensSettings>;

export function settingsPath(agentDir = process.env.MINI_LENS_AGENT_DIR ?? join(homedir(), CONFIG_DIR_NAME, "agent")): string {
  return join(agentDir, SETTINGS_FILE_NAME);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function parseSettings(value: unknown): MiniLensSettings {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(SETTING_IDS.map((id) => [id, isBoolean(candidate[id]) ? candidate[id] : DEFAULT_SETTINGS[id]])) as unknown as MiniLensSettings;
}

export async function loadSettings(path = settingsPath()): Promise<{ settings: MiniLensSettings; exists: boolean }> {
  try {
    return { settings: parseSettings(JSON.parse(await readFile(path, "utf8"))), exists: true };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, exists: false };
  }
}

export async function saveSettings(settings: MiniLensSettings, path = settingsPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function enabledMcpServerCount(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const snapshot = value as { version?: unknown; servers?: unknown };
  if (snapshot.version !== 1 || !Array.isArray(snapshot.servers)) return undefined;
  let count = 0;
  for (const server of snapshot.servers) {
    if (!server || typeof server !== "object" || Array.isArray(server)
      || typeof server.name !== "string"
      || (server.disabled !== undefined && typeof server.disabled !== "boolean")) return undefined;
    if (server.disabled !== true) count++;
  }
  return count;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegative(value: unknown): number {
  return Math.max(0, finiteNumber(value) ?? 0);
}

function formatUsd(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

interface UsageLike {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  totalTokens?: unknown;
  cost?: { total?: unknown };
}

export interface SessionUsage {
  totalTokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

const EMPTY_USAGE: SessionUsage = { totalTokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

function addUsage(total: SessionUsage, usage: UsageLike | undefined): SessionUsage {
  if (!usage) return total;
  const input = nonNegative(usage.input);
  const output = nonNegative(usage.output);
  const cacheRead = nonNegative(usage.cacheRead);
  const cacheWrite = nonNegative(usage.cacheWrite);
  // totalTokens is the provider's authoritative count. Older/custom tool results
  // sometimes omit it, so only then derive a complete count from its components.
  const reportedTotal = finiteNumber(usage.totalTokens);
  return {
    totalTokens: total.totalTokens + Math.max(0, reportedTotal ?? input + output + cacheRead + cacheWrite),
    input: total.input + input,
    output: total.output + output,
    cacheRead: total.cacheRead + cacheRead,
    cacheWrite: total.cacheWrite + cacheWrite,
    cost: total.cost + nonNegative(usage.cost?.total),
  };
}

/** Aggregate persisted, finalized usage once per active-branch entry. */
export function sessionUsage(ctx: ExtensionContext): SessionUsage {
  return ctx.sessionManager.getBranch().reduce((total, entry) => {
    if (entry.type !== "message") return total;
    const message = entry.message as { role?: unknown; usage?: UsageLike };
    return message.role === "assistant" || message.role === "toolResult"
      ? addUsage(total, message.usage)
      : total;
  }, { ...EMPTY_USAGE });
}

function cacheHit(usage: SessionUsage): number | undefined {
  const cacheBase = usage.input + usage.cacheRead;
  return cacheBase === 0 ? undefined : 100 * usage.cacheRead / cacheBase;
}

export type SpeedColor = "success" | "warning" | "error" | "muted";

export function speedColor(speed: number | undefined): SpeedColor {
  if (speed === undefined) return "muted";
  if (speed >= 30) return "success";
  if (speed >= 10) return "warning";
  return "error";
}

export function formatSpeed(speed: number, showUnit: boolean): string {
  const value = speed.toFixed(speed >= 100 ? 0 : 1);
  return showUnit ? `${value} tok/s` : value;
}

function renderRight(
  theme: ExtensionContext["ui"]["theme"],
  settings: MiniLensSettings,
  percentText: string,
  speed: number | undefined,
  highlighted?: keyof MiniLensSettings,
): string {
  const fields: string[] = [];
  if (settings["mini-lens-context-percent-show"] && percentText) fields.push(highlighted === "mini-lens-context-percent-show" ? theme.bg("selectedBg", theme.fg("accent", theme.bold(percentText))) : theme.fg("accent", percentText));
  if (settings["mini-lens-speed-show"] && speed !== undefined) {
    const text = formatSpeed(speed, settings["mini-lens-speed-unit-show"]);
    fields.push(highlighted === "mini-lens-speed-show" || highlighted === "mini-lens-speed-unit-show"
      ? theme.bg("selectedBg", theme.fg("accent", theme.bold(text)))
      : theme.fg(speedColor(speed), text));
  }
  return fields.join("  ");
}

const SETTINGS_PREVIEW_CONTEXT = {
  model: { id: "deepseek-v4-flash" },
  thinkingLevel: "high",
  getContextUsage: () => ({ tokens: 500, contextWindow: 1_000_000, percent: 1 }),
} as unknown as ExtensionContext;

const SETTINGS_PREVIEW_USAGE: SessionUsage = {
  totalTokens: 45_000,
  input: 15_000,
  output: 5_000,
  cacheRead: 10_000,
  cacheWrite: 15_000,
  cost: 0.012,
};

export function settingsPreviewLine(
  theme: ExtensionContext["ui"]["theme"],
  settings: MiniLensSettings,
  width = 140,
  highlighted?: keyof MiniLensSettings,
): string {
  return statusLine(SETTINGS_PREVIEW_CONTEXT, theme, width, SETTINGS_PREVIEW_USAGE, settings, 120, highlighted, 3);
}

export function statusLine(
  ctx: ExtensionContext,
  theme: ExtensionContext["ui"]["theme"],
  width: number,
  usageTotals: SessionUsage,
  settings: MiniLensSettings,
  speed: number | undefined,
  highlighted?: keyof MiniLensSettings,
  mcpCount?: number,
): string {
  if (highlighted === "mini-lens-context-dots-show") highlighted = "mini-lens-context-show";
  const field = (id: keyof MiniLensSettings, color: Parameters<typeof theme.fg>[0], text: string) =>
    id === highlighted ? theme.bg("selectedBg", theme.fg("accent", theme.bold(text))) : theme.fg(color, text);
  if (width <= 0) return "";
  const model = ctx.model?.id ?? "";
  const thinking = ctx.thinkingLevel ?? "";
  const hit = cacheHit(usageTotals);
  const hitText = hit === undefined ? "" : `CH ${hit.toFixed(1)}%`;
  const cachedTokens = usageTotals.cacheRead + usageTotals.cacheWrite;
  const price = usageTotals.cost > 0 ? formatUsd(usageTotals.cost) : "";
  const contextUsage = ctx.getContextUsage();
  const tokens = finiteNumber(contextUsage?.tokens);
  const contextWindow = finiteNumber(contextUsage?.contextWindow);
  const rawPercent = finiteNumber(contextUsage?.percent);
  const percent = rawPercent === undefined ? undefined : Math.max(0, Math.min(100, rawPercent));
  const percentText = percent === undefined ? "" : `${Math.round(percent)}%`;
  const tokenText = tokens === undefined || contextWindow === undefined ? "" : `${formatTokens(Math.max(0, tokens))}/${formatTokens(Math.max(0, contextWindow))}`;
  const showContext = settings["mini-lens-context-show"] && Boolean(tokenText);
  const mcpText = settings["mini-lens-mcp-show"] && mcpCount !== undefined ? `◇ MCP ${mcpCount}` : "";

  const right = renderRight(theme, settings, percentText, speed, highlighted);
  const rightWidth = visibleWidth(right);
  if (right && width <= rightWidth) {
    const compactRight = settings["mini-lens-speed-show"] && speed !== undefined
      ? theme.fg(speedColor(speed), formatSpeed(speed, settings["mini-lens-speed-unit-show"]))
      : right;
    return truncateToWidth(compactRight, width, "");
  }

  const leftParts = [
    settings["mini-lens-model-show"] && model && field("mini-lens-model-show", "accent", model),
    settings["mini-lens-thinking-show"] && thinking && field("mini-lens-thinking-show", "muted", thinking),
    settings["mini-lens-session-tokens-show"] && field("mini-lens-session-tokens-show", "text", `Total ${formatTokens(usageTotals.totalTokens)}`),
    settings["mini-lens-cache-tokens-show"] && field("mini-lens-cache-tokens-show", "text", `Cached ${formatTokens(cachedTokens)}`),
    settings["mini-lens-ch-show"] && hitText && field("mini-lens-ch-show", "text", hitText),
    settings["mini-lens-cost-show"] && price && field("mini-lens-cost-show", "muted", price),
    mcpText && field("mini-lens-mcp-show", "muted", mcpText),
  ].filter((part): part is string => Boolean(part));
  const unstyledLeft = [
    settings["mini-lens-model-show"] && model,
    settings["mini-lens-thinking-show"] && thinking,
    settings["mini-lens-session-tokens-show"] && `Total ${formatTokens(usageTotals.totalTokens)}`,
    settings["mini-lens-cache-tokens-show"] && `Cached ${formatTokens(cachedTokens)}`,
    settings["mini-lens-ch-show"] && hitText,
    settings["mini-lens-cost-show"] && price,
    mcpText,
  ].filter(Boolean).join("  ");
  const leftBudget = Math.min(visibleWidth(unstyledLeft), Math.max(1, width - rightWidth - (showContext ? 20 : 1)), Math.max(0, width - rightWidth - 1));
  const left = leftParts.length > 0 ? truncateToWidth(leftParts.join("  "), leftBudget, "…") : "";
  const leftWidth = visibleWidth(left);
  const middleBudget = showContext ? Math.max(0, width - leftWidth - rightWidth - (left && right ? 4 : left || right ? 1 : 0)) : 0;

  let middle = "";
  if (middleBudget > 0) {
    const visibleToken = truncateToWidth(tokenText, middleBudget, "…");
    const visibleTokenWidth = visibleWidth(visibleToken);
    const barWidth = middleBudget - visibleTokenWidth - 1;
    const filledCell = settings["mini-lens-context-dots-show"] ? "⣿" : "█";
    const emptyCell = settings["mini-lens-context-dots-show"] ? "⣀" : "░";
    const bar = barWidth >= 2 && percent !== undefined
      ? `${field("mini-lens-context-show", "accent", filledCell.repeat(Math.round(barWidth * percent / 100)))}${field("mini-lens-context-show", "borderMuted", emptyCell.repeat(barWidth - Math.round(barWidth * percent / 100)))}`
      : "";
    middle = `${field("mini-lens-context-show", "muted", visibleToken)}${bar ? ` ${bar}` : ""}`;
  }

  const content = [left, middle].filter(Boolean).join("  ");
  if (!right) return truncateToWidth(content, width, "");
  const gap = " ".repeat(Math.max(1, width - visibleWidth(content) - rightWidth));
  return truncateToWidth(`${content}${content ? gap : ""}${right}`, width, "");
}

function settingsItems(settings: MiniLensSettings): SettingItem[] {
  const labels: Record<Exclude<keyof MiniLensSettings, "onboardingCompleted">, string> = {
    "mini-lens-model-show": "Show model",
    "mini-lens-thinking-show": "Show thinking level",
    "mini-lens-session-tokens-show": "Show total session tokens",
    "mini-lens-cache-tokens-show": "Show session cache tokens",
    "mini-lens-ch-show": "Show cache hit rate (CH)",
    "mini-lens-cost-show": "Show session price",
    "mini-lens-mcp-show": "Show enabled MCP servers",
    "mini-lens-context-show": "Show context tokens and progress bar",
    "mini-lens-context-dots-show": "↳ Use dot-matrix progress bar",
    "mini-lens-context-percent-show": "Show context percentage",
    "mini-lens-speed-show": "Show latest generation speed",
    "mini-lens-speed-unit-show": "↳ Show tok/s unit",
    "mini-lens-minimal-show": "启用极简模式",
    "mini-lens-minimal-thinking-show": "显示思考",
    "mini-lens-minimal-tools-show": "显示工具调用",
    "mini-lens-minimal-output-show": "显示执行输出",
    "mini-lens-minimal-skills-show": "显示 skill",
  };
  return (Object.keys(labels) as Array<Exclude<keyof MiniLensSettings, "onboardingCompleted">>).map((id) => ({
    id,
    label: labels[id],
    description: id === "mini-lens-session-tokens-show"
      ? "Total: all tokens used on the current session branch, including tool-reported LLM usage."
      : id === "mini-lens-cache-tokens-show"
        ? "Cached: cumulative cache-read + cache-write tokens (part of Total)."
        : id === "mini-lens-ch-show"
          ? "CH (cache hit): cache-read / (input + cache-read). Cache writes are not included in this rate."
          : undefined,
    currentValue: settings[id] ? "on" : "off",
    values: ["on", "off"],
  }));
}

interface ActiveGeneration {
  startedAt: number;
  output: number;
  lastSampleAt: number;
}

function outputSpeed(output: unknown, startedAt: number, endedAt = Date.now()): number | undefined {
  const tokenCount = finiteNumber(output);
  const elapsedMs = endedAt - startedAt;
  if (tokenCount === undefined || tokenCount <= 0 || elapsedMs <= 0) return undefined;
  return tokenCount / (elapsedMs / 1_000);
}

export interface MinimalTurn {
  question: string;
  agentCalls?: AgentCall[];
  process: string[];
  final?: string;
  running?: boolean;
  waitingTools?: Array<{ id: string; name: string; startedAt: number }>;
}

const PROCESS_PREVIEW_LIMIT = 180;

function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (content && typeof content === "object" && "content" in content) return contentText(content.content);
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type?: string; text?: string } => Boolean(item && typeof item === "object"))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text!.trim())
    .filter(Boolean)
    .join("\n");
}

function preview(value: unknown): string {
  let raw = contentText(value);
  if (!raw && value !== undefined) {
    try { raw = JSON.stringify(value) ?? ""; } catch { raw = String(value); }
  }
  const text = raw.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim();
  return text.length > PROCESS_PREVIEW_LIMIT ? `${text.slice(0, PROCESS_PREVIEW_LIMIT - 1)}…` : text;
}

function processText(value: unknown): string {
  return contentText(value) || (value === undefined ? "" : JSON.stringify(value) ?? "");
}

function pushProcess(turn: MinimalTurn | undefined, kind: string, value: unknown): void {
  if (!turn) return;
  const text = processText(value);
  const line = text ? `${kind} ${text}` : kind;
  if (turn.process.at(-1) !== line) turn.process.push(line);
}

function skillNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/\/skill:([\w.-]+)/g)) names.add(match[1]);
  for (const match of text.matchAll(/<skill[^>]*?(?:name=["']([^"']+)["']|>\s*<name>([^<]+))/gi)) names.add((match[1] ?? match[2]).trim());
  return [...names];
}

/** Rebuild turns on the selected session branch. */
export function minimalTurnsFromBranch(branch: readonly unknown[]): MinimalTurn[] {
  const turns: MinimalTurn[] = [];
  let turn: MinimalTurn | undefined;
  for (const rawEntry of branch) {
    const entry = rawEntry as { type?: string; message?: { role?: string; content?: unknown; stopReason?: string; errorMessage?: string } } | null;
    if (entry?.type !== "message" || !entry.message) continue;
    const { role, content } = entry.message;
    if (role === "user") {
      const question = contentText(content);
      turn = { question: question || "[附件]",  process: [], running: false };
      for (const name of skillNames(question)) pushProcess(turn, "skill", name);
      turns.push(turn);
      continue;
    }
    if (!turn) continue;
    if (role === "toolResult") {
      const result = entry.message as { toolCallId?: string; isError?: boolean };
      const call = turn.agentCalls?.find(call => call.id === result.toolCallId);
      if (call) {
        call.state = result.isError ? "error" : "done";
        call.output = contentText(content) || "调用已返回（无文本输出）";
        continue;
      }
      pushProcess(turn, "output", content);
      continue;
    }
    if (role !== "assistant" || !Array.isArray(content)) continue;
    for (const item of content as Array<Record<string, unknown>>) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "thinking") pushProcess(turn, "thinking", item.thinking ?? item.text);
      else if (item.type === "toolCall") {
        if (item.name) {
          (turn.agentCalls ??= []).push(agentCall(String(item.id), String(item.name), item.arguments ?? item.input));
          pushProcess(turn, "call", String(item.id));
          const path = (item.arguments as { path?: string })?.path;
          if (path && /(?:^|\/)SKILL\.md$/i.test(path)) pushProcess(turn, "skill", path.split("/").at(-2));
          continue;
        }
        pushProcess(turn, `tool ${String(item.name ?? "")}`.trim(), item.arguments ?? item.input);
        const path = (item.arguments as { path?: unknown })?.path;
        if (typeof path === "string" && /(?:^|\/)SKILL\.md$/i.test(path)) pushProcess(turn, "skill", path.split("/").at(-2) ?? path);
      }
    }
    const text = contentText(content);
    const hasTools = content.some((item) => item?.type === "toolCall");
    if (hasTools) {
      if (text) pushProcess(turn, "output", text);
      turn.final = undefined;
    } else turn.final = text || undefined;
    if (entry.message.stopReason === "error" || entry.message.stopReason === "aborted") {
      turn.final = [entry.message.stopReason === "aborted" ? "执行已中止" : "执行失败", entry.message.errorMessage, turn.final].filter(Boolean).join("\n");
    }
  }
  return turns;
}

function visibleMinimalTurns(settings: MiniLensSettings, turns: MinimalTurn[]): MinimalTurn[] {
  return turns.map((turn) => ({
    ...turn,
    agentCalls: settings["mini-lens-minimal-tools-show"] ? turn.agentCalls : [],
    process: turn.process.filter((line) => {
      if (line.startsWith("thinking ")) return settings["mini-lens-minimal-thinking-show"];
      if (line.startsWith("tool ")) return settings["mini-lens-minimal-tools-show"];
      if (line.startsWith("output ")) return settings["mini-lens-minimal-output-show"];
      if (line.startsWith("skill ")) return settings["mini-lens-minimal-skills-show"];
      return true;
    }),
  }));
}

export function minimalOutputComponent(theme: ExtensionContext["ui"]["theme"], getTurns: () => MinimalTurn[], isExpanded: () => boolean = () => false) {
  const markdown = (text: string, width: number) => new Markdown(text, 0, 0, getMarkdownTheme(),
    { color: (value) => theme.fg("text", value) }, { transform: (source, available) => diagramMarkdown(source, available) }).render(width);
  const surface = (rows: string[], width: number, user: boolean) => {
    const padding = Math.min(2, Math.floor((width - 1) / 2));
    return ["", ...rows, ""].map((row) => {
      const line = truncateToWidth(" ".repeat(padding) + row, width, "");
      return minimalSurface(theme, line + " ".repeat(Math.max(0, width - visibleWidth(line))), user);
    });
  };
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const inner = Math.max(1, width - 2 * Math.min(2, Math.floor((width - 1) / 2)));
      const lines: string[] = [];
      for (const [index, turn] of getTurns().entries()) {
        if (index > 0) lines.push("");
        lines.push(...surface(markdown(turn.question, inner), width, true));
        const entries = turn.process.flatMap((entry) => {
          if (entry.startsWith("call ")) {
            const call = turn.agentCalls?.find(call => call.id === entry.slice(5));
            return call ? [{ title: `${call.name} ${call.output ?? call.task}`.trim(), detail: [call.task, call.output].filter(Boolean).join("\n\n"), state: call.state, id: call.id }] : [];
          }
          const part = entry.match(/^(tool|output|thinking|skill)(?:\s+|$)([\s\S]*)/);
          const label = ({ tool: "工具", output: "输出", thinking: "思考", skill: "Skill" } as Record<string, string>)[part?.[1] ?? ""] ?? "过程";
          return [{ title: `${label} ${part?.[2] ?? entry}`, detail: part?.[2] ?? entry, state: part?.[1] === "thinking" && turn.running ? "running" : "done", id: "" }];
        });
        // Older in-memory turns may predate call markers.
        for (const call of turn.agentCalls ?? []) {
          if (!entries.some(entry => entry.id === call.id)) entries.push({ title: `${call.name} ${call.task}`, detail: [call.task, call.output].filter(Boolean).join("\n\n"), state: call.state, id: call.id });
        }
        if (entries.length || turn.running) {
          const expanded = isExpanded();
          const shown = expanded ? entries : entries.slice(-6);
          const done = entries.filter(entry => entry.state === "done").length;
          const failed = entries.filter(entry => entry.state === "error").length;
          const header = theme.fg(failed ? "error" : "accent", "●") + theme.fg("text", ` 调用与过程 · ${entries.length} 条 · `) + theme.fg("accent", `${done} 已完成`) + (failed ? theme.fg("error", ` · ${failed} 失败`) : "") + theme.fg("muted", ` · Ctrl+O ${expanded ? "收起" : "展开"}`);
          lines.push("", truncateToWidth(header, width));
          if (!shown.length) lines.push(truncateToWidth(theme.fg("accent", "└─ ●") + theme.fg("muted", " 思考中…"), width));
          shown.forEach((entry, row) => {
            const waiting = turn.waitingTools?.find(tool => tool.id === entry.id);
            const title = waiting ? `正在执行 ${waiting.name} · 已等待 ${Math.max(0, Math.floor((Date.now() - waiting.startedAt) / 1000))} 秒` : entry.title;
            const text = title.replace(/\s+/g, " ").trim();
            const color = entry.state === "error" ? "error" : "accent";
            const glyph = entry.state === "error" ? "✗" : entry.state === "running" ? "●" : "✓";
            lines.push(truncateToWidth(theme.fg("accent", row === shown.length - 1 ? "└─ " : "├─ ") + theme.fg(color, glyph) + " " + theme.fg("accent", text), width));
            if (expanded && entry.detail) {
              const rail = row === shown.length - 1 ? "   " : theme.fg("accent", "│  ");
              lines.push(...markdown(entry.detail, Math.max(1, width - 3)).map(line => truncateToWidth(`${rail}${line}`, width, "")));
            }
          });
        }
        if (turn.final) lines.push("", ...markdown(turn.final, width));
      }
      return lines;
    },
  };
}

export default function (pi: ExtensionAPI) {
  let refreshFooter: (() => void) | undefined;
  let refreshMinimal: (() => void) | undefined;
  let processExpanded = false;
  let waitingTimer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeMinimalInput: (() => void) | undefined;
  let restoreAgentWidgets: (() => void) | undefined;
  let restoreTranscript: (() => void) | undefined;
  let minimalTurns: MinimalTurn[] = [];
  let activeMinimalTurn: MinimalTurn | undefined;
  let pendingMinimalFinal = "";
  const minimalMessageIndices = new Map<number, number>();
  let speed: number | undefined;
  let mcpCount: number | undefined;
  let activeGeneration: ActiveGeneration | undefined;
  const toolStarts = new Map<string, number>();
  const minimalToolOutputIndices = new Map<string, number>();
  let speedTimer: ReturnType<typeof setInterval> | undefined;
  let settings: MiniLensSettings = { ...DEFAULT_SETTINGS };
  let saveChain: Promise<void> = Promise.resolve();
  const configPath = settingsPath();

  const refresh = () => refreshFooter?.();
  const refreshMinimalOutput = () => refreshMinimal?.();
  const mountMinimalOutput = (ctx: ExtensionContext) => {
    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = undefined;
    unsubscribeMinimalInput?.();
    unsubscribeMinimalInput = undefined;
    restoreAgentWidgets?.();
    restoreAgentWidgets = undefined;
    restoreTranscript?.();
    restoreTranscript = undefined;
    if (!settings["mini-lens-minimal-show"] || ctx.mode !== "tui") {
      ctx.ui.setWidget?.("mini-lens-minimal-output", undefined);
      refreshMinimal = undefined;
      return;
    }
    ctx.ui.setWidget("mini-lens-minimal-output", (tui, theme) => {
      refreshMinimal = () => tui.requestRender();
      const view = minimalOutputComponent(theme, () => visibleMinimalTurns(settings, minimalTurns), () => processExpanded);
      restoreTranscript = attachTranscript(tui, view);
      if (!restoreTranscript) {
        ctx.ui.notify("无法识别 Pi 消息区布局，极简模式未启用；保留原生输出。", "warning");
      }
      if (restoreTranscript) {
        restoreAgentWidgets = attachAgentWidgets(tui, theme, () => processExpanded);
        waitingTimer = setInterval(() => {
          if (activeMinimalTurn?.running && activeMinimalTurn.waitingTools?.length) tui.requestRender();
        }, 1000);
        waitingTimer.unref();
        unsubscribeMinimalInput = ctx.ui.onTerminalInput?.((data) => {
          if (!matchesKey(data, "ctrl+o")) return;
          // Input listeners run before Pi filters Kitty release events.
          // Consume release/repeat without toggling the same key twice.
          if (isKeyRelease(data) || isKeyRepeat(data)) return { consume: true };
          processExpanded = !processExpanded;
          tui.requestRender();
          return { consume: true };
        });
      }
      tui.requestRender();
      // Factory acquires the renderer only; never duplicate content in the dock.
      return { render: () => [], invalidate() {} };
    });
  };
  // All factories run before session_start; retain startup broadcasts until the footer mounts.
  const unsubscribeMcpStatus = pi.events.on("pi-mcp-adapter/status/v1", (value: unknown) => {
    const count = enabledMcpServerCount(value);
    if (count === undefined) return;
    mcpCount = count;
    refresh();
  });
  const stopSpeedTimer = () => {
    if (speedTimer) clearInterval(speedTimer);
    speedTimer = undefined;
  };
  const refreshStreamingSpeed = () => {
    if (!activeGeneration) return;
    const nextSpeed = outputSpeed(activeGeneration.output, activeGeneration.startedAt);
    if (nextSpeed !== undefined) speed = nextSpeed;
    refresh();
  };
  const startSpeedTimer = () => {
    stopSpeedTimer();
    speedTimer = setInterval(refreshStreamingSpeed, 250);
  };
  const persistSettings = (ctx: ExtensionContext) => {
    const snapshot = { ...settings };
    saveChain = saveChain
      .catch(() => undefined)
      .then(() => saveSettings(snapshot, configPath))
      .catch(() => ctx.ui.notify("Could not save Mini Lens settings", "error"));
    return saveChain;
  };
  const openSettings = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("/mini-lens-settings requires TUI mode", "error");
      return;
    }
    await ctx.ui.custom((tui, theme, _keybindings, done) => {
      const container = new Container();
      const preview = new Text(settingsPreviewLine(theme, settings), 1, 1);
      container.addChild(new Text(theme.fg("accent", theme.bold("Mini Lens settings")), 1, 1));
      container.addChild(new Text(theme.fg("muted", "Preview (example data)"), 1, 0));
      container.addChild(preview);
      const items = settingsItems(settings);
      let highlighted: keyof MiniLensSettings | undefined;
      const onChange = (id: string, value: string) => {
        settings = { ...settings, [id]: value === "on", onboardingCompleted: true };
        preview.setText(settingsPreviewLine(theme, settings));
        mountMinimalOutput(ctx);
        void persistSettings(ctx);
        refresh();
        refreshMinimalOutput();
      };
      const settingsTheme = {
        ...getSettingsListTheme(),
        cursor: theme.bg("selectedBg", theme.fg("accent", theme.bold("→ "))),
        label: (text: string, selected: boolean) => {
          if (selected) highlighted = items.find((item) => item.label === text.trimEnd())?.id as keyof MiniLensSettings | undefined;
          return selected ? theme.bg("selectedBg", theme.fg("accent", theme.bold(text))) : theme.fg("text", text);
        },
        value: (text: string, selected: boolean) => selected ? theme.bg("selectedBg", theme.fg("accent", theme.bold(text))) : theme.fg("muted", text),
      };
      const groups: SettingItem[] = [
        { id: "lens", label: "Lens", currentValue: "›", submenu: (_value, back) => new SettingsList(settingsItems(settings).filter((item) => !item.id.includes("-minimal-")), 12, settingsTheme, onChange, () => back(), { enableSearch: true }) },
        { id: "minimal", label: "极简输出", currentValue: "›", submenu: (_value, back) => new SettingsList(settingsItems(settings).filter((item) => item.id.includes("-minimal-")), 8, settingsTheme, onChange, () => back(), { enableSearch: true }) },
      ];
      const settingsList = new SettingsList(
        groups,
        12,
        settingsTheme,
        onChange,
        () => done(undefined),
        { enableSearch: true },
      );
      container.addChild(settingsList);
      return {
        render: (width: number) => {
          // SettingsList exposes selection through its theme callback, including search and mouse navigation.
          highlighted = undefined;
          settingsList.render(width);
          preview.setText(settingsPreviewLine(theme, settings, Math.max(0, width - 2), highlighted));
          return container.render(width);
        },
        invalidate: () => container.invalidate(),
        handleMouse: (event: TuiMouseEvent) => container.handleMouse(event),
        handleInput: (data: string) => {
          settingsList.handleInput(data);
          tui.requestRender();
        },
      };
    });
  };

  pi.registerCommand("mini-lens-settings", {
    description: "Configure the Lens and Minimal output groups",
    handler: async (_args, ctx) => openSettings(ctx),
  });
  pi.registerCommand("mini-lens-history", {
    description: "View collapsed process entries for a conversation turn",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || minimalTurns.length === 0) return;
      const labels = minimalTurns.map((turn, index) => `${index + 1}. ${preview(turn.question)}`);
      const selected = await ctx.ui.select("选择执行过程（不改变折叠视图）", labels);
      const index = selected === undefined ? -1 : labels.indexOf(selected);
      if (index < 0) return;
      const snapshot = [...minimalTurns[index].process];
      await ctx.ui.custom((tui, theme, _keys, done) => {
        let offset = 0;
        return {
          invalidate() {},
          render(width: number) {
            const page = snapshot.slice(offset, offset + 5);
            return [
              truncateToWidth(theme.fg("accent", `执行过程 ${offset + 1}–${Math.min(offset + 5, snapshot.length)} / ${snapshot.length} · ↑↓ 翻阅 · Esc 关闭`), width),
              ...page.flatMap((line) => new Markdown(line, 0, 0, getMarkdownTheme(), undefined, { transform: diagramMarkdown }).render(Math.max(1, width))),
            ];
          },
          handleInput(data: string) {
            if (data === "\u001b" || data === "q") done(undefined);
            else if (data === "\u001b[B" || data === "j") offset = Math.min(Math.max(0, snapshot.length - 5), offset + 1);
            else if (data === "\u001b[A" || data === "k") offset = Math.max(0, offset - 1);
            tui.requestRender();
          },
        };
      });
    },
  });
  pi.registerCommand("mini-lens-minimal", {
    description: "Toggle minimal output (collapsed single-line process per turn)",
    handler: async (args, ctx) => {
      const normalized = args.trim().toLowerCase();
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/mini-lens-minimal requires TUI mode", "error");
        return;
      }
      if (normalized && normalized !== "on" && normalized !== "off") {
        ctx.ui.notify("Usage: /mini-lens-minimal [on|off]", "warning");
        return;
      }
      settings = {
        ...settings,
        "mini-lens-minimal-show": normalized === "on" ? true : normalized === "off" ? false : !settings["mini-lens-minimal-show"],
        onboardingCompleted: true,
      };
      mountMinimalOutput(ctx);
      await persistSettings(ctx);
      ctx.ui.notify(`Mini Lens minimal output: ${settings["mini-lens-minimal-show"] ? "on" : "off"}`, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const loaded = await loadSettings(configPath);
    settings = loaded.settings;
    minimalTurns = minimalTurnsFromBranch(ctx.sessionManager.getBranch());
    activeMinimalTurn = undefined;
    pendingMinimalFinal = "";
    minimalToolOutputIndices.clear();
    mountMinimalOutput(ctx);
    ctx.ui.setFooter((tui, theme) => {
      refreshFooter = () => tui.requestRender();
      return {
        invalidate() {},
        render(width: number): string[] {
          return [statusLine(ctx, theme, width, sessionUsage(ctx), settings, speed, undefined, mcpCount)];
        },
      };
    });
    refresh();
    if (!loaded.exists && ctx.mode === "tui" && ctx.hasUI) {
      const choice = await ctx.ui.select(
        "Mini Lens preview\n\n  deepseek-v4-flash  high  Total 45K  Cached 25K  CH 40.0%  $0.012  500/1.0M  █░░░░░░░░░  1%  120 tok/s\n\nMCP count and dot-matrix style are off by default; other fields are on.",
        ["Keep defaults", "Configure now"],
      );
      settings = { ...settings, onboardingCompleted: true };
      try {
        await persistSettings(ctx);
      } catch {
        ctx.ui.notify(`Could not save Mini Lens settings in ${CONFIG_DIR_NAME}`, "error");
      }
      if (choice === "Configure now") await openSettings(ctx);
    }
  });
  const syncMinimalBranch = (_event: unknown, ctx: ExtensionContext) => {
    minimalTurns = minimalTurnsFromBranch(ctx.sessionManager.getBranch());
    activeMinimalTurn = undefined;
    pendingMinimalFinal = "";
    minimalMessageIndices.clear();
    minimalToolOutputIndices.clear();
    mountMinimalOutput(ctx);
    refreshMinimalOutput();
  };
  // New/switch/fork emit session_start; tree navigation has its own event.
  pi.on("session_tree", syncMinimalBranch);
  pi.on("session_compact", (event, ctx) => {
    // Compaction during execution must not discard the in-flight turn or indexes.
    if (activeMinimalTurn) { refreshMinimalOutput(); return; }
    syncMinimalBranch(event, ctx);
  });
  pi.on("before_agent_start", (event) => {
    if (!activeMinimalTurn) return;
    for (const name of skillNames(event.prompt)) pushProcess(activeMinimalTurn, "skill", name);
    refreshMinimalOutput();
  });
  pi.on("model_select", refresh);
  pi.on("thinking_level_select", refresh);
  pi.on("message_start", (event) => {
    if (event.message.role === "user") {
      if (activeMinimalTurn) {
        activeMinimalTurn.final = pendingMinimalFinal;
      }
      const question = contentText(event.message.content) || "[附件]";
      processExpanded = false;
      activeMinimalTurn = { question, process: [], running: true };
      for (const name of skillNames(question)) pushProcess(activeMinimalTurn, "skill", name);
      pendingMinimalFinal = "";
      minimalToolOutputIndices.clear();
      minimalTurns.push(activeMinimalTurn);
      refreshMinimalOutput();
    }
    if (event.message.role !== "assistant") return;
    minimalMessageIndices.clear();
    pendingMinimalFinal = "";
    // Keep the last completed speed visible until this response produces tokens.
    // Tool-call-only assistant messages therefore cannot erase a useful rate.
    const startedAt = Date.now();
    activeGeneration = { startedAt, output: 0, lastSampleAt: startedAt };
    startSpeedTimer();
  });
  pi.on("message_update", (event) => {
    const partial = (event.assistantMessageEvent as { partial?: { usage?: UsageLike; content?: Array<Record<string, unknown>> } }).partial;
    if (activeMinimalTurn && partial?.content) {
      for (const [blockIndex, item] of partial.content.entries()) {
        if (item.type !== "thinking") continue;
        const line = `${item.type === "thinking" ? "thinking" : "output"} ${processText(item.thinking ?? item.text)}`;
        const index = minimalMessageIndices.get(blockIndex);
        if (index === undefined) {
          minimalMessageIndices.set(blockIndex, activeMinimalTurn.process.length);
          activeMinimalTurn.process.push(line);
        } else activeMinimalTurn.process[index] = line;
      }
      activeMinimalTurn.final = contentText(partial.content) || undefined;
      refreshMinimalOutput();
    }
    const usage = partial?.usage;
    const output = finiteNumber(usage?.output);
    const timestamp = Date.now();
    if (activeGeneration && output !== undefined && output >= activeGeneration.output && timestamp >= activeGeneration.lastSampleAt) {
      activeGeneration.output = output;
      activeGeneration.lastSampleAt = timestamp;
      refreshStreamingSpeed();
    }
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      if (activeGeneration) {
        const finalSpeed = outputSpeed((event.message.usage as UsageLike | undefined)?.output, activeGeneration.startedAt);
        if (finalSpeed !== undefined) speed = finalSpeed;
        activeGeneration = undefined;
        stopSpeedTimer();
      }
      const content = (event.message as { content?: unknown }).content;
      if (activeMinimalTurn && Array.isArray(content)) {
        for (const [blockIndex, item] of (content as Array<Record<string, unknown>>).entries()) {
          if (item.type !== "thinking" && !(item.type === "text" && content.some((block) => block.type === "toolCall"))) continue;
          const line = `${item.type === "thinking" ? "thinking" : "output"} ${processText(item.thinking ?? item.text)}`;
          const index = minimalMessageIndices.get(blockIndex);
          if (index === undefined) activeMinimalTurn.process.push(line);
          else activeMinimalTurn.process[index] = line;
        }
        const text = contentText(content);
        const message = event.message as { stopReason?: string; errorMessage?: string };
        activeMinimalTurn.final = undefined;
        pendingMinimalFinal = content.some((item) => item?.type === "toolCall") ? "" : text;
        if (message.stopReason === "error" || message.stopReason === "aborted") {
          pendingMinimalFinal = [message.stopReason === "aborted" ? "执行已中止" : "执行失败", message.errorMessage, pendingMinimalFinal].filter(Boolean).join("\n");
        }
        activeMinimalTurn.final = pendingMinimalFinal || undefined;
      }
    }
    refresh();
    refreshMinimalOutput();
  });
  pi.on("tool_execution_start", (event) => {
    toolStarts.set(event.toolCallId, Date.now());
    if (activeMinimalTurn) {
      (activeMinimalTurn.agentCalls ??= []).push(agentCall(event.toolCallId, event.toolName, event.args));
      pushProcess(activeMinimalTurn, "call", event.toolCallId);
      (activeMinimalTurn.waitingTools ??= []).push({ id: event.toolCallId, name: event.toolName, startedAt: Date.now() });
    }
    const path = (event.args as { path?: unknown })?.path;
    if (typeof path === "string" && /(?:^|\/)SKILL\.md$/i.test(path)) {
      pushProcess(activeMinimalTurn, "skill", path.split("/").at(-2) ?? path);
    }
    refreshMinimalOutput();
  });
  pi.on("tool_execution_update", (event) => {
    if (!activeMinimalTurn) return;
    // Pi emits an empty content array before starting bash. It is a heartbeat,
    // not output: keep the tool status (and any existing output) intact.
    const text = contentText(event.partialResult);
    if (!text) return;
    const call = activeMinimalTurn.agentCalls?.find(call => call.id === event.toolCallId);
    if (call) { call.output = text; activeMinimalTurn.waitingTools = activeMinimalTurn.waitingTools?.filter(tool => tool.id !== event.toolCallId); refreshMinimalOutput(); return; }
    activeMinimalTurn.waitingTools = activeMinimalTurn.waitingTools?.filter((tool) => tool.id !== event.toolCallId);
    const line = `output ${text}`;
    const index = minimalToolOutputIndices.get(event.toolCallId);
    if (index === undefined) {
      minimalToolOutputIndices.set(event.toolCallId, activeMinimalTurn.process.length);
      activeMinimalTurn.process.push(line);
    } else {
      activeMinimalTurn.process[index] = line;
    }
    refreshMinimalOutput();
  });
  pi.on("tool_execution_end", (event) => {
    const startedAt = toolStarts.get(event.toolCallId);
    toolStarts.delete(event.toolCallId);
    const nestedUsage = (event.result as { usage?: UsageLike } | undefined)?.usage;
    if (startedAt !== undefined) {
      const nestedSpeed = outputSpeed(nestedUsage?.output, startedAt);
      if (nestedSpeed !== undefined) speed = nestedSpeed;
    }
    const call = activeMinimalTurn?.agentCalls?.find(call => call.id === event.toolCallId);
    if (call) {
      if (activeMinimalTurn) activeMinimalTurn.waitingTools = activeMinimalTurn.waitingTools?.filter(tool => tool.id !== event.toolCallId);
      call.state = event.isError ? "error" : "done";
      call.output = contentText(event.result) || (event.isError ? "调用失败（无文本详情）" : "调用已返回（后台任务状态见下方）");
      refresh();
      refreshMinimalOutput();
      return;
    }
    if (activeMinimalTurn) {
      activeMinimalTurn.waitingTools = activeMinimalTurn.waitingTools?.filter((tool) => tool.id !== event.toolCallId);
      const text = contentText(event.result) || (event.isError ? "工具执行失败（无文本详情）" : "工具执行完成（无文本输出）");
      const line = `${event.isError ? "output error" : "output"} ${text}`;
      const index = minimalToolOutputIndices.get(event.toolCallId);
      if (index === undefined) activeMinimalTurn.process.push(line);
      else activeMinimalTurn.process[index] = line;
    }
    minimalToolOutputIndices.delete(event.toolCallId);
    refresh();
    refreshMinimalOutput();
  });
  pi.on("agent_start", refresh);
  pi.on("agent_end", refresh);
  pi.on("agent_settled", () => {
    if (!activeMinimalTurn) return;
    for (const turn of minimalTurns) turn.running = false;
    activeMinimalTurn.final = pendingMinimalFinal;
    activeMinimalTurn = undefined;
    pendingMinimalFinal = "";
    minimalToolOutputIndices.clear();
    refreshMinimalOutput();
  });
  pi.on("session_shutdown", () => {
    unsubscribeMcpStatus();
    refreshFooter = undefined;
    activeGeneration = undefined;
    toolStarts.clear();
    minimalToolOutputIndices.clear();
    refreshMinimal = undefined;
    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = undefined;
    unsubscribeMinimalInput?.();
    unsubscribeMinimalInput = undefined;
    restoreAgentWidgets?.();
    restoreAgentWidgets = undefined;
    restoreTranscript?.();
    restoreTranscript = undefined;
    stopSpeedTimer();
  });
}
