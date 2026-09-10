import assert from "node:assert/strict";
import { register } from "node:module";

// Load the extension's real minimal-output factory without Pi's optional server peer.
const piUrl = `data:text/javascript,${encodeURIComponent(`
export const CONFIG_DIR_NAME = ".pi";
export const getMarkdownTheme = () => Object.fromEntries(["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder", "hr", "listBullet", "bold", "italic", "strikethrough", "underline"].map(key => [key, text => text]));
export const getSettingsListTheme = () => ({});
`)}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){if(s==='@earendil-works/pi-coding-agent')return {shortCircuit:true,url:${JSON.stringify(piUrl)}};return n(s,c)}`)}`, import.meta.url);
const { Container, ScrollView, TuiMainScreen } = await import("@earendil-works/pi-tui");
const { minimalOutputComponent } = await import("../extensions/footer-status.ts");
const { attachTranscript } = await import("../lib/transcript-adapter.ts");

const terminal = { columns: 80, rows: 6, write() {}, hideCursor() {}, showCursor() {} };
const regular = new TuiMainScreen(terminal);
regular.children = [new Container(), new Container(), new Container(), new Container(), new Container(), new Container(), new Container()];
assert.equal(attachTranscript(regular, { render: () => ['MINIMAL'], invalidate() {} }), undefined,
  'regular mode keeps the native transcript so historical updates cannot clear scrollback');

const document = new Container();
const header = new Container();
const resources = new Container();
const chat = new Container();
for (const child of [header, resources, chat]) document.addChild(child);
const editor = new Container();
editor.addChild({ render: () => [], invalidate() {}, getText: () => "" });
const tui = { children: [document, new Container(), new Container(), new Container(), editor, new Container(), new Container()] };
const theme = { bg: (_token, text) => text, fg: (_token, text) => text, bold: text => text };
const turn = { question: "Question", process: [], running: true, final: "line\n".repeat(30) };
const view = minimalOutputComponent(theme, () => [turn]);
const restore = attachTranscript(tui, view);
assert.equal(typeof restore, "function");

const scroll = new ScrollView(document, { follow: "end", primary: true });
const layout = () => scroll.updateLayout(document.render(80).length, 6, () => {});
layout();
assert.equal(scroll.isFollowingEnd, true, "bottom follows streaming output");
scroll.scrollBy(-3);
const scrolledTop = scroll.scrollTop;
assert.equal(scroll.isFollowingEnd, false, "manual upward scroll disables follow");

turn.final += "more streamed output\n".repeat(20);
layout();
assert.equal(scroll.scrollTop, scrolledTop, "stream growth preserves the manual position");
assert.equal(scroll.isFollowingEnd, false, "stream growth does not restore follow");

scroll.scrollToEnd();
turn.final += "still streaming\n";
layout();
assert.equal(scroll.isFollowingEnd, true, "bottom continues following streamed growth");

scroll.scrollBy(-3);
turn.final = undefined;
layout();
assert.equal(scroll.isFollowingEnd, true, "content shrink clamps a stale position to the end");
restore();
console.log("streaming scroll regression check ok (growth preserves manual scroll; shrink follows native clamp)");
