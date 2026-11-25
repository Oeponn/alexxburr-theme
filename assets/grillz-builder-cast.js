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
// Like smooth, but its curvature eases in and out too, so polished metal
// shaped by it doesn't show a line in its reflections.
const smoother = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
// Rounded min: like min, but blended over k so there's no crease.
const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
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
// full width, rc: incisal corner radius. Cusps start at tc; ridge sets how
// long the sides stay wide before running in (higher is blunter), round how
// soft the tip is (1 is a sharp point), tipB how deep the tip stays and drop
// how far the tongue side falls away below it. torque tips the crown out of
// the mouth, tip leans it towards the midline (degrees). level: how far
// short of the bite plane the tip stops.
const SPECS = {
  upper: {
    central: { form: 'incisor', W: 8.6, H: 10.6, D: 7.0, cerv: 0.7, tw: 0.58, rc: 1.25, torque: 13, tip: 4, level: 0 },
    lateral: { form: 'incisor', W: 6.6, H: 9.0, D: 6.0, cerv: 0.66, tw: 0.56, rc: 1.7, torque: 11, tip: 7, level: 0.7 },
    canine: { form: 'canine', W: 7.6, H: 10.2, D: 8.0, cerv: 0.7, tw: 0.5, tc: 0.6, ridge: 1.1, round: 1.3, tipB: 0.6, drop: 1.2, torque: 6, tip: 8, level: 0.1 },
    pm1: { form: 'premolar', W: 7.0, H: 8.4, D: 9.0, cerv: 0.74, tw: 0.6, tc: 0.68, ridge: 1.5, round: 1.8, tipB: 0.8, drop: 2.0, torque: -3, tip: 4, level: 0.5 },
    pm2: { form: 'premolar', W: 6.6, H: 7.6, D: 9.0, cerv: 0.76, tw: 0.6, tc: 0.68, ridge: 1.6, round: 1.9, tipB: 0.8, drop: 1.6, torque: -4, tip: 3, level: 0.8 },
  },
  lower: {
    central: { form: 'incisor', W: 5.3, H: 9.0, D: 5.8, cerv: 0.68, tw: 0.62, rc: 0.7, torque: 9, tip: 1, level: 0 },
    lateral: { form: 'incisor', W: 5.9, H: 9.4, D: 6.2, cerv: 0.66, tw: 0.62, rc: 0.9, torque: 9, tip: 2, level: 0 },
    canine: { form: 'canine', W: 6.9, H: 10.2, D: 7.6, cerv: 0.7, tw: 0.5, tc: 0.62, ridge: 1.1, round: 1.3, tipB: 0.6, drop: 1.0, torque: 4, tip: 5, level: 0.1 },
    pm1: { form: 'premolar', W: 7.0, H: 8.4, D: 7.6, cerv: 0.74, tw: 0.6, tc: 0.68, ridge: 1.5, round: 1.8, tipB: 0.8, drop: 2.2, torque: -3, tip: 3, level: 0.6 },
    pm2: { form: 'premolar', W: 7.1, H: 8.0, D: 8.0, cerv: 0.76, tw: 0.6, tc: 0.68, ridge: 1.6, round: 1.9, tipB: 0.8, drop: 1.4, torque: -5, tip: 3, level: 0.9 },
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
      // Cusp: the sides run in over a soft, rounded tip (no flat end) and
      // the tongue side falls away below it.
      const c = smooth(spec.tc, 1, u);
      if (u > spec.tc) {
        const v = (u - spec.tc) / (1 - spec.tc);
        a *= Math.pow(Math.max(1 - Math.pow(v, spec.ridge), 0), 1 / spec.round);
      }
      a = Math.max(a, 0.02);
      b *= lerp(1, spec.tipB, c);
      drop = spec.drop * c;
    }
    return { a, z0: (zl + zg) / 2, b, n: lerp(form.n0, form.n1, u), drop };
  };
}

// A fang is a cap that keeps going. It follows the tooth down to where the
// crown starts to narrow (the incisal corners, or a cusp's shoulders), then
// runs on past the natural tip and in to a rounded point. On an incisor it
// makes a shark tooth.
//
// The outline is a single smooth curve, so the metal shows no crease where
// the point starts: it leaves the crown flat, at full width, curves in along
// an S, and arrives at the point at a real angle, where a small round end
// takes over (a point drawn out to a needle would balloon once the cap is
// thickened). The curve bends more gently than the crown's own corners, so
// it stays outside the tooth everywhere (checked when the cast is built).
const FANG_REACH = (spec) => clamp(spec.H * 0.44, 3.6, 4.8); // to where the sides would meet (mm)
const FANG_TIP = 0.3; // radius of the rounded point (mm)

