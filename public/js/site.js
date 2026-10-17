/* Texas Wings & Tails — progressive enhancements. The site works without JS. */
(function () {
  'use strict';
  var doc = document.documentElement;
  doc.classList.remove('no-js');
  doc.classList.add('js');

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  document.addEventListener('DOMContentLoaded', function () {
    // ---- header shadow on scroll ----
    var header = $('[data-header]');
    function onScroll() { if (header) header.classList.toggle('is-scrolled', window.scrollY > 8); }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // ---- mobile nav ----
    var toggle = $('[data-nav-toggle]');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var open = !document.body.classList.contains('nav-open');
        document.body.classList.toggle('nav-open', open);
        toggle.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && document.body.classList.contains('nav-open')) { toggle.click(); toggle.focus(); }
      });
    }

    // ---- filters: mobile drawer + auto-submit ----
    var filters = $('[data-filters]');
    var scrim;
    function setFilters(open) {
      if (!filters) return;
      filters.classList.toggle('is-open', open);
      document.body.style.overflow = open ? 'hidden' : '';
      if (open) {
        scrim = document.createElement('div');
        scrim.className = 'scrim';
        scrim.addEventListener('click', function () { setFilters(false); });
        document.body.appendChild(scrim);
        requestAnimationFrame(function () { scrim.classList.add('is-visible'); });
        var first = $('input, select', filters); if (first) first.focus({ preventScroll: true });
      } else if (scrim) { scrim.remove(); scrim = null; }
    }
    $$('[data-filters-open]').forEach(function (b) { b.addEventListener('click', function () { setFilters(true); }); });
    $$('[data-filters-close]').forEach(function (b) { b.addEventListener('click', function () { setFilters(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && filters && filters.classList.contains('is-open')) setFilters(false); });

    var filterForm = $('[data-filter-form]');
    var desktop = window.matchMedia('(min-width: 1040px)');
    if (filterForm) {
      // Drop empty fields so URLs stay clean.
      filterForm.addEventListener('submit', function () {
        $$('input, select', filterForm).forEach(function (el) {
          if (!el.value || (el.name === 'status' && el.value === 'current' && el.checked)) el.disabled = true;
        });
        $$('select[form="' + filterForm.id + '"]').forEach(function (el) { if (!el.value) el.disabled = true; });
      });
      filterForm.addEventListener('change', function (e) {
        if (desktop.matches && e.target.name !== 'q' && e.target.name !== 'min' && e.target.name !== 'max') filterForm.requestSubmit();
      });
    }
    $$('[data-autosubmit]').forEach(function (el) {
      el.addEventListener('change', function () { var f = el.form; if (f) f.requestSubmit ? f.requestSubmit() : f.submit(); });
    });

    // ---- carousel (bird detail) ----
    $$('[data-carousel-root]').forEach(function (root) {
      var track = $('[data-carousel]', root);
      var slides = $$('.slide', track);
      if (slides.length < 2) return;
      var counter = $('[data-carousel-counter] span', root);
      var thumbs = $$('[data-goto]', root);
      var index = 0;
      function go(i) {
        i = Math.max(0, Math.min(slides.length - 1, i));
        track.scrollTo({ left: slides[i].offsetLeft - track.offsetLeft, behavior: 'smooth' });
      }
      function update() {
        var i = Math.round(track.scrollLeft / track.clientWidth);
        if (i === index) return;
        index = i;
        if (counter) counter.textContent = String(i + 1);
        thumbs.forEach(function (t, n) {
          if (n === i) { t.setAttribute('aria-current', 'true'); t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
          else t.removeAttribute('aria-current');
        });
      }
      var raf;
      track.addEventListener('scroll', function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }, { passive: true });
      var prev = $('[data-carousel-prev]', root), next = $('[data-carousel-next]', root);
      if (prev) prev.addEventListener('click', function () { go(index - 1); });
      if (next) next.addEventListener('click', function () { go(index + 1); });
      thumbs.forEach(function (t) { t.addEventListener('click', function () { go(Number(t.getAttribute('data-goto'))); }); });
      track.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
      });
    });

    // ---- lightbox ----
    var lb = $('[data-lightbox-root]');
    if (!lb) return;
    var lbImg = $('[data-lb-img]', lb), lbCap = $('[data-lb-caption]', lb), lbCount = $('[data-lb-counter]', lb);
    var items = [], cur = 0, lastFocus = null;

    function show(i) {
      cur = (i + items.length) % items.length;
      var a = items[cur];
      lbImg.style.opacity = '0';
      lbImg.onload = function () { lbImg.style.opacity = '1'; };
      lbImg.src = a.getAttribute('href');
      lbImg.alt = a.getAttribute('data-alt') || '';
      lbCap.textContent = a.getAttribute('data-caption') || '';
      lbCount.textContent = items.length > 1 ? (cur + 1) + ' / ' + items.length : '';
      $('[data-lb-prev]', lb).hidden = $('[data-lb-next]', lb).hidden = items.length < 2;
      // Preload neighbours for instant swiping.
      [cur + 1, cur - 1].forEach(function (n) { var x = items[(n + items.length) % items.length]; if (x) (new Image()).src = x.getAttribute('href'); });
    }
    function open(group, a) {
      items = $$('[data-lightbox]', group);
      lastFocus = document.activeElement;
      lb.hidden = false;
      document.body.classList.add('lb-open');
      show(items.indexOf(a));
      $('[data-lb-close]', lb).focus();
    }
    function close() {
      lb.hidden = true;
      document.body.classList.remove('lb-open');
      lbImg.removeAttribute('src');
      if (lastFocus) lastFocus.focus();
    }
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-lightbox]');
      if (!a || e.metaKey || e.ctrlKey) return;
      var group = a.closest('[data-lightbox-group]') || document;
      e.preventDefault();
      open(group, a);
    });
    $('[data-lb-close]', lb).addEventListener('click', close);
    $('[data-lb-prev]', lb).addEventListener('click', function () { show(cur - 1); });
    $('[data-lb-next]', lb).addEventListener('click', function () { show(cur + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb || e.target.classList.contains('lb-figure')) close(); });
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(cur - 1);
      else if (e.key === 'ArrowRight') show(cur + 1);
      else if (e.key === 'Tab') { // keep focus inside the dialog
        var f = $$('button:not([hidden])', lb);
        var i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    });
    // Swipe
    var sx = 0, sy = 0;
    lb.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(cur + (dx < 0 ? 1 : -1));
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
    }, { passive: true });
  });
})();
