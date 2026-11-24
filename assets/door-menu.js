// Door menu: shuts two black doors over the page from each side, with a
// round window around the header logo, then draws the X over the menu button.
// See sections/mobile-navigation.liquid and assets/door-menu.css.
//
// States on .door-menu:
//   hidden          parked off screen, not rendered
//   .is-in          doors sliding shut (or shut)
//   .is-shut        doors have met: thud, X draws, index fades up
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init() {
    var menu = document.querySelector('[data-door-menu]');
    if (!menu || menu.dataset.doorReady) return;
    menu.dataset.doorReady = 'true';

    var leftDoor = menu.querySelector('.door-menu__door--left');
    var closeBtn = menu.querySelector('[data-door-close]');
    var openers = function () { return document.querySelectorAll('[data-door-open]'); };
    var state = 'open'; // open (doors parked) | closing | shut | opening
    var lastOpener = null;
    var timer = 0;

    // Line the window and the X up with the live header.
    function measure() {
      var logo = document.querySelector('.site-header__logo');
      var opener = lastOpener || document.querySelector('[data-door-open]');
      var s = menu.style;
      if (logo) {
        var r = logo.getBoundingClientRect();
        // The doors meet at the viewport centre and the logo cell is centred
        // in the header, so the round window sits on the seam at the cell's
        // mid height, a touch inside the cell so a black rim shows.
        s.setProperty('--win-top', Math.max(0, r.top) + 'px');
        s.setProperty('--win-bottom', Math.max(0, r.bottom) + 'px');
        s.setProperty('--win-cy', ((r.top + r.bottom) / 2) + 'px');
        s.setProperty('--win-r', Math.max(12, Math.min(r.width, r.height) / 2 - 3) + 'px');
      }
      if (opener) {
        var o = opener.getBoundingClientRect();
        s.setProperty('--x-top', '0px');
        s.setProperty('--x-left', o.left + 'px');
        s.setProperty('--x-size', o.width + 'px');
      }
    }

    function setExpanded(value) {
      Array.prototype.forEach.call(openers(), function (b) {
        b.setAttribute('aria-expanded', value ? 'true' : 'false');
      });
    }

    function afterDoors(fn, fallback) {
      var done = false;
      function go() {
        if (done) return;
        done = true;
        leftDoor.removeEventListener('transitionend', onEnd);
        fn();
      }
      function onEnd(e) { if (e.propertyName === 'transform') go(); }
      leftDoor.addEventListener('transitionend', onEnd);
      clearTimeout(timer);
      timer = setTimeout(go, reduced ? 0 : fallback);
    }

    function shut(opener) {
      if (state === 'shut' || state === 'closing') return;
      lastOpener = opener || lastOpener;
      measure();
      menu.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      setExpanded(true);
      state = 'closing';
      // Next frame, so the doors transition from their parked position.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          menu.classList.add('is-in');
          afterDoors(function () {
            if (state !== 'closing') return;
            state = 'shut';
            menu.classList.add('is-shut');
            closeBtn.focus({ preventScroll: true });
          }, 700);
        });
      });
    }

    function open() {
      if (state === 'open' || state === 'opening') return;
      state = 'opening';
      menu.classList.remove('is-shut');
      setExpanded(false);
      // Let the index and X fade first, then swing the doors back.
      setTimeout(function () {
        if (state !== 'opening') return;
        menu.classList.remove('is-in');
        afterDoors(function () {
          if (state !== 'opening') return;
          state = 'open';
          menu.hidden = true;
          document.documentElement.style.overflow = '';
          if (lastOpener) lastOpener.focus({ preventScroll: true });
        }, 650);
      }, reduced ? 0 : 110);
    }

    document.addEventListener('click', function (e) {
      var opener = e.target.closest && e.target.closest('[data-door-open]');
      if (!opener) return;
      e.preventDefault();
      if (state === 'shut' || state === 'closing') open(); else shut(opener);
    });

    closeBtn.addEventListener('click', open);

    document.addEventListener('keydown', function (e) {
      if (menu.hidden) return;
      if (e.key === 'Escape') { open(); return; }
      if (e.key !== 'Tab') return;
      // Keep focus on the doors while they're shut.
      var items = menu.querySelectorAll('button, a[href], input');
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    window.addEventListener('resize', function () {
      if (menu.hidden) return;
      // The menu button only exists below the desktop breakpoint.
      if (window.innerWidth >= 990) { open(); return; }
      measure();
    }, { passive: true });

    // Theme editor: show the doors while the section is selected.
    document.addEventListener('shopify:section:select', function (e) {
      if (e.target && e.target.querySelector && e.target.querySelector('[data-door-menu]')) shut();
    });
    document.addEventListener('shopify:section:deselect', function (e) {
      if (e.target && e.target.querySelector && e.target.querySelector('[data-door-menu]')) open();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('shopify:section:load', init);
})();
