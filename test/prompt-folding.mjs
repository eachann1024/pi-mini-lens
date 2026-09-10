import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { stripVTControlCharacters as plain } from 'node:util';

// Keep Pi's actual Markdown, geometry, mouse dispatch and keyboard selector.
const piStub = `data:text/javascript,${encodeURIComponent(`
export const CONFIG_DIR_NAME = '.pi';
export const getMarkdownTheme = () => Object.fromEntries(['heading','link','linkUrl','code','codeBlock','codeBlockBorder','quote','quoteBorder','hr','listBullet','bold','italic','strikethrough','underline'].map(key => [key, text => text]));
export const getSettingsListTheme = () => ({});
`)}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){if(s==='@earendil-works/pi-coding-agent')return {shortCircuit:true,url:${JSON.stringify(piStub)}};return n(s,c)}`)}`, import.meta.url);
const { Container, Text, Markdown, SelectList, TuiAltScreen, ScrollView, visibleWidth, truncateToWidth, setCapabilities } = await import('@earendil-works/pi-tui');
const { default: extension, minimalOutputComponent } = await import('../extensions/footer-status.ts');
const { attachTranscript } = await import('../lib/transcript-adapter.ts');
setCapabilities({ images: null, trueColor: true, hyperlinks: true });
const theme = { bg: (_key, text) => text, fg: (_key, text) => text, bold: text => text };
const question = '[LINK](https://example.com)\n\n' + '中文👩‍💻 é long prompt '.repeat(25) + '\n\nEND_OF_PROMPT';
let turns = [{ question, process: [], final: 'ASSISTANT_UNCHANGED' }, { question: 'Short', process: [] }];
const original = JSON.stringify(turns);
const view = minimalOutputComponent(theme, () => turns.map(turn => ({ ...turn })));
const markdownTheme = Object.fromEntries(['heading','link','linkUrl','code','codeBlock','codeBlockBorder','quote','quoteBorder','hr','listBullet','bold','italic','strikethrough','underline'].map(key => [key, text => text]));
for (const width of [1, 2, 8, 20, 40, 100]) {
  const rows = view.render(width);
  assert.ok(rows.every(row => visibleWidth(row) <= width), `width ${width}`);
  const control = view.promptChoices()[0];
  assert.equal(control.y, 5, 'four visual body rows, then the explicit control');
  assert.doesNotMatch(rows.join('\n'), /END_OF_PROMPT/);
  assert.match(rows.join('\n'), /ASSISTANT|A/);
  view.togglePrompt(control.index, control.question);
  const expanded = view.render(width);
  const padding = Math.min(2, Math.floor((width - 1) / 2));
  const native = new Markdown(question, 0, 0, markdownTheme).render(Math.max(1, width - padding * 2));
  assert.deepEqual(expanded.slice(1, 1 + native.length).map(row => plain(row).trimEnd().slice(padding)), native.map(row => plain(truncateToWidth(' '.repeat(padding) + row, width, '')).trimEnd().slice(padding)), 'expanded body retains every rendered row');
  assert.match(view.promptChoices()[0].label, /收起/);
  view.togglePrompt(0, question);
}
for (const short of ['', 'one', 'one\ntwo\nthree\nfour', '[Attachment]']) {
  const shortView = minimalOutputComponent(theme, () => [{ question: short, process: [] }]);
  shortView.render(80);
  assert.deepEqual(shortView.promptChoices(), [], 'up to four visual rows has no control');
}
const wrapped = minimalOutputComponent(theme, () => [{ question: 'word '.repeat(20), process: [] }]);
wrapped.render(120);
assert.equal(wrapped.promptChoices().length, 0);
wrapped.render(12);
assert.equal(wrapped.promptChoices().length, 1, 'soft wraps count, not source newlines');
assert.equal(JSON.stringify(turns), original, 'folding never mutates prompt data');
const repeated = minimalOutputComponent(theme, () => [{ question, process: [] }, { question, process: [] }]);
repeated.render(80);
repeated.togglePrompt(1, question);
repeated.render(80);
assert.match(repeated.promptChoices()[0].label, /展开/);
assert.match(repeated.promptChoices()[1].label, /收起/, 'identical prompts retain independent state');
repeated.render(40);
assert.match(repeated.promptChoices()[1].label, /收起/, 'resize preserves expansion');

// Actual fullscreen terminal input, including a nonzero document prefix and scroll offset.
const document = new Container();
const header = new Container();
header.addChild(new Text('HEADER\nRESOURCE', 0, 0));
for (const child of [header, new Container(), new Container()]) document.addChild(child);
let input;
let output = '';
const terminal = { columns: 80, rows: 32, start(fn) { input = fn; }, stop() {}, write(data) { output += data; }, hideCursor() {}, showCursor() {} };
let opened;
let copied;
const tui = new TuiAltScreen(terminal, false, undefined, { openUrl: url => { opened = url; }, copySelection: async text => { copied = text; return true; } });
for (const child of [document, ...Array.from({ length: 6 }, () => new Container())]) tui.addChild(child);
let restore = attachTranscript(tui, view);
const scroll = new ScrollView(document, { follow: 'end', primary: true });
tui.setLayoutRoot(scroll);
tui.start();
const paint = async () => { tui.requestRender(); await wait(35); };
const mouse = (code, x, y, release = false) => input(`\x1b[<${code};${x + 1};${y + 1}${release ? 'm' : 'M'}`);
const click = (x, y) => { mouse(0, x, y); mouse(0, x, y, true); };
try {
  await paint();
  let control = view.promptChoices()[0];
  click(control.x, control.y + 2);
  await paint();
  assert.match(view.promptChoices()[0].label, /收起/, 'actual SGR click expands through adapter');
  assert.match(document.render(80).join('\n'), /END_OF_PROMPT/);
  control = view.promptChoices()[0];
  scroll.scrollToEnd();
  await paint();
  click(control.x, control.y + 2 - scroll.scrollTop);
  await paint();
  assert.match(view.promptChoices()[0].label, /展开/, 'scrolled hit target collapses');
  click(2, 3);
  await paint();
  assert.equal(opened, 'https://example.com', 'body hyperlink keeps native priority');
  assert.match(view.promptChoices()[0].label, /展开/);
  mouse(0, 2, 5); mouse(32, 14, 5); mouse(0, 14, 5, true);
  await paint();
  assert.ok(copied, 'native drag selection still copies');
  assert.match(view.promptChoices()[0].label, /展开/);
  const event = { type: 'click', button: 'left', x: 2, y: 5, width: 80, height: 32, clickCount: 1 };
  assert.deepEqual(view.handleMouse({ ...event, type: 'press' }), { handled: true });
  for (const change of [{ type: 'drag' }, { type: 'wheel' }, { button: 'right' }, { shift: true }, { alt: true }, { ctrl: true }, { clickCount: 2 }, { y: 2 }]) {
    assert.equal(view.handleMouse({ ...event, ...change }), undefined);
  }
  assert.equal(JSON.stringify(turns), original);
  restore();
  assert.equal(Object.hasOwn(document, 'handleMouse'), false);

  // Exercise the registered command using the real SelectList key handling.
  const dir = await mkdtemp(join(tmpdir(), 'prompt-folding-'));
  process.env.MINI_LENS_AGENT_DIR = dir;
  const handlers = new Map();
  const commands = new Map();
  await writeFile(join(dir, 'mini-lens.json'), JSON.stringify({ 'mini-lens-minimal-show': true, onboardingCompleted: true }));
  extension({ events: { on() { return () => {}; } }, on(name, fn) { handlers.set(name, fn); }, registerCommand(name, command) { commands.set(name, command); }, registerEntryRenderer() {}, appendEntry() {} });
  let cancel = false;
  const ctx = { mode: 'tui', hasUI: true, sessionManager: { getBranch: () => turns.map(turn => ({ type: 'message', message: { role: 'user', content: turn.question } })) }, ui: {
    theme, setFooter() {}, notify() {}, onTerminalInput(listener) { return tui.addInputListener(listener); },
    setWidget(_name, factory) { factory?.(tui, theme); },
    async select(_title, labels) {
      assert.equal(labels.length, 1, 'only long prompts are keyboard choices');
      const selector = new SelectList(labels.map(label => ({ value: label, label })), 5, {
        selectedPrefix: text => text, selectedText: text => text, description: text => text, scrollInfo: text => text, noMatch: text => text,
      });
      let selected;
      selector.onSelect = item => { selected = item.value; };
      selector.onCancel = () => {};
      assert.match(selector.render(80).join('\n'), /展开|收起/);
      selector.handleInput(cancel ? '\x1b' : '\r');
      return selected;
    },
  } };
  try {
    await handlers.get('session_start')({}, ctx);
    class CustomMessageComponent extends Text {}
    const notice = new CustomMessageComponent('FULL_NATIVE_CARD', 0, 0);
    notice.message = { customType: 'subagent_supervisor_request', content: 'Run: INTERNAL_RUN\nReply with: subagent_supervisor(...)',
      details: { agent: 'worker', reason: 'need_decision', expectsReply: true, requestBody: '是否继续执行？' } };
    document.children[2].addChild(notice);
    await paint();
    assert.match(document.render(80).join('\n'), /内部协作/);
    assert.doesNotMatch(document.render(80).join('\n'), /INTERNAL_RUN/);
    // Explicit notice control uses the same document/scroll geometry as prompts.
    let noticeRow = document.render(80).findIndex(row => plain(row).includes('[详情]'));
    scroll.scrollToEnd();
    await paint();
    click(1, noticeRow - scroll.scrollTop);
    await paint();
    assert.match(document.render(80).join('\n'), /是否继续执行/, 'actual SGR click reveals notification details');
    assert.doesNotMatch(document.render(80).join('\n'), /INTERNAL_RUN/);
    scroll.scrollTo(0);
    await paint();
    noticeRow = document.render(80).findIndex(row => plain(row).includes('[收起]'));
    await wait(550); // a second intentional single click, not double-click selection
    click(1, noticeRow - scroll.scrollTop);
    await paint();
    assert.doesNotMatch(document.render(80).join('\n'), /是否继续执行/, 'actual SGR click collapses details');
    input('\x0f');
    await paint();
    assert.match(document.render(80).join('\n'), /是否继续执行/, 'actual Ctrl+O reveals notification fields');
    assert.doesNotMatch(document.render(80).join('\n'), /INTERNAL_RUN/);
    input('\x0f');
    await paint();
    assert.doesNotMatch(document.render(80).join('\n'), /是否继续执行/, 'Ctrl+O compacts notifications again');
    // Progress replacements preserve the native user's scroll/focus ownership.
    terminal.rows = 8;
    await paint();
    scroll.scrollToEnd(); scroll.scrollBy(-3); await paint();
    const beforeUpdateTop = scroll.scrollTop;
    const nextNotice = new CustomMessageComponent('NEXT_CARD', 0, 0);
    notice.message.details.runId = 'POINTER_RUN'; notice.message.details.childIndex = 0;
    nextNotice.message = { ...notice.message, details: { ...notice.message.details, reason: 'progress_update', expectsReply: false, requestBody: 'NEWEST_PROGRESS error色已测试' } };
    document.children[2].addChild(nextNotice);
    await paint();
    assert.equal(scroll.scrollTop, beforeUpdateTop, 'ordinary aggregated update does not jump scroll');
    assert.equal(scroll.isFollowingEnd, false);
    assert.equal((document.render(80).join('\n').match(/\[详情\]/g) ?? []).length, 1);
    terminal.rows = 32;
    document.children[2].removeChild(nextNotice);
    await paint();
    // Also dispatch notices appended inside a user turn, not only the prefix.
    class UserMessageComponent extends Text {}
    document.children[2].clear();
    document.children[2].addChild(new UserMessageComponent('NATIVE_USER', 0, 0));
    document.children[2].addChild(notice);
    await paint();
    noticeRow = document.render(80).findIndex(row => plain(row).includes('[详情]'));
    scroll.scrollToEnd();
    await paint();
    await wait(550);
    click(1, noticeRow - scroll.scrollTop);
    await paint();
    assert.match(document.render(80).join('\n'), /是否继续执行/, 'turn-relative notice target opens');
    assert.doesNotMatch(document.render(80).join('\n'), /INTERNAL_RUN/);
    // Restore all details with keyboard before exercising the old prompt selector.
    input('\x0f'); await paint(); input('\x0f'); await paint();
    await commands.get('mini-lens-prompts').handler('', ctx);
    assert.match(document.render(80).join('\n'), /END_OF_PROMPT/);
    cancel = true;
    await commands.get('mini-lens-prompts').handler('', ctx);
    assert.match(document.render(80).join('\n'), /END_OF_PROMPT/, 'Escape preserves expansion');
    cancel = false;
    await commands.get('mini-lens-prompts').handler('', ctx);
    assert.doesNotMatch(document.render(80).join('\n'), /END_OF_PROMPT/, 'keyboard can collapse again');
    await handlers.get('session_tree')({}, ctx);
    assert.doesNotMatch(document.render(80).join('\n'), /END_OF_PROMPT/, 'branch remount starts collapsed');
  } finally {
    await handlers.get('session_shutdown')({}, ctx);
    delete process.env.MINI_LENS_AGENT_DIR;
    await rm(dir, { recursive: true, force: true });
  }
} finally { tui.stop(); }
assert.ok(output.length, 'real alternate-screen renderer produced frames');
console.log('Prompt folding PASS: four visual rows, widths 1–120, full expansion, short messages, SGR mouse/scroll, links, native copy, keyboard Enter/Escape, remount, unchanged data.');
