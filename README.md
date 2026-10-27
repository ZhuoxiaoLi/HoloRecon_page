# HoloRecon project page

A responsive, build-free research project page for GitHub Pages. Figures, videos, Sparse point clouds, and the pinned Three.js renderer are served by Pages. Dense parts are read from the same public repository through GitHub Raw. No external font or rendering-library CDN is required.

## Preview

From the repository root:

```sh
python -m http.server 8000
```

Open http://localhost:8000. Use this HTTP preview for the 3D viewer; ES modules, scene manifests, and worker loading require a web server.

## Publish on GitHub Pages

In **Settings → Pages**, select **Deploy from a branch**, choose `main` and **/ (root)**, then save. `_config.yml` excludes `assets/pcd/dense/` and local original inputs from the published site and explicitly includes the vendored renderer. Do not commit `.nojekyll`, because branch-based publishing must honor these exclusions. The remaining published assets total approximately 733 MB, below the [1 GB published-site limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

Dense parts stay in this repository and are served from `https://raw.githubusercontent.com/ZhuoxiaoLi/HoloRecon_page/main/`. `scenes.json` selects that delivery base on `zhuoxiaoli.github.io`; local development reads the same relative files directly. Add a custom domain to `denseDelivery.siteHosts` when using one. Raw responses allow cross-origin browser reads. Each part is under 16 MiB, below both GitHub's [100 MiB Git file limit and 25 MiB browser-upload limit](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github).

If an unpushed commit already contains oversized original PLY files, creating a later deletion commit is insufficient: those blobs remain in the history to be pushed. Back up that local commit, untrack the original inputs, and amend the unpushed commit before pushing. Keep published history intact.

## Content

- `index.html`: project description, method, figures, and page metadata.
- `assets/css/style.css`: responsive styling.
- `assets/js/main.js`: nine videos and their descriptions, collection filters, player, research figure tabs, and image viewer.
- `assets/images/`: original research figures and bibliography.
- `assets/videos/`: original MP4 videos. No video is downloaded until a visitor presses play.
- `assets/web/`: optimized WebP figures, video posters, and extracted video metadata.
- `scripts/prepare_assets.py`: regenerates the web assets with Python, Pillow, and OpenCV; leaves originals untouched.
- `assets/js/pointcloud-ui.js`: scene selection and display controls; automatically loads the default scene at startup.
- `assets/js/pointcloud-viewer.js`: Three.js rendering, orbit controls, camera presets, RGB/elevation/monochrome colors, grid, and point size.
- `assets/js/pointcloud-worker.js`: worker-based PLY parsing, finite-coordinate filtering, coordinate rotation, centering, and optional display sampling.
- `assets/js/pointcloud-chunks.js`: sequential part fetching, integrity checks, shared coordinates, global point budgets, and progressive geometry messages.
- `assets/js/ply-points.js`: direct binary XYZ/RGB decoding for full-resolution files, with a general PLYLoader fallback.
- `assets/pcd/scenes.json`: the 8 available scenes grouped as PanoRecon (5), 360LOC (1), and YUTO MMS (2).
- `assets/pcd/dense/`: 75 lossless binary PLY parts, each under 16 MiB, with per-scene manifests and SHA-256 hashes.
- `assets/pcd/web/`: 1-million-point binary RGB previews, point-cloud-derived poster images, and preprocessing metadata.
- `scripts/prepare_pointclouds.py`: generates the viewer assets from the original PLY files using NumPy and Pillow.
- `scripts/pointcloud_chunks.py`: preserves original vertex records, computes shared bounds, and filters the catalog to complete Dense folders.
- `assets/vendor/three/`: pinned Three.js 0.186.1, OrbitControls, PLYLoader, and MIT license. Imports are adapted to local relative paths; `scripts/vendor_three.py` reproduces this bundle from the checksum-verified npm package.

The video collection is organized into method demonstrations (2), PanoRecon results (4), and YUTO MMS results (3). `more_results.mp4` includes residential and road scenes from PanoRecon.

## Interactive point clouds

The homepage's **3D Viewer** supports:

- Scene selection, drag-to-orbit, right-drag panning, scroll/pinch zoom, and touch controls.
- Rendered point diameter from **0.5 to 8 CSS pixels**, independently of view zoom.
- Perspective, top, front, and reset views; positive/negative X/Y/Z up directions.
- Original RGB, elevation, monochrome, dark/light backgrounds, grid, and optional auto-rotation.
- Fullscreen with an expanded in-page fallback.
- Two **Point density** choices: **Dense** (the original point cloud) and **Sparse** (the processed point cloud).
- The page automatically loads **PanoRecon / Residence 2** in **Dense** mode on opening, without requiring a button click.
- Every scene and data version defaults to **All points · no sampling**, displaying every finite point in the selected file. Changing scenes, changing data versions, opening a local file, or pressing Load resets the display budget to all points. Optional manual display budgets are 250k, 500k, 1M, 2M, and 5M points.
- Switching versions of the same scene preserves the camera position, target, zoom, and up direction for inspecting the same detail.
- Local PLY opening in the browser; the selected file is passed to the local worker and is not uploaded.

The viewer heading notes that Dense point clouds have already been downsampled to approximately 10 million points per scene for browser visualization. “All points” displays all points in the selected served file.

Original input PLY files can be placed in `assets/pcd/pcd/{holorecon,360loc,YUTOMMS}/` for preprocessing. That local-input directory is ignored by Git. The website reads Dense data through each scene's `dense.path` manifest and no longer requires those original files to remain on disk or on the web server. The retained Dense scenes contain approximately 9.1–10.5 million points each.

Dense parts preserve every original XYZ/RGB vertex record, in its original order and binary precision; partitioning adds no sampling or quantization. The browser displays each received part immediately, in one shared coordinate system, while subsequent parts continue downloading. Filenames include their content hash for safe caching. Expected byte counts and point counts are checked; SHA-256 checks also run in secure browser contexts. Optional point budgets use one global uniform sampling sequence, giving exactly the same points as a single-file load.

Each generated PLY contains up to 1,000,000 points, uniformly sampled across input vertex order, with source XYZ and RGB values retained. Each is approximately 15 MB; all 13 total approximately 195 MB. These are display subsets, not replacement files for quantitative evaluation. Source and rendered counts are shown separately. Selecting a web preview displays all points in that preview by default, without further sampling.

All PLY loads, including originals, previews, and local files, rotate source coordinates 180° around X during parsing: `(x, y, z) → (x, −y, −z)`. This converts the supplied −Y-up reconstructions to +Y up with a proper rotation. Bounds, centering, elevation colors, camera framing, and version-switch view preservation use the same rotated coordinate system. The camera defaults to +Y up for standard orbit interaction. No source or generated PLY is rewritten by this display transform.

To generate Sparse files, Dense parts, posters, and the catalog from local original inputs, run:

```sh
python scripts/prepare_pointclouds.py
```

Use `--max-points 500000` for smaller Sparse files, `--chunk-mib 8` for smaller Dense parts, or `--force` to regenerate. Dense partitioning supports the supplied vertex-only binary PLY files. Original inputs are not modified.

After deleting a Dense scene folder, refresh the website choices without needing original files:

```sh
python scripts/prepare_pointclouds.py --refresh-only
```

The Dense folders define the available catalog. Deleted or incomplete scene folders are omitted even if an older Sparse derivative remains. Residence 2 remains the default while available; otherwise the first remaining scene is selected. Missing Sparse derivatives disable that density option for the scene.

The browser supports ASCII, binary little-endian, and binary big-endian PLY. Binary scalar XYZ/RGB data are decoded directly into typed arrays in `assets/js/ply-points.js` to avoid large intermediate JavaScript arrays when loading the full-resolution scenes. Other supported PLY layouts use the PLYLoader fallback. Display colors use packed normalized linear RGB bytes; the source files retain their original RGB values. Direct loading is limited to 512 MB. Parsing is isolated in a worker, previous workers are terminated when scenes change, and old geometry/materials are disposed. Rendering pauses offscreen and continuous rendering is used only for auto-rotation.

Implementation references: [Three.js PLYLoader](https://threejs.org/docs/pages/PLYLoader.html), [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html), [PointsMaterial](https://threejs.org/docs/pages/PointsMaterial.html), and [Potree](https://github.com/potree/potree). Potree informed the point-cloud interaction design; the embedded viewer uses the vendored Three.js modules.

## Research metadata

The page follows the supplied `paper.tex`: **HoloRecon: Incremental Reconstruction of Long-Range Panoramas with Global Consistency**. It includes all 11 authors in manuscript order, four affiliations, equal-contribution and corresponding-author markers, and the requested contact email. Quantitative tables reproduce the manuscript's mean ATE, dense F-score at 20 cm, and Residence 2 full-trajectory ablation. The 4.31× speedup refers only to the BA backend comparison. The project heading uses the manuscript title; university capitalization is normalized for display.

The manuscript does not supply an active paper, code, or dataset release URL. Add verified release links to the hero actions when available. Commented template URLs in the TeX source are not used. `main.bib` contains references to other works, not the project's citation.

## Verification

Verified in the browser at 1440, 768, 375, and 320 px widths with no page-level horizontal overflow. Wide result tables scroll within their own containers. Checked dataset collection filters (2/4/3 videos), actual MP4 playback, independently scoped quantitative and qualitative tabs, keyboard tab navigation, expanded comparisons, and the original-resolution figure viewer. Local assets and anchors resolve; JavaScript passes `node --check`. All 11 author entries and markers, 9 ATE rows, 3 F-score rows, and 5 ablation rows were checked against the supplied TeX source.

The 3D viewer was browser-tested with all 13 real scene previews, point-size endpoints, zoom/reset, color and up-axis changes, presets, lower point budgets, mouse orbit, fullscreen, and local-file scene switching. Full-resolution loading was also verified on Residence 2 (9,787,353 points), Concourse (7,833,770 points), and YUTO MMS Sequence C (9,670,880 points), including switching versions and applying a 2M display budget to an original file. Binary headers, finite coordinates, manifest/poster paths, and sampled XYZ/RGB fidelity to all 13 original files were checked. Worker checks cover ASCII RGB, invalid/empty files, nonfinite filtering, a real binary preview, and the full original Residence 2 file.

The +Y-up update was verified with automatic original Residence 2 loading from the homepage, mouse orbit, Gym in both data versions, and a local PLY. Scene/version/local-file changes restore an all-points display budget and new scenes start with +Y up. Worker checks verify the 180° X rotation on an asymmetric XYZ basis, binary big-endian coordinates, and exact normalized coordinates at the first, middle, and last vertices of the full Residence 2 file.

Chunk checks: `python tests/check_pointcloud_chunks.py` verifies all 8 scene manifests and every part's hash, byte count, point count, and lossless source reconstruction. `--source-ref <commit>` additionally compares the reconstructed Git blob IDs with an original commit. `node tests/pointcloud-chunks.mjs` compares progressive Residence 2 output byte-for-byte with a single PLY at all points and budgets of 250,003, 3, and 1, and verifies errors for missing, corrupt, and truncated parts.
