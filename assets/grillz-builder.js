// Grillz builder (sections/grillz-builder.liquid): the 3D stage, the dock and
// the design.
//
// The cast comes from grillz-builder-cast.js. A design is one metal for the
// whole piece plus a cut per tooth. Tapping a tooth, on the cast or in the
// map, puts the current cut on it; tapping it again takes it off. Every
// change can be undone and is kept in the address (so a link shares it) and
// in local storage.
import * as THREE from 'three';
import {
  buildCast, capGeometry, stoneGeometry, stoneSpots, gumLine, ROWS, GUM, FANG_LENGTH,
} from 'grillz-builder/cast';

// No WebGL (or a script failed): the boot screen says so and points to the
// contact page. The message is in the markup; this just shows it.
function fail(root) {
  root.classList.add('gb--failed');
}

/* Small helpers ----------------------------------------------------------------- */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const pad = (n, size = 2) => String(n).padStart(size, '0');
const easeIn = (t) => t * t * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const linear = (t) => t;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const calm = () => reducedMotion.matches;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// One letter per cut, for the address. '-' is a bare tooth.
const CODES = { bare: '-', solid: 's', open: 'o', heart: 'h', star: 'r', diamond: 'd', iced: 'i', solo: 'g', fang: 'f' };
const BY_CODE = Object.fromEntries(Object.entries(CODES).map(([cut, code]) => [code, cut]));
// Which branch of the cap shader a cut uses: 0 polished, 1 open face,
// 2 diamond cut, 3 heart window, 4 star window.
const SHADER_STYLE = { solid: 0, open: 1, diamond: 2, heart: 3, star: 4, iced: 0, solo: 0, fang: 0 };
const WINDOWED = new Set(['open', 'heart', 'star']);
const KIND_SHORT = { central: 'Central', lateral: 'Lateral', canine: 'Canine', pm1: '1st premolar', pm2: '2nd premolar' };
const ORDER = [...ROWS.upper, ...ROWS.lower];
const DEFAULT_DESIGN = 'g=14y.--ssssss--.----------';
const STORE_KEY = 'gb-design';
const SOUND_KEY = 'gb-sound';

/* Sound ------------------------------------------------------------------------
   Synthesised, so there's nothing to load: a metallic clank when a cap goes
   on, a pop when it comes off, a clack when the jaw shuts. Web Audio stays
   quiet until the first tap, and iPhones on silent stay silent. */

function makeSound() {
  let context = null;
  let master = null;
  const sound = {
    on: true,
    unlock() {
      if (!sound.on) return;
      if (!context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        context = new Context();
        master = context.createGain();
        master.gain.value = 0.5;
        master.connect(context.destination);
      }
      if (context.state === 'suspended') context.resume();
    },
    play(kind, detune = 0) {
      if (!sound.on || !context || context.state !== 'running') return;
      const now = context.currentTime;
      const tone = (frequency, gain, decay, type = 'sine', at = now) => {
        const osc = context.createOscillator();
        const amp = context.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency * (1 + detune), at);
        amp.gain.setValueAtTime(gain, at);
        amp.gain.exponentialRampToValueAtTime(0.0001, at + decay);
        osc.connect(amp).connect(master);
        osc.start(at);
        osc.stop(at + decay + 0.02);
        return osc;
      };
      const noise = (gain, decay, frequency, q = 1.2) => {
        const length = Math.ceil(context.sampleRate * decay);
        const buffer = context.createBuffer(1, length, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
        const source = context.createBufferSource();
        source.buffer = buffer;
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = frequency;
        filter.Q.value = q;
        const amp = context.createGain();
        amp.gain.value = gain;
        source.connect(filter).connect(amp).connect(master);
        source.start(now);
      };
      if (kind === 'clank') {
        // Inharmonic partials, like a struck bit of metal.
        [[1180, 0.16, 0.16], [1914, 0.1, 0.11], [2960, 0.07, 0.08], [4410, 0.04, 0.05]].forEach(([f, g, d]) => tone(f, g, d));
        noise(0.22, 0.03, 3200, 0.8);
      } else if (kind === 'pop') {
        const osc = tone(760, 0.12, 0.09, 'triangle');
        osc.frequency.exponentialRampToValueAtTime(240, now + 0.08);
      } else if (kind === 'clack') {
        tone(140, 0.3, 0.09, 'triangle');
        noise(0.35, 0.05, 1400, 0.7);
      } else if (kind === 'tick') {
        tone(1650, 0.05, 0.03, 'square');
      } else if (kind === 'shimmer') {
        [2600, 3300, 4150, 5200].forEach((f, i) => tone(f, 0.035, 0.18, 'sine', now + i * 0.035));
      }
    },
  };
  return sound;
}

/* Studio --------------------------------------------------------------------------
   What the metal reflects: a bright ceiling, a dark band at the horizon and
   a grey floor, plus softboxes for crisp highlights. Gold needs the dark to
   look like gold rather than yellow plastic. The visible background is a
   separate, flat light grey. */

function studioEnvironment(renderer) {
  const studio = new THREE.Scene();
  const stops = [[-1, 0.42], [-0.4, 0.34], [-0.12, 0.1], [0.02, 0.05], [0.12, 0.75], [0.45, 1.05], [1, 1.3]];
  const shade = (y) => {
    for (let i = 1; i < stops.length; i++) {
      if (y <= stops[i][0]) {
        const [y0, v0] = stops[i - 1];
        const [y1, v1] = stops[i];
        return v0 + ((v1 - v0) * (y - y0)) / (y1 - y0);
      }
    }
    return stops[stops.length - 1][1];
  };
  const dome = new THREE.SphereGeometry(10, 64, 32);
  const position = dome.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) colors.fill(shade(position.getY(i) / 10), i * 3, i * 3 + 3);
  dome.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  studio.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const panel = (width, height, value, at) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(value, value, value), side: THREE.DoubleSide }),
    );
    mesh.position.set(...at);
    mesh.lookAt(0, 0, 0);
    studio.add(mesh);
  };
  panel(7, 1.4, 5.5, [0, 5.2, 1.5]); // overhead strip
  panel(1.1, 6, 3.6, [-5.2, 0.6, 2]); // left strip
  panel(1.1, 6, 3.2, [5.2, 0.6, 0.5]); // right strip
  panel(4.2, 1.6, 2.6, [0, 2.2, 6]); // front card, high: lights the lip faces
  panel(5, 1.2, 0.0, [0, -1.4, 6]); // front, low: a dark band across them
  const generator = new THREE.PMREMGenerator(renderer);
  const texture = generator.fromScene(studio, 0.025).texture;
  generator.dispose();
  return texture;
}

