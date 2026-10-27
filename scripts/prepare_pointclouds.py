"""Create bounded-size PLY previews, true point-cloud posters, and a scene manifest.

Run: python scripts/prepare_pointclouds.py [--max-points 1000000] [--force]
Requires NumPy and Pillow. Original point clouds are never modified.
"""
from pathlib import Path
import argparse
import json
import math
import numpy as np
from PIL import Image
from pointcloud_chunks import prepare_chunks, available_scenes

ROOT = Path(__file__).resolve().parents[1]
PCD = ROOT / 'assets' / 'pcd'
OUTPUT = PCD / 'web'
DENSE = PCD / 'dense'
TYPES = {'char': 'i1', 'int8': 'i1', 'uchar': 'u1', 'uint8': 'u1',
         'short': 'i2', 'int16': 'i2', 'ushort': 'u2', 'uint16': 'u2',
         'int': 'i4', 'int32': 'i4', 'uint': 'u4', 'uint32': 'u4',
         'float': 'f4', 'float32': 'f4', 'double': 'f8', 'float64': 'f8'}
GROUPS = {'360loc': ('360LOC', 1), 'holorecon': ('PanoRecon', 0), 'yutomms': ('YUTO MMS', 2)}
LABELS = {'consourse': 'Concourse', 'concourse': 'Concourse', 'hall': 'Hall',
          'piatrium': 'Piatrium', 'building1': 'Building 1', 'building2': 'Building 2',
          'gym': 'Gym', 'resudence1': 'Residence 1', 'residence1': 'Residence 1',
          'residence2': 'Residence 2', 'road': 'Road', **{f'sequence{x.lower()}': f'Sequence {x}' for x in 'ABCD'}}

def header(path):
    with path.open('rb') as stream:
        if stream.readline().strip() != b'ply':
            raise ValueError(f'Not a PLY file: {path}')
        fmt, count, element, first_element, properties = None, 0, None, None, []
        while True:
            raw = stream.readline()
            if not raw or stream.tell() > 1024 * 1024:
                raise ValueError(f'Invalid PLY header: {path}')
            fields = raw.decode('utf-8', errors='replace').split()
            if not fields: continue
            if fields[0] == 'format': fmt = fields[1]
            elif fields[0] == 'element':
                element = fields[1]
                first_element = first_element or element
                if element == 'vertex': count = int(fields[2])
            elif fields[0] == 'property' and element == 'vertex':
                if fields[1] == 'list': raise ValueError('Vertex list properties are not supported by this preview converter.')
                properties.append((fields[2], TYPES[fields[1]]))
            elif fields[0] == 'end_header': break
        if first_element != 'vertex' or not count:
            raise ValueError('A nonempty vertex element must be the first PLY element.')
        return fmt, count, properties, stream.tell()

def sample_cloud(path, max_points):
    fmt, count, properties, offset = header(path)
    names = [p[0] for p in properties]
    if not all(name in names for name in ('x', 'y', 'z')): raise ValueError('XYZ properties are required.')
    indices = np.linspace(0, count - 1, min(count, max_points), dtype=np.int64)
    if fmt in ('binary_little_endian', 'binary_big_endian'):
        endian = '<' if fmt == 'binary_little_endian' else '>'
        dtype = np.dtype([(name, endian + kind) for name, kind in properties])
        if path.stat().st_size < offset + count * dtype.itemsize: raise ValueError(f'Truncated PLY: {path}')
        source = np.memmap(path, dtype=dtype, mode='r', offset=offset, shape=(count,))
        values = source[indices]
        xyz = np.column_stack([values[name] for name in ('x', 'y', 'z')]).astype(np.float64)
        color_names = ('red', 'green', 'blue') if 'red' in names else ('diffuse_red', 'diffuse_green', 'diffuse_blue')
        rgb = np.column_stack([values[name] for name in color_names]) if all(n in names for n in color_names) else None
        del source
    elif fmt == 'ascii':
        rows, next_sample = [], 0
        with path.open('rb') as stream:
            stream.seek(offset)
            for index in range(count):
                line = stream.readline()
                if not line: raise ValueError(f'Truncated PLY: {path}')
                if next_sample < len(indices) and index == indices[next_sample]:
                    rows.append([float(v) for v in line.split()]); next_sample += 1
        values = np.asarray(rows)
        xyz = values[:, [names.index(n) for n in ('x', 'y', 'z')]]
        rgb = values[:, [names.index(n) for n in ('red', 'green', 'blue')]] if all(n in names for n in ('red', 'green', 'blue')) else None
    else: raise ValueError(f'Unsupported PLY format: {fmt}')
    valid = np.isfinite(xyz).all(axis=1)
    xyz = xyz[valid]
    if not len(xyz): raise ValueError(f'No finite points: {path}')
    if rgb is None:
        rgb = np.tile([165, 205, 196], (len(xyz), 1))
    else:
        rgb = rgb[valid]
        if rgb.dtype.kind == 'f' and rgb.max() <= 1.0: rgb = rgb * 255
        rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    return xyz, rgb, count

def write_preview(path, xyz, rgb):
    output = np.empty(len(xyz), dtype=[('x', '<f4'), ('y', '<f4'), ('z', '<f4'), ('r', 'u1'), ('g', 'u1'), ('b', 'u1')])
    for i, axis in enumerate('xyz'): output[axis] = xyz[:, i]
    for i, axis in enumerate('rgb'): output[axis] = rgb[:, i]
    text = ('ply\nformat binary_little_endian 1.0\ncomment HoloRecon uniformly sampled web visualization\n'
            f'element vertex {len(xyz)}\nproperty float x\nproperty float y\nproperty float z\n'
            'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n')
    temporary = path.with_suffix('.tmp')
    with temporary.open('wb') as stream: stream.write(text.encode('ascii')); output.tofile(stream)
    temporary.replace(path)

