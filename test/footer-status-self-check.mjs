import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setTimeout } from "node:timers/promises";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
export { Markdown, Marked, matchesKey, isKeyRelease, isKeyRepeat, sliceByColumn, ScrollView, VStack } from "${new URL("../node_modules/@earendil-works/pi-tui/dist/index.js", import.meta.url).href}";
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
process.env.LANG = "en_US.UTF-8";
const source = new URL("../extensions/footer-status.ts", import.meta.url);
const extension = await import(pathToFileURL(source.pathname).href + `?${Date.now()}`);

assert.equal(extension.DEFAULT_SETTINGS["mini-lens-minimal-show"], false);
assert.equal(extension.parseSettings({})["mini-lens-minimal-show"], false, "missing collapsed-replies setting keeps Pi native history");
assert.equal(extension.parseSettings({ "mini-lens-minimal-show": false })["mini-lens-minimal-show"], false);
assert.equal(extension.parseSettings({ "mini-lens-minimal-show": true })["mini-lens-minimal-show"], true);
assert.equal(extension.settingsItems(extension.DEFAULT_SETTINGS).find((item) => item.id === "mini-lens-minimal-show")?.label, "Collapse replies");
assert.equal(extension.settingsItems(extension.DEFAULT_SETTINGS).find((item) => item.id === "mini-lens-minimal-show")?.description, "Off keeps Pi's default conversation history.");
assert.equal(extension.settingsItems(extension.DEFAULT_SETTINGS).find((item) => item.id === "mini-lens-minimal-show")?.currentValue, "off");
assert.equal("mini-lens-language" in extension.parseSettings({ "mini-lens-language": "zh" }), false);
for (const key of ['mini-lens-agent-usage-show', 'mini-lens-agent-shortcut-show']) {
  assert.equal(extension.DEFAULT_SETTINGS[key], true);
  assert.equal(extension.parseSettings({ [key]: false })[key], false);
}
const minimalTheme = { bg: (_token, text) => `\x1b[48;2;20;40;30m${text}\x1b[49m`, fg: (_token, text) => text, bold: (text) => text };
const minimalTurn = { question: "测试问题", process: Array.from({ length: 9 }, (_, i) => `tool entry-${i}`), running: true, final: "secret final" };
const minimalView = extension.minimalOutputComponent(minimalTheme, () => [minimalTurn]);
let minimalText = minimalView.render(100).join("\n");
assert.doesNotMatch(minimalText, /已收起|我们的极简模块|用户提问|最终的结果/);
assert.doesNotMatch(minimalText, /entry-[0-2]/);
assert.equal((minimalText.match(/entry-/g) ?? []).length, 5);
assert.match(minimalText, /Agent · 9\/9 · Ctrl\+O/);
assert.doesNotMatch(minimalText, /展开|收起/);
assert.match(minimalText, /secret final/);
minimalTurn.running = false;
minimalText = minimalView.render(100).join("\n");
assert.match(minimalText, /secret final/);
let hintVisible = true;
const hintView = extension.minimalOutputComponent(minimalTheme, () => [minimalTurn], () => false, () => hintVisible);
assert.match(hintView.render(100).join("\n"), /9\/9 · Ctrl\+O/);
hintVisible = false;
assert.doesNotMatch(hintView.render(100).join("\n"), /Ctrl\+O/);
assert.match(hintView.render(100).join("\n"), /Agent · 9\/9/);
assert.deepEqual(minimalView.render(0), []);
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
assert.ok(minimalView.render(12).every((line) => stripAnsi(line).length <= 12));
for (const width of [1, 2, 12, 40, 100]) {
  assert.ok(minimalView.render(width).every(line => stripAnsi(line).length <= width));
}
assert.doesNotMatch(minimalView.render(100).find((line) => line.includes("secret final")), /\x1b\[48;/);
const longView = extension.minimalOutputComponent(minimalTheme, () => [{ question: "long question ".repeat(20), process: ["output " + "long output ".repeat(50)], running: true }]);
assert.ok(longView.render(40).every(line => stripAnsi(line).length <= 40));
for (const accent of ["\x1b[34m", "\x1b[35m"]) {
  const theme = { ...minimalTheme, fg: (token, text) => token === "accent" ? `${accent}${text}\x1b[39m` : text };
  for (const [state, glyph] of [["running", "⠋"], ["done", "●"], ["error", "×"]]) {
    const turn = { question: "status", process: ["call status"], agentCalls: [{ id: "status", name: "bash", task: "check", state }] };
    const view = extension.minimalOutputComponent(theme, () => [turn]);
    const rendered = view.render(100).join("\n");
    if (state === "running") assert.match(stripAnsi(rendered), /└─ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    else assert.match(stripAnsi(rendered), new RegExp(`└─ ${glyph}`));
    assert.ok(view.render(12).every(line => stripAnsi(line).length <= 12));
  }
  const thinking = extension.minimalOutputComponent(theme, () => [{ question: "status", process: [], running: true, awaitingResponse: true }]);
  const thinkingText = stripAnsi(thinking.render(100).join("\n"));
  assert.match(thinkingText, /└─ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Thinking/);
  assert.match(thinkingText, /Agent/);
  assert.doesNotMatch(thinkingText, /0\/0|S 0 \/ C 0/);
  for (const expanded of [false, true]) {
  const view = extension.minimalOutputComponent(theme, () => [{ question: 'CORS', process: ['thinking Clarifying CORS behavior'], running: false }], () => expanded);
  const text = stripAnsi(view.render(100).join('\n'));
  assert.match(text, /Agent · 1\/1/, 'collapse does not change process totals');
  assert.equal(text.includes('Thinking 0:00 Clarifying CORS behavior'), expanded);
}
const settled = extension.minimalOutputComponent(theme, () => [{ question: 'settled', process: [], usage: { totalTokens: 10 }, running: false }]);
  const settledText = stripAnsi(settled.render(100).join('\n'));
  assert.doesNotMatch(settledText, /Thinking|0\/0/);
  assert.match(settledText, /S 10 \/ C 0/);
}
assert.equal(extension.formatElapsed(0, 0), "0:00");
assert.equal(extension.formatElapsed(0, 3_723_000), "1:02:03");
const elapsedColors = [];
const elapsedTheme = { ...minimalTheme, fg: (token, text) => { elapsedColors.push([token, text]); return text; } };
const savedElapsedNow = Date.now;
try {
  const thought = "The thinking body scrolls through later Unicode 内容 instead of staying at the beginning";
  const elapsedView = extension.minimalOutputComponent(elapsedTheme, () => [{ question: "elapsed", process: [`thinking ${thought}`], running: true, startedAt: 0, thinking: 0 }]);
  Date.now = () => 0;
  const scrollStart = stripAnsi(elapsedView.render(46).find(line => line.includes("Thinking")));
  Date.now = () => 560;
  const fastScroll = stripAnsi(elapsedView.render(46).find(line => line.includes("Thinking")));
  assert.notEqual(fastScroll, scrollStart, "80ms scrolling advances the overflowing body within 560ms (over three times the former 250ms pace)");
  Date.now = () => 2_000;
  const first = stripAnsi(elapsedView.render(46).find(line => line.includes("Thinking")));
  Date.now = () => 4_000;
  const later = stripAnsi(elapsedView.render(46).find(line => line.includes("Thinking")));
  assert.match(first, /Thinking 0:02/, "elapsed duration follows Thinking before its body");
  assert.match(later, /Thinking 0:04/, "elapsed duration advances without resetting during the turn");
  assert.notEqual(first, later, "long active thinking body horizontally scrolls while its prefix remains fixed");
  assert.ok(elapsedColors.some(([token, text]) => token === "success" && text === " 0:02"), "running elapsed duration uses the semantic green success color");
  const completedThought = extension.minimalOutputComponent(elapsedTheme, () => [{ question: "elapsed", process: [`thinking ${thought}`], running: false, startedAt: 0 }], () => true);
  assert.match(stripAnsi(completedThought.render(100).join("\n")), /Thinking 0:04/, "completed Thinking retains its final elapsed duration when expanded");
  assert.ok(elapsedColors.some(([token, text]) => token === "muted" && text === " 0:04"), "completed Thinking duration uses the semantic gray muted color");
  assert.ok(elapsedView.render(12).every(line => stripAnsi(line).length <= 12), "narrow rows retain the width contract");
} finally { Date.now = savedElapsedNow; }
const dotTheme = { ...minimalTheme, fg: (token, text) => `<${token}>${text}</${token}>` };
const dotRows = extension.minimalOutputComponent(dotTheme, () => [{
  question: "dot colors",
  process: ["call expandable", "output passive"],
  agentCalls: [{ id: "expandable", name: "read", task: "path", state: "done" }],
}]).render(100).join("\n");
assert.match(dotRows, /<accent>●<\/accent>.*read/, "expandable tool dot uses the accent token");
assert.match(dotRows, /<muted>●<\/muted>.*Output/, "non-expandable output dot uses the muted token");
const mixedTurn = { question: "mixed", process: ["tool one", "call a", "skill frontend", "tool two", "call b", "tool three", "skill last"], agentCalls: [{ id: "a", name: "researcher", task: "research", state: "done" }, { id: "b", name: "reviewer", task: "review", state: "running" }] };
const mixedRows = extension.minimalOutputComponent(minimalTheme, () => [mixedTurn]).render(100);
assert.equal(mixedRows.filter(row => /^[├└]─/.test(row)).length, 5);
assert.doesNotMatch(mixedRows.join("\n"), /S 0 \/ C 0/);
assert.doesNotMatch(mixedRows.join("\n"), /较早记录/);
assert.doesNotMatch(mixedRows.join("\n"), /工具 one|Agent 调用/);
assert.ok(mixedRows.findIndex(row => row.includes("researcher")) < mixedRows.findIndex(row => row.includes("Skill last")));
const mixedExpanded = extension.minimalOutputComponent(minimalTheme, () => [mixedTurn], () => true).render(100);
assert.equal(mixedExpanded.filter(row => /^[├└]─/.test(row)).length, 7);
const integratedTurn = { question: 'Integrated', process: Array.from({ length: 8 }, (_, i) => `output MAIN_${i}`),
  running: false, final: 'FINAL_REPLY', usage: { totalTokens: 320000, cacheRead: 246000 },
  subAgents: [{ runId: 'workflow', steps: Array.from({ length: 9 }, (_, i) => ({
    runId: `child-${i}`, agent: 'worker', label: `CHILD_${i}`, model: 'gpt-5', recentOutput: [`CHILD_${i}`], status: i < 4 ? 'completed' : 'running',
  })) }],
};
let expandIntegrated = false;
const integratedView = extension.minimalOutputComponent(minimalTheme, () => [integratedTurn], () => false, () => false, () => true, () => expandIntegrated);
let integratedRows = integratedView.render(120).map(stripAnsi);
assert.match(integratedRows.find(row => row.startsWith('Agent')), /Agent · 8\/8\s+Subagent 4\/9\s+S 320K \/ C 246K$/);
assert.equal(integratedRows.filter(row => /^[├└]─/.test(row)).length, 14, 'five main entries plus live and briefly completed children');
assert.doesNotMatch(integratedRows.join('\n'), /MAIN_[0-2]|运行中|Ctrl\+S/);
assert.ok(integratedRows.findIndex(row => row.includes('MAIN_7')) < integratedRows.findIndex(row => row.includes('CHILD_4')));
assert.ok(integratedRows.findIndex(row => row.includes('CHILD_8')) < integratedRows.findIndex(row => row.includes('FINAL_REPLY')));
assert.match(integratedRows.find(row => row.includes('MAIN_7')), /^├─/);
assert.match(integratedRows.find(row => row.includes('CHILD_8')), /^└─/);
for (const width of [1, 12, 40]) assert.ok(integratedView.render(width).every(row => stripAnsi(row).length <= width));
assert.match(integratedView.render(40).map(stripAnsi).join('\n'), /Subagent 4\/9/, 'narrow headers prioritize progress over token totals');
for (let i = 9; i < 40; i++) integratedTurn.subAgents[0].steps.push({ runId: `child-${i}`, agent: 'worker', label: `CHILD_${i}`, recentOutput: [`CHILD_${i}`], status: 'running' });
assert.equal(integratedView.render(120).filter(row => /^[├└]─/.test(row)).length, 45, 'children are not subject to the main five-row cap');
for (const child of integratedTurn.subAgents[0].steps) child.status = 'completed';
integratedRows = integratedView.render(120).map(stripAnsi);
assert.match(integratedRows.join('\n'), /Subagent 40\/40/);
assert.match(integratedRows.join('\n'), /CHILD_/);
assert.match(integratedRows.find(row => row.includes('MAIN_7')), /^├─/);
expandIntegrated = true;
assert.equal(integratedView.render(120).filter(row => /^[├└]─/.test(row)).length, 45, 'Ctrl+S does not change the terminal grace period');
const savedNow = Date.now;
try {
  Date.now = () => savedNow() + 60_000;
  assert.match(integratedView.render(120).join('\n'), /Subagent|CHILD_/);
  assert.match(integratedView.render(120).join('\n'), /FINAL_REPLY|S 320K/);
} finally { Date.now = savedNow; }
const controlCall = { id: 'control', name: 'worker', tool: 'subagent', action: 'list', task: '', state: 'done', output: 'Executable agents (capabilities):\nRAW_DIAGNOSTIC' };
const controlTurn = { question: '', process: ['call control'], agentCalls: [controlCall] };
assert.doesNotMatch(extension.minimalOutputComponent(minimalTheme, () => [controlTurn]).render(100).join('\n'), /subagent|Executable agents|worker/);
assert.match(extension.minimalOutputComponent(minimalTheme, () => [controlTurn], () => true).render(100).join('\n'), /Control subagent · list · returned/);
assert.equal(controlCall.output, 'Executable agents (capabilities):\nRAW_DIAGNOSTIC');
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
const emptyUsage = { totalTokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const initialLine = extension.statusLine({ ...ctx, getContextUsage: () => ({ tokens: 0, contextWindow: 272_000, percent: 0 }) }, theme, 140, emptyUsage, extension.DEFAULT_SETTINGS, undefined);
assert.doesNotMatch(initialLine, /Total 0|Cached 0/, "zero-value usage metrics stay hidden until usage exists");
assert.match(initialLine, /0\/272K/, "context remains visible before usage exists");
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
const hiddenEverything = extension.parseSettings(Object.fromEntries(Object.keys(extension.DEFAULT_SETTINGS).map((id) => [id, false])));
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
assert.deepEqual(settingsChildren[3].items.map((item) => item.label), ["Lens", "Collapse replies", "Minimal output"]);
assert.equal(settingsChildren[3].items[1].currentValue, "off");
assert.deepEqual(settingsChildren[3].items[1].values, ["on", "off"]);
assert.equal(settingsChildren[3].items[2].submenu, undefined, "Minimal output stays disabled while Collapse replies is off");
assert.equal(settingsChildren[3].items[2].currentValue, "off");
assert.match(settingsChildren[3].items[2].description ?? "", /Turn on Collapse replies/);
settingsChildren[3].setValue("mini-lens-minimal-show", "on");
assert.equal(settingsChildren[3].items[1].currentValue, "on");
assert.equal(typeof settingsChildren[3].items[2].submenu, "function", "Minimal output unlocks after Collapse replies is on");
assert.equal(settingsChildren[3].items[2].currentValue, "›");
const collapsedChildren = settingsChildren[3].items[2].submenu("", () => {});
assert.deepEqual(collapsedChildren.items.map((item) => item.id), [
  "mini-lens-minimal-thinking-show", "mini-lens-minimal-tools-show", "mini-lens-minimal-output-show",
  "mini-lens-minimal-skills-show", "mini-lens-agent-usage-show", "mini-lens-agent-shortcut-show",
]);
assert.ok(!collapsedChildren.items.some((item) => item.id === "mini-lens-minimal-show"), "the switch stays out of the Minimal output group");
settingsChildren[3].setValue("mini-lens-minimal-show", "off");
assert.equal(settingsChildren[3].items[2].submenu, undefined, "turning the switch off disables Minimal output again");
const settingsList = settingsChildren[3].items[0].submenu("", () => {});
assert.ok(!settingsList.items.some((item) => item.id === "mini-lens-minimal-show" || extension.isCollapsedReplyChildSetting(item.id)), "Lens stays separate from collapsed-reply options");
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
assert.equal("mini-lens-language" in savedRuntime, false, "legacy language setting is not persisted");
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
assert.equal(doc.render, originalDocRender, "collapsed replies off keeps Pi's default conversation history");
assert.equal(inputListener, undefined, "native history does not install collapsed-reply shortcuts");
await minimalCommands.get("mini-lens-minimal").handler("on", minimalCtx);
assert.deepEqual(inputListener('\x1b[111;7u'), { consume: true });
assert.equal(doc.render, originalDocRender, 'Ctrl+Option+O restores native transcript');
assert.equal(inputListener('\x0f'), undefined, 'native Ctrl+O passes through');
for (const data of ['\x1b[111;7:2u', '\x1b[111;7:3u']) {
  assert.deepEqual(inputListener(data), { consume: true });
  assert.equal(doc.render, originalDocRender, 'repeat/release keeps native view');
}
assert.deepEqual(inputListener('\x1b[111;7u'), { consume: true });
assert.notEqual(doc.render, originalDocRender, 'Ctrl+Option+O returns to minimal transcript');
minimalHandlers.get("message_start")({ message: { role: "user", content: "live question" } });
minimalHandlers.get("message_start")({ message: { role: "assistant" } });
minimalHandlers.get("message_update")({ assistantMessageEvent: { partial: { content: [{ type: "thinking", thinking: "live thought" }, { type: "text", text: "unreleased final" }] } } });
testTui.children[3].children.push({ render: () => ['Async agents', '● worker · running', 'task: independent details'], invalidate() {} });
const processBeforeSubToggle = doc.render(100);
assert.deepEqual(testTui.children[3].render(100), [], 'native subagent dock is suppressed');
const collapsedAgentRows = testTui.children[3].render(100).length;
assert.deepEqual(inputListener("\x13"), { consume: true });
assert.equal(testTui.children[3].render(100).length, collapsedAgentRows, 'Ctrl+S keeps each child on one row');
assert.deepEqual(testTui.children[3].render(100), []);
const withoutAnimation = rows => rows.map(row => row.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '●'));
assert.deepEqual(withoutAnimation(doc.render(100)), withoutAnimation(processBeforeSubToggle), 'Ctrl+S leaves the main process unchanged apart from animation');
for (const data of ["\x1b[115;5:2u", "\x1b[115;5:3u"]) {
  assert.deepEqual(inputListener(data), { consume: true });
  assert.deepEqual(testTui.children[3].render(100), []);
}
inputListener("\x13");
assert.equal(testTui.children[3].render(100).length, collapsedAgentRows);
assert.doesNotMatch(doc.render(100).join("\n"), /Thinking|live thought/, "text streaming ends live thinking");
minimalHandlers.get("message_update")({ assistantMessageEvent: { partial: { content: [{ type: "thinking", thinking: "live thought updated\nnew paragraph" }, { type: "text", text: "unreleased final" }] } } });
assert.equal(doc.render(100).filter(line => line.includes("Ctrl+O")).length, 1);
assert.doesNotMatch(doc.render(100).join("\n"), /new paragraph/);

assert.match(doc.render(100).join("\n"), /unreleased final/);
minimalHandlers.get("tool_execution_start")({ toolCallId: "waiting", toolName: "bash", args: { command: "curl --max-time 20 https://example.com" } });
for (const partialResult of [{ content: [] }, { content: [{ type: "text", text: "  " }] }]) {
  minimalHandlers.get("tool_execution_update")({ toolCallId: "waiting", partialResult });
}
assert.match(doc.render(100).join("\n"), /bash.*running · waiting 0s/);
assert.doesNotMatch(doc.render(100).join("\n"), /"content"/);
const rendersBeforeWaiting = transcriptRenders;
await setTimeout(1100);
assert.ok(transcriptRenders > rendersBeforeWaiting, "waiting status refreshes without tool output");
assert.match(doc.render(100).join("\n"), /waiting [1-9]\d*s/);
minimalHandlers.get("tool_execution_update")({ toolCallId: "waiting", partialResult: { content: [{ type: "text", text: "real output" }] } });
minimalHandlers.get("tool_execution_update")({ toolCallId: "waiting", partialResult: { content: [] } });
assert.match(doc.render(100).join("\n"), /curl --max-time/);
assert.doesNotMatch(doc.render(100).join("\n"), /已等待|"content"/);
minimalHandlers.get("tool_execution_end")({ toolCallId: "waiting", result: { content: [] }, isError: true });
assert.match(doc.render(100).join("\n"), /Call failed/);
assert.doesNotMatch(doc.render(100).join("\n"), /已等待|"content"/);
for (let i = 0; i < 8; i++) {
  minimalHandlers.get("tool_execution_start")({ toolCallId: String(i), toolName: "read", args: { path: i === 0 ? "/skills/frontend/SKILL.md" : `file-${i}` } });
  minimalHandlers.get("tool_execution_update")({ toolCallId: String(i), partialResult: { content: [{ type: "text", text: `stream-${i}` }] } });
  minimalHandlers.get("tool_execution_end")({ toolCallId: String(i), result: { content: [{ type: "text", text: `done-${i}` }] } });
}
assert.doesNotMatch(doc.render(100).join("\n"), /done-0|stream-7/);
assert.match(doc.render(100).join("\n"), /file-7/);
minimalHandlers.get("message_end")({ message: { role: "assistant", content: [{ type: "text", text: "unreleased final" }], stopReason: "stop" } });
assert.match(doc.render(100).join("\n"), /unreleased final/);
assert.deepEqual(inputListener("\x1b[111;5:1u"), { consume: true });
assert.match(doc.render(100).join("\n"), /\/skills\/frontend\/SKILL.md/);
for (const data of ["\x1b[111;5:2u", "\x1b[111;5:3u"]) {
  assert.deepEqual(inputListener(data), { consume: true });
  assert.match(doc.render(100).join("\n"), /\/skills\/frontend\/SKILL.md/, "repeat/release must preserve expansion");
}
minimalHandlers.get("tool_execution_update")({ toolCallId: "7", partialResult: { content: [{ type: "text", text: "updated while expanded" }] } });
assert.match(doc.render(100).join("\n"), /\/skills\/frontend\/SKILL.md/, "stream updates preserve expansion");
assert.deepEqual(inputListener("\x0f"), { consume: true });
assert.doesNotMatch(doc.render(100).join("\n"), /done-0/);
minimalHandlers.get("tool_execution_start")({ toolCallId: "agent-1", toolName: "subagent", args: { agent: "reviewer", task: "private long task details" } });
assert.match(doc.render(100).join("\n"), /Agent ·/);
assert.doesNotMatch(doc.render(100).join("\n"), /private long task details/);
minimalHandlers.get("tool_execution_update")({ toolCallId: "agent-1", partialResult: { content: [] } });
minimalHandlers.get("tool_execution_end")({ toolCallId: "agent-1", result: { content: [{ type: "text", text: "Background launched" }] } });
assert.match(doc.render(100).join("\n"), /Agent · \d+\/\d+ · Ctrl\+O/);
inputListener("\x0f");
assert.doesNotMatch(doc.render(100).join("\n"), /private long task details/);
assert.match(doc.render(100).join("\n"), /Control subagent · dispatch · returned/);
inputListener("\x0f");
minimalHandlers.get("agent_settled")({});
assert.match(doc.render(100).join("\n"), /unreleased final/);
assert.doesNotMatch(doc.render(100).join("\n"), /Thinking/);
// Async completion resumes the same user conversation without another user message.
minimalHandlers.get("message_start")({ message: { role: "custom", customType: "subagent-result", content: "child returned" } });
minimalHandlers.get("message_start")({ message: { role: "assistant" } });
minimalHandlers.get("message_update")({ assistantMessageEvent: { partial: { content: [{ type: "thinking", thinking: "Review returned result" }] } } });
assert.match(doc.render(100).join("\n"), /Thinking \d+:\d\d Review returned result/);
minimalHandlers.get("message_update")({ assistantMessageEvent: { partial: { content: [{ type: "thinking", thinking: "Review returned result" }, { type: "text", text: "Follow-up answer" }] } } });
assert.doesNotMatch(doc.render(100).join("\n"), /Thinking/);
assert.match(doc.render(100).join("\n"), /unreleased final[\s\S]*Follow-up answer/);
minimalHandlers.get("message_end")({ message: { role: "assistant", content: [{ type: "text", text: "Follow-up answer" }], stopReason: "stop" } });
minimalHandlers.get("agent_settled")({});
assert.match(doc.render(100).join("\n"), /Follow-up answer/);
minimalHandlers.get("message_start")({ message: { role: "assistant" } });
minimalHandlers.get("message_end")({ message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Follow-up failure" } });
minimalHandlers.get("agent_settled")({});
assert.match(doc.render(100).join("\n"), /Follow-up answer[\s\S]*Follow-up failure/);
assert.doesNotMatch(doc.render(100).join("\n"), /Thinking/);
const statusRoot = await mkdtemp(join(tmpdir(), "mini-live-status-"));
const statusDirectory = join(statusRoot, "async-subagent-runs", "child");
await mkdir(statusDirectory, { recursive: true });
await writeFile(join(statusDirectory, "status.json"), JSON.stringify({ sessionId: "current-session", toolCallId: "agent-1", runId: "child", mode: "single", state: "running", steps: [{ agent: "reviewer", model: "9router/low", status: "running", recentOutput: ["child detail", "child summary"] }] }));
const previousStatusRoot = process.env.PI_SUBAGENTS_TEMP_ROOT;
process.env.PI_SUBAGENTS_TEMP_ROOT = statusRoot;
minimalCtx.sessionManager.getSessionFile = () => "current-session";
await minimalCommands.get("mini-lens-minimal").handler("on", minimalCtx);
assert.match(doc.render(100).join("\n"), /Subagent 0\/1[\s\S]*child summary[\s\S]*Follow-up answer/, "settled parent keeps children before its replies");
assert.deepEqual(testTui.children[3].render(100), [], 'nothing is rendered in the dock');
assert.doesNotMatch(doc.render(100).join("\n"), /child detail/);
inputListener("\x13");
assert.match(doc.render(100).join("\n"), /child detail/, "Ctrl+S reveals retained child detail");
minimalHandlers.get("message_start")({ message: { role: "user", content: "new question" } });
assert.match(doc.render(100).join("\n"), /child summary[\s\S]*new question/, "running child remains under its original turn after a new user message");
minimalHandlers.get("tool_execution_start")({ toolCallId: "agent-2", toolName: "subagent", args: { agent: "reviewer" } });
assert.equal((doc.render(100).join("\n").match(/child summary/g) ?? []).length, 1, 'child appears exactly once');
await writeFile(join(statusDirectory, 'status.json'), JSON.stringify({ sessionId: 'current-session', toolCallId: 'agent-1', runId: 'child', mode: 'single', state: 'completed', steps: [{ agent: 'reviewer', status: 'running', recentOutput: ['completed child'] }] }));
await setTimeout(1100);
assert.match(doc.render(100).join('\n'), /Subagent 1\/1/);
assert.doesNotMatch(doc.render(100).join('\n'), /child summary/);
assert.match(doc.render(100).join('\n'), /completed child/);
minimalHandlers.get('agent_settled')({});
const realNow = Date.now;
try {
  const elapsed = realNow() + 20_000;
  Date.now = () => elapsed;
  const beforeRetention = transcriptRenders;
  await setTimeout(150);
  assert.ok(transcriptRenders >= beforeRetention, 'idle completed child does not schedule expiry redraws');
  assert.match(doc.render(100).join('\n'), /Subagent|completed child/);
  inputListener('\x13');
  assert.match(doc.render(100).join('\n'), /completed child/, 'expanded completed child stays visible');
  await minimalCommands.get('mini-lens-minimal').handler('on', minimalCtx);
  assert.match(doc.render(100).join('\n'), /Subagent|completed child/, 'remount retains current-session completed children');
} finally { Date.now = realNow; }
assert.deepEqual(testTui.children[3].render(100), []);
await minimalCommands.get("mini-lens-minimal").handler("off", minimalCtx);
if (previousStatusRoot === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
else process.env.PI_SUBAGENTS_TEMP_ROOT = previousStatusRoot;
await rm(statusRoot, { recursive: true, force: true });
assert.equal(doc.render, originalDocRender);
assert.equal(inputListener, undefined);
// A regular-mode mount must give actionable guidance, never a false "on" receipt.
testTui.mode = 'regular';
const unsupportedNotices = [];
const regularCtx = { ...minimalCtx, ui: { ...minimalCtx.ui, notify: (message, level) => unsupportedNotices.push({ message, level }) } };
await minimalCommands.get('mini-lens-minimal').handler('on', regularCtx);
assert.equal(doc.render, originalDocRender);
assert.equal(unsupportedNotices.length, 1);
assert.equal(unsupportedNotices[0].level, 'warning');
for (const instruction of ['/settings', 'fullscreen', '/reload']) assert.ok(unsupportedNotices[0].message.includes(instruction));
assert.ok(unsupportedNotices[0].message.includes('restart') || unsupportedNotices[0].message.includes('Quit'),
  'regular-mode warning says /reload cannot switch the renderer');
testTui.mode = 'fullscreen';
const remountFooter = footerFactory(testTui, theme);
remountFooter.render(100);
await setTimeout(0);
assert.notEqual(doc.render, originalDocRender, 'footer remounts minimal output after the live TUI becomes fullscreen');
delete testTui.mode;
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
assert.match(previews[0]?.[0] ?? "", /MCP count, dot-matrix style, and collapsed replies are off by default/, "onboarding describes opt-in fields accurately");
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
