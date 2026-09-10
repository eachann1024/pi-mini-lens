import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { stripVTControlCharacters as plain } from 'node:util';
const stub = `data:text/javascript,${encodeURIComponent(`
export const CONFIG_DIR_NAME = '.pi';
export const getMarkdownTheme = () => Object.fromEntries(['heading','link','linkUrl','code','codeBlock','codeBlockBorder','quote','quoteBorder','hr','listBullet','bold','italic','strikethrough','underline'].map(key => [key, text => text]));
export const getSettingsListTheme = () => ({});
`)}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){if(s==='@earendil-works/pi-coding-agent')return {shortCircuit:true,url:${JSON.stringify(stub)}};return n(s,c)}`)}`, import.meta.url);
const { Container, Text, TuiAltScreen, ScrollView, VStack, SelectList, visibleWidth, setCapabilities } = await import('@earendil-works/pi-tui');
const { default: extension, minimalOutputComponent } = await import('../extensions/footer-status.ts');
const { attachTranscript } = await import('../lib/transcript-adapter.ts');
const { attachAgentWidgets } = await import('../lib/agent-view.ts');
setCapabilities({ images: null, trueColor: true, hyperlinks: true });
const theme = { bg: (_key, text) => text, fg: (_key, text) => text, bold: text => text };
const calls = [
  { id: 'first', name: 'bash', task: 'first-command', state: 'done', output: 'FIRST_RESULT\n' + '中文👩‍💻é长行'.repeat(25) + '\nFIRST_END' },
  { id: 'second', name: 'read', task: 'second-path', state: 'done', output: 'SECOND_RESULT\nSECOND_END' },
];
let turns = [{ question: '[LINK](https://example.com)\n\n' + 'prompt words '.repeat(80), process: ['call first', 'call second', 'skill untouched'], agentCalls: calls, final: 'tail\n'.repeat(12) }];
let expanded = false;
const original = JSON.stringify(turns);
const view = minimalOutputComponent(theme, () => turns.map(turn => ({ ...turn })), () => expanded);
const event = (control, changes = {}) => ({ type: 'click', button: 'left', x: 3, y: control.y, width: 80, height: 50, screenX: 3, screenY: control.y, ...changes });
for (const width of [1, 2, 4, 5, 8, 20, 40, 100]) {
  view.render(width);
  view.toggleTool('first');
  const rows = view.render(width);
  assert.ok(rows.every(row => visibleWidth(row) <= width), `bounded width ${width}`);
  if (width >= 20) {
    const body = rows.join('\n');
    assert.match(body, /FIRST_END/);
    assert.equal((body.match(/中/g) ?? []).length, 25, 'CJK long line preserved');
    assert.equal((body.match(/文/g) ?? []).length, 25, 'CJK long line preserved');
    assert.equal((body.match(/👩‍💻/gu) ?? []).length, 25, 'graphemes preserved');
  }
  view.toggleTool('first');
}
view.render(80);
let control = view.toolChoices()[0];
view.handleMouse(event(control, { type: 'move', button: 'none' }));
assert.match(view.render(80)[control.y], /▸ bash/);
assert.match(view.render(40)[view.toolChoices()[0].y], /● bash/, 'resize clears hover');
view.render(80);
control = view.toolChoices()[0];
for (const changes of [{ shift: true }, { ctrl: true }, { alt: true }, { button: 'right' }, { x: 7 }, { type: 'drag' }, { type: 'wheel' }]) {
  assert.equal(view.handleMouse(event(control, changes)), undefined);
}
view.handleMouse(event(control));
assert.match(view.render(80).join('\n'), /FIRST_RESULT/);
expanded = true;
assert.match(view.render(80).join('\n'), /FIRST_RESULT/, 'Ctrl+O state independent');
expanded = false;
view.handleMouse(event(view.toolChoices()[0], { clickCount: 2 }));
assert.doesNotMatch(view.render(80).join('\n'), /FIRST_RESULT/, 'rapid second click collapses');

const document = new Container();
const header = new Container();
header.addChild(new Text('HEADER\nRESOURCE', 0, 0));
for (const child of [header, new Container(), new Container()]) document.addChild(child);
const dock = new Container(); dock.addChild(new Text('EDITOR_DOCK', 0, 0));
let input, copied, opened;
let frames = '';
const terminal = { columns: 80, rows: 24, start(fn) { input = fn; }, stop() {}, write(data) { frames += data; }, hideCursor() {}, showCursor() {} };
const tui = new TuiAltScreen(terminal, false, undefined, { openUrl: url => { opened = url; }, copySelection: async text => { copied = text; return true; } });
for (const child of [document, dock, ...Array.from({ length: 5 }, () => new Container())]) tui.addChild(child);
const widgetDocks = [3, 5].map(index => tui.children[index]);
const widgetClicks = [0, 0];
let hiddenClicks = 0;
widgetDocks.forEach((container, index) => {
  const hidden = new Text('Async agents\nHIDDEN_NATIVE_CONTROL', 0, 0);
  hidden.handleMouse = () => { hiddenClicks++; return { handled: true }; };
  const visible = new Text(`VISIBLE_WIDGET_${index}`, 0, 0);
  visible.handleMouse = event => {
    if (event.type === 'press') return { handled: true };
    if (event.type === 'click') { assert.equal(event.y, 0); widgetClicks[index]++; return { handled: true }; }
  };
  container.addChild(hidden); container.addChild(visible);
});
// Exercise restoration of both an own descriptor and an inherited handler.
widgetDocks[0].handleMouse = Container.prototype.handleMouse;
const originalDockDescriptors = widgetDocks.map(container => ({
  mouse: Object.getOwnPropertyDescriptor(container, 'handleMouse'),
  render: Object.getOwnPropertyDescriptor(container, 'render'),
}));
const restoreWidgets = attachAgentWidgets(tui, theme, () => false, undefined, true);
const restore = attachTranscript(tui, view);
const scroll = new ScrollView(document, { follow: 'end', primary: true });
tui.setLayoutRoot(new VStack([{ component: scroll, grow: 1, basis: 0 },
  ...widgetDocks.map(component => ({ component, basis: 1, shrink: 0 })), { component: dock, basis: 2, shrink: 0 }]));
tui.start();
const paint = async () => { tui.requestRender(); await wait(40); };
const mouse = (code, x, y, release = false) => input(`\x1b[<${code};${x + 1};${y + 1}${release ? 'm' : 'M'}`);
const click = (x, y) => { mouse(0, x, y); mouse(0, x, y, true); };
const row = id => view.toolChoices().find(c => c.id === id).y + 2 - scroll.scrollTop;
const content = () => document.render(80).map(plain).join('\n');
try {
  await paint(); scroll.scrollTo(0); await paint();
  mouse(35, 3, row('first')); await paint();
  assert.match(content(), /▸ bash/, 'real hover');
  mouse(35, 4, 22); await paint();
  assert.doesNotMatch(content(), /▸ bash/, 'transcript to dock clears hover');
  for (const [index, widgetDock] of widgetDocks.entries()) {
    assert.deepEqual(widgetDock.render(80).map(plain).map(s => s.trim()), [`VISIBLE_WIDGET_${index}`]);
    mouse(35, 3, row('first')); await paint();
    assert.match(content(), /▸ bash/);
    mouse(35, 4, 20 + index); await paint();
    assert.doesNotMatch(content(), /▸ bash/, `combined adapters clear hover in dock ${[3, 5][index]}`);
    click(4, 20 + index); await paint();
    assert.equal(widgetClicks[index], 1, 'visible widget handler receives remapped coordinates');
  }
  assert.equal(hiddenClicks, 0, 'hidden native widget handlers never receive events');
  mouse(35, 3, row('first')); await paint();
  mouse(35, 3, 0); await paint();
  assert.doesNotMatch(content(), /▸ bash/, 'header clears hover');
  mouse(35, 3, row('first')); await paint();
  mouse(65, 6, row('first')); await paint();
  assert.doesNotMatch(content(), /▸ bash/, 'wheel clears hover and still scrolls');
  assert.ok(scroll.scrollTop > 0);
  click(3, row('first')); await paint();
  assert.match(content(), /FIRST_RESULT/);
  assert.doesNotMatch(content(), /SECOND_RESULT/);
  // The second target moves down when the first expands; scroll to its new row.
  scroll.scrollTo(view.toolChoices().find(c => c.id === 'second').y); await paint();
  click(3, row('second')); await paint();
  assert.match(content(), /FIRST_RESULT/);
  assert.match(content(), /SECOND_RESULT/, 'two independently expanded tools, scrolled coordinates');
  click(3, row('second')); await paint();
  assert.doesNotMatch(content(), /SECOND_RESULT/, 'rapid second SGR click collapses');
  assert.match(content(), /FIRST_RESULT/);
  scroll.scrollTo(0); await paint();
  click(2, 3); await paint();
  assert.equal(opened, 'https://example.com', 'prompt link unaffected');
  const detailY = row('first') + 1;
  mouse(0, 5, detailY); mouse(32, 16, detailY); mouse(0, 16, detailY, true); await paint();
  assert.ok(copied?.includes('FIRST'), 'tool detail retains native selection/copy');
  const prompt = view.promptChoices()[0];
  click(1, prompt.y + 2); await paint();
  assert.match(view.promptChoices()[0].label, /收起/, 'prompt folding unaffected');
  view.togglePrompt(0, turns[0].question); await paint();
  scroll.scrollTo(0); await paint();
  click(3, row('first')); await paint();
  assert.doesNotMatch(content(), /FIRST_RESULT/);
  mouse(35, 3, row('first')); await paint();
  scroll.scrollBy(1); await paint();
  assert.doesNotMatch(content(), /▸ bash/, 'programmatic/keyboard-equivalent scroll clears hover');
  scroll.scrollTo(0); await paint();
  mouse(35, 3, row('first')); await paint();
  turns[0].question = 'short'; await paint();
  assert.doesNotMatch(content(), /▸ bash/, 'content reflow clears hover');
  turns[0].question = JSON.parse(original)[0].question;
  assert.equal(JSON.stringify(turns), original, 'no mutation of saved outputs');
} finally { restore(); restoreWidgets(); tui.stop(); }
const assertDockRestored = () => widgetDocks.forEach((container, index) => {
  assert.deepEqual(Object.getOwnPropertyDescriptor(container, 'handleMouse'), originalDockDescriptors[index].mouse);
  assert.deepEqual(Object.getOwnPropertyDescriptor(container, 'render'), originalDockDescriptors[index].render);
});
assertDockRestored();
assert.equal(Object.hasOwn(document, 'handleMouse'), false);
assert.equal(Object.hasOwn(dock, 'handleMouse'), false);
assert.ok(frames.length > 0);
for (const state of ['running', 'error', 'done']) {
  calls[0].state = state;
  calls[0].output = state === 'done' ? '' : 'diagnostic\nDETAIL_END\x1b[2J\x07';
  view.toggleTool('first');
  const rows = view.render(80).join('\n');
  if (state === 'error') assert.match(rows, /▾ × bash/);
  if (state === 'running') assert.match(rows, /▾ [\u2800-\u28ff] bash/);
  assert.doesNotMatch(rows, /\x1b\[2J|\x07/, 'terminal controls stripped from saved output');
  if (state === 'done') assert.match(rows, /无文本结果/);
  view.toggleTool('first');
}
view.toggleTool('first');
turns = []; view.render(80);
turns = JSON.parse(original);
assert.doesNotMatch(view.render(80).join('\n'), /FIRST_RESULT/, 'discarded calls do not retain expansion');
// Command uses Pi's existing keyboard selector, without binding a new shortcut.
const dir = await mkdtemp(join(tmpdir(), 'tool-folding-'));
const previousDir = process.env.MINI_LENS_AGENT_DIR;
process.env.MINI_LENS_AGENT_DIR = dir;
const handlers = new Map(), commands = new Map();
let cancel = false, notice;
const branch = [
  { type: 'message', message: { role: 'user', content: 'keyboard' } },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'keyboard-tool', name: 'bash', arguments: { command: 'keyboard-command' } }] } },
  { type: 'message', message: { role: 'toolResult', toolCallId: 'keyboard-tool', toolName: 'bash', content: [{ type: 'text', text: 'KEYBOARD_RESULT' }], isError: false } },
];
const ctx = { mode: 'tui', hasUI: true, sessionManager: { getBranch: () => branch }, ui: {
  theme, setFooter() {}, notify(text) { notice = text; }, onTerminalInput(listener) { return tui.addInputListener(listener); },
  setWidget(_name, factory) { factory?.(tui, theme); },
  async select(_title, labels) {
    assert.equal(labels.length, 1);
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
  await writeFile(join(dir, 'mini-lens.json'), JSON.stringify({ 'mini-lens-minimal-show': true, onboardingCompleted: true }));
  extension({ events: { on() { return () => {}; } }, on(name, fn) { handlers.set(name, fn); }, registerCommand(name, cmd) { commands.set(name, cmd); } });
  await handlers.get('session_start')({}, ctx);
  tui.start(); await paint(); scroll.scrollTo(0); await paint();
  // Run the real extension mounting path, not just manually composed adapters.
  const hoverMountedTool = async () => {
    const y = document.render(80).findIndex(line => plain(line).includes('bash keyboard-command'));
    mouse(35, 3, y - scroll.scrollTop); await paint();
    assert.match(content(), /▸ bash/);
  };
  const checkMountedDocks = async () => {
    for (const index of [0, 1]) {
      await hoverMountedTool();
      mouse(35, 4, 20 + index); await paint();
      assert.doesNotMatch(content(), /▸ bash/, `extension mounting preserves dock ${[3, 5][index]} hover cleanup`);
      const previous = widgetClicks[index];
      click(4, 20 + index); await paint();
      assert.equal(widgetClicks[index], previous + 1);
    }
  };
  await checkMountedDocks();
  await commands.get('mini-lens-tools').handler('', ctx);
  assert.match(content(), /KEYBOARD_RESULT/, 'keyboard Enter expands one tool');
  cancel = true;
  await commands.get('mini-lens-tools').handler('', ctx);
  assert.match(content(), /KEYBOARD_RESULT/, 'keyboard Escape preserves state');
  cancel = false;
  await commands.get('mini-lens-tools').handler('', ctx);
  assert.doesNotMatch(content(), /KEYBOARD_RESULT/, 'keyboard Enter collapses tool');
  await commands.get('mini-lens-tools').handler('', ctx);
  await handlers.get('session_tree')({}, ctx);
  assert.doesNotMatch(content(), /KEYBOARD_RESULT/, 'session branch remount resets local state');
  await paint(); scroll.scrollTo(0); await paint();
  await checkMountedDocks();
  // Native-mode teardown must remove the outer hover wrappers before widgets.
  input('\x1b[111;7u'); await paint();
  assertDockRestored();
  input('\x1b[111;7u'); await paint();
  scroll.scrollTo(0); await paint();
  await checkMountedDocks();
  const nativeChat = document.children.pop();
  try {
    await handlers.get('session_tree')({}, ctx);
    assert.match(notice, /layout not recognized/);
    assertDockRestored();
    assert.equal(Object.hasOwn(document, 'handleMouse'), false, 'failed attachment leaves no transcript wrapper');
  } finally { document.addChild(nativeChat); }
  await handlers.get('session_tree')({}, ctx);
  await paint(); scroll.scrollTo(0); await paint();
  await checkMountedDocks();
  await commands.get('mini-lens-tools').handler('', { ...ctx, mode: 'print' });
  assert.match(notice, /requires fullscreen/);
} finally {
  await handlers.get('session_shutdown')?.({}, ctx);
  tui.stop();
  assertDockRestored();
  assert.equal(hiddenClicks, 0);
  if (previousDir === undefined) delete process.env.MINI_LENS_AGENT_DIR;
  else process.env.MINI_LENS_AGENT_DIR = previousDir;
  await rm(dir, { recursive: true, force: true });
}
console.log('Tool folding PASS: real SGR hover/click/dock/header/scroll, combined transcript+agent docks 3/5, extension mount/remount/native toggle/fail-closed/shutdown restoration, independent toggles, reflow, CJK/graphemes, links/copy, prompt folding, states, sanitization.');
