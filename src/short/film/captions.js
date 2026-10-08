// captions.js — all 5 CaptionStyleIds, driven by plan.words. Chunks of 2-3 words are
// precomputed once (deterministic); each frame picks the active chunk/word from `t`.
(function () {
  "use strict";
  var clamp = window.Film.fx.clamp,
    ease = window.Film.fx.ease;

  function buildChunks(words) {
    var chunks = [];
    var cur = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      cur.push(w);
      var text = (w.text || "").trim();
      var endsPunct = /[.,!?;:]$/.test(text);
      var next = words[i + 1];
      var bigGap = next && next.start - w.end > 0.35;
      var atMax = cur.length >= 3;
      if (atMax || endsPunct || bigGap || !next) {
        chunks.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
        cur = [];
      }
    }
    if (cur.length) chunks.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    return chunks;
  }

  function findChunkIndex(chunks, t) {
    for (var i = 0; i < chunks.length; i++) {
      var c = chunks[i];
      var nextStart = i + 1 < chunks.length ? chunks[i + 1].start : Infinity;
      if (t >= c.start && t < nextStart && t <= c.end + 0.6) return i;
    }
    return -1;
  }

  function fitFontSize(text) {
    var len = Math.max(6, text.length);
    return clamp(Math.round(1620 / len), 60, 118);
  }

  // Word tokens arrive from two different ASR conventions: parakeet marks a word boundary with
  // a LEADING space on the token, while the finalized plans in this spike carry bare words with
  // no spacing at all. Joining on "" is only correct for the first of those — on the second it
  // produced "1.6betweenfrustrated" in typewriter_line (the one style that renders the raw
  // string rather than per-word spans). Insert the separator only where one is missing.
  function chunkText(chunk) {
    return chunk.words
      .map(function (w, i) {
        var s = String(w.text || "");
        if (i === 0) return s.replace(/^\s+/, "");
        return /^\s/.test(s) ? s : " " + s;
      })
      .join("")
      .trim();
  }

  // Captions sit on the VIDEO, never on the panel, so they cannot inherit --text: a light
  // family's ink-dark --text would vanish against footage. They get their own token pair
  // (--cap-fg / --cap-stroke) which themes.js may override per family; the fallbacks here are
  // the universal creator-caption look, white on a dark stroke.
  var CAP_FG = "var(--cap-fg, #fff)";
  var CAP_DIM = "var(--cap-dim, rgba(255,255,255,.55))";

  function wordColor(w, active) {
    if (w.emph) return "var(--accent)";
    return active ? CAP_FG : CAP_DIM;
  }

  // Legibility base applied to every style. Three things do the work:
  //  - a real stroke with `paint-order: stroke fill`, so the outline is painted BEHIND the
  //    glyph and never thins the letterform (a stroke painted over the fill is the tell-tale
  //    2019 caption look);
  //  - a tight contact shadow that welds the word to the frame, plus a wide soft one that
  //    lifts it off busy footage;
  //  - weight 900 and negative tracking so the line reads as one confident block.
  function baseWordStyle(span) {
    span.style.display = "inline-block";
    span.style.textShadow =
      "0 2px 0 rgba(0,0,0,.34), 0 4px 3px rgba(0,0,0,.38), 0 10px 18px rgba(0,0,0,.55)";
    span.style.webkitTextStroke = "var(--cap-stroke, 3px rgba(0,0,0,.72))";
    span.style.paintOrder = "stroke fill";
    span.style.padding = "0 0.04em";
    // no CSS transition anywhere in the film: every frame is an independent render
    span.style.transition = "none";
    span.style.willChange = "transform";
  }

  function buildRoot(container, chunk, styleId, plan) {
    var root = document.createElement("div");
    root.style.textAlign = "center";
    root.style.fontFamily = styleId === "typewriter_line" ? "var(--font-mono)" : "var(--font-display)";
    root.style.fontWeight = "var(--cap-weight, 900)";
    root.style.letterSpacing = styleId === "typewriter_line" ? "-0.01em" : "-0.028em";
    root.style.textTransform = styleId === "single_word" ? "var(--display-case)" : "none";
    var txt = chunkText(chunk);
    var size =
      styleId === "single_word"
        ? Math.max(132, fitFontSize(longestWord(chunk)))
        : styleId === "typewriter_line"
          ? Math.round(fitFontSize(txt) * 0.82) // mono runs ~20% wider per character
          : styleId === "boxed_highlight"
            ? Math.round(fitFontSize(txt) * 0.9) // the pill padding eats ~10% of the line width
            : fitFontSize(txt);
    root.style.fontSize = size + "px";
    root.style.lineHeight = "1.06";

    var spans = chunk.words.map(function (w, i) {
      var span = document.createElement("span");
      baseWordStyle(span);
      // words arrive with a leading space marking a new-word boundary (parakeet token
      // convention); trim it and use an explicit margin instead of relying on the space
      // surviving inside a display:inline-block box, which browsers collapse away.
      span.textContent = w.text.replace(/^\s+/, "");
      if (i > 0) span.style.marginLeft = "0.3em";
      return span;
    });

    if (styleId === "boxed_highlight") {
      // The pill's padding is applied to EVERY word and never changes — only the background
      // and the ink colour are toggled per frame. If the active word grew its own padding the
      // whole line would reflow on every word boundary and the caption would visibly jitter.
      spans.forEach(function (span, i) {
        span.style.padding = "0.06em 0.22em 0.1em";
        span.style.borderRadius = "var(--cap-pill-radius, 0.18em)";
        if (i > 0) span.style.marginLeft = "0.1em";
      });
    }
    if (styleId === "single_word") {
      // one word on screen at a time: it can afford to be huge and optically centred
      root.style.letterSpacing = "-0.04em";
    }
    if (styleId === "typewriter_line") {
      root.style.whiteSpace = "pre-wrap";
      // fx.text rebuilds this subtree, so the legibility treatment has to live on the root
      // where it will be inherited rather than on the word spans, which get thrown away.
      root.style.color = CAP_FG;
      root.style.webkitTextStroke = "var(--cap-stroke, 3px rgba(0,0,0,.72))";
      root.style.paintOrder = "stroke fill";
      root.style.textShadow =
        "0 2px 0 rgba(0,0,0,.34), 0 4px 3px rgba(0,0,0,.38), 0 10px 18px rgba(0,0,0,.55)";
      root.style.fontWeight = "var(--cap-weight-mono, 700)";
    }

    spans.forEach(function (s) { root.appendChild(s); });
    container.textContent = "";
    container.appendChild(root);
    return { root: root, spans: spans };
  }

  function longestWord(chunk) {
    var best = "";
    chunk.words.forEach(function (w) {
      var t = w.text.trim();
      if (t.length > best.length) best = t;
    });
    return best || "-";
  }

  function build(layer, plan) {
    var chunks = buildChunks(plan.words || []);
    var container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "540px";
    container.style.width = "900px";
    container.style.transform = "translate(-50%,-50%)";
    container.style.zIndex = "40";
    container.style.color = "var(--cap-fg, #fff)";
    container.style.opacity = "0";
    container.style.pointerEvents = "none";
    layer.appendChild(container);
    return { chunks: chunks, container: container, builtIdx: -1, builtStyle: null, built: null };
  }

  // The style in force at t: the planned section's style (Jev may switch at section boundaries),
  // else the plan-wide style. Pure function of t.
  function styleAt(plan, t) {
    var secs = plan.captionSections;
    if (secs && secs.length) {
      for (var i = 0; i < secs.length; i++) {
        if (t >= secs[i].start - 1e-6 && t < secs[i].end - 1e-6) return secs[i].style;
      }
      return secs[secs.length - 1].style;
    }
    return plan.style.captionStyle;
  }

  function render(runtime, t, activeBeat, plan) {
    var layout = activeBeat ? activeBeat.layout : "full";
    var g = plan.geometry[layout];
    var captionY = clamp(g.captionY, 150, 1580);
    runtime.container.style.top = captionY + "px";

    var idx = findChunkIndex(runtime.chunks, t);
    if (idx < 0) {
      runtime.container.style.opacity = "0";
      return;
    }
    var chunk = runtime.chunks[idx];
    var styleId = styleAt(plan, t);
    // engine (24fps) caption styles are drawn by hook24.js; this layer stays dark for them
    var eng = window.__FILM24 && window.__FILM24.captions;
    if (eng) {
      for (var ei = 0; ei < eng.length; ei++) {
        if (eng[ei].style === styleId) {
          runtime.container.style.opacity = "0";
          return;
        }
      }
    }

    if (runtime.builtIdx !== idx || runtime.builtStyle !== styleId) {
      runtime.built = buildRoot(runtime.container, chunk, styleId, plan);
      runtime.builtIdx = idx;
      runtime.builtStyle = styleId;
      if (styleId === "typewriter_line") {
        runtime.built.twHandle = window.Film.fx.text(runtime.built.root, chunkText(chunk), "typewriter");
      }
    }
    var built = runtime.built;

    // entrance fade for the chunk itself (keeps cuts between chunks from popping harshly)
    var chunkP = clamp((t - chunk.start) / 0.12, 0, 1);
    runtime.container.style.opacity = String(chunkP);

    switch (styleId) {
      case "word_pop": {
        built.spans.forEach(function (span, i) {
          var w = chunk.words[i];
          // whole chunk stays visible (so the line is always centered); the spoken word
          // pops in accent, upcoming words wait in white.
          var next = chunk.words[i + 1];
          var active = t >= w.start && t < (next ? next.start : w.end + 0.25);
          var onset = clamp((t - w.start) / 0.14, 0, 1);
          var e = ease.outBack(onset);
          span.style.color = active || w.emph ? "var(--accent)" : CAP_FG;
          span.style.opacity = "1";
          var scale = active ? lerp3(1, w.emph ? 1.12 : 1.08, e) : 1;
          span.style.transform = "translateY(" + (active ? (1 - e) * 10 : 0) + "px) scale(" + scale + ")";
          // the live word gets an accent halo on top of the base shadows — this is the one
          // place a glow is worth its cost, and it is at most 3 spans.
          span.style.textShadow = active
            ? "0 2px 0 rgba(0,0,0,.34), 0 4px 3px rgba(0,0,0,.38), 0 0 24px var(--accent-glow), 0 10px 18px rgba(0,0,0,.55)"
            : "0 2px 0 rgba(0,0,0,.34), 0 4px 3px rgba(0,0,0,.38), 0 10px 18px rgba(0,0,0,.55)";
        });
        break;
      }
      case "single_word": {
        var activeIdx = -1;
        for (var i = 0; i < chunk.words.length; i++) if (t >= chunk.words[i].start) activeIdx = i;
        if (activeIdx < 0) activeIdx = 0;
        built.spans.forEach(function (span, i) {
          span.style.display = i === activeIdx ? "inline-block" : "none";
        });
        var aw = chunk.words[activeIdx];
        var onsetSW = clamp((t - aw.start) / 0.16, 0, 1);
        var eSW = ease.outBack(onsetSW);
        var span0 = built.spans[activeIdx];
        span0.style.color = wordColor(aw, true);
        span0.style.opacity = String(clamp(onsetSW * 1.3, 0, 1));
        // a punch, not a zoom: 0.72 -> 1 on outBack lands with weight; 0.5 read as a cheap
        // PowerPoint entrance at this size.
        span0.style.transform =
          "translateY(" + (1 - eSW) * 14 + "px) scale(" + lerp3(0.72, 1, eSW) + ")";
        span0.style.textShadow =
          "0 3px 0 rgba(0,0,0,.4), 0 6px 4px rgba(0,0,0,.4), 0 0 32px var(--accent-glow), 0 12px 22px rgba(0,0,0,.6)";
        break;
      }
      case "karaoke_line": {
        built.spans.forEach(function (span, i) {
          var w = chunk.words[i];
          // text-decoration:underline is the dated tell here. A background-image bar sized in
          // PERCENT gives a real swipe that wipes across the word as it is spoken, and because
          // background painting never affects layout the line cannot reflow mid-word.
          var wp = clamp((t - w.start) / Math.max(0.08, w.end - w.start), 0, 1);
          var spoken = t >= w.end;
          var active = !spoken && t >= w.start;
          span.style.color = w.emph ? "var(--accent)" : spoken || active ? CAP_FG : CAP_DIM;
          // colour alone carries "not yet spoken" — stacking an opacity fade on top of a
          // already-translucent CAP_DIM made upcoming words genuinely hard to read.
          span.style.opacity = "1";
          span.style.transform = active ? "scale(" + lerp3(1, w.emph ? 1.1 : 1.05, ease.outCubic(Math.min(1, wp * 3))) + ")" : "scale(1)";
          // --accent-grad is already a complete gradient VALUE, so it is assigned directly.
          // Nesting it inside linear-gradient(...) silently invalidates the whole declaration
          // and the swipe bar simply never paints.
          span.style.backgroundImage = "var(--accent-grad)";
          span.style.backgroundRepeat = "no-repeat";
          span.style.backgroundPosition = "0 100%";
          span.style.backgroundSize = Math.round(wp * 100) + "% 0.1em";
        });
        break;
      }
      case "boxed_highlight": {
        built.spans.forEach(function (span, i) {
          var w = chunk.words[i];
          var active = t >= w.start && t < w.end + 0.05;
          var onsetB = clamp((t - w.start) / 0.12, 0, 1);
          span.style.color = active ? "var(--accent-ink)" : CAP_FG;
          span.style.background = active ? "var(--accent-grad)" : "transparent";
          // on the accent pill the dark stroke would smear the ink — drop it, the pill itself
          // is the contrast. The glow rides the pill, not the text.
          span.style.webkitTextStroke = active ? "0" : "var(--cap-stroke, 3px rgba(0,0,0,.72))";
          span.style.boxShadow = active
            ? "0 8px 18px -8px var(--accent-glow), 0 3px 0 rgba(0,0,0,.28)"
            : "none";
          span.style.transform = active
            ? "translateY(" + (1 - ease.outBack(onsetB)) * 6 + "px) scale(" + lerp3(1, 1.05, ease.outBack(onsetB)) + ")"
            : "scale(1)";
        });
        break;
      }
      case "typewriter_line": {
        var dur = Math.max(0.2, chunk.end - chunk.start + 0.15);
        var p = clamp((t - chunk.start) / dur, 0, 1);
        if (built.twHandle) built.twHandle.update(p);
        break;
      }
      default:
        break;
    }
  }

  function lerp3(a, b, p) {
    return a + (b - a) * p;
  }

  window.FilmCaptions = { build: build, render: render, styleAt: styleAt, _buildChunks: buildChunks };
})();
