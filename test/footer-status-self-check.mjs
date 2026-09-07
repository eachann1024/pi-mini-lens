import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setTimeout } from "node:timers/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "node:module";

const piModule = `
export const CONFIG_DIR_NAME = ".pi";
export const getMarkdownTheme = () => Object.fromEntries(["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder", "hr", "listBullet", "bold", "italic", "strikethrough", "underline"].map(key => [key, text => text]));
export const getAgentDir = () => process.env.MINI_LENS_AGENT_DIR;
export const getSettingsListTheme = () => ({});
export class Container { addChild() {} render() { return []; } invalidate() {} }
export class Text { constructor() {} }
export {};
`;
const tuiModule = `
export { Markdown, Marked, matchesKey, isKeyRelease, isKeyRepeat } from "${new URL("../node_modules/@earendil-works/pi-tui/dist/index.js", import.meta.url).href}";
export const visibleWidth = (text) => String(text).replace(/\\x1b\\[[0-9;]*m/g, "").length;
export const truncateToWidth = (text, width, suffix = "…") => {
  const plain = String(text).replace(/\\x1b\\[[0-9;]*m/g, "");
  return plain.length <= width ? String(text) : plain.slice(0, Math.max(0, width - suffix.length)) + suffix;
};
export class Container {
  constructor() { this.children = []; }
  addChild(child) { this.children.push(child); }
  render() { return this.children; }
  invalidate() {}
}
export class Text {
  constructor(text) { this.text = text; }
  setText(text) { this.text = text; }
}
export class SettingsList {
  constructor(items, _height, theme, onChange) { this.items = items; this.theme = theme; this.onChange = onChange; }
  handleInput() {}
  render() { this.theme.label(this.items[0].label, true); return []; }
  setValue(id, value) { this.onChange(id, value); }
}
`;
const piUrl = `data:text/javascript,${encodeURIComponent(piModule)}`;
const tuiUrl = `data:text/javascript,${encodeURIComponent(tuiModule)}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){if(s==='@earendil-works/pi-coding-agent')return {shortCircuit:true,url:${JSON.stringify(piUrl)}};if(s==='@earendil-works/pi-tui')return {shortCircuit:true,url:${JSON.stringify(tuiUrl)}};return n(s,c)}`)}`, import.meta.url);

const configDir = await mkdtemp(join(tmpdir(), "mini-lens-test-"));
process.env.MINI_LENS_AGENT_DIR = configDir;
const source = new URL("../extensions/footer-status.ts", import.meta.url);
const extension = await import(pathToFileURL(source.pathname).href + `?${Date.now()}`);

assert.equal(extension.DEFAULT_SETTINGS["mini-lens-minimal-show"], true);
assert.equal(extension.parseSettings({ "mini-lens-minimal-show": false })["mini-lens-minimal-show"], false);
const minimalTheme = { bg: (_token, text) => `\x1b[48;2;20;40;30m${text}\x1b[49m`, fg: (_token, text) => text, bold: (text) => text };
const minimalTurn = { question: "测试问题", process: Array.from({ length: 9 }, (_, i) => `tool entry-${i}`), running: true, final: "secret final" };
const minimalView = extension.minimalOutputComponent(minimalTheme, () => [minimalTurn]);
let minimalText = minimalView.render(100).join("\n");
assert.doesNotMatch(minimalText, /已收起|我们的极简模块|用户提问|最终的结果/);
assert.doesNotMatch(minimalText, /entry-[0-2]/);
assert.equal((minimalText.match(/entry-/g) ?? []).length, 6);
assert.match(minimalText, /Ctrl\+O 展开/);
assert.match(minimalText, /secret final/);
minimalTurn.running = false;
minimalText = minimalView.render(100).join("\n");
assert.match(minimalText, /secret final/);
assert.deepEqual(minimalView.render(0), []);
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
assert.ok(minimalView.render(12).every((line) => stripAnsi(line).length <= 12));
for (const width of [1, 2, 12, 40, 100]) {
  assert.ok(minimalView.render(width).every(line => stripAnsi(line).length <= width));
}
assert.doesNotMatch(minimalView.render(100).find((line) => line.includes("secret final")), /\x1b\[48;/);
const longView = extension.minimalOutputComponent(minimalTheme, () => [{ question: "long question ".repeat(20), process: ["output " + "long output ".repeat(50)], running: true }]);
assert.ok(longView.render(40).every(line => stripAnsi(line).length <= 40));
const mixedTurn = { question: "mixed", process: ["tool one", "call a", "skill frontend", "tool two", "call b", "tool three", "skill last"], agentCalls: [{ id: "a", name: "researcher", task: "research", state: "done" }, { id: "b", name: "reviewer", task: "review", state: "running" }] };
const mixedRows = extension.minimalOutputComponent(minimalTheme, () => [mixedTurn]).render(100);
assert.equal(mixedRows.filter(row => /^[├└]─/.test(row)).length, 6);
assert.doesNotMatch(mixedRows.join("\n"), /较早记录/);
assert.doesNotMatch(mixedRows.join("\n"), /工具 one|Agent 调用/);
assert.ok(mixedRows.findIndex(row => row.includes("researcher")) < mixedRows.findIndex(row => row.includes("Skill frontend")));
const mixedExpanded = extension.minimalOutputComponent(minimalTheme, () => [mixedTurn], () => true).render(100);
assert.equal(mixedExpanded.filter(row => /^[├└]─/.test(row)).length, 7);
const restoredTurns = extension.minimalTurnsFromBranch(Array.from({ length: 7 }, (_, i) => [
  { type: "message", message: { role: "user", content: `question-${i}` } },
  { type: "message", message: { role: "toolResult", content: [{ type: "text", text: "tool output" }] } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: `answer-${i}` }] } },
]).flat());
assert.equal(restoredTurns.length, 7, "process limit must not delete conversation turns");
assert.equal(restoredTurns[6].final, "answer-6");
assert.deepEqual(restoredTurns[6].process, ["output tool output"]);

assert.equal(extension.DEFAULT_SETTINGS["mini-lens-mcp-show"], false, "MCP count defaults to off");
assert.equal(extension.parseSettings({ "mini-lens-mcp-show": "true" })["mini-lens-mcp-show"], false, "invalid MCP setting falls back to off");
assert.equal(extension.DEFAULT_SETTINGS["mini-lens-ch-show"], true, "mini-lens-ch-show defaults to true");
assert.equal(extension.DEFAULT_SETTINGS["mini-lens-session-tokens-show"], true, "session-token display defaults to true");
assert.equal(extension.DEFAULT_SETTINGS["mini-lens-cache-tokens-show"], true, "cache-token display defaults to true");
assert.equal(extension.DEFAULT_SETTINGS["mini-lens-speed-unit-show"], true, "speed-unit display defaults to true");
assert.deepEqual(extension.parseSettings({ "mini-lens-ch-show": false }), {
  ...extension.DEFAULT_SETTINGS,
  "mini-lens-ch-show": false,
}, "partial settings merge with safe defaults");
assert.deepEqual(extension.parseSettings("bad config"), extension.DEFAULT_SETTINGS, "invalid configuration safely falls back to defaults");

const persisted = { ...extension.DEFAULT_SETTINGS, "mini-lens-ch-show": false, "mini-lens-mcp-show": true, onboardingCompleted: true };
const configPath = extension.settingsPath(configDir);
await extension.saveSettings(persisted, configPath);
assert.deepEqual((await extension.loadSettings(configPath)).settings, persisted, "settings persist to Pi's agent directory");
assert.equal(JSON.parse(await readFile(configPath, "utf8"))["mini-lens-ch-show"], false, "persisted JSON retains the documented setting name");
const corruptPath = join(configDir, "corrupt.json");
await writeFile(corruptPath, "{not JSON", "utf8");
assert.deepEqual((await extension.loadSettings(corruptPath)).settings, extension.DEFAULT_SETTINGS, "corrupt configuration files safely fall back to defaults");

const runtimeDir = await mkdtemp(join(tmpdir(), "mini-lens-runtime-"));
process.env.MINI_LENS_AGENT_DIR = runtimeDir;
const handlers = new Map();
const commands = new Map();
const eventEmitter = new EventEmitter();
const events = {
  on(name, handler) { eventEmitter.on(name, handler); return () => eventEmitter.off(name, handler); },
  emit(name, value) { eventEmitter.emit(name, value); },
};
const mcpStatusEvent = "pi-mcp-adapter/status/v1";
const startupSnapshot = { version: 1, servers: [
  { name: "connected", disabled: false, status: "connected" },
  { name: "cached", disabled: false, status: "cached" },
  { name: "failed", status: "failed" },
  { name: "disabled", disabled: true, status: "disabled" },
], connectedCount: 1, totalTools: 99 };
const pi = {
  events,
  on(name, handler) { handlers.set(name, handler); },
  registerCommand(name, command) { commands.set(name, command); },
};
extension.default(pi);
events.emit(mcpStatusEvent, startupSnapshot);

let footerFactory;
let renders = 0;
let usage = { tokens: 0, percent: 0, contextWindow: 1_000_000 };
let branch = [{
  type: "message",
  message: {
    role: "assistant",
    usage: { input: 75_000, output: 10_000, cacheRead: 25_000, cacheWrite: 5_000, totalTokens: 115_000, cost: { total: 0.01234 } },
  },
}];
const ctx = {
  mode: "print",
  hasUI: false,
  model: { provider: "deepseek", id: "deepseek-v4-flash", contextWindow: 1_000_000 },
  thinkingLevel: "high",
  getContextUsage() { return usage; },
  sessionManager: {
    getBranch() {
      return branch;
    },
  },
  ui: { setFooter(factory) { footerFactory = factory; }, notify() {} },
};
await handlers.get("session_start")({}, ctx);
assert.ok(footerFactory, "session_start installs the global footer");
const colors = [];
const colorTexts = [];
const theme = { bg(_color, text) { return text; }, fg(color, text) { colors.push(color); colorTexts.push([color, text]); return text; }, bold(text) { return text; } };
const footer = footerFactory({ requestRender() { renders++; } }, theme, {});

let lines = footer.render(100);
assert.equal(lines.length, 1, "footer always renders one line");
assert.doesNotMatch(footer.render(140)[0], /MCP/, "startup snapshot does not enable MCP display by default");
assert.match(lines[0], /^deepseek-v4-flash  high/, "README example model is displayed generically");
assert.doesNotMatch(lines[0], /deepseek\//, "provider prefix is omitted from the model label");
assert.ok(lines[0].includes("Total 115K"), "footer shows provider-reported cumulative session tokens");
assert.ok(lines[0].includes("Cached 30K"), "footer shows cumulative cache read and write tokens");
assert.match(lines[0], /CH 25\.0%/, "footer shows cumulative cache-hit rate");
assert.ok(lines[0].includes("0/1.0M"), "middle shows used tokens and context total");
assert.match(lines[0], /0%$/, "without a speed sample, context percentage remains rightmost");
assert.doesNotMatch(lines[0], /--|tok\/s/, "without a speed sample, speed is hidden rather than rendered as a placeholder");
assert.match(lines[0], /░░+/, "zero percent renders an entirely empty progress bar");
assert.ok(colors.includes("accent") && colors.includes("borderMuted"), "progress uses semantic theme colors");

usage = { tokens: 50_000, percent: 50, contextWindow: 100_000 };
lines = footer.render(100);
assert.ok(lines[0].includes("50K/100K"), "middle reads token values from getContextUsage");
assert.match(lines[0], /50%$/, "percentage remains rightmost while generation speed is unavailable");
const middleBar = lines[0].match(/[█░]+/)?.[0] ?? "";
assert.ok(middleBar.includes("█") && middleBar.includes("░"), "an intermediate percentage has filled and empty progress cells");

const originalNow = Date.now;
let now = 1_000;
Date.now = () => now;
handlers.get("message_start")({ message: { role: "assistant" } }, ctx);
handlers.get("message_update")({ assistantMessageEvent: { partial: { usage: { output: 10, input: 75_000, cacheRead: 25_000 } } } }, ctx);
now = 2_000;
handlers.get("message_update")({ assistantMessageEvent: { partial: { usage: { output: 50, input: 75_000, cacheRead: 25_000 } } } }, ctx);
now = 3_000;
handlers.get("message_update")({ assistantMessageEvent: { partial: { usage: { output: 70, input: 75_000, cacheRead: 25_000 } } } }, ctx);
now = 3_500;
handlers.get("message_update")({ assistantMessageEvent: { partial: { usage: { output: 60 } } } }, ctx);
now = 2_500;
handlers.get("message_update")({ assistantMessageEvent: { partial: { usage: { output: 100 } } } }, ctx);
now = 3_000;
lines = footer.render(140);
assert.match(lines[0], /35\.0 tok\/s$/, "streaming speed uses all generated tokens divided by elapsed response time and ignores regressing samples");
assert.ok(colorTexts.some(([color, text]) => color === "success" && text === "35.0 tok/s"), "live speed uses semantic threshold colors");
assert.equal(extension.speedColor(30), "success", "fast threshold is success");
assert.equal(extension.speedColor(10), "warning", "medium threshold is warning");
assert.equal(extension.speedColor(9.9), "error", "slow speed is error");
assert.equal(extension.speedColor(undefined), "muted", "missing speed is muted");
handlers.get("message_end")({ message: { role: "assistant", usage: { output: 70, input: 75_000, cacheRead: 25_000 } } }, ctx);
lines = footer.render(140);
assert.match(lines[0], /35\.0 tok\/s$/, "final usage retains the completed response rate");
handlers.get("message_start")({ message: { role: "assistant" } }, ctx);
lines = footer.render(140);
assert.match(lines[0], /35\.0 tok\/s$/, "a tool-call-only or waiting assistant message does not erase the completed rate");
now = 5_000;
handlers.get("tool_execution_start")({ toolCallId: "child" }, ctx);
now = 7_000;
handlers.get("tool_execution_end")({ toolCallId: "child", result: { usage: { output: 80 } } }, ctx);
lines = footer.render(140);
assert.match(lines[0], /40\.0 tok\/s$/, "nested tool or child-agent usage uses its tool execution duration");
branch = [...branch, { type: "message", message: { role: "toolResult", usage: { input: 50_000, output: 80, cacheRead: 10_000, cacheWrite: 0, totalTokens: 60_080, cost: { total: 0.01 } } } }];
const totals = extension.sessionUsage(ctx);
assert.deepEqual(totals, { totalTokens: 175_080, input: 125_000, output: 10_080, cacheRead: 35_000, cacheWrite: 5_000, cost: 0.02234 }, "session totals aggregate finalized assistant and nested tool usage exactly once");
Date.now = originalNow;

const sampleTotals = { totalTokens: 100_000, input: 75_000, output: 10_000, cacheRead: 25_000, cacheWrite: 0, cost: 0.01234 };
assert.equal(extension.DEFAULT_SETTINGS["mini-lens-context-dots-show"], false, "solid bar remains default");
const missingContext = extension.statusLine({ ...ctx, model: undefined, thinkingLevel: undefined, getContextUsage: () => ({ contextWindow: 272_000 }) }, theme, 140, sampleTotals, extension.DEFAULT_SETTINGS, undefined);
assert.doesNotMatch(missingContext, /\?|272K|no model|off|[█░⣿⣀]|tok\/s/, "missing fields hide without placeholders");
assert.match(missingContext, /Total 100K/, "known usage stays visible");
const dotted = { ...extension.DEFAULT_SETTINGS, "mini-lens-context-dots-show": true };
const dottedLine = extension.statusLine(ctx, theme, 140, sampleTotals, dotted, 40);
assert.match(dottedLine, /⣿+⣀+/, "dot-matrix bar renders filled and empty cells");
assert.doesNotMatch(dottedLine, /[█░]/, "dot-matrix mode replaces solid cells");
assert.equal(extension.parseSettings({ "mini-lens-context-dots-show": "bad" })["mini-lens-context-dots-show"], false);
const withMcp = { ...extension.DEFAULT_SETTINGS, "mini-lens-mcp-show": true };
assert.doesNotMatch(extension.statusLine(ctx, theme, 140, sampleTotals, withMcp, 40), /MCP/, "unknown MCP state is hidden and old statusLine calls remain compatible");
assert.match(extension.statusLine(ctx, theme, 140, sampleTotals, withMcp, 40, undefined, 0), /◇ MCP 0/, "a known empty snapshot displays zero");
assert.doesNotMatch(extension.settingsPreviewLine(theme, extension.DEFAULT_SETTINGS), /MCP/, "preview defaults to MCP off");
assert.match(extension.settingsPreviewLine(theme, withMcp), /◇ MCP 3/, "preview provides sample MCP count");
assert.ok(colorTexts.some(([color, text]) => color === "muted" && text === "◇ MCP 3"), "MCP icon and count use semantic monochrome theme color");
for (let width = 0; width <= 140; width++) {
  const line = extension.statusLine(ctx, theme, width, sampleTotals, withMcp, 40, undefined, 123);
  assert.ok(line.length <= width, `MCP-enabled width ${width} never overflows`);
}
const withoutCache = { ...extension.DEFAULT_SETTINGS, "mini-lens-ch-show": false };
const hiddenCacheLine = extension.statusLine(ctx, theme, 140, sampleTotals, withoutCache, 40);
assert.doesNotMatch(hiddenCacheLine, /CH 25\.0%/, "mini-lens-ch-show false immediately hides cache hit");
const withoutSessionTotals = { ...extension.DEFAULT_SETTINGS, "mini-lens-session-tokens-show": false, "mini-lens-cache-tokens-show": false };
const hiddenTotalsLine = extension.statusLine(ctx, theme, 140, sampleTotals, withoutSessionTotals, 40);
assert.doesNotMatch(hiddenTotalsLine, /Total 100K|Cached 25K/, "session-token and cache-token settings independently hide their metrics");
const withoutSpeedUnit = { ...extension.DEFAULT_SETTINGS, "mini-lens-speed-unit-show": false };
const noUnitLine = extension.statusLine(ctx, theme, 140, sampleTotals, withoutSpeedUnit, 40);
assert.match(noUnitLine, /40\.0$/, "speed-unit setting shows only the numeric speed when disabled");
assert.doesNotMatch(noUnitLine, /tok\/s/, "speed-unit setting removes tok/s from the footer");
const hiddenEverything = Object.fromEntries(Object.keys(extension.DEFAULT_SETTINGS).map((id) => [id, false]));
assert.equal(extension.statusLine(ctx, theme, 140, sampleTotals, hiddenEverything, 40), "", "all footer fields can be disabled");

ctx.model = { provider: "openai", id: "gpt-5", contextWindow: 200_000 };
let settingsPanel;
const settingsCtx = {
  ...ctx,
  mode: "tui",
  ui: {
    setWidget() {},
    ...ctx.ui,
    async custom(factory) {
      settingsPanel = factory({ requestRender() {} }, theme, {}, () => {});
    },
  },
};
await commands.get("mini-lens-settings").handler("", settingsCtx);
const settingsChildren = settingsPanel.render(100);
const settingsPreview = settingsChildren[2];
assert.deepEqual(settingsChildren[3].items.map((item) => item.label), ["Lens", "极简输出"]);
const settingsList = settingsChildren[3].items[0].submenu("", () => {});
colors.length = 0;
settingsList.theme.label("Focused option", true);
settingsList.theme.value("off", true);
assert.deepEqual(colors, ["accent", "accent"], "focused label and value use theme accent even when off");
colors.length = 0;
settingsList.theme.label("Normal option", false);
assert.deepEqual(colors, ["text"], "unfocused labels are not highlighted");
assert.match(settingsPreview.text, /deepseek-v4-flash  high  Total 45K  Cached 25K  CH 40\.0%.*500\/1\.0M.*120 tok\/s/, "settings preview uses fixed example data instead of the current session");
assert.doesNotMatch(settingsPreview.text, /25\.0%|50K\/100K|gpt-5/, "settings preview never reads live session values");
assert.equal(settingsList.items.find((item) => item.id === "mini-lens-mcp-show")?.currentValue, "off", "settings expose MCP toggle initially off");
settingsList.setValue("mini-lens-mcp-show", "on");
assert.match(settingsPreview.text, /◇ MCP 3/, "MCP toggle updates example preview immediately");
assert.match(footer.render(140)[0], /◇ MCP 3/, "startup broadcast survives session_start and counts enabled, not connected servers or tools");
let beforeMcpRefresh = renders;
events.emit(mcpStatusEvent, { version: 1, servers: [{ name: "offline", disabled: false, status: "not-connected" }] });
assert.ok(renders > beforeMcpRefresh, "status event requests footer refresh");
assert.match(footer.render(140)[0], /◇ MCP 1/, "later broadcast replaces enabled count");
for (const payload of [null, undefined, false, "bad", [], {}, { version: 2, servers: [] }, { version: 1, servers: {} },
  { version: 1, servers: [null] }, { version: 1, servers: [[]] }, { version: 1, servers: ["bad"] },
  { version: 1, servers: [{ name: 42 }] }, { version: 1, servers: [{ name: "bad", disabled: "false" }] }]) {
  beforeMcpRefresh = renders;
  assert.doesNotThrow(() => events.emit(mcpStatusEvent, payload));
  assert.equal(renders, beforeMcpRefresh, "malformed snapshot does not refresh footer");
  assert.match(footer.render(140)[0], /◇ MCP 1/, "malformed snapshot preserves last valid count");
}
events.emit(mcpStatusEvent, { version: 1, servers: [] });
assert.match(footer.render(140)[0], /◇ MCP 0/, "shutdown/empty snapshot clears previous count");
settingsList.setValue("mini-lens-mcp-show", "off");
assert.doesNotMatch(footer.render(140)[0], /MCP/, "MCP toggle off immediately hides live count");
events.emit(mcpStatusEvent, startupSnapshot);
settingsList.setValue("mini-lens-mcp-show", "on");
assert.match(footer.render(140)[0], /◇ MCP 3/, "events received while hidden remain available when enabled");
settingsList.setValue("mini-lens-cache-tokens-show", "off");
assert.doesNotMatch(settingsPreview.text, /Cached 25K/, "changing the cache-token setting updates the preview immediately");
settingsList.setValue("mini-lens-ch-show", "off");
assert.doesNotMatch(settingsPreview.text, /CH 40\.0%/, "changing the cache-rate setting updates the preview immediately");
settingsList.setValue("mini-lens-speed-unit-show", "off");
assert.match(settingsPreview.text, /120$/, "changing the unit setting updates the preview immediately");
assert.doesNotMatch(settingsPreview.text, /tok\/s/, "disabled speed unit is absent from the updated preview");

for (const width of [40, 20, 8, 3]) {
  lines = footer.render(width);
  assert.equal(lines.length, 1, `width ${width} remains a single-line footer`);
  assert.ok(lines[0].length <= width, `width ${width} never overflows`);
}
for (let attempt = 0; attempt < 100; attempt++) {
  const saved = (await extension.loadSettings(extension.settingsPath(runtimeDir))).settings;
  if (saved["mini-lens-mcp-show"] && !saved["mini-lens-speed-unit-show"]) break;
  await setTimeout(10);
}
const savedRuntime = (await extension.loadSettings(extension.settingsPath(runtimeDir))).settings;
assert.equal(savedRuntime["mini-lens-mcp-show"], true, "settings-panel MCP toggle persists to disk");
assert.equal(savedRuntime["mini-lens-speed-unit-show"], false, "queued settings writes complete in order");
handlers.get("session_shutdown")({}, ctx);
assert.equal(eventEmitter.listenerCount(mcpStatusEvent), 0, "shutdown removes shared bus listener for reload");

// Exercise the real extension event wiring, including no early final and adapter restoration.
const minimalHandlers = new Map();
const minimalCommands = new Map();
extension.default({ events, on(name, handler) { minimalHandlers.set(name, handler); }, registerCommand(name, command) { minimalCommands.set(name, command); } });
const box = (children = []) => ({ children, render: () => [], invalidate() {} });
const doc = box([box(), box(), box()]);
const originalDocRender = doc.render;
let transcriptRenders = 0;
const testTui = { children: [doc, box(), box(), box(), box([{ getText() {}, render: () => [], invalidate() {} }]), box(), box()], requestRender() { transcriptRenders++; } };
let inputListener;
const minimalCtx = { ...ctx, mode: "tui", hasUI: false, sessionManager: { getBranch: () => [] }, ui: { ...ctx.ui, onTerminalInput(handler) { inputListener = handler; return () => { inputListener = undefined; }; }, setWidget(_key, factory) { if (factory) assert.deepEqual(factory(testTui, theme).render(100), [], "dock must remain empty"); } } };
await minimalHandlers.get("session_start")({}, minimalCtx);
await minimalCommands.get("mini-lens-minimal").handler("on", minimalCtx);
minimalHandlers.get("message_start")({ message: { role: "user", content: "live question" } });
minimalHandlers.get("message_start")({ message: { role: "assistant" } });
minimalHandlers.get("message_update")({ assistantMessageEvent: { partial: { content: [{ type: "thinking", thinking: "live thought" }, { type: "text", text: "unreleased final" }] } } });
assert.match(doc.render(100).join("\n"), /live thought/);
minimalHandlers.get("message_update")({ assistantMessageEvent: { partial: { content: [{ type: "thinking", thinking: "live thought updated\nnew paragraph" }, { type: "text", text: "unreleased final" }] } } });
assert.equal(doc.render(100).filter(line => line.includes("Ctrl+O")).length, 1);
assert.match(doc.render(100).join("\n"), /new paragraph/);

assert.match(doc.render(100).join("\n"), /unreleased final/);
minimalHandlers.get("tool_execution_start")({ toolCallId: "waiting", toolName: "bash", args: { command: "curl --max-time 20 https://example.com" } });
for (const partialResult of [{ content: [] }, { content: [{ type: "text", text: "  " }] }]) {
  minimalHandlers.get("tool_execution_update")({ toolCallId: "waiting", partialResult });
}
assert.match(doc.render(100).join("\n"), /正在执行 bash · 已等待 0 秒/);
assert.doesNotMatch(doc.render(100).join("\n"), /"content"/);
const rendersBeforeWaiting = transcriptRenders;
await setTimeout(1100);
assert.ok(transcriptRenders > rendersBeforeWaiting, "waiting status refreshes without tool output");
assert.match(doc.render(100).join("\n"), /已等待 [1-9]\d* 秒/);
minimalHandlers.get("tool_execution_update")({ toolCallId: "waiting", partialResult: { content: [{ type: "text", text: "real output" }] } });
minimalHandlers.get("tool_execution_update")({ toolCallId: "waiting", partialResult: { content: [] } });
assert.match(doc.render(100).join("\n"), /real output/);
assert.doesNotMatch(doc.render(100).join("\n"), /已等待|"content"/);
minimalHandlers.get("tool_execution_end")({ toolCallId: "waiting", result: { content: [] }, isError: true });
assert.match(doc.render(100).join("\n"), /调用失败/);
assert.doesNotMatch(doc.render(100).join("\n"), /已等待|"content"/);
for (let i = 0; i < 8; i++) {
  minimalHandlers.get("tool_execution_start")({ toolCallId: String(i), toolName: "read", args: { path: i === 0 ? "/skills/frontend/SKILL.md" : `file-${i}` } });
  minimalHandlers.get("tool_execution_update")({ toolCallId: String(i), partialResult: { content: [{ type: "text", text: `stream-${i}` }] } });
  minimalHandlers.get("tool_execution_end")({ toolCallId: String(i), result: { content: [{ type: "text", text: `done-${i}` }] } });
}
assert.doesNotMatch(doc.render(100).join("\n"), /done-0|stream-7/);
assert.match(doc.render(100).join("\n"), /done-7/);
minimalHandlers.get("message_end")({ message: { role: "assistant", content: [{ type: "text", text: "unreleased final" }], stopReason: "stop" } });
assert.match(doc.render(100).join("\n"), /unreleased final/);
assert.deepEqual(inputListener("\x1b[111;5:1u"), { consume: true });
assert.match(doc.render(100).join("\n"), /done-0/);
for (const data of ["\x1b[111;5:2u", "\x1b[111;5:3u"]) {
  assert.deepEqual(inputListener(data), { consume: true });
  assert.match(doc.render(100).join("\n"), /done-0/, "repeat/release must preserve expansion");
}
minimalHandlers.get("tool_execution_update")({ toolCallId: "7", partialResult: { content: [{ type: "text", text: "updated while expanded" }] } });
assert.match(doc.render(100).join("\n"), /done-0/, "stream updates preserve expansion");
assert.deepEqual(inputListener("\x0f"), { consume: true });
assert.doesNotMatch(doc.render(100).join("\n"), /done-0/);
minimalHandlers.get("tool_execution_start")({ toolCallId: "agent-1", toolName: "subagent", args: { agent: "reviewer", task: "private long task details" } });
assert.match(doc.render(100).join("\n"), /调用与过程/);
assert.doesNotMatch(doc.render(100).join("\n"), /private long task details/);
minimalHandlers.get("tool_execution_update")({ toolCallId: "agent-1", partialResult: { content: [] } });
minimalHandlers.get("tool_execution_end")({ toolCallId: "agent-1", result: { content: [{ type: "text", text: "Background launched" }] } });
assert.match(doc.render(100).join("\n"), /已完成/);
inputListener("\x0f");
assert.match(doc.render(100).join("\n"), /private long task details/);
assert.match(doc.render(100).join("\n"), /Background launched/);
inputListener("\x0f");
minimalHandlers.get("agent_settled")({});
assert.match(doc.render(100).join("\n"), /unreleased final/);
await minimalCommands.get("mini-lens-minimal").handler("off", minimalCtx);
assert.equal(doc.render, originalDocRender);
assert.equal(inputListener, undefined);
minimalHandlers.get("session_shutdown")({}, minimalCtx);

// A first interactive run previews enabled defaults, offers two explicit choices, and persists Keep defaults.
const onboardingDir = await mkdtemp(join(tmpdir(), "mini-lens-onboarding-"));
process.env.MINI_LENS_AGENT_DIR = onboardingDir;
const onboardingExtension = await import(pathToFileURL(source.pathname).href + `?onboarding=${Date.now()}`);
const onboardingHandlers = new Map();
onboardingExtension.default({ events, on(name, handler) { onboardingHandlers.set(name, handler); }, registerCommand() {} });
const previews = [];
let customCalls = 0;
const onboardingCtx = {
  ...ctx,
  mode: "tui",
  hasUI: true,
  ui: {
    setWidget() {},
    setFooter() {},
    notify() {},
    async select(title, choices) { previews.push([title, choices]); return "Keep defaults"; },
    async custom() { customCalls++; },
  },
};
await onboardingHandlers.get("session_start")({}, onboardingCtx);
assert.deepEqual(previews[0]?.[1], ["Keep defaults", "Configure now"], "onboarding offers explicit default and configure paths");
assert.match(previews[0]?.[0] ?? "", /Total 45K  Cached 25K  CH 40\.0%.*500\/1\.0M.*120 tok\/s/, "onboarding preview has realistic session, cache, context, and speed data");
assert.match(previews[0]?.[0] ?? "", /MCP count and dot-matrix style are off by default/, "onboarding describes opt-in fields accurately");
assert.equal(customCalls, 0, "Keep defaults does not force a settings dialog");
const savedDefaults = (await onboardingExtension.loadSettings(onboardingExtension.settingsPath(onboardingDir))).settings;
assert.deepEqual(savedDefaults, { ...onboardingExtension.DEFAULT_SETTINGS, onboardingCompleted: true }, "Keep defaults persists every enabled field and completes onboarding");

const configureDir = await mkdtemp(join(tmpdir(), "mini-lens-configure-"));
process.env.MINI_LENS_AGENT_DIR = configureDir;
const configureHandlers = new Map();
onboardingExtension.default({ events, on(name, handler) { configureHandlers.set(name, handler); }, registerCommand() {} });
await configureHandlers.get("session_start")({}, { ...onboardingCtx, ui: { ...onboardingCtx.ui, async select() { return "Configure now"; } } });
assert.equal(customCalls, 1, "Configure now opens the settings list after showing the preview");

await rm(configDir, { recursive: true, force: true });
await rm(runtimeDir, { recursive: true, force: true });
await rm(onboardingDir, { recursive: true, force: true });
await rm(configureDir, { recursive: true, force: true });
delete process.env.MINI_LENS_AGENT_DIR;
console.log("footer-status self-check ok");