def poster(path, xyz, rgb):
    # Camera-coordinate reconstructions use -Y as the default vertical direction.
    cloud = xyz[::max(1, len(xyz) // 350000)].copy()
    colors = rgb[::max(1, len(xyz) // 350000)]
    cloud = cloud[:, [0, 2, 1]]; cloud[:, 2] *= -1
    cloud -= (cloud.min(axis=0) + cloud.max(axis=0)) / 2
    direction = np.array([-1., 1.3, -.9]); direction /= np.linalg.norm(direction)
    right = np.cross(direction, [0, 0, 1]); right /= np.linalg.norm(right)
    up = np.cross(right, direction)
    xy = np.column_stack([cloud @ right, cloud @ up]); depth = cloud @ direction
    span = np.ptp(xy, axis=0); span = np.maximum(span, 1e-6)
    scale = min(760 / span[0], 470 / span[1])
    xy -= (xy.min(axis=0) + xy.max(axis=0)) / 2
    px = np.rint(xy[:, 0] * scale + 420).astype(int)
    py = np.rint(-xy[:, 1] * scale + 270).astype(int)
    order = np.argsort(depth)[::-1]
    pixels = np.empty((540, 840, 3), dtype=np.uint8); pixels[:] = [12, 18, 22]
    for dx, dy in ((0, 0), (1, 0), (0, 1)):
        x, y = px[order] + dx, py[order] + dy
        mask = (x >= 0) & (x < 840) & (y >= 0) & (y < 540)
        pixels[y[mask], x[mask]] = colors[order][mask]
    Image.fromarray(pixels).save(path, quality=86, method=6)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-points', type=int, default=1_000_000)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--chunk-mib', type=int, default=16, help='Maximum Dense PLY part size in MiB (1–24).')
    parser.add_argument('--refresh-only', action='store_true', help='Refresh scene choices from existing Dense parts without original PLY inputs.')
    args = parser.parse_args()
    if args.max_points < 1: parser.error('--max-points must be positive')
    if not 1 <= args.chunk_mib <= 24: parser.error('--chunk-mib must be between 1 and 24')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = []
    prior_manifest = json.loads((PCD / 'scenes.json').read_text(encoding='utf-8')) if (PCD / 'scenes.json').exists() else {}
    for path in sorted(PCD.rglob('*.ply')):
        if args.refresh_only: break
        if OUTPUT in path.parents or DENSE in path.parents: continue
        parent = path.parent.name.lower()
        if parent not in GROUPS: continue
        dataset, order = GROUPS[parent]
        key = parent + '-' + path.stem.lower()
        target, image, cache = OUTPUT / f'{key}.ply', OUTPUT / f'{key}.webp', OUTPUT / f'{key}.json'
        stamp = {'sourceBytes': path.stat().st_size, 'sourceMtime': path.stat().st_mtime_ns, 'maxPoints': args.max_points}
        if not path.stat().st_size:
            print(f'SKIP empty file: {path.relative_to(ROOT)}', flush=True); continue
        prior = json.loads(cache.read_text()) if cache.exists() else {}
        if args.force or not target.exists() or not image.exists() or prior.get('signature') != stamp:
            xyz, rgb, source_count = sample_cloud(path, args.max_points)
            write_preview(target, xyz, rgb); poster(image, xyz, rgb)
            prior = {'signature': stamp, 'sourcePoints': source_count, 'previewPoints': len(xyz),
                     'bounds': {'min': xyz.min(axis=0).tolist(), 'max': xyz.max(axis=0).tolist()}}
            cache.write_text(json.dumps(prior, indent=2) + '\n', encoding='utf-8')
        records.append({'id': key, 'dataset': dataset, 'label': LABELS.get(path.stem.lower(), path.stem),
                        'path': target.relative_to(ROOT).as_posix(), 'poster': image.relative_to(ROOT).as_posix(),
                        'bytes': target.stat().st_size, 'sourcePoints': prior['sourcePoints'],
                        'originalPath': path.relative_to(ROOT).as_posix(), 'originalBytes': path.stat().st_size,
                        'previewPoints': prior['previewPoints'], 'up': 'y', 'order': order})
        records[-1]['dense'] = prepare_chunks(path, key, DENSE, ROOT, header, TYPES, args.chunk_mib, args.force)
        print(f"READY {dataset} / {records[-1]['label']}: {prior['previewPoints']:,} / {prior['sourcePoints']:,} points", flush=True)
    records.sort(key=lambda entry: (entry.pop('order'), entry['label']))
    updated_ids = {record['id'] for record in records}
    records.extend(record for record in prior_manifest.get('scenes', []) if record['id'] not in updated_ids)
    records = available_scenes(records, ROOT)
    default_scene = 'holorecon-residence2' if any(record['id'] == 'holorecon-residence2' for record in records) else next(iter(records), {}).get('id', '')
    manifest = {'version': 2, 'defaultScene': default_scene,
                'denseDelivery': {'siteHosts': ['zhuoxiaoli.github.io'],
                                  'baseUrl': 'https://raw.githubusercontent.com/ZhuoxiaoLi/HoloRecon_page/main/'},
                'scenes': records}
    temporary = PCD / 'scenes.json.tmp'; temporary.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8'); temporary.replace(PCD / 'scenes.json')
    print(f'Available {len(records)} scenes; Dense parts: {sum(record["dense"]["parts"] for record in records)}', flush=True)
    for record in records: print(f"  {record['dataset']} / {record['label']}", flush=True)

if __name__ == '__main__': main()
