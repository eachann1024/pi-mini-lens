import assert from 'node:assert/strict';
import { Container, Text, ScrollView, visibleWidth } from '@earendil-works/pi-tui';
import { attachTranscript, compactSupervisorNotice } from '../lib/transcript-adapter.ts';

// Real Pi TUI container and ScrollView objects, not an imitation of their render path.
const document = new Container();
const header = new Container();
const resources = new Container();
const chat = new Container();
header.addChild(new Text('HEADER', 0, 0));
class NativeMessage extends Text {}
chat.addChild(new NativeMessage('NATIVE MESSAGE', 0, 0));
chat.addChild(new Text('NATIVE ERROR', 0, 0));
for (const child of [header, resources, chat]) document.addChild(child);
const editor = new Container();
editor.addChild({ render: () => [], invalidate() {}, getText: () => '' });
const tui = { children: [document, new Container(), new Container(), new Container(), editor, new Container(), new Container()] };
const view = { render: () => ['MINIMAL'], invalidate() {} };
const originalRender = document.render;
const restore = attachTranscript(tui, view);
assert.equal(typeof restore, 'function');
assert.match(document.render(60).join('\n'), /HEADER.*\nNATIVE ERROR.*\nMINIMAL/);
assert.doesNotMatch(document.render(60).join('\n'), /NATIVE MESSAGE/);
const scroll = new ScrollView(document, { follow: 'end', primary: true });
assert.match(scroll.render(60).join('\n'), /MINIMAL/);
assert.equal(document.handleMouse({ type: 'click', button: 'left' }), undefined);
restore();
assert.equal(document.render, originalRender);
assert.equal(Object.hasOwn(document, 'render'), false);
assert.match(document.render(60).join('\n'), /NATIVE MESSAGE/);
assert.equal(attachTranscript({ children: [document] }, view), undefined);
assert.equal(attachTranscript({ ...tui, mode: 'regular' }, view), undefined, 'regular mode preserves Pi native scrollback diffing');
const restoreAgain = attachTranscript(tui, view);
const anotherExtension = () => ['OTHER'];
document.render = anotherExtension;
restoreAgain();
assert.equal(document.render, anotherExtension, 'cleanup must not overwrite another extension');
console.log('transcript adapter check ok (real Container / ScrollView, restore, fail closed)');

// Pi /reload emits session_start while the editor contains a notice container.
editor.clear();
const reloadBox = new Container();
reloadBox.addChild(new Text('Reloading...', 0, 0));
editor.addChild(reloadBox);
const restoreReload = attachTranscript(tui, view);
assert.equal(typeof restoreReload, 'function');
assert.match(document.render(60).join('\n'), /MINIMAL/);
restoreReload();

// Generic native notifications retain their native user-turn position.
class UserMessageComponent extends Text {}
chat.clear();
chat.addChild(new UserMessageComponent('FIRST'));
const info = new Text('INFO Default model', 0, 0);
chat.addChild(info);
chat.addChild(new Text('Cache miss FIRST', 0, 0));
chat.addChild(new UserMessageComponent('SECOND'));
chat.addChild(new Text('Cache miss SECOND', 0, 0));
let time = 0;
let scheduled;
let cancelled = 0;
let redraws = 0;
tui.requestRender = () => redraws++;
const restoreNotices = attachTranscript(tui, {
  invalidate() {},
  render(width, notices) {
    return ['FIRST', ...(notices.get(0) ?? []), 'SECOND', ...(notices.get(1) ?? [])];
  },
}, {
  now: () => time,
  isTransient: text => text.startsWith('INFO '),
  schedule: (callback, delay) => { scheduled = { callback, delay }; return () => cancelled++; },
});
assert.deepEqual(document.render(80).map(s => s.trim()), ['HEADER', 'FIRST', 'INFO Default model', 'Cache miss FIRST', 'SECOND', 'Cache miss SECOND']);
assert.equal(scheduled.delay, 5000);
time = 4999;
assert.match(document.render(40).join('\n'), /Default model/);
assert.equal(scheduled.delay, 1);
time = 5000;
scheduled.callback();
assert.equal(redraws, 1, "expiry requests a redraw even when idle");
assert.doesNotMatch(document.render(80).join('\n'), /Default model/);
assert.match(document.render(80).map(s => s.trim()).join('\n'), /FIRST\nCache miss FIRST\nSECOND\nCache miss SECOND/);
info.setText('INFO Switched model');
assert.match(document.render(80).join('\n'), /Switched model/);
assert.equal(scheduled.delay, 5000);
restoreNotices();

