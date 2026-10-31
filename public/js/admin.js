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

    // ---- photo uploads: shrink photos in the browser and send big selections in parts ----
    // Hosting limits one request to about 6 MB (Netlify) and the site never shows photos wider
    // than 1600px, so photos are resized to at most 2048px first. Forms with data-batch-url send
    // the photos a few at a time: the first request carries the form, the rest go to that URL
    // ("{redirect}" = the page the first request redirected to, e.g. the new bird).
    var MAX_EDGE = 2048, BATCH_BYTES = 3.5 * 1024 * 1024, BATCH_FILES = 4;

    function shrink(file) {
      return new Promise(function (resolve) {
        if (!/^image\//.test(file.type) || /gif/.test(file.type) || !window.URL || !HTMLCanvasElement.prototype.toBlob) return resolve(file);
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onerror = function () { URL.revokeObjectURL(url); resolve(file); }; // e.g. HEIC outside Safari: send as is
        img.onload = function () {
          URL.revokeObjectURL(url);
          var w = img.naturalWidth, hgt = img.naturalHeight;
          var scale = Math.min(1, MAX_EDGE / Math.max(w, hgt));
          if (scale === 1 && file.size < 1.5 * 1024 * 1024 && /jpeg|png|webp/.test(file.type)) return resolve(file);
          var c = document.createElement('canvas');
          c.width = Math.round(w * scale); c.height = Math.round(hgt * scale);
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // transparent PNGs get a white background
          ctx.drawImage(img, 0, 0, c.width, c.height); // browsers apply the phone's rotation (EXIF) here
          c.toBlob(function (blob) {
            if (!blob || (scale === 1 && blob.size >= file.size)) return resolve(file);
            resolve(new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.88);
        };
        img.src = url;
      });
    }

    // ---- videos: sent straight to storage (they're too big for the website's request limit) ----
    var MAX_VIDEO_BYTES = 20 * 1024 * 1024;
    function isVideo(file) { return /^video\//.test(file.type); }
    function tooBig(file) { return isVideo(file) && file.size > MAX_VIDEO_BYTES; }

    // Width and height, so the page can reserve the right space before the video loads.
    function videoSize(file) {
      return new Promise(function (resolve) {
        var v = document.createElement('video');
        var url = URL.createObjectURL(file);
        var done = function (w, h) { URL.revokeObjectURL(url); resolve({ width: w || 0, height: h || 0 }); };
        v.preload = 'metadata';
        v.onloadedmetadata = function () { done(v.videoWidth, v.videoHeight); };
        v.onerror = function () { done(0, 0); };
        setTimeout(function () { done(0, 0); }, 8000);
        v.src = url;
      });
    }

    function uploadVideo(file, onProgress) {
      return Promise.all([
        videoSize(file),
        fetch('/admin/media/video', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ type: file.type, size: file.size }),
        }).then(function (r) { return r.json().catch(function () { return { error: 'The upload could not start.' }; }); }),
      ]).then(function (res) {
        var dim = res[0], t = res[1];
        if (t.error) throw new Error(file.name + ': ' + t.error);
        return new Promise(function (resolve, reject) {
          var x = new XMLHttpRequest();
          x.open('PUT', t.url);
          x.setRequestHeader('Content-Type', t.contentType);
          if (t.url.charAt(0) === '/') x.setRequestHeader('X-CSRF-Token', csrf); // local development route
          x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
          x.onload = function () { if (x.status >= 200 && x.status < 300) resolve(); else reject(new Error(file.name + ' could not be uploaded.')); };
          x.onerror = function () { reject(new Error(file.name + ' could not be uploaded. Please check your connection.')); };
          x.send(file);
        }).then(function () {
          return JSON.stringify({ key: t.key, ext: t.ext, width: dim.width, height: dim.height, name: file.name });
        });
      });
    }

    function post(url, body) {
      return fetch(url, { method: 'POST', body: body, credentials: 'same-origin' });
    }
    // The server answered with a page instead of a redirect (e.g. a missing field): show it.
    function showPage(r) {
      return r.text().then(function (html) {
        if (!/<html/i.test(html)) { alert(html || 'The upload did not work. Please try again with fewer or smaller photos.'); location.reload(); return; }
        document.open(); document.write(html); document.close();
      });
    }

    function sendWithPhotos(form, submitter, inputs) {
      var status = form.querySelector('[data-upload-status]');
      var label = submitter && submitter.classList.contains('btn') ? submitter : null;
      function say(text) { if (label) label.textContent = text; if (status) { status.hidden = false; status.textContent = text; } }
      $$('button', form).forEach(function (b) { if (b.type !== 'button') b.disabled = true; });
      say('Preparing photos…');

      var jobs = [];
      inputs.forEach(function (i) { Array.prototype.forEach.call(i.files, function (f) { jobs.push({ name: i.name, file: f }); }); });
      var chain = Promise.resolve();
      jobs.forEach(function (j) { chain = chain.then(function () { return shrink(j.file).then(function (f) { j.file = f; }); }); });

      // Upload videos first; the form then only carries their storage key.
      var videos = jobs.filter(function (j) { return isVideo(j.file); });
      videos.forEach(function (j, n) {
        chain = chain.then(function () {
          var name = videos.length > 1 ? 'Uploading video ' + (n + 1) + ' of ' + videos.length : 'Uploading video';
          say(name + '…');
          return uploadVideo(j.file, function (p) { say(name + '… ' + Math.round(p * 100) + '%'); })
            .then(function (ref) { j.video = ref; j.file = null; });
        });
      });

      chain.then(function () {
        var fields = new FormData(form);
        inputs.forEach(function (i) { fields.delete(i.name); });
        if (submitter && submitter.name) fields.append(submitter.name, submitter.value);

        var batchUrl = form.getAttribute('data-batch-url');
        var batches = [[]], size = 0;
        jobs.forEach(function (j) {
          var cur = batches[batches.length - 1];
          var bytes = j.file ? j.file.size : 0;
          if (batchUrl && cur.length && (size + bytes > BATCH_BYTES || cur.length >= BATCH_FILES)) { batches.push(cur = []); size = 0; }
          cur.push(j); size += bytes;
        });
        // Gallery uploads go to the top of the list, so send the last photos first to keep their order.
        if (form.hasAttribute('data-batch-reverse')) batches.reverse();
        var total = batches.length;
        var hash = form.getAttribute('data-after-hash');
        var done = 0, finalUrl = null, errorUrl = null;

        // Every request gets its own copy of the form fields plus only its own photos.
        function copyFields() { var fd = new FormData(); fields.forEach(function (v, k) { fd.append(k, v); }); return fd; }
        function withFiles(fd, batch) {
          // A video goes in as a tiny "reference" file, so it keeps its place among the photos.
          batch.forEach(function (j) {
            if (j.video) fd.append(j.name, new Blob([j.video], { type: 'application/x-video-ref' }), 'video-ref.json');
            else fd.append(j.name, j.file, j.file.name);
          });
          return fd;
        }
        function progress() { say(total > 1 ? 'Uploading photos… ' + (done + 1) + ' of ' + total : (jobs.length ? 'Uploading photos…' : 'Saving…')); }

        progress();
        return post(form.action, withFiles(copyFields(), batches[0])).then(function (r) {
          if (!r.redirected || !r.ok) return showPage(r);
          finalUrl = r.url;
          if (/[?&]err=/.test(r.url)) errorUrl = r.url;
          var rest = batches.slice(1);
          var path = new URL(r.url).pathname;
          var next = Promise.resolve();
          rest.forEach(function (batch) {
            next = next.then(function () {
              done += 1; progress();
              var fd;
              if (batchUrl.indexOf('{redirect}') !== -1) { fd = new FormData(); fd.append('_csrf', csrf); }
              else fd = copyFields();
              return post(batchUrl.replace('{redirect}', path), withFiles(fd, batch)).then(function (r2) {
                if (!r2.ok) throw new Error('upload failed');
                if (/[?&]err=/.test(r2.url)) errorUrl = r2.url;
              });
            });
          });
          return next.then(function () {
            location.href = (errorUrl || finalUrl) + (hash ? '#' + hash : '');
          });
        });
      }).catch(function (e) {
        alert(e && e.message && e.message !== 'upload failed' ? e.message : 'Some photos could not be uploaded. Please check your connection and try again.');
        location.reload();
      });
    }

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (e.defaultPrevented || !window.fetch || !window.FormData || !window.Promise) return;
      var inputs = $$('input[type=file]', form).filter(function (i) { return i.files && i.files.length; });
      if (!inputs.length) return;
      e.preventDefault();
      var big = [];
      inputs.forEach(function (i) { Array.prototype.forEach.call(i.files, function (f) { if (tooBig(f)) big.push(f.name); }); });
      if (big.length) {
        alert('Videos must be 20 MB or smaller. Please remove: ' + big.join(', '));
        $$('input[data-auto-upload]', form).forEach(function (i) { i.value = ''; }); // nothing to remove them from
        return;
      }
      sendWithPhotos(form, e.submitter, inputs);
    });

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
        // requestSubmit() runs the submit handlers above (photo shrinking); submit() would skip them.
        if (input.form.requestSubmit) input.form.requestSubmit();
        else { showUploading(input.form); input.form.submit(); }
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
      var strong = label.querySelector('strong');
      var emptyText = strong ? strong.textContent : '';
      // Removing a photo rebuilds the input's file list, which needs DataTransfer (all modern browsers).
      var canRemove = (function () { try { return !!new DataTransfer().items; } catch (err) { return false; } })();

      function removeFile(index) {
        var dt = new DataTransfer();
        Array.prototype.forEach.call(input.files, function (f, i) { if (i !== index) dt.items.add(f); });
        input.files = dt.files;
        render();
      }

      function render() {
        grid.innerHTML = '';
        Array.prototype.slice.call(input.files, 0, 30).forEach(function (file, i) {
          if (!/^(image|video)\//.test(file.type)) return;
          var item = document.createElement('div');
          item.className = 'preview-item';
          var media;
          if (isVideo(file)) {
            media = document.createElement('video');
            media.muted = true;
            media.preload = 'metadata';
            media.setAttribute('aria-label', file.name);
            media.src = URL.createObjectURL(file) + '#t=0.1';
            item.classList.add('is-video');
          } else {
            media = document.createElement('img');
            media.alt = file.name;
            media.src = URL.createObjectURL(file);
            media.onload = function () { URL.revokeObjectURL(media.src); };
          }
          item.appendChild(media);
          if (canRemove) {
            var x = document.createElement('button');
            x.type = 'button';
            x.className = 'preview-remove';
            x.title = 'Remove this photo';
            x.setAttribute('aria-label', 'Remove ' + file.name);
            x.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
            x.addEventListener('click', function () { removeFile(i); });
            item.appendChild(x);
          }
          grid.appendChild(item);
        });
        var n = input.files.length;
        if (strong) strong.textContent = n ? n + (n === 1 ? ' photo chosen' : ' photos chosen') : emptyText;
      }

      input.addEventListener('change', function () {
        var big = Array.prototype.filter.call(input.files, tooBig);
        if (big.length) {
          alert('Videos must be 20 MB or smaller, so these were left out: ' + big.map(function (f) { return f.name; }).join(', '));
          if (canRemove) {
            var dt = new DataTransfer();
            Array.prototype.forEach.call(input.files, function (f) { if (!tooBig(f)) dt.items.add(f); });
            input.files = dt.files;
          } else input.value = '';
        }
        render();
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
