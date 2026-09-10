import assert from 'node:assert/strict';
import { Container, Text } from '@earendil-works/pi-tui';
import { attachTranscript } from '../lib/transcript-adapter.ts';

// Use Pi's real Container path: session compaction rebuilds this native component.
class UserMessageComponent extends Text {}
class CompactionSummaryMessageComponent extends Text {}

const document = new Container();
const header = new Container();
const resources = new Container();
const chat = new Container();
header.addChild(new Text('HEADER', 0, 0));
chat.addChild(new UserMessageComponent('EARLIER TURN', 0, 0));
chat.addChild(new UserMessageComponent('COMPACTION TURN', 0, 0));
chat.addChild(new CompactionSummaryMessageComponent('[compaction] Compacted from 1,024 tokens (Ctrl+O to expand)', 0, 0));
for (const child of [header, resources, chat]) document.addChild(child);
const editor = new Container();
editor.addChild({ render: () => [], invalidate() {}, getText: () => '' });
const tui = { children: [document, new Container(), new Container(), new Container(), editor, new Container(), new Container()] };
const view = { invalidate() {}, render(_width, notices) {
  return ['EARLIER TURN', ...(notices.get(0) ?? []), 'COMPACTION TURN', ...(notices.get(1) ?? [])];
} };

const restore = attachTranscript(tui, view);
assert.equal(typeof restore, 'function');
assert.deepEqual(document.render(80).map(row => row.trim()), ['HEADER', 'EARLIER TURN', 'COMPACTION TURN', '[compaction] Compacted from 1,024 tokens (Ctrl+O to expand)']);
restore();
console.log('compaction transcript regression ok');
