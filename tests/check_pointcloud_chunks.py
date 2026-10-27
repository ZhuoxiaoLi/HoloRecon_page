"""Verify every published Dense part and lossless source reconstruction.

python tests/check_pointcloud_chunks.py [--source-ref <original-git-commit>]
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from prepare_pointclouds import header

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-ref')
args = parser.parse_args()
catalog = json.loads((ROOT / 'assets/pcd/scenes.json').read_text(encoding='utf-8'))
assert catalog['scenes'] and any(scene['id'] == catalog['defaultScene'] for scene in catalog['scenes'])
part_count = point_count = 0
for scene in catalog['scenes']:
    manifest_path = ROOT / scene['dense']['path']
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    first = manifest_path.parent / manifest['parts'][0]['path']
    _, _, _, offset = header(first)
    original_header = re.sub(rb'(element\s+vertex\s+)\d+', lambda match: match[1] + str(manifest['sourcePoints']).encode(), first.read_bytes()[:offset], count=1)
    digest = hashlib.sha256(original_header)
    git_digest = hashlib.sha1(f"blob {manifest['sourceBytes']}\0".encode() + original_header)
    points = size = 0
    for part in manifest['parts']:
        path = manifest_path.parent / part['path']
        raw = path.read_bytes()
        assert len(raw) == part['bytes'] and len(raw) < 16 * 1024 * 1024
        assert hashlib.sha256(raw).hexdigest() == part['sha256']
        _, vertices, _, offset = header(path)
        assert vertices == part['points']
        digest.update(raw[offset:]); git_digest.update(raw[offset:])
        points += vertices; size += len(raw); part_count += 1
    assert points == manifest['sourcePoints'] and size == manifest['bytes']
    assert digest.hexdigest() == manifest['sourceSha256'], f"Lossless reconstruction failed: {scene['id']}"
    if args.source_ref:
        blob = subprocess.check_output(['git', '-c', f'safe.directory={ROOT.as_posix()}', 'rev-parse', f"{args.source_ref}:{scene['originalPath']}"], cwd=ROOT, text=True).strip()
        assert git_digest.hexdigest() == blob, f"Git source mismatch: {scene['id']}"
    point_count += points
    print(f"PASS {scene['dataset']} / {scene['label']}: {len(manifest['parts'])} parts, {points:,} points")
print(f'PASS: {len(catalog["scenes"])} scenes, {part_count} parts, {point_count:,} points; every XYZ/RGB record is byte-exact.')