/* Cap shader ---------------------------------------------------------------------
   Caps are standard metal with three additions, all driven by the per-vertex
   face data the cast module bakes into each cap (tooth-local x and height,
   room to the side outline, how much the surface faces the lip):
   - windows (open face, heart, star) are cut out of the lip face with a
     rounded, bevelled edge;
   - diamond cut is a field of small pyramids bumped into the normal, which
     glint as the cast turns;
   Bumps use screen-space derivatives of a height, so there's no texture. */

const CAP_PARS = /* glsl */ `
uniform float uStyle;
uniform vec4 uGum;   // zenith, papilla, half width, crown top (mm)
uniform vec4 uShape; // centre height, scale, up (+1 lower / -1 upper), -
varying vec4 vFace;  // x, height, room to the side outline, faces the lip

float gbSmin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float gbDot2(vec2 v) { return dot(v, v); }
float gbHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(gbDot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(gbDot2(p - vec2(0.0, 1.0)), gbDot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float gbStar(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
// Distance from the edge of the window in mm: negative inside it (no metal).
float gbHole() {
  if (vFace.w < 0.2) return 1e3;
  if (uStyle > 0.5 && uStyle < 1.5) {
    float edge = clamp(abs(vFace.x) / uGum.z, 0.0, 1.0);
    float gum = uGum.x + (uGum.y - uGum.x) * pow(edge * edge, 0.85);
    float side = vFace.z - 0.95;
    float top = (uGum.w - 1.1) - vFace.y;
    float bottom = vFace.y - (gum + 1.05);
    return -gbSmin(gbSmin(side, top, 1.8), bottom, 1.8);
  }
  if (uStyle > 2.5 && uStyle < 4.5) {
    vec2 p = vec2(vFace.x, (vFace.y - uShape.x) * uShape.z) / uShape.y;
    float d = uStyle < 3.5 ? gbHeart(p + vec2(0.0, 0.55)) : gbStar(p, 0.62, 0.42);
    return d * uShape.y;
  }
  return 1e3;
}
float gbFacets() {
  vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * vFace.xy / 0.9;
  vec2 cell = floor(q);
  vec2 f = fract(q) - 0.5;
  float k = 0.6 + 0.4 * fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float px = length(fwidth(q));
  float fade = (1.0 - smoothstep(0.18, 0.42, px)) * smoothstep(0.05, 0.35, vFace.w);
  return -(abs(f.x) + abs(f.y)) * 0.34 * k * fade;
}
vec3 gbPerturb(vec3 n, vec3 sx, vec3 sy, vec2 dh, float facing) {
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * facing;
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - grad);
}
`;

const CAP_CUT = /* glsl */ `
float gbEdge = gbHole();
float gbHeight = uStyle > 1.5 && uStyle < 2.5
  ? gbFacets()
  : 0.24 * (1.0 - pow(1.0 - clamp(gbEdge / 0.5, 0.0, 1.0), 2.0));
vec2 gbDh = vec2(dFdx(gbHeight), dFdy(gbHeight));
vec3 gbSx = dFdx(-vViewPosition);
vec3 gbSy = dFdy(-vViewPosition);
if (gbEdge < 0.0) discard;
`;

const CAP_NORMAL = /* glsl */ `
normal = gbPerturb(normal, gbSx, gbSy, gbDh, faceDirection);
`;

