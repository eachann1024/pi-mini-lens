import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { register } from "node:module";
import { setTimeout } from "node:timers/promises";

// Keep real TUI components, but avoid loading the unrelated Pi server runtime.
const piStub = `data:text/javascript,${encodeURIComponent(`
export const CONFIG_DIR_NAME = ".pi";
export const getMarkdownTheme = () => Object.fromEntries(["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder", "hr", "listBullet", "bold", "italic", "strikethrough", "underline"].map(key => [key, text => text]));
export const getSettingsListTheme = () => ({
  hint: (text) => text, description: (text) => text,
});
`)}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){if(s==='@earendil-works/pi-coding-agent')return {shortCircuit:true,url:${JSON.stringify(piStub)}};return n(s,c)}`)}`, import.meta.url);
const { default: extension, loadSettings, settingsPath, settingsPreviewLine, DEFAULT_SETTINGS } = await import("../extensions/footer-status.ts");

const dir = await mkdtemp(join(tmpdir(), "mini-lens-pointer-"));
process.env.MINI_LENS_AGENT_DIR = dir;
process.env.LANG = "en_US.UTF-8";
const commands = new Map();
extension({ events: { on() { return () => {}; } }, on() {}, registerCommand(name, command) { commands.set(name, command); }, registerEntryRenderer() {}, appendEntry() {} });
let panel;
const theme = {
  bg(color, text) { assert.equal(color, "selectedBg"); return `\x1b[47m${text}\x1b[49m`; },
  fg(color, text) { return color === "accent" ? `\x1b[32m${text}\x1b[39m` : text; },
  bold(text) { return `\x1b[1m${text}\x1b[22m`; },
};
await commands.get("mini-lens-settings").handler("", {
  mode: "tui",
  ui: {
    setWidget() {},
    notify() {},
    async custom(factory) { panel = factory({ requestRender() {} }, theme, {}, () => {}); },
  },
});
const plain = (line) => line.replace(/\x1b\[[0-9;]*m/g, "");
assert.match(panel.render(100).join("\n"), /Collapse replies/);
assert.match(panel.render(100).join("\n"), /Minimal output/);
assert.match(plain(panel.render(100).join("\n")), /Collapse replies\s+off/);
panel.handleInput("\x1b[B"); // Collapse replies
panel.handleInput("\x1b[B"); // Minimal output (disabled)
panel.handleInput("\r");
assert.match(plain(panel.render(100).join("\n")), /Collapse replies/, "disabled Minimal output does not open");
assert.doesNotMatch(plain(panel.render(100).join("\n")), /Show thinking/);
assert.match(plain(panel.render(100).join("\n")), /Turn on Collapse replies to configure these options/);
panel.handleInput("\x1b[A"); // Collapse replies
panel.handleInput("\r"); // on
assert.match(plain(panel.render(100).join("\n")), /Collapse replies\s+on/);
panel.handleInput("\x1b[B"); // Minimal output
panel.handleInput("\r"); // enter unlocked group
assert.match(plain(panel.render(100).join("\n")), /Show thinking/);
assert.doesNotMatch(plain(panel.render(100).join("\n")), /Collapse replies/);
panel.handleInput("\x1b"); // back to groups
panel.handleInput("\x1b[A"); // Collapse replies
panel.handleInput("\x1b[A"); // Lens
panel.handleInput("\r"); // Enter the Lens group.
for (const width of [140, 80, 40]) {
  let lines = panel.render(width);
  const row = lines.findIndex((line) => plain(line).includes("Show thinking level"));
  assert.ok(row >= 0);
  const beforeHover = plain(lines[row]).replace(/^[→ ]+/, "");
  const result = panel.handleMouse({ type: "move", button: "none", x: 4, y: row, screenX: 4, screenY: row, width, height: lines.length });
  assert.equal(result?.handled, true, "panel routes hover through header and preview to settings");
  lines = panel.render(width);
  assert.match(lines[row], /\x1b\[47m\x1b\[32m.*Show thinking level/, "hovered option has background and green text");
  const previewLines = lines.slice(0, row - 2).join("\n");
  if (width >= 80) assert.match(previewLines, /\x1b\[47m\x1b\[32m\x1b\[1mhigh/, "hover highlights the corresponding preview field");
  assert.equal(plain(lines[row]).replace(/^[→ ]+/, ""), beforeHover, "hover does not toggle the value");
  assert.equal(lines.filter((line) => line.includes("\x1b[32m") && plain(line).includes("Show ")).length, 1, "exactly one option is highlighted");
  panel.handleInput("\x1b[B");
  lines = panel.render(width);
  assert.match(lines[row + 1], /\x1b\[32m.*Show total session tokens/, "keyboard follows footer field order");
  if (width >= 140) assert.match(lines.slice(0, row - 2).join("\n"), /\x1b\[32m\x1b\[1mTotal/, "keyboard updates preview highlight");
  assert.ok(lines.every((line) => visibleWidth(line) <= width), "panel stays within terminal width");
}
panel.handleInput("mcp");
let lines = panel.render(140);
assert.ok(lines.some((line) => /Show enabled MCP servers.*off/.test(plain(line))), "search finds MCP toggle defaulting to off");
panel.handleInput("\r");
lines = panel.render(140);
assert.ok(lines.some((line) => /Show enabled MCP servers.*on/.test(plain(line))), "Enter enables MCP count");
assert.match(lines.join("\n"), /\x1b\[47m\x1b\[32m\x1b\[1m◇ MCP 3/, "selected MCP toggle highlights its example field");
for (const width of [140, 80, 40, 20]) {
  assert.ok(panel.render(width).every((line) => visibleWidth(line) <= width), `MCP settings stay within ${width} columns`);
}
for (let width = 0; width <= 140; width++) {
  const preview = settingsPreviewLine(theme, { ...DEFAULT_SETTINGS, "mini-lens-mcp-show": true }, width, "mini-lens-mcp-show");
  assert.ok(visibleWidth(preview) <= width, `ANSI-styled MCP preview respects ${width} columns`);
}
for (let attempt = 0; attempt < 100; attempt++) {
  if ((await loadSettings(settingsPath(dir))).settings["mini-lens-mcp-show"]) break;
  await setTimeout(10);
}
assert.equal((await loadSettings(settingsPath(dir))).settings["mini-lens-mcp-show"], true, "real keyboard toggle persists");
await rm(dir, { recursive: true, force: true });
delete process.env.MINI_LENS_AGENT_DIR;
console.log("settings interaction check ok (real SettingsList / Container)");
