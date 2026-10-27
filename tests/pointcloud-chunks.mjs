import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodePly } from '../assets/js/ply-points.js';

const root = new URL('../', import.meta.url);
const manifestUrl = new URL('assets/pcd/dense/holorecon-residence2/manifest.json', root);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const parts = [];
for (const part of manifest.parts) parts.push(await readFile(new URL(part.path, manifestUrl)));
const headerEnd = bytes => bytes.indexOf(Buffer.from('end_header\n')) + 11;
const firstHeader = parts[0].subarray(0, headerEnd(parts[0])).toString('utf8').replace(/(element\s+vertex\s+)\d+/, `$1${manifest.sourcePoints}`);
const original = Buffer.concat([Buffer.from(firstHeader), ...parts.map(part => part.subarray(headerEnd(part)))]);
const messages = [];
globalThis.self = { postMessage: message => messages.push(message) };
let corrupt = false, missing = false, truncated = false;
globalThis.fetch = async input => {
  const url = new URL(input);
  if (url.href === manifestUrl.href) return new Response(JSON.stringify(manifest));
  if (missing) return new Response('Not found', { status: 404 });
  let bytes = await readFile(url);
  if (corrupt) { bytes = Buffer.from(bytes); bytes[bytes.length - 1] ^= 1; }
  if (truncated) bytes = bytes.subarray(0, bytes.length - 1);
  return new Response(bytes);
};
await import('../assets/js/pointcloud-worker.js');
for (const budget of [0, 250003, 3, 1]) {
  messages.length = 0;
  await self.onmessage({ data: { chunkManifestUrl: manifestUrl.href, budget } });
  const begin = messages.find(message => message.type === 'begin');
  const complete = messages.at(-1);
  assert.equal(complete.type, 'complete', complete.message);
  const reference = await decodePly(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength), budget);
  assert.equal(begin.count, reference.count);
  const positions = new Float32Array(reference.count * 3), colors = new Uint8Array(reference.count * 3);
  let count = 0;
  for (const chunk of messages.filter(message => message.type === 'chunk')) {
    assert.equal(chunk.offset, count);
    positions.set(chunk.positions, count * 3); colors.set(chunk.colors, count * 3);
    count += chunk.count;
  }
  assert.equal(count, reference.count);
  assert.equal(Buffer.compare(Buffer.from(positions.buffer), Buffer.from(reference.positions.buffer)), 0);
  assert.equal(Buffer.compare(Buffer.from(colors.buffer), Buffer.from(reference.colors.buffer)), 0);
  assert.equal(complete.count, reference.count);
  console.log(`PASS: progressive Residence 2 matches a single PLY exactly, budget=${budget}, ${count.toLocaleString('en')} points.`);
}
for (const failure of ['missing', 'corrupt', 'truncated']) {
  missing = failure === 'missing'; corrupt = failure === 'corrupt'; truncated = failure === 'truncated'; messages.length = 0;
  await self.onmessage({ data: { chunkManifestUrl: manifestUrl.href, budget: 0 } });
  assert.equal(messages.at(-1).type, 'error');
  console.log(`PASS: ${failure} part produces a recoverable load error.`);
}
