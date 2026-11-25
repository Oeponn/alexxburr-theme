// Grillz builder: the dental cast, sculpted in code.
//
// Grillz are made on a stone cast of the mouth, so that's what the builder
// shows: two plaster arches (teeth, gums and a trimmed base) on a hinge, with
// every tooth its own mesh so it can wear a cap. Nothing is loaded; it's all
// lofted from a few numbers per tooth.
//
// Units are millimetres. Each arch is built crowns-up in its own space and
// the upper one is mirrored on y by its group (three.js flips the winding for
// a mirrored matrix, so faces still point out).
//
// Tooth-local space: x runs along the arch (mesio-distal), y from the neck
// (cementoenamel junction, 0) to the tip (crown height), z out of the mouth
// (labial).
import * as THREE from 'three';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Catmull-Rom through values spaced evenly over [0, 1].
function spline(values) {
  const n = values.length - 1;
  return (t) => {
    const x = clamp(t, 0, 1) * n;
    const i = Math.min(Math.floor(x), n - 1);
    const f = x - i;
    const p0 = values[Math.max(i - 1, 0)];
    const p1 = values[i];
    const p2 = values[i + 1];
    const p3 = values[Math.min(i + 2, n)];
    return 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
  };
}

/* Teeth ---------------------------------------------------------------------
   Ten per arch, second premolar to second premolar: everything a grill
   reaches. Ids are the US (universal) tooth numbers. Each row runs the way
   it reads from the front, patient's right (viewer's left) first. */

export const ROWS = {
  upper: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  lower: [29, 28, 27, 26, 25, 24, 23, 22, 21, 20],
};

const KIND_BY_SLOT = ['pm2', 'pm1', 'canine', 'lateral', 'central', 'central', 'lateral', 'canine', 'pm1', 'pm2'];

// W: width along the arch, H: crown height, D: lip-to-tongue depth at the
// neck (mm). cerv: neck width as a share of W, tw: where the crown reaches
// full width, rc: incisal corner radius, tc/slope: where a cusp starts and
// how it tapers. torque tips the crown out of the mouth, tip leans it
// towards the midline (degrees). level: how far short of the bite plane the
// tip stops.
const SPECS = {
  upper: {
    central: { form: 'incisor', W: 8.6, H: 10.6, D: 7.0, cerv: 0.7, tw: 0.58, rc: 1.25, torque: 13, tip: 4, level: 0 },
    lateral: { form: 'incisor', W: 6.6, H: 9.0, D: 6.0, cerv: 0.66, tw: 0.56, rc: 1.7, torque: 11, tip: 7, level: 0.7 },
    canine: { form: 'canine', W: 7.6, H: 10.2, D: 8.0, cerv: 0.7, tw: 0.5, tc: 0.6, slope: 0.8, tipR: 0.7, tipB: 0.6, drop: 1.2, torque: 6, tip: 8, level: 0.1 },
    pm1: { form: 'premolar', W: 7.0, H: 8.4, D: 9.0, cerv: 0.74, tw: 0.5, tc: 0.64, slope: 0.95, tipR: 1.0, tipB: 0.85, drop: 2.0, torque: -3, tip: 4, level: 0.5 },
    pm2: { form: 'premolar', W: 6.6, H: 7.6, D: 9.0, cerv: 0.76, tw: 0.5, tc: 0.66, slope: 0.9, tipR: 1.1, tipB: 0.85, drop: 1.6, torque: -4, tip: 3, level: 0.8 },
  },
  lower: {
    central: { form: 'incisor', W: 5.3, H: 9.0, D: 5.8, cerv: 0.68, tw: 0.62, rc: 0.7, torque: 9, tip: 1, level: 0 },
    lateral: { form: 'incisor', W: 5.9, H: 9.4, D: 6.2, cerv: 0.66, tw: 0.62, rc: 0.9, torque: 9, tip: 2, level: 0 },
    canine: { form: 'canine', W: 6.9, H: 10.2, D: 7.6, cerv: 0.7, tw: 0.5, tc: 0.62, slope: 0.8, tipR: 0.65, tipB: 0.6, drop: 1.0, torque: 4, tip: 5, level: 0.1 },
    pm1: { form: 'premolar', W: 7.0, H: 8.4, D: 7.6, cerv: 0.74, tw: 0.5, tc: 0.64, slope: 0.95, tipR: 1.0, tipB: 0.85, drop: 2.2, torque: -3, tip: 3, level: 0.6 },
    pm2: { form: 'premolar', W: 7.1, H: 8.0, D: 8.0, cerv: 0.76, tw: 0.5, tc: 0.66, slope: 0.9, tipR: 1.1, tipB: 0.85, drop: 1.4, torque: -5, tip: 3, level: 0.9 },
  },
};

