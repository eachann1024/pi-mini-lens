import assert from 'node:assert/strict';
import { Container, Text, visibleWidth } from '@earendil-works/pi-tui';
import { initTheme, getThemeByName } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import { agentCall, agentCallRows, attachAgentWidgets, restyleAgentWidget } from '../lib/agent-view.ts';
const clean = text => text.replace(/\x1b\[[0-9;]*m/g, '');
for (const name of ['dark', 'light']) {
  initTheme(name, false);
  const theme = getThemeByName(name);
  const calls = [agentCall('1', 'subagent', { agent: 'research', task: 'Investigate' }), agentCall('2', 'Agent', { subagent_type: 'review', prompt: 'Review' })];
  calls[1].state = 'error';
  calls[1].output = 'Review failed';
  for (const width of [1, 12, 40, 100]) {
    for (const expanded of [false, true]) {
      const rows = agentCallRows(calls, theme, width, expanded, text => [text]);
      assert.ok(rows.every(row => visibleWidth(row) <= width));
      assert.ok(rows.every(row => !/\x1b\[48;/.test(row)));
    }
  }
  assert.equal(agentCallRows(calls, theme, 100, false, text => [text]).length, 1);
  assert.match(clean(agentCallRows(calls, theme, 100, true, text => [text]).join('\n')), /Review failed/);
  let expanded = false;
  let native = ['async subagent · background', '● reviewer · running · 3 turns', 'task: Review changes', 'Press ctrl+option+o for live detail', 'output: /tmp/output.log'];
  const host = { children: Array.from({ length: 7 }, () => new Container()) };
  const widgets = host.children[3];
  widgets.addChild({ render: () => native, invalidate() {} });
  widgets.addChild(new Text('UNRELATED', 0, 0));
  const original = widgets.render;
  const restore = attachAgentWidgets(host, theme, () => expanded);
  assert.equal(widgets.render(100).length, 2);
  assert.match(clean(widgets.render(100).join('\n')), /后台 Agents.*running/);
  expanded = true;
  assert.match(clean(widgets.render(100).join('\n')), /ctrl\+option\+o/);
  native = ['Async agents · background', '✗ reviewer · failed', 'error: model unavailable'];
  expanded = false;
  assert.match(clean(widgets.render(100).join('\n')), /failed/);
  assert.match(clean(widgets.render(100).join('\n')), /UNRELATED/);
  const unknown = ['Different widget', 'running'];
  assert.equal(restyleAgentWidget(unknown, theme, 100, false), unknown);
  restore();
  assert.equal(widgets.render, original);
  assert.match(widgets.render(100).join('\n'), /model unavailable/);
}
console.log('Agent views: aggregation, failure, live widgets, restore, dark/light, widths PASS');
