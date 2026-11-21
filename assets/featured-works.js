// Featured works: open a tile's <template> content in the shared <dialog>.
(function () {
  document.querySelectorAll('[data-featured-works]').forEach(function (root) {
    var dialog = root.querySelector('[data-work-dialog]');
    var content = root.querySelector('[data-work-content]');
    if (!dialog || typeof dialog.showModal !== 'function') return;

    function close() {
      dialog.close();
    }

    root.querySelectorAll('[data-work-open]').forEach(function (tile) {
      tile.addEventListener('click', function () {
        var template = tile.parentElement.querySelector('[data-work-sheet]');
        if (!template) return;
        content.replaceChildren(template.content.cloneNode(true));
        dialog.showModal();
        dialog.scrollTop = 0;
        // Videos autoplay muted once the sheet is open.
        content.querySelectorAll('video').forEach(function (video) {
          video.muted = true;
          video.play().catch(function () {});
        });
      });
    });

    root.querySelector('[data-work-close]').addEventListener('click', close);
    // Tap on the backdrop closes the sheet.
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) close();
    });
    dialog.addEventListener('close', function () {
      content.replaceChildren();
    });
  });
})();
