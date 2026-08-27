/* Header behaviour: the scrolled state and the full screen search.
   Loaded with defer, and re-initialised on Shopify section load so the theme
   editor picks up changes without a reload. */
(function () {
  'use strict';

  var SCROLL_THRESHOLD = 12;

  /* Scrolled state --------------------------------------------------------- */

  function initScrollState(root) {
    var header = root.querySelector('[data-site-header]');
    if (!header || header.dataset.scrollBound === 'true') return;
    header.dataset.scrollBound = 'true';

    var ticking = false;

    function apply() {
      ticking = false;
      var scrolled = window.pageYOffset > SCROLL_THRESHOLD;
      header.classList.toggle('is-scrolled', scrolled);
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(apply);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    apply();
  }

  /* Announcement height ---------------------------------------------------- */

  /* The section wrapper is stuck at minus this value, so the announcement bar
     scrolls out of view before the header pins. Measured rather than assumed
     because the text can wrap at narrow widths. */
  function initAnnouncementOffset(root) {
    var section = root.closest ? root.closest('.shopify-section') : null;
    var wrapper = section || document.getElementById('shopify-section-header');
    var bar = (root.querySelector && root.querySelector('.announcement-bar')) || null;
    if (!wrapper) return;

    function measure() {
      var h = bar ? Math.round(bar.getBoundingClientRect().height) : 0;
      wrapper.style.setProperty('--header-announcement-height', h + 'px');
    }

    measure();
    if (window.ResizeObserver && bar) {
      new ResizeObserver(measure).observe(bar);
    } else {
      window.addEventListener('resize', measure, { passive: true });
    }
  }

  /* Search overlay --------------------------------------------------------- */

  function initSearch(root) {
    var overlay = root.querySelector('[data-search-overlay]');
    if (!overlay || overlay.dataset.searchBound === 'true') return;
    overlay.dataset.searchBound = 'true';

    var input = overlay.querySelector('[data-search-input]');
    var openers = root.querySelectorAll('[data-search-open]');
    var closers = overlay.querySelectorAll('[data-search-close]');
    var lastFocused = null;

    function open() {
      lastFocused = document.activeElement;
      overlay.hidden = false;
      // Next frame, so the transition runs from the hidden state.
      window.requestAnimationFrame(function () {
        overlay.classList.add('is-open');
      });
      document.documentElement.style.overflow = 'hidden';
      Array.prototype.forEach.call(openers, function (btn) {
        btn.setAttribute('aria-expanded', 'true');
      });
      if (input) input.focus();
    }

    function close() {
      overlay.classList.remove('is-open');
      document.documentElement.style.overflow = '';
      Array.prototype.forEach.call(openers, function (btn) {
        btn.setAttribute('aria-expanded', 'false');
      });

      var done = function () {
        overlay.hidden = true;
        overlay.removeEventListener('transitionend', done);
      };
      // transitionend may not fire if motion is reduced, so fall back on a timer.
      overlay.addEventListener('transitionend', done);
      window.setTimeout(done, 400);

      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    Array.prototype.forEach.call(openers, function (btn) {
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        open();
      });
    });

    Array.prototype.forEach.call(closers, function (btn) {
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        close();
      });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !overlay.hidden) close();
    });

    // Keep focus inside the panel while it is open.
    overlay.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab') return;
      var focusable = overlay.querySelectorAll('input, button, a[href]');
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function init(root) {
    var scope = root || document;
    initScrollState(scope);
    initAnnouncementOffset(scope);
    initSearch(scope);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(document); });
  } else {
    init(document);
  }

  document.addEventListener('shopify:section:load', function (event) {
    if (event.target && event.target.querySelector('[data-site-header]')) init(event.target);
  });
})();
