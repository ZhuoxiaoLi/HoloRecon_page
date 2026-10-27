// Load the default scene at startup; keep PLY parsing off the main thread.
const $ = id => document.getElementById(id);
const host = $('pc-viewport'), shell = $('pc-viewer'), sceneSelect = $('pc-scene');
let scenes = [], activeSource = null, displayedSource = null, localSource = null, viewer = null, viewerPromise = null, generation = 0;
let denseBaseUrl = document.baseURI;
const number = value => new Intl.NumberFormat('en').format(value);

function message(title, text, { loading = false, retry = true } = {}) {
  $('pc-message').hidden = false;
  $('pc-message-title').textContent = title;
  $('pc-message-text').textContent = text;
  $('pc-progress').hidden = !loading;
  $('pc-start').hidden = !retry;
  if (loading) $('pc-progress').removeAttribute('value');
}

function preview(scene) {
  if (scene?.poster) {
    const url = new URL(scene.poster, document.baseURI).href;
    host.style.setProperty('--pc-poster', `url("${url}")`);
    $('pc-poster').setAttribute('aria-label', `2D point-cloud preview of ${scene.dataset} ${scene.label}`);
  }
}

async function getViewer() {
  if (!viewerPromise) {
    viewerPromise = import('./pointcloud-viewer.js?v=7').then(({ PointCloudViewer }) => {
      viewer = new PointCloudViewer(host, zoom => {
        $('pc-zoom').value = Math.max(.25, Math.min(4, zoom));
        $('pc-zoom-value').value = `${zoom.toFixed(2)}×`;
      });
      return viewer;
    }).catch(error => { viewerPromise = null; throw error; });
  }
  return viewerPromise;
}

function selectedScene() { return scenes.find(scene => scene.id === sceneSelect.value); }

function syncResolutionOptions() {
  const local = sceneSelect.value === '__local__';
  $('pc-resolution').disabled = local;
  const sparse = $('pc-resolution').querySelector('[value="preview"]');
  sparse.disabled = local || !selectedScene()?.path;
  if (sparse.disabled) $('pc-resolution').value = 'original';
}

function sourceInfo(scene = selectedScene()) {
  const original = $('pc-resolution').value === 'original';
  if (sceneSelect.value === '__local__' && localSource) {
    $('pc-source-info').textContent = `Local PLY file · ${(localSource.file.size / 1e6).toFixed(1)} MB`;
    return;
  }
  if (!scene) return;
  const count = original ? scene.sourcePoints : scene.previewPoints;
  const bytes = original ? scene.originalBytes : scene.bytes;
  $('pc-source-info').textContent = `${original ? 'Dense' : 'Sparse'} point cloud · ${number(count)} points · ${(bytes / 1e6).toFixed(1)} MB`;
}

