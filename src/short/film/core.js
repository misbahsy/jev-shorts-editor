// core.js — Film runtime: template registry, fx helpers, DOM build, window.renderFrame.
// Determinism contract: every pixel is a pure function of `t`. No CSS transitions/animations,
// no timers, no Math.random (use Film.fx.hash). See CONTRACT.md.
(function () {
  "use strict";

  var Film = {
    _templates: {},
    _warnedUnknown: {},
    fx: null, // set below
    state: null, // set by init()
  };

  // ---------------------------------------------------------------------
  // fx helpers
  // ---------------------------------------------------------------------
  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function prog(lt, start, dur) {
    if (dur <= 0) return lt >= start ? 1 : 0;
    return clamp((lt - start) / dur, 0, 1);
  }
  var ease = {
    outCubic: function (p) {
      var q = 1 - p;
      return 1 - q * q * q;
    },
    outBack: function (p) {
      var c1 = 1.70158,
        c3 = c1 + 1;
      var q = p - 1;
      return 1 + c3 * q * q * q + c1 * q * q;
    },
    outExpo: function (p) {
      return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);
    },
    inOutCubic: function (p) {
      return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    },
  };
  // Deterministic string/number hash -> [0,1). djb2-ish.
  function hash(input) {
    var s = String(input);
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = (h * 33) ^ s.charCodeAt(i);
    }
    // unsigned, normalize
    return ((h >>> 0) % 100000) / 100000;
  }

  // fx.text is implemented in effects.js (attached to Film.fx.text once that file loads,
  // since it needs word/char span-splitting helpers that are effects-specific).
  Film.fx = {
    clamp: clamp,
    lerp: lerp,
    ease: ease,
    prog: prog,
    hash: hash,
    text: function () {
      throw new Error("Film.fx.text called before effects.js loaded");
    },
  };

  // ---------------------------------------------------------------------
  // template registry
  // ---------------------------------------------------------------------
  Film.registerTemplate = function (id, def) {
    Film._templates[id] = def;
  };

  // Film.util.fitText: shrinks el.style.fontSize (in 2px steps) until plain-text content
  // fits maxW/maxH, then returns the chosen size in px. Call during build() only (mount is
  // visible+laid out then); never per-frame (would reflow every frame, breaking determinism
  // of layout timing) — templates cache the returned size instead.
  Film.util = {
    fitText: function (elm, text, maxW, maxH, opts) {
      opts = opts || {};
      var max = opts.max || 160,
        min = opts.min || 36,
        lineHeight = opts.lineHeight || 1.05;
      elm.style.lineHeight = String(lineHeight);
      elm.style.display = "inline-block";
      elm.style.whiteSpace = opts.wrap === false ? "nowrap" : "normal";
      elm.style.wordBreak = "break-word";
      var size = max;
      elm.textContent = text;
      elm.style.fontSize = size + "px";
      while (size > min && (elm.scrollWidth > maxW || elm.scrollHeight > maxH)) {
        size -= 2;
        elm.style.fontSize = size + "px";
      }
      return size;
    },
  };

  // ---------------------------------------------------------------------
  // DOM build
  // ---------------------------------------------------------------------
  function el(tag, props) {
    var e = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (k === "style") {
          for (var sk in props.style) e.style[sk] = props.style[sk];
        } else {
          e[k] = props[k];
        }
      }
    }
    return e;
  }

  // Panel cards are authored at modest fixed px sizes; measure the SETTLED card once at build
  // and scale it (about its own center, re-centered in the content box) so it fills the panel.
  // Build-time only, so determinism holds.
  // Returns { s, apply } for one built candidate (null if it can't be measured or overflows).
  function measureFit(scaler, inner, def, rect, dur, ctx, strict) {
    try {
      def.update(inner, dur * 0.75, dur, ctx);
    } catch (err) {
      return null;
    }
    var base = scaler.getBoundingClientRect();
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    var all = inner.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (parseFloat(getComputedStyle(all[i]).opacity) === 0) continue;
      // text spilling out of its box (a card squeezed too narrow) disqualifies the candidate
      if (strict && all[i].clientWidth > 0 && all[i].scrollWidth > all[i].clientWidth + 2) return null;
      x0 = Math.min(x0, r.left - base.left);
      y0 = Math.min(y0, r.top - base.top);
      x1 = Math.max(x1, r.right - base.left);
      y1 = Math.max(y1, r.bottom - base.top);
    }
    if (!(x1 > x0) || !(y1 > y0)) return null;
    var s = clamp(Math.min((rect.w * 0.98) / (x1 - x0), (rect.h * 0.86) / (y1 - y0)), 0.5, 1.9);
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return {
      s: s,
      apply: function () {
        scaler.style.transformOrigin = cx + "px " + cy + "px";
        scaler.style.transform = "translate(" + (rect.w / 2 - cx) + "px," + (rect.h / 2 - cy) + "px) scale(" + s + ")";
      },
    };
  }

  // A row-shaped card already spans the panel width at scale 1, so scaling alone can't make its
  // type bigger. Build it at narrower VIRTUAL widths too (content reflows taller), and keep the
  // candidate whose fit scale — i.e. final type size — is largest.
  var VIRTUAL_WIDTHS = [1, 0.8, 0.66];

  function beatDur(b) {
    return Math.max(0.001, b.end - b.start);
  }

  function findActiveBeat(beats, t) {
    for (var i = 0; i < beats.length; i++) {
      var b = beats[i];
      if (t >= b.start && t < b.end) return b;
    }
    // clamp to last beat past end, first beat before start
    if (beats.length === 0) return null;
    if (t < beats[0].start) return beats[0];
    return beats[beats.length - 1];
  }

  Film.init = function (plan) {
    var root = document.getElementById("film");
    if (!root) {
      root = el("div", { id: "film" });
      document.body.appendChild(root);
    }
    root.style.position = "relative";
    root.style.width = "1080px";
    root.style.height = "1920px";
    root.style.overflow = "hidden";
    root.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.margin = "0";

    // theme tokens on #film
    window.FilmThemes.apply(root, plan.style.family, plan.style.accent);

    // ---- panel layer (opaque, only visible during split beats) ----
    var panelG = plan.geometry.split.panel;
    var panel = el("div", {
      id: "film-panel",
      style: {
        position: "absolute",
        left: panelG.x + "px",
        top: panelG.y + "px",
        width: panelG.w + "px",
        height: panelG.h + "px",
        background: "var(--panel-bg)",
        overflow: "hidden",
        opacity: "0",
      },
    });
    root.appendChild(panel);
    // Decorative atmosphere lives HERE, never inside a template mount — measureFit() walks the
    // mount subtree, so a full-panel decoration there would blow up the measured bbox.
    var backdrop = window.FilmThemes.buildPanelBackdrop(panel, plan.style.family, plan.style.accent);
    // The panel/speaker boundary is designed, not accidental: a short scrim carries the panel's
    // falloff over the top of the video plus an accent hairline. Height is clamped inside
    // buildSeam so it can never reach the padded face box.
    var seam = window.FilmThemes.buildSeam(root, plan.geometry, plan.style.family, plan.style.accent);

    // ---- mounts: one per beat with a visual ----
    var splitContent = { x: panelG.x + 60, y: panelG.y + 150, w: panelG.w - 120, h: 640 };
    var fullVisual = plan.geometry.full.visualRect;
    var mounts = []; // {beat, mountEl, def, ctx}
    plan.beats.forEach(function (beat) {
      if (!beat.visual) return;
      var def = Film._templates[beat.visual.template];
      if (!def) {
        if (!Film._warnedUnknown[beat.visual.template]) {
          Film._warnedUnknown[beat.visual.template] = true;
          console.warn("[Film] unknown template, skipping:", beat.visual.template);
        }
        return;
      }
      var rect = beat.layout === "split" ? splitContent : fullVisual;
      // ADDITIVE: visual.offset is a user-authored manual nudge (dx/dy, OUTPUT px) applied at the
      // UI level on top of the pipeline's computed placement. Applying it here — to the rect the
      // template is BUILT into — lets the template's own fitting/centering logic (measureFit,
      // fitText, etc.) do the right thing at the new position, rather than transforming the
      // rendered element after the fact and fighting that logic. A hand-edited plan.json could
      // carry an out-of-range offset, so the shifted rect is defensively clamped back inside the
      // 1080x1920 output frame. This is a pure function of plan data (no t, no randomness), so it
      // stays compatible with the determinism contract.
      if (beat.visual.offset) {
        var dx = beat.visual.offset.dx || 0;
        var dy = beat.visual.offset.dy || 0;
        rect = {
          x: clamp(rect.x + dx, 0, Math.max(0, 1080 - rect.w)),
          y: clamp(rect.y + dy, 0, Math.max(0, 1920 - rect.h)),
          w: rect.w,
          h: rect.h,
        };
      }
      var mount = el("div", {
        style: {
          position: "absolute",
          left: rect.x + "px",
          top: rect.y + "px",
          width: rect.w + "px",
          height: rect.h + "px",
        },
      });
      root.appendChild(mount);
      // Templates own `inner` completely (many assign inner.style.cssText / display:flex),
      // so positioning + show/hide live on the outer mount and the size is re-applied after build().
      var scaler = el("div", { style: { position: "absolute", left: "0", top: "0", width: rect.w + "px", height: rect.h + "px" } });
      mount.appendChild(scaler);
      var theme = window.FilmThemes.tokens(plan.style.family, plan.style.accent);
      function buildAt(k) {
        var w = Math.round(rect.w * k), h = Math.round(rect.h * k);
        var inner = el("div");
        scaler.textContent = "";
        scaler.style.transform = "";
        scaler.appendChild(inner);
        var ctx = {
          rect: { w: w, h: h },
          theme: theme,
          accent: "var(--accent)",
          energy: plan.style.energy || 0,
          fx: Film.fx,
          textEffect: beat.visual.textEffect,
        };
        try {
          // build with the mount visible & laid out so templates can measure/fit text
          // (scrollWidth/scrollHeight read 0 under display:none); hide immediately after.
          inner.style.position = "relative";
          inner.style.width = w + "px";
          inner.style.height = h + "px";
          def.build(inner, beat.visual.fields, ctx);
        } catch (err) {
          console.warn("[Film] template build failed:", beat.visual.template, err);
        }
        if (!inner.style.position) inner.style.position = "relative";
        inner.style.width = w + "px";
        inner.style.height = h + "px";
        inner.style.boxSizing = "border-box";
        return { inner: inner, ctx: ctx };
      }
      var built = null;
      if (beat.layout === "split") {
        var bestK = 1, bestS = -1;
        for (var ki = 0; ki < VIRTUAL_WIDTHS.length; ki++) {
          var cand = buildAt(VIRTUAL_WIDTHS[ki]);
          var fit = measureFit(scaler, cand.inner, def, rect, beatDur(beat), cand.ctx, VIRTUAL_WIDTHS[ki] < 1);
          if (fit && fit.s > bestS + 0.05) {
            bestS = fit.s;
            bestK = VIRTUAL_WIDTHS[ki];
          }
        }
        built = buildAt(bestK);
        var finalFit = measureFit(scaler, built.inner, def, rect, beatDur(beat), built.ctx);
        if (finalFit) finalFit.apply();
      } else {
        built = buildAt(1);
      }
      mount.style.display = "none";
      mounts.push({ beat: beat, mount: mount, inner: built.inner, def: def, ctx: built.ctx });
    });

    // ---- captions layer ----
    var captionsLayer = el("div", {
      id: "film-captions",
      style: { position: "absolute", left: "0", top: "0", width: "1080px", height: "1920px", pointerEvents: "none" },
    });
    root.appendChild(captionsLayer);
    var captionRuntime = window.FilmCaptions.build(captionsLayer, plan);
    // engine caption styles (24fps) are drawn by hook24.js; captions.js goes dark while one is in force

    // ---- 24fps layers: opening hook (behind the speaker), engine captions, light leaks ----
    var hook24 = window.FilmHook24 ? window.FilmHook24.build(root, plan) : null;

    // ---- transition layer ----
    var transitionLayer = el("div", {
      id: "film-transition",
      style: {
        position: "absolute",
        left: "0",
        top: "0",
        width: "1080px",
        height: "1920px",
        pointerEvents: "none",
        zIndex: "50",
      },
    });
    root.appendChild(transitionLayer);
    window.FilmTransitions.build(transitionLayer, plan);

    // ---- progress bar ----
    var progressBar = null;
    if (plan.style.progressBar) {
      var track = el("div", {
        style: {
          position: "absolute",
          left: "60px",
          top: "20px",
          width: "960px",
          height: "8px",
          borderRadius: "999px",
          background: "rgba(255,255,255,0.16)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.10), 0 2px 10px rgba(0,0,0,0.35)",
          overflow: "hidden",
          zIndex: "60",
        },
      });
      var fill = el("div", {
        style: {
          position: "absolute",
          left: "0",
          top: "0",
          bottom: "0",
          width: "0%",
          background: "var(--accent-grad)",
          borderRadius: "999px",
          boxShadow: "0 0 18px -2px var(--accent-glow)",
        },
      });
      track.appendChild(fill);
      root.appendChild(track);
      progressBar = fill;
    }

    var duration = plan.source.durationSec;
    Film.state = { plan: plan, mounts: mounts, panel: panel, captionRuntime: captionRuntime, progressBar: progressBar, duration: duration, panelG: panelG };

    window.renderFrame = function (t) {
      t = clamp(t, 0, duration);
      var active = findActiveBeat(plan.beats, t);
      var activeIsSplit = active && active.layout === "split";
      panel.style.opacity = activeIsSplit ? "1" : "0";
      if (seam) seam.style.opacity = activeIsSplit ? "1" : "0";
      // atmosphere is a pure function of t; only stepped while the panel is on screen
      if (activeIsSplit && backdrop) backdrop.update(t);

      for (var i = 0; i < mounts.length; i++) {
        var m = mounts[i];
        var isActive = active && m.beat.id === active.id;
        // a card that starts inside the opening hook only appears once the hook is over
        var from = typeof m.beat.visualFrom === "number" ? m.beat.visualFrom : m.beat.start;
        if (isActive && t >= from) {
          m.mount.style.display = "block";
          var lt = t - from;
          var dur = Math.max(0.1, m.beat.end - from);
          try {
            m.def.update(m.inner, lt, dur, m.ctx);
          } catch (err) {
            /* keep deterministic even if a template throws */
          }
        } else {
          m.mount.style.display = "none";
        }
      }

      window.FilmCaptions.render(captionRuntime, t, active, plan);
      window.FilmTransitions.render(transitionLayer, t, plan);
      var pending = hook24 ? window.FilmHook24.render(hook24, t, active, plan) : null;

      if (progressBar) {
        progressBar.style.width = duration > 0 ? (clamp(t / duration, 0, 1) * 100 + "%") : "0%";
      }
      // a Promise only while an fg cut-out frame is still decoding; the sidecar awaits it
      return pending || undefined;
    };

    if (hook24) {
      // fonts for the engine layers are embedded as data URIs; wait until they are usable
      hook24.ready.then(
        function () { window.__filmReady = true; },
        function () { window.__filmReady = true; }
      );
    } else {
      window.__filmReady = true;
    }
  };

  window.Film = Film;
})();
