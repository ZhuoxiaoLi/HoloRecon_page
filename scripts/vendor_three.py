"""Fetch the pinned MIT-licensed viewer dependencies from the official npm registry."""
from pathlib import Path
import hashlib
import io
import tarfile
import urllib.request

VERSION = '0.186.1'
EXPECTED_SHA1 = '6d50f70c2c437f844179bbb56d6f5b774e1ca38a'
ROOT = Path(__file__).resolve().parents[1]
destination = ROOT / 'assets' / 'vendor' / 'three'
payload = urllib.request.urlopen(
    f'https://registry.npmjs.org/three/-/three-{VERSION}.tgz', timeout=60
).read()
if hashlib.sha1(payload).hexdigest() != EXPECTED_SHA1:
    raise RuntimeError('Downloaded archive does not match the published npm checksum.')
files = {
    'package/build/three.module.js': 'three.module.js',
    'package/build/three.core.js': 'three.core.js',
    'package/examples/jsm/controls/OrbitControls.js': 'OrbitControls.js',
    'package/examples/jsm/loaders/PLYLoader.js': 'PLYLoader.js',
    'package/LICENSE': 'LICENSE',
}
destination.mkdir(parents=True, exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
    for name, target in files.items():
        source = archive.extractfile(name).read().decode('utf-8')
        source = source.replace("from 'three'", "from './three.module.js'")
        (destination / target).write_text(source, encoding='utf-8')
print(f'Vendored Three.js {VERSION}, OrbitControls, PLYLoader, and MIT license.')
