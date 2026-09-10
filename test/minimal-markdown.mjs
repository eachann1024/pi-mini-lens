import assert from 'node:assert/strict';
import { register } from 'node:module';
import { visibleWidth } from '@earendil-works/pi-tui';
import { initTheme, getThemeByName } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import { minimalSurface, secondaryAccent } from '../lib/minimal-theme.ts';
import { diagramMarkdown, normalizeProseMarkdown } from '../lib/minimal-markdown.ts';
const moduleUrl = new URL('../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js', import.meta.url).href;
const stub = `data:text/javascript,${encodeURIComponent(`export const CONFIG_DIR_NAME = '.pi'; export { getMarkdownTheme, getSettingsListTheme } from '${moduleUrl}';`)}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){if(s==='@earendil-works/pi-coding-agent')return {shortCircuit:true,url:${JSON.stringify(stub)}};return n(s,c)}`)}`, import.meta.url);
const { minimalOutputComponent, minimalTurnsFromBranch } = await import('../extensions/footer-status.ts');
const plain = text => text.replace(/\x1b\[[0-9;]*m/g, '');
const diagram = '```mermaid\nflowchart LR\nA[Start] --> B[End]\n```';
const screenshotReply = '**Hono 完全可以接收上报；放 Java 不是技术限制，而是复用现有日志出口。 **我刚核对了 PR 的实现。\n\n现在 Java 的 `AiErrorLogController.java` 做了三件事：\n- 复用 Java 的登录会话认证；\n- 用内部 Token 接收 Agent 错误；\n- 通过现有 **KnowallLog.post** 发到日志平台。';
for (const source of [
  '`**literal。 **`', '```md\n**literal。 **\n```', '    **literal。 **\n',
  '\\*\\*literal。 \\*\\*', '[link](https://example.com/**path**)',
  '**valid** and ***nested***', '**still streaming',
  'a * b * c', 'file__name__part', '\\**literal。 **',
  '```md\n*中文。*后续\n~~中文。 ~~后续\n```',
  '[link](https://example.com/__path__ "**title。 **")',
]) assert.equal(normalizeProseMarkdown(source), source);
assert.equal(normalizeProseMarkdown('**中文。**后续'), '**中文**。后续');
assert.equal(normalizeProseMarkdown('- **中文。 **后续'), '- **中文**。 后续');
assert.equal(normalizeProseMarkdown('> **中文。 **后续'), '> **中文**。 后续');
const proseCases = [
  ['**PTY_FINAL。 **后续', '**PTY_FINAL**。 后续'],
  ['**含 `code` 的中文。 **后续', '**含 `code` 的中文**。 后续'],
  ['**含 [链接](https://example.com) 的中文。 **后续', '**含 [链接](https://example.com) 的中文**。 后续'],
  ['> 第一行\n> **中文。 **后续', '> 第一行\n> **中文**。 后续'],
  ['- 第一行\n  **中文。 **后续', '- 第一行\n  **中文**。 后续'],
  ['| 列 |\n|---|\n| **中文。 **后续 |', '| 列 |\n|---|\n| **中文**。 后续 |'],
  ['*中文。*后续', '*中文*。后续'],
  ['~~中文。~~后续', '~~中文~~。后续'],
  ['__中文。__后续', '**中文**。后续'],
  ['**加粗 *斜体* 中文。 **后续', '**加粗 *斜体* 中文**。 后续'],
  ['> 外层\n> > **内层。 **后续', '> 外层\n> > **内层**。 后续'],
  ['- 外层\n  - **内层。 **后续', '- 外层\n  - **内层**。 后续'],
  ['# **标题。 **后续', '# **标题**。 后续'],
  ['- [x] **完成。 **后续', '- [x] **完成**。 后续'],
];
for (const [source, expected] of proseCases) {
  assert.equal(normalizeProseMarkdown(source), expected);
  assert.equal(normalizeProseMarkdown(expected), expected, 'normalization is idempotent');
}
assert.match(diagramMarkdown(diagram, 100), /┌/);
assert.match(diagramMarkdown(diagram, 2), /```mermaid/);
assert.match(diagramMarkdown('```mermaid\nunknown graph\n```', 100), /unknown graph/);
for (const name of ['dark', 'light']) {
  initTheme(name, false);
  const theme = getThemeByName(name);
  const replyTurn = { question: '', process: [], final: screenshotReply };
  const replyView = minimalOutputComponent(theme, () => [replyTurn]);
  for (const width of [12, 40, 100]) {
    const rows = replyView.render(width);
    assert.doesNotMatch(plain(rows.join('\n')), /\*\*/);
    assert.ok(rows.every(row => visibleWidth(row) <= width));
  }
  const reply = replyView.render(160).join('\n');
  assert.ok(reply.includes(theme.bold('Hono 完全可以接收上报；放 Java 不是技术限制，而是复用现有日志出口')));
  assert.ok(reply.includes(theme.fg('mdHeading', theme.bold('Hono 完全可以接收上报；放 Java 不是技术限制，而是复用现有日志出口'))), 'CJK and Latin receive the same emphasis color');
  assert.match(plain(reply), /AiErrorLogController.java/);
  for (const [source] of proseCases) {
    for (const width of [12, 40, 100]) {
      const rows = minimalOutputComponent(theme, () => [{ question: '', process: [], final: source }]).render(width);
      assert.doesNotMatch(plain(rows.join('\n')), /\*\*|__|~~|\*中文/);
      assert.ok(rows.every(row => visibleWidth(row) <= width), `${name}/${width}: ${source}`);
    }
  }
  replyTurn.final = '**尚未结束';
  assert.match(plain(replyView.render(100).join('\n')), /尚未结束/);
  replyTurn.final += '。 **继续';
  assert.doesNotMatch(plain(replyView.render(100).join('\n')), /\*\*/);
  const receiptView = minimalOutputComponent(theme, () => [{ question: 'Q', process: ['call workflow'], agentCalls: [{ id: 'workflow', name: 'subagent', task: 'launch', state: 'done', output: 'Run fan-out: 0/64 used\nAsync workflow [run-123]\nThe async run is detached and running in the background.' }] }], () => true);
  const receiptRows = plain(receiptView.render(160).join('\n'));
  assert.match(receiptRows, /Control subagent · dispatch · returned/);
  assert.doesNotMatch(receiptRows, /Run fan-out|The async run is detached/);
  const secondary = secondaryAccent(theme, 'body');
  assert.equal(plain(secondary), 'body');
  assert.notEqual(secondary, theme.fg('accent', 'body'));
  assert.notEqual(secondary, theme.fg('text', 'body'));
  const output = minimalOutputComponent(theme, () => [{ question: 'Q', process: ['output body'], running: false }]).render(100).join('\n');
  assert.match(plain(output), /Output body/);
  assert.ok(output.includes(secondary));
  const turn = { question: '**User**\n\n> quote', process: ['thinking **plan**\n\n```js\nconst count = 1;\n```'], running: true, final: '# Answer\n\n| Name | Value |\n| --- | --- |\n| First | 42 |\n\n```js\nconst value = 42;\n```\n\n' + diagram };
  const usageTurns = minimalTurnsFromBranch([
    { type: 'message', message: { role: 'user', content: 'first' } },
    { type: 'message', message: { role: 'assistant', content: [], usage: { totalTokens: 1100000, cacheRead: 80000 } } },
    { type: 'message', message: { role: 'toolResult', content: [], usage: { totalTokens: 100000, cacheRead: 10000 } } },
    { type: 'message', message: { role: 'user', content: 'second' } },
    { type: 'message', message: { role: 'assistant', content: [], usage: { input: 10, output: 20 } } },
  ]);
  const usageView = minimalOutputComponent(theme, () => usageTurns, () => false, () => false);
  const hiddenUsageView = minimalOutputComponent(theme, () => usageTurns, () => false, () => false, () => false);
  assert.doesNotMatch(plain(hiddenUsageView.render(100).join('\n')), /S 1.2M|C 90K|Ctrl\+O/);
  const headers = usageView.render(100).filter(line => plain(line).startsWith('Agent'));
  assert.match(plain(headers[0]), /S 1.2M \/ C 90K$/);
  assert.match(plain(headers[1]), /S 30 \/ C 0$/);
  assert.ok(headers.every(line => visibleWidth(line) === 100));
  usageTurns[1].pendingUsage = { input: 5, output: 5 };
  assert.match(plain(usageView.render(100).join('\n')), /S 40 \/ C 0/);
  assert.match(plain(usageView.render(100).join('\n')), /S 40 \/ C 0/, 'repeated renders must not accumulate streaming usage');
  for (const width of [1, 12, 30, 40]) assert.ok(usageView.render(width).every(line => visibleWidth(line) <= width));
  const styled = minimalOutputComponent(theme, () => [{ question: '', process: ['thinking **bold** *italic* [link](https://example.com)'], running: true, thinking: 0 }]).render(100).find(line => plain(line).includes('Thinking'));
  assert.doesNotMatch(plain(styled), /\*\*|\*italic\*/);
  assert.ok(styled.includes(theme.fg('accent', theme.bold('Thinking'))));
  const toolRow = minimalOutputComponent(theme, () => [{ question: '', process: ['call t'], agentCalls: [{ id: 't', name: 'subagent', task: 'Requesting exact model IDs', state: 'running' }] }]).render(100).find(line => plain(line).includes('subagent'));
  assert.equal(toolRow, undefined, 'management calls are hidden from compact progress');
  if (theme.bold("probe").includes("\x1b[1m")) {
    assert.match(styled, /\x1b\[1m/);
    assert.match(styled, /\x1b\[3m/);
    assert.match(styled, /\x1b\[4m/);
  }
  let expanded = false;
  const view = minimalOutputComponent(theme, () => [turn], () => expanded);
  assert.equal(view.render(100).filter(line => plain(line).includes("const count")).length, 0);
  expanded = true;
  assert.doesNotMatch(plain(view.render(100).join("\n")), /const count/);
  assert.ok(view.render(100).filter(line => plain(line).includes("const count")).every(line => !/\x1b\[48;/.test(line)));
  for (const width of [1, 2, 12, 40, 100]) {
    const lines = view.render(width);
    assert.ok(lines.every(line => visibleWidth(line) <= width), `${name}/${width}: width overflow`);
  }
  // Expanding reveals more entries, never repeats their full body.
  turn.process.push('skill final-sibling');
  const connected = view.render(100).map(plain);
  const first = connected.findIndex(row => row.startsWith('├─'));
  const last = connected.findIndex(row => row.startsWith('└─'));
  assert.equal(last, first + 1);
  const compactTurn = { question: 'Q', process: ['thinking Checking fixtures', 'call read', 'call failed'], agentCalls: [
    { id: 'read', name: 'read', task: 'src/example.ts', state: 'done', output: 'SOURCE_NOISE\n'.repeat(100) },
    { id: 'failed', name: 'bash', task: 'npm test', state: 'error', output: 'Test failed\nline 1\nline 2\nline 3\nline 4\nline 5\nline 6' },
  ] };
  const compact = minimalOutputComponent(theme, () => [compactTurn], () => true).render(120).map(plain).join('\n');
  assert.equal(compact.split('Checking fixtures').length - 1, 1);
  assert.match(compact, /read src\/example.ts/);
  assert.doesNotMatch(compact, /SOURCE_NOISE|line 5|line 6/);
  assert.equal(compact.split('Test failed').length - 1, 1);
  assert.match(compact, /line 4/);
  assert.match(compact, /\+2 lines/);
  const rendered = plain(view.render(100).join('\n'));
  assert.match(rendered, /Answer/);
  assert.match(rendered, /const value = 42/);
  assert.match(rendered, /┌/);
  assert.doesNotMatch(rendered, /\*\*User\*\*|```mermaid/);
  turn.final += '\n\nStreaming continuation';
  assert.match(plain(view.render(100).join('\n')), /Streaming continuation/);
}
for (const mode of ['truecolor', '256color']) {
  const theme = { getBgAnsi: () => '\x1b[48;2;240;240;240m', fg: () => '\x1b[38;2;30;180;80m', getColorMode: () => mode };
  const user = minimalSurface(theme, 'text\x1b[0mmore', true);
  const secondary = minimalSurface(theme, 'text', false);
  assert.notEqual(user.split('text')[0], secondary.split('text')[0]);
  assert.ok(user.includes('\x1b[0m' + user.split('text')[0]), 'inline resets restore background');
}
console.log('Markdown: dark/light, streaming, tables, code, Mermaid, narrow widths and accent surfaces PASS');
