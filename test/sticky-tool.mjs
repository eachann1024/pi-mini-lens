import assert from 'node:assert/strict';
import Module, { register } from 'node:module';
import { setTimeout as wait } from 'node:timers/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters as plain } from 'node:util';
const stub = `data:text/javascript,${encodeURIComponent(`
export const CONFIG_DIR_NAME = '.pi';
export const getMarkdownTheme = () => Object.fromEntries(['heading','link','linkUrl','code','codeBlock','codeBlockBorder','quote','quoteBorder','hr','listBullet','bold','italic','strikethrough','underline'].map(key => [key, text => text]));
export const getSettingsListTheme = () => ({});
`)}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){if(s==='@earendil-works/pi-coding-agent')return {shortCircuit:true,url:${JSON.stringify(stub)}};return n(s,c)}`)}`, import.meta.url);
const { Container, Text, TuiAltScreen, ScrollView, VStack, HStack, visibleWidth, setCapabilities } = await import('@earendil-works/pi-tui');
const { getLayoutNode } = await import('@earendil-works/pi-tui/dist/layout-node.js');
const { default: extension, minimalOutputComponent } = await import('../extensions/footer-status.ts');
const { attachTranscript } = await import('../lib/transcript-adapter.ts');
const { attachAgentWidgets } = await import('../lib/agent-view.ts');
const { attachStickyTool } = await import('../lib/sticky-tool.ts');
setCapabilities({ images: null, trueColor: true, hyperlinks: true });
const theme = { bg: (_, text) => text, fg: (_, text) => text, bold: text => text };
const calls = ['first', 'second'].map(id => ({ id, name: 'bash', task: `${id}-command`, state: 'done', output: Array.from({ length: 70 }, (_, i) => `${id}_${i} 中文 👩‍💻`).join('\n') }));
const turn = { question: 'question\n\n' + 'prompt '.repeat(100), process: ['call first', 'call second'], agentCalls: calls,
  subAgents: [{ runId: 'subagent-pin', mode: 'single', state: 'running', steps: [{ agent: 'worker', status: 'running', model: 'test/gpt-5', recentOutput: ['Subagent activity'] }], noticeMessages: [{ content: Array.from({ length: 30 }, (_, i) => `SUBAGENT_DETAIL_${i}`).join('\n') }] }],
  final: '[BODY_LINK](https://example.com)\n\n' + 'tail\n'.repeat(20) };
const view = minimalOutputComponent(theme, () => [turn]);
const document = new Container();
const header = new Container(); header.addChild(new Text('HEADER\nRESOURCE', 0, 0));
for (const c of [header, new Container(), new Container()]) document.addChild(c);
const docks = Array.from({ length: 6 }, () => new Container());
const editorText = new Text('EDITOR\nEDITOR', 0, 0);
docks[3].addChild(editorText);
let input, copied, opened;
const terminal = { columns: 80, rows: 24, start(fn) { input = fn; }, stop() {}, write() {}, hideCursor() {}, showCursor() {} };
const tui = new TuiAltScreen(terminal, false, undefined, { copySelection: async text => { copied = text; return true; }, openUrl: url => { opened = url; } });
for (const c of [document, ...docks]) tui.addChild(c);
const scroll = new ScrollView(document, { follow: 'end', primary: true, scrollbar: 'always' });
const dockLayout = new VStack(docks.map(component => ({ component, shrink: 1, minSize: 0 })));
const visible = () => true;
const originalRoot = new VStack([
  { component: scroll, basis: 0, grow: 1, shrink: 1, minSize: 1, maxSize: 1000, visible },
  { component: dockLayout, basis: 'auto', shrink: 0 },
], { gap: 0, align: 'start' });
tui.setLayoutRoot(originalRoot);
let restoreWidgets = attachAgentWidgets(tui, theme, () => false, undefined, true);
let restore = attachTranscript(tui, view);
assert.notEqual(tui.layoutRoot, originalRoot);
const originalNode = getLayoutNode(originalRoot), mountedNode = getLayoutNode(tui.layoutRoot);
assert.deepEqual({ ...mountedNode.entries[0], component: scroll }, originalNode.entries[0], 'all entry options preserved');
assert.equal(mountedNode.entries[1].component, dockLayout, 'unrelated layout retains identity');
assert.equal(mountedNode.align, originalNode.align);
assert.equal(getLayoutNode(mountedNode.entries[0].component).entries[1].component, scroll, 'same ScrollView retained');
tui.start();
const paint = async () => { tui.requestRender(); await wait(45); };
const mouse = (code, x, y, release = false) => input(`\x1b[<${code};${x + 1};${y + 1}${release ? 'm' : 'M'}`);
const click = (x, y) => { mouse(0, x, y); mouse(0, x, y, true); };
const screen = () => tui.previousScreen.map(plain);
const docRows = () => document.render(scroll.getContentWidth(terminal.columns)).map(plain);
const toolY = id => view.toolChoices().find(c => c.id === id).y + 2;
const pinned = id => assert.match(screen()[0], new RegExp(`▾ bash ${id}-command`));
try {
  const subagentY = () => docRows().findIndex(row => row.includes('SubAgent'));
  await paint();
  scroll.scrollTo(0); await paint();
  click(3, subagentY() - scroll.scrollTop); await paint();
  assert.match(docRows().join('\n'), /SUBAGENT_DETAIL_0/, 'SubAgent row expands its corresponding content');
  assert.equal(scroll.scrollTop, 0, 'expanding a SubAgent keeps the user at the clicked viewport position');
  assert.doesNotMatch(screen()[0], /SubAgent/, 'expanding does not immediately pin the SubAgent heading');
  scroll.scrollTo(subagentY() + 1); await paint();
  assert.match(screen()[0], /SubAgent/, 'SubAgent heading pins only after scrolling past its original row');
  click(12, 0); await paint();
  assert.equal(view.pinnedSubagent(), undefined, 'SubAgent sticky heading collapses on click');
  assert.doesNotMatch(docRows().join('\n'), /SUBAGENT_DETAIL_0/, 'sticky header collapse hides the SubAgent content');
  const finalText = turn.final;
  turn.final = '';
  await paint(); scroll.scrollToEnd(); await paint();
  assert.equal(scroll.isFollowingEnd, true, 'start from real follow-end before opening');
  click(3, toolY('first') - scroll.scrollTop); await paint();
  pinned('first');
  assert.match(screen()[1], /first_0/, 'first detail row remains visible, never overwritten');
  assert.equal(scroll.isFollowingEnd, false, 'opening suspends follow-end');
  turn.final = finalText; await paint(); pinned('first');
  for (let i = 0; i < 4; i++) { mouse(65, 8, 3); await paint(); pinned('first'); }
  const top = scroll.scrollTop;
  mouse(65, 8, 0); await paint();
  assert.ok(scroll.scrollTop > top, 'wheel over sticky header scrolls transcript'); pinned('first');
  mouse(0, 5, 1); mouse(32, 16, 1); mouse(0, 16, 1, true); await paint();
  assert.match(copied, /first_/, 'native detail selection uses correct row below header');
  const beforeGrowth = scroll.scrollTop;
  calls[0].output += '\nSTREAM_GROWTH\n'.repeat(15); await paint();
  pinned('first'); assert.equal(scroll.scrollTop, beforeGrowth, 'streaming does not steal manual scroll');
  scroll.scrollTo(toolY('first')); await paint();
  assert.match(screen()[0], /▾ bash first-command/, 'at original header no duplicate sticky row');
  assert.match(screen()[1], /first_0/);
  mouse(64, 5, 2); await paint();
  assert.equal(view.pinnedTool(), undefined, 'up past original heading releases pin');
  const above = scroll.scrollTop;
  await paint(); assert.equal(scroll.scrollTop, above, 'unpin does not force a new position');
  scroll.scrollTo(toolY('first') + 10); await paint();
  assert.doesNotMatch(screen()[0], /▾ bash/, 'released header does not reattach without a new expansion');
  // Switch directly from a pinned first tool to the newly opened second tool.
  view.toggleTool('first'); view.toggleTool('first'); await paint(); pinned('first');
  scroll.scrollTo(toolY('second') - 3); await paint(); pinned('first');
  click(3, toolY('second') - scroll.scrollTop + 1); await paint();
  pinned('second');
  assert.equal(view.toolChoices().filter(c => c.expanded).length, 2);
  const linkY = docRows().findIndex(row => row.includes('BODY_LINK'));
  scroll.scrollTo(linkY); await paint(); pinned('second');
  click(1, 1); await paint();
  assert.equal(opened, 'https://example.com', 'body links work below dedicated header');
  opened = undefined;
  click(20, 0); await paint();
  assert.equal(opened, undefined, 'sticky header click cannot hit body link');
  assert.equal(view.toolChoices().find(c => c.id === 'second').expanded, false);
  assert.equal(view.toolChoices().find(c => c.id === 'first').expanded, true);
  assert.ok(scroll.scrollTop <= Math.max(0, docRows().length - scroll.viewportHeight), 'collapse clamps scroll normally');
  view.toggleTool('first'); await paint();
  scroll.scrollTo(0); await paint();
  click(3, toolY('first')); await paint(); pinned('first');
  await wait(1600); // Pi's native clipboard flash may temporarily cover the top row.
  for (const width of [20, 8, 4, 80]) {
    terminal.columns = width; await paint();
    assert.ok(screen().every(row => visibleWidth(row) <= width), `screen width ${width}`);
    assert.equal(view.pinnedTool()?.id, 'first');
    assert.match(screen()[0], /▾/, 'heading stays pinned through reflow');
  }
  // Lifecycle restores original layout and retains the ScrollView's position/follow state.
  const savedTop = scroll.scrollTop, savedFollow = scroll.isFollowingEnd;
  restore(); restoreWidgets();
  assert.equal(tui.layoutRoot, originalRoot);
  assert.equal(scroll.scrollTop, savedTop); assert.equal(scroll.isFollowingEnd, savedFollow);
  restoreWidgets = attachAgentWidgets(tui, theme, () => false, undefined, true);
  restore = attachTranscript(tui, view); await paint();
  assert.equal(view.pinnedTool(), undefined, 'remount does not retain a stale pin');
  assert.equal(getLayoutNode(getLayoutNode(tui.layoutRoot).entries[0].component).entries[1].component, scroll);
  view.toggleTool('first'); await paint(); // close
  scroll.scrollToEnd(); await paint();
  const oldEnd = scroll.scrollTop;
  turn.final += '\nNORMAL_STREAM\n'.repeat(30); await paint();
  assert.equal(scroll.isFollowingEnd, true); assert.ok(scroll.scrollTop > oldEnd, 'ordinary streaming follow-end unchanged');
  turn.final = ''; calls[1].output = 'SHORT_RESULT';
  scroll.scrollTo(0); await paint();
  click(3, toolY('second') - scroll.scrollTop); await paint();
  pinned('second');
  assert.match(screen()[1], /SHORT_RESULT/, 'short final tool aligns at top with trailing space');
  assert.equal(scroll.isFollowingEnd, false);
  const checkShortPinned = async label => {
    // Repaint twice: the old failure is a clamp in layout followed by false unpin.
    await paint(); await paint();
    assert.equal(view.pinnedTool()?.id, 'second', label);
    pinned('second');
    assert.match(screen()[1], /SHORT_RESULT/, `${label}: detail retained`);
    assert.equal(scroll.scrollTop, toolY('second') + 1, `${label}: anchor retained`);
    assert.equal(scroll.isFollowingEnd, false, `${label}: no resumed follow-end`);
  };
  for (const rows of [45, 18, 32, 24]) {
    terminal.rows = rows;
    await checkShortPinned(`terminal rows ${rows}`);
  }
  for (const height of [10, 1, 8, 2]) {
    editorText.setText(Array(height).fill('EDITOR').join('\n'));
    await checkShortPinned(`dock height ${height}`);
  }
  mouse(64, 5, 1); await paint();
  mouse(64, 5, 1); await paint(); await paint();
  assert.equal(view.pinnedTool(), undefined, 'real upward wheel still releases pin after viewport changes');
  assert.ok(scroll.scrollTop < toolY('second'));
  assert.match(docRows().join('\n'), /SHORT_RESULT/, 'unpin does not collapse result');
  view.toggleTool('second'); view.toggleTool('second'); await paint(); pinned('second');
  click(12, 0); await paint();
  assert.equal(view.pinnedTool(), undefined);
  // Switch from an existing pinned long result to the final short result.
  view.toggleTool('first'); await paint(); pinned('first');
  scroll.scrollTo(toolY('second') - 3); await paint();
  click(3, toolY('second') - scroll.scrollTop + 1); await paint(); await paint();
  pinned('second');
  const shortTop = scroll.scrollTop;
  assert.equal(scroll.isFollowingEnd, false, 'switching pinned targets keeps follow suppressed at actual viewport end');
  calls[1].output += '\n' + 'B_STREAM\n'.repeat(35);
  await paint(); await paint();
  pinned('second');
  assert.equal(scroll.scrollTop, shortTop, 'short B growth must not steal reading position after switching from A');
  assert.equal(scroll.isFollowingEnd, false, 'short B growth keeps follow suppressed');
  assert.match(screen()[1], /SHORT_RESULT/);
  click(12, 0); await paint();
  view.toggleTool('first'); await paint();
  assert.ok(docRows().length < 22, 'temporary trailing space removed after collapse');
} finally { restore(); restoreWidgets(); tui.stop(); }
assert.equal(tui.layoutRoot, originalRoot);
for (const dock of docks) assert.equal(Object.hasOwn(dock, 'handleMouse'), false);
// Unknown/ambiguous structures disable only sticky support; ordinary folding still works.
for (const root of [new HStack([scroll]), new VStack([scroll, new ScrollView(new Text('other'), { primary: true })])]) {
  tui.setLayoutRoot(root);
  const fallback = attachTranscript(tui, view);
  assert.ok(fallback);
  assert.equal(tui.layoutRoot, root);
  document.render(80); view.toggleTool('first');
  assert.match(document.render(80).join('\n'), /first_69/);
  view.toggleTool('first'); fallback();
}
assert.equal(attachStickyTool({ mode: 'fullscreen' }, document, view), undefined);
// Simulate a Pi version without the optional internal export: extension still loads.
tui.setLayoutRoot(originalRoot);
const originalLoad = Module._load;
try {
  Module._load = function (specifier, ...args) {
    if (specifier === '@earendil-works/pi-tui/dist/layout-node.js') throw new Error('optional API missing');
    return originalLoad.call(this, specifier, ...args);
  };
  const fallback = attachTranscript(tui, view);
  assert.ok(fallback); assert.equal(tui.layoutRoot, originalRoot);
  view.toggleTool('first'); assert.match(document.render(80).join('\n'), /first_69/);
  view.toggleTool('first'); fallback();
} finally { Module._load = originalLoad; }
// Full extension session_start mounting, including the widget + transcript stack.
const configDir = await mkdtemp(join(tmpdir(), 'sticky-extension-'));
const oldAgentDir = process.env.MINI_LENS_AGENT_DIR;
process.env.MINI_LENS_AGENT_DIR = configDir;
const handlers = new Map();
const branch = [
  { type: 'message', message: { role: 'user', content: 'extension sticky integration' } },
  { type: 'message', message: { role: 'assistant', content: ['A', 'B'].map(id => ({ type: 'toolCall', id, name: 'bash', arguments: { command: `EXT_${id}` } })) } },
  ...['A', 'B'].map(id => ({ type: 'message', message: { role: 'toolResult', toolCallId: id, toolName: 'bash', content: [{ type: 'text', text: id === 'A' ? 'LONG_A\n'.repeat(80) : 'SHORT_B' }], isError: false } })),
];
const ctx = { mode: 'tui', hasUI: true, sessionManager: { getBranch: () => branch }, ui: {
  theme, setFooter() {}, notify() {}, onTerminalInput(listener) { return tui.addInputListener(listener); },
  setWidget(_name, factory) { factory?.(tui, theme); },
} };
try {
  await writeFile(join(configDir, 'mini-lens.json'), JSON.stringify({ 'mini-lens-minimal-show': true, onboardingCompleted: true }));
  extension({ events: { on() { return () => {}; } }, on(name, fn) { handlers.set(name, fn); }, registerCommand() {}, registerEntryRenderer() {}, appendEntry() {} });
  tui.setLayoutRoot(originalRoot);
  await handlers.get('session_start')({}, ctx);
  await handlers.get('message_start')({ message: { role: 'assistant', content: [] } }, ctx);
  tui.start(); await paint();
  scroll.scrollTo(0); tui.renderNow(); await paint();
  let y = docRows().findIndex(row => row.includes('bash EXT_A'));
  click(3, y); await paint();
  assert.match(screen()[0], /▾ bash EXT_A/);
  y = docRows().findIndex(row => row.includes('bash EXT_B'));
  scroll.scrollTo(y - 3); await paint();
  click(3, y - scroll.scrollTop + 1); await paint(); await paint();
  assert.match(screen()[0], /▾ bash EXT_B/);
  assert.match(screen()[1], /SHORT_B/);
  assert.equal(scroll.isFollowingEnd, false);
  terminal.rows = 48; await paint(); await paint();
  editorText.setText('ONE_ROW_DOCK'); await paint(); await paint();
  assert.match(screen()[0], /▾ bash EXT_B/);
  assert.match(screen()[1], /SHORT_B/);
  const readingTop = scroll.scrollTop;
  assert.equal(scroll.isFollowingEnd, false);
  await handlers.get('tool_execution_update')({ toolCallId: 'B', toolName: 'bash', partialResult: { content: [{ type: 'text', text: 'SHORT_B\n' + 'LIVE_B\n'.repeat(80) }] } }, ctx);
  await paint(); await paint();
  assert.match(screen()[0], /▾ bash EXT_B/);
  assert.match(screen()[1], /SHORT_B/);
  assert.match(docRows().join('\n'), /LIVE_B/, 'real update reached the expanded tool');
  assert.equal(scroll.scrollTop, readingTop, 'real extension tool update retains reading position');
  assert.equal(scroll.isFollowingEnd, false, 'real extension tool update retains suppressed follow');
} finally {
  await handlers.get('session_shutdown')?.({}, ctx);
  tui.stop();
  assert.equal(tui.layoutRoot, originalRoot);
  if (oldAgentDir === undefined) delete process.env.MINI_LENS_AGENT_DIR;
  else process.env.MINI_LENS_AGENT_DIR = oldAgentDir;
  await rm(configDir, { recursive: true, force: true });
}
console.log('Sticky tool PASS: real SGR top heading, rows/dynamic-dock resize, pinned A to short B streaming, full extension mounting/tool update, wheel persistence/exit, native copy/links, widths, restore and fail-closed.');
