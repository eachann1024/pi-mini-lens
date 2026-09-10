import { agentCall, agentCallDisplay, attachAgentWidgets, currentAgentStatuses, isAgentTool, liveAgentView, readAgentStatuses, runningGlyph, type AgentCall } from "../lib/agent-view.ts";
import { CONFIG_DIR_NAME, getSettingsListTheme, getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { attachTranscript, type NoticeRows, type TurnNotices } from "../lib/transcript-adapter.ts";
import { diagramMarkdown, minimalMarkdownTheme } from "../lib/minimal-markdown.ts";
import { minimalSurface, secondaryAccent } from "../lib/minimal-theme.ts";
import { Container, Markdown, matchesKey, isKeyRelease, isKeyRepeat, type SettingItem, SettingsList, Text, type TuiMouseEvent, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import { dirname, join } from "node:path";
import attachFooterTidy from "../lib/footer-tidy.ts";
import attachTitlePlain from "../lib/title-plain.ts";

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
  "mini-lens-agent-usage-show": boolean;
  "mini-lens-agent-shortcut-show": boolean;
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
  "mini-lens-minimal-show": false,
  "mini-lens-minimal-thinking-show": true,
  "mini-lens-minimal-tools-show": true,
  "mini-lens-minimal-output-show": true,
  "mini-lens-minimal-skills-show": true,
  "mini-lens-agent-usage-show": true,
  "mini-lens-agent-shortcut-show": true,
  onboardingCompleted: false,
};

const SETTING_IDS = Object.keys(DEFAULT_SETTINGS) as Array<keyof MiniLensSettings>;

const COPY = {
  title: "Mini Lens settings", preview: "Preview (example data)", lens: "Lens", minimal: "Minimal output",
  model: "Show model", thinking: "Show thinking level", total: "Show total session tokens", cached: "Show session cache tokens", totalLabel: "Total", cachedLabel: "Cached", cacheHitLabel: "CH", cacheHit: "Show cache hit rate (CH)", price: "Show session price", mcp: "Show enabled MCP servers", context: "Show context tokens and progress bar", dots: "↳ Use dot-matrix progress bar", percent: "Show context percentage", speed: "Show latest generation speed", speedUnit: "↳ Show tok/s unit", enableMinimal: "Collapse replies", showThinking: "Show thinking", tools: "Show tool calls", output: "Show process output", skills: "Show skills", agentUsage: "Show Agent token usage", shortcut: "Show Ctrl+O hint for new Agent (6s)",
  totalDescription: "Total: all tokens used on the current session branch, including tool-reported LLM usage.", cachedDescription: "Cached: cumulative cache-read + cache-write tokens (part of Total).", cacheHitDescription: "CH (cache hit): cache-read / (input + cache-read). Cache writes are not included in this rate.",
  enableMinimalDescription: "Off keeps Pi's default conversation history.",
  minimalLocked: "Turn on Collapse replies to configure these options.",
  tuiRequired: "/mini-lens-settings requires TUI mode", saveFailed: "Could not save Mini Lens settings", minimalRequired: "/mini-lens-minimal requires TUI mode", minimalUsage: "Usage: /mini-lens-minimal [on|off]", minimalState: "Mini Lens collapsed replies:", onboarding: "MCP count, dot-matrix style, and collapsed replies are off by default; other fields are on.", keepDefaults: "Keep defaults", configureNow: "Configure now",
} as const;

export function settingsPath(agentDir = process.env.MINI_LENS_AGENT_DIR ?? join(homedir(), CONFIG_DIR_NAME, "agent")): string {
  return join(agentDir, SETTINGS_FILE_NAME);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function parseSettings(value: unknown): MiniLensSettings {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const id of SETTING_IDS) {
    if (isBoolean(candidate[id])) settings[id] = candidate[id];
  }
  return settings;
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
  const hitText = hit === undefined ? "" : `${COPY.cacheHitLabel} ${hit.toFixed(1)}%`;
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
    settings["mini-lens-session-tokens-show"] && usageTotals.totalTokens > 0 && field("mini-lens-session-tokens-show", "text", `${COPY.totalLabel} ${formatTokens(usageTotals.totalTokens)}`),
    settings["mini-lens-cache-tokens-show"] && cachedTokens > 0 && field("mini-lens-cache-tokens-show", "text", `${COPY.cachedLabel} ${formatTokens(cachedTokens)}`),
    settings["mini-lens-ch-show"] && hitText && field("mini-lens-ch-show", "text", hitText),
    settings["mini-lens-cost-show"] && price && field("mini-lens-cost-show", "muted", price),
    mcpText && field("mini-lens-mcp-show", "muted", mcpText),
  ].filter((part): part is string => Boolean(part));
  const unstyledLeft = [
    settings["mini-lens-model-show"] && model,
    settings["mini-lens-thinking-show"] && thinking,
    settings["mini-lens-session-tokens-show"] && usageTotals.totalTokens > 0 && `${COPY.totalLabel} ${formatTokens(usageTotals.totalTokens)}`,
    settings["mini-lens-cache-tokens-show"] && cachedTokens > 0 && `${COPY.cachedLabel} ${formatTokens(cachedTokens)}`,
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

export function isCollapsedReplyChildSetting(id: string): boolean {
  return id === "mini-lens-minimal-thinking-show" || id === "mini-lens-minimal-tools-show" || id === "mini-lens-minimal-output-show"
    || id === "mini-lens-minimal-skills-show" || id === "mini-lens-agent-usage-show" || id === "mini-lens-agent-shortcut-show";
}

export function settingsItems(settings: MiniLensSettings): SettingItem[] {
  const values = ["on", "off"];
  const labels: Record<Exclude<keyof MiniLensSettings, "onboardingCompleted">, string> = {
    "mini-lens-model-show": COPY.model, "mini-lens-thinking-show": COPY.thinking, "mini-lens-session-tokens-show": COPY.total, "mini-lens-cache-tokens-show": COPY.cached, "mini-lens-ch-show": COPY.cacheHit, "mini-lens-cost-show": COPY.price, "mini-lens-mcp-show": COPY.mcp, "mini-lens-context-show": COPY.context, "mini-lens-context-dots-show": COPY.dots, "mini-lens-context-percent-show": COPY.percent, "mini-lens-speed-show": COPY.speed, "mini-lens-speed-unit-show": COPY.speedUnit, "mini-lens-minimal-show": COPY.enableMinimal, "mini-lens-minimal-thinking-show": COPY.showThinking, "mini-lens-minimal-tools-show": COPY.tools, "mini-lens-minimal-output-show": COPY.output, "mini-lens-minimal-skills-show": COPY.skills, "mini-lens-agent-usage-show": COPY.agentUsage, "mini-lens-agent-shortcut-show": COPY.shortcut,
  };
  return (Object.keys(labels) as Array<keyof typeof labels>).map((id) => ({
    id, label: labels[id],
    description: id === "mini-lens-minimal-show" ? COPY.enableMinimalDescription : id === "mini-lens-session-tokens-show" ? COPY.totalDescription : id === "mini-lens-cache-tokens-show" ? COPY.cachedDescription : id === "mini-lens-ch-show" ? COPY.cacheHitDescription : undefined,
    currentValue: settings[id] ? values[0] : values[1], values,
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
  shortcutHintUntil?: number;
  usage?: SessionUsage;
  pendingUsage?: UsageLike;
  agentCalls?: AgentCall[];
  subAgents?: Record<string, unknown>[];
  process: string[];
  final?: string;
  replies?: string[];
  running?: boolean;
  thinking?: number;
  awaitingResponse?: boolean;
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

/** pi-loop injects its wakeup as a user message; keep its boilerplate out of the compact card. */
function piLoopSummary(question: string): string | undefined {
  if (!question.startsWith("[pi-loop]")) return;
  const lines = question.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const title = lines[0] ?? "[pi-loop]";
  const prompt = lines.find(line => line !== title && !line.startsWith("[Self-paced loop:"));
  return prompt ? `${title} · ${prompt}` : title;
}

/** Rebuild turns on the selected session branch. */
export function minimalTurnsFromBranch(branch: readonly unknown[]): MinimalTurn[] {
  const turns: MinimalTurn[] = [];
  let turn: MinimalTurn | undefined;
  for (const rawEntry of branch) {
    const entry = rawEntry as { type?: string; message?: { role?: string; content?: unknown; usage?: UsageLike; stopReason?: string; errorMessage?: string } } | null;
    if (entry?.type !== "message" || !entry.message) continue;
    const { role, content } = entry.message;
    if (role === "user") {
      const question = contentText(content);
      turn = { question: question || "[Attachment]",  process: [], running: false };
      for (const name of skillNames(question)) pushProcess(turn, "skill", name);
      turns.push(turn);
      continue;
    }
    if (!turn) continue;
    if (role === "assistant" || role === "toolResult") turn.usage = addUsage(turn.usage ?? EMPTY_USAGE, entry.message.usage);
    if (role === "toolResult") {
      const result = entry.message as { toolCallId?: string; isError?: boolean };
      const call = turn.agentCalls?.find(call => call.id === result.toolCallId);
      if (call) {
        call.state = result.isError ? "error" : "done";
        call.output = contentText(content) || "Call returned (no text output)";
        continue;
      }
      pushProcess(turn, "output", content);
      continue;
    }
    if (role !== "assistant" || !Array.isArray(content)) continue;
    if (turn.final) (turn.replies ??= []).push(turn.final);
    turn.final = undefined;
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
      turn.final = [entry.message.stopReason === "aborted" ? "Execution aborted" : "Execution failed", entry.message.errorMessage, turn.final].filter(Boolean).join("\n");
    }
  }
  return turns;
}

function visibleMinimalTurns(settings: MiniLensSettings, turns: MinimalTurn[]): MinimalTurn[] {
  return turns.map((turn) => {
    let thinking: number | undefined;
    let visibleCount = 0;
    const process = turn.process.filter((line, index) => {
      const visible = line.startsWith("thinking ") ? settings["mini-lens-minimal-thinking-show"]
        : /^(tool|call) /.test(line) ? settings["mini-lens-minimal-tools-show"]
        : line.startsWith("output ") ? settings["mini-lens-minimal-output-show"]
        : line.startsWith("skill ") ? settings["mini-lens-minimal-skills-show"] : true;
      if (visible) {
        if (index === turn.thinking) thinking = visibleCount;
        visibleCount++;
      }
      return visible;
    });
    return {
      ...turn,
      thinking,
      awaitingResponse: turn.awaitingResponse && settings["mini-lens-minimal-thinking-show"],
      agentCalls: settings["mini-lens-minimal-tools-show"] ? turn.agentCalls : [],
      process,
    };
  });
}

export function minimalOutputComponent(theme: ExtensionContext["ui"]["theme"], getTurns: () => MinimalTurn[], isExpanded: () => boolean = () => false, showShortcut: (turn: MinimalTurn) => boolean = () => true, showUsage: () => boolean = () => true, subAgentsExpanded: () => boolean = () => false, agentDeadlines = new Map<string, number>()) {
  const markdown = (text: string, width: number, process = false) => new Markdown(text, 0, 0, minimalMarkdownTheme(getMarkdownTheme()),
    { color: (value) => process ? secondaryAccent(theme, value) : theme.fg("text", value) }, { transform: (source, available) => diagramMarkdown(source, available) }).render(width);
  const surface = (rows: string[], width: number, user: boolean) => {
    const padding = Math.min(2, Math.floor((width - 1) / 2));
    return ["", ...rows, ""].map((row) => {
      const line = truncateToWidth(" ".repeat(padding) + row, width, "");
      return minimalSurface(theme, line + " ".repeat(Math.max(0, width - visibleWidth(line))), user);
    });
  };
  let agentExpiry = Infinity;
  const expandedPrompts = new Map<number, string>();
  const expandedSubagents = new Set<string>();
  const expandedTools = new Set<string>();
  let pinnedToolId: string | undefined;
  let pinnedTool: { id: string; y: number; line: string } | undefined;
  let pinnedSubagentId: string | undefined;
  let pinnedSubagent: { id: string; y: number; line: string } | undefined;
  let toolControls: Array<{ id: string; y: number; width: number; title: string }> = [];
  let hoveredTool: typeof toolControls[number] | undefined;
  const clearHover = () => { const changed = !!hoveredTool; hoveredTool = undefined; return changed; };
  const toggleTool = (id: string) => {
    if (!getTurns().some(turn => turn.agentCalls?.some(call => call.id === id && !isAgentTool(call.tool ?? call.name)))) return;
    if (expandedTools.has(id)) {
      expandedTools.delete(id);
      if (pinnedToolId === id) pinnedToolId = undefined;
    } else {
      expandedTools.add(id);
      // Only the latest opened tool owns the sticky heading; others stay open.
      pinnedToolId = id;
    }
    clearHover();
  };
  const toggleSubagent = (runId: string) => {
    if (!subagentControls.some(control => control.runId === runId)) return;
    if (expandedSubagents.has(runId)) {
      expandedSubagents.delete(runId);
      if (pinnedSubagentId === runId) pinnedSubagentId = undefined;
    } else {
      expandedSubagents.add(runId);
      pinnedSubagentId = runId;
    }
  };
  let promptControls: Array<{ index: number; question: string; y: number; x: number; width: number; label: string }> = [];
  let subagentControls: Array<{ runId: string; y: number; width: number; line: string }> = [];
  let noticeRegions: Array<{ y: number; rows: NoticeRows }> = [];
  const togglePrompt = (index: number, question: string) => {
    if (getTurns()[index]?.question !== question) return;
    if (expandedPrompts.get(index) === question) expandedPrompts.delete(index);
    else expandedPrompts.set(index, question);
  };
  return {
    invalidate() { clearHover(); },
    clearHover,
    pinnedTool: () => pinnedTool,
    unpinTool: () => { pinnedToolId = undefined; pinnedTool = undefined; },
    pinnedSubagent: () => pinnedSubagent,
    unpinSubagent: () => { pinnedSubagentId = undefined; pinnedSubagent = undefined; },
    toolChoices: () => toolControls.map(control => ({ ...control, expanded: expandedTools.has(control.id) })),
    toggleTool,
    toggleSubagent,
    agentExpiry: () => agentExpiry,
    promptChoices: () => promptControls.map(control => ({ ...control })),
    togglePrompt,
    handleMouse(event: TuiMouseEvent) {
      const tool = toolControls.find(control => event.y === control.y && event.x >= 2 && event.x < Math.min(5, control.width));
      if (event.type === "move") {
        const next = !event.shift && !event.ctrl && !event.alt ? tool : undefined;
        if (hoveredTool?.id !== next?.id) {
          hoveredTool = next;
          return { handled: true, render: true };
        }
        return;
      }
      if (event.type === "wheel" || event.type === "drag") { clearHover(); return; }
      if (tool && event.button === "left" && !event.shift && !event.ctrl && !event.alt) {
        if (event.type === "press") return { handled: true };
        if (event.type === "click") {
          toggleTool(tool.id);
          return { handled: true, render: true };
        }
      }
      if (event.button !== "left" || event.shift || event.ctrl || event.alt || (event.clickCount ?? 1) !== 1) return;
      const control = promptControls.find(control => event.y === control.y && event.x >= control.x && event.x < control.x + control.width);
      if (control) {
        if (event.type === "press") return { handled: true };
        if (event.type === "click") {
          togglePrompt(control.index, control.question);
          return { handled: true, render: true };
        }
      }
      const sub = subagentControls.find(control => event.y === control.y && event.x >= 0 && event.x < control.width);
      if (sub) {
        if (event.type === "press") return { handled: true };
        if (event.type === "click") {
          toggleSubagent(sub.runId);
          return { handled: true, render: true };
        }
      }
      const region = noticeRegions.find(region => event.y >= region.y && event.y < region.y + region.rows.length);
      return region?.rows.handleMouse?.({ ...event, y: event.y - region.y });
    },
    render(width: number, notices?: TurnNotices): string[] {
      promptControls = [];
      toolControls = [];
      pinnedTool = undefined;
      pinnedSubagent = undefined;
      subagentControls = [];
      noticeRegions = [];
      agentExpiry = Infinity;
      if (width <= 0) { clearHover(); return []; }
      const turns = getTurns();
      const toolIds = new Set(turns.flatMap(turn => (turn.agentCalls ?? []).map(call => call.id)));
      for (const id of expandedTools) if (!toolIds.has(id)) expandedTools.delete(id);
      const inner = Math.max(1, width - 2 * Math.min(2, Math.floor((width - 1) / 2)));
      const lines: string[] = [];
      for (const [index, turn] of turns.entries()) {
        if (index > 0) lines.push("");
        if (expandedPrompts.has(index) && expandedPrompts.get(index) !== turn.question) expandedPrompts.delete(index);
        const questionRows = markdown(turn.question, inner);
        const loopSummary = piLoopSummary(turn.question);
        const expanded = expandedPrompts.get(index) === turn.question;
        // Loop wakeups are system-generated user messages. Collapse them even when
        // their short prompt would otherwise fit the normal four-row allowance.
        const userRows = expanded ? [...questionRows] : loopSummary ? markdown(loopSummary, inner) : questionRows.slice(0, 4);
        if (loopSummary || questionRows.length > 4) {
          const label = expanded ? "▴ 收起" : loopSummary ? "▾ 展开" : `▾ 展开 (${questionRows.length} 行)`;
          const control = truncateToWidth(label, inner, "");
          promptControls.push({ index, question: turn.question, y: lines.length + 1 + userRows.length,
            x: 0, width, label });
          userRows.push(theme.fg("accent", control) + theme.fg("muted", truncateToWidth(" · /mini-lens-prompts", Math.max(0, inner - visibleWidth(control)), "")));
        }
        lines.push(...surface(userRows, width, true));
        const entries = turn.process.flatMap((entry, processIndex) => {
          if (entry.startsWith("call ")) {
            const call = turn.agentCalls?.find(call => call.id === entry.slice(5));
            if (call && isAgentTool(call.tool ?? call.name) && !isExpanded()) return [];
            const display = call && agentCallDisplay(call);
            return call && display ? [{ title: `${isAgentTool(call.tool ?? call.name) ? "Control" : call.name} ${display.summary}`.trim(), detail: display.detail, state: call.state, id: call.id, thinking: false }] : [];
          }
          const part = entry.match(/^(tool|output|thinking|skill)(?:\s+|$)([\s\S]*)/);
          const thinking = part?.[1] === "thinking";
          const activeThinking = thinking && turn.running && turn.thinking === processIndex;
          const label = ({ tool: "Tool", output: "Output", thinking: "Thinking", skill: "Skill" } as Record<string, string>)[part?.[1] ?? ""] ?? "Process";
          return [{ title: `${label} ${part?.[2] ?? entry}`, detail: part?.[2] ?? entry, state: activeThinking ? "running" : "done", id: "", thinking }];
        });
        // Older in-memory turns may predate call markers.
        for (const call of turn.agentCalls ?? []) {
          if (isAgentTool(call.tool ?? call.name) && !isExpanded()) continue;
          const display = agentCallDisplay(call);
          if (!entries.some(entry => entry.id === call.id)) entries.push({ title: `${isAgentTool(call.tool ?? call.name) ? "Control" : call.name} ${display.summary}`, detail: display.detail, state: call.state, id: call.id, thinking: false });
        }
        const agentTurnControls: Array<{ runId: string; y: number; width: number; line: string }> = [];
        const agents = liveAgentView(turn.subAgents ?? [], theme, width, subAgentsExpanded(), true, agentDeadlines, Date.now(), expandedSubagents, agentTurnControls);
        if (entries.length || turn.running || turn.usage || agents.total) {
          const expanded = isExpanded();
          const shown = expanded ? entries : entries.filter(entry => !entry.thinking || entry.state === "running").slice(-5);
          const done = entries.filter(entry => entry.state === "done").length;
          const progressHeader = theme.bold(theme.fg("accent", "Agent")) + (entries.length ? theme.fg("muted", ` · ${done}/${entries.length}`) : "")
            + (agents.total ? theme.bold(theme.fg("accent", "     Subagent")) + theme.fg("muted", ` ${agents.done + agents.errors}/${agents.total}`)
              + (agents.errors ? theme.fg("error", ` · ${agents.errors} failed`) : "") : "");
          const header = progressHeader + theme.fg("muted", showShortcut(turn) ? " · Ctrl+O" : "");
          const usage = addUsage(turn.usage ?? EMPTY_USAGE, turn.pendingUsage);
          const hasUsage = usage.totalTokens > 0 || usage.cacheRead > 0;
          const totals = hasUsage
            ? theme.fg("accent", "S") + theme.fg("muted", ` ${formatTokens(usage.totalTokens)} / `)
              + theme.fg("accent", "C") + theme.fg("muted", ` ${formatTokens(usage.cacheRead)}`)
            : "";
          const totalsWidth = visibleWidth(totals);
          if (hasUsage && showUsage() && width >= totalsWidth + visibleWidth(agents.total ? progressHeader : "Agent") + 1) {
            const left = truncateToWidth(header, width - totalsWidth - 1, "");
            lines.push("", left + " ".repeat(width - visibleWidth(left) - totalsWidth) + totals);
          } else {
            lines.push("", truncateToWidth(header, width));
          }
          if (!shown.length && turn.running && turn.awaitingResponse && !turn.final) lines.push(truncateToWidth(theme.fg("accent", `${agents.rows.length ? "├─" : "└─"} ${runningGlyph()}`) + theme.fg("accent", theme.bold(" Thinking")) + theme.fg("text", "…"), width));
          shown.forEach((entry, row) => {
            const waiting = turn.waitingTools?.find(tool => tool.id === entry.id);
            const title = waiting && !entry.title.startsWith("Control ") ? `${waiting.name} running · waiting ${Math.max(0, Math.floor((Date.now() - waiting.startedAt) / 1000))}s` : entry.title;
            const text = title.split(/\r?\n/).find(line => line.trim())?.replace(/\s+/g, " ").trim() ?? "";
            const split = text.indexOf(" ");
            const label = split < 0 ? text : text.slice(0, split);
            const body = split < 0 ? "" : text.slice(split + 1);
            const summary = theme.fg("accent", theme.bold(label)) + " "
              + (entry.thinking ? markdown(body, Math.max(1, visibleWidth(body) + 1), true).join(" ").replace(/\s+/g, " ").trim()
                : secondaryAccent(theme, body));
            const call = turn.agentCalls?.find(call => call.id === entry.id && !isAgentTool(call.tool ?? call.name));
            const open = !!call && expandedTools.has(call.id);
            if (call && width >= 4) toolControls.push({ id: call.id, y: lines.length, width, title: text });
            if (hoveredTool?.id === entry.id && (hoveredTool.y !== lines.length || hoveredTool.width !== width)) clearHover();
            const status = entry.state === "error" ? "×" : entry.state === "running" ? runningGlyph() : "●";
            const arrow = call && (open || hoveredTool?.id === call.id);
            const glyph = arrow ? (open ? "▾" : "▸") + (entry.state !== "done" ? ` ${status}` : "") : status;
            const last = row === shown.length - 1 && !agents.rows.length;
            lines.push(truncateToWidth(theme.fg("accent", last ? "└─ " : "├─ ") + theme.fg(entry.state === "error" ? "error" : "accent", glyph) + " " + summary, width, call ? "" : "…"));
            if (open && call.id === pinnedToolId) pinnedTool = { id: call.id, y: lines.length - 1, line: lines.at(-1)! };
            if (open) {
              // ponytail: saved text only; native view retains images, args and custom renderers.
              const output = stripVTControlCharacters(call.output ?? "").replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
              const rail = width > 5 ? (last ? "     " : theme.fg("accent", "│    ")) : "";
              const detailWidth = Math.max(1, width - visibleWidth(rail));
              const details = new Text(output || (entry.state === "running" ? "等待工具文本结果…" : "无文本结果"), 0, 0).render(detailWidth);
              lines.push(...details.map(line => truncateToWidth(rail + theme.fg(entry.state === "error" ? "error" : "text", line), width, "")));
            } else if (expanded && entry.state === "error" && entry.detail) {
              const rail = last ? "   " : theme.fg("accent", "│  ");
              const details = entry.detail.split(/\r?\n/).filter(line => line.trim());
              // ponytail: four diagnostic lines; full output remains in the native transcript.
              lines.push(...details.slice(1, 5).map(line => truncateToWidth(rail + theme.fg("error", line), width)));
              if (details.length > 5) lines.push(truncateToWidth(rail + theme.fg("muted", `… +${details.length - 5} lines · /mini-lens-minimal off`), width));
            }
          });
          const agentStartY = lines.length;
          for (const c of agentTurnControls) {
            const control = { ...c, y: agentStartY + c.y };
            subagentControls.push(control);
            if (c.runId === pinnedSubagentId) pinnedSubagent = { id: c.runId, y: control.y, line: c.line };
          }
          lines.push(...agents.rows);
        }
        for (const reply of turn.replies ?? []) lines.push("", ...markdown(reply, width));
        if (turn.final) lines.push("", ...markdown(turn.final, width));
        const noticeRows = notices?.get(index) ?? [];
        noticeRegions.push({ y: lines.length, rows: noticeRows });
        lines.push(...noticeRows);
      }
      if (hoveredTool && !toolControls.some(control => control.id === hoveredTool!.id)) clearHover();
      for (const deadline of agentDeadlines.values()) if (deadline > Date.now()) agentExpiry = Math.min(agentExpiry, deadline);
      return lines;
    },
  };
}

export default function (pi: ExtensionAPI) {
  attachFooterTidy(pi);
  attachTitlePlain(pi);
  let refreshFooter: (() => void) | undefined;
  let refreshMinimal: (() => void) | undefined;
  let processExpanded = false;
  let nativeOutput = false;
  let subAgentsExpanded = false;
  let shortcutTimer: ReturnType<typeof setTimeout> | undefined;
  let waitingTimer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeMinimalInput: (() => void) | undefined;
  let restoreAgentWidgets: (() => void) | undefined;
  let restoreTranscript: (() => void) | undefined;
  let promptView: ReturnType<typeof minimalOutputComponent> | undefined;
  let lastAttachMode: string | undefined;
  let remountQueued = false;
  const agentDeadlines = new Map<string, number>();
  let minimalTurns: MinimalTurn[] = [];
  let activeMinimalTurn: MinimalTurn | undefined;
  let pendingMinimalFinal = "";
  const minimalMessageIndices = new Map<number, number>();
  let speed: number | undefined;
  let mcpCount: number | undefined;
  let activeGeneration: ActiveGeneration | undefined;
  let activeUIPrompt: { kind: string; title?: string } | undefined;
  const toolStarts = new Map<string, number>();
  const minimalToolOutputIndices = new Map<string, number>();
  let speedTimer: ReturnType<typeof setInterval> | undefined;
  let settings: MiniLensSettings = { ...DEFAULT_SETTINGS };
  let saveChain: Promise<void> = Promise.resolve();
  const configPath = settingsPath();

  const refresh = () => refreshFooter?.();
  const refreshMinimalOutput = () => refreshMinimal?.();
  const mountMinimalOutput = (ctx: ExtensionContext) => {
    if (shortcutTimer) clearTimeout(shortcutTimer);
    shortcutTimer = undefined;
    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = undefined;
    unsubscribeMinimalInput?.();
    unsubscribeMinimalInput = undefined;
    restoreTranscript?.();
    restoreTranscript = undefined;
    restoreAgentWidgets?.();
    restoreAgentWidgets = undefined;
    promptView = undefined;
    if (settings["mini-lens-minimal-show"] && ctx.mode === "tui") unsubscribeMinimalInput = ctx.ui.onTerminalInput?.((data) => {
      const nativeKey = matchesKey(data, "ctrl+alt+o");
      const subAgentKey = matchesKey(data, "ctrl+s");
      if (!nativeKey && (!restoreTranscript || (!subAgentKey && !matchesKey(data, "ctrl+o")))) return;
      // Input listeners run before Pi filters Kitty release/repeat events.
      if (isKeyRelease(data) || isKeyRepeat(data)) return { consume: true };
      if (nativeKey) {
        nativeOutput = !nativeOutput;
        mountMinimalOutput(ctx);
      } else if (subAgentKey) subAgentsExpanded = !subAgentsExpanded;
      else processExpanded = !processExpanded;
      refreshMinimalOutput();
      return { consume: true };
    });
    if (nativeOutput || !settings["mini-lens-minimal-show"] || ctx.mode !== "tui") {
      lastAttachMode = undefined;
      ctx.ui.setWidget?.("mini-lens-minimal-output", undefined);
      refreshMinimalOutput();
      refreshMinimal = undefined;
      return;
    }
    ctx.ui.setWidget("mini-lens-minimal-output", (tui, theme) => {
      refreshMinimal = () => tui.requestRender();
      // Retain children under their originating user turn, including while idle,
      // after a follow-up user message, and when rebuilding a saved session.
      const sessionKey = ctx.sessionManager.getSessionFile?.() ?? ctx.sessionManager.getSessionId?.() ?? "";
      let statuses = readAgentStatuses(sessionKey);
      let lastStatusRead = Date.now();
      const supervisorNotices = new Map<string, { notice: any; messages: any[] }>();
      const handledRunIds = new Set<string>();
      const turnsWithAgents = () => {
        const assigned = new Map<number, Record<string, unknown>[]>();
        const claimed = new Set<string>();
        for (const [index, turn] of minimalTurns.entries()) {
          const matched = currentAgentStatuses(statuses, turn.agentCalls ?? []);
          assigned.set(index, matched);
          for (const s of matched) claimed.add(String(s.runId));
        }
        const latestIndex = minimalTurns.length - 1;
        if (latestIndex >= 0) {
          const unclaimed = statuses.filter(s => !claimed.has(String(s.runId)));
          if (unclaimed.length) {
            const current = assigned.get(latestIndex) ?? [];
            assigned.set(latestIndex, [...current, ...unclaimed]);
          }
        }
        handledRunIds.clear();
        return minimalTurns.map((turn, index) => {
          const turnAgents = assigned.get(index) ?? [];
          const withNotices = turnAgents.map(sub => {
            if (sub.runId) handledRunIds.add(String(sub.runId));
            const n = supervisorNotices.get(String(sub.runId));
            return n ? { ...sub, notice: n.notice, noticeMessages: n.messages } : sub;
          });
          return { ...turn, subAgents: withNotices };
        });
      };
      const view = minimalOutputComponent(theme, () => visibleMinimalTurns(settings, turnsWithAgents()), () => processExpanded, turn => settings["mini-lens-agent-shortcut-show"] && Date.now() < (turn.shortcutHintUntil ?? 0), () => settings["mini-lens-agent-usage-show"], () => subAgentsExpanded, agentDeadlines);
      const hintRemaining = (activeMinimalTurn?.shortcutHintUntil ?? 0) - Date.now();
      if (hintRemaining > 0) {
        shortcutTimer = setTimeout(() => tui.requestRender(), hintRemaining);
        shortcutTimer.unref();
      }
      // Native info notifications use dim; warning/error notifications retain
      // their position in the transcript. No plugin names or message matching.
      const dimPrefix = theme.fg("dim", "\u0000").split("\u0000")[0];
      // Transcript hover wrappers must surround the compact widget handlers;
      // unmount in reverse order so neither adapter resurrects stale handlers.
      restoreAgentWidgets = attachAgentWidgets(tui, theme, () => subAgentsExpanded, undefined, true);
      restoreTranscript = attachTranscript(tui, view, {
        supervisor: {
          theme,
          expanded: () => processExpanded,
          handledRunIds: () => handledRunIds,
          onNotices: groups => {
            let changed = false;
            for (const group of groups.values()) {
              const runId = String(group.notice.runId ?? "");
              if (runId) {
                const prev = supervisorNotices.get(runId);
                if (!prev || prev.messages.length !== group.messages.length || prev.notice !== group.notice) {
                  supervisorNotices.set(runId, { notice: group.notice, messages: group.messages });
                  changed = true;
                }
              }
            }
            if (changed) tui.requestRender();
          },
        },
        isPrompt: text => !!activeUIPrompt && (!activeUIPrompt.title || text.includes(activeUIPrompt.title)),
        isTransient: text => !!dimPrefix && text.startsWith(dimPrefix),
      });
      lastAttachMode = typeof tui.mode === "string" ? tui.mode : undefined;
      if (!restoreTranscript) {
        restoreAgentWidgets?.();
        restoreAgentWidgets = undefined;
        ctx.ui.notify(tui.mode === "regular"
          ? "Minimal output needs the fullscreen renderer. Quit and restart Pi — /reload does not switch TUI mode. Or set TUI mode to fullscreen in /settings."
          : "Pi transcript layout not recognized; minimal mode disabled, native output preserved.", "warning");
      }
      if (restoreTranscript) {
        promptView = view;
        waitingTimer = setInterval(() => {
          let changed = false;
          if (Date.now() - lastStatusRead >= 1000) {
            const next = readAgentStatuses(sessionKey, undefined, statuses);
            changed = JSON.stringify(next) !== JSON.stringify(statuses);
            statuses = next;
            lastStatusRead = Date.now();
          }
          if (changed || Date.now() >= view.agentExpiry() || activeMinimalTurn?.running || statuses.some(status => /^(running|active|starting|queued|pending)$/.test(String(status.state)))) tui.requestRender();
        }, 100);
        waitingTimer.unref();
      }
      tui.requestRender();
      // Factory acquires the renderer only; never duplicate content in the dock.
      return { render: () => [], invalidate() {} };
    });
  };
  pi.registerCommand("mini-lens-prompts", {
    description: "Expand or collapse a user prompt in fullscreen minimal output",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !restoreTranscript || !promptView) {
        if (ctx.hasUI) ctx.ui.notify("Prompt folding requires fullscreen minimal output.", "info");
        return;
      }
      const view = promptView;
      const choices = view.promptChoices();
      if (!choices.length) { ctx.ui.notify("No user prompts exceed four lines at this width.", "info"); return; }
      const labels = choices.map(choice => `${choice.index + 1}. ${choice.label} · ${preview(choice.question)}`);
      const selected = await ctx.ui.select("User prompts · Enter to toggle · Esc to cancel", labels);
      const choice = choices[labels.indexOf(selected ?? "")];
      if (choice && promptView === view) {
        view.togglePrompt(choice.index, choice.question);
        refreshMinimalOutput();
      }
    },
  });
  pi.registerCommand("mini-lens-tools", {
    description: "Expand or collapse a tool's saved text in fullscreen minimal output",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !restoreTranscript || !promptView) {
        if (ctx.hasUI) ctx.ui.notify("Tool folding requires fullscreen minimal output.", "info");
        return;
      }
      const view = promptView;
      const choices = view.toolChoices();
      if (!choices.length) { ctx.ui.notify("No visible tool calls. Ctrl+O shows older calls.", "info"); return; }
      const labels = choices.map((choice, index) => `${index + 1}. ${choice.expanded ? "收起" : "展开"} · ${preview(choice.title)}`);
      const selected = await ctx.ui.select("Tool results · Enter to toggle · Esc to cancel", labels);
      const choice = choices[labels.indexOf(selected ?? "")];
      if (choice && promptView === view) {
        view.toggleTool(choice.id);
        refreshMinimalOutput();
      }
    },
  });
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
      .catch(() => ctx.ui.notify(COPY.saveFailed, "error"));
    return saveChain;
  };
  const openSettings = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(COPY.tuiRequired, "error");
      return;
    }
    await ctx.ui.custom((tui, theme, _keybindings, done) => {
      const container = new Container();
      const preview = new Text(settingsPreviewLine(theme, settings), 1, 1);
      const title = new Text(theme.fg("accent", theme.bold(COPY.title)), 1, 1);
      const previewLabel = new Text(theme.fg("muted", COPY.preview), 1, 0);
      container.addChild(title);
      container.addChild(previewLabel);
      container.addChild(preview);
      let items = settingsItems(settings);
      let highlighted: keyof MiniLensSettings | undefined;
      const onChange = (id: string, value: string) => {
        settings = { ...settings, [id]: value === "on", onboardingCompleted: true };
        items = settingsItems(settings);
        applyCollapseState();
        preview.setText(settingsPreviewLine(theme, settings));
        mountMinimalOutput(ctx);
        void persistSettings(ctx);
        refresh();
        refreshMinimalOutput();
      };
      const baseSettingsTheme = getSettingsListTheme();
      const settingsTheme = {
        ...baseSettingsTheme,
        cursor: theme.bg("selectedBg", theme.fg("accent", theme.bold("→ "))),
        label: (text: string, selected: boolean) => {
          const name = text.trimEnd();
          if (selected) highlighted = items.find((item) => item.label === name)?.id as keyof MiniLensSettings | undefined;
          const disabled = name === COPY.minimal && !settings["mini-lens-minimal-show"];
          if (selected) return theme.bg("selectedBg", theme.fg("accent", theme.bold(text)));
          return theme.fg(disabled ? "muted" : "text", text);
        },
        value: (text: string, selected: boolean) =>
          selected ? theme.bg("selectedBg", theme.fg("accent", theme.bold(text))) : theme.fg("muted", text),
      };
      const lensItems = () => settingsItems(settings).filter((item) => item.id !== "mini-lens-minimal-show" && !isCollapsedReplyChildSetting(item.id));
      const minimalItems = () => settingsItems(settings).filter((item) => isCollapsedReplyChildSetting(item.id));
      const collapseItem: SettingItem = {
        id: "mini-lens-minimal-show", label: COPY.enableMinimal, description: COPY.enableMinimalDescription,
        currentValue: settings["mini-lens-minimal-show"] ? "on" : "off", values: ["on", "off"],
      };
      const minimalGroup: SettingItem = { id: "minimal", label: COPY.minimal, currentValue: "›" };
      const applyCollapseState = () => {
        const enabled = settings["mini-lens-minimal-show"];
        collapseItem.currentValue = enabled ? "on" : "off";
        minimalGroup.currentValue = enabled ? "›" : "off";
        minimalGroup.description = enabled ? undefined : COPY.minimalLocked;
        if (enabled) {
          minimalGroup.submenu = (_value, back) => new SettingsList(minimalItems(), 8, settingsTheme, onChange, () => back(), { enableSearch: true });
        } else {
          delete minimalGroup.submenu;
        }
      };
      applyCollapseState();
      const groups: SettingItem[] = [
        { id: "lens", label: COPY.lens, currentValue: "›", submenu: (_value, back) => new SettingsList(lensItems(), 12, settingsTheme, onChange, () => back(), { enableSearch: true }) },
        collapseItem,
        minimalGroup,
      ];
      const settingsList = new SettingsList(groups, 12, settingsTheme, onChange, () => done(undefined), { enableSearch: true });
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
    description: "Configure Lens, collapsed replies, and Minimal output",
    handler: async (_args, ctx) => openSettings(ctx),
  });
  pi.registerCommand("mini-lens-history", {
    description: "View collapsed process entries for a conversation turn",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || minimalTurns.length === 0) return;
      const labels = minimalTurns.map((turn, index) => `${index + 1}. ${preview(turn.question)}`);
      const selected = await ctx.ui.select("Select process entry (keep collapsed view)", labels);
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
              truncateToWidth(theme.fg("accent", `Process ${offset + 1}–${Math.min(offset + 5, snapshot.length)} / ${snapshot.length} · ↑↓ Browse · Esc Close`), width),
              ...page.flatMap((line) => new Markdown(line, 0, 0, minimalMarkdownTheme(getMarkdownTheme()), undefined, { transform: diagramMarkdown }).render(Math.max(1, width))),
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
    description: "Toggle collapsed replies (off keeps Pi's default conversation history)",
    handler: async (args, ctx) => {
      const normalized = args.trim().toLowerCase();
      if (ctx.mode !== "tui") {
        ctx.ui.notify(COPY.minimalRequired, "error");
        return;
      }
      if (normalized && normalized !== "on" && normalized !== "off") {
        ctx.ui.notify(COPY.minimalUsage, "warning");
        return;
      }
      settings = {
        ...settings,
        "mini-lens-minimal-show": normalized === "on" ? true : normalized === "off" ? false : !settings["mini-lens-minimal-show"],
        onboardingCompleted: true,
      };
      if (settings["mini-lens-minimal-show"]) nativeOutput = false;
      mountMinimalOutput(ctx);
      await persistSettings(ctx);
      // The mount already explains unsupported layouts; do not contradict it
      // with a success notification when only the preference was saved.
      if (settings["mini-lens-minimal-show"] && !restoreTranscript) return;
      ctx.ui.notify(`${COPY.minimalState}${settings["mini-lens-minimal-show"] ? "on" : "off"}`, "info");
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
          // switchTuiMode does not re-run setWidget; remount once the live renderer is fullscreen.
          if (settings["mini-lens-minimal-show"] && !nativeOutput && ctx.mode === "tui" && !restoreTranscript
            && tui.mode !== "regular" && lastAttachMode === "regular" && !remountQueued) {
            remountQueued = true;
            queueMicrotask(() => {
              remountQueued = false;
              mountMinimalOutput(ctx);
            });
          }
          return [statusLine(ctx, theme, width, sessionUsage(ctx), settings, speed, undefined, mcpCount)];
        },
      };
    });
    refresh();
    if (!loaded.exists && ctx.mode === "tui" && ctx.hasUI) {
      const choice = await ctx.ui.select(
        `Mini Lens ${COPY.preview}\n\n  deepseek-v4-flash  high  ${COPY.totalLabel} 45K  ${COPY.cachedLabel} 25K  ${COPY.cacheHitLabel} 40.0%  $0.012  500/1.0M  █░░░░░░░░░  1%  120 tok/s\n\n${COPY.onboarding}`,
        [COPY.keepDefaults, COPY.configureNow],
      );
      settings = { ...settings, onboardingCompleted: true };
      try {
        await persistSettings(ctx);
      } catch {
        ctx.ui.notify(`${COPY.saveFailed} (${CONFIG_DIR_NAME})`, "error");
      }
      if (choice === COPY.configureNow) await openSettings(ctx);
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
  pi.on("ui_prompt_start", (event) => {
    activeUIPrompt = event;
    refreshMinimalOutput();
  });
  pi.on("ui_prompt_end", () => {
    activeUIPrompt = undefined;
    refreshMinimalOutput();
  });
  pi.on("model_select", refresh);
  pi.on("thinking_level_select", refresh);
  pi.on("message_start", (event) => {
    if (event.message.role === "user") {
      if (activeMinimalTurn) {
        activeMinimalTurn.final = pendingMinimalFinal;
        activeMinimalTurn.running = false;
        activeMinimalTurn.thinking = undefined;
      }
      const question = contentText(event.message.content) || "[Attachment]";
      processExpanded = false;
      subAgentsExpanded = false;
      activeMinimalTurn = { question, process: [], running: true, awaitingResponse: true, shortcutHintUntil: Date.now() + 6_000 };
      if (shortcutTimer) clearTimeout(shortcutTimer);
      shortcutTimer = setTimeout(() => refreshMinimalOutput(), 6_000);
      shortcutTimer.unref();
      for (const name of skillNames(question)) pushProcess(activeMinimalTurn, "skill", name);
      pendingMinimalFinal = "";
      minimalToolOutputIndices.clear();
      minimalTurns.push(activeMinimalTurn);
      refreshMinimalOutput();
    }
    if (event.message.role !== "assistant") return;
    // Background completions can start a new assistant turn without a user message.
    activeMinimalTurn ??= minimalTurns.at(-1);
    if (activeMinimalTurn) {
      if (activeMinimalTurn.final) (activeMinimalTurn.replies ??= []).push(activeMinimalTurn.final);
      activeMinimalTurn.final = undefined;
      activeMinimalTurn.running = true;
      activeMinimalTurn.awaitingResponse = true;
      activeMinimalTurn.thinking = undefined;
    }
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
      activeMinimalTurn.thinking = undefined;
      if (partial.content.length) activeMinimalTurn.awaitingResponse = false;
      for (const [blockIndex, item] of partial.content.entries()) {
        if (item.type !== "thinking") continue;
        const line = `${item.type === "thinking" ? "thinking" : "output"} ${processText(item.thinking ?? item.text)}`;
        const index = minimalMessageIndices.get(blockIndex);
        if (index === undefined) {
          minimalMessageIndices.set(blockIndex, activeMinimalTurn.process.length);
          activeMinimalTurn.process.push(line);
        } else activeMinimalTurn.process[index] = line;
        if (blockIndex === partial.content.length - 1 && event.assistantMessageEvent.type !== "thinking_end") activeMinimalTurn.thinking = minimalMessageIndices.get(blockIndex);
      }
      activeMinimalTurn.final = contentText(partial.content) || undefined;
      refreshMinimalOutput();
    }
    if (activeMinimalTurn && partial?.usage) {
      activeMinimalTurn.pendingUsage = partial.usage;
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
      if (activeMinimalTurn) {
        activeMinimalTurn.thinking = undefined;
        activeMinimalTurn.awaitingResponse = false;
        activeMinimalTurn.usage = addUsage(activeMinimalTurn.usage ?? EMPTY_USAGE, event.message.usage as UsageLike | undefined);
        activeMinimalTurn.pendingUsage = undefined;
      }
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
          pendingMinimalFinal = [message.stopReason === "aborted" ? "Execution aborted" : "Execution failed", message.errorMessage, pendingMinimalFinal].filter(Boolean).join("\n");
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
      activeMinimalTurn.thinking = undefined;
      activeMinimalTurn.awaitingResponse = false;
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
    if (activeMinimalTurn) activeMinimalTurn.usage = addUsage(activeMinimalTurn.usage ?? EMPTY_USAGE, nestedUsage);
    if (startedAt !== undefined) {
      const nestedSpeed = outputSpeed(nestedUsage?.output, startedAt);
      if (nestedSpeed !== undefined) speed = nestedSpeed;
    }
    const call = activeMinimalTurn?.agentCalls?.find(call => call.id === event.toolCallId);
    if (call) {
      if (activeMinimalTurn) activeMinimalTurn.waitingTools = activeMinimalTurn.waitingTools?.filter(tool => tool.id !== event.toolCallId);
      call.state = event.isError ? "error" : "done";
      call.output = contentText(event.result) || (event.isError ? "Call failed (no text details)" : "Call returned (background task status below)");
      refresh();
      refreshMinimalOutput();
      return;
    }
    if (activeMinimalTurn) {
      activeMinimalTurn.waitingTools = activeMinimalTurn.waitingTools?.filter((tool) => tool.id !== event.toolCallId);
      const text = contentText(event.result) || (event.isError ? "Tool failed (no text details)" : "Tool completed (no text output)");
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
    for (const turn of minimalTurns) { turn.running = false; turn.thinking = undefined; }
    activeMinimalTurn.final = pendingMinimalFinal;
    activeMinimalTurn = undefined;
    pendingMinimalFinal = "";
    minimalToolOutputIndices.clear();
    refreshMinimalOutput();
  });
  pi.on("session_shutdown", () => {
    agentDeadlines.clear();
    promptView = undefined;
    if (shortcutTimer) clearTimeout(shortcutTimer);
    shortcutTimer = undefined;
    unsubscribeMcpStatus();
    refreshFooter = undefined;
    activeGeneration = undefined;
    activeUIPrompt = undefined;
    toolStarts.clear();
    minimalToolOutputIndices.clear();
    refreshMinimal = undefined;
    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = undefined;
    unsubscribeMinimalInput?.();
    unsubscribeMinimalInput = undefined;
    restoreTranscript?.();
    restoreTranscript = undefined;
    restoreAgentWidgets?.();
    restoreAgentWidgets = undefined;
    stopSpeedTimer();
  });
}
