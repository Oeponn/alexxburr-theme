import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

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
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.75;
  renderer.setScissorTest(true);

  // The classic chrome look: a bright sky, a hard dark band at the horizon
  // and a mid-grey floor, plus a few softboxes for crisp highlights. Mostly
  // bright surroundings keep it silver; the band gives the black streaks.
  function studioEnvironment() {
    const studio = new THREE.Scene();

    // Colour stops by height on a unit sphere, from floor (-1) to sky (1).
    const stops = [[-1, 0.32], [-0.35, 0.22], [-0.06, 0.04], [0.04, 0.02], [0.14, 0.75], [0.5, 1.1], [1, 1.5]];
    const shade = (y) => {
      for (let i = 1; i < stops.length; i++) {
        if (y <= stops[i][0]) {
          const [y0, v0] = stops[i - 1];
          const [y1, v1] = stops[i];
          return v0 + (v1 - v0) * (y - y0) / (y1 - y0);
        }
      }
      return stops[stops.length - 1][1];
    };
    const dome = new THREE.SphereGeometry(10, 64, 64);
    const position = dome.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      colors.fill(shade(position.getY(i) / 10), i * 3, i * 3 + 3);
    }
    dome.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    studio.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

    const panel = (width, height, intensity, position) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity), side: THREE.DoubleSide }),
      );
      mesh.position.set(...position);
      mesh.lookAt(0, 0, 0);
      studio.add(mesh);
    };
    panel(6, 1.2, 5, [0, 5, 2]);      // overhead strip
    panel(1, 6, 4, [-5, 0.5, 1.5]);   // left strip
    panel(1, 6, 4, [5, 0.5, -1.5]);   // right strip
    panel(3, 0.4, 3, [0, -4, 3]);     // low kicker for the undersides
    return new THREE.PMREMGenerator(renderer).fromScene(studio, 0.01).texture;
  }
  const environment = studioEnvironment();

  // The exported material is flat white plastic; mirror chrome shows faceting
  // far better, which is the point of this comparison. Both sides share it.
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.06,
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

  // World-space bounds and vertex centroid of everything under object.
  function measure(object) {
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    const mean = new THREE.Vector3();
    const vertex = new THREE.Vector3();
    let count = 0;
    object.traverse((node) => {
      if (!node.isMesh) return;
      const position = node.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        mean.add(vertex.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld));
      }
      count += position.count;
    });
    return { box, mean: mean.divideScalar(count), center: box.getCenter(new THREE.Vector3()) };
  }

  // Both rows are exported teeth-up, so the top row gets turned over and
  // seated on the bottom one. The arch sits diagonally in the files, so its
  // front-to-back direction is found from the geometry: a horseshoe's centroid
  // leans towards the closed front end. Turning over around that axis keeps
  // the front teeth facing forward.
  function seatUpperRow(upper, lower) {
    const pivot = new THREE.Group();
    pivot.add(upper);

    const before = measure(upper);
    const frontBack = new THREE.Vector3(before.mean.x - before.center.x, 0, before.mean.z - before.center.z).normalize();
    upper.position.sub(before.center);
    pivot.position.copy(before.center);
    pivot.quaternion.setFromAxisAngle(frontBack, Math.PI);

    const flipped = measure(pivot);
    const base = measure(lower);
    const gap = (base.box.max.y - base.box.min.y) * 0.03;
    pivot.position.x += base.mean.x - flipped.mean.x;
    pivot.position.z += base.mean.z - flipped.mean.z;
    pivot.position.y += base.box.max.y - flipped.box.min.y + gap;
    return pivot;
  }

  // Files are [top, bottom]; they're centred and scaled as one so the bite
  // stays intact.
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
    });
    const [upper, lower] = files.map((file) => file.scene);
    group.add(lower, seatUpperRow(upper, lower));

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
    return height;
  }

  // Each model is framed in the part of its HUD cell below the label, so it
  // clears the header, the labels and the control bar.
  const cells = [...root.querySelectorAll('.grillz-stage__cell')];
  function viewport(cell) {
    const outer = cell.getBoundingClientRect();
    const label = cell.querySelector('.grillz-stage__label').getBoundingClientRect();
    const top = label.bottom + 8;
    return { left: outer.left, top, width: outer.width, height: Math.max(outer.bottom - top, 1) };
  }

  const clock = new THREE.Clock();

  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    if (spinning && !drag) yaw += delta * 0.4;

    const height = resize();
    renderer.setScissor(0, 0, canvas.clientWidth, height);
    renderer.clear();

    sides.forEach((side, index) => {
      const view = viewport(cells[index]);
      camera.aspect = view.width / view.height;
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const distance = 0.85 / Math.sin(Math.min(verticalFov, horizontalFov) / 2) / (zoomed ? 2.5 : 1);
      camera.position.set(0, 0, distance);
      camera.updateProjectionMatrix();

      side.pivot.rotation.set(pitch, yaw, 0);
      // WebGL's origin is bottom-left.
      const y = height - view.top - view.height;
      renderer.setViewport(view.left, y, view.width, view.height);
      renderer.setScissor(view.left, y, view.width, view.height);
      renderer.render(side.scene, camera);
    });
  });

  measureHeader();
  showStyle('plain');
}
