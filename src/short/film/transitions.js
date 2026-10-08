// transitions.js — the 6 TransitionIds as full-frame overlays centered on beat.start,
// window ~= [-0.13s, +0.2s]. They mask the hard layout switch ffmpeg does underneath.
(function () {
  "use strict";
  var clamp = window.Film.fx.clamp,
    lerp = window.Film.fx.lerp,
    hash = window.Film.fx.hash;

  var WIN_PRE = 0.13,
    WIN_POST = 0.2,
    WIN_TOTAL = WIN_PRE + WIN_POST;

  function envelope(lt) {
    // triangular: 0 at edges of the window, 1 exactly at the cut (lt=0)
    if (lt < -WIN_PRE || lt > WIN_POST) return 0;
    if (lt < 0) return clamp((lt + WIN_PRE) / WIN_PRE, 0, 1);
    return clamp(1 - lt / WIN_POST, 0, 1);
  }
  function sweep(lt) {
    return clamp((lt + WIN_PRE) / WIN_TOTAL, 0, 1);
  }

  function build(layer, plan) {
    layer.style.mixBlendMode = "normal";

    var flash = document.createElement("div");
    Object.assign(flash.style, full(), { background: "#ffffff", opacity: "0" });

    var whip = document.createElement("div");
    Object.assign(whip.style, full(), { opacity: "0", overflow: "hidden" });
    var whipBars = [];
    for (var i = 0; i < 7; i++) {
      var bar = document.createElement("div");
      Object.assign(bar.style, {
        position: "absolute",
        left: "-10%",
        width: "120%",
        height: 40 + (i % 3) * 18 + "px",
        top: (i / 7) * 1920 + "px",
        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)",
        transform: "skewY(-6deg)",
      });
      whip.appendChild(bar);
      whipBars.push(bar);
    }

    var glass = document.createElement("div");
    Object.assign(glass.style, full(), { opacity: "0", overflow: "hidden" });
    var glassBand = document.createElement("div");
    Object.assign(glassBand.style, {
      position: "absolute",
      top: "-10%",
      height: "120%",
      width: "46%",
      background: "linear-gradient(100deg, rgba(255,255,255,0.05), rgba(255,255,255,0.55), rgba(255,255,255,0.05))",
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      transform: "skewX(-14deg)",
    });
    glass.appendChild(glassBand);

    var zoom = document.createElement("div");
    Object.assign(zoom.style, full(), { opacity: "0" });
    var zoomRing = document.createElement("div");
    Object.assign(zoomRing.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: "1600px",
      height: "1600px",
      marginLeft: "-800px",
      marginTop: "-800px",
      borderRadius: "50%",
      background: "radial-gradient(circle, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.15) 35%, transparent 62%)",
    });
    zoom.appendChild(zoomRing);

    var glitch = document.createElement("div");
    Object.assign(glitch.style, full(), { opacity: "0", overflow: "hidden" });
    var glitchSlices = [];
    var sliceCount = 9;
    for (var s = 0; s < sliceCount; s++) {
      var sl = document.createElement("div");
      var h = 1920 / sliceCount;
      var tint = s % 3 === 0 ? "rgba(0,255,255,0.28)" : s % 3 === 1 ? "rgba(255,0,140,0.24)" : "rgba(255,255,255,0.14)";
      Object.assign(sl.style, {
        position: "absolute",
        left: "0",
        top: s * h + "px",
        width: "100%",
        height: h + 1 + "px",
        background: tint,
      });
      glitch.appendChild(sl);
      glitchSlices.push(sl);
    }

    layer.appendChild(flash);
    layer.appendChild(whip);
    layer.appendChild(glass);
    layer.appendChild(zoom);
    layer.appendChild(glitch);

    return {
      flash: flash,
      whip: { el: whip, bars: whipBars },
      glass: { el: glass, band: glassBand },
      zoom: { el: zoom, ring: zoomRing },
      glitch: { el: glitch, slices: glitchSlices },
      all: [flash, whip, glass, zoom, glitch],
    };
  }

  function full() {
    return { position: "absolute", left: "0", top: "0", width: "1080px", height: "1920px" };
  }

  var HANDLES = null;

  function hideAll() {
    if (!HANDLES) return;
    HANDLES.all.forEach(function (e) {
      e.style.opacity = "0";
    });
  }

  function findActiveTransition(plan, t) {
    // the fine-grained shot layer owns transitions; older plans only have beats
    var beats = plan.shots && plan.shots.length ? plan.shots : plan.beats;
    for (var i = 0; i < beats.length; i++) {
      var b = beats[i];
      var lt = t - b.start;
      if (lt >= -WIN_PRE && lt <= WIN_POST) return { beat: b, lt: lt };
    }
    return null;
  }

  function render(layer, t, plan) {
    if (!HANDLES) HANDLES = layer.__filmTransitionHandles;
    var hit = findActiveTransition(plan, t);
    if (!hit || hit.beat.transitionIn === "hard_cut") {
      hideAll();
      return;
    }
    var lt = hit.lt;
    var p = envelope(lt);
    var sw = sweep(lt);
    var seed = hit.beat.id || String(hit.beat.start);

    hideAll();
    switch (hit.beat.transitionIn) {
      case "flash": {
        HANDLES.flash.style.opacity = String(p);
        break;
      }
      case "whip_streak": {
        HANDLES.whip.el.style.opacity = String(p);
        HANDLES.whip.bars.forEach(function (bar, i) {
          var off = lerp(-1400, 1400, sw) + i * 30;
          bar.style.transform = "translateX(" + off + "px) skewY(-6deg)";
          bar.style.filter = "blur(" + (2 + (1 - p) * 6) + "px)";
        });
        break;
      }
      case "glass_wipe": {
        HANDLES.glass.el.style.opacity = String(clamp(p * 1.1, 0, 1));
        var x = lerp(-30, 110, sw);
        HANDLES.glass.band.style.left = x + "%";
        break;
      }
      case "zoom_blur": {
        HANDLES.zoom.el.style.opacity = String(p);
        var scale = lerp(0.5, 1.6, sw);
        HANDLES.zoom.ring.style.transform = "scale(" + scale + ")";
        break;
      }
      case "glitch_slice": {
        HANDLES.glitch.el.style.opacity = String(p);
        HANDLES.glitch.slices.forEach(function (sl, i) {
          var hsh = hash(seed + ":" + i);
          var dir = hsh > 0.5 ? 1 : -1;
          sl.style.transform = "translateX(" + dir * (10 + hsh * 70) * p + "px)";
        });
        break;
      }
      default:
        break;
    }
  }

  window.FilmTransitions = {
    build: function (layer, plan) {
      var h = build(layer, plan);
      layer.__filmTransitionHandles = h;
      HANDLES = h;
      return h;
    },
    render: render,
  };
})();
