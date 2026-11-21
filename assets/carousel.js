// Swipe carousel controls: prev/next arrows and dots for a horizontal
// scroll-snap strip marked [data-carousel]. Plays the video on the current
// slide and pauses the rest. Only adds controls when there's more than one slide.
(function () {
  function init(scroller) {
    if (!scroller || scroller.dataset.carouselReady) return;
    var slides = Array.prototype.slice.call(scroller.children);
    scroller.dataset.carouselReady = 'true';
    if (slides.length < 2) {
      playOnly(slides, 0);
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'carousel';
    scroller.parentNode.insertBefore(wrap, scroller);
    wrap.appendChild(scroller);

    function arrow(dir, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'carousel__arrow carousel__arrow--' + dir;
      b.setAttribute('aria-label', label);
      b.innerHTML = dir === 'prev' ? '&#8249;' : '&#8250;';
      wrap.appendChild(b);
      return b;
    }
    var prev = arrow('prev', 'Previous');
    var next = arrow('next', 'Next');

    var dotsWrap = document.createElement('div');
    dotsWrap.className = 'carousel__dots';
    var dots = slides.map(function (_, i) {
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'carousel__dot';
      d.setAttribute('aria-label', 'Go to slide ' + (i + 1));
      d.addEventListener('click', function () { go(i); });
      dotsWrap.appendChild(d);
      return d;
    });
    wrap.appendChild(dotsWrap);

    var current = -1;
    function index() {
      return Math.round(scroller.scrollLeft / Math.max(1, scroller.clientWidth));
    }
    function go(i) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      scroller.scrollTo({ left: i * scroller.clientWidth, behavior: 'smooth' });
    }
    function update() {
      var i = index();
      if (i === current) return;
      current = i;
      dots.forEach(function (d, n) { d.setAttribute('aria-current', n === i ? 'true' : 'false'); });
      prev.disabled = i === 0;
      next.disabled = i === slides.length - 1;
      playOnly(slides, i);
    }

    prev.addEventListener('click', function () { go(index() - 1); });
    next.addEventListener('click', function () { go(index() + 1); });
    var t;
    scroller.addEventListener('scroll', function () {
      clearTimeout(t);
      t = setTimeout(update, 60);
    }, { passive: true });
    window.addEventListener('resize', function () { current = -1; update(); });
    update();
  }

  function playOnly(slides, i) {
    slides.forEach(function (s, n) {
      var v = s.tagName === 'VIDEO' ? s : s.querySelector && s.querySelector('video');
      if (!v) return;
      if (n === i) { v.muted = true; v.play().catch(function () {}); } else { v.pause(); }
    });
  }

  window.Carousel = { init: init };
  document.querySelectorAll('[data-carousel]').forEach(init);
})();