// A curve from p0 to p1 over t in [0, 1] with set slopes (m) and bends (k)
// at both ends: a quintic Hermite, so it can pick up a surface's curvature as
// well as its slope and leave no line in a reflection.
function hermite5(p0, m0, k0, p1, m1, k1) {
  const A = p1 - p0 - m0 - k0 / 2;
  const B = m1 - m0 - k0;
  const C = k1 - k0;
  const c3 = 10 * A - 4 * B + C / 2;
  const c4 = -15 * A + 7 * B - C;
  const c5 = 6 * A - 3 * B + C / 2;
  return (t) => p0 + t * (m0 + t * (k0 / 2 + t * (c3 + t * (c4 + t * c5))));
}

function fangProfile(spec) {
  const base = baseProfile(spec);
  const { H } = spec;
  const incisor = spec.form === 'incisor';
  const h0 = incisor ? H - spec.rc : spec.tc * H;
  const point = H + FANG_REACH(spec);
  const span = point - h0;
  const start = base(h0);
  const edge = base(H);

  // Front view, the width: 1 at the start (flat), 0 at the point, meeting it
  // at a slope of -0.5 (in units of the span) rather than head on. A hair
  // wider than the crown (PAD), since the fang is deeper than the crown and
  // centred a little off it, and a section the same width would clip its
  // sides.
  const PAD = 0.06;
  const taper = (v) => 1 - 2.5 * v * v + 1.5 * v * v * v;
  const taperSlope = (v) => -5 * v + 4.5 * v * v;
  const width = (h) => (start.a + PAD) * taper(clamp((h - h0) / span, 0, 1));
  const widthSlope = (h) => ((start.a + PAD) * taperSlope(clamp((h - h0) / span, 0, 1))) / span;

  // Side view, the lip and tongue faces: each leaves the crown with its
  // height, slope and bend, and runs on into the point (a touch towards the
  // tongue from the incisal edge) as one smooth curve. The lip face, the one
  // that catches the light, has to bend one way only all the way down, or
  // its reflections break into a bar that reads as a groove; it leaves the
  // crown as low as that allows (searched for), so the cap hugs the tooth
  // for as long as it can.
  const lip = (h) => { const p = base(h); return p.z0 + p.b; };
  const tongue = (h) => { const p = base(h); return p.z0 - p.b; };
  const tipZ = edge.z0 - 0.3;
  const leave = (face, from, endSlope) => {
    const S = point - from;
    const e = 0.02;
    const v0 = face(from);
    const slope = (face(from + e) - face(from - e)) / (2 * e);
    const bend = (face(from + e) - 2 * v0 + face(from - e)) / (e * e);
    const chord = (tipZ - v0) / S;
    const curve = hermite5(v0, slope * S, bend * S * S, tipZ, endSlope(chord) * S, 0);
    return (h) => curve((h - from) / S);
  };
  const lipEnd = (chord) => chord * 1.5;
  const tongueEnd = (chord) => Math.max(chord * 1.5, 0.25);
  let hd = 0.35 * H;
  for (let u = 0.8; u >= 0.35; u -= 0.025) {
    const from = u * H;
    const front = leave(lip, from, lipEnd);
    const back = leave(tongue, from, tongueEnd);
    let ok = true;
    for (let h = from + 0.02; h < point - 0.02 && ok; h += 0.02) {
      const bendHere = (front(h + 0.02) - 2 * front(h) + front(h - 0.02)) / 0.0004;
      if (bendHere > 0.02) ok = false;
      if (h <= H && (front(h) < lip(h) || back(h) > tongue(h))) ok = false;
    }
    if (ok) {
      hd = from;
      break;
    }
  }
  const front = leave(lip, hd, lipEnd);
  const back = leave(tongue, hd, tongueEnd);

  // The round end: a circle on the axis that meets the sides tangentially.
  let lo = h0 + span * 0.5;
  let hi = point;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (width(mid) * Math.hypot(1, widthSlope(mid)) > FANG_TIP) lo = mid;
    else hi = mid;
  }
  const tangent = lo;
  const centre = tangent + width(tangent) * widthSlope(tangent);
  const end = centre + FANG_TIP;
  const tipAspect = ((front(tangent) - back(tangent)) / 2) / width(tangent);

  // The pad eases in over at least 1.6 mm before the taper starts.
  const ease = Math.min(hd, h0 - 1.6);

  const profile = (h) => {
    const natural = base(Math.min(h, H));
    if (h <= ease) return natural;
    // Width: the crown's own (easing out to the pad) until the fang starts to
    // narrow, flat and level with it there, then the taper, then the round
    // end.
    let a = natural.a + PAD * smoother(ease, h0, h);
    if (h > h0) a = h < tangent ? width(h) : Math.sqrt(Math.max(FANG_TIP * FANG_TIP - (h - centre) ** 2, 0));
    const lipZ = h <= hd ? natural.z0 + natural.b : front(Math.min(h, point));
    const tongueZ = h <= hd ? natural.z0 - natural.b : back(Math.min(h, point));
    let b = (lipZ - tongueZ) / 2;
    if (h >= tangent) b = a * tipAspect;
    return {
      a: Math.max(a, 0.004),
      b: Math.max(b, 0.004),
      z0: (lipZ + tongueZ) / 2,
      // Same squareness as the tooth while it's inside (so bigger means
      // around it); past the tip, round.
      n: h <= H ? natural.n : lerp(edge.n, 2, smoother(H, end, h)),
      drop: natural.drop * (1 - smoother(hd, hd + 1.4, h)),
    };
  };

  // Rings: the crown and sides, then even steps round the end.
  const heights = ringHeights(-0.6, tangent, 50);
  const from = Math.asin(clamp((tangent - centre) / FANG_TIP, -1, 1));
  for (let i = 1; i <= 7; i++) heights.push(centre + FANG_TIP * Math.sin(lerp(from, Math.PI / 2, i / 7)));
  return { profile, end, heights, leaves: hd };
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
  // The top closes on the middle of the last ring, domed a little if that
  // ring is still wide (an incisal edge) and flush if it has come to a point.
  const top = bottom + 1;
  const pt = profile(heights[rings - 1]);
  const centre = [0, 0, 0];
  for (let j = 0; j < SEGMENTS; j++) {
    for (let k = 0; k < 3; k++) centre[k] += positions[((rings - 1) * SEGMENTS + j) * 3 + k] / SEGMENTS;
  }
  positions.push(centre[0], centre[1] + Math.min(pt.a, pt.b, 0.3) * 0.4, centre[2]);
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
    tooth.profile = baseProfile(tooth.spec);
    const fang = fangProfile(tooth.spec);
    tooth.fangProfile = fang.profile;
    tooth.fangHeights = fang.heights;
    tooth.fangLeaves = fang.leaves; // where its lip face leaves the crown
    tooth.fangLength = fang.end - tooth.spec.H; // how far past the natural tip it reaches
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
  return { mesh, bottom, sEnd, sample, positions, rows: along + 1, across };
}