async function load(source) {
  if (!source) return;
  const sameScene = Boolean((source.scene && source.scene.id === displayedSource?.scene?.id) || (source.file && source.file === displayedSource?.file));
  const ticket = ++generation;
  activeSource = source;
  preview(source.scene);
  host.setAttribute('aria-busy', 'true');
  host.dataset.ready = 'false';
  delete host.dataset.loadedParts;
  delete host.dataset.totalParts;
  $('pc-controls').disabled = true;
  $('pc-poster').hidden = false;
  $('pc-view-badge').textContent = 'LOADING 3D GEOMETRY';
  $('pc-stats').textContent = source.name;
  message('Loading point cloud', 'Preparing the interactive scene…', { loading: true, retry: false });
  try {
    const engine = await getViewer();
    if (ticket !== generation) return;
    const desiredUp = sameScene ? $('pc-up').value : 'y';
    if ((engine.upSign < 0 ? '-' : '') + engine.upAxis !== desiredUp) engine.setUpAxis(desiredUp);
    $('pc-up').value = desiredUp;
    const input = source.file ? { file: source.file, mode: source.mode }
      : source.chunkManifestUrl ? { chunkManifestUrl: source.chunkManifestUrl, mode: source.mode }
      : { url: source.url, mode: source.mode };
    const info = await engine.load({ ...input, preserveView: sameScene }, Number($('pc-budget').value), progress => {
      if (ticket !== generation) return;
      if (progress.type === 'begin') return;
      if (progress.type === 'chunk') {
        $('pc-poster').hidden = true;
        $('pc-message').hidden = true;
        host.dataset.loadedParts = String(progress.part);
        host.dataset.totalParts = String(progress.parts);
        $('pc-view-badge').textContent = `LOADING DENSE · ${source.name}`;
        $('pc-stats').textContent = `${number(progress.loadedPoints)} / ${number(progress.totalPoints)} points · ${progress.part} / ${progress.parts} parts`;
        $('pc-data-note').textContent = `Loading Dense point cloud… ${Math.round(progress.received / progress.total * 100)}% complete. Geometry appears progressively as each part arrives.`;
      } else if (progress.type === 'parsing') {
        $('pc-message-text').textContent = 'Preparing geometry and colors…';
        $('pc-progress').removeAttribute('value');
      } else {
        const mb = (progress.received / 1e6).toFixed(1);
        $('pc-message-text').textContent = `Downloading ${mb} MB${progress.total ? ` of ${(progress.total / 1e6).toFixed(1)} MB` : ''}…`;
        if (progress.total) $('pc-progress').value = progress.received / progress.total * 100;
      }
    });
    if (ticket !== generation) return;
    displayedSource = source;
    const hasRgb = Boolean(info.colors);
    $('pc-color').querySelector('[value="rgb"]').disabled = !hasRgb;
    if (!hasRgb && $('pc-color').value === 'rgb') $('pc-color').value = 'height';
    if (engine.colorMode !== $('pc-color').value) engine.setColorMode($('pc-color').value);
    engine.setPointSize($('pc-size').value);
    engine.setBackground($('pc-background').value);
    engine.setGrid($('pc-grid').checked);
    engine.setAutoRotate($('pc-rotate').checked);
    $('pc-controls').disabled = false;
    $('pc-message').hidden = true;
    $('pc-poster').hidden = true;
    host.dataset.ready = 'true';
    $('pc-view-badge').textContent = `${source.mode === 'original' ? 'DENSE' : 'SPARSE'} · ${source.name}`;
    host.dataset.sourceMode = source.mode;
    const total = source.scene?.sourcePoints || info.total;
    $('pc-stats').textContent = `${number(info.count)} displayed · ${number(total)} source points`;
    $('pc-data-note').textContent = source.mode === 'original'
      ? (info.count === info.total ? 'Dense point cloud loaded. All finite source points are displayed without display downsampling.' : `Dense point cloud loaded. The display budget currently shows ${number(info.count)} of ${number(info.total)} finite points; choose “All points” for full detail.`)
      : 'Sparse point cloud loaded. Select “Dense” to inspect the complete scene geometry.';
  } catch (error) {
    if (ticket !== generation || error.name === 'AbortError') return;
    $('pc-view-badge').textContent = 'SCENE PREVIEW · 3D NOT LOADED';
    $('pc-stats').textContent = 'Point cloud not loaded';
    message('Unable to open this scene', error.message || 'The viewer could not load the point cloud. Try another scene or open a local PLY file.');
  } finally {
    if (ticket === generation) host.setAttribute('aria-busy', 'false');
  }
}

function loadSelected() {
  // A new scene/version or an explicit load always starts without display sampling.
  // The budget control can still explicitly reload the current source at a lower count.
  $('pc-budget').value = '0';
  if (sceneSelect.value === '__local__' && localSource?.file) { load(localSource); return; }
  const scene = selectedScene();
  if (!scene) { message('Select a scene', 'Choose a listed scene or open a local PLY file.'); return; }
  const mode = $('pc-resolution').value;
  if (mode === 'original' && scene.dense?.path) {
    load({ scene, mode, name: `${scene.dataset} / ${scene.label}`, chunkManifestUrl: new URL(scene.dense.path, denseBaseUrl).href });
    return;
  }
  const path = mode === 'original' ? scene.originalPath : scene.path;
  if (!path) { message('Point cloud unavailable', `No ${mode === 'original' ? 'Dense' : 'Sparse'} PLY path is configured for this scene.`); return; }
  load({ scene, mode, name: `${scene.dataset} / ${scene.label}`, url: new URL(path, document.baseURI).href });
}

