/* Simpld — ASCII field renderer.
   Paints any <canvas data-ascii data-src="..."> as colored ASCII.

   Image provenance: both photographs are Unsplash-licensed (free commercial
   and personal use, no attribution required); details embedded in each JPEG. */
(function () {
  'use strict';

  var RAMP = '@%#*+=-,. '; // heavy glyphs in dark regions, sparse in bright ones
  var PAPER = '#F7F9FC';
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function coverRect(iw, ih, cw, ch, fx, fy) {
    var s = Math.max(cw / iw, ch / ih);
    var w = iw * s, h = ih * s;
    return { x: (cw - w) * fx, y: (ch - h) * fy, w: w, h: h };
  }

  // Derive a small palette from the photo: seeds spread across luminance,
  // then k-means refinement. Deterministic, no randomness.
  function derivePalette(samples, k, iterations) {
    var sorted = samples.slice().sort(function (a, b) {
      return (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]);
    });
    var colors = [];
    for (var s = 0; s < k; s++) {
      var idx = Math.min(sorted.length - 1, ((s + 0.5) * sorted.length / k) | 0);
      colors.push([sorted[idx][0], sorted[idx][1], sorted[idx][2]]);
    }
    for (var it = 0; it < iterations; it++) {
      var sums = [];
      for (var c = 0; c < k; c++) sums.push([0, 0, 0, 0]);
      for (var i = 0; i < samples.length; i++) {
        var p = samples[i];
        var best = 0, bestD = Infinity;
        for (var c2 = 0; c2 < colors.length; c2++) {
          var dr = p[0] - colors[c2][0];
          var dg = p[1] - colors[c2][1];
          var db = p[2] - colors[c2][2];
          var d = dr * dr + dg * dg + db * db;
          if (d < bestD) { bestD = d; best = c2; }
        }
        sums[best][0] += p[0];
        sums[best][1] += p[1];
        sums[best][2] += p[2];
        sums[best][3]++;
      }
      for (var c3 = 0; c3 < colors.length; c3++) {
        if (sums[c3][3] > 0) {
          colors[c3] = [
            sums[c3][0] / sums[c3][3],
            sums[c3][1] / sums[c3][3],
            sums[c3][2] / sums[c3][3]
          ];
        }
      }
    }
    return colors;
  }

  function nearest(colors, r, g, b) {
    var best = 0, bestD = Infinity;
    for (var c = 0; c < colors.length; c++) {
      var dr = r - colors[c][0];
      var dg = g - colors[c][1];
      var db = b - colors[c][2];
      var d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function rgb(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : a) + ')';
  }

  // Reveal sweep: a diagonal front moving from top-left to bottom-right,
  // equivalent to revealing cells in (x/W + y/H) order.
  function clipReveal(c, fr, W, H) {
    c.beginPath();
    c.moveTo(0, 0);
    if (fr < 1) {
      c.lineTo(Math.min(W, fr * W), 0);
      c.lineTo(0, Math.min(H, fr * H));
    } else {
      c.lineTo(W, 0);
      var y1 = Math.min(H, (fr - 1) * H);
      c.lineTo(W, y1);
      if (y1 < H) {
        c.lineTo(W * (fr - 1), H);
        c.lineTo(0, H);
      }
    }
    c.closePath();
    c.clip();
  }

  function Field(canvas, ground) {
    this.canvas = canvas;
    this.ground = ground || PAPER;
    this.ctx = canvas.getContext('2d');
    this.host = canvas.parentElement;
    this.finalFrame = null;
    this.rafId = 0;
    this.swept = false;
  }

  Field.prototype = {
    // Render the full artwork once into an offscreen frame.
    prepare: function () {
      var rect = this.host.getBoundingClientRect();
      var cssW = Math.max(1, Math.round(rect.width));
      var cssH = Math.max(1, Math.round(rect.height));
      var dpr = clamp(window.devicePixelRatio || 1, 1, 2);

      this.cssW = cssW;
      this.cssH = cssH;
      this.dpr = dpr;
      this.canvas.width = cssW * dpr;
      this.canvas.height = cssH * dpr;

      // Cell size scales with viewport so glyph count stays manageable.
      var cellW = clamp(Math.round(cssW / 190), 6, 10);
      var cellH = Math.round(cellW * 1.8);
      var cols = Math.ceil(cssW / cellW);
      var rows = Math.ceil(cssH / cellH);

      var focal = (this.canvas.getAttribute('data-focal') || '0.5 0.5').split(' ');
      var fx = focal.length > 1 ? parseFloat(focal[0]) || 0.5 : 0.5;
      var fy = focal.length > 1 ? parseFloat(focal[1]) || 0.5 : 0.5;

      // Downscale to one pixel per cell (cover-crop at the data-focal anchor).
      var small = document.createElement('canvas');
      small.width = cols;
      small.height = rows;
      var sctx = small.getContext('2d');
      var cov = coverRect(this.image.width, this.image.height, cols, rows, fx, fy);
      sctx.drawImage(this.image, cov.x, cov.y, cov.w, cov.h);
      var px = sctx.getImageData(0, 0, cols, rows).data;

      // Palette: strided sample of the whole cell grid.
      var samples = [];
      for (var y = 0; y < rows; y += 2) {
        for (var x = 0; x < cols; x += 2) {
          var si = (y * cols + x) * 4;
          samples.push([px[si], px[si + 1], px[si + 2]]);
        }
      }
      var pal = derivePalette(samples, 14, 7).map(function (c) {
        // lift ~8% toward white so the field stays a light-theme object
        return [c[0] * 0.92 + 255 * 0.08, c[1] * 0.92 + 255 * 0.08, c[2] * 0.92 + 255 * 0.08];
      });

      var frame = document.createElement('canvas');
      frame.width = this.canvas.width;
      frame.height = this.canvas.height;
      var f = frame.getContext('2d');
      f.scale(dpr, dpr);
      f.textAlign = 'center';
      f.textBaseline = 'alphabetic';
      f.font = Math.max(8, cellH - 4) + 'px ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';

      for (var yy = 0; yy < rows; yy++) {
        for (var xx = 0; xx < cols; xx++) {
          var pi = (yy * cols + xx) * 4;
          var cell = pal[nearest(pal, px[pi], px[pi + 1], px[pi + 2])];
          var luma = (0.2126 * px[pi] + 0.7152 * px[pi + 1] + 0.0722 * px[pi + 2]) / 255;
          var gx = xx * cellW;
          var gy = yy * cellH;

          f.fillStyle = rgb(cell);
          f.fillRect(gx, gy, cellW, cellH);

          var glyph = RAMP[clamp((luma * RAMP.length) | 0, 0, RAMP.length - 1)];
          if (glyph !== ' ') {
            // same hue, readably darker: the texture is the photo's own shadow
            f.fillStyle = rgb([cell[0] * 0.42, cell[1] * 0.44, cell[2] * 0.46], 0.85);
            f.fillText(glyph, gx + cellW / 2, gy + cellH - 3);
          }
        }
      }

      this.finalFrame = frame;
    },

    paintStatic: function () {
      var ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = this.ground;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      if (this.finalFrame) ctx.drawImage(this.finalFrame, 0, 0, this.cssW, this.cssH);
    },

    paintPaper: function () {
      var ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = this.ground;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    },

    // One diagonal sweep, then settle into the static frame.
    sweep: function () {
      if (this.swept || reducedMotion || !this.finalFrame) { this.paintStatic(); return; }
      this.swept = true;
      var field = this;
      var t0 = performance.now();
      var dur = 1150;
      var maxFr = 2.35; // starts before 0, ends past 2 so every cell is covered

      function frame(now) {
        var t = clamp((now - t0) / dur, 0, 1);
        // ease-out so the last rows settle instead of skidding
        var eased = 1 - Math.pow(1 - t, 2.2);
        var fr = eased * maxFr - 0.35;

        field.paintPaper();
        if (fr > 0) {
          var ctx = field.ctx;
          ctx.save();
          ctx.setTransform(field.dpr, 0, 0, field.dpr, 0, 0);
          clipReveal(ctx, fr, field.cssW, field.cssH);
          ctx.drawImage(field.finalFrame, 0, 0, field.cssW, field.cssH);
          ctx.restore();
        }
        if (t < 1) {
          field.rafId = requestAnimationFrame(frame);
        } else {
          field.paintStatic();
        }
      }
      cancelAnimationFrame(this.rafId);
      this.rafId = requestAnimationFrame(frame);
    },

    reflow: function () {
      cancelAnimationFrame(this.rafId);
      this.prepare();
      this.paintStatic();
    }
  };

  var fields = [];

  Array.prototype.slice.call(document.querySelectorAll('canvas[data-ascii]')).forEach(function (canvas) {
    var src = canvas.getAttribute('data-src');
    if (!src) return;
    var field = new Field(canvas, canvas.getAttribute('data-ground'));
    fields.push(field);

    var io = null;
    if ('IntersectionObserver' in window && !reducedMotion) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !field.swept) {
            field.sweep();
            io.disconnect();
          }
        });
      }, { rootMargin: '160px 0px' });
    }

    var image = new Image();
    var rect = canvas.parentElement.getBoundingClientRect();
    var visible = rect.top < innerHeight && rect.bottom > 0;

    image.onload = function () {
      field.image = image;
      field.prepare();
      if (reducedMotion || !('IntersectionObserver' in window)) {
        field.paintStatic();
        return;
      }
      if (visible) {
        field.sweep();
      } else {
        field.paintStatic(); // hold the ground until the band scrolls in
        io.observe(canvas);
      }
    };
    image.onerror = function () { canvas.remove(); };
    image.src = src;
  });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { fields.forEach(function (f) { f.reflow(); }); }, 180);
  });
})();
