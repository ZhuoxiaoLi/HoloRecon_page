import { decodePly } from './ply-points.js?v=6';

async function downloadPart(url, part, receivedBefore, sceneBytes, index, parts) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Point-cloud part ${index} could not be loaded (HTTP ${response.status}). Try loading the scene again.`);
  const reader = response.body.getReader(), bytes = new Uint8Array(part.bytes);
  let received = 0, lastProgress = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.byteLength > bytes.length) { await reader.cancel(); throw new Error('A point-cloud part is larger than expected.'); }
    bytes.set(value, received); received += value.byteLength;
    if (performance.now() - lastProgress > 90 || received === bytes.length) {
      self.postMessage({ type: 'progress', received: receivedBefore + received, total: sceneBytes, part: index, parts });
      lastProgress = performance.now();
    }
  }
  if (received !== bytes.length) throw new Error('A point-cloud part is incomplete. Try loading the scene again.');
  if (part.sha256 && globalThis.crypto?.subtle) {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== part.sha256) throw new Error('A point-cloud part failed its integrity check. Try reloading the scene.');
  }
  return bytes.buffer;
}

export async function loadChunks(data) {
  const response = await fetch(data.chunkManifestUrl, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`The Dense scene manifest could not be loaded (HTTP ${response.status}).`);
  const manifest = await response.json();
  if (manifest.format !== 'ply-chunks' || !manifest.parts?.length || manifest.parts.length > 4096 ||
      !Number.isSafeInteger(manifest.validPoints) || manifest.validPoints <= 0 || manifest.sourceBytes > 512 * 1024 * 1024 ||
      manifest.bounds?.min?.length !== 3 || manifest.bounds?.max?.length !== 3 ||
      ![...manifest.bounds.min, ...manifest.bounds.max].every(Number.isFinite)) {
    throw new Error('The Dense scene manifest is invalid or exceeds the loading limit.');
  }
  let valid = 0, source = 0, bytes = 0;
  for (const part of manifest.parts) {
    if (!Number.isSafeInteger(part.bytes) || part.bytes <= 0 || part.bytes > 24 * 1024 * 1024 ||
        !Number.isSafeInteger(part.validPoints) || part.validPoints < 0 ||
        !Number.isSafeInteger(part.points) || part.points < part.validPoints || part.pointOffset !== valid) {
      throw new Error('The Dense scene contains an invalid part.');
    }
    valid += part.validPoints; source += part.points; bytes += part.bytes;
  }
  if (valid !== manifest.validPoints || source !== manifest.sourcePoints || bytes !== manifest.bytes) throw new Error('The Dense scene point counts or byte counts do not match.');
  const budget = Number(data.budget);
  if (!Number.isFinite(budget) || budget < 0) throw new Error('Invalid display point budget.');
  const count = budget === 0 ? valid : Math.min(valid, Math.max(1, Math.floor(budget)));
  const bounds = { min: [manifest.bounds.min[0], -manifest.bounds.max[1], -manifest.bounds.max[2]],
                   max: [manifest.bounds.max[0], -manifest.bounds.min[1], -manifest.bounds.min[2]] };
  const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
  const diagonal = Math.hypot(...bounds.max.map((value, axis) => value - bounds.min[axis]));
  self.postMessage({ type: 'begin', count, total: valid, sourceCount: source, bounds, center,
                    scale: diagonal > 0 ? 100 / diagonal : 1, hasColors: manifest.hasColors,
                    requestedBudget: budget, parts: manifest.parts.length });
  const base = new URL('.', data.chunkManifestUrl);
  let received = 0, displayed = 0;
  for (const [index, part] of manifest.parts.entries()) {
    const url = new URL(part.path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('The Dense scene part path is invalid.');
    const buffer = await downloadPart(url.href, part, received, bytes, index + 1, manifest.parts.length);
    received += part.bytes;
    if (!part.validPoints) continue;
    const result = await decodePly(buffer, budget, { bounds, sampleTotal: valid, sampleOffset: part.pointOffset });
    if (result.total !== part.validPoints || result.sourceCount !== part.points || Boolean(result.colors) !== Boolean(manifest.hasColors)) throw new Error('A point-cloud part does not match its manifest.');
    const transfer = [result.positions.buffer];
    if (result.colors) transfer.push(result.colors.buffer);
    self.postMessage({ type: 'chunk', positions: result.positions, colors: result.colors, count: result.count,
                      offset: displayed, loadedPoints: displayed + result.count, totalPoints: count,
                      part: index + 1, parts: manifest.parts.length, received, total: bytes }, transfer);
    displayed += result.count;
  }
  if (displayed !== count) throw new Error('The Dense scene ended before all requested points were loaded.');
  self.postMessage({ type: 'complete', count: displayed, parts: manifest.parts.length });
}
