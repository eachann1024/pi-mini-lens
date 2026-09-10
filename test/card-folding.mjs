import assert from 'node:assert/strict';
import { register } from 'node:module';

const piStub = `data:text/javascript,${encodeURIComponent(`
export const CONFIG_DIR_NAME = '.pi';
export const getMarkdownTheme = () => Object.fromEntries(['heading','link','linkUrl','code','codeBlock','codeBlockBorder','quote','quoteBorder','hr','listBullet','bold','italic','strikethrough','underline'].map(key => [key, text => text]));
export const getSettingsListTheme = () => ({});
`)}`;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s,c,n){if(s==='@earendil-works/pi-coding-agent')return {shortCircuit:true,url:${JSON.stringify(piStub)}};return n(s,c)}`)}`, import.meta.url);

const { Container, Text } = await import('@earendil-works/pi-tui');
const { minimalOutputComponent } = await import('../extensions/footer-status.ts');
const { attachTranscript, compactGoalCard } = await import('../lib/transcript-adapter.ts');
const theme = { fg: (_key, text) => text, bg: (_key, text) => text, bold: text => text };
const loop = '[pi-loop] Loop #2 fired (self-paced).\n\n5 继续，直到所有都完成\n\n[Self-paced loop: call the schedule_loop_wakeup tool at the END of your turn to run this again, or omit it to end the loop.]';
const view = minimalOutputComponent(theme, () => [{ question: loop, process: [] }]);
const collapsed = view.render(120).join('\n');
assert.match(collapsed, /Loop #2 fired .*继续，直到所有都完成/);
assert.doesNotMatch(collapsed, /schedule_loop_wakeup/);
assert.match(view.promptChoices()[0].label, /展开/);
view.togglePrompt(0, loop);
assert.match(view.render(120).join('\n'), /schedule_loop_wakeup/);
assert.match(view.promptChoices()[0].label, /收起/);

const goal = { customType: 'pi-codex-goal', data: { goal: { objective: '完成目标卡片的完整验收，并保留普通消息原样显示。', status: 'active' } } };
const goalCollapsed = compactGoalCard(goal, theme, 120, false).join('\n');
assert.match(goalCollapsed, /Goal · active/);
assert.match(goalCollapsed, /\[详情\]/);
const goalExpanded = compactGoalCard(goal, theme, 120, true).join('\n');
assert.match(goalExpanded, /\[收起\]/);
assert.match(goalExpanded, /完整验收/);
const markdownGoal = { customType: 'pi-codex-goal', data: { goal: { objective: '## 目标\n\n- **验收**使用 `命令`', status: 'active' } } };
const markdownGoalExpanded = compactGoalCard(markdownGoal, theme, 120, true).join('\n');
const markdownGoalBody = markdownGoalExpanded.split('\n').slice(1).join('\n');
assert.doesNotMatch(markdownGoalBody, /## 目标|\*\*验收\*\*|`命令`/);
assert.match(markdownGoalBody, /目标[\s\S]*验收.*命令/);
assert.equal(compactGoalCard({ customType: 'other', data: goal.data }, theme, 120, false), undefined);

// Exercise the transcript adapter's real CustomEntryComponent seam and click path.
class UserMessageComponent extends Text {}
class CustomEntryComponent extends Text {
  constructor(entry) { super('', 0, 0); this.entry = entry; }
}
const document = new Container();
const header = new Container(), resources = new Container(), chat = new Container();
document.addChild(header); document.addChild(resources); document.addChild(chat);
chat.addChild(new UserMessageComponent('turn', 0, 0));
chat.addChild(new CustomEntryComponent(goal));
const host = { mode: 'fullscreen', children: [document, ...Array.from({ length: 6 }, () => new Container())] };
let goalNotices;
const adapterView = {
  invalidate() {},
  render(_width, notices) { goalNotices = notices.get(0); return [...(goalNotices ?? [])]; },
  handleMouse(event) { return goalNotices?.handleMouse?.(event); },
};
const restore = attachTranscript(host, adapterView, { supervisor: { theme, expanded: () => false } });
assert.ok(restore);
assert.match(document.render(120).join('\n'), /\[详情\].*Goal/);
document.handleMouse({ type: 'press', button: 'left', x: 1, y: 0, width: 120, height: 10, clickCount: 1 });
document.handleMouse({ type: 'click', button: 'left', x: 1, y: 0, width: 120, height: 10, clickCount: 1 });
assert.match(document.render(120).join('\n'), /\[收起\].*完整验收/);
restore();
console.log('Card folding PASS: pi-loop summary and pi-codex-goal card expand independently.');
