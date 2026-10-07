// THROWAWAY harness stub of the film/core.js + themes.js + effects.js contract
// (see short/CONTRACT.md "Film page API"). NOT shipped. The real core.js/themes.js/
// effects.js are being written concurrently by another agent; this file exists only
// so templates can be built + visually verified in isolation before that lands.
//
// Implements: Film.registerTemplate, Film.fx (clamp/lerp/ease/prog/hash/text),
// two theme token sets (apple_glass, bold_kinetic), and window.renderFrame(t)
// driven by a single-beat __PLAN fixture that harness.ts writes into the page.

(function () {
  "use strict";

  const registry = {};

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function prog(lt, start, dur) {
    if (dur <= 0) return 1;
    return clamp((lt - start) / dur, 0, 1);
  }
  // seeded hash -> 0..1, string or number in.
  function hash(input) {
    const s = String(input);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = (h ^ (h >>> 15)) >>> 0;
    return (h % 100000) / 100000;
  }
  const ease = {
    outCubic: (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3),
    outBack: (t) => {
      t = clamp(t, 0, 1);
      const c1 = 1.70158,
        c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    outExpo: (t) => {
      t = clamp(t, 0, 1);
      return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    },
    inOutCubic: (t) => {
      t = clamp(t, 0, 1);
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
  };

  // Splits `string` into per-unit spans (word or char depending on effect) inside el,
  // returns a handle whose update(p) (0..1 reveal progress) applies the TextEffectId.
  function text(el, string, effectId) {
    el.textContent = "";
    el.style.display = "inline-block";
    const words = String(string).split(/\s+/).filter(Boolean);
    const spans = words.map((w, i) => {
      const span = document.createElement("span");
      span.textContent = w + (i < words.length - 1 ? " " : "");
      span.style.display = "inline-block";
      span.style.willChange = "transform, opacity, filter";
      el.appendChild(span);
      return span;
    });
    const n = Math.max(1, spans.length);

    function update(p) {
      p = clamp(p, 0, 1);
      // stagger each word's own local progress across the overall reveal, but
      // anchor windows so the LAST word's window still ends exactly at p=1
      // (otherwise trailing words never reach full opacity/scale/etc).
      const wDur = n > 1 ? clamp(1.6 / n, 0.15, 1) : 1;
      spans.forEach((span, i) => {
        const wStart = n > 1 ? (i / (n - 1)) * (1 - wDur) : 0;
        const wp = clamp((p - wStart) / wDur, 0, 1);
        switch (effectId) {
          case "typewriter": {
            span.style.opacity = wp > 0 ? "1" : "0";
            span.style.clipPath = wp >= 1 ? "none" : `inset(0 ${100 - wp * 100}% 0 0)`;
            span.style.transform = "none";
            span.style.filter = "none";
            break;
          }
          case "word_pop": {
            const e = ease.outBack(wp);
            span.style.opacity = String(wp);
            span.style.transform = `scale(${lerp(0.5, 1, e)}) translateY(${lerp(10, 0, wp)}px)`;
            span.style.filter = "none";
            break;
          }
          case "slide_up": {
            const e = ease.outCubic(wp);
            span.style.opacity = String(wp);
            span.style.transform = `translateY(${lerp(24, 0, e)}px)`;
            span.style.filter = "none";
            break;
          }
          case "blur_in": {
            span.style.opacity = String(wp);
            span.style.filter = `blur(${lerp(10, 0, wp)}px)`;
            span.style.transform = "none";
            break;
          }
          case "scramble_decode": {
            span.style.opacity = wp > 0.05 ? "1" : "0";
            span.style.filter = wp < 1 ? `blur(${lerp(4, 0, wp)}px)` : "none";
            span.style.transform = "none";
            break;
          }
          case "scale_punch": {
            const e = ease.outBack(wp);
            span.style.opacity = String(wp);
            span.style.transform = `scale(${lerp(1.6, 1, e)})`;
            span.style.filter = "none";
            break;
          }
          case "mask_reveal": {
            span.style.opacity = wp > 0 ? "1" : "0";
            span.style.clipPath = wp >= 1 ? "none" : `inset(${100 - wp * 100}% 0 0 0)`;
            span.style.transform = "none";
            break;
          }
          case "highlighter_swipe":
          default: {
            const e = ease.outCubic(wp);
            span.style.opacity = String(wp);
            span.style.transform = `translateY(${lerp(8, 0, e)}px)`;
            span.style.filter = "none";
            span.style.backgroundImage =
              wp > 0 && wp < 1
                ? `linear-gradient(90deg, var(--accent) ${wp * 100}%, transparent ${wp * 100}%)`
                : "none";
            break;
          }
        }
      });
    }
    update(0);
    return { update, spans };
  }

  const fx = { clamp, lerp, prog, hash, ease, text };

  function registerTemplate(id, def) {
    registry[id] = def;
  }

  // ---- theme token sets -------------------------------------------------
  const THEMES = {
    apple_glass: {
      panelBg:
        "radial-gradient(120% 100% at 20% 0%, #4c3a9e 0%, #2c2260 45%, #171233 100%)",
      cardBg: "rgba(255,255,255,.14)",
      cardBorder: "1px solid rgba(255,255,255,.35)",
      cardRadius: "36px",
      cardShadow: "0 20px 60px rgba(0,0,0,.35)",
      cardBlur: "24px",
      text: "#ffffff",
      textDim: "rgba(255,255,255,.68)",
      accentInk: "#0b0b12",
      fontDisplay: "-apple-system, 'SF Pro Display', system-ui, sans-serif",
      fontBody: "-apple-system, 'SF Pro Text', system-ui, sans-serif",
      fontMono: "'SF Mono', ui-monospace, monospace",
      displayWeight: "700",
      displayCase: "none",
      displayTracking: "-0.01em",
      textStroke: "none",
    },
    bold_kinetic: {
      panelBg: "#0a0a0a",
      cardBg: "rgba(20,20,20,.92)",
      cardBorder: "3px solid #000",
      cardRadius: "18px",
      cardShadow: "0 14px 0 rgba(0,0,0,.6)",
      cardBlur: "0px",
      text: "#ffffff",
      textDim: "rgba(255,255,255,.7)",
      accentInk: "#0a0a0a",
      fontDisplay: "'Arial Black', Impact, 'Franklin Gothic Bold', sans-serif",
      fontBody: "'Arial Black', Impact, sans-serif",
      fontMono: "ui-monospace, monospace",
      displayWeight: "900",
      displayCase: "uppercase",
      displayTracking: "0.01em",
      textStroke: "6px #000",
    },
  };
  const ACCENTS = {
    blue: { accent: "#3b82f6", accent2: "#60a5fa" },
    green: { accent: "#22c55e", accent2: "#4ade80" },
    yellow: { accent: "#eab308", accent2: "#facc15" },
    orange: { accent: "#f97316", accent2: "#fb923c" },
    red: { accent: "#ef4444", accent2: "#f87171" },
    pink: { accent: "#ec4899", accent2: "#f472b6" },
    purple: { accent: "#a855f7", accent2: "#c084fc" },
    cyan: { accent: "#06b6d4", accent2: "#22d3ee" },
  };
  const POSITIVE = "#22c55e";
  const NEGATIVE = "#ef4444";

  function applyTheme(el, familyId, accentId) {
    const th = THEMES[familyId] || THEMES.apple_glass;
    const ac = ACCENTS[accentId] || ACCENTS.blue;
    const set = (k, v) => el.style.setProperty(k, v);
    set("--panel-bg", th.panelBg);
    set("--card-bg", th.cardBg);
    set("--card-border", th.cardBorder);
    set("--card-radius", th.cardRadius);
    set("--card-shadow", th.cardShadow);
    set("--card-blur", th.cardBlur);
    set("--text", th.text);
    set("--text-dim", th.textDim);
    set("--accent", ac.accent);
    set("--accent-ink", th.accentInk);
    set("--accent-2", ac.accent2);
    set("--positive", POSITIVE);
    set("--negative", NEGATIVE);
    set("--font-display", th.fontDisplay);
    set("--font-body", th.fontBody);
    set("--font-mono", th.fontMono);
    set("--display-weight", th.displayWeight);
    set("--display-case", th.displayCase);
    set("--display-tracking", th.displayTracking);
    set("--text-stroke", th.textStroke);
    return { theme: th, accent: ac.accent };
  }

  window.Film = { registerTemplate, fx, _registry: registry, _applyTheme: applyTheme };

  // ---- single-beat runner, wired up by harness.ts's inline bootstrap ----
  // harness.ts sets window.__HARNESS = { templateId, fields, theme, accentId, dur, energy, textEffect }
  // after all template scripts + this stub have loaded, then calls window.__mount().
  window.__mount = function () {
    const h = window.__HARNESS;
    const root = document.getElementById("film-root");
    const filmEl = document.getElementById("film");
    const { theme, accent } = applyTheme(filmEl, h.theme, h.accentId);
    const def = registry[h.templateId];
    if (!def) throw new Error("template not registered: " + h.templateId);
    const ctx = {
      rect: { w: 960, h: 640 },
      theme,
      accent,
      energy: h.energy ?? 1,
      fx,
      textEffect: h.textEffect || "slide_up",
    };
    def.build(root, h.fields, ctx);
    window.__filmReady = true;
    window.renderFrame = function (t) {
      const lt = clamp(t, 0, h.dur);
      def.update(root, lt, h.dur, ctx);
      return "ok";
    };
    window.renderFrame(0);
  };
})();
