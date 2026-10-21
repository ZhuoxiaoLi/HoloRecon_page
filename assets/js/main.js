'use strict';

// All video files are local. A source is attached only after a visitor presses play.
const videos = [
  {id:'demo_online_and_depth_alignment', category:'method', label:'Method · PanoRecon', title:'Online Reconstruction and Depth Alignment', description:'Local submap construction and depth alignment on PanoRecon Residence 2, followed by the final reconstruction.', short:'Landmark-anchored depth alignment and incremental dense mapping.', duration:'02:30'},
  {id:'demo_connection_refinement', category:'method', label:'Method demonstration', title:'Global Connection Refinement', description:'Visualization of reconstruction drift and the geometric corrections obtained through connection refinement.', short:'Visualization of geometric alignment before and after refinement.', duration:'00:50'},
  {id:'residence1', category:'panorecon', label:'PanoRecon · Residence 1', title:'Residence 1', description:'Ground-level visualization of PanoRecon Residence 1, including building facades, courtyard vegetation, and pedestrian paths.', short:'Reconstructed building facades, courtyards, and pedestrian paths.', duration:'00:39'},
  {id:'residence2', category:'panorecon', label:'PanoRecon · Residence 2', title:'Residence 2', description:'Ground-level visualization of PanoRecon Residence 2, showing road surfaces, building facades, and landscaped areas.', short:'Reconstructed road surfaces, building facades, and vegetation.', duration:'00:26'},
  {id:'more_results', category:'panorecon', label:'PanoRecon · Additional Results', title:'Additional Reconstruction Results', description:'Additional qualitative visualizations of PanoRecon residential and road scenes, illustrating local scene geometry.', short:'Additional qualitative results on residential and road scenes.', duration:'01:15'},
  {id:'road', category:'panorecon', label:'PanoRecon · Road', title:'Road', description:'Street-level visualization of the PanoRecon Road scene, including roadside buildings, vegetation, and intersections.', short:'Street-level reconstruction of buildings, vegetation, and intersections.', duration:'01:48'},
  {id:'seqb', category:'yuto', label:'YUTO MMS · Sequence B', title:'Sequence B', description:'Ground-level visualization of YUTO MMS Sequence B, showing roads, surrounding buildings, and local geometric details.', short:'Road geometry and surrounding building structure.', duration:'01:39'},
  {id:'seqc', category:'yuto', label:'YUTO MMS · Sequence C', title:'Sequence C: Ground-Level Views', description:'Ground-level visualization of YUTO MMS Sequence C, showing road geometry and building facades along the camera route.', short:'Ground-level views of reconstructed roads and building facades.', duration:'02:05'},
  {id:'seqc1', category:'yuto', label:'YUTO MMS · Sequence C', title:'Sequence C: Global Structure', description:'Elevated and oblique views of YUTO MMS Sequence C, showing the spatial arrangement of the reconstructed street network.', short:'Global street-network geometry from elevated and oblique viewpoints.', duration:'01:31'}
];

const grid = document.querySelector('#video-grid');
const player = document.querySelector('#featured-video');
const launch = document.querySelector('#video-launch');
const error = document.querySelector('.video-error');
let selected = videos[0];

function renderCollection(filter = 'all') {
  const items = videos.filter(video => filter === 'all' || video.category === filter);
  grid.replaceChildren(...items.map(video => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'video-card';
    button.setAttribute('aria-pressed', String(video.id === selected.id));
    button.setAttribute('aria-label', `Play ${video.title}, ${video.duration}`);
    button.dataset.video = video.id;
    // Text is authored locally in the collection above, never taken from user input.
    button.innerHTML = `<div class="video-thumb"><img src="assets/web/${video.id}-poster.webp" alt="" loading="lazy" width="1000" height="563"><span class="card-play" aria-hidden="true">▶</span><span class="card-duration">${video.duration}</span></div><span class="card-category">${video.label.toUpperCase()}</span><h3>${video.title}</h3><p>${video.short}</p>`;
    button.addEventListener('click', () => selectVideo(video));
    return button;
  }));
  document.querySelector('#collection-count').textContent = `Showing ${items.length} videos`;
}

function playSelected() {
  if (!player.getAttribute('src')) {
    player.src = `assets/videos/${selected.id}.mp4`;
    player.load();
  }
  launch.hidden = true;
  player.play().catch(() => {
    // Native controls remain available if browser autoplay policy rejects play().
  });
}

function selectVideo(video) {
  player.pause();
  selected = video;
  player.removeAttribute('src');
  player.poster = `assets/web/${video.id}-poster.webp`;
  player.setAttribute('aria-label', video.title);
  player.load();
  error.hidden = true;
  document.querySelector('#featured-category').textContent = video.label.toUpperCase();
  document.querySelector('#featured-title').textContent = video.title;
  document.querySelector('#featured-description').textContent = video.description;
  document.querySelector('#featured-duration').textContent = video.duration;
  document.querySelector('#video-direct').href = `assets/videos/${video.id}.mp4`;
  launch.setAttribute('aria-label', `Play ${video.title}`);
  launch.querySelector('small').textContent = video.duration;
  launch.querySelector('span:last-child').firstChild.textContent = 'PLAY VIDEO ';
  document.querySelectorAll('.video-card').forEach(card => card.setAttribute('aria-pressed', String(card.dataset.video === video.id)));
  playSelected();
  document.querySelector('.featured-player').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start'});
  player.focus({preventScroll:true});
}

launch.addEventListener('click', playSelected);
player.addEventListener('play', () => { launch.hidden = true; });
player.addEventListener('error', () => {
  if (player.getAttribute('src')) {
    error.hidden = false;
    launch.hidden = true;
  }
});
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  renderCollection(button.dataset.filter);
}));
document.querySelector('[data-show-method]').addEventListener('click', () => document.querySelector('[data-filter="method"]').click());
renderCollection();

// Each independent tab list owns its panels and keyboard navigation.
document.querySelectorAll('[role="tablist"]').forEach(tablist => {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  function activateTab(tab) {
    tabs.forEach(item => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      activateTab(tabs[next]);
      tabs[next].focus();
    });
  });
});

const dialog = document.querySelector('#image-dialog');
document.querySelectorAll('[data-image]').forEach(button => button.addEventListener('click', () => {
  document.querySelector('#dialog-image').src = button.dataset.image;
  document.querySelector('#dialog-image').alt = button.dataset.caption;
  document.querySelector('#image-caption').textContent = button.dataset.caption;
  document.querySelector('#original-image').href = button.dataset.image;
  dialog.showModal();
  document.body.classList.add('modal-open');
}));
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => document.body.classList.remove('modal-open'));
dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
