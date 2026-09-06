import assert from 'node:assert/strict';
import { registryMetadata, selectVersion } from '../scripts/publish.mjs';

const metadata = (latest, gitHead = 'previous') => ({
  'dist-tags': { latest },
  versions: { [latest]: { gitHead } },
});

const missing = await registryMetadata(new Response('{"error":"Not found"}', { status: 404 }));
assert.equal(missing, null);
assert.equal(selectVersion('1.3.1', missing, 'current'), '1.3.1');
assert.equal(selectVersion('1.3.1', metadata('1.3.9'), 'current'), '1.3.10');
assert.equal(selectVersion('2.0.0', metadata('1.3.9'), 'current'), '2.0.0');
assert.equal(selectVersion('1.3.1', metadata('1.3.0'), 'current'), '1.3.1');
assert.equal(selectVersion('1.3.1', metadata('1.3.1', 'current'), 'current'), null);
const history = metadata('1.3.9');
history.versions['1.3.2'] = { gitHead: 'current' };
assert.equal(selectVersion('2.0.0', history, 'current'), null);

for (const version of ['1.3', '01.3.0', '1.3.0-beta.1', '1.3.0+build', 'v1.3.0', '1.3.9007199254740992', null]) {
  assert.throws(() => selectVersion(version, null, 'current'), /version|range/i);
  assert.throws(() => selectVersion('1.3.1', metadata(version), 'current'), /version|range/i);
}
assert.throws(() => selectVersion('1.3.1', metadata('1.3.9007199254740991'), 'current'), /range/i);
assert.throws(() => selectVersion('1.3.1', {}, 'current'));
assert.throws(() => selectVersion('1.3.1', { 'dist-tags': { latest: '1.3.1' }, versions: [] }, 'current'));
assert.throws(() => selectVersion('1.3.1', { ...metadata('1.3.1'), versions: { '1.3.1': null } }, 'current'));
for (const status of [401, 403, 429, 500]) {
  await assert.rejects(registryMetadata(new Response('{}', { status })), /HTTP/);
}
for (const body of ['not json', 'null', '[]']) {
  await assert.rejects(registryMetadata(new Response(body)));
}
console.log('Publish self-check passed.');
