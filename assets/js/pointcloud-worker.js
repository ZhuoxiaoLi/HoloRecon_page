import { decodePly } from './ply-points.js?v=6';
import { loadChunks } from './pointcloud-chunks.js?v=6';

const MAX_BYTES = 512 * 1024 * 1024;
self.onmessage = async ({ data }) => {
  try {
    if (data.chunkManifestUrl) { await loadChunks(data); return; }
    let buffer;
    if (data.file) {
      if (data.file.size > MAX_BYTES) throw new Error('This file exceeds the 512 MB direct-loading limit. Use a smaller point cloud or select Sparse.');
      buffer = await data.file.arrayBuffer();
    } else {
      const response = await fetch(data.url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`The selected ${data.mode === 'original' ? 'Dense' : 'Sparse'} file could not be loaded (HTTP ${response.status}).`);
      const total = Number(response.headers.get('content-length')) || 0;
      if (total > MAX_BYTES) throw new Error('This scene exceeds the 512 MB direct-loading limit. Select Sparse instead.');
      const reader = response.body.getReader();
      const bytes = total ? new Uint8Array(total) : null;
      const chunks = [];
      let received = 0, lastProgress = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.byteLength > MAX_BYTES || (bytes && received + value.byteLength > bytes.byteLength)) {
          await reader.cancel(); throw new Error('The file size is larger than expected or exceeds the loading limit.');
        }
        if (bytes) bytes.set(value, received); else chunks.push(value);
        received += value.byteLength;
        if (performance.now() - lastProgress > 90 || received === total) {
          self.postMessage({ type: 'progress', received, total }); lastProgress = performance.now();
        }
      }
      if (bytes && received !== total) throw new Error('The download ended before all point-cloud data arrived. Try loading the scene again.');
      if (bytes) buffer = bytes.buffer;
      else {
        const assembled = new Uint8Array(received); let offset = 0;
        for (const chunk of chunks) { assembled.set(chunk, offset); offset += chunk.byteLength; }
        buffer = assembled.buffer;
      }
    }
    self.postMessage({ type: 'parsing' });
    const result = await decodePly(buffer, data.budget);
    const transfer = [result.positions.buffer];
    if (result.colors) transfer.push(result.colors.buffer);
    self.postMessage({ type: 'loaded', ...result, requestedBudget: data.budget }, transfer);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'The PLY file could not be parsed.' });
  }
};
