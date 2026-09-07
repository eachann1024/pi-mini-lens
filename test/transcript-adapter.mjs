import assert from 'node:assert/strict';
import { Container, Text, ScrollView } from '@earendil-works/pi-tui';
import { attachTranscript } from '../lib/transcript-adapter.ts';

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
assert.match(document.render(60).join('\n'), /HEADER.*\nMINIMAL.*\nNATIVE ERROR/);
assert.doesNotMatch(document.render(60).join('\n'), /NATIVE MESSAGE/);
const scroll = new ScrollView(document, { follow: 'end', primary: true });
assert.match(scroll.render(60).join('\n'), /MINIMAL/);
assert.equal(document.handleMouse({ type: 'click', button: 'left' }), undefined);
restore();
assert.equal(document.render, originalRender);
assert.equal(Object.hasOwn(document, 'render'), false);
assert.match(document.render(60).join('\n'), /NATIVE MESSAGE/);
assert.equal(attachTranscript({ children: [document] }, view), undefined);
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
