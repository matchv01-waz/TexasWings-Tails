/* Admin enhancements. Every action also works without JavaScript. */
(function () {
  'use strict';
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  document.addEventListener('DOMContentLoaded', function () {
    // ---- mobile sidebar ----
    var toggle = document.querySelector('[data-sidebar-toggle]');
    var scrim;
    function setSidebar(open) {
      document.body.classList.toggle('sidebar-open', open);
      if (toggle) toggle.setAttribute('aria-expanded', String(open));
      if (open) { scrim = document.createElement('div'); scrim.className = 'sidebar-scrim'; scrim.onclick = function () { setSidebar(false); }; document.body.appendChild(scrim); }
      else if (scrim) { scrim.remove(); scrim = null; }
    }
    if (toggle) toggle.addEventListener('click', function () { setSidebar(!document.body.classList.contains('sidebar-open')); });

    // ---- success toast fades out ----
    $$('[data-toast]').forEach(function (t) {
      setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 400); }, 3500);
      // Remove ?msg= from the address bar so refreshing doesn't show it again.
      if (history.replaceState) history.replaceState(null, '', location.pathname + location.search.replace(/([?&])msg=[^&]*&?/, '$1').replace(/[?&]$/, '') + location.hash);
    });

    // ---- confirmations ----
    $$('form[data-confirm]').forEach(function (f) {
      f.addEventListener('submit', function (e) { if (!confirm(f.getAttribute('data-confirm'))) e.preventDefault(); });
    });
    $$('[data-confirm-click]').forEach(function (b) {
      b.addEventListener('click', function (e) { if (!confirm(b.getAttribute('data-confirm-click'))) e.preventDefault(); });
    });

    // ---- unsaved changes warning ----
    var dirty = false;
    $$('form[data-dirty-check]').forEach(function (f) {
      f.addEventListener('input', function () { dirty = true; });
      f.addEventListener('change', function () { dirty = true; });
    });
    document.addEventListener('submit', function () { dirty = false; }, true);
    window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    // ---- prevent double submits (e.g. tapping "Add bird" twice while photos upload) ----
    // Runs after the form's own handlers (like confirm dialogs); buttons are disabled on the next
    // tick so the clicked button's name/value is still sent with the form.
    document.addEventListener('submit', function (e) {
      if (e.defaultPrevented) return;
      var form = e.target;
      var clicked = e.submitter;
      var hasFiles = $$('input[type=file]', form).some(function (i) { return i.files && i.files.length; });
      setTimeout(function () {
        $$('button', form).forEach(function (b) { if (b.type !== 'button') b.disabled = true; });
        if (clicked && clicked.classList.contains('btn')) clicked.textContent = hasFiles ? 'Uploading photos…' : 'Saving…';
        var status = form.querySelector('[data-upload-status]');
        if (status && hasFiles) status.hidden = false;
      }, 0);
    });
    // If the browser restores this page from its back/forward cache, reload so buttons work again.
    window.addEventListener('pageshow', function (e) { if (e.persisted) location.reload(); });

    // ---- uploads ----
    function showUploading(form) {
      var s = form.querySelector('[data-upload-status]');
      if (s) s.hidden = false;
      $$('button[type=submit]', form).forEach(function (b) { b.disabled = true; });
    }
    $$('[data-upload-form]').forEach(function (f) {
      f.addEventListener('submit', function () { showUploading(f); });
    });
    $$('input[data-auto-upload]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (!input.files.length) return;
        showUploading(input.form);
        input.form.submit();
      });
    });
    $$('.dropzone-label').forEach(function (z) {
      ['dragenter', 'dragover'].forEach(function (ev) { z.addEventListener(ev, function () { z.classList.add('is-drag'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { z.addEventListener(ev, function () { z.classList.remove('is-drag'); }); });
    });

    // ---- previews of chosen photos ----
    $$('input[type=file][data-preview]').forEach(function (input) {
      var label = input.closest('label');
      var grid = label && label.nextElementSibling && label.nextElementSibling.matches('[data-preview-grid]') ? label.nextElementSibling : null;
      if (!grid) return;
      input.addEventListener('change', function () {
        grid.innerHTML = '';
        Array.prototype.slice.call(input.files, 0, 30).forEach(function (file) {
          if (!/^image\//.test(file.type)) return;
          var img = document.createElement('img');
          img.alt = file.name;
          img.src = URL.createObjectURL(file);
          img.onload = function () { URL.revokeObjectURL(img.src); };
          grid.appendChild(img);
        });
        var strong = label.querySelector('strong');
        if (strong) strong.textContent = input.files.length + (input.files.length === 1 ? ' photo chosen' : ' photos chosen');
      });
    });

    // ---- drag & drop reordering ----
    $$('[data-sortable]').forEach(function (list) {
      var url = list.getAttribute('data-order-url');
      var dragged = null;
      list.addEventListener('dragstart', function (e) {
        dragged = e.target.closest('[data-id]');
        if (!dragged) return;
        dragged.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragged.getAttribute('data-id')); } catch (err) { /* IE */ }
      });
      list.addEventListener('dragover', function (e) {
        if (!dragged) return;
        e.preventDefault();
        var over = e.target.closest('[data-id]');
        if (!over || over === dragged || over.parentNode !== list) return;
        var rect = over.getBoundingClientRect();
        var horizontal = getComputedStyle(list).display === 'grid' && rect.width < list.clientWidth * 0.7;
        var after = horizontal ? e.clientX > rect.left + rect.width / 2 : e.clientY > rect.top + rect.height / 2;
        list.insertBefore(dragged, after ? over.nextSibling : over);
      });
      list.addEventListener('dragend', function () {
        if (!dragged) return;
        dragged.classList.remove('is-dragging');
        dragged = null;
        var ids = $$('[data-id]', list).map(function (el) { return Number(el.getAttribute('data-id')); });
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ ids: ids }),
          credentials: 'same-origin',
        }).then(function (r) {
          if (!r.ok) throw new Error('Save failed');
          // Photo grids show a "Cover" badge on the first photo — reload to refresh it.
          if (list.classList.contains('photo-grid')) location.reload();
        }).catch(function () { alert('The new order could not be saved. Please refresh the page and try again.'); });
      });
    });
  });
})();