/* Base ----------------------------------------------------------------------
   The trimmed block the arch stands on: flat faces, hard edges, the way a
   model trimmer leaves it. Upper casts are trimmed to a point at the front,
   lower ones rounder. Each face is a straight cut set just clear of the
   gum's foot, so the whole gum stands on the block (its underside is open,
   so nothing may hang over an edge). */

// Cut directions, in degrees round from straight out of the mouth (+z).
const TRIMS = {
  upper: [26, -26, 62, -62, 90, -90, 122, -122, 180],
  lower: [0, 22, -22, 44, -44, 66, -66, 90, -90, 122, -122, 180],
};

// Clip a convex polygon (x, z pairs) to the side of a line n . p <= d.
function clipPolygon(polygon, n, d) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const dp = p[0] * n[0] + p[1] * n[1] - d;
    const dq = q[0] * n[0] + q[1] * n[1] - d;
    if (dp <= 0) out.push(p);
    if ((dp <= 0) !== (dq <= 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

function buildBase(teeth, at, gum, archName, material) {
  const pointed = archName === 'upper';
  const top = gum.bottom + 0.9;
  const bottomY = gum.bottom - BASE_THICKNESS;

  // The gum's footprint: both feet all along the ridge, heels included.
  const foot = [];
  for (const j of [0, gum.across - 1]) {
    for (let i = 0; i < gum.rows; i++) {
      const k = (i * gum.across + j) * 3;
      foot.push([gum.positions[k], gum.positions[k + 2]]);
    }
  }
  // Each cut sits a little outside the furthest point of the foot that way.
  // The upper cast's front cuts sit further out, so they meet in a point.
  let outline = [[-500, -500], [500, -500], [500, 500], [-500, 500]];
  for (const degrees of TRIMS[archName]) {
    const angle = THREE.MathUtils.degToRad(degrees);
    const n = [Math.sin(angle), Math.cos(angle)];
    const reach = Math.max(...foot.map((p) => p[0] * n[0] + p[1] * n[1]));
    const pad = pointed && Math.abs(degrees) === 26 ? 3.2 : 1.8;
    outline = clipPolygon(outline, n, reach + pad);
  }
  // Drop repeated and in-line corners the cuts can leave.
  const close = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3;
  let corners = outline.filter((p, i) => !close(p, outline[(i + 1) % outline.length]));
  corners = corners.filter((p, i) => {
    const a = corners[(i - 1 + corners.length) % corners.length];
    const b = corners[(i + 1) % corners.length];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-6;
  });

  const geometry = easedBlock(corners, bottomY, top, BASE_EDGE);
  shade(geometry, () => 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// How far the base's edges are eased (mm): just enough to catch the light.
const BASE_EDGE = 0.7;

// A block on a convex outline (x, z corners), from y0 to y1, with every edge
// eased: the outline grown by r all round and rounded over at the top and
// bottom, the way a trimmed cast's edges wear soft. Flat faces stay flat;
// only the edges curve, with normals worked out exactly (each point sits r
// from the outline's prism, so its normal points straight away from it).
function easedBlock(corners, y0, y1, r) {
  const n = corners.length;
  const centroid = corners.reduce((sum, p) => [sum[0] + p[0] / n, sum[1] + p[1] / n], [0, 0]);
  // Outward normal of each side, from corner i to i + 1.
  const sides = corners.map((p, i) => {
    const q = corners[(i + 1) % n];
    let nx = q[1] - p[1];
    let nz = p[0] - q[0];
    const length = Math.hypot(nx, nz);
    nx /= length;
    nz /= length;
    if (nx * ((p[0] + q[0]) / 2 - centroid[0]) + nz * ((p[1] + q[1]) / 2 - centroid[1]) < 0) {
      nx = -nx;
      nz = -nz;
    }
    return [nx, nz];
  });
  // Round each ring: at every corner an arc from the side before's normal to
  // the side after's (the shorter way; the outline is convex).
  const ARC = 6;
  const around = [];
  for (let i = 0; i < n; i++) {
    const before = sides[(i - 1 + n) % n];
    const after = sides[i];
    const from = Math.atan2(before[1], before[0]);
    let turn = Math.atan2(after[1], after[0]) - from;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    for (let k = 0; k <= ARC; k++) {
      const a = from + (turn * k) / ARC;
      around.push([i, Math.cos(a), Math.sin(a)]);
    }
  }
  // Up the block: round over the bottom edge, up the flat sides, round over
  // the top edge. Each ring: height, how far out it stands, and its normal's
  // up and out parts.
  const STEPS = 5;
  const rings = [];
  for (let k = 0; k <= STEPS; k++) {
    const phi = -Math.PI / 2 + ((Math.PI / 2) * k) / STEPS;
    rings.push([y0 + r + r * Math.sin(phi), r * Math.cos(phi), Math.sin(phi), Math.cos(phi)]);
  }
  for (let k = 0; k <= STEPS; k++) {
    const phi = ((Math.PI / 2) * k) / STEPS;
    rings.push([y1 - r + r * Math.sin(phi), r * Math.cos(phi), Math.sin(phi), Math.cos(phi)]);
  }

  const positions = [];
  const normals = [];
  for (const [y, out, up, side] of rings) {
    for (const [i, dx, dz] of around) {
      positions.push(corners[i][0] + dx * out, y, corners[i][1] + dz * out);
      normals.push(dx * side, up, dz * side);
    }
  }
  const N = around.length;
  const bottomCentre = positions.length / 3;
  positions.push(centroid[0], y0, centroid[1]);
  normals.push(0, -1, 0);
  const topCentre = bottomCentre + 1;
  positions.push(centroid[0], y1, centroid[1]);
  normals.push(0, 1, 0);

  const index = [];
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < N; j++) {
      const a = k * N + j;
      const b = k * N + ((j + 1) % N);
      index.push(a, b, a + N, b, b + N, a + N);
    }
  }
  const last = (rings.length - 1) * N;
  for (let j = 0; j < N; j++) {
    index.push(bottomCentre, (j + 1) % N, j);
    index.push(topCentre, last + j, last + ((j + 1) % N));
  }
  // Wind every triangle to face the way its normals do.
  const at = (i) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  const along = (i) => new THREE.Vector3(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
  for (let t = 0; t < index.length; t += 3) {
    const [ia, ib, ic] = [index[t], index[t + 1], index[t + 2]];
    const face = new THREE.Vector3().crossVectors(at(ib).sub(at(ia)), at(ic).sub(at(ia)));
    if (face.dot(along(ia).add(along(ib)).add(along(ic))) < 0) {
      index[t + 1] = ic;
      index[t + 2] = ib;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  return geometry;
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
   A cap is the crown's own surface (or the fang's) pushed out along its
   normals, from just under the gum to over the tip. It carries, per vertex,
   the tooth-local x and h, the room to the side outline at that height and
   how much it faces the lip, which the cap shader cuts windows and facets
   from. */

export const CAP_OFFSET = 0.34;

const profileOf = (tooth, fang) => (fang ? tooth.fangProfile : tooth.profile);
const capTop = (tooth, fang) => tooth.spec.H + (fang ? tooth.fangLength : 0);
// How thick the cap stands off the surface it follows: CAP_OFFSET over the
// tooth, thinning past the natural tip of a fang, where there's no tooth left
// to cover, so the point stays a point.
const capOffset = (tooth, fang, h) => (fang
  ? CAP_OFFSET * (1 - 0.45 * smoother(tooth.spec.H, tooth.spec.H + tooth.fangLength, h))
  : CAP_OFFSET);

export function capGeometry(tooth, fang = false) {
  const key = fang ? 'fangGeometry' : 'capGeometry';
  if (tooth[key]) return tooth[key];
  const profile = profileOf(tooth, fang);
  const top = capTop(tooth, fang);
  const heights = fang ? tooth.fangHeights : ringHeights(-0.6, top, 32);
  const { geometry, params } = loft(profile, heights);
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const face = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const h = position.getY(i);
    const theta = params[i * 2 + 1];
    const p = profile(clamp(h, -0.6, top));
    face[i * 4] = x;
    face[i * 4 + 1] = h;
    face[i * 4 + 2] = Math.max(p.a - Math.abs(x), 0);
    face[i * 4 + 3] = theta < 0 ? 0 : Math.sin(theta);
    const offset = capOffset(tooth, fang, params[i * 2]);
    position.setXYZ(
      i,
      x + normal.getX(i) * offset,
      h + normal.getY(i) * offset,
      position.getZ(i) + normal.getZ(i) * offset,
    );
  }
  geometry.setAttribute('aFace', new THREE.BufferAttribute(face, 4));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  tooth[key] = geometry;
  return geometry;
}

// Where the lip face is at (x, h), on the cap, with its normal. Tooth-local.
export function capSurface(tooth, x, h, fang = false) {
  const profile = profileOf(tooth, fang);
  const surface = (px, ph) => {
    const p = profile(ph);
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
  return { point: point.addScaledVector(normal, capOffset(tooth, fang, h)), normal };
}

// Gum line height on a tooth, x across it (tooth-local mm).
export function gumLine(tooth, x) {
  const edge = Math.abs(x) / (tooth.spec.W / 2);
  return GUM.zenith + (GUM.papilla - GUM.zenith) * Math.min(edge * edge, 1) ** 0.85;
}

export { GUM };

/* Looks ----------------------------------------------------------------------
   A tooth's design is a cut (solid, heart, star, diamond, iced or solo) plus
   two switches, fang and open face. capLook turns that into what the cap
   needs: its shape, the window in its lip face (open face, heart or star)
   and the frame round it, the finish, and where any stones sit. Windows are
   measured in mm on the lip face. The cap shader cuts them from the same
   numbers (see CAP_PARS in grillz-builder.js, which mirrors holeDistance),
   and stones keep clear of them. */

const HEART_LIFT = 0.55;
const STAR = [0.62, 0.42];

function heartDistance(x, y) {
  const px = Math.abs(x);
  if (y + px > 1) return Math.hypot(px - 0.25, y - 0.75) - Math.SQRT2 / 4;
  const m = 0.5 * Math.max(px + y, 0);
  return Math.sqrt(Math.min(px * px + (y - 1) ** 2, (px - m) ** 2 + (y - m) ** 2)) * Math.sign(px - y);
}

function starDistance(x, y, r, rf) {
  const k1 = [0.809016994375, -0.587785252292];
  const k2 = [-k1[0], k1[1]];
  let px = Math.abs(x);
  let py = y;
  let d = 2 * Math.max(k1[0] * px + k1[1] * py, 0);
  px -= d * k1[0];
  py -= d * k1[1];
  d = 2 * Math.max(k2[0] * px + k2[1] * py, 0);
  px -= d * k2[0];
  py -= d * k2[1];
  px = Math.abs(px);
  py -= r;
  const ba = [rf * -k1[1] - 0, rf * k1[0] - 1];
  const t = clamp((px * ba[0] + py * ba[1]) / (ba[0] * ba[0] + ba[1] * ba[1]), 0, r);
  return Math.hypot(px - ba[0] * t, py - ba[1] * t) * Math.sign(py * ba[0] - px * ba[1]);
}

// Distance from the window's edge at (x, h) on the lip face, in mm: negative
// inside the window (no metal). `room` is the distance to the side outline.
function holeDistance(look, x, h, room) {
  if (look.window === 1) {
    const [zenith, papilla, half, crown] = look.gum;
    const [side, gumBand, edgeBand, corner] = look.frame;
    const edge = clamp(Math.abs(x) / half, 0, 1);
    const gum = zenith + (papilla - zenith) * (edge * edge) ** 0.85;
    return -smin(smin(room - side, crown - edgeBand - h, corner), h - (gum + gumBand), corner);
  }
  if (look.window > 1) {
    const [centre, scale, up] = look.shape;
    const px = x / scale;
    const py = ((h - centre) * up) / scale;
    const d = look.window === 2 ? heartDistance(px, py + HEART_LIFT) : starDistance(px, py, ...STAR);
    return d * scale;
  }
  return 1e3;
}

export function capLook(tooth, { cut, fang = false, open = false }) {
  const { H, W } = tooth.spec;
  const zenith = gumLine(tooth, 0);
  // Open face frame: side, gum and edge bands, then the window's corner
  // radius (mm). Iced frames are wider to hold a row of stones, and a solo
  // stone gets a deeper bar along the edge to sit in (unless a fang has
  // room for it).
  let frame = [0.95, 1.05, 1.1, 1.8];
  if (open && cut === 'iced') frame = [1.75, 1.85, 1.9, 2.2];
  if (open && cut === 'solo' && !fang) frame = [0.95, 1.05, 3.2, 1.8];
  const look = {
    cut,
    fang,
    open,
    window: open ? 1 : { heart: 2, star: 3 }[cut] || 0,
    finish: cut === 'diamond' ? 1 : 0,
    gum: [GUM.zenith, GUM.papilla, W / 2, H],
    frame,
    // Heart / star: centre height, scale, which way is up on screen.
    shape: [(zenith + H) / 2 + 0.15, Math.min(W * 0.34, (H - zenith) * 0.31), tooth.arch === 'upper' ? -1 : 1, 0],
  };
  look.stones = cut === 'iced' || cut === 'solo' ? layStones(tooth, look) : [];
  return look;
}

/* Stones ---------------------------------------------------------------------- */

const PAVE = { upper: 1.22, lower: 1.08 };

function layStones(tooth, look) {
  const { H, W } = tooth.spec;
  const profile = profileOf(tooth, look.fang);
  const top = capTop(tooth, look.fang);
  const spot = (x, h, size) => ({ x, h, size, ...capSurface(tooth, x, h, look.fang) });
  // A stone fits at (x, h) if it's on metal: clear of the gum, the window and
  // the outline.
  const fits = (x, h, size) => {
    const r = size / 2;
    if (h < gumLine(tooth, x) + r + 0.25 || h > top - r - 0.3) return false;
    const room = profile(h).a - Math.abs(x);
    return room > r * 1.15 && holeDistance(look, x, h, room) > r + 0.2;
  };

  if (look.cut === 'solo') {
    // One stone, in the first place it fits: up in the corner, in a bar
    // under an open face, or down in a fang.
    const size = Math.min(W * 0.34, 2.3);
    const side = -Math.sign(tooth.s || 1) * W * 0.16;
    const inFang = [0, H + tooth.fangLength * 0.22];
    const places = [];
    if (look.fang && look.window) places.push(inFang);
    places.push([side, H * 0.64]);
    if (look.open) places.push([0, H - look.frame[2] / 2]);
    places.push([0, H - size / 2 - 0.7], [side, H - size / 2 - 0.8]);
    if (look.fang) places.push(inFang);
    for (const [x, h] of places) {
      for (const size2 of [size, size * 0.8, size * 0.64]) {
        if (fits(x, h, size2)) return [spot(x, h, size2)];
      }
    }
    return [];
  }

  // Iced.
  const size = PAVE[tooth.arch];
  const pitch = size * 1.08;
  const stones = [];
  if (look.open) {
    // A single row round the frame, along the middle of the band.
    const loop = frameLoop(tooth, look, profile, size);
    const at = loop.map(([x, h]) => capSurface(tooth, x, h, look.fang).point);
    const length = [0];
    for (let i = 1; i <= loop.length; i++) length.push(length[i - 1] + at[i % loop.length].distanceTo(at[i - 1]));
    const total = length[loop.length];
    const count = Math.floor(total / pitch);
    let k = 0;
    for (let n = 0; n < count; n++) {
      const target = (n * total) / count;
      while (length[k + 1] < target) k++;
      const f = (target - length[k]) / (length[k + 1] - length[k] || 1);
      const [x0, h0] = loop[k];
      const [x1, h1] = loop[(k + 1) % loop.length];
      stones.push(spot(lerp(x0, x1, f), lerp(h0, h1, f), size));
    }
  }
  // Pave: offset rows packed over the rest of the face (all of it, unless
  // there's a window or a frame row already).
  const rowStep = pitch * 0.88;
  let row = 0;
  for (let h = gumLine(tooth, 0) + 0.9; h < top - 0.55; h += rowStep, row++) {
    const p = profile(h);
    const room = p.a - size * 0.62;
    if (room <= 0) continue;
    const offset = row % 2 ? pitch / 2 : 0;
    for (let x = -Math.floor(room / pitch) * pitch - offset; x <= room + 1e-6; x += pitch) {
      if (Math.abs(x) > room || h < gumLine(tooth, x) + 0.75) continue;
      if (holeDistance(look, x, h, p.a - Math.abs(x)) < size / 2 + 0.2) continue;
      if (stones.some((s) => Math.hypot(s.x - x, s.h - h) < pitch * 0.95)) continue;
      stones.push(spot(x, h, size));
    }
  }
  return stones;
}

// The middle of an open face's frame, as a loop on the lip face: up one
// side, along the edge, down the other side and back along the gum.
function frameLoop(tooth, look, profile, size) {
  const [side, gumBand, edgeBand] = look.frame;
  const sideX = (h) => profile(h).a - side / 2;
  const gumH = (x) => gumLine(tooth, x) + gumBand / 2;
  // Where each side meets the gum band.
  let low = gumH(sideX(tooth.spec.H / 2));
  for (let i = 0; i < 4; i++) low = gumH(sideX(low));
  // The edge band, or as high as the sides stay apart on a cusp.
  let high = tooth.spec.H - edgeBand / 2;
  while (high > low + 1 && sideX(high) < size * 0.55) high -= 0.1;
  const steps = 40;
  const loop = [];
  for (let i = 0; i <= steps; i++) {
    const h = lerp(low, high, i / steps);
    loop.push([-sideX(h), h]);
  }
  const xe = sideX(high);
  for (let i = 1; i < steps; i++) loop.push([lerp(-xe, xe, i / steps), high]);
  for (let i = 0; i <= steps; i++) {
    const h = lerp(high, low, i / steps);
    loop.push([sideX(h), h]);
  }
  const xg = sideX(low);
  for (let i = 1; i < steps; i++) {
    const x = lerp(xg, -xg, i / steps);
    loop.push([x, gumH(x)]);
  }
  return loop;
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