assert.ok(cancelled > 0);
// Native notices remain intact, and switching sessions clears their placement.
assert.ok(chat.children.includes(info));
chat.clear();
const restoreEmpty = attachTranscript(tui, view);
assert.doesNotMatch(document.render(80).join('\n'), /Cache miss|Switched/);
restoreEmpty();

// A blocking prompt is preserved and never mistaken for a transient notification.
chat.addChild(new UserMessageComponent('PROMPT TURN'));
chat.addChild(new Text('填写 Pull Request 内容  [Enter to launch editor]', 0, 0));
let promptTime = 0;
const restorePrompt = attachTranscript(tui, {
  invalidate() {},
  render(_width, notices) { return ['PROMPT TURN', ...(notices.get(0) ?? [])]; },
}, {
  now: () => promptTime,
  isPrompt: text => text.includes('填写 Pull Request 内容'),
  isTransient: () => true,
});
assert.match(document.render(80).join('\n'), /填写 Pull Request 内容/);
promptTime = 6000;
assert.match(document.render(80).join('\n'), /填写 Pull Request 内容/, 'blocking prompt must not expire');
restorePrompt();
// Visible extension completion receipts are durable, including after resize and remount.
class CustomMessageComponent extends Text {}
chat.addChild(new CustomMessageComponent('CHILD COMPLETION RECEIPT', 0, 0));
const receiptView = { invalidate() {}, render(_width, notices) { return [...notices.values()].flat(); } };
const restoreReceipt = attachTranscript(tui, receiptView, { isTransient: () => true, now: () => promptTime });
assert.match(document.render(80).join('\n'), /CHILD COMPLETION RECEIPT/);
promptTime += 10000;
assert.match(document.render(40).join('\n'), /CHILD COMPLETION RECEIPT/);
restoreReceipt();
const restoreReceiptAgain = attachTranscript(tui, receiptView);
assert.match(document.render(80).join('\n'), /CHILD COMPLETION RECEIPT/);
restoreReceiptAgain();
console.log('notification check ok (expiry, update, resize, turn placement, cleanup, session clear)');

const supervisorTheme = { fg: (color, text) => `\x1b[${color === 'error' ? 31 : color === 'warning' ? 33 : 34}m${text}\x1b[0m` };
const supervisor = { customType: 'subagent_supervisor_request', content: 'Subagent progress update.\nRun: RUN_ID\nRequest ID: REQUEST_ID\nReply with: subagent_supervisor(...)',
  details: { agent: 'worker', reason: 'progress_update', requestBody: 'UPDATE: 已完成用户消息折叠', runId: 'RUN_ID', requestId: 'REQUEST_ID', childIndex: 0, childTarget: 'CHILD_TARGET', replyHint: 'subagent_supervisor(...)' } };
