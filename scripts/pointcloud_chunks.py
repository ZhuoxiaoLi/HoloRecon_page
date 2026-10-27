"""Split binary PLY vertex records losslessly for progressive browser loading."""
from pathlib import Path
import hashlib
import json
import re
import numpy as np


def available_scenes(records, root):
    """Dense folders define the catalog; deleted/incomplete scenes are omitted."""
    available = []
    for record in records:
        manifest_path = root / record.get('dense', {}).get('path', '__missing__')
        if not manifest_path.is_file():
            continue
        dense = json.loads(manifest_path.read_text(encoding='utf-8'))
        if not dense.get('parts') or not all(
            (manifest_path.parent / part['path']).is_file() and
            (manifest_path.parent / part['path']).stat().st_size == part['bytes'] for part in dense['parts']
        ):
            continue
        record['dense'] = {'path': manifest_path.relative_to(root).as_posix(), 'bytes': dense['bytes'], 'parts': len(dense['parts'])}
        if not (root / record.get('path', '__missing__')).is_file():
            record['path'] = None
        available.append(record)
    return available


def prepare_chunks(path, key, output, root, read_header, types, chunk_mib=16, force=False):
    fmt, count, properties, offset = read_header(path)
    if fmt not in ('binary_little_endian', 'binary_big_endian'):
        raise ValueError(f'Dense chunk preparation requires binary PLY: {path}')
    endian = '<' if fmt == 'binary_little_endian' else '>'
    dtype = np.dtype([(name, endian + kind) for name, kind in properties])
    if path.stat().st_size != offset + count * dtype.itemsize:
        raise ValueError(f'Expected a vertex-only binary PLY: {path}')
    target = output / key
    target.mkdir(parents=True, exist_ok=True)
    manifest_path = target / 'manifest.json'
    signature = {'bytes': path.stat().st_size, 'mtime': path.stat().st_mtime_ns, 'chunkMiB': chunk_mib}
    if not force and manifest_path.exists():
        cached = json.loads(manifest_path.read_text(encoding='utf-8'))
        if cached.get('signature') == signature and all(
            (target / part['path']).is_file() and (target / part['path']).stat().st_size == part['bytes']
            for part in cached['parts']
        ):
            return {'path': manifest_path.relative_to(root).as_posix(), 'bytes': cached['bytes'], 'parts': len(cached['parts'])}
    source = np.memmap(path, dtype=dtype, mode='r', offset=offset, shape=(count,))
    with path.open('rb') as stream:
        original_header = stream.read(offset)
    minimum = np.full(3, np.inf)
    maximum = np.full(3, -np.inf)
    valid_total, parts, source_digest = 0, [], hashlib.sha256(original_header)
    # Leave header space so the entire standalone PLY stays below the chosen limit.
    per_part = max(1, (chunk_mib * 1024 * 1024 - offset - 128) // dtype.itemsize)
    for index, start in enumerate(range(0, count, per_part)):
        block = source[start:min(start + per_part, count)]
        xyz = np.column_stack([block[axis] for axis in 'xyz'])
        finite = np.isfinite(xyz).all(axis=1)
        valid_count = int(finite.sum())
        if valid_count:
            minimum = np.minimum(minimum, xyz[finite].min(axis=0))
            maximum = np.maximum(maximum, xyz[finite].max(axis=0))
        raw = block.tobytes()
        source_digest.update(raw)
        part_header = re.sub(rb'(element\s+vertex\s+)\d+', lambda match: match[1] + str(len(block)).encode(), original_header, count=1)
        digest = hashlib.sha256(part_header + raw).hexdigest()
        name = f'part-{index + 1:04d}-{digest[:16]}.ply'
        destination = target / name
        if not destination.exists() or destination.stat().st_size != len(part_header) + len(raw) or force:
            temporary = destination.with_suffix('.tmp')
            with temporary.open('wb') as stream:
                stream.write(part_header)
                stream.write(raw)
            temporary.replace(destination)
        parts.append({'path': name, 'bytes': destination.stat().st_size, 'points': len(block),
                      'validPoints': valid_count, 'pointOffset': valid_total, 'sha256': digest})
        valid_total += valid_count
    del source
    if not valid_total:
        raise ValueError(f'No finite points: {path}')
    names = {name for name, _ in properties}
    has_rgb = any(set(group).issubset(names) for group in [('red', 'green', 'blue'), ('diffuse_red', 'diffuse_green', 'diffuse_blue'), ('r', 'g', 'b')])
    manifest = {'version': 1, 'format': 'ply-chunks', 'sourcePoints': count, 'validPoints': valid_total,
                'sourceBytes': path.stat().st_size, 'sourceSha256': source_digest.hexdigest(),
                'bytes': sum(part['bytes'] for part in parts), 'hasColors': has_rgb,
                'bounds': {'min': minimum.tolist(), 'max': maximum.tolist()},
                'signature': signature, 'parts': parts}
    temporary = manifest_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    temporary.replace(manifest_path)
    return {'path': manifest_path.relative_to(root).as_posix(), 'bytes': manifest['bytes'], 'parts': len(parts)}
