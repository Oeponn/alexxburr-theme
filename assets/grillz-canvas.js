import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const root = document.querySelector('[data-grillz-canvas]');

if (root) {
  const canvas = root.querySelector('canvas');
  const models = JSON.parse(root.querySelector('[data-grillz-models]').textContent);
  const statEls = {
    lite: root.querySelector('[data-grillz-stats="lite"]'),
    full: root.querySelector('[data-grillz-stats="full"]'),
  };

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0b0b0c);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setScissorTest(true);

  const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

  // The exported material is flat white plastic; polished metal shows faceting
  // far better, which is the point of this comparison. Both sides share it.
  const material = new THREE.MeshStandardMaterial({
    color: 0xe4e5e9,
    metalness: 1,
    roughness: 0.16,
    side: THREE.DoubleSide,
  });

  // One scene per side so each viewport only draws its own model.
  const sides = ['lite', 'full'].map((quality) => {
    const scene = new THREE.Scene();
    scene.environment = environment;
    const pivot = new THREE.Group();
    scene.add(pivot);
    return { quality, scene, pivot };
  });

  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

  const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);

  // Fetch ourselves rather than loader.load so the compressed size is known.
  async function loadFile(url) {
    const buffer = await (await fetch(url)).arrayBuffer();
    const gltf = await loader.parseAsync(buffer, '');
    return { scene: gltf.scene, bytes: buffer.byteLength };
  }

  // Top and bottom rows share a coordinate space, so they're centred and
  // scaled together to keep the bite intact.
  async function loadPair(urls) {
    const files = await Promise.all(urls.map(loadFile));
    const group = new THREE.Group();
    let triangles = 0;
    files.forEach(({ scene }) => {
      scene.traverse((node) => {
        if (!node.isMesh) return;
        node.material = material;
        const geometry = node.geometry;
        triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
      });
      group.add(scene);
    });

    const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
    group.scale.setScalar(1 / sphere.radius);
    group.position.copy(sphere.center).multiplyScalar(-1 / sphere.radius);

    return { group, triangles, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
  }

  const cache = {};
  let activeStyle = null;

  function formatStats({ triangles, bytes }) {
    return `${Math.round(triangles / 1000)}k tris · ${(bytes / 1048576).toFixed(1)} MB`;
  }

  async function showStyle(style) {
    activeStyle = style;
    root.querySelectorAll('[data-grillz-style]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.grillzStyle === style));
    });

    await Promise.all(sides.map(async (side) => {
      statEls[side.quality].textContent = 'loading…';
      const key = `${style}:${side.quality}`;
      cache[key] = cache[key] || loadPair(models[style][side.quality]);
      try {
        const pair = await cache[key];
        if (activeStyle !== style) return;
        side.pivot.clear();
        side.pivot.add(pair.group);
        statEls[side.quality].textContent = formatStats(pair);
      } catch (error) {
        delete cache[key];
        statEls[side.quality].textContent = 'failed to load';
        console.error(error);
      }
    }));
  }

  // Interaction --------------------------------------------------------------
  let yaw = 0;
  let pitch = 0.25;
  let spinning = true;
  let zoomed = false;
  let drag = null;

  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, yaw, pitch };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    yaw = drag.yaw + (event.clientX - drag.x) * 0.01;
    // Touch only gets horizontal moves (vertical ones scroll the page), so
    // tilt is effectively a mouse-only extra.
    pitch = THREE.MathUtils.clamp(drag.pitch + (event.clientY - drag.y) * 0.01, -1.2, 1.2);
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  root.querySelectorAll('[data-grillz-style]').forEach((button) => {
    button.addEventListener('click', () => showStyle(button.dataset.grillzStyle));
  });

  const spinButton = root.querySelector('[data-grillz-spin]');
  spinButton.addEventListener('click', () => {
    spinning = !spinning;
    spinButton.setAttribute('aria-pressed', String(spinning));
  });

  const zoomButton = root.querySelector('[data-grillz-zoom]');
  zoomButton.addEventListener('click', () => {
    zoomed = !zoomed;
    zoomButton.setAttribute('aria-pressed', String(zoomed));
  });

  // Hide the overlay once the stage has mostly scrolled off.
  new IntersectionObserver(([entry]) => {
    root.classList.toggle('is-scrolled-away', entry.intersectionRatio < 0.35);
  }, { threshold: [0, 0.35, 1] }).observe(root);

  const header = document.getElementById('shopify-section-header');
  function measureHeader() {
    if (header) root.style.setProperty('--grillz-header-height', `${header.getBoundingClientRect().bottom}px`);
  }

  // Rendering -----------------------------------------------------------------
  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
      measureHeader();
    }
    return { width, height };
  }

  const clock = new THREE.Clock();

  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    if (spinning && !drag) yaw += delta * 0.4;

    const { width, height } = resize();
    const portrait = height > width;
    const viewWidth = portrait ? width : width / 2;
    const viewHeight = portrait ? height / 2 : height;

    camera.aspect = viewWidth / viewHeight;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const distance = 1.08 / Math.sin(Math.min(verticalFov, horizontalFov) / 2) / (zoomed ? 2.5 : 1);
    camera.position.set(0, 0, distance);
    camera.updateProjectionMatrix();

    sides.forEach((side, index) => {
      side.pivot.rotation.set(pitch, yaw, 0);
      // WebGL's origin is bottom-left; lite goes top (portrait) or left.
      const x = portrait ? 0 : index * viewWidth;
      const y = portrait ? (1 - index) * viewHeight : 0;
      renderer.setViewport(x, y, viewWidth, viewHeight);
      renderer.setScissor(x, y, viewWidth, viewHeight);
      renderer.render(side.scene, camera);
    });
  });

  measureHeader();
  showStyle('plain');
}
