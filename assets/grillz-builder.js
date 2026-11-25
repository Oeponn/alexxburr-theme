// Grillz builder (sections/grillz-builder.liquid): the 3D stage, the dock and
// the design.
//
// The cast comes from grillz-builder-cast.js. A design is one metal for the
// whole piece plus a style per tooth: a cut (solid, heart, star, diamond,
// iced, solo stone) with two switches on top, fang and open face. Tapping a
// tooth, on the cast or in the map, puts the loaded style on it; tapping it
// again takes it off. Every change can be undone and is kept in the address
// (so a link shares it) and in local storage.
import * as THREE from 'three';
import {
  buildCast, capGeometry, capLook, stoneGeometry, ROWS,
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

// A tooth's style as a token: the cut's letter, then F for a fang and O for
// an open face ('dF' is a diamond-cut fang, 'iO' an iced open face). '-' is
// a bare tooth. Heart and star are windows of their own, so they don't take
// an open face.
const CUT_CODES = { solid: 's', heart: 'h', star: 'r', diamond: 'd', iced: 'i', solo: 'g' };
const CODE_CUTS = Object.fromEntries(Object.entries(CUT_CODES).map(([cut, code]) => [code, cut]));
const LEGACY = { o: 'sO', f: 'sF' }; // open face and fang were cuts once
const OWN_WINDOW = new Set(['heart', 'star']);
const OPEN_NAMES = { solid: 'Open face', diamond: 'Open diamond cut', iced: 'Iced open face', solo: 'Open face + stone' };

function makeToken({ cut, fang = false, open = false }) {
  if (!CUT_CODES[cut]) return null;
  return CUT_CODES[cut] + (fang ? 'F' : '') + (open && !OWN_WINDOW.has(cut) ? 'O' : '');
}

function readToken(token) {
  const cut = token ? CODE_CUTS[token[0]] : null;
  if (!cut) return null;
  return { cut, fang: token.includes('F'), open: token.includes('O') && !OWN_WINDOW.has(cut) };
}

/* Share code: a whole design in a few characters for the address
   (#g=1g3Xw2). The metal and every tooth's style are packed into one number
   (mixed radix: the metal's place in its list, then each tooth's style's
   place in its list, front teeth first so the usual designs come out
   shortest) and written in base 62 after a version digit. It's not a hash:
   the code is the design, so links need no server and never expire.
   A version's lists are fixed. To add a cut or a metal, add a version with
   longer lists, make it SHARE_VERSION and keep the old ones, so links
   already out there still open. */

const SHARE = {
  1: {
    metals: ['14y', '10y', '18y', 'rose', 'white', 'silver', 'black'],
    styles: ['-', 's', 'sF', 'sO', 'sFO', 'd', 'dF', 'dO', 'dFO', 'i', 'iF', 'iO', 'iFO', 'g', 'gF', 'gO', 'gFO', 'h', 'hF', 'r', 'rF'],
  },
};
const SHARE_VERSION = '1';
// From the front of the mouth out, upper before lower.
const SHARE_ORDER = [8, 9, 7, 10, 6, 11, 24, 25, 23, 26, 22, 27, 5, 12, 21, 28, 4, 13, 20, 29];
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function packDesign(metal, cuts) {
  const { metals, styles } = SHARE[SHARE_VERSION];
  let n = 0n;
  for (const id of [...SHARE_ORDER].reverse()) {
    const style = styles.indexOf(cuts.get(id) || '-');
    if (style < 0) return null;
    n = n * BigInt(styles.length) + BigInt(style);
  }
  const m = metals.indexOf(metal);
  if (m < 0) return null;
  n = n * BigInt(metals.length) + BigInt(m);
  let digits = '';
  do {
    digits = BASE62[Number(n % 62n)] + digits;
    n /= 62n;
  } while (n > 0n);
  return SHARE_VERSION + digits;
}

function unpackDesign(code) {
  const table = SHARE[code[0]];
  if (!table || code.length > 32 || !/^[0-9a-zA-Z]+$/.test(code.slice(1))) return null;
  let n = 0n;
  for (const digit of code.slice(1)) n = n * 62n + BigInt(BASE62.indexOf(digit));
  const take = (radix) => {
    const value = Number(n % BigInt(radix));
    n /= BigInt(radix);
    return value;
  };
  const metal = table.metals[take(table.metals.length)];
  const cuts = new Map();
  for (const id of SHARE_ORDER) {
    const style = table.styles[take(table.styles.length)];
    if (style !== '-') cuts.set(id, style);
  }
  // Anything left over means it wasn't one of ours.
  return n === 0n ? { metal, cuts } : null;
}

const KIND_SHORT = { central: 'Central', lateral: 'Lateral', canine: 'Canine', pm1: '1st premolar', pm2: '2nd premolar' };
const ORDER = [...ROWS.upper, ...ROWS.lower];
const DEFAULT_DESIGN = 'g=14y.--ssssss--.----------';
const STORE_KEY = 'gb-design';
const SOUND_KEY = 'gb-sound';
const LIGHT_KEY = 'gb-light';

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

/* Light ---------------------------------------------------------------------------
   Two set-ups, switched from the HUD.
   Studio (the default) is the photographic one: a hard key light with
   shadows, and a room for the metal to reflect: a bright ceiling, a dark
   band at the horizon and a grey floor, softboxes for long highlights and a
   few small, very hot lamps that the stones and polished edges catch as
   sparks. Gold needs the dark to look like gold rather than yellow plastic.
   Even is a soft, shadowless dome: flatter, but every tooth reads clearly.
   The visible background is a separate, flat light grey either way. */

function domeEnvironment(renderer, stops, lamps) {
  const studio = new THREE.Scene();
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

  // A lamp is a flat panel of one brightness, or, given `edge`, one that
  // fades top and bottom to that brightness (a soft strip: hard edges in the
  // room show up in polished metal as lines that read as grooves).
  for (const [width, height, value, at, edge] of lamps) {
    const geometry = new THREE.PlaneGeometry(width, height, 1, edge === undefined ? 1 : 12);
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const fromEdge = 1 - Math.abs(position.getY(i) / (height / 2));
      const v = edge === undefined ? value : edge + (value - edge) * THREE.MathUtils.smoothstep(fromEdge, 0, 0.85);
      colors.fill(v, i * 3, i * 3 + 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.position.set(...at);
    mesh.lookAt(0, 0, 0);
    studio.add(mesh);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const texture = generator.fromScene(studio, 0.02).texture;
  generator.dispose();
  return texture;
}

function studioEnvironment(renderer) {
  return domeEnvironment(
    renderer,
    [[-1, 0.42], [-0.4, 0.34], [-0.12, 0.1], [0.02, 0.05], [0.12, 0.75], [0.45, 1.05], [1, 1.3]],
    [
      [7, 1.4, 5.5, [0, 5.2, 1.5]], // overhead strip
      [1.1, 6, 3.6, [-5.2, 0.6, 2]], // left strip
      [1.1, 6, 3.2, [5.2, 0.6, 0.5]], // right strip
      [4.2, 2.4, 2.6, [0, 2.2, 6], 0.9], // front card, high: lights the lip faces
      [5, 1.8, 0.0, [0, -1.4, 6], 0.22], // front, low: a dark band across them
      // Small hot lamps: sparks in the stones.
      [0.45, 0.45, 60, [-3.2, 4.4, 3.4]],
      [0.4, 0.4, 48, [3.6, 3.4, 3.8]],
      [0.35, 0.35, 40, [1.2, 4.9, -1.5]],
      [0.3, 0.3, 36, [-1.8, 1.6, 5.8]],
      [0.3, 0.3, 30, [5.4, 1.2, -2.2]],
    ],
  );
}

function evenEnvironment(renderer) {
  return domeEnvironment(
    renderer,
    [[-1, 0.48], [-0.25, 0.6], [0.15, 0.88], [1, 1.08]],
    [
      [9, 9, 1.5, [0, 6, 2]], // a broad soft ceiling
      [3, 6, 1.2, [-6, 1, 3]], // and two soft walls, just enough to keep the
      [3, 6, 1.1, [6, 1, 2]], // metal looking like metal
    ],
  );
}

/* Cap shader ---------------------------------------------------------------------
   Caps are standard metal with two additions, both driven by the per-vertex
   face data the cast module bakes into each cap (tooth-local x and height,
   room to the side outline, how much the surface faces the lip) and by the
   numbers capLook works out for the style:
   - a window (open face, heart or star) cut out of the lip face with a
     rounded, bevelled edge. gbHole mirrors holeDistance in the cast module,
     which keeps the stones clear of it;
   - diamond cut: a field of small pyramids bumped into the normal, which
     glint as the cast turns.
   Bumps use screen-space derivatives of a height, so there's no texture. */

const CAP_PARS = /* glsl */ `
uniform float uWindow; // 0 none, 1 open face, 2 heart, 3 star
uniform float uFinish; // 0 polished, 1 diamond cut
uniform vec4 uGum;     // zenith, papilla, half width, crown height (mm)
uniform vec4 uFrame;   // open face: side, gum and edge bands, corner radius (mm)
uniform vec4 uShape;   // heart / star: centre height, scale, up (+1 lower / -1 upper)
varying vec4 vFace;    // x, height, room to the side outline, faces the lip

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
  if (vFace.w < 0.2 || uWindow < 0.5) return 1e3;
  if (uWindow < 1.5) {
    float edge = clamp(abs(vFace.x) / uGum.z, 0.0, 1.0);
    float gum = uGum.x + (uGum.y - uGum.x) * pow(edge * edge, 0.85);
    float side = vFace.z - uFrame.x;
    float top = (uGum.w - uFrame.z) - vFace.y;
    float bottom = vFace.y - (gum + uFrame.y);
    return -gbSmin(gbSmin(side, top, uFrame.w), bottom, uFrame.w);
  }
  vec2 p = vec2(vFace.x, (vFace.y - uShape.x) * uShape.z) / uShape.y;
  float d = uWindow < 2.5 ? gbHeart(p + vec2(0.0, 0.55)) : gbStar(p, 0.62, 0.42);
  return d * uShape.y;
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
float gbHeight = 0.24 * (1.0 - pow(1.0 - clamp(gbEdge / 0.5, 0.0, 1.0), 2.0));
if (uFinish > 0.5) gbHeight += gbFacets();
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
    uWindow: { value: 0 },
    uFinish: { value: 0 },
    uGum: { value: new THREE.Vector4() },
    uFrame: { value: new THREE.Vector4() },
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

/* Stones -------------------------------------------------------------------------
   Small brilliants, shaded as diamonds rather than mirrors. Two parts:
   - the flash off a facet: about a sixth of the light straight on, nearly
     all of it at a glancing angle;
   - the light that comes back out from inside. A ray through the crown is
     bent down into the pavilion, bounces off its facets and leaves through
     the table or a crown facet, bent apart by colour on the way out (fire).
     Where it leaves depends on the view, so turning the cast makes each
     facet flash on and off. It's traced in the stone's own space against
     the pavilion cone, split into the geometry's eight facets.
   The room's small hot lamps are what the stones light up with. */

const GEM_VERTEX = /* glsl */ `
vGemLocal = position;
#ifdef USE_INSTANCING
  mat3 gemTurn = mat3(instanceMatrix);
#else
  mat3 gemTurn = mat3(1.0);
#endif
vGemSide = normalMatrix * (gemTurn * vec3(1.0, 0.0, 0.0));
vGemUp = normalMatrix * (gemTurn * vec3(0.0, 1.0, 0.0));
vGemOut = normalMatrix * (gemTurn * vec3(0.0, 0.0, 1.0));
`;

const GEM_PARS = /* glsl */ `
varying vec3 vGemLocal;
varying vec3 vGemSide;
varying vec3 vGemUp;
varying vec3 vGemOut;
uniform float uGemFire;

// Outward normal of the pavilion facet under p (eight facets, centred
// between the girdle points).
vec3 gemFacet(vec3 p) {
  float a = (floor(atan(p.z, p.x) / 0.785398) + 0.5) * 0.785398;
  return normalize(vec3(cos(a) * 0.42, -0.462, sin(a) * 0.42));
}

// Distance along d from p (inside the stone) to the pavilion: a cone from
// the girdle (radius 0.5 at y 0) down to the culet (y -0.42). -1 if none.
float gemPavilion(vec3 p, vec3 d) {
  const float k = 0.7056; // (0.42 / 0.5)^2
  vec3 q = vec3(p.x, p.y + 0.42, p.z);
  float a = k * (d.x * d.x + d.z * d.z) - d.y * d.y;
  float b = 2.0 * (k * (q.x * d.x + q.z * d.z) - q.y * d.y);
  float c = k * (q.x * q.x + q.z * q.z) - q.y * q.y;
  float disc = b * b - 4.0 * a * c;
  if (disc < 0.0 || abs(a) < 1e-5) return -1.0;
  float r = sqrt(disc);
  float best = 1e4;
  for (int i = 0; i < 2; i++) {
    float s = (-b + (i == 0 ? -r : r)) / (2.0 * a);
    float y = q.y + s * d.y;
    if (s > 1e-3 && y > 0.0 && y < 0.42) best = min(best, s);
  }
  return best < 1e3 ? best : -1.0;
}

vec3 gemRoom(vec3 viewDir) {
  #ifdef USE_ENVMAP
    vec3 w = inverseTransformDirection(viewDir, viewMatrix);
    return textureCubeUV(envMap, envMapRotation * w, 0.0).rgb * envMapIntensity;
  #else
    return vec3(1.0);
  #endif
}
`;

const GEM_SHADE = /* glsl */ `
{
  vec3 n = normalize(normal);
  vec3 v = normalize(vViewPosition);
  mat3 toView = mat3(normalize(vGemSide), normalize(vGemUp), normalize(vGemOut));
  mat3 toLocal = transpose(toView);
  vec3 nL = toLocal * n;
  vec3 vL = toLocal * v;
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float fresnel = 0.17 + 0.83 * pow(1.0 - facing, 5.0);
  vec3 flash = gemRoom(reflect(-v, n));

  // In through this facet, then round the pavilion.
  vec3 p = vGemLocal;
  vec3 d = refract(-vL, nL, 1.0 / 2.42);
  for (int i = 0; i < 3; i++) {
    float s = gemPavilion(p, d);
    if (s < 0.0) break;
    p += d * s;
    d = reflect(d, gemFacet(p));
  }
  // Out through the table, or the crown facet it reaches nearer the girdle.
  float lift = max(0.17 - p.y, 0.0) / max(d.y, 0.05);
  vec2 exitAt = p.xz + d.xz * lift;
  float exitTurn = (floor(atan(exitAt.y, exitAt.x) / 0.785398) + 0.5) * 0.785398;
  vec3 crown = length(exitAt) < 0.27
    ? vec3(0.0, 1.0, 0.0)
    : normalize(vec3(cos(exitTurn) * 0.57, 0.82, sin(exitTurn) * 0.57));
  vec3 iors = vec3(2.42 - uGemFire, 2.42, 2.42 + uGemFire * 1.6);
  vec3 fire;
  for (int c = 0; c < 3; c++) {
    vec3 o = refract(d, -crown, iors[c]);
    // Caught inside: it rattles round and leaks out dim.
    vec3 room = dot(o, o) < 0.01 ? gemRoom(toView * reflect(d, -crown)) * 0.3 : gemRoom(toView * o);
    fire[c] = room[c];
  }
  // Heading out through the bottom (into the metal): dark.
  if (d.y < 0.0) fire *= 0.18;
  outgoingLight = flash * fresnel + fire * (1.0 - fresnel);
}
`;

function makeGemMaterial() {
  const uniforms = { uGemFire: { value: 0.05 } };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 0, roughness: 0, flatShading: true,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGemLocal;\nvarying vec3 vGemSide;\nvarying vec3 vGemUp;\nvarying vec3 vGemOut;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GEM_VERTEX}`);
    // After the environment map's own declarations, which it samples.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <envmap_physical_pars_fragment>', `#include <envmap_physical_pars_fragment>\n${GEM_PARS}`)
      .replace('#include <opaque_fragment>', `${GEM_SHADE}\n#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'grillz-gem';
  return material;
}

/* Plaster: dental stone is matte and a little grainy, with the odd pinhole
   from an air bubble. A fine grain darkens and bumps the surface, a broad
   mottle varies it, and rare pits pock it; all of it fades out before it's
   small enough to shimmer. Measured in each mesh's own millimetres. */

const PLASTER_PARS = /* glsl */ `
varying vec3 vGrain;
uniform float uGrain;
float gbHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float gbNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(gbHash(i), gbHash(i + vec3(1, 0, 0)), f.x), mix(gbHash(i + vec3(0, 1, 0)), gbHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(gbHash(i + vec3(0, 0, 1)), gbHash(i + vec3(1, 0, 1)), f.x), mix(gbHash(i + vec3(0, 1, 1)), gbHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
vec3 gbBump(vec3 n, vec3 sx, vec3 sy, vec2 dh, float facing) {
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * facing;
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - grad);
}
`;

const PLASTER_COLOUR = /* glsl */ `
vec3 gbG = vGrain * 3.4;
float gbFine = 1.0 - smoothstep(0.3, 0.85, length(fwidth(gbG)));
float gbGrain = gbNoise(gbG) * 0.6 + gbNoise(gbG * 2.3 + 3.1) * 0.4;
float gbMottle = gbNoise(vGrain * 0.32);
float gbPit = smoothstep(0.9, 0.95, gbNoise(vGrain * 2.1 + 7.0)) * gbFine;
diffuseColor.rgb *= 1.0 + uGrain * ((gbGrain - 0.5) * 0.1 * gbFine + (gbMottle - 0.5) * 0.06 - gbPit * 0.14);
float gbRelief = uGrain * ((gbGrain - 0.5) * 0.045 * gbFine - gbPit * 0.04);
vec2 gbDh = vec2(dFdx(gbRelief), dFdy(gbRelief));
vec3 gbSx = dFdx(-vViewPosition);
vec3 gbSy = dFdy(-vViewPosition);
`;

function addGrain(material, strength) {
  const uniforms = { uGrain: { value: strength } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrain;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrain = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PLASTER_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${PLASTER_COLOUR}`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = gbBump(normal, gbSx, gbSy, gbDh, faceDirection);');
  };
  material.customProgramCacheKey = () => 'grillz-plaster';
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
  const lightButton = $('[data-gb-light]');
  const recentreButton = $('[data-gb-recentre]');
  const tabs = $$('[role="tab"]');
  const cutPanel = $('[data-gb-cuts]');
  const cutButtons = $$('[data-gb-cut]');
  const modButtons = $$('[data-gb-mod]');
  const metalButtons = $$('[data-gb-metal]');
  const setsPanel = $('[data-gb-sets]');
  const setsHint = $('[data-gb-sets-hint]');
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

  // Dental stone: matte, with a fine grain (see addGrain).
  const plaster = {
    tooth: addGrain(new THREE.MeshStandardMaterial({ color: 0xefeee9, roughness: 0.78, vertexColors: true, envMapIntensity: 0.4 }), 0.8),
    gum: addGrain(new THREE.MeshStandardMaterial({ color: 0x95928b, roughness: 0.96, vertexColors: true, envMapIntensity: 0.32 }), 1),
    base: addGrain(new THREE.MeshStandardMaterial({ color: 0xa3a099, roughness: 0.96, vertexColors: true, envMapIntensity: 0.32 }), 1),
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
    tooth.cut = null; // the style token it's wearing, or null when bare
    tooth.look = null;
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
  const KEY_INTENSITY = 2.1;
  const key = new THREE.DirectionalLight(0xffffff, KEY_INTENSITY);
  key.position.set(target.x - 70, target.y + 85, target.z + 150);
  key.target.position.copy(target);
  key.castShadow = true;
  const big = Math.min(window.innerWidth, window.innerHeight) > 700;
  key.shadow.mapSize.set(big ? 2048 : 1024, big ? 2048 : 1024);
  Object.assign(key.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 20, far: 420 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.35;
  scene.add(key, key.target);
  const fill = new THREE.HemisphereLight(0xffffff, 0x8c8c88, 1.25);
  scene.add(fill);

  await bootStepTo('Polishing metal', 9);

  const rooms = { studio: studioEnvironment(renderer), even: evenEnvironment(renderer) };
  scene.environment = rooms.studio;
  const stoneGeo = stoneGeometry();
  const stoneMaterial = makeGemMaterial();

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

  // Timed from now, not from the last frame drawn: the loop sleeps between
  // interactions, and a tween timed from a stale frame would start in the
  // past and jump straight to its end.
  function tween(duration, update, { delay = 0, ease = easeOut, done, begin } = {}) {
    const item = { start: performance.now() + delay, duration, update, ease, done, begin };
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

  // How far a tooth reaches past its natural tip with what it's wearing.
  const reachOf = (tooth) => (tooth.look && tooth.cut && tooth.look.fang ? tooth.fangLength : 0);

  function tipOf(tooth) {
    const top = tooth.spec.H + reachOf(tooth);
    return tooth.holder.localToWorld(new THREE.Vector3(0, top * 0.8, tooth.profile(tooth.spec.H * 0.8).z0 + 1.5));
  }

  function paintMetal(tooth, metal) {
    tooth.cap.material.color.copy(metal.color);
    tooth.cap.material.roughness = metal.rough;
  }

  function ensureCap(tooth) {
    if (tooth.cap) return tooth.cap;
    const cap = new THREE.Mesh(capGeometry(tooth), makeCapMaterial());
    cap.castShadow = true;
    cap.receiveShadow = true;
    cap.visible = false;
    cap.userData.toothId = tooth.id;
    tooth.holder.add(cap);
    tooth.cap = cap;
    paintMetal(tooth, METALS[shownMetal]);
    return cap;
  }

  // What a style does to a tooth (shape, window, finish, stones), worked out
  // once per tooth and style.
  const looks = new Map();
  function lookFor(tooth, token) {
    const key = `${tooth.id}:${token}`;
    if (!looks.has(key)) looks.set(key, capLook(tooth, readToken(token)));
    return looks.get(key);
  }

  // Shape the cap for a style: plain or fang shell, window, finish, stones.
  function shapeCap(tooth, token) {
    const cap = ensureCap(tooth);
    const look = lookFor(tooth, token);
    tooth.look = look;
    cap.geometry = capGeometry(tooth, look.fang);
    const { uniforms } = cap.material.userData;
    uniforms.uWindow.value = look.window;
    uniforms.uFinish.value = look.finish;
    uniforms.uGum.value.fromArray(look.gum);
    uniforms.uFrame.value.fromArray(look.frame);
    uniforms.uShape.value.fromArray(look.shape);
    if (tooth.stones) {
      cap.remove(tooth.stones);
      tooth.stones.dispose();
      tooth.stones = null;
    }
    if (look.stones.length) {
      const spots = look.stones;
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
    tooth.windowed = look.window > 0;
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

  // state.cuts maps tooth ids to style tokens (see makeToken); bare teeth
  // aren't in it. The brush is the style that taps put on: a cut ('bare'
  // takes caps off) and the two switches.
  const state = { metal: '14y', cuts: new Map() };
  const brush = { cut: 'solid', fang: false, open: false };
  const brushToken = () => makeToken(brush);
  const undoStack = [];

  // The readable spelling: metal, then the upper and lower rows of tokens
  // (14y.--sFdFsO----.----------). Links used it before the share code, so
  // it still reads; it's also what the test hook reports.
  function spell() {
    const row = (ids) => ids.map((id) => state.cuts.get(id) || '-').join('');
    return `${state.metal}.${row(ROWS.upper)}.${row(ROWS.lower)}`;
  }

  // What goes in the address: the share code (spelled out only if the design
  // somehow has a metal or style the code doesn't know).
  function encode() {
    return packDesign(state.metal, state.cuts) || spell();
  }

  function decode(text) {
    if (!text) return null;
    if (!text.includes('.')) {
      const design = unpackDesign(text);
      return design && METALS[design.metal] ? design : null;
    }
    const match = /^([a-z0-9]+)\.([-a-zA-Z]+)\.([-a-zA-Z]+)$/.exec(text);
    if (!match || !METALS[match[1]]) return null;
    const tokens = [];
    for (const row of [match[2], match[3]]) {
      const found = row.match(/[-a-z][A-Z]*/g) || [];
      if (found.length !== 10 || found.join('') !== row) return null;
      tokens.push(...found);
    }
    const cuts = new Map();
    ORDER.forEach((id, i) => {
      const style = readToken(LEGACY[tokens[i]] || tokens[i]);
      if (style) cuts.set(id, makeToken(style));
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

  // A style's name, for the readout: 'Diamond cut fang', 'Iced open face'.
  function styleName(token) {
    const style = readToken(token);
    if (!style) return 'Bare';
    let name = style.open ? OPEN_NAMES[style.cut] : CUTS[style.cut];
    if (style.fang) name = style.cut === 'solo' && style.open ? 'Open fang + stone' : `${name} fang`;
    return name;
  }

  function idleLine() {
    const tap = finePointer ? 'click' : 'tap';
    if (brush.cut === 'bare') return `Remove · ${tap} a cap or a set`;
    return `${styleName(brushToken())} loaded · ${tap} a tooth`;
  }

  function stoneCount() {
    let total = 0;
    for (const [id, token] of state.cuts) total += lookFor(cast.teeth.get(id), token).stones.length;
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
    cutButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gbCut === brush.cut)));
    // The switches don't apply to Remove, and heart / star have their own
    // window instead of an open face.
    modButtons.forEach((b) => {
      const mod = b.dataset.gbMod;
      const off = brush.cut === 'bare' || (mod === 'open' && OWN_WINDOW.has(brush.cut));
      b.setAttribute('aria-pressed', String(brush[mod] && !off));
      b.classList.toggle('is-idle', off);
    });
    // The cut glyphs preview the switches.
    cutPanel.classList.toggle('is-fang', brush.fang);
    cutPanel.classList.toggle('is-open', brush.open);
    // With Remove loaded, sets take caps off: grey out any with none to take.
    const removing = brush.cut === 'bare';
    setsPanel.classList.toggle('is-removing', removing);
    setsHint.textContent = removing ? 'Takes those caps off' : 'Swaps the whole design';
    setButtons.forEach((b) => {
      b.disabled = removing && !b.dataset.teeth.split(',').some((id) => state.cuts.has(Number(id)));
    });
    metalButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gbMetal === state.metal)));
    const swatch = METALS[state.metal].swatch;
    mapButtons.forEach((b) => {
      const id = Number(b.dataset.gbTooth);
      const token = state.cuts.get(id) || '';
      const style = readToken(token);
      b.setAttribute('aria-pressed', String(Boolean(style)));
      b.dataset.cut = style ? style.cut : '';
      b.classList.toggle('is-fang', Boolean(style && style.fang));
      b.classList.toggle('is-open', Boolean(style && (style.open || OWN_WINDOW.has(style.cut))));
      b.style.setProperty('--cap', swatch);
      b.setAttribute('aria-label', `${toothName(cast.teeth.get(id))}, #${id}: ${style ? styleName(token) : 'bare'}`);
    });
    undoButton.disabled = undoStack.length === 0;
    clearButton.disabled = state.cuts.size === 0;
  }

  function paint(id, { fromMap = false } = {}) {
    const tooth = cast.teeth.get(id);
    const current = state.cuts.get(id) || null;
    const loaded = brushToken();
    const next = !loaded || current === loaded ? null : loaded;
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
    say(`${toothCode(tooth)} · ${next ? styleName(next) : 'Off'}`);
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
    brush.cut = button.dataset.gbCut;
    sound.unlock();
    sound.play('tick');
    // A heart or star is a window already: it takes the open face's place.
    const swapped = brush.open && OWN_WINDOW.has(brush.cut);
    if (swapped) brush.open = false;
    updateUi();
    say(swapped ? `${CUTS[brush.cut]} · replaces the open face` : idleLine(), { hold: !swapped });
  }));

  // Fang and open face switch on and off on top of the cut.
  modButtons.forEach((button) => button.addEventListener('click', () => {
    const mod = button.dataset.gbMod;
    sound.unlock();
    sound.play('tick');
    if (brush.cut === 'bare') brush.cut = 'solid';
    brush[mod] = !brush[mod];
    // An open face replaces a heart or star window.
    const swapped = mod === 'open' && brush.open && OWN_WINDOW.has(brush.cut);
    if (swapped) brush.cut = 'solid';
    updateUi();
    say(swapped ? 'Open face · replaces the window' : idleLine(), { hold: !swapped });
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
    hint = false;
    // With Remove loaded, a set takes its own teeth's caps off and leaves the
    // rest (so Full set clears the lot).
    if (brush.cut === 'bare') {
      if (!ids.some((id) => state.cuts.has(id))) return;
      commit(() => { ids.forEach((id) => state.cuts.delete(id)); }, { stagger: true });
      say(state.cuts.size ? `${labelOf(button)} · caps off` : 'Every cap off · undo brings them back');
      return;
    }
    // Otherwise it swaps in a whole design: the loaded style on its teeth,
    // with a fang if the set says so.
    const token = makeToken({ ...brush, fang: brush.fang || 'fang' in button.dataset });
    if (ids.some((id) => cast.teeth.get(id).arch === 'lower') && bitten) setBite(false);
    commit(() => { state.cuts = new Map(ids.map((id) => [id, token])); }, { stagger: true });
    say(`${labelOf(button)} · ${styleName(token)}`);
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
    say('Reset · every cap off · undo brings them back');
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

  /* Light: studio (key light, shadows, the hot room) or even (soft dome). ---------- */

  let lightMode = 'studio';
  try {
    if (window.localStorage.getItem(LIGHT_KEY) === 'even') lightMode = 'even';
  } catch (error) { /* storage off */ }

  function setLight(mode) {
    lightMode = mode;
    const studio = mode === 'studio';
    scene.environment = rooms[mode];
    // Dimmed rather than hidden, so the shaders stay as compiled.
    key.intensity = studio ? KEY_INTENSITY : 0;
    shadowCatcher.visible = studio;
    fill.intensity = studio ? 1.25 : 1.9;
    fill.groundColor.set(studio ? 0x8c8c88 : 0xb4b4b0);
    lightButton.setAttribute('aria-pressed', String(!studio));
    renderer.shadowMap.needsUpdate = true;
    requestRender();
  }

  lightButton.addEventListener('click', () => {
    sound.unlock();
    sound.play('tick');
    setLight(lightMode === 'studio' ? 'even' : 'studio');
    try {
      window.localStorage.setItem(LIGHT_KEY, lightMode);
    } catch (error) { /* storage off */ }
    say(lightMode === 'studio' ? 'Studio light · key, shadows, sparkle' : 'Even light · soft, no shadows');
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
    const fang = reachOf(tooth);
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
  setLight(lightMode);
  const warm = teeth.find((t) => t.id === 9);
  shapeCap(warm, makeToken({ cut: 'iced' }));
  warm.cap.visible = true;
  placeCamera();
  renderer.compile(scene, camera);
  warm.cap.visible = false;
  shapeCap(warm, makeToken({ cut: 'solid' }));
  warm.cut = null;
  warm.look = null;

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
  root.gb = {
    state, brush, cast, view, target, renderer, scene, camera, paint, sync, setBite, setLight, encode, spell, decode, requestRender, lookFor,
  };
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