async function init() {
  try {
    const response = await fetch(new URL('../pcd/scenes.json', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error('The point-cloud scene list is unavailable.');
    const manifest = await response.json();
    // Pages excludes the large Dense directory; Raw serves it from this same repository.
    if (manifest.denseDelivery?.siteHosts?.includes(location.hostname.toLowerCase())) denseBaseUrl = manifest.denseDelivery.baseUrl;
    scenes = manifest.scenes.filter(scene => (scene.dense?.path || scene.path) && scene.id && scene.label);
    sceneSelect.replaceChildren();
    for (const dataset of [...new Set(scenes.map(scene => scene.dataset))]) {
      const group = document.createElement('optgroup'); group.label = dataset;
      for (const scene of scenes.filter(item => item.dataset === dataset)) {
        const option = document.createElement('option'); option.value = scene.id;
        option.textContent = scene.label;
        group.append(option);
      }
      sceneSelect.append(group);
    }
    sceneSelect.value = scenes.some(scene => scene.id === manifest.defaultScene) ? manifest.defaultScene : scenes[0]?.id || '';
    $('pc-load').disabled = !scenes.length;
    syncResolutionOptions();
    preview(selectedScene());
    sourceInfo();
    if (scenes.length) loadSelected();
    else message('No point clouds available', 'Open a local PLY file to inspect a reconstruction.', { retry: false });
  } catch (error) {
    sceneSelect.replaceChildren(new Option('Scene list unavailable', ''));
    message('Scene list unavailable', `${error.message} You can open a local PLY file instead.`, { retry: false });
  }
}

$('pc-load').addEventListener('click', loadSelected);
$('pc-start').addEventListener('click', () => activeSource ? load(activeSource) : loadSelected());
sceneSelect.addEventListener('change', () => {
  syncResolutionOptions();
  sourceInfo();
  const scene = selectedScene();
  if (activeSource) loadSelected();
  else {
    preview(scene);
    $('pc-stats').textContent = `${scene.dataset} / ${scene.label} · ${(scene.bytes / 1e6).toFixed(1)} MB`;
  }
});
$('pc-resolution').addEventListener('change', () => {
  $('pc-budget').value = '0';
  sourceInfo();
  if (activeSource) loadSelected();
});
$('pc-local-open').addEventListener('click', () => $('pc-local-file').click());
$('pc-local-file').addEventListener('change', event => {
  const file = event.target.files[0];
  if (file) {
    sceneSelect.querySelector('[value="__local__"]')?.remove();
    const option = new Option(`Local file: ${file.name}`, '__local__');
    sceneSelect.prepend(option); sceneSelect.value = '__local__';
    $('pc-resolution').value = 'original'; $('pc-resolution').disabled = true;
    $('pc-budget').value = '0';
    localSource = { file, name: file.name, mode: 'original' };
    sourceInfo();
    load(localSource);
  }
  event.target.value = '';
});
$('pc-size').addEventListener('input', event => {
  $('pc-size-value').value = `${Number(event.target.value).toFixed(1)} px`;
  viewer?.setPointSize(event.target.value);
});
$('pc-zoom').addEventListener('input', event => viewer?.setZoom(event.target.value));
$('pc-color').addEventListener('change', event => viewer?.setColorMode(event.target.value));
$('pc-background').addEventListener('change', event => viewer?.setBackground(event.target.value));
$('pc-up').addEventListener('change', event => viewer?.setUpAxis(event.target.value));
$('pc-grid').addEventListener('change', event => viewer?.setGrid(event.target.checked));
$('pc-rotate').addEventListener('change', event => viewer?.setAutoRotate(event.target.checked));
$('pc-reset').addEventListener('click', () => viewer?.fitView());
document.querySelectorAll('[data-pc-view]').forEach(button => button.addEventListener('click', () => viewer?.fitView(button.dataset.pcView)));
$('pc-budget').addEventListener('change', () => { if (activeSource) load(activeSource); });

function fullscreenLabel() {
  const expanded = document.fullscreenElement === shell || shell.classList.contains('pc-expanded');
  $('pc-fullscreen').setAttribute('aria-label', expanded ? 'Exit point cloud fullscreen' : 'Enter point cloud fullscreen');
  $('pc-fullscreen').title = expanded ? 'Exit fullscreen' : 'Fullscreen';
}
function closeExpanded() { shell.classList.remove('pc-expanded'); document.body.classList.remove('pc-modal'); fullscreenLabel(); }
$('pc-fullscreen').addEventListener('click', async () => {
  if (document.fullscreenElement === shell) { await document.exitFullscreen(); return; }
  if (shell.classList.contains('pc-expanded')) { closeExpanded(); return; }
  try { if (!shell.requestFullscreen) throw new Error(); await shell.requestFullscreen(); }
  catch { shell.classList.add('pc-expanded'); document.body.classList.add('pc-modal'); }
  fullscreenLabel();
});
document.addEventListener('fullscreenchange', fullscreenLabel);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeExpanded(); });
host.addEventListener('pc-context-lost', () => {
  $('pc-controls').disabled = true;
  message('Graphics context interrupted', 'Reload the page to restore the 3D view.', { retry: false });
});
window.addEventListener('pagehide', event => { if (!event.persisted) viewer?.dispose(); });
init();