// Lip and tongue surfaces in units of half the neck depth, at even steps up
// the crown, and the section's squareness (superellipse exponent) at the
// neck and the tip.
const FORMS = {
  incisor: { lab: [0.94, 1, 0.9, 0.66, 0.24], lin: [-0.96, -0.84, -0.52, -0.26, -0.05], n0: 2.1, n1: 2.8 },
  canine: { lab: [0.95, 1, 0.92, 0.7, 0.26], lin: [-0.95, -0.9, -0.66, -0.4, -0.12], n0: 2.0, n1: 1.85 },
  premolar: { lab: [0.95, 1, 0.95, 0.74, 0.36], lin: [-0.95, -1, -0.95, -0.78, -0.3], n0: 2.3, n1: 2.1 },
};

// Gum line, measured up from the neck: lowest mid-tooth (zenith), highest
// between teeth (papilla).
const GUM = { zenith: 0.8, papilla: 3.6 };

/* Sections ------------------------------------------------------------------
   A tooth is a loft of superellipse sections. profile(h) gives the section
   at height h: half-width a, centre z0 and half-depth b along z, exponent n. */

function baseProfile(spec) {
  const form = FORMS[spec.form];
  const lab = spline(form.lab);
  const lin = spline(form.lin);
  const half = spec.W / 2;
  const depth = spec.D / 2;
  const { H } = spec;

  return (h) => {
    const t = h / H;
    if (t < 0) {
      // Root: keep the neck section and taper it.
      const k = 1 + t * 0.4;
      const zl = lab(0) * depth * k;
      const zg = lin(0) * depth * k;
      return { a: half * spec.cerv * k, z0: (zl + zg) / 2, b: (zl - zg) / 2, n: form.n0, drop: 0 };
    }
    const u = Math.min(t, 1);
    let a = half * lerp(spec.cerv, 1, smooth(0, spec.tw, u));
    const zl = lab(u) * depth;
    const zg = lin(u) * depth;
    let b = Math.max((zl - zg) / 2, 0.22);
    let drop = 0;
    if (spec.form === 'incisor') {
      // Round the incisal corners.
      const y0 = H - spec.rc;
      if (h > y0) a = Math.min(a, half - spec.rc + Math.sqrt(Math.max(spec.rc * spec.rc - (h - y0) ** 2, 0)));
    } else {
      // Cusp: the sides run in to a rounded point and the tongue side falls
      // away below it, so the tip is a cone and not a blade.
      const c = smooth(spec.tc, 1, u);
      if (u > spec.tc) a *= Math.pow(Math.max((1 - u) / (1 - spec.tc), 0), spec.slope);
      a = Math.max(a, spec.tipR);
      b *= lerp(1, spec.tipB, c);
      drop = spec.drop * c;
    }
    return { a, z0: (zl + zg) / 2, b, n: lerp(form.n0, form.n1, u), drop };
  };
}

