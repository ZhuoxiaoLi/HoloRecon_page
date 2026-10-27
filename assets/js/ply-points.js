// Decode binary XYZ/RGB directly into bounded typed arrays. This avoids the
// intermediate JavaScript number arrays used by general-purpose mesh loaders.
const TYPES = {
  char: [1, 'getInt8'], int8: [1, 'getInt8'], uchar: [1, 'getUint8'], uint8: [1, 'getUint8'],
  short: [2, 'getInt16'], int16: [2, 'getInt16'], ushort: [2, 'getUint16'], uint16: [2, 'getUint16'],
  int: [4, 'getInt32'], int32: [4, 'getInt32'], uint: [4, 'getUint32'], uint32: [4, 'getUint32'],
  float: [4, 'getFloat32'], float32: [4, 'getFloat32'], double: [8, 'getFloat64'], float64: [8, 'getFloat64']
};
const SRGB_BYTES = Uint8Array.from({ length: 256 }, (_, byte) => {
  const value = byte / 255;
  return Math.round((value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4)) * 255);
});

function binaryReader(buffer, header, offset) {
  const little = /format binary_little_endian/.test(header);
  if (!little && !/format binary_big_endian/.test(header)) return null;
  let firstElement, element, stride = 0;
  const properties = new Map();
  for (const line of header.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'element') { element = parts[1]; firstElement ||= element; }
    if (parts[0] !== 'property' || element !== 'vertex') continue;
    if (parts[1] === 'list' || !TYPES[parts[1]]) return null;
    const type = TYPES[parts[1]];
    properties.set(parts[2], { offset: stride, bytes: type[0], method: type[1], type: parts[1] });
    stride += type[0];
  }
  if (firstElement !== 'vertex') return null;
  const count = Number(/element\s+vertex\s+(\d+)/.exec(header)?.[1]);
  if (offset + count * stride > buffer.byteLength) throw new Error('The binary PLY is truncated: its vertex data is incomplete.');
  const view = new DataView(buffer);
  const find = names => names.map(name => properties.get(name)).find(Boolean);
  const coordinate = names => {
    const property = find(names);
    if (!property) throw new Error('The PLY file must contain XYZ coordinates.');
    const getter = view[property.method].bind(view);
    return index => getter(offset + index * stride + property.offset, little);
  };
  const colorProperties = [find(['red', 'diffuse_red', 'r']), find(['green', 'diffuse_green', 'g']), find(['blue', 'diffuse_blue', 'b'])];
  const colorGetters = colorProperties.every(Boolean) ? colorProperties.map(property => {
    const getter = view[property.method].bind(view);
    if (property.type === 'uchar' || property.type === 'uint8') return index => SRGB_BYTES[getter(offset + index * stride + property.offset)];
    const divisor = property.method.includes('Float') ? 1 : Math.pow(2, property.bytes * 8) - 1;
    return index => {
      const value = Math.max(0, Math.min(1, getter(offset + index * stride + property.offset, little) / divisor));
      return Math.round((value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4)) * 255);
    };
  }) : null;
  return { count, x: coordinate(['x', 'px', 'posx']), y: coordinate(['y', 'py', 'posy']), z: coordinate(['z', 'pz', 'posz']), colors: colorGetters };
}

export async function decodePly(buffer, budget = 0, options = {}) {
  if (!buffer.byteLength) throw new Error('The selected PLY file is empty (0 bytes).');
  const first = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024 * 1024)));
  const end = /end_header[ \t]*\r?\n/.exec(first);
  if (!/^ply\r?\n/.test(first) || !end) throw new Error('This file is not a valid PLY point cloud. ASCII and binary PLY files are supported.');
  const header = first.slice(0, end.index + end[0].length);
  const sourceCount = Number(/element\s+vertex\s+(\d+)/.exec(header)?.[1]);
  if (!sourceCount) throw new Error('The PLY file contains no vertices.');
  const offset = new TextEncoder().encode(header).byteLength;
  let reader = binaryReader(buffer, header, offset), geometry;
  if (!reader) {
    const { PLYLoader } = await import('../vendor/three/PLYLoader.js');
    geometry = new PLYLoader().parse(buffer);
    const position = geometry.getAttribute('position'), color = geometry.getAttribute('color');
    if (!position?.count) throw new Error('No readable XYZ coordinates were found.');
    reader = { count: position.count, x: i => position.getX(i), y: i => position.getY(i), z: i => position.getZ(i),
      colors: color ? [i => Math.round(color.getX(i) * 255), i => Math.round(color.getY(i) * 255), i => Math.round(color.getZ(i) * 255)] : null };
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let valid = 0;
  for (let i = 0; i < reader.count; i++) {
    // Rotate 180 degrees about X: source -Y up becomes +Y up without mirroring.
    const x = reader.x(i), y = -reader.y(i), z = -reader.z(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    valid++;
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
  }
  if (!valid) throw new Error('No finite XYZ coordinates were found in this file.');
  const requested = Number(budget);
  if (!Number.isFinite(requested) || requested < 0) throw new Error('Invalid display point budget.');
  // Chunk budgets use one global sampling sequence, independent of part boundaries.
  const sampleTotal = options.sampleTotal ?? valid, sampleOffset = options.sampleOffset ?? 0;
  const sampleCount = requested === 0 ? sampleTotal : Math.min(sampleTotal, Math.max(1, Math.floor(requested)));
  const firstSample = Math.ceil(sampleOffset * sampleCount / sampleTotal);
  const count = Math.ceil((sampleOffset + valid) * sampleCount / sampleTotal) - firstSample;
  const positions = new Float32Array(count * 3), colors = reader.colors ? new Uint8Array(count * 3) : null;
  const bounds = options.bounds || { min, max };
  const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
  const diagonal = Math.hypot(...bounds.max.map((value, axis) => value - bounds.min[axis]));
  const scale = diagonal > 0 ? 100 / diagonal : 1;
  let seen = 0, written = 0, next = Math.floor(firstSample * sampleTotal / sampleCount) - sampleOffset;
  for (let i = 0; i < reader.count && written < count; i++) {
    const x = reader.x(i), y = -reader.y(i), z = -reader.z(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (seen++ !== next) continue;
    positions[written * 3] = (x - center[0]) * scale;
    positions[written * 3 + 1] = (y - center[1]) * scale;
    positions[written * 3 + 2] = (z - center[2]) * scale;
    if (colors) for (let axis = 0; axis < 3; axis++) colors[written * 3 + axis] = reader.colors[axis](i);
    written++;
    next = Math.floor((firstSample + written) * sampleTotal / sampleCount) - sampleOffset;
  }
  geometry?.dispose();
  return { positions, colors, count: written, total: valid, sourceCount, bounds, center, scale };
}
