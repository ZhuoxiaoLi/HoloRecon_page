"""Create lightweight web images and video posters from the supplied research assets.

Run with Python, Pillow, and OpenCV. Originals are left untouched.
"""
from pathlib import Path
import json
import cv2
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'web'
OUT.mkdir(exist_ok=True)

for source in (ROOT / 'assets' / 'images').glob('*.jpg'):
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert('RGB')
        image.thumbnail((2400, 1800))
        image.save(OUT / f'{source.stem}.webp', quality=86, method=6)

with Image.open(ROOT / 'assets' / 'images' / 'stafff.jpg') as image:
    # The upper panel is the full reconstructed scene; lower panels are detail views.
    image = image.crop((0, 0, image.width, 1220))
    image.thumbnail((2000, 1200))
    image.save(OUT / 'hero.webp', quality=90, method=6)

metadata = []
for source in (ROOT / 'assets' / 'videos').glob('*.mp4'):
    video = cv2.VideoCapture(str(source))
    fps = video.get(cv2.CAP_PROP_FPS)
    duration = video.get(cv2.CAP_PROP_FRAME_COUNT) / fps
    fraction = .7 if source.stem == 'demo_online_and_depth_alignment' else .35
    video.set(cv2.CAP_PROP_POS_MSEC, duration * fraction * 1000)
    ok, frame = video.read()
    if not ok:
        raise RuntimeError(f'Could not extract a poster: {source.name}')
    image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    image.thumbnail((1000, 650))
    image.save(OUT / f'{source.stem}-poster.webp', quality=84, method=6)
    metadata.append({'file': source.name, 'seconds': round(duration, 1),
                     'width': int(video.get(3)), 'height': int(video.get(4))})
    video.release()
(OUT / 'video-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(f'Prepared {len(metadata)} video posters and optimized research figures in {OUT}')