// A fang keeps the lower part of the crown as it is (the cap still sits on
// the tooth) and draws the rest out into a point `length` mm past the
// natural tip. Any tooth can take one: on an incisor it makes a shark tooth.
function fangProfile(spec, length) {
  const base = baseProfile(spec);
  const { H } = spec;
  const h0 = 0.4 * H;
  const top = H + length;
  const start = base(h0);
  const tip = base(H);
  return (h) => {
    const natural = base(Math.min(h, H));
    if (h <= h0) return natural;
    const f = clamp((h - h0) / (top - h0), 0, 1);
    const along = Math.min((h - h0) / (H - h0), 1.2);
    const fang = {
      a: Math.max(start.a * Math.pow(1 - f, 0.8), 0.16),
      z0: lerp(start.z0, tip.z0, along),
      b: Math.max(start.b * Math.pow(1 - f, 0.62), 0.2),
      n: lerp(start.n, 2, f),
      drop: 0,
    };
    const w = smooth(h0, h0 + 2.2, h);
    return {
      a: lerp(natural.a, fang.a, w),
      z0: lerp(natural.z0, fang.z0, w),
      b: lerp(natural.b, fang.b, w),
      n: lerp(natural.n, fang.n, w),
      drop: natural.drop * (1 - w),
    };
  };
}

function makeProfile(spec, fang = 0) {
  return fang > 0 ? fangProfile(spec, fang) : baseProfile(spec);
}

function sectionPoint(p, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const e = 2 / p.n;
  return [p.a * Math.sign(c) * Math.abs(c) ** e, p.z0 + p.b * Math.sign(s) * Math.abs(s) ** e];
}

// Ring heights: a short root, then the crown with rings bunched up towards
// the tip where the shape turns fastest.
function ringHeights(from, to, count) {
  const heights = [];
  for (let i = 0; i <= count; i++) {
    const u = i / count;
    heights.push(from + (to - from) * (1 - (1 - u) ** 1.45));
  }
  return heights;
}

const SEGMENTS = 44;

// Loft rings into a closed, indexed mesh with a fan on each end. Returns the
// geometry plus, per vertex, the section parameters used to build it.
function loft(profile, heights) {
  const positions = [];
  const params = []; // [h, theta] per vertex
  for (const h of heights) {
    const p = profile(h);
    for (let j = 0; j < SEGMENTS; j++) {
      const theta = (j / SEGMENTS) * Math.PI * 2;
      const [x, z] = sectionPoint(p, theta);
      const tongue = Math.max(-Math.sin(theta), 0);
      positions.push(x, h - p.drop * tongue ** 1.5, z);
      params.push(h, theta);
    }
  }
  const rings = heights.length;
  const bottom = positions.length / 3;
  const pb = profile(heights[0]);
  positions.push(0, heights[0], pb.z0);
  params.push(heights[0], -1);
  const top = bottom + 1;
  const pt = profile(heights[rings - 1]);
  positions.push(0, heights[rings - 1] + Math.min(pt.b, 0.3) * 0.4 - pt.drop * 0.35, pt.z0);
  params.push(heights[rings - 1], -1);

  const index = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * SEGMENTS + j;
      const b = i * SEGMENTS + ((j + 1) % SEGMENTS);
      const c = a + SEGMENTS;
      const d = b + SEGMENTS;
      index.push(a, c, b, b, c, d);
    }
  }
  for (let j = 0; j < SEGMENTS; j++) {
    const a = j;
    const b = (j + 1) % SEGMENTS;
    index.push(bottom, a, b);
    const c = (rings - 1) * SEGMENTS + j;
    const d = (rings - 1) * SEGMENTS + ((j + 1) % SEGMENTS);
    index.push(top, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return { geometry, params };
}

/* Arch ----------------------------------------------------------------------
   A parabola measured by arc length, s = 0 on the midline and negative to
   the viewer's left. at(s) gives the point, the tangent (towards +s) and the
   outward normal. */

function archCurve(k, zShift) {
  const steps = 600;
  const xMax = 40;
  const xs = [];
  const zs = [];
  const len = [0];
  for (let i = 0; i <= steps; i++) {
    const x = -xMax + (2 * xMax * i) / steps;
    xs.push(x);
    zs.push(-k * x * x + zShift);
    if (i > 0) len.push(len[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  }
  const mid = len[steps / 2];
  return (s) => {
    const target = clamp(mid + s, 0, len[steps]);
    let lo = 0;
    let hi = steps;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (len[m] < target) lo = m;
      else hi = m;
    }
    const f = (target - len[lo]) / (len[hi] - len[lo] || 1);
    const x = lerp(xs[lo], xs[hi], f);
    const z = lerp(zs[lo], zs[hi], f);
    const tz = -2 * k * x;
    const l = Math.hypot(1, tz);
    const tangent = new THREE.Vector3(1 / l, 0, tz / l);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    return { point: new THREE.Vector3(x, 0, z), tangent, normal };
  };
}

const ARCHES = {
  // k: curvature, zShift: where the midline sits, gap: space between teeth.
  upper: { k: 1 / 27, zShift: 0, gap: 0.12 },
  lower: { k: 1 / 23, zShift: -3.1, gap: 0.12 },
};

function shade(geometry, fn) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) colors.fill(fn(i), i * 3, i * 3 + 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/* Build ------------------------------------------------------------------------ */

// Place a tooth: origin on the arch at its neck, axes along the arch, up and
// out, then the torque and tip. Returns the matrix plus the neck height that
// brings the tip to the bite plane less `level`.
function toothMatrix(frame, spec, side, profile) {
  const tilt = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(spec.tip) * side)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(spec.torque)));
  const basis = new THREE.Matrix4().makeBasis(frame.tangent, new THREE.Vector3(0, 1, 0), frame.normal);
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(tilt);
  const tip = new THREE.Vector3(0, spec.H, profile(spec.H).z0).applyMatrix4(rotation);
  const neckY = -spec.level - tip.y;
  const matrix = new THREE.Matrix4()
    .makeTranslation(frame.point.x, neckY, frame.point.z)
    .multiply(basis)
    .multiply(rotation);
  return { matrix, rotation, neckY };
}