function makeCapMaterial() {
  const uniforms = {
    uStyle: { value: 0 },
    uGum: { value: new THREE.Vector4() },
    uShape: { value: new THREE.Vector4() },
  };
  const material = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.16, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFace;\nvarying vec4 vFace;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFace = aFace;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CAP_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CAP_CUT}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${CAP_NORMAL}`);
  };
  material.customProgramCacheKey = () => 'grillz-cap';
  material.userData.uniforms = uniforms;
  return material;
}

/* Floor: a fine grid on the background colour, fading out with distance. */
function makeFloor(background) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBackground: { value: background.clone() },
      uMinor: { value: new THREE.Color(0xdcdcd9) },
      uMajor: { value: new THREE.Color(0xc4c4c0) },
      uCentre: { value: new THREE.Vector2() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBackground;
      uniform vec3 uMinor;
      uniform vec3 uMajor;
      uniform vec2 uCentre;
      varying vec3 vWorld;
      float grid(vec2 p, float step) {
        vec2 q = p / step;
        vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        vec2 p = vWorld.xz - uCentre;
        float fade = 1.0 - smoothstep(70.0, 240.0, length(p));
        vec3 colour = mix(uBackground, uMinor, grid(p, 5.0) * fade);
        colour = mix(colour, uMajor, grid(p, 25.0) * fade);
        gl_FragColor = vec4(colour, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/* Builder ------------------------------------------------------------------------- */

async function start(root) {
  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];
  const stage = $('[data-gb-stage]');
  const canvas = $('[data-gb-canvas]');
  const boot = $('[data-gb-boot]');
  const bootBars = [...boot.querySelectorAll('.gb__boot-bar i')];
  const bootStep = $('[data-gb-boot-step]');
  const readout = $('[data-gb-readout]');
  const reticle = $('[data-gb-reticle]');
  const reticleTag = $('[data-gb-reticle-tag]');
  const countEl = $('[data-gb-count]');
  const metalNameEl = $('[data-gb-metal-name]');
  const stonesEl = $('[data-gb-stones]');
  const undoButton = $('[data-gb-undo]');
  const clearButton = $('[data-gb-clear]');
  const shareButton = $('[data-gb-share]');
  const soundButton = $('[data-gb-sound]');
  const biteButton = $('[data-gb-bite]');
  const recentreButton = $('[data-gb-recentre]');
  const tabs = $$('[role="tab"]');
  const cutButtons = $$('[data-gb-cut]');
  const metalButtons = $$('[data-gb-metal]');
  const setButtons = $$('[data-gb-set]');
  const mapButtons = $$('[data-gb-tooth]');

  const labelOf = (button) => button.querySelector('.gb__option-label').textContent.trim();
  const CUTS = Object.fromEntries(cutButtons.map((b) => [b.dataset.gbCut, labelOf(b)]));
  const METALS = Object.fromEntries(metalButtons.map((b) => [b.dataset.gbMetal, {
    name: labelOf(b),
    color: new THREE.Color(b.dataset.color),
    rough: parseFloat(b.dataset.rough) || 0.16,
    swatch: b.querySelector('.gb__swatch').style.getPropertyValue('--swatch').trim(),
  }]));

  const finePointer = window.matchMedia('(pointer: fine)').matches;

  /* Boot screen -------------------------------------------------------------- */

  async function bootStepTo(label, filled) {
    bootStep.textContent = label;
    bootBars.forEach((bar, i) => bar.classList.toggle('on', i < filled));
    await nextFrame();
    if (!calm()) await new Promise((resolve) => setTimeout(resolve, 60));
  }

  await bootStepTo('Loading engine', 3);

  /* Renderer and scene -------------------------------------------------------- */

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    fail(root);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const background = new THREE.Color(getComputedStyle(stage).backgroundColor || '#f3f3f1');
  const scene = new THREE.Scene();
  scene.background = background;

  await bootStepTo('Sculpting teeth', 5);

  const plaster = {
    tooth: new THREE.MeshStandardMaterial({ color: 0xefeee9, roughness: 0.46, vertexColors: true, envMapIntensity: 0.42 }),
    gum: new THREE.MeshStandardMaterial({ color: 0x95928b, roughness: 0.94, vertexColors: true, envMapIntensity: 0.32 }),
    base: new THREE.MeshStandardMaterial({ color: 0xa3a099, roughness: 0.94, vertexColors: true, envMapIntensity: 0.32 }),
  };
  const cast = buildCast(plaster);
  scene.add(cast.root);
  const OPEN_ANGLE = THREE.MathUtils.degToRad(10);
  cast.jaw.rotation.x = OPEN_ANGLE;

  // Everything that isn't a tooth blocks picking (so a tooth behind the gum
  // can't be tapped through it).
  const blockers = [];
  cast.root.traverse((node) => {
    if (node.isMesh && node.userData.toothId === undefined) blockers.push(node);
  });

  const teeth = [...cast.teeth.values()];
  for (const tooth of teeth) {
    tooth.cut = null;
    tooth.cap = null;
    tooth.stones = null;
    tooth.anim = null;
    tooth.windowed = false;
  }

  await bootStepTo('Pouring stone', 7);

  // Frame and floor from the open cast.
  cast.root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(cast.root);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const target = sphere.center.clone();
  const floorY = bounds.min.y - 11;
  const floor = makeFloor(background);
  floor.position.y = floorY;
  floor.material.uniforms.uCentre.value.set(target.x, target.z);
  scene.add(floor);
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.13 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = floorY + 0.05;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  // Hard key light from the upper left, low enough that the upper cast's
  // base doesn't shade the upper teeth; a soft fill from the sky.
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(target.x - 70, target.y + 85, target.z + 150);
  key.target.position.copy(target);
  key.castShadow = true;
  const big = Math.min(window.innerWidth, window.innerHeight) > 700;
  key.shadow.mapSize.set(big ? 2048 : 1024, big ? 2048 : 1024);
  Object.assign(key.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 20, far: 420 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.35;
  scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8c8c88, 1.25));

  await bootStepTo('Polishing metal', 9);

  scene.environment = studioEnvironment(renderer);
  const stoneGeo = stoneGeometry();
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 1, roughness: 0.02, envMapIntensity: 1.7, flatShading: true,
  });

  const camera = new THREE.PerspectiveCamera(24, 1, 5, 2000);

  /* Sparks: little square chips that fly off a cap as it lands. */
  const SPARKS = 120;
  const sparkPositions = new Float32Array(SPARKS * 3).fill(-1e5);
  const sparkColors = new Float32Array(SPARKS * 3);
  const sparkVelocity = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
  const sparkMaterial = new THREE.PointsMaterial({
    size: 3.2 * renderer.getPixelRatio(), sizeAttenuation: false, vertexColors: true, toneMapped: false,
  });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkCursor = 0;
  let sparksAlive = 0;
  const ink = new THREE.Color(0x111111);

  function burst(point, color, count = 12) {
    if (calm()) return;
    for (let n = 0; n < count; n++) {
      const i = sparkCursor;
      sparkCursor = (sparkCursor + 1) % SPARKS;
      sparkPositions.set([point.x, point.y, point.z], i * 3);
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 70;
      sparkVelocity.set([Math.cos(angle) * speed, 30 + Math.sin(angle) * speed * 0.8, 20 + Math.random() * 50], i * 3);
      const c = n % 2 ? ink : color;
      sparkColors.set([c.r, c.g, c.b], i * 3);
      if (sparkLife[i] <= 0) sparksAlive++;
      sparkLife[i] = 0.32 + Math.random() * 0.28;
    }
    sparkGeometry.attributes.color.needsUpdate = true;
    requestRender();
  }

  function stepSparks(dt) {
    if (!sparksAlive) return;
    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i] <= 0) continue;
      sparkLife[i] -= dt;
      if (sparkLife[i] <= 0) {
        sparkPositions[i * 3 + 1] = -1e5;
        sparksAlive--;
        continue;
      }
      sparkVelocity[i * 3 + 1] -= 520 * dt;
      for (let k = 0; k < 3; k++) sparkPositions[i * 3 + k] += sparkVelocity[i * 3 + k] * dt;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
  }

  /* Tweens ------------------------------------------------------------------- */

  const tweens = new Set();
  let clock = performance.now();

  function tween(duration, update, { delay = 0, ease = easeOut, done, begin } = {}) {
    const item = { start: clock + delay, duration, update, ease, done, begin };
    tweens.add(item);
    requestRender();
    return item;
  }

  function cancel(item) {
    if (item) tweens.delete(item);
  }

  function stepTweens(time) {
    for (const item of tweens) {
      if (time < item.start) continue;
      if (item.begin) {
        item.begin();
        item.begin = null;
      }
      const t = item.duration > 0 ? clamp((time - item.start) / item.duration, 0, 1) : 1;
      item.update(item.ease(t));
      if (t >= 1) {
        tweens.delete(item);
        if (item.done) item.done();
      }
    }
  }

  /* Caps ------------------------------------------------------------------------ */

  const up = new THREE.Vector3(0, 1, 0);

  function tipOf(tooth) {
    const top = tooth.spec.H + (tooth.cut === 'fang' ? FANG_LENGTH : 0);
    return tooth.holder.localToWorld(new THREE.Vector3(0, top * 0.8, tooth.profile(tooth.spec.H * 0.8).z0 + 1.5));
  }

  function paintMetal(tooth, metal) {
    tooth.cap.material.color.copy(metal.color);
    tooth.cap.material.roughness = metal.rough;
  }

  function ensureCap(tooth) {
    if (tooth.cap) return tooth.cap;
    const material = makeCapMaterial();
    const cap = new THREE.Mesh(capGeometry(tooth), material);
    cap.castShadow = true;
    cap.receiveShadow = true;
    cap.visible = false;
    cap.userData.toothId = tooth.id;
    tooth.holder.add(cap);
    tooth.cap = cap;
    const zenith = gumLine(tooth, 0);
    const { uniforms } = material.userData;
    uniforms.uGum.value.set(GUM.zenith, GUM.papilla, tooth.spec.W / 2, tooth.spec.H);
    uniforms.uShape.value.set(
      (zenith + tooth.spec.H) / 2 + 0.15,
      Math.min(tooth.spec.W * 0.34, (tooth.spec.H - zenith) * 0.31),
      tooth.arch === 'upper' ? -1 : 1,
      0,
    );
    paintMetal(tooth, METALS[shownMetal]);
    return cap;
  }

  const spotCache = new Map();
  function spotsFor(tooth, cut) {
    const key = `${tooth.id}:${cut}`;
    if (!spotCache.has(key)) spotCache.set(key, stoneSpots(tooth, cut));
    return spotCache.get(key);
  }

  // Shape the cap for a cut: fang or regular shell, shader branch, stones.
  function shapeCap(tooth, cut) {
    const cap = ensureCap(tooth);
    const fang = cut === 'fang';
    cap.geometry = capGeometry(tooth, fang);
    const { uniforms } = cap.material.userData;
    uniforms.uStyle.value = SHADER_STYLE[cut];
    uniforms.uGum.value.w = tooth.spec.H + (fang ? FANG_LENGTH : 0);
    if (tooth.stones) {
      cap.remove(tooth.stones);
      tooth.stones.dispose();
      tooth.stones = null;
    }
    if (cut === 'iced' || cut === 'solo') {
      const spots = spotsFor(tooth, cut);
      const mesh = new THREE.InstancedMesh(stoneGeo, stoneMaterial, spots.length);
      const q = new THREE.Quaternion();
      const spin = new THREE.Quaternion();
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const s = new THREE.Vector3();
      spots.forEach((spot, i) => {
        q.setFromUnitVectors(up, spot.normal);
        spin.setFromAxisAngle(up, ((tooth.id * 7 + i * 13) % 17) / 17 * Math.PI);
        q.multiply(spin);
        p.copy(spot.point).addScaledVector(spot.normal, spot.size * 0.1);
        m.compose(p, q, s.setScalar(spot.size));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      tooth.cap.add(mesh);
      tooth.stones = mesh;
    }
    tooth.windowed = WINDOWED.has(cut);
  }

  function settle(tooth) {
    tooth.cap.position.set(0, 0, 0);
    tooth.cap.scale.setScalar(1);
  }

  // A cap lands: chips, a shake, a clank, a small squash.
  function land(tooth, { loud = true } = {}) {
    tooth.mesh.visible = tooth.windowed;
    settle(tooth);
    burst(tipOf(tooth), METALS[shownMetal].color, loud ? 12 : 7);
    shake(loud ? 0.55 : 0.3);
    sound.play('clank', (Math.random() - 0.5) * 0.08 + (tooth.arch === 'lower' ? -0.06 : 0));
    const cap = tooth.cap;
    tooth.anim = tween(140, (k) => {
      const pulse = Math.sin(k * Math.PI) * 0.05;
      cap.scale.set(1 + pulse, 1 - pulse * 0.7, 1 + pulse);
    }, { ease: linear, done: () => settle(tooth) });
  }

  // Put a cut on a tooth (or take it off with null), as the design says.
  function dress(tooth, cut, { animate = true, delay = 0, loud = true } = {}) {
    const before = tooth.cut;
    if (before === cut) return;
    tooth.cut = cut;
    cancel(tooth.anim);
    tooth.anim = null;
    const moving = animate && !calm();

    if (!cut) {
      const cap = tooth.cap;
      tooth.mesh.visible = true;
      if (!cap) return;
      if (!moving) {
        cap.visible = false;
        settle(tooth);
        return;
      }
      tooth.anim = tween(150, (k) => {
        cap.position.set(0, 6.5 * k, 1.6 * k);
        cap.scale.setScalar(1 + 0.16 * k);
      }, {
        delay,
        ease: easeIn,
        begin: () => sound.play('pop', (Math.random() - 0.5) * 0.1),
        done: () => {
          if (!tooth.cut) cap.visible = false;
          settle(tooth);
        },
      });
      return;
    }

    shapeCap(tooth, cut);
    const cap = tooth.cap;
    if (before) {
      // Changing cut on a capped tooth: swap in place with a jolt.
      tooth.mesh.visible = tooth.windowed;
      cap.visible = true;
      if (moving) land(tooth, { loud: false });
      return;
    }
    if (!moving) {
      cap.visible = true;
      settle(tooth);
      tooth.mesh.visible = tooth.windowed;
      return;
    }
    // Drop it on from past the tip, accelerating into the tooth.
    cap.visible = false;
    tooth.anim = tween(170, (k) => {
      cap.visible = true;
      cap.position.set(0, 7 * (1 - k), 1.8 * (1 - k));
      cap.scale.setScalar(1.2 - 0.2 * k);
    }, { delay, ease: easeIn, done: () => land(tooth, { loud }) });
  }

  /* Metal ----------------------------------------------------------------------- */

  let shownMetal = '14y';

  function showMetal(id, animate) {
    if (shownMetal === id) return;
    const metal = METALS[id];
    shownMetal = id;
    for (const tooth of teeth) {
      if (!tooth.cap) continue;
      const material = tooth.cap.material;
      if (!animate || calm() || !tooth.cut) {
        paintMetal(tooth, metal);
        continue;
      }
      const from = material.color.clone();
      const fromRough = material.roughness;
      // A ripple out from the front teeth.
      tween(220, (k) => {
        material.color.lerpColors(from, metal.color, k);
        material.roughness = lerp(fromRough, metal.rough, k);
      }, { delay: Math.abs(tooth.s) * 7 + (tooth.arch === 'lower' ? 50 : 0), ease: easeInOut });
    }
    if (animate) sound.play('shimmer');
  }

  /* Design state -------------------------------------------------------------- */

  const state = { metal: '14y', cuts: new Map() };
  let brush = 'solid';
  const undoStack = [];

  function encode() {
    const row = (ids) => ids.map((id) => CODES[state.cuts.get(id) || 'bare']).join('');
    return `${state.metal}.${row(ROWS.upper)}.${row(ROWS.lower)}`;
  }

  function decode(text) {
    const match = /^([a-z0-9]+)\.([-a-z]{10})\.([-a-z]{10})$/.exec(text || '');
    if (!match || !METALS[match[1]]) return null;
    const cuts = new Map();
    const letters = match[2] + match[3];
    ORDER.forEach((id, i) => {
      const cut = BY_CODE[letters[i]];
      if (cut && cut !== 'bare') cuts.set(id, cut);
    });
    return { metal: match[1], cuts };
  }

  function readDesign() {
    const fromHash = /(?:^#|&)g=([^&]+)/.exec(window.location.hash);
    let stored = null;
    try {
      stored = window.localStorage.getItem(STORE_KEY);
    } catch (error) { /* storage off */ }
    return (fromHash && decode(decodeURIComponent(fromHash[1]))) || decode(stored) || decode(DEFAULT_DESIGN.slice(2));
  }

  function persist() {
    const code = encode();
    try {
      window.history.replaceState(window.history.state, '', `#g=${code}`);
    } catch (error) { /* sandboxed */ }
    try {
      window.localStorage.setItem(STORE_KEY, code);
    } catch (error) { /* storage off */ }
  }

  function snapshot() {
    return { metal: state.metal, cuts: new Map(state.cuts) };
  }

  // Bring the cast in line with the design. Sets drop their caps one after
  // another from the front teeth back.
  function sync({ animate = true, stagger = false } = {}) {
    showMetal(state.metal, animate);
    const changed = teeth
      .filter((tooth) => (state.cuts.get(tooth.id) || null) !== tooth.cut)
      .sort((a, b) => Math.abs(a.s) - Math.abs(b.s) || (a.arch === 'upper' ? -1 : 1));
    changed.forEach((tooth, i) => {
      dress(tooth, state.cuts.get(tooth.id) || null, {
        animate,
        delay: stagger ? i * 55 : 0,
        loud: !stagger || i % 3 === 0,
      });
    });
    renderer.shadowMap.needsUpdate = true;
    updateUi();
  }

  function commit(change, options) {
    undoStack.push(snapshot());
    if (undoStack.length > 80) undoStack.shift();
    change();
    sync(options);
    persist();
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    state.metal = previous.metal;
    state.cuts = previous.cuts;
    sync();
    persist();
    say('Undone');
  }

  /* Dock UI -------------------------------------------------------------------- */

  let sayTimer = 0;
  function say(text, { hold = false } = {}) {
    readout.textContent = text;
    window.clearTimeout(sayTimer);
    if (!hold) sayTimer = window.setTimeout(() => { readout.textContent = idleLine(); }, 2600);
  }

  function idleLine() {
    return `${CUTS[brush]} loaded · ${finePointer ? 'click' : 'tap'} a tooth`;
  }

  function stoneCount() {
    let total = 0;
    for (const [id, cut] of state.cuts) {
      if (cut === 'iced' || cut === 'solo') total += spotsFor(cast.teeth.get(id), cut).length;
    }
    return total;
  }

  function toothName(tooth) {
    const side = tooth.s < 0 ? 'right' : 'left';
    return `${tooth.arch === 'upper' ? 'Upper' : 'Lower'} ${side} ${KIND_SHORT[tooth.kind].toLowerCase()}`;
  }

  function toothCode(tooth) {
    return `#${pad(tooth.id)} ${tooth.arch === 'upper' ? 'U' : 'L'}${tooth.s < 0 ? 'R' : 'L'} ${KIND_SHORT[tooth.kind]}`;
  }

  function updateUi() {
    countEl.textContent = `${pad(state.cuts.size)}/${ORDER.length}`;
    metalNameEl.textContent = METALS[state.metal].name;
    stonesEl.textContent = pad(stoneCount(), 3);
    cutButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gbCut === brush)));
    metalButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gbMetal === state.metal)));
    const swatch = METALS[state.metal].swatch;
    mapButtons.forEach((b) => {
      const id = Number(b.dataset.gbTooth);
      const cut = state.cuts.get(id) || '';
      b.setAttribute('aria-pressed', String(Boolean(cut)));
      b.dataset.cut = cut;
      b.style.setProperty('--cap', swatch);
      b.setAttribute('aria-label', `${toothName(cast.teeth.get(id))}, #${id}: ${cut ? CUTS[cut] : 'bare'}`);
    });
    undoButton.disabled = undoStack.length === 0;
    clearButton.disabled = state.cuts.size === 0;
  }

  function paint(id, { fromMap = false } = {}) {
    const tooth = cast.teeth.get(id);
    const current = state.cuts.get(id) || null;
    const next = brush === 'bare' || current === brush ? null : brush;
    hint = false;
    aim(id, { hold: 1800 });
    if (next === current) {
      say(`${toothCode(tooth)} · already bare`);
      return;
    }
    if (fromMap && bitten && tooth.arch === 'lower') setBite(false);
    commit(() => {
      if (next) state.cuts.set(id, next);
      else state.cuts.delete(id);
    });
    say(`${toothCode(tooth)} · ${next ? CUTS[next] : 'Off'}`);
  }

  // Tabs (phones): one panel at a time, arrow keys move along.
  function selectTab(tab, focus = false) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).classList.toggle('is-active', on);
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      selectTab(tab);
      sound.unlock();
      sound.play('tick');
    });
    tab.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
    });
  });

  cutButtons.forEach((button) => button.addEventListener('click', () => {
    brush = button.dataset.gbCut;
    sound.unlock();
    sound.play('tick');
    updateUi();
    say(idleLine(), { hold: true });
  }));

  metalButtons.forEach((button) => button.addEventListener('click', () => {
    sound.unlock();
    if (button.dataset.gbMetal === state.metal) return;
    commit(() => { state.metal = button.dataset.gbMetal; });
    say(`${METALS[state.metal].name} · whole piece`);
  }));

  setButtons.forEach((button) => button.addEventListener('click', () => {
    sound.unlock();
    const ids = button.dataset.teeth.split(',').map(Number);
    const cut = button.dataset.cut || (brush === 'bare' ? 'solid' : brush);
    if (ids.some((id) => cast.teeth.get(id).arch === 'lower') && bitten) setBite(false);
    hint = false;
    commit(() => { state.cuts = new Map(ids.map((id) => [id, cut])); }, { stagger: true });
    say(`${labelOf(button)} · ${CUTS[cut]}`);
  }));

  mapButtons.forEach((button) => {
    const id = Number(button.dataset.gbTooth);
    button.addEventListener('click', () => {
      sound.unlock();
      paint(id, { fromMap: true });
    });
    if (finePointer) {
      button.addEventListener('pointerenter', () => aim(id));
      button.addEventListener('pointerleave', () => aim(null));
    }
  });

  undoButton.addEventListener('click', () => {
    sound.unlock();
    undo();
  });

  clearButton.addEventListener('click', () => {
    sound.unlock();
    if (!state.cuts.size) return;
    commit(() => { state.cuts = new Map(); }, { stagger: true });
    say('Cleared · undo brings it back');
  });

  shareButton.addEventListener('click', async () => {
    sound.unlock();
    persist();
    const url = window.location.href;
    if (navigator.share && !finePointer) {
      try {
        await navigator.share({ title: 'My grillz', text: 'Built on the Alexx Burr grillz builder', url });
      } catch (error) { /* closed */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied · it opens this exact design');
    } catch (error) {
      say('Copy the address bar to share this design');
    }
  });

  const sound = makeSound();
  try {
    sound.on = window.localStorage.getItem(SOUND_KEY) !== 'off';
  } catch (error) { /* storage off */ }
  soundButton.setAttribute('aria-pressed', String(sound.on));
  soundButton.addEventListener('click', () => {
    sound.on = !sound.on;
    soundButton.setAttribute('aria-pressed', String(sound.on));
    try {
      window.localStorage.setItem(SOUND_KEY, sound.on ? 'on' : 'off');
    } catch (error) { /* storage off */ }
    sound.unlock();
    sound.play('tick');
  });

  /* Bite -------------------------------------------------------------------------- */

  let bitten = false;
  let jawTween = null;

  function setBite(on) {
    bitten = on;
    biteButton.setAttribute('aria-pressed', String(on));
    biteButton.setAttribute('aria-label', on ? 'Open the jaw' : 'Bite down');
    const from = cast.jaw.rotation.x;
    const to = on ? 0 : OPEN_ANGLE;
    cancel(jawTween);
    if (calm()) {
      cast.jaw.rotation.x = to;
      renderer.shadowMap.needsUpdate = true;
      requestRender();
      return;
    }
    jawTween = tween(on ? 230 : 300, (k) => {
      cast.jaw.rotation.x = lerp(from, to, k);
    }, {
      ease: on ? easeIn : easeOut,
      done: () => {
        if (!on) return;
        sound.play('clack');
        shake(0.8);
      },
    });
  }

  biteButton.addEventListener('click', () => {
    sound.unlock();
    setBite(!bitten);
  });

  /* Camera ------------------------------------------------------------------------ */

  const HOME = { yaw: -0.22, pitch: 0.07, zoom: 1 };
  const view = { ...HOME, yawVelocity: 0 };
  let fitDistance = 300;
  const shakeOffset = new THREE.Vector3();
  let shakeAmount = 0;
  let lastInput = performance.now();
  let swayTime = 0;
  let swayBase = view.yaw;
  let swaying = false;

  function shake(amount) {
    if (!calm()) shakeAmount = Math.max(shakeAmount, amount);
  }

  function wake() {
    lastInput = performance.now();
    if (swaying) {
      swaying = false;
    }
  }

  // Fit the cast as seen from the front: its width to the stage's width and
  // its height to the stage less the HUD rows, whichever is tighter.
  const size = bounds.getSize(new THREE.Vector3());
  function fit() {
    const height = Math.max(canvas.clientHeight, 1);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanH = tanV * camera.aspect;
    const usable = Math.max(1 - (2 * 46) / height, 0.5);
    const byWidth = (size.x * 0.57) / tanH;
    const byHeight = (size.y * 0.64) / (tanV * usable);
    fitDistance = Math.max(byWidth, byHeight) + size.z * 0.35;
  }

  function placeCamera() {
    const distance = fitDistance * view.zoom;
    const flat = Math.cos(view.pitch);
    camera.position.set(
      target.x + Math.sin(view.yaw) * flat * distance + shakeOffset.x,
      target.y + Math.sin(view.pitch) * distance + shakeOffset.y,
      target.z + Math.cos(view.yaw) * flat * distance,
    );
    camera.lookAt(target.x + shakeOffset.x, target.y + shakeOffset.y, target.z);
  }

  recentreButton.addEventListener('click', () => {
    wake();
    const from = { yaw: view.yaw, pitch: view.pitch, zoom: view.zoom };
    // Take the short way round.
    const turns = Math.round((from.yaw - HOME.yaw) / (Math.PI * 2));
    from.yaw -= turns * Math.PI * 2;
    view.yawVelocity = 0;
    tween(calm() ? 0 : 420, (k) => {
      view.yaw = lerp(from.yaw, HOME.yaw, k);
      view.pitch = lerp(from.pitch, HOME.pitch, k);
      view.zoom = lerp(from.zoom, HOME.zoom, k);
    }, { ease: easeInOut });
  });

  /* Target reticle ---------------------------------------------------------------- */

  let aimed = null;
  let aimUntil = 0;
  let hint = true;
  const corner = new THREE.Vector3();

  function aim(id, { hold = 0 } = {}) {
    aimed = id;
    aimUntil = hold ? performance.now() + hold : 0;
    mapButtons.forEach((b) => b.classList.toggle('is-target', Number(b.dataset.gbTooth) === id));
    requestRender();
  }

  // The first bare tooth nearest the front, for the opening hint.
  function hintTooth() {
    const bare = teeth
      .filter((t) => !state.cuts.has(t.id))
      .sort((a, b) => Math.abs(a.s) - Math.abs(b.s) || (a.arch === 'upper' ? -1 : 1));
    return bare.length ? bare[0].id : 9;
  }

  function drawReticle() {
    const id = aimed ?? (hint ? hintTooth() : null);
    if (aimUntil && performance.now() > aimUntil) {
      aimUntil = 0;
      aim(null);
      return;
    }
    if (id === null) {
      reticle.classList.remove('is-on');
      return;
    }
    const tooth = cast.teeth.get(id);
    const box = tooth.crown;
    const fang = tooth.cut === 'fang' ? FANG_LENGTH : 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y + fang : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      );
      corner.applyMatrix4(tooth.holder.matrixWorld).project(camera);
      const x = ((corner.x + 1) / 2) * width;
      const y = ((1 - corner.y) / 2) * height;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const inset = 4;
    reticle.style.setProperty('--x', `${Math.round(minX - inset)}px`);
    reticle.style.setProperty('--y', `${Math.round(minY - inset)}px`);
    reticle.style.setProperty('--w', `${Math.round(maxX - minX + inset * 2)}px`);
    reticle.style.setProperty('--h', `${Math.round(maxY - minY + inset * 2)}px`);
    reticle.classList.toggle('is-below', tooth.arch === 'lower');
    const tag = aimed === null && hint ? `${finePointer ? 'Click' : 'Tap'} a tooth` : toothCode(tooth);
    if (reticleTag.textContent !== tag) reticleTag.textContent = tag;
    reticle.classList.add('is-on');
  }

  /* Picking and gestures ------------------------------------------------------------ */

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function pickables() {
    const list = [...blockers];
    for (const tooth of teeth) {
      if (tooth.cap && tooth.cap.visible) list.push(tooth.cap);
      if (tooth.mesh.visible) list.push(tooth.mesh);
    }
    return list;
  }

  function pickAt(x, y) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables(), false)[0];
    return hit ? hit.object.userData.toothId ?? null : null;
  }

  // Fingers are blunt: if the tap lands on gum or air, look around it.
  function pickNear(x, y, reach) {
    const direct = pickAt(x, y);
    if (direct !== null || !reach) return direct;
    for (const r of [reach * 0.5, reach]) {
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        const id = pickAt(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
        if (id !== null) return id;
      }
    }
    return null;
  }

  const pointers = new Map();
  let gesture = null;
  let hoverAt = null;

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    wake();
    sound.unlock();
    view.yawVelocity = 0;
    if (pointers.size === 1) {
      const now = performance.now();
      gesture = {
        kind: 'tap', x0: event.clientX, y0: event.clientY, t0: now, yaw0: view.yaw, pitch0: view.pitch,
        lastX: event.clientX, lastT: now, velocity: 0,
      };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
      stage.classList.remove('is-dragging');
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    const tracked = pointers.get(event.pointerId);
    if (!tracked) {
      if (event.pointerType === 'mouse') {
        hoverAt = { x: event.clientX, y: event.clientY };
        requestRender();
      }
      return;
    }
    tracked.x = event.clientX;
    tracked.y = event.clientY;
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      view.zoom = clamp((gesture.zoom * gesture.distance) / Math.max(distance, 1), 0.42, 1.3);
      requestRender();
      return;
    }
    if (gesture.kind === 'done') return;
    const dx = event.clientX - gesture.x0;
    const dy = event.clientY - gesture.y0;
    if (gesture.kind === 'tap' && Math.hypot(dx, dy) > 7) {
      gesture.kind = 'orbit';
      stage.classList.add('is-dragging');
    }
    if (gesture.kind !== 'orbit') return;
    const span = Math.max(canvas.clientWidth, 320);
    view.yaw = gesture.yaw0 - (dx / span) * Math.PI * 0.85;
    view.pitch = clamp(gesture.pitch0 + (dy / span) * Math.PI * 0.6, -0.45, 1.05);
    const now = performance.now();
    const elapsed = now - gesture.lastT;
    if (elapsed > 0) {
      const velocity = (-(event.clientX - gesture.lastX) / span) * Math.PI * 0.85 / elapsed;
      gesture.velocity = lerp(gesture.velocity, velocity, 0.6);
    }
    gesture.lastX = event.clientX;
    gesture.lastT = now;
    requestRender();
  });

  function release(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    wake();
    // On touch screens only the lift counts as a gesture that may start audio.
    sound.unlock();
    if (gesture && gesture.kind === 'tap' && event.type === 'pointerup' && performance.now() - gesture.t0 < 650) {
      const id = pickNear(event.clientX, event.clientY, event.pointerType === 'mouse' ? 0 : 14);
      if (id !== null) paint(id);
    }
    if (gesture && gesture.kind === 'orbit' && !calm() && performance.now() - gesture.lastT < 90) {
      view.yawVelocity = clamp(gesture.velocity, -0.008, 0.008);
    }
    if (pointers.size === 0) {
      gesture = null;
      stage.classList.remove('is-dragging');
    } else if (gesture) {
      // One finger of a pinch lifted: ignore the other until it lifts too.
      gesture = { kind: 'done' };
    }
    requestRender();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse' || pointers.size) return;
    hoverAt = null;
    stage.classList.remove('is-hovering');
    if (aimed !== null && !aimUntil) aim(null);
  });

  // Trackpad pinches (ctrl + wheel) zoom; plain wheels scroll the page.
  canvas.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    wake();
    view.zoom = clamp(view.zoom * Math.exp(event.deltaY * 0.01), 0.42, 1.3);
    requestRender();
  }, { passive: false });
  let gestureZoom = 1;
  canvas.addEventListener('gesturestart', (event) => {
    event.preventDefault();
    gestureZoom = view.zoom;
  });
  canvas.addEventListener('gesturechange', (event) => {
    event.preventDefault();
    wake();
    view.zoom = clamp(gestureZoom / event.scale, 0.42, 1.3);
    requestRender();
  });

  function hover() {
    if (!hoverAt || pointers.size) return;
    const id = pickAt(hoverAt.x, hoverAt.y);
    hoverAt = null;
    stage.classList.toggle('is-hovering', id !== null);
    if (id !== aimed && !aimUntil) aim(id);
  }

  /* Loop ----------------------------------------------------------------------------- */

  let frameRequested = false;
  let visible = true;
  let last = performance.now();

  function requestRender() {
    if (frameRequested || !visible) return;
    frameRequested = true;
    requestAnimationFrame(frame);
  }

  function frame(time) {
    frameRequested = false;
    clock = time;
    const dt = Math.min((time - last) / 1000, 0.05);
    last = time;

    stepTweens(time);
    stepSparks(dt);

    // Fling, then idle sway once nobody has touched it for a while.
    let moving = tweens.size > 0 || sparksAlive > 0;
    if (Math.abs(view.yawVelocity) > 0.00002) {
      view.yaw += view.yawVelocity * dt * 1000;
      view.yawVelocity *= Math.exp(-dt / 0.28);
      moving = true;
    } else {
      view.yawVelocity = 0;
    }
    const idle = !gesture && time - lastInput > 5000 && !calm();
    if (idle && !swaying) {
      swaying = true;
      swayTime = 0;
      swayBase = view.yaw;
    }
    if (swaying) {
      if (!idle) {
        swaying = false;
      } else {
        swayTime += dt;
        const ramp = Math.min(swayTime / 2.5, 1);
        view.yaw = swayBase + Math.sin(swayTime * 0.55) * 0.34 * ramp;
        moving = true;
      }
    }
    if (shakeAmount > 0.01) {
      shakeAmount *= Math.exp(-dt / 0.06);
      shakeOffset.set((Math.random() - 0.5) * shakeAmount, (Math.random() - 0.5) * shakeAmount, 0);
      moving = true;
    } else {
      shakeAmount = 0;
      shakeOffset.set(0, 0, 0);
    }

    placeCamera();
    if (tweens.size) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    hover();
    drawReticle();

    if (moving || aimUntil) requestRender();
    else if (time - lastInput <= 5000 && !calm()) {
      // Wake up again when the sway is due.
      window.setTimeout(requestRender, 5050 - (time - lastInput));
    }
  }

  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fit();
    requestRender();
  }
  new ResizeObserver(resize).observe(stage);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) {
      last = performance.now();
      requestRender();
    }
  }).observe(stage);
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible) {
      last = performance.now();
      requestRender();
    }
  });

  /* Go ------------------------------------------------------------------------------- */

  // Compile every shader now (a cap in each style and a stone), so the first
  // tap doesn't stall.
  resize();
  const warm = teeth.find((t) => t.id === 9);
  shapeCap(warm, 'iced');
  warm.cap.visible = true;
  placeCamera();
  renderer.compile(scene, camera);
  warm.cap.visible = false;
  shapeCap(warm, 'solid');
  warm.cut = null;

  await bootStepTo('Ready', 12);

  const design = readDesign();
  state.metal = design.metal;
  showMetal(state.metal, false);
  updateUi();
  say(idleLine(), { hold: true });
  renderer.shadowMap.needsUpdate = true;
  requestRender();
  await nextFrame();
  boot.classList.add('is-done');

  // The opening: the design's caps slam on, front teeth first.
  window.setTimeout(() => {
    state.cuts = design.cuts;
    hint = state.cuts.size < 8;
    sync({ stagger: true });
    lastInput = performance.now();
  }, calm() ? 0 : 380);

  // Test hook for the harness.
  root.gb = { state, cast, view, renderer, scene, camera, paint, sync, setBite, encode, requestRender };
  window.__ready = true;
}

// Last, so every constant above exists before the builder starts.
const root = document.querySelector('[data-grillz-builder]');
if (root) {
  start(root).catch((error) => {
    console.error(error);
    fail(root);
  });
}
