/* Live search: results under a search field as the visitor types.
   Any form marked data-predictive-search="<results box id>" gets it (the
   header's search overlay and the door menu's search). Shopify's predictive
   search renders sections/predictive-search.liquid for the query and the
   markup goes in the box. Arrow keys move from the field through the
   results; Enter in the field still runs the full search.
   Styles: assets/predictive-search.css. */
(function () {
  'use strict';

  var DELAY = 160;
  var cache = {};

  function bind(form) {
    if (form.dataset.predictiveBound === 'true') return;
    var input = form.querySelector('input[name="q"]');
    var box = document.getElementById(form.getAttribute('data-predictive-search'));
    if (!input || !box || !window.fetch) return;
    form.dataset.predictiveBound = 'true';

    var status = form.querySelector('[data-predictive-status]');
    var url = form.getAttribute('data-predictive-url') || '/search/suggest';
    var timer = 0;
    var controller = null;
    var shown = null;

    function options() {
      return Array.prototype.slice.call(box.querySelectorAll('[data-predictive-option]'));
    }

    function hide() {
      box.hidden = true;
      box.innerHTML = '';
      shown = null;
      if (status) status.textContent = '';
    }

    function show(query, html) {
      shown = query;
      box.innerHTML = html;
      box.hidden = !html;
      var root = box.querySelector('[data-predictive-count]');
      var count = root ? Number(root.getAttribute('data-predictive-count')) : 0;
      if (status) status.textContent = count ? count + (count === 1 ? ' result' : ' results') : 'No results';
    }

    function run() {
      var query = input.value.trim();
      if (controller) controller.abort();
      controller = null;
      if (!query) {
        form.classList.remove('is-searching');
        hide();
        return;
      }
      if (query === shown) return;
      if (cache[query] !== undefined) {
        show(query, cache[query]);
        return;
      }
      controller = window.AbortController ? new AbortController() : null;
      var mine = controller;
      form.classList.add('is-searching');
      var params = 'q=' + encodeURIComponent(query) +
        '&resources[type]=product,page' +
        '&resources[limit]=6&resources[limit_scope]=each' +
        '&resources[options][fields]=title,product_type,tag,vendor,variants.title,body' +
        '&section_id=predictive-search';
      fetch(url + '?' + params, { signal: mine ? mine.signal : undefined, headers: { Accept: 'text/html' } })
        .then(function (response) {
          if (!response.ok) throw new Error('Search ' + response.status);
          return response.text();
        })
        .then(function (text) {
          var doc = new DOMParser().parseFromString(text, 'text/html');
          var root = doc.querySelector('.predictive');
          var html = root ? root.outerHTML : '';
          cache[query] = html;
          // Only if the field still says the same thing.
          if (input.value.trim() === query) show(query, html);
        })
        .catch(function (error) {
          if (error && error.name === 'AbortError') return;
          hide();
        })
        .then(function () {
          if (controller === mine) form.classList.remove('is-searching');
        });
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(run, DELAY);
    });

    // Down from the field into the results, up and down between them, and
    // up past the first one back to the field.
    function onKey(event) {
      var step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (!step || box.hidden) return;
      var list = options();
      if (!list.length) return;
      event.preventDefault();
      var next = list.indexOf(document.activeElement) + step;
      if (next < 0) input.focus();
      else list[Math.min(next, list.length - 1)].focus();
    }
    input.addEventListener('keydown', onKey);
    box.addEventListener('keydown', onKey);
  }

  function init(scope) {
    var forms = (scope || document).querySelectorAll('[data-predictive-search]');
    Array.prototype.forEach.call(forms, bind);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(document); });
  } else {
    init(document);
  }
  document.addEventListener('shopify:section:load', function (event) { init(event.target); });
})();
