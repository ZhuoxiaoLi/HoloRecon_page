# HoloRecon project page

A responsive, build-free research project page for GitHub Pages. All figures and videos are served from this repository; there are no external font, JavaScript, or framework dependencies.

## Preview

From the repository root:

```sh
python -m http.server 8000
```

Open http://localhost:8000. You can also open `index.html` directly.

## Publish on GitHub Pages

Push these files to the GitHub repository. In **Settings → Pages**, select **Deploy from a branch**, choose your branch and **/ (root)**, then save. `.nojekyll` allows GitHub Pages to serve the static files directly. All asset links are relative and work under a repository subpath.

## Content

- `index.html`: project description, method, figures, and page metadata.
- `assets/css/style.css`: responsive styling.
- `assets/js/main.js`: nine videos and their descriptions, collection filters, player, research figure tabs, and image viewer.
- `assets/images/`: original research figures and bibliography.
- `assets/videos/`: original MP4 videos. No video is downloaded until a visitor presses play.
- `assets/web/`: optimized WebP figures, video posters, and extracted video metadata.
- `scripts/prepare_assets.py`: regenerates the web assets with Python, Pillow, and OpenCV; leaves originals untouched.

The video collection is organized into method demonstrations (2), PanoRecon results (4), and YUTO MMS results (3). `more_results.mp4` includes residential and road scenes from PanoRecon.

## Research metadata

The page follows the supplied `paper.tex`: **HoloRecon: Incremental Reconstruction of Long-Range Panoramas with Global Consistency**. It includes all 11 authors in manuscript order, four affiliations, equal-contribution and corresponding-author markers, and the requested contact email. Quantitative tables reproduce the manuscript's mean ATE, dense F-score at 20 cm, and Residence 2 full-trajectory ablation. The 4.31× speedup refers only to the BA backend comparison. The project heading uses the manuscript title; university capitalization is normalized for display.

The manuscript does not supply an active paper, code, or dataset release URL. Add verified release links to the hero actions when available. Commented template URLs in the TeX source are not used. `main.bib` contains references to other works, not the project's citation.

## Verification

Verified in the browser at 1440, 768, 375, and 320 px widths with no page-level horizontal overflow. Wide result tables scroll within their own containers. Checked dataset collection filters (2/4/3 videos), actual MP4 playback, independently scoped quantitative and qualitative tabs, keyboard tab navigation, expanded comparisons, and the original-resolution figure viewer. Local assets and anchors resolve; JavaScript passes `node --check`. All 11 author entries and markers, 9 ATE rows, 3 F-score rows, and 5 ablation rows were checked against the supplied TeX source.
