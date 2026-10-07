// effects.js — Film.fx.text(el, string, effectId) for all 8 TextEffectIds.
// Deterministic: reveal state is a pure function of `p` (0..1). Layout-stable: only
// opacity/transform/filter/clip-path/width(of an absolutely-positioned overlay) animate —
// never font-size/box size of the text itself, so later frames never reflow relative to earlier ones.
(function () {
  "use strict";
  var fx = window.Film.fx;
  var clamp = fx.clamp,
    lerp = fx.lerp,
    ease = fx.ease,
    hash = fx.hash;

  function splitWords(el, string) {
    el.textContent = "";
    var parts = string.split(/(\s+)/).filter(function (w) {
      return w.length > 0;
    });
    var spans = [];
    parts.forEach(function (w) {
      if (/^\s+$/.test(w)) {
        el.appendChild(document.createTextNode(w));
        return;
      }
      var span = document.createElement("span");
      span.style.display = "inline-block";
      span.style.willChange = "transform,opacity,filter";
      span.textContent = w;
      el.appendChild(span);
      spans.push(span);
    });
    return spans;
  }

  // Chars are grouped into nowrap word boxes so a line can only break BETWEEN words.
  function splitChars(el, string) {
    el.textContent = "";
    var spans = [];
    var wordBox = null;
    for (var i = 0; i < string.length; i++) {
      var ch = string[i];
      var span = document.createElement("span");
      span.style.display = "inline-block";
      span.style.willChange = "transform,opacity,filter";
      span.dataset.ch = ch;
      if (ch === " ") {
        span.style.display = "inline";
        span.textContent = " ";
        wordBox = null;
        el.appendChild(span);
      } else {
        if (!wordBox) {
          wordBox = document.createElement("span");
          wordBox.style.display = "inline-block";
          wordBox.style.whiteSpace = "nowrap";
          el.appendChild(wordBox);
        }
        span.textContent = ch;
        wordBox.appendChild(span);
      }
      spans.push(span);
    }
    return spans;
  }

  var SCRAMBLE_GLYPHS = "#%*+=-<>/\\|~^ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  function fxText(el, string, effectId) {
    el.style.overflow = "visible";
    var handle;
    switch (effectId) {
      case "typewriter": {
        var chars = splitChars(el, string);
        var n = Math.max(1, chars.length);
        // THE CARET RIDES THE LAST TYPED GLYPH, NOT THE ELEMENT.
        // It used to be a right border on `el` itself. But untyped chars are hidden with
        // opacity:0 and never display:none — deliberately, so the line cannot reflow
        // mid-reveal — which means `el` is a full-width line box from the first frame. The
        // caret therefore rendered marooned at the far right of the caption's 900px line
        // while the text was still three words in. Carrying it on the char spans puts it
        // where a cursor actually belongs.
        var caretOn = null;
        var clearCaret = function () {
          if (!caretOn) return;
          caretOn.style.borderRight = "";
          caretOn.style.marginRight = "";
          caretOn = null;
        };
        handle = {
          update: function (p) {
            var reveal = p * n;
            for (var i = 0; i < chars.length; i++) chars[i].style.opacity = i < reveal ? "1" : "0";
            clearCaret();
            if (p >= 1) return; // typing finished — no cursor left behind
            var typed = Math.floor(reveal);
            if (typed <= 0) return; // nothing typed yet; a caret on an opacity:0 span is invisible anyway
            caretOn = chars[Math.min(typed, chars.length) - 1];
            // The negative margin cancels the border's advance width EXACTLY, so adding the
            // caret and stepping it along the line can never nudge the glyphs after it.
            caretOn.style.borderRight = "0.09em solid var(--accent)";
            caretOn.style.marginRight = "-0.09em";
          },
        };
        break;
      }
      case "scramble_decode": {
        var schars = splitChars(el, string);
        var sn = Math.max(1, schars.length - 1);
        handle = {
          update: function (p) {
            for (var i = 0; i < schars.length; i++) {
              var real = schars[i].dataset.ch;
              if (real === " ") continue;
              var threshold = 0.1 + 0.75 * (i / sn);
              if (p >= threshold) {
                schars[i].textContent = real;
              } else if (p <= 0.01) {
                schars[i].textContent = real;
                schars[i].style.opacity = "0.0001"; // reserve layout, invisible
              } else {
                var seed = hash(i + ":" + real + ":" + Math.floor(p * 24));
                schars[i].textContent = SCRAMBLE_GLYPHS[Math.floor(seed * SCRAMBLE_GLYPHS.length)];
                schars[i].style.opacity = "1";
              }
              if (p > 0.01) schars[i].style.opacity = "1";
            }
          },
        };
        break;
      }
      case "word_pop": {
        var wwords = splitWords(el, string);
        var wn = Math.max(1, wwords.length);
        handle = {
          update: function (p) {
            for (var i = 0; i < wwords.length; i++) {
              var start = (i / wn) * 0.55;
              var wp = clamp((p - start) / 0.45, 0, 1);
              var e = ease.outBack(wp);
              wwords[i].style.opacity = String(clamp(wp * 1.5, 0, 1));
              wwords[i].style.transform = "translateY(" + (1 - e) * 18 + "px) scale(" + lerp(0.6, 1, e) + ")";
            }
          },
        };
        break;
      }
      case "slide_up": {
        var swords = splitWords(el, string);
        var sn2 = Math.max(1, swords.length);
        handle = {
          update: function (p) {
            for (var i = 0; i < swords.length; i++) {
              var start = (i / sn2) * 0.5;
              var wp = clamp((p - start) / 0.5, 0, 1);
              var e = ease.outCubic(wp);
              swords[i].style.opacity = String(e);
              swords[i].style.transform = "translateY(" + (1 - e) * 30 + "px)";
            }
          },
        };
        break;
      }
      case "blur_in": {
        var bwords = splitWords(el, string);
        var bn = Math.max(1, bwords.length);
        handle = {
          update: function (p) {
            for (var i = 0; i < bwords.length; i++) {
              var start = (i / bn) * 0.5;
              var wp = clamp((p - start) / 0.5, 0, 1);
              var e = ease.outCubic(wp);
              bwords[i].style.opacity = String(e);
              bwords[i].style.filter = "blur(" + (1 - e) * 12 + "px)";
            }
          },
        };
        break;
      }
      case "highlighter_swipe": {
        el.textContent = "";
        var wrap = document.createElement("span");
        wrap.style.position = "relative";
        wrap.style.display = "inline-block";
        var mark = document.createElement("span");
        mark.style.position = "absolute";
        mark.style.left = "-3%";
        mark.style.top = "10%";
        mark.style.bottom = "4%";
        mark.style.background = "var(--accent)";
        mark.style.opacity = "0.38";
        mark.style.borderRadius = "0.15em";
        mark.style.width = "0%";
        mark.style.zIndex = "0";
        var txt = document.createElement("span");
        txt.style.position = "relative";
        txt.style.zIndex = "1";
        txt.textContent = string;
        wrap.appendChild(mark);
        wrap.appendChild(txt);
        el.appendChild(wrap);
        handle = {
          update: function (p) {
            txt.style.opacity = String(clamp(p / 0.2, 0, 1));
            var swipeP = ease.outCubic(clamp((p - 0.08) / 0.7, 0, 1));
            mark.style.width = swipeP * 106 + "%";
          },
        };
        break;
      }
      case "scale_punch": {
        var pwords = splitWords(el, string);
        var pn = Math.max(1, pwords.length);
        handle = {
          update: function (p) {
            for (var i = 0; i < pwords.length; i++) {
              var start = (i / pn) * 0.3;
              var wp = clamp((p - start) / 0.5, 0, 1);
              var e = ease.outBack(wp);
              pwords[i].style.opacity = String(clamp(wp * 1.6, 0, 1));
              pwords[i].style.transform = "scale(" + lerp(1.7, 1, e) + ")";
            }
          },
        };
        break;
      }
      case "mask_reveal": {
        el.textContent = "";
        var mwrap = document.createElement("span");
        mwrap.style.display = "inline-block";
        mwrap.style.clipPath = "inset(0 0 100% 0)";
        mwrap.textContent = string;
        el.appendChild(mwrap);
        handle = {
          update: function (p) {
            var e = ease.outExpo(p);
            mwrap.style.clipPath = "inset(0 0 " + (1 - e) * 100 + "% 0)";
          },
        };
        break;
      }
      default: {
        el.textContent = string;
        handle = { update: function () {} };
      }
    }
    handle.update(0);
    return handle;
  }

  window.Film.fx.text = fxText;
})();