const snapshot = JSON.stringify(supervisor);
for (const width of [1, 2, 8, 20, 40, 80, 160]) {
  const rows = compactSupervisorNotice(supervisor, supervisorTheme, width, false);
  assert.ok(rows.length <= 2);
  assert.ok(rows.every(row => visibleWidth(row) <= width));
  assert.doesNotMatch(rows.join('\n'), /RUN_ID|REQUEST_ID|CHILD_TARGET|Child index|Reply with|subagent_supervisor/);
}
assert.equal(compactSupervisorNotice(supervisor, supervisorTheme, 160, false).length, 1, 'normal width uses one compact line');
assert.match(compactSupervisorNotice(supervisor, supervisorTheme, 160, false).join('\n'), /进度.*已完成用户消息折叠/);
for (const reason of ['need_decision', 'interview_request']) {
  const rows = compactSupervisorNotice({ ...supervisor, details: { ...supervisor.details, reason, expectsReply: true } }, supervisorTheme, 100, false).join('\n');
  assert.match(rows, /内部协作/);
  assert.doesNotMatch(rows, /需要你|确认|\x1b\[33m/);
}
for (const body of ['已完成：错误用 error 色，失败用 warning', 'Build failed', '当前阻塞，需要授权', 'No errors; failure handling tested']) {
  const rows = compactSupervisorNotice({ ...supervisor, details: { ...supervisor.details, requestBody: body } }, supervisorTheme, 160, false).join('\n');
  assert.match(rows, /进度/);
  assert.doesNotMatch(rows, /\x1b\[31m|\x1b\[33m|执行失败/);
}
const attention = { customType: 'subagent_control_notice', content: 'Run: RUN_ID\nStatus: subagent(...)', details: { event: { type: 'needs_attention', agent: 'reviewer', message: 'Waiting for supervisor reply' } } };
assert.match(compactSupervisorNotice(attention, supervisorTheme, 120, false).join('\n'), /⚠ 需要关注.*Waiting for supervisor reply/);
assert.match(compactSupervisorNotice({ ...attention, details: { event: { ...attention.details.event, reason: 'completion_guard' } } }, supervisorTheme, 120, false).join('\n'), /\x1b\[31m× 执行失败/);
assert.equal(compactSupervisorNotice({ ...supervisor, customType: 'ordinary_message' }, supervisorTheme, 100, false), undefined);
assert.equal(compactSupervisorNotice({ role: 'user', content: supervisor.content }, supervisorTheme, 100, false), undefined);
assert.equal(compactSupervisorNotice({ ...supervisor, details: { reason: 'unknown' } }, supervisorTheme, 100, false), undefined);
const complete = compactSupervisorNotice(supervisor, supervisorTheme, 100, true).join('\n');
assert.doesNotMatch(complete, /RUN_ID|REQUEST_ID|CHILD_TARGET|Reply with/);
assert.match(complete, /已完成用户消息折叠/);
assert.ok(complete.includes('\x1b[34m[收起]\x1b[0m'), 'expanded control uses accent');
assert.equal(JSON.stringify(supervisor), snapshot);

// pi-subagents 0.67.0 incremental child notifications only carry their known
// customType and formatted content. Keep task/result/error visible; fold IDs,
// artifact paths, and fan-out quota into on-demand details.
const incrementalChildFailure = {
  customType: 'subagent-incremental-child-notify',
  content: 'Workflow child failed: **beta-readonly**\nWorkflow run: cf5f2c47-399c-4520-a883-5c0c3f8375b9\nChild run: 98b2852e-2054-4c91-8fa9-bcc1ebf55323\nOutput: /var/folders/sm/b1_d84y51m3276xr4skfk96m0000gn/T/pi-subagents-uid-501/async-subagent-runs/98b2852e-2054-4c91-8fa9-bcc1ebf55323\nError: Run fan-out: 2/64 used, 62 remaining\nConnection error.\nStatus: workflow still running',
};
const incrementalCompact = compactSupervisorNotice(incrementalChildFailure, supervisorTheme, 160, false).join('\n');
assert.match(incrementalCompact, /执行失败.*beta-readonly.*Connection error/);
assert.doesNotMatch(incrementalCompact, /cf5f2c47|98b2852e|\/var\/folders|fan-out/i);
const incrementalDetails = compactSupervisorNotice(incrementalChildFailure, supervisorTheme, 160, true).join('\n');
assert.match(incrementalDetails, /Workflow run: cf5f2c47/);
assert.match(incrementalDetails, /Child run: 98b2852e/);
assert.match(incrementalDetails, /Output: \/var\/folders/);
assert.match(incrementalDetails, /Run fan-out: 2\/64 used, 62 remaining/);
assert.match(incrementalDetails, /Connection error/);
assert.equal(compactSupervisorNotice({ ...incrementalChildFailure, customType: 'unknown-child-notify' }, supervisorTheme, 160, false), undefined);
chat.clear();
chat.addChild(new UserMessageComponent('INCREMENTAL TURN'));
const incrementalCard = new CustomMessageComponent('NATIVE_INCREMENTAL_CARD', 0, 0);
incrementalCard.message = incrementalChildFailure;
chat.addChild(incrementalCard);
let incrementalExpanded = false;
const restoreIncremental = attachTranscript(tui, receiptView, {
  supervisor: { theme: supervisorTheme, expanded: () => incrementalExpanded },
});
const renderedIncremental = document.render(160).join('\n');
assert.match(renderedIncremental, /执行失败.*beta-readonly.*Connection error/);
assert.doesNotMatch(renderedIncremental, /cf5f2c47|98b2852e|\/var\/folders|fan-out/i);
incrementalExpanded = true;
const renderedIncrementalDetails = document.render(160).join('\n');
assert.match(renderedIncrementalDetails, /Workflow run: cf5f2c47/);
assert.match(renderedIncrementalDetails, /Run fan-out: 2\/64 used, 62 remaining/);
restoreIncremental();
// Route only recognized native custom messages; retain receipts, prompts, and turn position.
chat.clear();
chat.addChild(new UserMessageComponent('USER'));
const supervisorCard = new CustomMessageComponent('NATIVE_FULL_SUPERVISOR_CARD', 0, 0);
supervisorCard.message = supervisor;
chat.addChild(supervisorCard);
chat.addChild(new CustomMessageComponent('DURABLE_RECEIPT', 0, 0));
let detailsExpanded = false;
const restoreCompact = attachTranscript(tui, receiptView, {
  supervisor: { theme: supervisorTheme, expanded: () => detailsExpanded },
  isTransient: () => true, now: () => 999999999,
});
assert.doesNotMatch(document.render(120).join('\n'), /NATIVE_FULL|RUN_ID/);
assert.match(document.render(120).join('\n'), /DURABLE_RECEIPT/);
detailsExpanded = true;
assert.match(document.render(120).join('\n'), /已完成用户消息折叠/);
assert.doesNotMatch(document.render(120).join('\n'), /RUN_ID/);
restoreCompact();
assert.equal(document.render, anotherExtension, 'cleanup restores the prior renderer');
assert.match(chat.render(120).join('\n'), /NATIVE_FULL_SUPERVISOR_CARD/);
assert.equal(JSON.stringify(supervisor), snapshot);
console.log('Supervisor notices PASS: typed metadata, one/two rows, Chinese states, prose error never escalates, internal asks, true control failures, full details and restore.');

// Stable run+child groups retain their first turn/row and every original detail.
chat.clear();
const addNotice = (message) => { const card = new CustomMessageComponent('NATIVE', 0, 0); card.message = message; chat.addChild(card); return card; };
const update = (body, extra = {}) => ({ ...supervisor, details: { ...supervisor.details, requestBody: body, ...extra } });
chat.addChild(new UserMessageComponent('FIRST'));
addNotice(update('OLD_PROGRESS'));
chat.addChild(new UserMessageComponent('SECOND'));
addNotice(update('NEW_PROGRESS'));
addNotice(update('PRIVATE_QUESTION', { reason: 'need_decision', expectsReply: true }));
addNotice(update('OTHER_CHILD', { childIndex: 1 }));
addNotice(update('OTHER_RUN', { runId: 'OTHER_RUN_ID' }));
addNotice(update('MISSING_IDENTITY_A', { runId: undefined }));
addNotice(update('MISSING_IDENTITY_B', { runId: undefined }));
let captured;
const groupedRestore = attachTranscript(tui, { invalidate() {}, render(_width, notices) {
  captured = notices;
  return ['FIRST', ...(notices.get(0) ?? []), 'SECOND', ...(notices.get(1) ?? [])];
} }, { supervisor: { theme: supervisorTheme, expanded: () => detailsExpanded } });
detailsExpanded = false;
let grouped = document.render(160).join('\n');
assert.equal((grouped.match(/\[详情\]/g) ?? []).length, 5);
assert.doesNotMatch(grouped, /OLD_PROGRESS|PRIVATE_QUESTION|worker|RUN_ID/);
assert.match(grouped, /FIRST[\s\S]*NEW_PROGRESS[\s\S]*SECOND[\s\S]*OTHER_CHILD/);
assert.match(grouped, /任务 1/);
assert.match(grouped, /OTHER_RUN/);
assert.match(grouped, /MISSING_IDENTITY_A[\s\S]*MISSING_IDENTITY_B/);
const event = { type: 'click', button: 'left', x: 1, y: 0, clickCount: 1 };
const hit = captured.get(0).handleMouse;
for (const change of [{ type: 'drag' }, { type: 'wheel' }, { shift: true }, { ctrl: true }, { alt: true }, { clickCount: 2 }, { y: 2 }]) assert.equal(hit({ ...event, ...change }), undefined);
assert.deepEqual(hit({ ...event, type: 'press' }), { handled: true });
assert.deepEqual(hit(event), { handled: true, render: true });
grouped = document.render(160).join('\n');
assert.match(grouped, /OLD_PROGRESS[\s\S]*NEW_PROGRESS[\s\S]*PRIVATE_QUESTION/);
assert.doesNotMatch(grouped, /REQUEST_ID/);
assert.equal((grouped.match(/\[收起\]/g) ?? []).length, 1, 'click opens only this task');
detailsExpanded = true;
assert.equal((document.render(160).join('\n').match(/\[收起\]/g) ?? []).length, 5, 'keyboard opens all');
detailsExpanded = false;
assert.doesNotMatch(document.render(160).join('\n'), /OLD_PROGRESS|PRIVATE_QUESTION/, 'keyboard closes clicked details too');
const failure = { ...attention, details: { event: { ...attention.details.event, runId: 'RUN_ID', index: 0, reason: 'tool_failures', label: '验证', message: 'TEST_COMMAND_FAILED' } } };
addNotice(failure);
addNotice(update('LATER_ORDINARY_PROGRESS'));
grouped = document.render(160).join('\n');
assert.match(grouped, /执行失败 · 验证.*TEST_COMMAND_FAILED/);
assert.doesNotMatch(grouped, /LATER_ORDINARY_PROGRESS/, 'ordinary updates cannot bury failures');
addNotice({ ...failure, details: { event: { ...failure.details.event, reason: 'idle', message: 'Waiting' } } });
assert.match(document.render(160).join('\n'), /执行失败.*TEST_COMMAND_FAILED/, 'generic attention cannot downgrade a real failure');
for (const width of [1, 2, 8, 20, 40, 80, 160]) { document.render(width); assert.ok([...captured.values()].flat().every(row => visibleWidth(row) <= width)); }
groupedRestore();
assert.equal(chat.children.length, 12, 'aggregation never removes native messages');
assert.match(chat.render(160).join('\n'), /NATIVE/);
console.log('Supervisor aggregation PASS: first-turn placement, stable run+child, missing/nested identity isolation, internal asks in details, sticky failures, click/key independence.');

const internalAttention = { ...attention, details: { event: { ...attention.details.event, reason: 'supervisor_request' } } };
assert.match(compactSupervisorNotice(internalAttention, supervisorTheme, 100, false).join('\n'), /内部协作/);
assert.doesNotMatch(compactSupervisorNotice(internalAttention, supervisorTheme, 100, false).join('\n'), /\x1b\[33m|需要关注|Waiting/);
// Nested controls with identical parent identity must not collapse unrelated nested runs.
chat.clear();
chat.addChild(new UserMessageComponent('NESTED_TURN'));
for (const nestedRunId of ['nested-a', 'nested-b']) addNotice({ ...failure, details: { event: { ...failure.details.event, nestedRunId } } });
const nestedRestore = attachTranscript(tui, receiptView, { supervisor: { theme: supervisorTheme, expanded: () => false } });
assert.equal((document.render(160).join('\n').match(/\[详情\]/g) ?? []).length, 2);
nestedRestore();
