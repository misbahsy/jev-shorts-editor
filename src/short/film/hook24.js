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
    var rt = { hook: null, caps: null, leak: null, ready: Promise.resolve() };
    if (!F) return rt;
    var waits = [];

    // ---- opening hook ----
    var hook = plan.hook;
    if (hook && hook.preset) {
      var hookRoot = fillRoot(root, 20);
      var media = {};
      var img = null;
      if (hook.cutout && hook.fgFrames > 0) {
        img = el(
          "img",
          { position: "absolute", left: "0", top: "0", width: "1080px", height: "1920px", pointerEvents: "none" },
          hookRoot
        );
        media.fg = img;
      }
      var m = F.mount(hookRoot, { kind: "text", preset: hook.preset, media: media });
      waits.push(m.ready);
      rt.hook = { root: hookRoot, img: img, mount: m, hook: hook, lastIdx: -1, cache: {} };
    }

    // ---- engine captions ----
    if (cfg.caption && cfg.captionWords) {
      var capRoot = fillRoot(root, 30);
      var cm = F.mount(capRoot, { kind: "captions", preset: cfg.caption, script: cfg.captionWords });
      waits.push(cm.ready);
      rt.caps = { root: capRoot, mount: cm, y: typeof cfg.caption.y === "number" ? cfg.caption.y : 0.72 };
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

  function preload(h, idx) {
    for (var k = 1; k <= 4; k++) {
      var j = idx + k;
      if (j >= h.hook.fgFrames || h.cache[j]) continue;
      var im = new Image();
      im.src = h.hook.fgDir + "/" + pad5(j) + ".png";
      h.cache[j] = im;
    }
  }

  // Returns a Promise only when an fg frame has to be decoded before the frame can be captured.
  function render(rt, t, active, plan) {
    var pending = null;
    var h = rt.hook;
    if (h) {
      var on = t < h.hook.endSec;
      h.root.style.display = on ? "block" : "none";
      if (on) {
        if (h.img) {
          var idx = Math.max(0, Math.min(h.hook.fgFrames - 1, Math.round(t * 30)));
          if (idx !== h.lastIdx) {
            h.lastIdx = idx;
            var src = h.hook.fgDir + "/" + pad5(idx) + ".png";
            h.img.src = src;
            pending = h.img.decode ? h.img.decode().catch(function () {}) : null;
            preload(h, idx);
          }
        }
        h.mount.render(t);
      }
    }
    var c = rt.caps;
    if (c) {
      var layout = active ? active.layout : "full";
      var g = plan.geometry[layout];
      var shift = Math.round(g.captionY - c.y * 1920);
      c.root.style.transform = "translateY(" + shift + "px)";
      c.mount.render(t);
    }
    var l = rt.leak;
    if (l) {
      var env = leakEnvelope(t, l.times);
      l.root.style.opacity = String(env);
      if (env > 0) l.mount.render(t);
    }
    return pending;
  }

  window.FilmHook24 = { build: build, render: render, leakEnvelope: leakEnvelope };
})();
