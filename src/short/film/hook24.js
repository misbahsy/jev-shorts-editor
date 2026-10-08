// hook24.js — the 24fps.dev engine layers on top of the film: the opening hook (a giant word that
// sits BEHIND the speaker), engine caption styles, and warm light-leak flashes.
//
// The film is a transparent overlay and the video is not in the page, so "behind the speaker" works
// like this: a hook layer root holds   back text < fg <img> (person cut-out, same 1080x1920 output
// geometry as the video) < front text.  Composited over the video, the giant word shows everywhere
// except where the cut-out repaints the speaker on top of it.
//
// Everything is a pure function of t. The only asynchronous part is decoding the next fg frame; the
// render() result is then a Promise that window.renderFrame hands back (seekScript awaits it).
(function () {
  "use strict";

  function pad5(n) {
    var s = String(n);
    while (s.length < 5) s = "0" + s;
    return s;
  }

  function el(tag, style, parent) {
    var n = document.createElement(tag);
    for (var k in style) n.style[k] = style[k];
    if (parent) parent.appendChild(n);
    return n;
  }

  function fillRoot(parent, z) {
    return el(
      "div",
      { position: "absolute", left: "0", top: "0", width: "1080px", height: "1920px", pointerEvents: "none", zIndex: String(z) },
      parent
    );
  }

  // Same as hook.ts leakEnvelope (kept in sync by hook.test.ts reading both).
  function leakEnvelope(t, times) {
    var best = 0;
    for (var i = 0; i < times.length; i++) {
      var d = t - times[i];
      var v = 0;
      if (d >= -0.08 && d < 0) v = (d + 0.08) / 0.08;
      else if (d >= 0 && d < 0.35) v = 1 - d / 0.35;
      if (v > best) best = v;
    }
    return best;
  }

  function build(root, plan) {
    var cfg = window.__FILM24 || {};
    var F = window.Film24;
    var rt = { layers: [], caps: null, leak: null, ready: Promise.resolve() };
    if (!F) return rt;
    var waits = [];

    // ---- opening hook and mid-video giant words ----
    // Both are "text behind the speaker" layers: a window [start, end) in output time, an engine
    // text preset that runs on window-local time, and (with a cut-out) person frames fgDir/%05d.png
    // indexed round((t - start) * 30).
    var layers = [];
    function addLayer(spec, z, start, end) {
      if (!spec || !spec.preset) return;
      var layerRoot = fillRoot(root, z);
      var media = {};
      var img = null;
      if (spec.cutout && spec.fgFrames > 0) {
        img = el(
          "img",
          { position: "absolute", left: "0", top: "0", width: "1080px", height: "1920px", pointerEvents: "none" },
          layerRoot
        );
        media.fg = img;
      }
      var m = F.mount(layerRoot, { kind: "text", preset: spec.preset, media: media });
      waits.push(m.ready);
      layerRoot.style.display = "none";
      layers.push({ root: layerRoot, img: img, mount: m, spec: spec, start: start, end: end, lastIdx: -1, cache: {} });
    }
    if (plan.hook) addLayer(plan.hook, 20, 0, plan.hook.endSec);
    var giants = plan.giants || [];
    for (var gi = 0; gi < giants.length; gi++) addLayer(giants[gi], 21, giants[gi].start, giants[gi].end);
    rt.layers = layers;

    // ---- engine captions: one mount per engine style, shown only inside its own sections ----
    var tracks = cfg.captions || [];
    rt.caps = [];
    for (var ti = 0; ti < tracks.length; ti++) {
      var tr = tracks[ti];
      var capRoot = fillRoot(root, 30);
      capRoot.style.display = "none";
      var cm = F.mount(capRoot, { kind: "captions", preset: tr.preset, script: tr.words });
      waits.push(cm.ready);
      rt.caps.push({ root: capRoot, mount: cm, ranges: tr.ranges, y: typeof tr.preset.y === "number" ? tr.preset.y : 0.72 });
    }

    // ---- light leaks ----
    var leaks = plan.fx && plan.fx.leaks ? plan.fx.leaks : [];
    if (cfg.leak && leaks.length) {
      var leakRoot = fillRoot(root, 25);
      var dummy = document.createElement("div");
      var lm = F.mount(leakRoot, { kind: "effect", preset: cfg.leak, media: { main: dummy } });
      waits.push(lm.ready);
      leakRoot.style.opacity = "0";
      rt.leak = { root: leakRoot, mount: lm, times: leaks };
    }

    rt.ready = Promise.all(waits);
    return rt;
  }

  function preload(L, idx) {
    for (var k = 1; k <= 4; k++) {
      var j = idx + k;
      if (j >= L.spec.fgFrames || L.cache[j]) continue;
      var im = new Image();
      im.src = L.spec.fgDir + "/" + pad5(j) + ".png";
      L.cache[j] = im;
    }
  }

  // Returns a Promise only when an fg frame has to be decoded before the frame can be captured.
  function render(rt, t, active, plan) {
    var pending = null;
    for (var li = 0; li < rt.layers.length; li++) {
      var L = rt.layers[li];
      var on = t >= L.start - 1e-6 && t < L.end - 1e-6;
      L.root.style.display = on ? "block" : "none";
      if (!on) continue;
      if (L.img) {
        var idx = Math.max(0, Math.min(L.spec.fgFrames - 1, Math.round((t - L.start) * 30)));
        if (idx !== L.lastIdx) {
          L.lastIdx = idx;
          L.img.src = L.spec.fgDir + "/" + pad5(idx) + ".png";
          if (L.img.decode) pending = L.img.decode().catch(function () {});
          preload(L, idx);
        }
      }
      L.mount.render(t - L.start);
    }
    var layout = active ? active.layout : "full";
    var g = plan.geometry[layout];
    for (var ci = 0; ci < rt.caps.length; ci++) {
      var c = rt.caps[ci];
      var inRange = false;
      for (var ri = 0; ri < c.ranges.length; ri++) {
        if (t >= c.ranges[ri][0] - 1e-6 && t < c.ranges[ri][1] - 1e-6) { inRange = true; break; }
      }
      c.root.style.display = inRange ? "block" : "none";
      if (!inRange) continue;
      var shift = Math.round(g.captionY - c.y * 1920);
      c.root.style.transform = "translateY(" + shift + "px)";
      c.mount.render(t);
    }
    var l = rt.leak;
    if (l) {
      var env = leakEnvelope(t, l.times);
      l.root.style.opacity = String(env * 0.8);
      if (env > 0) l.mount.render(t);
    }
    return pending;
  }

  window.FilmHook24 = { build: build, render: render, leakEnvelope: leakEnvelope };
})();
