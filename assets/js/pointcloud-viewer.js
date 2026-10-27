import * as THREE from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

export class PointCloudViewer {
  constructor(host, onZoom) {
    this.host = host;
    this.onZoom = onZoom;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#101b23');
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', 'Interactive point cloud. Drag to orbit, right-drag to pan, and scroll to zoom. Arrow keys pan; plus and minus zoom; R resets the view.');
    host.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.autoRotateSpeed = .6;
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.controls.addEventListener('change', () => {
      if (this.baseDistance) this.onZoom?.(this.baseDistance / this.controls.getDistance());
      this.requestRender();
    });
    this.renderer.domElement.addEventListener('pointerdown', () => this.renderer.domElement.focus({ preventScroll: true }));
    this.renderer.domElement.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === 'r' || event.key === 'Home') { event.preventDefault(); this.fitView(); }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); this.setZoom(this.baseDistance / this.controls.getDistance() * 1.15); }
      if (event.key === '-') { event.preventDefault(); this.setZoom(this.baseDistance / this.controls.getDistance() / 1.15); }
    });
    this.upAxis = 'y';
    this.upSign = 1;
    this.colorMode = 'rgb';
    this.pointSize = 2;
    this.visible = true;
    this.grid = new THREE.GridHelper(140, 28, '#537579', '#29404b');
    this.grid.visible = false;
    this.scene.add(this.grid);
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = Math.hypot(x - 15.5, y - 15.5) <= 15.5 ? 255 : 0;
    }
    this.pointTexture = new THREE.DataTexture(pixels, 32, 32);
    this.pointTexture.needsUpdate = true;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.intersectionObserver = new IntersectionObserver(entries => { this.visible = entries[0].isIntersecting; if (this.visible) this.requestRender(); });
    this.intersectionObserver.observe(host);
    this.visibilityHandler = () => { if (!document.hidden) this.requestRender(); };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.contextLostHandler = event => { event.preventDefault(); host.dispatchEvent(new CustomEvent('pc-context-lost')); };
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLostHandler);
    this.resize();
  }

  load(source, budget, onProgress) {
    this.cancelLoad();
    const savedView = source.preserveView && this.cloud && this.info ? {
      camera: this.camera.position.toArray(), target: this.controls.target.toArray(),
      center: this.info.center, scale: this.info.scale, baseDistance: this.baseDistance
    } : null;
    this.clearCloud();
    return new Promise((resolve, reject) => {
      this.pendingReject = reject;
      const worker = this.worker = new Worker(new URL('./pointcloud-worker.js?v=6', import.meta.url), { type: 'module' });
      const finish = () => { worker.terminate(); if (this.worker === worker) this.worker = null; this.pendingReject = null; };
      worker.onerror = () => { finish(); reject(new Error('The point-cloud worker could not read this file. Check that all viewer files are available.')); };
      worker.onmessage = ({ data }) => {
        if (data.type === 'begin' || data.type === 'chunk') {
          try {
            if (data.type === 'begin') this.installCloud({ ...data, positions: new Float32Array(data.count * 3), colors: data.hasColors ? new Uint8Array(data.count * 3) : null, progressive: true }, savedView);
            else this.appendChunk(data);
            onProgress?.(data);
          } catch (error) { finish(); reject(error); }
          return;
        }
        if (data.type === 'progress' || data.type === 'parsing') { onProgress?.(data); return; }
        if (data.type === 'error') { finish(); reject(new Error(data.message)); return; }
        if (data.type === 'complete') {
          finish(); this.info.parts = data.parts; this.info.progressive = false;
          this.renderer.domElement.dataset.renderedPoints = String(data.count);
          resolve(this.info); return;
        }
        if (data.type !== 'loaded') return;
        finish();
        try { this.installCloud(data, savedView); resolve(data); } catch (error) { reject(error); }
      };
      worker.postMessage({ ...source, budget });
    });
  }

  cancelLoad() {
    this.worker?.terminate(); this.worker = null;
    this.pendingReject?.(new DOMException('Loading cancelled', 'AbortError')); this.pendingReject = null;
  }

  installCloud(data, savedView) {
    this.info = data;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    if (data.progressive) {
      geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(...data.bounds.min.map((value, axis) => (value - data.center[axis]) * data.scale)),
        new THREE.Vector3(...data.bounds.max.map((value, axis) => (value - data.center[axis]) * data.scale)));
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
      geometry.setDrawRange(0, 0);
    } else { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
    this.originalColors = data.colors;
    const material = new THREE.PointsMaterial({ size: this.pointSize, sizeAttenuation: false, color: '#c4e7e2', map: this.pointTexture, alphaTest: .5 });
    this.cloud = new THREE.Points(geometry, material);
    this.scene.add(this.cloud);
    this.radius = Math.max(geometry.boundingSphere.radius, 1);
    this.camera.near = Math.max(.001, this.radius / 10000);
    this.camera.far = this.radius * 200;
    this.controls.minDistance = this.radius * .002;
    this.controls.maxDistance = this.radius * 50;
    this.setColorMode(this.originalColors ? this.colorMode : 'height', 0, data.progressive ? 0 : undefined);
    this.updateUp();
    this.fitView();
    if (savedView) {
      const transform = values => values.map((value, axis) => (value / savedView.scale + savedView.center[axis] - data.center[axis]) * data.scale);
      this.camera.position.fromArray(transform(savedView.camera));
      this.controls.target.fromArray(transform(savedView.target));
      this.baseDistance = savedView.baseDistance / savedView.scale * data.scale;
      this.controls.update();
      this.onZoom?.(this.baseDistance / this.controls.getDistance());
      this.requestRender();
    }
    this.renderer.domElement.dataset.renderedPoints = String(data.progressive ? 0 : data.count);
    this.renderer.domElement.dataset.pointBudget = String(data.requestedBudget);
    this.setPointSize(this.pointSize);
  }

  appendChunk(data) {
    if (!this.cloud || data.offset + data.count > this.info.count) throw new Error('Unexpected point-cloud part size.');
    const geometry = this.cloud.geometry, position = geometry.getAttribute('position');
    const offset = data.offset * 3;
    position.array.set(data.positions, offset);
    position.addUpdateRange(offset, data.positions.length); position.needsUpdate = true;
    if (this.originalColors && data.colors) {
      this.originalColors.set(data.colors, offset);
      if (this.colorMode === 'rgb') {
        const color = geometry.getAttribute('color');
        color.array.set(data.colors, offset); color.addUpdateRange(offset, data.colors.length); color.needsUpdate = true;
      }
    }
    if (this.colorMode === 'height' || (this.colorMode === 'rgb' && !this.originalColors)) this.setColorMode(this.colorMode, data.offset, data.count);
    geometry.setDrawRange(0, data.loadedPoints);
    this.renderer.domElement.dataset.renderedPoints = String(data.loadedPoints);
    this.requestRender();
  }

  clearCloud() {
    if (this.cloud) {
      this.scene.remove(this.cloud);
      this.cloud.geometry.dispose(); this.cloud.material.dispose();
      this.cloud = null;
    }
    this.info = null; this.originalColors = null; this.heightColors = null;
    delete this.renderer.domElement.dataset.renderedPoints;
    this.requestRender();
  }

  resize() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    const previousAspect = this.camera.aspect;
    this.camera.aspect = width / height;
    if (this.cloud && this.baseDistance && previousAspect !== this.camera.aspect) {
      const ratio = Math.min(1, previousAspect) / Math.min(1, this.camera.aspect);
      const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(ratio);
      this.camera.position.copy(this.controls.target).add(offset);
      this.baseDistance *= ratio;
      this.controls.update();
    }
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  fitView(preset = 'perspective') {
    if (!this.cloud) return;
    const halfVertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * this.camera.aspect);
    const vectors = {
      z: { perspective: [1, -1.3, .9], front: [0, -1, .05], top: [0, -.001, 1] },
      y: { perspective: [1, .9, 1.3], front: [0, .05, 1], top: [0, 1, .001] },
      x: { perspective: [.9, 1, 1.3], front: [.05, 0, 1], top: [1, 0, .001] }
    };
    this.controls.target.set(0, 0, 0);
    const direction = new THREE.Vector3().fromArray(vectors[this.upAxis][preset] || vectors[this.upAxis].perspective);
    const axis = { x: 0, y: 1, z: 2 }[this.upAxis];
    direction.setComponent(axis, direction.getComponent(axis) * this.upSign).normalize();
    const right = new THREE.Vector3().crossVectors(this.camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const box = this.cloud.geometry.boundingBox;
    let distance = this.radius * .1;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const corner = new THREE.Vector3(x, y, z);
      const depth = corner.dot(direction);
      distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / Math.tan(halfHorizontal), depth + Math.abs(corner.dot(up)) / Math.tan(halfVertical));
    }
    this.baseDistance = distance * 1.1;
    this.camera.position.copy(direction).multiplyScalar(this.baseDistance);
    this.controls.update(); this.camera.updateProjectionMatrix();
    this.onZoom?.(1); this.requestRender();
  }

  setZoom(value) {
    if (!this.cloud || !this.baseDistance) return;
    const zoom = THREE.MathUtils.clamp(Number(value), .25, 4);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(direction, this.baseDistance / zoom);
    this.controls.update(); this.renderer.domElement.dataset.zoom = String(zoom);
    this.requestRender();
  }

  setPointSize(value) {
    this.pointSize = Number(value);
    if (this.cloud) this.cloud.material.size = this.pointSize;
    this.renderer.domElement.dataset.pointSize = String(this.pointSize);
    this.requestRender();
  }

  setColorMode(mode, start = 0, count) {
    this.colorMode = mode;
    if (!this.cloud) return;
    const geometry = this.cloud.geometry, material = this.cloud.material;
    const position = geometry.getAttribute('position');
    count ??= position.count - start;
    const applyColors = array => {
      let attribute = geometry.getAttribute('color');
      if (!attribute || attribute.count !== position.count) {
        attribute = new THREE.BufferAttribute(new Uint8Array(position.count * 3), 3, true);
        geometry.setAttribute('color', attribute);
      }
      attribute.array.set(array, start * 3);
      attribute.addUpdateRange(start * 3, array.length); attribute.needsUpdate = true;
    };
    if (mode === 'solid') {
      material.vertexColors = false; material.color.set('#baded8');
    } else if (mode === 'rgb' && this.originalColors) {
      applyColors(this.originalColors.subarray(start * 3, (start + count) * 3));
      material.vertexColors = true; material.color.set('#ffffff');
    } else {
      const axis = { x: 0, y: 1, z: 2 }[this.upAxis];
      const min = geometry.boundingBox.min.getComponent(axis), span = geometry.boundingBox.max.getComponent(axis) - min;
      const colors = new Uint8Array(count * 3), color = new THREE.Color();
      for (let i = 0; i < count; i++) {
        let t = span ? (position.array[(start + i) * 3 + axis] - min) / span : .5;
        if (this.upSign < 0) t = 1 - t;
        color.setHSL(.66 * (1 - t), .75, .55);
        colors[i * 3] = Math.round(color.r * 255);
        colors[i * 3 + 1] = Math.round(color.g * 255);
        colors[i * 3 + 2] = Math.round(color.b * 255);
      }
      applyColors(colors);
      material.vertexColors = true; material.color.set('#ffffff');
    }
    material.needsUpdate = true;
    this.host.dataset.colorMode = mode;
    this.requestRender();
  }

  updateUp() {
    this.camera.up.set(this.upAxis === 'x' ? this.upSign : 0, this.upAxis === 'y' ? this.upSign : 0, this.upAxis === 'z' ? this.upSign : 0);
    this.grid.rotation.set(0, 0, 0); this.grid.position.set(0, 0, 0);
    if (this.upAxis === 'z') this.grid.rotation.x = Math.PI / 2;
    if (this.upAxis === 'x') this.grid.rotation.z = Math.PI / 2;
    if (this.cloud) {
      const axis = { x: 0, y: 1, z: 2 }[this.upAxis];
      this.grid.position.setComponent(axis, this.upSign < 0 ? this.cloud.geometry.boundingBox.max.getComponent(axis) + .05 : this.cloud.geometry.boundingBox.min.getComponent(axis) - .05);
    }
    this.host.dataset.upAxis = (this.upSign < 0 ? '-' : '') + this.upAxis;
  }

  setUpAxis(value) { this.upAxis = value.replace('-', ''); this.upSign = value.startsWith('-') ? -1 : 1; this.updateUp(); if (this.colorMode === 'height') this.setColorMode('height'); this.fitView(); }
  setBackground(value) { this.scene.background.set(value === 'light' ? '#e7eef1' : '#101b23'); this.requestRender(); }
  setGrid(value) { this.grid.visible = value; this.requestRender(); }
  setAutoRotate(value) { this.controls.autoRotate = value; this.requestRender(); }

  requestRender() {
    if (this.disposed || this.frame != null) return;
    this.frame = requestAnimationFrame(time => {
      this.frame = null;
      if (document.hidden || !this.visible) return;
      const delta = Math.min((time - (this.lastTime || time)) / 1000, .05);
      this.lastTime = time;
      if (this.controls.autoRotate && this.cloud) this.controls.update(delta);
      this.renderer.render(this.scene, this.camera);
      if (this.controls.autoRotate && this.cloud) this.requestRender();
    });
  }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.cancelLoad(); this.clearCloud();
    this.resizeObserver.disconnect(); this.intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.controls.dispose(); this.grid.geometry.dispose();
    this.grid.material.dispose(); this.pointTexture.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