function buildArch(name, materials) {
  const spec = ARCHES[name];
  const at = archCurve(spec.k, spec.zShift);
  const ids = ROWS[name];

  // Lay the teeth out from the midline both ways.
  const teeth = ids.map((id, slot) => {
    const kind = KIND_BY_SLOT[slot];
    return { id, slot, kind, arch: name, spec: SPECS[name][kind] };
  });
  const placeSide = (list, dir) => {
    let s = 0;
    for (const tooth of list) {
      tooth.s = dir * (s + tooth.spec.W / 2 + spec.gap / 2);
      s += tooth.spec.W + spec.gap;
    }
    return s;
  };
  const halfLength = placeSide(teeth.slice(5), 1);
  placeSide(teeth.slice(0, 5).reverse(), -1);

  const group = new THREE.Group();
  group.name = name;

  for (const tooth of teeth) {
    const side = Math.sign(tooth.s); // -1 on the viewer's left
    tooth.profile = makeProfile(tooth.spec);
    tooth.frame = at(tooth.s);
    const placed = toothMatrix(tooth.frame, tooth.spec, side, tooth.profile);
    tooth.matrix = placed.matrix;
    tooth.rotation = placed.rotation;
    tooth.neckY = placed.neckY;

    // Out-of-mouth reach of the lip and tongue faces at height h, in the
    // arch frame (the gum hugs these).
    tooth.reach = (h, theta) => {
      const p = tooth.profile(h);
      const [x, z] = sectionPoint(p, theta);
      return new THREE.Vector3(x, h, z).applyMatrix4(tooth.rotation);
    };

    const heights = ringHeights(-5, tooth.spec.H, 30);
    const { geometry } = loft(tooth.profile, heights);
    const { H } = tooth.spec;
    shade(geometry, (i) => {
      const y = geometry.attributes.position.getY(i);
      const x = geometry.attributes.position.getX(i);
      const edge = Math.abs(x) / (tooth.spec.W / 2);
      const gum = GUM.zenith + (GUM.papilla - GUM.zenith) * Math.min(edge * edge, 1);
      const neck = 1 - smooth(gum - 0.4, gum + 2.6, y);
      const between = smooth(0.62, 1, edge) * (1 - smooth(0.55 * H, H, y));
      return 1 - 0.3 * neck - 0.16 * between;
    });
    // The holder carries the tooth's placement; the bare tooth and, later,
    // its cap sit in it side by side so either can hide.
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(tooth.matrix);
    const mesh = new THREE.Mesh(geometry, materials.tooth);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.toothId = tooth.id;
    holder.add(mesh);
    group.add(holder);
    tooth.holder = holder;
    tooth.mesh = mesh;
    // Crown only (no root), for framing a target box around it.
    const lab = tooth.profile(H * 0.3);
    tooth.crown = new THREE.Box3(
      new THREE.Vector3(-tooth.spec.W / 2, GUM.zenith, lab.z0 - lab.b),
      new THREE.Vector3(tooth.spec.W / 2, H, lab.z0 + lab.b),
    );
  }

  const gum = buildGum(teeth, at, halfLength, materials.gum);
  group.add(gum.mesh);
  const base = buildBase(teeth, at, gum, name, materials.base);
  group.add(base);

  return { group, teeth, at, halfLength, gumBottom: gum.bottom, baseBottom: gum.bottom - BASE_THICKNESS };
}

