// Footer ocean: live water along the top edge of the black footer bar.
//
// A 1D spring-column wave sim (each column springs back to rest and passes
// energy to its neighbours), a slow two-sine swell on top, and spray
// droplets that arc out on hard splashes and ripple the surface where they
// land. Drawn on a transparent canvas that rises out of the bar over the base
// of the wordmark, in the bar's own black.
//
// Disturbances: the pointer moving through the water, taps or clicks
// (splash), page scrolling (sloshes in from the edges), and an occasional
// ambient drop. It only runs while the footer is on screen. With reduced
// motion it draws one still frame and does not animate.
(function () {
  'use strict';

  var INK = '#111';
  var BACK = '#3a3a3a';
  var STEP = 1000 / 60;

  // Spring sim tuning (per 60 Hz step; heights in CSS px, + is up).
  var K = 0.022;       // pull back to rest
  var DAMP = 0.018;    // energy loss
  var SPREAD = 0.24;   // share passed to neighbours each pass
  var PASSES = 6;
  var GRAVITY = 0.32;  // spray

  function init(shore) {
    if (!shore || shore.dataset.seaReady) return;
    var canvas = shore.querySelector('[data-sea-canvas]');
    var wordmark = shore.querySelector('.site-footer__wordmark');
    if (!canvas || !canvas.getContext) return;
    shore.dataset.seaReady = 'true';

    var ctx = canvas.getContext('2d');
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var W = 0, H = 0, dpr = 1, gap = 8, rest = 20, maxH = 40;
    var h = [], v = [], l = [], r = [];
    var drops = [];
    var t = 0, acc = 0, last = 0, raf = 0, visible = false, nextDrop = 0;
    var lastScroll = window.pageYOffset;
    var lastPointer = null;

    function n() { return h.length; }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      if (!W || !H) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Rest level: high enough to sink the base of the letters a little.
      // Unsteady Oversteer sits ~0.09em of line box under its baseline and
      // has a 0.59em cap height; sit just over the baseline so the waves lap
      // the bottom strokes without hiding them.
      var fs = wordmark ? parseFloat(getComputedStyle(wordmark).fontSize) || 60 : 60;
      rest = Math.max(3, Math.min(fs * (W < 750 ? 0.085 : 0.11), H * 0.3));
      maxH = H - rest - 4;
      gap = W < 750 ? 6 : 8;

      // Resample the old surface onto the new column count.
      var count = Math.ceil(W / gap) + 1;
      var oh = h, ov = v;
      h = new Array(count); v = new Array(count); l = new Array(count); r = new Array(count);
      for (var i = 0; i < count; i++) {
        var j = oh.length ? Math.min(oh.length - 1, Math.round(i * (oh.length - 1) / Math.max(1, count - 1))) : 0;
        h[i] = oh.length ? oh[j] : 0;
        v[i] = ov.length ? ov[j] : 0;
      }
      draw();
    }

    function col(x) {
      return Math.max(0, Math.min(n() - 1, Math.round(x / gap)));
    }

    // Push the surface at x: + raises, - pushes down. Wide pushes spread over
    // a few columns so the wave has a body, not a spike.
    function disturb(x, force, width) {
      var c = col(x);
      var w = width || 2;
      for (var k = -w; k <= w; k++) {
        var i = c + k;
        if (i < 0 || i >= n()) continue;
        v[i] += force * (1 - Math.abs(k) / (w + 1));
      }
    }

    function splash(x, force) {
      disturb(x, force, 3);
      var count = Math.min(26, Math.round(Math.abs(force) * 1.1));
      for (var k = 0; k < count; k++) {
        drops.push({
          x: x + (Math.random() - 0.5) * gap * 4,
          y: surfaceY(x),
          vx: (Math.random() - 0.5) * 4.5,
          vy: -(2.5 + Math.random() * Math.abs(force) * 0.55),
          s: 2 + Math.round(Math.random() * 3)
        });
      }
    }

    function swell(x) {
      var amp = W < 750 ? 1 : 1.8;
      return amp * (Math.sin(x * 0.011 - t * 0.0011) * 1.4 + Math.sin(x * 0.027 + t * 0.0017) * 0.7);
    }

    // Height of the water at x, measured in canvas px from the top.
    function surfaceY(x) {
      var i = col(x);
      return H - rest - (h[i] || 0) - swell(x);
    }

    function step() {
      var i, p, count = n();
      for (i = 0; i < count; i++) {
        v[i] += -K * h[i] - DAMP * v[i];
        h[i] += v[i];
        if (h[i] > maxH) { h[i] = maxH; v[i] *= -0.3; }
        if (h[i] < -rest) { h[i] = -rest; v[i] *= -0.3; }
      }
      for (p = 0; p < PASSES; p++) {
        for (i = 0; i < count; i++) {
          if (i > 0) { l[i] = SPREAD * (h[i] - h[i - 1]); v[i - 1] += l[i]; }
          if (i < count - 1) { r[i] = SPREAD * (h[i] - h[i + 1]); v[i + 1] += r[i]; }
        }
        for (i = 0; i < count; i++) {
          if (i > 0) h[i - 1] += l[i];
          if (i < count - 1) h[i + 1] += r[i];
        }
      }

      // Spray: fall, and ripple the surface where each drop lands.
      for (i = drops.length - 1; i >= 0; i--) {
        var d = drops[i];
        d.vy += GRAVITY;
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0 || d.x > W) { drops.splice(i, 1); continue; }
        if (d.vy > 0 && d.y >= surfaceY(d.x)) {
          disturb(d.x, -d.s * 0.45, 1);
          drops.splice(i, 1);
        }
      }

      // Ambient: an occasional drop somewhere along the surface.
      if (t > nextDrop) {
        disturb(Math.random() * W, -(1.5 + Math.random() * 3), 2);
        nextDrop = t + 700 + Math.random() * 1600;
      }
      t += STEP;
    }

    function path(offset, scale, shift) {
      var count = n();
      ctx.beginPath();
      ctx.moveTo(0, H);
      var px = 0, py = H - rest - offset - h[0] * scale - swell(shift);
      ctx.lineTo(0, py);
      for (var i = 1; i < count; i++) {
        var x = i * gap;
        var j = Math.min(count - 1, Math.max(0, i + Math.round(shift / gap)));
        var y = H - rest - offset - h[j] * scale - swell(x + shift);
        ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        px = x; py = y;
      }
      ctx.lineTo(W, py);
      ctx.lineTo(W, H);
      ctx.closePath();
    }

    function draw() {
      if (!W || !H || !n()) return;
      ctx.clearRect(0, 0, W, H);
      // A second, softer swell behind the front surface for depth.
      path(Math.max(2, rest * 0.3), 0.55, 90);
      ctx.fillStyle = BACK;
      ctx.fill();
      path(0, 1, 0);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.fillStyle = INK;
      for (var i = 0; i < drops.length; i++) {
        var d = drops[i];
        ctx.fillRect(d.x - d.s / 2, d.y - d.s / 2, d.s, d.s);
      }
    }

    function frame(now) {
      raf = 0;
      if (!visible) return;
      if (!last) last = now;
      acc += Math.min(100, now - last);
      last = now;
      while (acc >= STEP) { step(); acc -= STEP; }
      draw();
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (raf || reduced) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    }

    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    window.addEventListener('resize', resize, { passive: true });
    resize();

    if (reduced) return;

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) start();
      }).observe(shore);
    } else {
      visible = true;
      start();
    }

    // Pointer: moving through the water drags it along; crossing the surface
    // quickly throws a splash; a tap or click is a hard splash.
    function local(e) {
      var rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, time: e.timeStamp };
    }

    shore.addEventListener('pointermove', function (e) {
      var p = local(e);
      if (lastPointer && p.x >= 0 && p.x <= W) {
        var dy = p.y - lastPointer.y;
        var dx = p.x - lastPointer.x;
        var sy = surfaceY(p.x);
        var wasAbove = lastPointer.y < surfaceY(lastPointer.x);
        var isAbove = p.y < sy;
        if (wasAbove !== isAbove && Math.abs(dy) > 6) {
          splash(p.x, Math.max(-16, Math.min(16, -dy * 0.6)));
        } else if (Math.abs(p.y - sy) < 36) {
          disturb(p.x, Math.max(-5, Math.min(5, -dy * 0.25 - Math.abs(dx) * 0.06)), 2);
        }
      }
      lastPointer = p;
    }, { passive: true });

    shore.addEventListener('pointerleave', function () { lastPointer = null; });

    shore.addEventListener('pointerdown', function (e) {
      var p = local(e);
      if (p.x < 0 || p.x > W) return;
      splash(p.x, -14);
    });

    // Scrolling sloshes the tank: waves roll in from both edges, scaled by
    // scroll speed, plus a few random chops.
    window.addEventListener('scroll', function () {
      var y = window.pageYOffset;
      var delta = y - lastScroll;
      lastScroll = y;
      if (!visible || !n()) return;
      var f = Math.max(-7, Math.min(7, delta * 0.08));
      disturb(0, f, 4);
      disturb(W, -f, 4);
      if (Math.abs(delta) > 25) disturb(Math.random() * W, -Math.abs(f) * 0.6, 2);
    }, { passive: true });
  }

  function initAll(root) {
    (root || document).querySelectorAll('[data-sea]').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initAll(); });
  } else {
    initAll();
  }

  document.addEventListener('shopify:section:load', function (e) { initAll(e.target); });

  // The wordmark font loads late; re-measure the rest level once it has.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { window.dispatchEvent(new Event('resize')); });
  }
})();
