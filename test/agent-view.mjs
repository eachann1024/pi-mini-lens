import assert from 'node:assert/strict';
import { Container, Text, visibleWidth } from '@earendil-works/pi-tui';
import { initTheme, getThemeByName } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import { register } from 'node:module';
const themeUrl = new URL('../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){if(s==='@earendil-works/pi-coding-agent')return {shortCircuit:true,url:${JSON.stringify(themeUrl)}};return n(s,c)}`)}`, import.meta.url);
const { agentCall, agentCallRows, attachAgentWidgets, restyleAgentWidget, liveAgentRows, readAgentStatuses, currentAgentStatuses, liveAgentView, agentCallDisplay, isAgentTool, RUNNING_FRAMES, runningGlyph } = await import('../lib/agent-view.ts');
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const clean = text => text.replace(/\x1b\[[0-9;]*m/g, '');
for (const name of ['dark', 'light']) {
  initTheme(name, false);
  const theme = getThemeByName(name);
  // liveAgentView: runtime model heading, full-width activity, terminal expiry and identities.
  const clock = 50_000;
  const deadlines = new Map();
  const snapshot = [{ runId: 'ui-child', mode: 'single', state: 'running', startedAt: 100,
    steps: [{ agent: 'worker', workflowKey: 'review', model: '9router/GPT-6Astra:high', status: 'running',
      recentTools: [null, { tool: 'read', args: '\x1b[31m中文路径.ts\x1b[0m', endMs: clock }], recentOutput: [] }] }];
  const originalSnapshot = JSON.stringify(snapshot);
  const render = (at, width = 120, expanded = false) => liveAgentView(snapshot, theme, width, expanded, true, deadlines, at);
  const first = render(clock).rows[0];
  assert.match(clean(first), /SubAgent • GPT-6Astra high : read 中文路径.ts/);
  assert.doesNotMatch(clean(first), /worker|review|running|9router/);
  assert.ok(first.includes(theme.fg('accent', theme.bold('SubAgent'))));
  assert.ok(first.includes(theme.fg('muted', ' high')));
  assert.ok(first.includes(theme.fg('text', 'read 中文路径.ts')));
  for (let width = 1; width <= 160; width++) {
    const row = render(clock, width).rows[0];
    assert.equal(visibleWidth(row), width, `CJK/ANSI exact width ${width}`);
    if (width >= 36) assert.match(clean(row), /SubAgent • GPT-6Astra high : /, 'heading stays intact when it fits');
  }
  snapshot[0].steps[0].recentTools.push({ tool: 'bash', args: 'npm test ' + '中文🙂 very-long-activity '.repeat(12), endMs: clock });
  const frameA = render(clock).rows[0], frameB = render(clock + 2000).rows[0];
  assert.notEqual(clean(frameA).split(' : ')[1], clean(frameB).split(' : ')[1], 'overflowing activity still scrolls');
  assert.equal(clean(frameA).split(' : ')[0], clean(frameB).split(' : ')[0], 'model heading never scrolls');
  const fullWidth = structuredClone(snapshot);
  fullWidth[0].steps[0].recentTools = [];
  fullWidth[0].steps[0].recentOutput = ['x'.repeat(200)];
  for (const width of [40, 80, 120, 160]) for (const expanded of [false, true]) {
    const row = liveAgentView(fullWidth, theme, width, expanded, true, new Map(), clock).rows[0];
    const heading = `└─ ${runningGlyph(clock)} SubAgent • GPT-6Astra high : `;
    assert.equal(clean(row), heading + 'x'.repeat(width - visibleWidth(heading)), 'body occupies every remaining column, no reserved right area');
    assert.ok(row.includes(theme.fg('muted', ' high')), 'thinking stays gray even when expanded');
  }
  for (let width = 1; width <= 160; width++) {
    assert.equal(visibleWidth(render(clock + 2000, width).rows[0]), width, `scrolling CJK/emoji width ${width}`);
  }
  const noModel = [{ runId: 'unknown', steps: [{ agent: 'worker', status: 'running', recentOutput: ['waiting for model'] }] }];
  assert.doesNotMatch(clean(liveAgentView(noModel, theme, 80).rows[0]), /worker|undefined|null/);
  snapshot[0].state = 'complete';
  snapshot[0].steps[0].recentTools = [{ tool: 'read', args: 'result.ts', endMs: clock }];
  assert.match(clean(render(clock).rows[0]), /✓ SubAgent • GPT-6Astra high : read result.ts/);
  assert.equal(render(clock + 9999).total, 1);
  assert.equal(render(clock + 10000).total, 0);
  assert.equal(render(clock + 10001, 120, true).total, 0, 'Ctrl+S cannot revive expired rows');
  snapshot[0].endedAt = clock + 10001;
  assert.equal(render(clock + 10002).total, 0, 'repeated terminal updates do not extend deadline');
  snapshot[0].startedAt = clock + 11000;
  snapshot[0].state = 'running';
  assert.equal(render(clock + 12000).running, 1, 'new attempt is not removed by old deadline');
  snapshot[0].state = 'complete';
  snapshot[0].endedAt = clock + 12000;
  assert.equal(render(clock + 12000).total, 1);
  assert.equal(render(clock + 22000).total, 0);
  const twins = ['one', 'two'].map(runId => ({ runId, workflowChildren: { children: [{ childId: 'same', agent: 'worker', state: 'complete' }] } }));
  const isolated = new Map();
  assert.equal(liveAgentView([twins[0]], theme, 100, false, false, isolated, clock).total, 1);
  assert.equal(liveAgentView(twins, theme, 100, false, false, isolated, clock + 10000).total, 1, 'same childId in different workflows is isolated');
  const historic = [{ runId: 'historic', mode: 'single', state: 'complete', endedAt: clock - 10000, steps: [{ agent: 'worker' }] }];
  assert.equal(liveAgentView(historic, theme, 100, true, false, new Map(), clock).total, 0, 'restoring old terminal snapshot never revives it');
  const frozen = JSON.parse(originalSnapshot);
  liveAgentView(frozen, theme, 100);
  assert.equal(JSON.stringify(frozen), originalSnapshot, 'source snapshot is not mutated');
  for (const [tool, action] of [['subagent', 'list'], ['subagent', 'status'], ['subagent_supervisor', 'reply'], ['subagent', 'run']]) {
    const call = agentCall('control', tool, { action });
    call.state = 'done';
    call.output = 'Executable agents (capabilities):\nORIGINAL_DIAGNOSTIC';
    assert.ok(isAgentTool(call.tool));
    assert.doesNotMatch(agentCallDisplay(call).summary, /Executable agents/);
    assert.equal(agentCallDisplay(call).detail, call.output, 'raw diagnostic retained');
  }
  const markdownActivity = '**含 `code` 的中文。 **后续';
  const markdownStatuses = [{ runId: 'markdown', steps: [{ agent: 'scout', status: 'running', recentOutput: [markdownActivity] }] }];
  for (const width of [12, 40, 100]) {
    const live = liveAgentRows(markdownStatuses, theme, width);
    const widget = restyleAgentWidget(['Async agents', '● scout · running', markdownActivity], theme, width, true);
    for (const rows of [live, widget]) {
      assert.doesNotMatch(clean(rows.join('\n')), /\*\*|`code`/);
      assert.ok(rows.every(row => visibleWidth(row) <= width));
    }
  }
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
  const statuses = [{ runId: 'workflow', steps: Array.from({ length: 40 }, (_, i) => ({ runId: `child-${i}`, agent: 'reviewer', model: 'openai/gpt-5', thinking: 'low', currentTool: `read file-${i}`, status: 'running' })) }];
  for (const width of [1, 12, 100]) {
    const all = liveAgentRows(statuses, theme, width);
    assert.equal(all.length, 41, 'every child has exactly one row, no count cap');
    assert.ok(all.every(row => visibleWidth(row) <= width));
  }
  assert.match(clean(liveAgentRows(statuses, theme, 100).at(-1)), /SubAgent • gpt-5 low : read file-39/);
  const liveHost = { children: Array.from({ length: 7 }, () => new Container()) };
  const restoreLive = attachAgentWidgets(liveHost, theme, () => true, () => statuses);
  for (const title of ['Async agents', '● subagents (40 running)', '├─ async workflow: new — background', ...RUNNING_FRAMES.map(frame => `${frame} Async agents · background`)]) {
    liveHost.children[3].clear();
    liveHost.children[3].addChild(new Text(title, 0, 0));
    const firstFrame = liveHost.children[3].render(100);
    assert.equal(firstFrame.length, 41);
    assert.doesNotMatch(clean(firstFrame.join('\n')), /async workflow|Async agents|subagents \(/);
  }
  statuses[0].steps.push({ runId: 'new-child', agent: 'reviewer', model: 'gpt-5', thinking: 'high', currentTool: 'write new.ts' });
  assert.equal(liveHost.children[3].render(100).length, 42);
  liveHost.children[5].addChild(new Text('⠇ Async agents · background', 0, 0));
  assert.deepEqual(liveHost.children[5].render(100), [], 'native panel stays hidden below editor too');
  restoreLive();
  assert.equal(new Set(RUNNING_FRAMES.map((_, i) => runningGlyph(i * 100))).size, RUNNING_FRAMES.length);
  const starting = [{ runId: 'starting', workflowChildren: { children: [{ childId: 'a', agent: 'scout', state: 'running' }] } }];
  assert.equal(liveAgentRows(starting, theme, 100).length, 2, 'inventory visible before steps are populated');
  const outputStatus = [{ runId: 'details', steps: [{ agent: 'scout', recentOutput: ['FIRST_DETAIL', 'LATEST'], status: 'running' }] }];
  assert.equal(liveAgentRows(outputStatus, theme, 100).length, 2);
  assert.equal(liveAgentRows(outputStatus, theme, 100, true).length, 2, 'expanded children also stay on one row');
  assert.doesNotMatch(clean(liveAgentRows(outputStatus, theme, 100, true).join('\n')), /FIRST_DETAIL/);
  for (const state of ['queued', 'running', 'completed', 'failed']) {
    const step = outputStatus[0].steps[0];
    step.status = state;
    step.error = state === 'failed' ? 'Model unavailable' : undefined;
    for (const expanded of [false, true]) {
      const rows = liveAgentRows(outputStatus, theme, 100, expanded).map(clean);
      assert.equal(rows.length, 2, `${state}: terminal rows remain briefly`);
      if (rows.length === 1) continue;
      assert.match(rows[1], state === 'failed' ? /^└─ × / : state === 'completed' ? /^└─ ✓ / : /^└─ [\u2800-\u28ff] /);
    }
  }
  const parentStatus = { runId: 'parent', toolCallId: 'current-call', mode: 'workflow', steps: [{ runId: 'child', agent: 'delegate', status: 'completed' }] };
  const child = { runId: 'child', parentWorkflowRunId: 'parent', mode: 'single', steps: [{ agent: 'delegate', model: 'gpt-5', thinking: 'low', recentOutput: ['Actual result'], status: 'completed' }] };
  const history = { runId: 'old', toolCallId: 'old-call', steps: [{ agent: 'reviewer' }] };
  assert.deepEqual(currentAgentStatuses([history, child, parentStatus], ['current-call']), [child, parentStatus]);
  assert.deepEqual(currentAgentStatuses([history, child, parentStatus], []), []);
  for (const order of [[child, parentStatus], [parentStatus, child]]) {
    const rows = liveAgentRows(order, theme, 100, true).map(clean);
    assert.equal(rows.length, 2, 'workflow summary and actual child merge into one row');
    assert.match(rows[0], /Sub Agent · running 0 · done 1/);
    assert.match(rows[1], /✓ SubAgent • gpt-5 low : Actual result/);
    assert.doesNotMatch(rows.join('\n'), /delegate : completed|─{3}/);
  }
  const staleParent = { ...parentStatus, steps: [{ runId: 'child', agent: 'delegate', label: 'Receiver contract', status: 'running' }] };
  const completedChild = { ...child, state: 'completed', steps: [{ ...child.steps[0], status: 'running' }] };
  for (const order of [[completedChild, staleParent], [staleParent, completedChild]]) {
    assert.equal(liveAgentRows(order, theme, 100).length, 2, 'terminal child snapshot overrides stale parent and step state');
    const rows = liveAgentRows(order, theme, 100, true).map(clean);
    assert.match(rows[0], /running 0 · done 1/);
    assert.match(rows[1], /✓ SubAgent • gpt-5 low : Actual result/);
  }
  const mixed = [{ runId: 'mixed', steps: Array.from({ length: 9 }, (_, i) => ({
    runId: `mixed-${i}`, agent: 'loop', status: i < 4 ? 'completed' : 'running', activityState: 'active_long_running',
  })) }];
  const mixedRows = liveAgentRows(mixed, theme, 100).map(clean);
  assert.equal(mixedRows.length, 10);
  assert.match(mixedRows[0], /running 5 · done 4/);
  assert.equal(visibleWidth(mixedRows[0]), 100, 'summary is right aligned');
  assert.doesNotMatch(mixedRows.join('\n'), /active_long_running|4\/9/);
  assert.equal(liveAgentRows(mixed, theme, 100, true).length, 10);
  const fleetHost = { children: Array.from({ length: 7 }, () => new Container()) };
  let clicked = false;
  let fleet = ['5 active agents · ↓ 540.3k tokens · ↓/← to inspect'];
  fleetHost.children[5].addChild({ render: () => fleet, invalidate() {}, handleMouse() { clicked = true; } });
  const restoreFleet = attachAgentWidgets(fleetHost, theme, () => false, () => mixed);
  assert.deepEqual(fleetHost.children[5].render(100), []);
  fleet = ['↑↓/jk select · enter inspect · esc back', 'main'];
  assert.deepEqual(fleetHost.children[5].render(100), fleet, 'interactive fleet stays available');
  fleetHost.children[5].handleMouse({ y: 0, width: 100 });
  assert.ok(clicked, 'unrelated native interaction is preserved');
  fleet = ['5 active agents · 2 panes · ↓/← to inspect'];
  assert.deepEqual(fleetHost.children[5].render(100), fleet, 'pane information stays visible');
  restoreFleet();
  const inlineHost = { children: Array.from({ length: 7 }, () => new Container()) };
  for (const index of [3, 5]) {
    inlineHost.children[index].addChild(new Text('Async agents', 0, 0));
    inlineHost.children[index].addChild(new Text('5 active agents · inspect', 0, 0));
    inlineHost.children[index].addChild(new Text('UNRELATED', 0, 0));
  }
  const restoreInline = attachAgentWidgets(inlineHost, theme, () => false, undefined, true);
  for (const index of [3, 5]) assert.equal(clean(inlineHost.children[index].render(100).join('\n')).trim(), 'UNRELATED');
  restoreInline();
  assert.match(clean(inlineHost.children[3].render(100).join('\n')), /Async agents/);
  let expanded = false;
  let native = ['async subagent · background', '● reviewer · running · 3 turns', 'task: Review changes', 'Press ctrl+option+o for live detail', 'output: /tmp/output.log'];
  const host = { children: Array.from({ length: 7 }, () => new Container()) };
  const widgets = host.children[3];
  widgets.addChild({ render: () => native, invalidate() {} });
  widgets.addChild(new Text('UNRELATED', 0, 0));
  const original = widgets.render;
  const restore = attachAgentWidgets(host, theme, () => expanded);
  assert.equal(widgets.render(100).length, 3);
  assert.match(clean(widgets.render(100).join('\n')), /Sub Agent[\s\S]*reviewer : task: Review changes/);
  expanded = true;
  assert.doesNotMatch(clean(widgets.render(100).join('\n')), /ctrl\+option\+o|Fleet/);
  assert.equal(widgets.render(100).length, 3, 'expanding never adds child detail rows');
  const grouped = restyleAgentWidget(['Async agents', '● first · running', 'task: first task', 'Press ctrl+option+o for live detail · Ctrl+Alt+F Fleet', 'output: first.log', '● second · done', 'task: second task'], theme, 100, true);
  const blockRows = grouped.map(clean);
  assert.equal(blockRows.filter(row => /^[├└]─ /.test(row)).length, 2);
  assert.equal(blockRows.length, 3);
  assert.doesNotMatch(blockRows.join('\n'), /─{3}/);
  assert.doesNotMatch(blockRows.join('\n'), /Press|Fleet/);
  for (const width of [1, 12, 40]) assert.ok(restyleAgentWidget(native, theme, width, true).every(row => visibleWidth(row) <= width));
  native = ['Async agents · background', '● reviewer · running (gpt-5 · thinking low)', '⎿  Reading **source**'];
  expanded = false;
  const live = widgets.render(100).join('\n');
  assert.match(clean(live), /└─ [\u2800-\u28ff] reviewer · gpt-5 low : Reading source/);
  assert.ok(live.includes(theme.fg('accent', theme.bold('gpt-5'))));
  assert.ok(live.includes(theme.fg('muted', ' low')));
  assert.ok(!theme.fg('muted', ' low').includes('\x1b[1m'));
  const workflow = restyleAgentWidget(['Async agents', '├─ async workflow: abc — background', '│ ├─ ● reviewer · running (gpt-5 · thinking low)', '│ ⎿ Reading **source**', '… 10 lines hidden · ctrl+option+o expands'], theme, 100, false).join('\n');
  assert.match(clean(workflow), /└─ [\u2800-\u28ff] reviewer · gpt-5 low : Reading source/);
  assert.doesNotMatch(clean(workflow), /async workflow|lines hidden|├─ ├─/);
  native[2] = '⎿  Running `npm test`';
  assert.match(clean(widgets.render(100).join('\n')), /Running npm test/);
  assert.doesNotMatch(clean(widgets.render(100).join('\n')), /Reading source/);
  native = ['Async agents · background', '✗ reviewer · failed', 'error: model unavailable'];
  expanded = false;
  assert.match(clean(widgets.render(100).join('\n')), /└─ × reviewer : error: model unavailable/);
  assert.match(clean(widgets.render(100).join('\n')), /UNRELATED/);
  const unknown = ['Different widget', 'running'];
  assert.equal(restyleAgentWidget(unknown, theme, 100, false), unknown);
  restore();
  assert.equal(widgets.render, original);
  assert.match(widgets.render(100).join('\n'), /model unavailable/);
}
const root = mkdtempSync(join(tmpdir(), 'mini-agent-status-'));
try {
  const directory = join(root, 'async-subagent-runs', 'run');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'status.json'), JSON.stringify({ sessionId: 'own', runId: 'r', steps: [] }));
  assert.equal(readAgentStatuses('own', root).length, 1);
  assert.equal(readAgentStatuses('other', root).length, 0);
  writeFileSync(join(directory, 'status.json'), '{partial');
  assert.deepEqual(readAgentStatuses('own', root), []);
  const previous = [{ sessionId: 'own', runId: 'run', steps: [{ agent: 'scout' }] }];
  assert.deepEqual(readAgentStatuses('own', root, previous), previous, 'partial writes retain last valid rows');
  assert.deepEqual(readAgentStatuses('other', root, previous), [], 'snapshots never leak across sessions');
} finally { rmSync(root, { recursive: true, force: true }); }

// Regression 1: Single async & workflow identity association
const singleAsyncId = 'b99e312e-cf84-4b99-9a1c-b6681969a057';
const singleAsyncStatus = { runId: singleAsyncId, mode: 'single', state: 'running', steps: [{ agent: 'worker', status: 'running', model: '9router/GPT-5.6Terra:medium' }] };
const workflowParentId = '5f96be06-1b53-4073-8aaf-08e43376a763';
const workflowChildId = 'child-run-4073';
const workflowParent = { runId: workflowParentId, mode: 'workflow', state: 'running', steps: [] };
const workflowChild = { runId: workflowChildId, parentWorkflowRunId: workflowParentId, mode: 'single', state: 'running', steps: [{ agent: 'reviewer', status: 'running' }] };
const singleCall = agentCall('call-1', 'subagent', { action: 'run' });
singleCall.output = `Run fan-out: 1/64 used, 63 remaining\nAsync: worker [${singleAsyncId}]\nDetached.`;
const workflowCall = agentCall('call-2', 'subagent', { action: 'workflow' });
workflowCall.output = `Async workflow [${workflowParentId}]`;
const allStatuses = [singleAsyncStatus, workflowParent, workflowChild];
assert.deepEqual(currentAgentStatuses(allStatuses, [singleCall]), [singleAsyncStatus], 'single async run matches by runId in call output');
assert.deepEqual(currentAgentStatuses(allStatuses, [workflowCall]), [workflowParent, workflowChild], 'workflow and children match by workflow runId in call output');

// Regression 2: Parent turn ended while subagent still running
initTheme('dark', false);
const testTheme = getThemeByName('dark');
const activeDeadlines = new Map();
const runningClock = 100_000;
const runningView = liveAgentView([singleAsyncStatus], testTheme, 100, false, true, activeDeadlines, runningClock);
assert.equal(runningView.running, 1);
assert.equal(runningView.done, 0);
assert.match(clean(runningView.rows[0]), /SubAgent • GPT-5.6Terra medium : waiting/);
assert.match(clean(runningView.rows[0]), /^└─ [\u2800-\u28ff] /);
const laterRunningView = liveAgentView([singleAsyncStatus], testTheme, 100, false, true, activeDeadlines, runningClock + 15_000);
assert.equal(laterRunningView.running, 1, 'running subagent never expires');

// Regression 3: Real completion retention vs error permanence
const completedStatus = { ...singleAsyncStatus, state: 'completed', steps: [{ agent: 'worker', status: 'completed' }] };
const completeClock = runningClock + 20_000;
const completeDeadlines = new Map();
const doneView1 = liveAgentView([completedStatus], testTheme, 100, false, true, completeDeadlines, completeClock);
assert.equal(doneView1.done, 1);
assert.match(clean(doneView1.rows[0]), /^└─ ✓ SubAgent/);
const doneView2 = liveAgentView([completedStatus], testTheme, 100, false, true, completeDeadlines, completeClock + 5_000);
assert.equal(doneView2.done, 1, 'completed subagent retained within 10s');
const doneView3 = liveAgentView([completedStatus], testTheme, 100, false, true, completeDeadlines, completeClock + 11_000);
assert.equal(doneView3.total, 0, 'completed subagent expires after 10s');

// Error permanence: failed subagent NEVER auto-cleared
const failedStatus = { ...singleAsyncStatus, state: 'failed', steps: [{ agent: 'worker', status: 'failed', error: 'Process crashed' }] };
const errorDeadlines = new Map();
const errView1 = liveAgentView([failedStatus], testTheme, 100, false, true, errorDeadlines, completeClock);
assert.equal(errView1.errors, 1);
assert.match(clean(errView1.rows[0]), /^└─ × SubAgent .* : Process crashed/);
const errView2 = liveAgentView([failedStatus], testTheme, 100, false, true, errorDeadlines, completeClock + 60_000);
assert.equal(errView2.errors, 1, 'failed subagent is never auto-cleared');

// Regression 4: Supervisor notice attached to subagent: loading glyph + task summary + purified body + accent color heading
const noticeMessage = {
  customType: 'subagent_supervisor_request',
  content: 'Subagent progress update.\nRun: b99e312e-cf84-4b99-9a1c-b6681969a057\nAgent: worker\nChild index: 0\n\nUPDATE: 本轮代码已完成并通过所有测试\n\nLive guidance: subagent(...)',
  details: {
    runId: singleAsyncId, agent: 'worker', reason: 'progress_update', expectsReply: false,
    requestBody: 'UPDATE: 本轮代码已完成并通过所有测试',
  },
};
const subagentWithNotice = {
  ...singleAsyncStatus,
  notice: { state: '进度', color: 'muted', summary: '本轮代码已完成并通过所有测试' },
  noticeMessages: [noticeMessage],
};
const collapsedNoticeView = liveAgentView([subagentWithNotice], testTheme, 120, false, true, new Map(), completeClock);
assert.match(clean(collapsedNoticeView.rows[0]), /SubAgent • GPT-5.6Terra medium : 本轮代码已完成并通过所有测试/);
assert.doesNotMatch(clean(collapsedNoticeView.rows[0]), /进度/);
assert.ok(collapsedNoticeView.rows[0].includes(testTheme.fg('text', '本轮代码已完成并通过所有测试')));
assert.equal(collapsedNoticeView.rows.length, 1, 'collapsed subagent has 1 heading row');

const expandedControls = [];
const expandedNoticeView = liveAgentView([subagentWithNotice], testTheme, 120, true, true, new Map(), completeClock, undefined, expandedControls);
assert.equal(expandedControls.length, 1);
assert.equal(expandedControls[0].runId, singleAsyncId);
assert.ok(expandedNoticeView.rows[0].includes(testTheme.fg('accent', '本轮代码已完成并通过所有测试')), 'expanded activity uses accent color');
assert.ok(expandedNoticeView.rows[0].includes(testTheme.fg('muted', ' medium')), 'expanded thinking stays gray');
const renderedExpandedText = clean(expandedNoticeView.rows.join('\n'));
assert.match(renderedExpandedText, /本轮代码已完成并通过所有测试/);
assert.doesNotMatch(renderedExpandedText, /Subagent progress update|Run:|Child index|Live guidance|subagent\(|REQUEST_ID/);

const clickedIds = new Set([singleAsyncId]);
const clickedNoticeView = liveAgentView([subagentWithNotice], testTheme, 120, false, true, new Map(), completeClock, clickedIds);
assert.ok(clickedNoticeView.rows[0].includes(testTheme.fg('accent', '本轮代码已完成并通过所有测试')), 'clicked subagent activity uses accent color');
assert.match(clean(clickedNoticeView.rows.join('\n')), /本轮代码已完成并通过所有测试/);

const unclickedNoticeView = liveAgentView([subagentWithNotice], testTheme, 120, false, true, new Map(), completeClock, new Set());
assert.ok(unclickedNoticeView.rows[0].includes(testTheme.fg('text', '本轮代码已完成并通过所有测试')), 'unclicked subagent activity reverts to normal style');
assert.equal(unclickedNoticeView.rows.length, 1);

// Regression 5: Reload recovery from status directory
const reloadRoot = mkdtempSync(join(tmpdir(), 'mini-reload-test-'));
try {
  const reloadDir = join(reloadRoot, 'async-subagent-runs', singleAsyncId);
  mkdirSync(reloadDir, { recursive: true });
  writeFileSync(join(reloadDir, 'status.json'), JSON.stringify({
    sessionId: '/path/to/session.jsonl',
    runId: singleAsyncId,
    mode: 'single',
    state: 'running',
    steps: [{ agent: 'worker', status: 'running', recentOutput: ['Reloaded activity'] }],
  }));
  const loaded = readAgentStatuses('/path/to/session.jsonl', reloadRoot);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].runId, singleAsyncId);
  const matched = currentAgentStatuses(loaded, [singleCall]);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].runId, singleAsyncId);
} finally { rmSync(reloadRoot, { recursive: true, force: true }); }

console.log('Agent views: aggregation, failure, live widgets, restore, dark/light, widths PASS');