/* Gums ----------------------------------------------------------------------
   One sweep along the arch: a rounded ridge whose top edge scallops down
   around each tooth and peaks between them, hugging the necks. The heels are
   cut flat, the way a model trimmer leaves them. */

const BASE_THICKNESS = 6;

function buildGum(teeth, at, halfLength, material) {
  const sorted = [...teeth].sort((a, b) => a.s - b.s);
  const ext = 3.2;
  const sEnd = halfLength + ext;

  // Neck heights vary; the gum's bottom is one flat plane under them all.
  const lowestNeck = Math.min(...teeth.map((t) => t.neckY));
  const bottom = lowestNeck - 7.2;

  // Interpolated tooth data at arc length s.
  function sample(s) {
    let i = sorted.findIndex((t) => s < t.s);
    if (i === -1) i = sorted.length;
    const prev = sorted[Math.max(i - 1, 0)];
    const next = sorted[Math.min(i, sorted.length - 1)];
    const nearest = Math.abs(s - prev.s) < Math.abs(s - next.s) ? prev : next;
    const u = (s - nearest.s) / (nearest.spec.W / 2);
    const au = Math.min(Math.abs(u), 1.6);

    // Scallop: a parabola over each tooth, meeting its neighbour at a peak.
    const g = GUM.zenith + (GUM.papilla - GUM.zenith) * Math.min(au * au, 1) ** 0.85;

    // Neck height and reach blend across the contact.
    const other = u > 0 ? sorted[sorted.indexOf(nearest) + 1] : sorted[sorted.indexOf(nearest) - 1];
    const blend = other ? 0.5 * smooth(0.45, 1, au) : 0;
    const neckY = lerp(nearest.neckY, other ? other.neckY : nearest.neckY, blend);
    const reachOf = (tooth, theta) => {
      const p = tooth.reach(GUM.zenith + 0.4, theta);
      return p.z;
    };
    let lab = reachOf(nearest, Math.PI / 2);
    let lin = -reachOf(nearest, -Math.PI / 2);
    if (other) {
      lab = lerp(lab, reachOf(other, Math.PI / 2), blend);
      lin = lerp(lin, -reachOf(other, -Math.PI / 2), blend);
    }
    // The tooth surface curves away towards each contact; follow it in.
    const dip = smooth(0.55, 1, au);
    lab *= 1 - 0.16 * dip;
    lin *= 1 - 0.12 * dip;
    // Past the last tooth the ridge tapers into the heel.
    const heel = smooth(halfLength - 1, sEnd, Math.abs(s));
    return { g: lerp(g, GUM.papilla * 0.7, heel), neckY, lab, lin };
  }

  // Ridge cross-section, outward offset n against height y.
  function section(s) {
    const { g, neckY, lab, lin } = sample(s);
    const yM = neckY + g;
    const mid = lerp(yM, bottom, 0.45);
    return [
      [lab + 3.0, bottom],
      [lab + 2.7, lerp(bottom, mid, 0.5)],
      [lab + 2.1, mid],
      [lab + 1.1, yM - 1.7],
      [lab + 0.42, yM - 0.42],
      [lab - 0.3, yM + 0.12],
      [(lab - lin) / 2, yM + 0.45],
      [-lin + 0.3, yM + 0.12],
      [-lin - 0.42, yM - 0.42],
      [-lin - 1.1, yM - 1.7],
      [-lin - 2.0, mid],
      [-lin - 2.5, lerp(bottom, mid, 0.5)],
      [-lin - 2.8, bottom],
    ];
  }

  const along = 200;
  const across = 13;
  const positions = [];
  const shadeValues = [];
  for (let i = 0; i <= along; i++) {
    const s = -sEnd + (2 * sEnd * i) / along;
    const frame = at(s);
    const sec = section(s);
    const top = sec[6][1];
    for (const [n, y] of sec) {
      const p = frame.point.clone().addScaledVector(frame.normal, n);
      positions.push(p.x, y, p.z);
      // Darker into the crevices along the gum line and at the foot.
      shadeValues.push(1 - 0.22 * smooth(top - 2.4, top, y) - 0.18 * (1 - smooth(bottom, bottom + 1.6, y)));
    }
  }
  const index = [];
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < across - 1; j++) {
      const a = i * across + j;
      const b = a + 1;
      const c = a + across;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const colors = new Float32Array(shadeValues.length * 3);
  shadeValues.forEach((v, i) => colors.fill(v, i * 3, i * 3 + 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Flat heel faces, as separate geometry so they shade flat.
  const heels = [];
  for (const end of [0, along]) {
    const ring = [];
    for (let j = 0; j < across; j++) {
      const k = (end * across + j) * 3;
      ring.push(new THREE.Vector3(positions[k], positions[k + 1], positions[k + 2]));
    }
    const centre = ring.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(ring.length);
    // The section runs anticlockwise seen from -s, so the left heel keeps
    // that order and the right one reverses it to face out.
    for (let j = 0; j < across; j++) {
      const a = ring[j];
      const b = ring[(j + 1) % across];
      const tri = end === 0 ? [centre, a, b] : [centre, b, a];
      tri.forEach((p) => heels.push(p.x, p.y, p.z));
    }
  }
  const heelGeometry = new THREE.BufferGeometry();
  heelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(heels, 3));
  heelGeometry.computeVertexNormals();
  shade(heelGeometry, () => 0.92);

  const mesh = new THREE.Group();
  const ridge = new THREE.Mesh(geometry, material);
  const heel = new THREE.Mesh(heelGeometry, material);
  for (const m of [ridge, heel]) {
    m.castShadow = true;
    m.receiveShadow = true;
    mesh.add(m);
  }
  return { mesh, bottom, sEnd, sample };
}

/* Base ----------------------------------------------------------------------
   The trimmed block the arch stands on: flat faces, hard edges. Upper casts
   are trimmed to a point at the front, lower ones round. */

function buildBase(teeth, at, gum, archName, material) {
  const pointed = archName === 'upper';
  const top = gum.bottom + 0.9;
  const bottomY = gum.bottom - BASE_THICKNESS;
  const reachAt = (s) => {
    const { lab } = gum.sample(s);
    return lab + 5.2;
  };
  const stations = pointed ? [-1, -0.7, -0.38, 0, 0.38, 0.7, 1] : [-1, -0.72, -0.46, -0.2, 0.2, 0.46, 0.72, 1];
  const outline = stations.map((f) => {
    const s = f * gum.sEnd;
    const frame = at(s);
    const extra = pointed && f === 0 ? 2.4 : 0;
    const p = frame.point.clone().addScaledVector(frame.normal, reachAt(s) + extra);
    return new THREE.Vector2(p.x, p.z);
  });
  // Straight back edge: pull both heel corners to the same depth.
  const back = Math.min(outline[0].y, outline[outline.length - 1].y) - 1.5;
  outline[0].y = back;
  outline[outline.length - 1].y = back;

  const positions = [];
  const push = (a, b, c) => [a, b, c].forEach((p) => positions.push(p.x, p.y, p.z));
  const v = (p, y) => new THREE.Vector3(p.x, y, p.y);
  const centre = outline.reduce((sum, p) => sum.add(p), new THREE.Vector2()).divideScalar(outline.length);
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    // top and bottom fans (outline runs clockwise seen from above)
    push(v(centre, top), v(b, top), v(a, top));
    push(v(centre, bottomY), v(a, bottomY), v(b, bottomY));
    // side
    push(v(a, top), v(b, top), v(a, bottomY));
    push(v(b, top), v(b, bottomY), v(a, bottomY));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  // Fix winding if the outline turned out the other way round.
  const area = outline.reduce((sum, p, i) => {
    const q = outline[(i + 1) % n];
    return sum + (p.x * q.y - q.x * p.y);
  }, 0);
  if (area < 0) {
    const index = [];
    for (let i = 0; i < positions.length / 3; i += 3) index.push(i, i + 2, i + 1);
    geometry.setIndex(index);
    geometry.computeVertexNormals();
  }
  shade(geometry, () => 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/* Cast ----------------------------------------------------------------------- */

// Hinge, in the lower arch's space: behind and above the teeth, roughly
// where an articulator's would be.
export const HINGE = new THREE.Vector3(0, 26, -78);

export function buildCast(materials) {
  const upper = buildArch('upper', materials);
  const lower = buildArch('lower', materials);

  // Upper: crowns down, bite plane at y = 0.
  upper.group.scale.y = -1;

  // Lower: tips just above the upper incisal edges when closed (overbite),
  // swinging open about the hinge.
  const jaw = new THREE.Group();
  jaw.name = 'jaw';
  jaw.position.copy(HINGE);
  lower.group.position.set(0, 2.1, 0).sub(HINGE);
  jaw.add(lower.group);

  const root = new THREE.Group();
  root.add(upper.group, jaw);

  const teeth = new Map();
  for (const arch of [upper, lower]) {
    for (const tooth of arch.teeth) teeth.set(tooth.id, tooth);
  }
  return { root, jaw, upper, lower, teeth };
}

/* Caps ----------------------------------------------------------------------
   A cap is the crown's own surface pushed out along its normals, from just
   under the gum to over the tip. It carries, per vertex, the tooth-local x
   and h, the room to the side outline at that height and how much it faces
   the lip, which the cap shader cuts windows and facets from. */

export const CAP_OFFSET = 0.34;
export const FANG_LENGTH = 3.4;

export function capGeometry(tooth, fang = false) {
  const key = fang ? 'fangGeometry' : 'capGeometry';
  if (tooth[key]) return tooth[key];
  const extra = fang ? FANG_LENGTH : 0;
  const profile = fang ? makeProfile(tooth.spec, extra) : tooth.profile;
  const top = tooth.spec.H + extra;
  const heights = ringHeights(-0.6, top, fang ? 40 : 32);
  const { geometry, params } = loft(profile, heights);
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const face = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const h = position.getY(i);
    const theta = params[i * 2 + 1];
    const p = profile(Math.min(h, top));
    face[i * 4] = x;
    face[i * 4 + 1] = h;
    face[i * 4 + 2] = Math.max(p.a - Math.abs(x), 0);
    face[i * 4 + 3] = theta < 0 ? 0 : Math.sin(theta);
    position.setXYZ(
      i,
      x + normal.getX(i) * CAP_OFFSET,
      h + normal.getY(i) * CAP_OFFSET,
      position.getZ(i) + normal.getZ(i) * CAP_OFFSET,
    );
  }
  geometry.setAttribute('aFace', new THREE.BufferAttribute(face, 4));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  tooth[key] = geometry;
  return geometry;
}

// Where the lip face is at (x, h), on the cap, with its normal. Tooth-local.
export function capSurface(tooth, x, h) {
  const surface = (px, ph) => {
    const p = tooth.profile(ph);
    const u = clamp(Math.abs(px) / p.a, 0, 0.999);
    const z = p.z0 + p.b * Math.pow(1 - u ** p.n, 1 / p.n);
    return new THREE.Vector3(px, ph, z);
  };
  const e = 0.05;
  const point = surface(x, h);
  const dx = surface(x + e, h).sub(surface(x - e, h));
  const dh = surface(x, h + e).sub(surface(x, h - e));
  const normal = new THREE.Vector3().crossVectors(dx, dh).normalize();
  if (normal.z < 0) normal.negate();
  return { point: point.addScaledVector(normal, CAP_OFFSET), normal };
}

// Gum line height on a tooth, x across it (tooth-local mm).
export function gumLine(tooth, x) {
  const edge = Math.abs(x) / (tooth.spec.W / 2);
  return GUM.zenith + (GUM.papilla - GUM.zenith) * Math.min(edge * edge, 1) ** 0.85;
}

export { GUM };

/* Stones ---------------------------------------------------------------------- */

// Pavé: rows of stones packed across the lip face, inside the outline and
// above the gum line. Single: one stone up in the corner.
export function stoneSpots(tooth, kind) {
  const spots = [];
  const { H, W } = tooth.spec;
  if (kind === 'solo') {
    const x = -Math.sign(tooth.s || 1) * W * 0.16;
    const h = H * 0.64;
    const { point, normal } = capSurface(tooth, x, h);
    spots.push({ point, normal, size: Math.min(W * 0.34, 2.3) });
    return spots;
  }
  const size = tooth.arch === 'lower' ? 1.08 : 1.22;
  const pitch = size * 1.08;
  const rowStep = pitch * 0.88;
  let row = 0;
  for (let h = gumLine(tooth, 0) + 0.9; h < H - 0.55; h += rowStep, row++) {
    const p = tooth.profile(h);
    const room = p.a - size * 0.62;
    if (room <= 0) continue;
    const offset = row % 2 ? pitch / 2 : 0;
    for (let x = -Math.floor(room / pitch) * pitch - offset; x <= room + 1e-6; x += pitch) {
      if (Math.abs(x) > room) continue;
      if (h < gumLine(tooth, x) + 0.75) continue;
      const { point, normal } = capSurface(tooth, x, h);
      spots.push({ point, normal, size });
    }
  }
  return spots;
}

// A small brilliant: table, crown facets, girdle and pavilion. Diameter 1.
export function stoneGeometry() {
  const n = 8;
  const positions = [];
  const ring = (r, y, turn = 0) => Array.from({ length: n }, (_, i) => {
    const a = ((i + turn) / n) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  });
  const table = ring(0.27, 0.17);
  const star = ring(0.4, 0.1, 0.5);
  const girdle = ring(0.5, 0);
  const culet = new THREE.Vector3(0, -0.42, 0);
  const tableCentre = new THREE.Vector3(0, 0.17, 0);
  const tri = (a, b, c) => [a, b, c].forEach((p) => positions.push(p.x, p.y, p.z));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(tableCentre, table[j], table[i]);
    tri(table[i], table[j], star[i]);
    tri(table[i], star[i], girdle[i]);
    tri(star[i], table[j], girdle[j]);
    tri(girdle[i], star[i], girdle[j]);
    tri(girdle[i], girdle[j], culet);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
