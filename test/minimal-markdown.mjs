import assert from 'node:assert/strict';
import { register } from 'node:module';
import { visibleWidth } from '@earendil-works/pi-tui';
import { initTheme, getThemeByName } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import { minimalSurface } from '../lib/minimal-theme.ts';
import { diagramMarkdown } from '../lib/minimal-markdown.ts';
const moduleUrl = new URL('../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js', import.meta.url).href;
const stub = `data:text/javascript,${encodeURIComponent(`export const CONFIG_DIR_NAME = '.pi'; export { getMarkdownTheme, getSettingsListTheme } from '${moduleUrl}';`)}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){if(s==='@earendil-works/pi-coding-agent')return {shortCircuit:true,url:${JSON.stringify(stub)}};return n(s,c)}`)}`, import.meta.url);
const { minimalOutputComponent } = await import('../extensions/footer-status.ts');
const plain = text => text.replace(/\x1b\[[0-9;]*m/g, '');
const diagram = '```mermaid\nflowchart LR\nA[Start] --> B[End]\n```';
assert.match(diagramMarkdown(diagram, 100), /┌/);
assert.match(diagramMarkdown(diagram, 2), /```mermaid/);
assert.match(diagramMarkdown('```mermaid\nunknown graph\n```', 100), /unknown graph/);
for (const name of ['dark', 'light']) {
  initTheme(name, false);
  const theme = getThemeByName(name);
  const turn = { question: '**User**\n\n> quote', process: ['thinking **plan**\n\n```js\nconst count = 1;\n```'], running: true, final: '# Answer\n\n| Name | Value |\n| --- | --- |\n| First | 42 |\n\n```js\nconst value = 42;\n```\n\n' + diagram };
  let expanded = false;
  const view = minimalOutputComponent(theme, () => [turn], () => expanded);
  assert.equal(view.render(100).filter(line => plain(line).includes("const count")).length, 1);
  expanded = true;
  assert.match(plain(view.render(100).join("\n")), /const count/);
  assert.ok(view.render(100).filter(line => plain(line).includes("const count")).every(line => !/\x1b\[48;/.test(line)));
  for (const width of [1, 2, 12, 40, 100]) {
    const lines = view.render(width);
    assert.ok(lines.every(line => visibleWidth(line) <= width), `${name}/${width}: width overflow`);
  }
  // Add a sibling after a multi-line Markdown entry so every detail row must
  // carry the continuation rail, including blank lines and fenced code.
  turn.process.push('skill final-sibling');
  const connected = view.render(100).map(plain);
  const first = connected.findIndex(row => row.startsWith('├─'));
  const last = connected.findIndex(row => row.startsWith('└─'));
  assert.ok(last > first + 1);
  assert.ok(connected.slice(first + 1, last).every(row => row.startsWith('│  ')));
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
