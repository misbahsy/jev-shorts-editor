// themes.js — the VISUAL SYSTEM: 8 StyleFamilyId x 8 AccentId -> CSS custom properties on
// #film, per-family animated panel backdrops, the panel/speaker seam, and the shared card /
// chip / badge / meter / rule primitives every template styles through.
//
// PERF CONTRACT (see CONTRACT.md "Visual system"):
//   * no backdrop-filter, no live filter:blur() on animating layers — glass is faked with
//     layered gradients + inset box-shadows.
//   * atmosphere blobs are radial-gradient divs that only TRANSLATE (compositor-only).
//   * grain is one static feTurbulence data-URI, rasterized once and tiled.
//   * every animated value is a pure function of `t` (no CSS transitions/animations/timers).
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Accents: each is a 2-stop gradient + a glow colour + the ink that sits on it.
  // ---------------------------------------------------------------------
  // Each pair is pulled/derived from the catalog's `accent`/`accent2` columns and the
  // bold-energetic / neon-electric palette grids, then pushed off the obvious
  // "hue -> paler hue" axis so the 2-stop reads as a designed pair, not a tint ramp.
  var ACCENTS = {
    blue: { c: "#2F6BFF", c2: "#58C7FF", ink: "#04102E", glow: "#4D8CFF" }, // cobalt
    green: { c: "#00DF82", c2: "#BEEF3E", ink: "#002715", glow: "#3BE59A" }, // mint -> lime
    yellow: { c: "#FFC300", c2: "#FF8A3D", ink: "#241900", glow: "#FFB42B" }, // sun -> ember
    orange: { c: "#FF6A2B", c2: "#FFC145", ink: "#2A0C00", glow: "#FF8038" },
    red: { c: "#FF2D46", c2: "#FF8A5B", ink: "#2C0009", glow: "#FF4459" }, // crimson cinema
    pink: { c: "#FF2E93", c2: "#F7D06F", ink: "#2D0019", glow: "#FF44A3" }, // orchid
    purple: { c: "#8338EC", c2: "#C77DFF", ink: "#15002F", glow: "#9A5CFF" },
    cyan: { c: "#00D4E8", c2: "#6FFFE9", ink: "#001A1E", glow: "#22DFF2" },
  };

  function rgba(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  var withAlpha = rgba;

  // The tiled feTurbulence SVG grain/paper layers that used to live here are gone. They were
  // the single most expensive thing in the render — a full-panel semi-transparent blended
  // layer is re-rastered on every screenshot, and on the 1517-frame clip the grain layer
  // alone cost +8.4s of a 39.3s frame budget. Grain is now baked into the panel's front
  // canvas by grainTile(), which costs nothing per frame.

  // ---------------------------------------------------------------------
  // Font stacks — macOS-guaranteed only, no network fonts.
  // ---------------------------------------------------------------------
  var F = {
    sf: '"SF Pro Display", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    sfText: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
    impact: '"Arial Black", Impact, "Helvetica Neue", sans-serif',
    futura: 'Futura, "Avenir Next", "Helvetica Neue", sans-serif',
    avenir: '"Avenir Next", Futura, "Helvetica Neue", sans-serif',
    helv: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    ny: '"New York", ui-serif, Georgia, serif',
    georgia: 'Georgia, "New York", ui-serif, serif',
    didot: 'Didot, "Bodoni 72", "New York", ui-serif, serif',
  };

  // ---------------------------------------------------------------------
  // Families. Each returns the full token set for the chosen accent.
  // Type scale tokens (--t-hero/--t-title/--t-body/--t-label) are authored at panel scale;
  // the core's measureFit re-scales the settled card, so these are relative, not absolute.
  // ---------------------------------------------------------------------
  var FAMILIES = {
    // ---- LIQUID GLASS: deep indigo-charcoal, drifting coloured light, specular glass slabs.
    apple_glass: function (a) {
      return {
        "--panel-bg": "#101218",
        // The top sheen that used to be `inset 0 34px 60px -36px rgba(255,255,255,.34)` is the
        // first gradient layer here instead. A blurred shadow costs a real blur pass on every
        // one of the 1517 screenshots; a gradient stop in a background that is already being
        // painted costs nothing. See the shadow-budget note above .fcard in the stylesheet.
        "--card-bg":
          "linear-gradient(180deg, rgba(255,255,255,.17) 0%, rgba(255,255,255,0) 28%)," +
          "linear-gradient(180deg, rgba(255,255,255,.20) 0%, rgba(255,255,255,.055) 44%, rgba(255,255,255,.105) 100%)," +
          "radial-gradient(135% 105% at 16% -12%, rgba(255,255,255,.20), rgba(255,255,255,0) 60%)",
        "--card-border": "transparent",
        "--card-border-width": "0px",
        "--card-radius": "36px",
        // Four separate 1px edge hairlines collapsed into one ring: zero-blur insets are cheap
        // but each one is still a paint op, and the ring is what actually reads at output size.
        "--card-shadow":
          "inset 0 1.5px 0 rgba(255,255,255,.66), inset 0 -1.5px 0 rgba(255,255,255,.15)," +
          "inset 0 0 0 1px rgba(255,255,255,.13)," +
          "0 22px 44px -22px rgba(0,0,0,.80), 0 0 64px -26px " + rgba(a.glow, 0.85),
        "--card-blur": "none",
        "--chip-bg": "linear-gradient(180deg, rgba(255,255,255,.17), rgba(255,255,255,.06))",
        "--chip-shadow": "inset 0 1px 0 rgba(255,255,255,.5), inset 0 0 0 1px rgba(255,255,255,.11), 0 10px 24px -12px rgba(0,0,0,.7)",
        "--chip-radius": "999px",
        "--text": "#ffffff",
        "--text-dim": "rgba(255,255,255,.66)",
        "--rule": "rgba(255,255,255,.16)",
        "--positive": "#2FE39B",
        "--negative": "#FF5E6B",
        "--font-display": F.sf,
        "--font-body": F.sfText,
        "--font-mono": F.mono,
        "--font-num": F.sf,
        "--display-weight": "700",
        "--display-case": "none",
        "--display-tracking": "-0.028em",
        "--label-tracking": "0.14em",
        "--text-stroke": "none",
        "--t-hero": "128px",
        "--t-title": "82px",
        "--t-body": "48px",
        "--t-label": "38px",
      };
    },

    // ---- EDITORIAL KINETIC: poster-black, drifting accent slab, fat condensed caps, sticker shadows.
    bold_kinetic: function (a) {
      return {
        "--panel-bg": "#0B0B0D",
        "--card-bg": "linear-gradient(180deg,#1C1C20 0%,#0D0D10 100%)",
        "--card-border": "#FFFFFF",
        "--card-border-width": "5px",
        "--card-radius": "22px",
        "--card-shadow": "14px 14px 0 0 var(--accent), inset 0 3px 0 rgba(255,255,255,.14), inset 0 -3px 0 rgba(0,0,0,.5)",
        "--card-blur": "none",
        "--chip-bg": "#141417",
        "--chip-shadow": "inset 0 0 0 4px #fff, 7px 7px 0 0 var(--accent)",
        "--chip-radius": "999px",
        "--text": "#ffffff",
        "--text-dim": "rgba(255,255,255,.62)",
        "--rule": "rgba(255,255,255,.22)",
        "--positive": "#B6FF3A",
        "--negative": "#FF3A5E",
        "--font-display": F.impact,
        "--font-body": F.futura,
        "--font-mono": F.mono,
        "--font-num": F.impact,
        "--display-weight": "900",
        "--display-case": "uppercase",
        "--display-tracking": "-0.035em",
        "--label-tracking": "0.16em",
        "--text-stroke": "none",
        "--t-hero": "142px",
        "--t-title": "92px",
        "--t-body": "48px",
        "--t-label": "40px",
      };
    },

    // ---- CRT TERMINAL: phosphor green on black, scanlines, sweep bar, bracket-framed panes.
    terminal_type: function (a) {
      return {
        "--panel-bg": "#03070A",
        // The inner phosphor bloom is a radial background layer, not `inset 0 0 44px` — same
        // look, no blur pass per frame.
        "--card-bg":
          "radial-gradient(120% 120% at 50% 50%, rgba(0,255,150,.10), rgba(0,255,150,0) 72%)," +
          "linear-gradient(180deg, rgba(0,255,150,.085), rgba(0,255,150,.015))",
        "--card-border": "rgba(70,255,170,.40)",
        "--card-border-width": "1.5px",
        "--card-radius": "8px",
        "--card-shadow":
          "inset 0 0 0 1px rgba(0,255,150,.10)," +
          "0 0 24px -8px rgba(0,255,150,.42), 0 14px 30px -24px rgba(0,0,0,.9)",
        "--card-blur": "none",
        "--chip-bg": "rgba(0,255,150,.08)",
        "--chip-shadow": "inset 0 0 0 1.5px rgba(70,255,170,.45), 0 0 18px -6px rgba(0,255,150,.5)",
        "--chip-radius": "4px",
        "--text": "#CFFFE2",
        "--text-dim": "rgba(120,240,180,.62)",
        "--rule": "rgba(70,255,170,.28)",
        "--positive": "#4CFFA6",
        "--negative": "#FF5F56",
        "--font-display": F.mono,
        "--font-body": F.mono,
        "--font-mono": F.mono,
        "--font-num": F.mono,
        "--display-weight": "700",
        "--display-case": "none",
        "--display-tracking": "-0.03em",
        "--label-tracking": "0.22em",
        "--text-stroke": "none",
        "--t-hero": "112px",
        "--t-title": "70px",
        "--t-body": "44px",
        "--t-label": "36px",
      };
    },

    // ---- NEON: violet-black, magenta/cyan aurora, glowing outline cards, horizon grid.
    neon_cyber: function (a) {
      return {
        "--panel-bg": "#07041199",
        // Inner neon bloom as a background layer; the two stacked outer glows collapsed to one.
        "--card-bg":
          "radial-gradient(130% 130% at 50% 106%, " + rgba(a.glow, 0.34) + ", rgba(0,0,0,0) 62%)," +
          "linear-gradient(180deg, rgba(30,12,60,.72), rgba(10,4,26,.88))",
        "--card-border": "var(--accent)",
        "--card-border-width": "2px",
        "--card-radius": "24px",
        "--card-shadow":
          "inset 0 0 0 1px rgba(255,255,255,.10)," +
          "0 0 46px -14px " + rgba(a.glow, 0.85),
        "--card-blur": "none",
        "--chip-bg": "linear-gradient(180deg, rgba(40,16,74,.8), rgba(14,6,32,.9))",
        "--chip-shadow": "inset 0 0 0 2px " + rgba(a.c, 0.75) + ", 0 0 22px -6px " + rgba(a.glow, 0.8),
        "--chip-radius": "999px",
        "--text": "#F2EAFF",
        "--text-dim": "rgba(226,212,255,.62)",
        "--rule": "rgba(180,140,255,.28)",
        "--positive": "#3BFFC0",
        "--negative": "#FF2F6D",
        "--font-display": F.helv,
        "--font-body": F.helv,
        "--font-mono": F.mono,
        "--font-num": F.helv,
        "--display-weight": "800",
        "--display-case": "uppercase",
        "--display-tracking": "-0.01em",
        "--label-tracking": "0.2em",
        "--text-stroke": "none",
        "--t-hero": "124px",
        "--t-title": "78px",
        "--t-body": "46px",
        "--t-label": "36px",
      };
    },

    // ---- WARM PRINT: cream stock, real paper fibre, letterpress ink, New York serif.
    paper_editorial: function (a) {
      return {
        "--panel-bg": "#F4EAD6",
        "--card-bg": "linear-gradient(176deg,#FFFCF4 0%,#F7EFDE 100%)",
        "--card-border": "transparent",
        "--card-border-width": "0px",
        "--card-radius": "10px",
        "--card-shadow":
          "inset 0 1.5px 0 rgba(255,255,255,.95), inset 0 0 0 1px rgba(74,54,26,.10)," +
          "0 2px 0 rgba(74,54,26,.07), 0 16px 30px -20px rgba(74,54,26,.44)",
        "--card-blur": "none",
        "--chip-bg": "linear-gradient(180deg,#FFFDF7,#F3E9D5)",
        "--chip-shadow": "inset 0 0 0 1.5px rgba(74,54,26,.24), 0 6px 14px -8px rgba(74,54,26,.4)",
        "--chip-radius": "999px",
        "--text": "#241C10",
        "--text-dim": "rgba(36,28,16,.62)",
        "--rule": "rgba(36,28,16,.24)",
        "--positive": "#2E6B3E",
        "--negative": "#A8321F",
        "--font-display": F.ny,
        "--font-body": F.georgia,
        "--font-mono": F.mono,
        "--font-num": F.ny,
        "--display-weight": "700",
        "--display-case": "none",
        "--display-tracking": "-0.022em",
        "--label-tracking": "0.2em",
        "--text-stroke": "none",
        "--t-hero": "124px",
        "--t-title": "80px",
        "--t-body": "46px",
        "--t-label": "34px",
      };
    },

    // ---- SWISS: paper-white, hairline grid, hard black rules, one saturated accent, no rounding.
    clean_swiss: function (a) {
      return {
        "--panel-bg": "#F7F7F5",
        "--card-bg": "#FFFFFF",
        "--card-border": "transparent",
        "--card-border-width": "0px",
        "--card-radius": "0px",
        "--card-shadow": "inset 0 12px 0 -0px #0A0A0A, inset 0 0 0 1.5px rgba(10,10,10,.14), 0 12px 24px -20px rgba(10,10,10,.5)",
        "--card-blur": "none",
        "--chip-bg": "#FFFFFF",
        "--chip-shadow": "inset 0 0 0 2.5px #0A0A0A",
        "--chip-radius": "0px",
        "--text": "#0A0A0A",
        "--text-dim": "rgba(10,10,10,.55)",
        "--rule": "rgba(10,10,10,.85)",
        "--positive": "#0A7D3A",
        "--negative": "#D1352C",
        "--font-display": F.helv,
        "--font-body": F.helv,
        "--font-mono": F.mono,
        "--font-num": F.helv,
        "--display-weight": "800",
        "--display-case": "none",
        "--display-tracking": "-0.035em",
        "--label-tracking": "0.2em",
        "--text-stroke": "none",
        "--t-hero": "136px",
        "--t-title": "88px",
        "--t-body": "46px",
        "--t-label": "34px",
      };
    },

    // ---- GRADIENT MESH: saturated multi-blob mesh, chunky frosted-white pills, bouncy.
    gradient_pop: function (a) {
      return {
        "--panel-bg": "#2A0F4A",
        "--card-bg": "linear-gradient(180deg, rgba(255,255,255,.98) 0%, rgba(255,255,255,.90) 100%)",
        "--card-border": "transparent",
        "--card-border-width": "0px",
        "--card-radius": "46px",
        "--card-shadow":
          "inset 0 2px 0 rgba(255,255,255,1), inset 0 -4px 0 rgba(20,0,40,.07)," +
          "0 20px 40px -18px rgba(24,0,48,.62), 0 0 52px -24px " + rgba(a.glow, 0.9),
        "--card-blur": "none",
        "--chip-bg": "linear-gradient(180deg,#ffffff,#F2ECFA)",
        "--chip-shadow": "inset 0 -3px 0 rgba(20,0,40,.08), 0 12px 26px -12px rgba(24,0,48,.55)",
        "--chip-radius": "999px",
        // TWO INK POLARITIES IN ONE FAMILY. The panel is a saturated purple mesh but the cards
        // are near-white pills, so a single --text cannot serve both: the dark ink that makes
        // the pills readable turned every label that sits DIRECTLY on the panel (yes_no's
        // question, option_chips' footer, flow_steps' kicker) into dark-on-dark mush.
        // These are therefore the ON-PANEL values; the .fcard/.fchip rule further down
        // re-declares --text/--text-dim/--rule locally, and because custom properties inherit,
        // every descendant of a card resolves the dark ink automatically.
        "--text": "#FFFFFF",
        "--text-dim": "rgba(255,255,255,.72)",
        "--rule": "rgba(255,255,255,.24)",
        "--positive": "#12B981",
        "--negative": "#FF3D6B",
        "--font-display": F.avenir,
        "--font-body": F.avenir,
        "--font-mono": F.mono,
        "--font-num": F.avenir,
        "--display-weight": "800",
        "--display-case": "none",
        "--display-tracking": "-0.03em",
        "--label-tracking": "0.12em",
        "--text-stroke": "none",
        "--t-hero": "130px",
        "--t-title": "84px",
        "--t-body": "48px",
        "--t-label": "38px",
      };
    },

    // ---- BLACK + METAL: obsidian, vertical sheen, champagne-gold hairlines, high-contrast Didot.
    dark_luxe: function (a) {
      return {
        "--panel-bg": "#070705",
        // The inner gold bloom is a background layer, not `inset 0 0 70px`.
        "--card-bg":
          "radial-gradient(120% 130% at 50% 0%, rgba(212,175,55,.16), rgba(212,175,55,0) 66%)," +
          "linear-gradient(180deg, rgba(255,255,255,.060), rgba(255,255,255,.012))",
        "--card-border": "rgba(212,175,55,.40)",
        "--card-border-width": "1px",
        "--card-radius": "3px",
        "--card-shadow":
          "inset 0 1px 0 rgba(247,227,168,.26), inset 0 -1px 0 rgba(247,227,168,.08)," +
          "0 20px 42px -26px rgba(0,0,0,.95)",
        "--card-blur": "none",
        "--chip-bg": "linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.012))",
        "--chip-shadow": "inset 0 0 0 1px rgba(212,175,55,.45), inset 0 1px 0 rgba(247,227,168,.22)",
        "--chip-radius": "2px",
        "--text": "#F6EEDC",
        "--text-dim": "rgba(246,238,220,.58)",
        "--rule": "rgba(212,175,55,.38)",
        "--positive": "#C9D4AF",
        "--negative": "#B4604A",
        "--font-display": F.didot,
        "--font-body": F.ny,
        "--font-mono": F.mono,
        "--font-num": F.didot,
        "--display-weight": "500",
        "--display-case": "none",
        "--display-tracking": "-0.005em",
        "--label-tracking": "0.34em",
        "--text-stroke": "none",
        "--t-hero": "132px",
        "--t-title": "84px",
        "--t-body": "46px",
        "--t-label": "34px",
      };
    },
  };

  // dark_luxe always reads as champagne gold no matter which AccentId was picked; the chosen
  // accent still drives captions/progress via --accent-hue for a hint of the mood.
  var LUXE = { c: "#D8B65A", c2: "#F7E3A8", ink: "#1A1400", glow: "#D4AF37" };

  // ---------------------------------------------------------------------
  // Base stylesheet: the shared primitives every template styles through.
  // ---------------------------------------------------------------------
  var BASE_CSS_INJECTED = false;
  function ensureBaseCss() {
    if (BASE_CSS_INJECTED) return;
    BASE_CSS_INJECTED = true;
    var style = document.createElement("style");
    style.id = "film-base-style";
    style.textContent = [
      "#film{color:var(--text);}",

      // --- card: depth via layered gradient bg + multi-layer inset/outer shadow. No
      //     backdrop-filter, no pseudo-elements (pseudo-elements paint over inline text).
      //
      // THE CARD SHADOW BUDGET. Frames are screenshots, so every blurred shadow is a real
      // blur pass on every one of the clip's 1517 frames and the cost grows with the blur
      // radius, not with how much the card moves. Measured on the test clip: zeroing
      // box-shadow on .fcard/.fcard-lit alone took the frame stage from 34.2s to 28.5s —
      // 5.7s, the single most expensive thing in the card layer.
      //
      // So each family gets AT MOST two blurred outer shadows (a drop and an accent bleed),
      // both kept under ~64px of blur, plus as many zero-blur inset hairlines as the look
      // needs — those are ordinary edge paints with no blur pass. Anything that reads as an
      // inner glow belongs in --card-bg as a gradient layer, where it is free.
      ".fcard{position:relative;background:var(--card-bg);" +
        "border:var(--card-border-width,1px) solid var(--card-border);" +
        "border-radius:var(--card-radius);box-shadow:var(--card-shadow);box-sizing:border-box;}",

      // accent-lit variant (winner cards, picked options, reveals). The ring is what actually
      // sells the "lit" state; the bleed behind it is half the radius it used to be.
      ".fcard-lit{box-shadow:var(--card-shadow), 0 0 0 2px var(--accent), 0 0 34px -10px var(--accent-glow);}",

      // --- chip / pill
      ".fchip{position:relative;background:var(--chip-bg);border-radius:var(--chip-radius);" +
        "box-shadow:var(--chip-shadow);box-sizing:border-box;" +
        "font-family:var(--font-body);font-weight:700;color:var(--text);}",
      ".fchip-on{background:var(--accent-grad);color:var(--accent-ink);" +
        "box-shadow:inset 0 1.5px 0 rgba(255,255,255,.45), 0 0 26px -8px var(--accent-glow);}",

      // --- eyebrow / micro label: the small uppercase tracked line above a hero element
      ".flabel{font-family:var(--font-body);font-weight:800;font-size:var(--t-label);" +
        "letter-spacing:var(--label-tracking);text-transform:uppercase;color:var(--text-dim);}",

      // --- hero display type
      ".fhero{font-family:var(--font-display);font-weight:var(--display-weight);" +
        "text-transform:var(--display-case);letter-spacing:var(--display-tracking);" +
        "-webkit-text-stroke:var(--text-stroke);color:var(--text);line-height:1.02;}",

      // --- designed numerals: tabular, heavy, tight
      ".fnum{font-family:var(--font-num);font-weight:var(--num-weight,800);" +
        "font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1,'lnum' 1;" +
        "letter-spacing:var(--num-tracking,-0.04em);line-height:.94;}",
      // A clipped-gradient numeral and an INHERITED family text-shadow are fundamentally
      // incompatible: the fill is transparent, so the shadow paints straight through the
      // glyph — paper_editorial's white letterpress washed accent numerals out to a pale
      // ghost, and terminal/neon's glow fogged them. text-shadow:none here kills it for every
      // template at once (it beats inheritance from #film[data-family=...] without needing
      // specificity). background-size keeps the clipped ramp on its saturated half at display
      // sizes instead of ending on the pale stop.
      ".fnum-accent{background:var(--accent-grad);background-size:260% 100%;" +
        "-webkit-background-clip:text;background-clip:text;color:transparent;" +
        "-webkit-text-fill-color:transparent;text-shadow:none;}",

      // --- meter track / fill
      ".fmeter{position:relative;background:var(--meter-track);border-radius:999px;overflow:hidden;" +
        "box-shadow:var(--meter-inset);}",
      ".fmeter-fill{position:absolute;left:0;top:0;bottom:0;background:var(--accent-grad);" +
        "border-radius:999px;box-shadow:0 0 18px -4px var(--accent-glow);}",

      // --- stage: the composition frame every split-layout template should use as its root.
      //     measureFit() scales the settled bbox to min(rect.w*.98/w, rect.h*.86/h); with the
      //     960x640 content box that is min(940/w, 550/h), so a 940:550 box fills BOTH axes and
      //     nothing is left over. Width stays 100% so the core's virtual-width passes still get
      //     to pick the wrap that doesn't overflow.
      ".fstage{position:relative;width:100%;aspect-ratio:940/550;box-sizing:border-box;" +
        "display:flex;flex-direction:column;}",
      // stage that is itself the card surface
      ".fstage.fcard{padding:var(--stage-pad,44px 52px);}",

      // --- ghost layer: the very large, very faint numeral/word that stops a composition
      //     reading as empty. Lives inside the card so it can never widen the measured bbox.
      ".fghost{position:absolute;pointer-events:none;font-family:var(--font-display);" +
        "font-weight:900;line-height:.78;letter-spacing:-0.06em;color:var(--text);" +
        "opacity:var(--ghost-alpha,.06);user-select:none;}",

      // --- kicker: eyebrow label + accent tick, the catalog's standard card header
      ".fkicker{display:flex;align-items:center;gap:18px;}",
      ".ftick{width:64px;height:4px;flex:none;background:var(--accent-grad);border-radius:999px;}",

      // --- meta band (from talking-head-recut `swiss`/`terminal`): a rule plus a
      //     space-between row of mono micro-caps. This is the cheapest way to make a card
      //     read as DESIGNED and to fill the 940x550 stage top and bottom: it is pure text,
      //     costs no shadow, and gives every template a header and a footer for free.
      //     Author one .fmeta.fmeta-top at the start of a stage and one .fmeta.fmeta-bot at
      //     the end (give it margin-top:auto) — both stay inside the measured bbox.
      ".fmeta{display:flex;align-items:baseline;justify-content:space-between;gap:28px;" +
        "font-family:var(--font-mono);font-weight:600;font-size:var(--t-meta,22px);" +
        "letter-spacing:var(--label-tracking);text-transform:uppercase;" +
        "color:var(--text-dim);white-space:nowrap;flex:none;}",
      ".fmeta .on{color:var(--accent);font-weight:800;}",
      ".fmeta-top{border-top:var(--meta-rule-w,4px) solid var(--meta-rule,var(--text));padding-top:16px;}",
      ".fmeta-bot{border-top:1px solid var(--rule);padding-top:15px;}",

      // --- kicker BLOCK (from `editorial`): a solid ink slab with knocked-out type. Far
      //     louder than a dim tracked label and the single biggest hierarchy upgrade.
      ".fkick{align-self:flex-start;background:var(--text);color:var(--panel-bg);" +
        "font-family:var(--font-mono);font-weight:700;font-size:var(--t-meta,22px);line-height:1;" +
        "letter-spacing:var(--label-tracking);text-transform:uppercase;" +
        "padding:11px 20px;border-radius:var(--kick-radius,4px);}",
      ".fkick-accent{background:var(--accent-grad);color:var(--accent-ink);}",

      // --- slab (from `swiss`/`geom`): a solid accent rectangle carrying one big figure and
      //     a mono caption. Use it as the right-hand column of a title/figure composition.
      ".fslab{background:var(--accent-grad);color:var(--accent-ink);box-sizing:border-box;" +
        "padding:26px 30px;border-radius:var(--slab-radius,10px);display:flex;" +
        "flex-direction:column;justify-content:flex-end;gap:10px;" +
        "box-shadow:0 14px 30px -20px var(--accent-glow);}",
      ".fslab small{font-family:var(--font-mono);font-weight:700;font-size:var(--t-meta,22px);" +
        "letter-spacing:var(--label-tracking);text-transform:uppercase;opacity:.78;}",

      // --- inset frame + notch (from `terminal`): a border drawn inside the card with a
      //     label punching a hole in its top edge. One div each, no shadow cost.
      ".fframe{position:absolute;inset:var(--frame-inset,16px);pointer-events:none;" +
        "border:var(--frame-border,0) solid var(--frame-color,var(--rule));" +
        "border-radius:var(--frame-radius,6px);box-shadow:var(--frame-shadow,none);}",
      ".fnotch{position:absolute;left:calc(var(--frame-inset,16px) + 22px);" +
        "top:calc(var(--frame-inset,16px) - 0.5em);background:var(--card-solid,var(--panel-bg));" +
        "padding:0 10px;font-family:var(--font-mono);font-weight:600;font-size:var(--t-meta,22px);" +
        "letter-spacing:var(--label-tracking);text-transform:uppercase;color:var(--text-dim);}",

      // --- ornaments (from `geom`/`editorial`): 2-5 persistent decoratives so the
      //     background is never empty. Absolute, so keep them INSIDE the stage box.
      ".fmark{position:absolute;pointer-events:none;}",
      ".fmark-sq{background:var(--accent);}",
      ".fmark-dot{border-radius:50%;background:var(--accent-2);}",
      ".fmark-ring{border-radius:50%;border:4px solid var(--accent);background:none;}",

      // --- hairline rule
      ".frule{background:var(--rule);}",

      // --- accent bar: the small branded tick that anchors a card
      ".fbar{background:var(--accent-grad);border-radius:999px;box-shadow:0 0 16px -6px var(--accent-glow);}",

      // ================= per-family flourishes (inherited, zero extra DOM) =================
      // phosphor bloom on every glyph
      "#film[data-family='terminal_type']{text-shadow:0 0 16px rgba(60,255,150,.42);}",
      "#film[data-family='terminal_type'] .fnum{letter-spacing:-0.01em;}",
      // Neon text bloom. The second shadow used to be `0 0 54px rgba(0,0,0,.55)` — a legibility
      // scrim under the glow — and it made this the most expensive family in the set (33.5s vs
      // 29.2s for apple_glass). Blurred-shadow cost scales with RADIUS, and this one was on
      // every glyph in the family. A tight offset drop separates the type from the backdrop
      // just as well for a fraction of the blur: 54px -> 7px.
      "#film[data-family='neon_cyber']{text-shadow:0 0 20px var(--accent-glow),0 2px 7px rgba(0,0,0,.62);}",
      // letterpress ink on cream
      "#film[data-family='paper_editorial']{text-shadow:0 1px 0 rgba(255,255,255,.8);}",
      // poster stroke: kinetic type gets a hard black outline and a hard drop
      "#film[data-family='bold_kinetic'] .fhero{-webkit-text-stroke:4px #000;paint-order:stroke fill;" +
        "text-shadow:8px 8px 0 rgba(0,0,0,.85);}",
      "#film[data-family='bold_kinetic'] .fnum{-webkit-text-stroke:4px #000;paint-order:stroke fill;}",
      // luxe: hairline gold caps spacing on labels
      "#film[data-family='dark_luxe'] .flabel{font-weight:600;}",
      "#film[data-family='dark_luxe'] .fhero{text-shadow:0 0 60px rgba(212,175,55,.28);}",
      // swiss: no glow anywhere, hard edges only
      "#film[data-family='clean_swiss'] .fcard-lit{box-shadow:var(--card-shadow),inset 0 0 0 4px var(--accent);}",
      "#film[data-family='clean_swiss'] .fbar,#film[data-family='clean_swiss'] .ftick{border-radius:0;box-shadow:none;}",
      "#film[data-family='bold_kinetic'] .ftick{border-radius:0;height:8px;}",
      "#film[data-family='dark_luxe'] .ftick{height:1.5px;width:92px;}",
      "#film[data-family='terminal_type'] .ftick{border-radius:0;height:2px;}",
      "#film[data-family='clean_swiss'] .fmeter,#film[data-family='clean_swiss'] .fmeter-fill{border-radius:0;}",
      "#film[data-family='bold_kinetic'] .fmeter,#film[data-family='bold_kinetic'] .fmeter-fill{border-radius:0;}",

      // ---- per-family expression of the new composition primitives. This is where the 8
      //      families stop being recolours of each other: same DOM, 8 different art directions.
      // apple_glass — soft, rounded, no frame; the rule is a faint hairline, never a slab.
      "#film[data-family='apple_glass']{--t-meta:21px;--kick-radius:999px;--slab-radius:26px;" +
        "--meta-rule-w:2px;--meta-rule:rgba(255,255,255,.34);}",
      "#film[data-family='apple_glass'] .fkick{background:rgba(255,255,255,.12);color:var(--text);" +
        "box-shadow:inset 0 1px 0 rgba(255,255,255,.35);}",
      // bold_kinetic (<- geom.html): chartreuse-collision energy. Everything is a hard slab,
      // rules are 8px, the kicker is an accent block with a black stroke.
      "#film[data-family='bold_kinetic']{--t-meta:24px;--kick-radius:0px;--slab-radius:0px;" +
        "--meta-rule-w:8px;--meta-rule:var(--accent);}",
      "#film[data-family='bold_kinetic'] .fkick{background:var(--accent);color:var(--accent-ink);" +
        "box-shadow:6px 6px 0 rgba(0,0,0,.85);}",
      "#film[data-family='bold_kinetic'] .fslab{box-shadow:10px 10px 0 rgba(0,0,0,.85);}",
      "#film[data-family='bold_kinetic'] .fmark-sq{box-shadow:8px 8px 0 rgba(0,0,0,.6);}",
      // terminal_type (<- terminal.html): the ASCII frame with a titlebar notch is the look.
      "#film[data-family='terminal_type']{--t-meta:22px;--kick-radius:3px;--slab-radius:3px;" +
        "--frame-border:2px;--frame-inset:14px;--frame-radius:6px;--frame-color:rgba(90,255,170,.32);" +
        "--frame-shadow:inset 0 0 0 1px rgba(10,20,14,.9),0 0 0 1px rgba(6,10,8,.9);" +
        "--meta-rule-w:2px;--meta-rule:rgba(90,255,170,.34);}",
      "#film[data-family='terminal_type'] .fkick{background:var(--accent);color:var(--accent-ink);text-shadow:none;}",
      "#film[data-family='terminal_type'] .fmark{display:none;}",
      // neon_cyber (<- spotlight.html): a thin glowing frame, no ink slabs, kicker glows.
      "#film[data-family='neon_cyber']{--t-meta:21px;--kick-radius:999px;--slab-radius:18px;" +
        "--frame-border:1.5px;--frame-inset:12px;--frame-radius:20px;--frame-color:var(--accent-soft);" +
        "--frame-shadow:0 0 34px -6px var(--accent-glow),inset 0 0 40px -18px var(--accent-glow);" +
        "--meta-rule-w:1.5px;--meta-rule:var(--accent-soft);}",
      "#film[data-family='neon_cyber'] .fkick{background:none;color:var(--accent);" +
        "box-shadow:inset 0 0 0 1.5px var(--accent),0 0 20px -8px var(--accent-glow);text-shadow:0 0 12px var(--accent-glow);}",
      // paper_editorial (<- editorial.html/audit.html): ink-block kicker on cream, double
      // rules, letterpress. No glow, no frame — the rules ARE the ornament.
      "#film[data-family='paper_editorial']{--t-meta:21px;--kick-radius:2px;--slab-radius:2px;" +
        "--meta-rule-w:3px;--meta-rule:var(--text);}",
      "#film[data-family='paper_editorial'] .fkick{box-shadow:none;text-shadow:none;}",
      "#film[data-family='paper_editorial'] .fslab{box-shadow:5px 5px 0 rgba(36,28,16,.18);}",
      "#film[data-family='paper_editorial'] .fmark-ring{border-width:5px;}",
      // clean_swiss (<- swiss.html): 4px ink top rule / 1px bottom rule, square, zero glow.
      "#film[data-family='clean_swiss']{--t-meta:20px;--kick-radius:0px;--slab-radius:0px;" +
        "--meta-rule-w:4px;--meta-rule:var(--text);}",
      "#film[data-family='clean_swiss'] .fkick{box-shadow:none;}",
      "#film[data-family='clean_swiss'] .fslab{box-shadow:none;}",
      "#film[data-family='clean_swiss'] .fmark-dot{border-radius:0;}",
      // gradient_pop (<- xhs.html): everything is a soft rounded pill in warm candy colour.
      "#film[data-family='gradient_pop']{--t-meta:22px;--kick-radius:999px;--slab-radius:30px;" +
        "--meta-rule-w:3px;--meta-rule:var(--accent);}",
      "#film[data-family='gradient_pop'] .fkick{background:var(--accent-grad);color:var(--accent-ink);" +
        "box-shadow:0 10px 18px -14px var(--accent-glow);}",
      // The second ink polarity (see the --text note in the gradient_pop theme function): a
      // near-white pill re-declares the dark tokens for its own subtree. Custom properties
      // inherit, so .flabel/.frule/.fmeter inside a card resolve these without any template
      // change. `color` is set on .fcard only — NOT on .fchip — because .fchip-on legitimately
      // paints accent-ink on an accent fill, and this selector would out-specify it.
      "#film[data-family='gradient_pop'] .fcard,#film[data-family='gradient_pop'] .fchip{" +
        "--text:#1A0B2E;--text-dim:rgba(26,11,46,.60);--rule:rgba(26,11,46,.16);" +
        "--meter-track:linear-gradient(180deg, rgba(10,10,10,.17) 0%, rgba(10,10,10,.08) 46%, rgba(10,10,10,.11) 100%);" +
        "--meter-inset:none;}",
      "#film[data-family='gradient_pop'] .fcard{color:var(--text);}",
      // gradient_pop's panel blobs are painted FROM the accent, so an accent-gradient numeral
      // sitting on the panel is the same hue as what is behind it (purple accent -> purple
      // mesh) and all but vanishes. text-shadow cannot help: -webkit-background-clip:text
      // discards it. drop-shadow() is a filter and survives the clip, and it is applied to a
      // couple of small static glyph runs, never to a big animating layer, so it is cheap.
      // Inside a card the surface is near-white and the halo would be muddy, hence the reset.
      "#film[data-family='gradient_pop'] .fnum-accent{filter:drop-shadow(0 3px 16px rgba(18,0,40,.95));}",
      "#film[data-family='gradient_pop'] .fcard .fnum-accent{filter:none;}",
      // dark_luxe: a single gold hairline frame, very wide tracking, nothing else.
      "#film[data-family='dark_luxe']{--t-meta:19px;--kick-radius:0px;--slab-radius:0px;" +
        "--frame-border:1px;--frame-inset:18px;--frame-radius:0px;--frame-color:rgba(212,175,55,.34);" +
        "--meta-rule-w:1px;--meta-rule:rgba(212,175,55,.5);}",
      "#film[data-family='dark_luxe'] .fkick{background:none;color:var(--accent);padding:10px 0;" +
        "box-shadow:inset 0 -1px 0 var(--accent);}",
      "#film[data-family='dark_luxe'] .fslab{background:none;color:var(--accent);" +
        "box-shadow:inset 0 0 0 1px rgba(212,175,55,.4);}",
      "#film[data-family='dark_luxe'] .fmark{display:none;}",

      // --- caption tokens -------------------------------------------------
      // Captions live on the VIDEO, not on the panel, so they never inherit --text: a light
      // family's ink-dark text would disappear against footage. Every family therefore gets an
      // explicit caption foreground that is legible over video, and only the STROKE weight and
      // pill shape change to keep the family's voice. Defaults (white, 3px near-black stroke,
      // weight 900) live in captions.js so a family may simply say nothing.
      "#film[data-family='bold_kinetic']{--cap-stroke:5px #000;--cap-pill-radius:0px;}",
      "#film[data-family='clean_swiss']{--cap-stroke:2.5px rgba(0,0,0,.7);--cap-pill-radius:0px;}",
      "#film[data-family='terminal_type']{--cap-fg:#e9ffe9;--cap-stroke:3px rgba(0,14,6,.82);" +
        "--cap-pill-radius:3px;}",
      "#film[data-family='paper_editorial']{--cap-fg:#fdf6e8;--cap-stroke:3px rgba(30,22,12,.82);" +
        "--cap-dim:rgba(253,246,232,.55);--cap-pill-radius:2px;}",
      "#film[data-family='gradient_pop']{--cap-pill-radius:0.34em;}",
      // luxe captions are set in a lighter weight with a hairline stroke — the family's whole
      // argument is restraint, and a 900-weight outline would break it.
      "#film[data-family='dark_luxe']{--cap-fg:#f6efe0;--cap-dim:rgba(246,239,224,.5);" +
        "--cap-stroke:2px rgba(0,0,0,.7);--cap-weight:700;--cap-pill-radius:0px;}",
    ].join("\n");
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------
  // Token resolution
  // ---------------------------------------------------------------------
  function tokens(familyId, accentId) {
    var picked = ACCENTS[accentId] || ACCENTS.blue;
    var isLuxe = familyId === "dark_luxe";
    var a = isLuxe ? LUXE : picked;
    var fam = FAMILIES[familyId] || FAMILIES.clean_swiss;
    var t = fam(a);
    t["--accent"] = a.c;
    t["--accent-2"] = a.c2;
    t["--accent-ink"] = a.ink;
    t["--accent-glow"] = rgba(a.glow, 0.75);
    t["--accent-soft"] = rgba(a.c, 0.18);
    t["--accent-faint"] = rgba(a.c, 0.08);
    t["--accent-grad"] = "linear-gradient(135deg," + a.c + " 0%," + a.c2 + " 100%)";
    t["--accent-grad-v"] = "linear-gradient(180deg," + a.c2 + " 0%," + a.c + " 100%)";
    // meter surfaces follow the family's light/dark polarity
    // Polarity of the PANEL, not of the cards. gradient_pop is deliberately absent: its cards
    // are light but its panel is deep purple, so panel-level meters need the dark-family
    // surfaces. The card-local values are restored by the .fcard rule in the base stylesheet.
    var light = familyId === "paper_editorial" || familyId === "clean_swiss";
    // The recessed look of a meter cell is a background gradient, NOT a box-shadow, and that
    // matters more here than anywhere else: the segmented readouts draw 30-40 cells at once,
    // so a two-layer inset shadow per cell is 60-80 extra shadow paints in every frame the
    // meter is on screen. --meter-inset stays defined (templates still reference it) but it
    // resolves to `none`; the track carries the depth instead.
    t["--meter-track"] = light
      ? "linear-gradient(180deg, rgba(10,10,10,.17) 0%, rgba(10,10,10,.08) 46%, rgba(10,10,10,.11) 100%)"
      : "linear-gradient(180deg, rgba(0,0,0,.46) 0%, rgba(255,255,255,.07) 52%, rgba(255,255,255,.10) 100%)";
    t["--meter-inset"] = "none";
    t["--is-light"] = light ? "1" : "0";
    return t;
  }

  function apply(root, familyId, accentId) {
    ensureBaseCss();
    var t = tokens(familyId, accentId);
    for (var k in t) root.style.setProperty(k, t[k]);
    root.dataset.family = familyId;
    root.dataset.accent = accentId;
  }

  // ---------------------------------------------------------------------
  // Panel backdrop — layered atmosphere, animated purely from `t`.
  //
  // Layer budget per family: 1 base + <=3 translating radial blobs + 1 static pattern
  // + 1 optional sweep + 1 static grain + 1 static vignette. Only blobs/sweep get a
  // transform each frame; everything else is written once at build.
  // ---------------------------------------------------------------------
  function mk(parent, css) {
    var d = document.createElement("div");
    d.style.cssText = "position:absolute;pointer-events:none;" + css;
    parent.appendChild(d);
    return d;
  }

  // Deterministic PRNG for the baked grain. Math.random is banned (every worker must
  // produce byte-identical frames), so the noise is seeded from a constant.
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // One grain tile, rasterized once per page. Speckles go BOTH ways (white and black) so a
  // flat alpha blit reads like the old overlay-blended film grain without the blend layer.
  var GRAIN_TILE = null;
  function grainTile() {
    if (GRAIN_TILE) return GRAIN_TILE;
    var size = 160;
    var c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    var g = c.getContext("2d");
    var id = g.createImageData(size, size);
    var d = id.data;
    var rnd = mulberry32(0x5eed1);
    for (var i = 0; i < d.length; i += 4) {
      var v = rnd();
      var lum = v < 0.5 ? 0 : 255;
      d[i] = lum;
      d[i + 1] = lum;
      d[i + 2] = lum;
      d[i + 3] = Math.abs(v - 0.5) * 2 * 255;
    }
    g.putImageData(id, 0, 0);
    GRAIN_TILE = c;
    return c;
  }

  // Warm, darker-only fibre for paper stock. Separate from the film grain because it stands in
  // for a multiply blend: only the shadow side of the noise exists.
  var PAPER_TILE = null;
  function paperTile() {
    if (PAPER_TILE) return PAPER_TILE;
    var size = 220;
    var c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    var g = c.getContext("2d");
    var id = g.createImageData(size, size);
    var d = id.data;
    var rnd = mulberry32(0x9a17e);
    for (var i = 0; i < d.length; i += 4) {
      var v = rnd();
      d[i] = 92;
      d[i + 1] = 70;
      d[i + 2] = 36;
      // Bias hard toward transparent: only the darkest ~35% of the noise leaves a fibre.
      d[i + 3] = v < 0.62 ? 0 : Math.round((v - 0.62) * (255 / 0.38));
    }
    g.putImageData(id, 0, 0);
    PAPER_TILE = c;
    return c;
  }

  function buildPanelBackdrop(panel, familyId, accentId) {
    var picked = ACCENTS[accentId] || ACCENTS.blue;
    var isLuxe = familyId === "dark_luxe";
    var a = isLuxe ? LUXE : picked;
    var W = panel.offsetWidth || 1080,
      H = panel.offsetHeight || 840;

    panel.textContent = "";
    panel.style.backgroundImage = "";
    panel.style.background = "";
    panel.style.overflow = "hidden";

    // ------------------------------------------------------------------
    // WHY THE WHOLE BACKDROP IS ONE CANVAS.
    //
    // Frames are captured by screenshotting the page, so there is no GPU compositing and no
    // inter-frame caching: every frame re-rasters the page from scratch. A semi-transparent
    // full-panel <div> is therefore not "free after the first frame" the way it is in a live
    // browser — each one costs its own full-size raster plus a blend, 1517 times over.
    //
    // Measured on the 1517-frame test clip (6 workers), the cost is close to linear in
    // (number of full-panel layers x panel area), and NOT in how much they move:
    //   - no panel at all ................ 12.0s   (decode + screenshot floor)
    //   - one flat gradient div .......... 19.4s   (+7.4s for a SINGLE layer)
    //   - the full div stack ............. 30.3s
    //   - freezing every animation ....... no change at all
    // The tiled feTurbulence grain div alone was +8.4s of that.
    //
    // So the panel is a single <canvas>. Static artwork is baked once into two offscreen
    // bitmaps (back: base wash + patterns; front: furniture, grain, vignette) and the moving
    // pieces are pre-rendered sprites. Each frame is one composite pass into that canvas:
    // blit back, stamp the sprites at their t-derived offsets, blit front. Canvas fills are
    // cheap CPU writes; what was expensive was asking the page compositor to blend five or
    // more independent full-panel layers on every single screenshot.
    //
    // FOUR MECHANISMS WERE MEASURED FOR THIS BACKDROP, all against the same plan whose
    // baseline with the backdrop stubbed out entirely (cards + captions still present) is
    // 22.1s. Do not re-litigate this without re-measuring:
    //   - CSS radial-gradient stack on the panel element ........ 31.8s  (+9.7s)  WORST
    //   - this single <canvas> child ............................ 29.2s  (+7.1s)  CHOSEN
    //   - same canvas at half resolution, CSS-upscaled .......... 30.4s  (+8.3s)
    //   - one baked PNG data-URL as the panel's own
    //     background-image, drifting via background-position .... 25.8s  (+3.7s)  CHEAPEST
    //
    // The half-res idea backfires: the compositor then has to upscale the texture on every
    // screenshot and the sprite blits become scaling blits, which together cost more than the
    // three quarters of the pixels it saves. Painting fewer pixels is not the lever here.
    //
    // The baked background-image is genuinely 3.4s cheaper and was rejected on design, not on
    // cost. A single bitmap can only be panned as a whole, so it gives up (a) independent
    // per-blob aurora parallax, which is what stops the mesh reading as a static wallpaper
    // being slid around, and (b) the sweep sprites entirely — terminal_type's scanline bar and
    // dark_luxe's vertical sheen are both defining features of those families, and neither can
    // be expressed as a background-position offset. Splitting it into several background
    // layers to win the parallax back re-introduces exactly the multi-full-panel-layer blend
    // that the gradient stack above shows is the most expensive option of the four.
    //
    // 3.4s of a budget that cannot reach its target anyway (the 22.1s floor is untouchable
    // while cards and captions exist) is not worth two families losing their signature motion.
    // ------------------------------------------------------------------
    var cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    cv.style.cssText =
      "position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px;pointer-events:none;";
    panel.appendChild(cv);
    var out = cv.getContext("2d");

    // Offscreen bitmap the same size as the panel, used for the baked layers.
    function canvasLayer() {
      var c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      return c.getContext("2d"); // ctx.canvas gives the bitmap back for blitting
    }

    // --- canvas equivalents of the CSS gradients/patterns being replaced ---------------

    // CSS linear-gradient(<deg>, ...): 0deg points to the top, angles run clockwise, and
    // the gradient line is centred on the box.
    function cssLinear(g, deg, stops) {
      var th = (deg * Math.PI) / 180,
        dx = Math.sin(th),
        dy = -Math.cos(th);
      var len = Math.abs(W * dx) + Math.abs(H * dy);
      var lg = g.createLinearGradient(
        W / 2 - (dx * len) / 2, H / 2 - (dy * len) / 2,
        W / 2 + (dx * len) / 2, H / 2 + (dy * len) / 2
      );
      for (var i = 0; i < stops.length; i++) lg.addColorStop(stops[i][0], stops[i][1]);
      return lg;
    }
    function fillLinear(g, deg, stops) {
      g.fillStyle = cssLinear(g, deg, stops);
      g.fillRect(0, 0, W, H);
    }
    // CSS radial-gradient(<rx>% <ry>% at <cx>% <cy>%, ...) — canvas radial gradients are
    // circular, so the ellipse is produced by scaling the context around its centre.
    function fillEllipse(g, rxF, ryF, cxF, cyF, stops) {
      var cx = W * cxF, cy = H * cyF, rx = W * rxF, ry = H * ryF, R = Math.max(rx, ry);
      g.save();
      g.translate(cx, cy);
      g.scale(rx / R, ry / R);
      var rg = g.createRadialGradient(0, 0, 0, 0, 0, R);
      for (var i = 0; i < stops.length; i++) rg.addColorStop(stops[i][0], stops[i][1]);
      g.fillStyle = rg;
      g.fillRect(-W * 3, -H * 3, W * 6, H * 6);
      g.restore();
    }
    // repeating-linear-gradient as solid bands. Exact for 0/90deg (scanlines, rules,
    // brushed sheen); for diagonal hatch the band normal is what matters, not the phase.
    function bandsH(g, color, bandH, period) {
      g.fillStyle = color;
      for (var y = 0; y < H; y += period) g.fillRect(0, y, W, bandH);
    }
    function bandsV(g, color, bandW, period) {
      g.fillStyle = color;
      for (var x = 0; x < W; x += period) g.fillRect(x, 0, bandW, H);
    }
    function hatch(g, deg, color, bandW, period) {
      var D = Math.ceil(Math.sqrt(W * W + H * H)) + period * 2;
      g.save();
      g.translate(W / 2, H / 2);
      g.rotate(((deg - 90) * Math.PI) / 180);
      g.fillStyle = color;
      for (var x = -D; x < D; x += period) g.fillRect(x, -D, bandW, 2 * D);
      g.restore();
    }
    function dots(g, color, r, step) {
      g.fillStyle = color;
      for (var y = 0; y < H; y += step) for (var x = 0; x < W; x += step) g.fillRect(x, y, r * 2, r * 2);
    }
    function grain(g, alpha) {
      var tile = grainTile();
      g.save();
      g.globalAlpha = alpha;
      for (var y = 0; y < H; y += tile.height) for (var x = 0; x < W; x += tile.width) g.drawImage(tile, x, y);
      g.restore();
    }
    function paper(g, alpha) {
      var tile = paperTile();
      g.save();
      g.globalAlpha = alpha;
      for (var y = 0; y < H; y += tile.height) for (var x = 0; x < W; x += tile.width) g.drawImage(tile, x, y);
      g.restore();
    }
    function bar(g, color, x, y, w, h) {
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
    }
    function hairline(g, color, x, y, w, h) {
      var lg = g.createLinearGradient(x, 0, x + w, 0);
      lg.addColorStop(0, rgba(color, 0));
      lg.addColorStop(0.5, rgba(color, 0.6));
      lg.addColorStop(1, rgba(color, 0));
      g.fillStyle = lg;
      g.fillRect(x, y, w, h);
    }

    var back = canvasLayer();

    // A drifting aurora blob, pre-rendered once as a w x h sprite. This is the CSS
    // `radial-gradient(closest-side, COLOR, transparent 74%)` on an ellipse: closest-side on a
    // w x h box means rx = w/2, ry = h/2, so the sprite is painted by scaling a circular
    // gradient into that ellipse. It is never re-rendered — update() only stamps it.
    var drifters = []; // {sprite, w,h, x0,y0, ax,ay, px,py, ph}
    function blob(color, w, h, x0, y0, ax, ay, px, py, ph) {
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      var g = c.getContext("2d");
      var R = Math.max(w, h) / 2;
      g.translate(w / 2, h / 2);
      g.scale(w / 2 / R, h / 2 / R);
      var rg = g.createRadialGradient(0, 0, 0, 0, 0, R);
      rg.addColorStop(0, color);
      rg.addColorStop(0.74, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.fillRect(-R, -R, R * 2, R * 2);
      drifters.push({ sprite: c, x0: x0, y0: y0, ax: ax, ay: ay, px: px, py: py, ph: ph });
      return c;
    }
    // A sweep is a sprite too — a soft band that slides across the panel on one axis.
    var sweeps = []; // {sprite, from, to, period, axis}
    function sweepSprite(w, h, vertical, stops) {
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      var g = c.getContext("2d");
      var lg = vertical ? g.createLinearGradient(0, 0, 0, h) : g.createLinearGradient(0, 0, w, 0);
      for (var i = 0; i < stops.length; i++) lg.addColorStop(stops[i][0], stops[i][1]);
      g.fillStyle = lg;
      g.fillRect(0, 0, w, h);
      return c;
    }
    var front = null; // baked last so update() blits it over the moving sprites

    switch (familyId) {
      case "apple_glass":
        fillLinear(back, 168, [[0, "#181B24"], [0.58, "#0E1016"], [1, "#090A0F"]]);
        blob(rgba(a.glow, 0.5), 980, 820, -190, -300, 70, 46, 31, 23, 0);
        blob(rgba(a.c2, 0.28), 760, 660, 520, 340, -90, 54, 27, 19, 1.7);
        blob("rgba(255,255,255,0.10)", 620, 520, 240, -180, 46, -34, 37, 29, 0.6);
        front = canvasLayer();
        // soft top light bar (the "window" the glass catches)
        var agLg = front.createLinearGradient(0, 0, 0, 280);
        agLg.addColorStop(0, "rgba(255,255,255,.075)");
        agLg.addColorStop(1, "rgba(255,255,255,0)");
        front.fillStyle = agLg;
        front.fillRect(0, 0, W, 280);
        grain(front, 0.055);
        fillEllipse(front, 1.2, 0.92, 0.5, 0.34, [[0.46, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.62)"]]);
        break;

      case "bold_kinetic": {
        back.fillStyle = "#0B0B0D";
        back.fillRect(0, 0, W, H);
        blob(rgba(a.c, 0.55), 1100, 900, -240, -340, 120, 70, 21, 15, 0);
        blob("rgba(255,255,255,0.07)", 700, 600, 560, 420, -110, -60, 25, 18, 2.2);
        front = canvasLayer();
        hatch(front, 118, "rgba(255,255,255,.055)", 4, 30);
        // a bold accent band pinned to the bottom of the panel — poster furniture
        var bkLg = front.createLinearGradient(0, 0, W, 0);
        bkLg.addColorStop(0, a.c);
        bkLg.addColorStop(1, a.c2);
        front.fillStyle = bkLg;
        front.fillRect(0, H - 14, W, 14);
        grain(front, 0.07);
        fillEllipse(front, 1.18, 0.95, 0.5, 0.4, [[0.4, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.72)"]]);
        break;
      }

      case "terminal_type": {
        back.fillStyle = "#03070A";
        back.fillRect(0, 0, W, H);
        blob("rgba(0,255,150,0.16)", 900, 640, 90, -210, 40, 26, 43, 33, 0);
        // slow CRT refresh sweep
        sweeps.push({
          sprite: sweepSprite(W, 220, true, [
            [0, "rgba(0,255,150,0)"],
            [0.5, "rgba(0,255,150,.085)"],
            [1, "rgba(0,255,150,0)"],
          ]),
          from: -240, to: H + 40, period: 6.5, axis: "y",
        });
        front = canvasLayer();
        // dot-matrix + scanlines go ON THE FRONT canvas, not the back: in the DOM version they
        // were appended after the blob, so the phosphor glow read THROUGH the grid rather than
        // washing it out. Same stacking, no extra layer.
        dots(front, "rgba(60,255,150,.13)", 1, 26);
        bandsH(front, "rgba(0,255,150,.075)", 1, 4);
        grain(front, 0.09);
        fillEllipse(front, 1.12, 0.88, 0.5, 0.44, [[0.34, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.80)"]]);
        break;
      }

      case "neon_cyber": {
        fillLinear(back, 180, [[0, "#0B0620"], [1, "#05030F"]]);
        blob(rgba(a.glow, 0.46), 900, 760, -160, -280, 96, 60, 24, 17, 0);
        blob("rgba(255,47,214,0.34)", 820, 700, 470, 300, -104, -52, 29, 21, 1.4);
        blob("rgba(0,224,255,0.22)", 640, 560, 180, 380, 74, -60, 19, 26, 2.8);
        front = canvasLayer();
        // perspective horizon grid — the CSS mask is replaced by a per-line alpha ramp
        var gy = H - 300;
        for (var vx = 0; vx < W; vx += 62) {
          var vlg = front.createLinearGradient(0, gy, 0, H);
          vlg.addColorStop(0, "rgba(150,120,255,0)");
          vlg.addColorStop(1, "rgba(150,120,255,.11)");
          front.fillStyle = vlg;
          front.fillRect(vx, gy, 2, 300);
        }
        for (var hy = gy; hy < H; hy += 40) {
          front.fillStyle = "rgba(150,120,255," + (0.1 * ((hy - gy) / 300)).toFixed(3) + ")";
          front.fillRect(0, hy, W, 2);
        }
        grain(front, 0.07);
        fillEllipse(front, 1.16, 0.92, 0.5, 0.4, [[0.4, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.66)"]]);
        break;
      }

      case "paper_editorial": {
        fillLinear(back, 172, [[0, "#F9F1E0"], [1, "#F0E4CC"]]);
        blob("rgba(180,150,100,0.20)", 900, 700, -160, 260, 44, 30, 47, 37, 0);
        blob(rgba(a.c, 0.10), 720, 620, 520, -220, -50, 36, 39, 29, 1.1);
        front = canvasLayer();
        // Paper fibre. NOT the film-grain tile scaled up: blowing a 160px tile to 220px turns
        // fine noise into visible speckle and the cream stock read dirty. This is its own
        // native-resolution tile, and it is darker-only (warm brown, no white speckle) because
        // the layer it replaces was mix-blend-mode:multiply — white noise over cream just
        // desaturates it toward grey.
        paper(front, 0.13);
        // printed baseline rules, static
        bandsH(front, "rgba(60,42,18,.045)", 1, 52);
        // warm plate vignette / deckle edge
        fillEllipse(front, 1.2, 0.96, 0.5, 0.38, [[0.48, "rgba(0,0,0,0)"], [1, "rgba(92,70,36,.30)"]]);
        break;
      }

      case "clean_swiss": {
        back.fillStyle = "#F7F7F5";
        back.fillRect(0, 0, W, H);
        // hairline modular grid, static
        bandsH(back, "rgba(10,10,10,.075)", 1, 90);
        bandsV(back, "rgba(10,10,10,.075)", 1, 90);
        // one accent field, drifting slowly — the single permitted colour event
        blob(rgba(a.c, 0.16), 760, 640, 520, -230, -60, 40, 41, 31, 0);
        front = canvasLayer();
        // heavy black rules top & bottom — Swiss furniture
        bar(front, "#0A0A0A", 60, 110, W - 120, 5);
        bar(front, "#0A0A0A", 60, H - 28, W - 120, 2);
        bar(front, a.c, 60, 110, 120, 5);
        break;
      }

      case "gradient_pop": {
        back.fillStyle = "#2A0F4A";
        back.fillRect(0, 0, W, H);
        blob(a.c, 980, 880, -230, -330, 120, 76, 23, 17, 0);
        blob(a.c2, 840, 760, 470, 250, -118, -66, 27, 20, 1.9);
        blob("rgba(255,96,180,0.75)", 700, 640, 180, 420, 88, -70, 19, 25, 3.1);
        blob("rgba(255,214,102,0.42)", 560, 520, 640, -160, -70, 66, 31, 23, 0.8);
        front = canvasLayer();
        // glossy top sheen
        var gpLg = front.createLinearGradient(0, 0, 0, 320);
        gpLg.addColorStop(0, "rgba(255,255,255,.20)");
        gpLg.addColorStop(1, "rgba(255,255,255,0)");
        front.fillStyle = gpLg;
        front.fillRect(0, 0, W, 320);
        grain(front, 0.06);
        fillEllipse(front, 1.24, 0.98, 0.5, 0.38, [[0.48, "rgba(0,0,0,0)"], [1, "rgba(20,0,44,.52)"]]);
        break;
      }

      case "dark_luxe": {
        back.fillStyle = "#070705";
        back.fillRect(0, 0, W, H);
        // brushed vertical sheen, static
        back.save();
        back.globalAlpha = 0.55;
        bandsV(back, "rgba(255,255,255,.018)", 1, 3);
        back.restore();
        blob("rgba(212,175,55,0.20)", 900, 700, 240, -300, 56, 34, 39, 29, 0);
        blob("rgba(120,96,40,0.16)", 700, 620, -140, 320, 48, -38, 45, 33, 1.6);
        // slow specular sweep across the metal
        sweeps.push({
          sprite: sweepSprite(420, H, false, [
            [0, "rgba(247,227,168,0)"],
            [0.5, "rgba(247,227,168,.075)"],
            [1, "rgba(247,227,168,0)"],
          ]),
          from: -460, to: W + 60, period: 11, axis: "x",
        });
        front = canvasLayer();
        // gold hairlines — restrained furniture
        hairline(front, "#D4AF37", 70, 96, W - 140, 1);
        hairline(front, "#D4AF37", 70, H - 34, W - 140, 1);
        grain(front, 0.06);
        fillEllipse(front, 1.12, 0.9, 0.5, 0.36, [[0.34, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.80)"]]);
        break;
      }

      default:
        back.fillStyle = "#111";
        back.fillRect(0, 0, W, H);
    }

    var backImg = back.canvas;
    var frontImg = front ? front.canvas : null;

    // One composite pass per frame into the single visible canvas. Pure function of t: no
    // state carries across frames, so any worker rendering any frame gets the same pixels.
    //
    // PERF NOTE, so nobody re-tries this: the composite is ~6 full-panel blits and it looks
    // like the obvious thing to throttle. It isn't. Quantising t to 12 steps a second and
    // early-returning when the step is unchanged — skipping ~80% of the paints — changed the
    // measured frame budget by nothing at all (34.7s vs 34.2s, inside the noise). The canvas
    // costs what it costs because it is a second full-panel layer the screenshot has to
    // composite, not because of the pixels written into it. Painting it is free; existing is
    // what is expensive. Optimise by removing layers, never by drawing less into them.
    function update(t) {
      var q = t;
      out.clearRect(0, 0, W, H);
      out.drawImage(backImg, 0, 0);
      for (var i = 0; i < drifters.length; i++) {
        var d = drifters[i];
        var x = d.x0 + Math.sin((q / d.px) * Math.PI * 2 + d.ph) * d.ax;
        var y = d.y0 + Math.cos((q / d.py) * Math.PI * 2 + d.ph * 1.3) * d.ay;
        out.drawImage(d.sprite, Math.round(x), Math.round(y));
      }
      for (var j = 0; j < sweeps.length; j++) {
        var s = sweeps[j];
        var p = (((q / s.period) % 1) + 1) % 1;
        var v = Math.round(s.from + (s.to - s.from) * p);
        if (s.axis === "y") out.drawImage(s.sprite, 0, v);
        else out.drawImage(s.sprite, v, 0);
      }
      if (frontImg) out.drawImage(frontImg, 0, 0);
    }
    update(0);
    return { update: update };
  }

  // ---------------------------------------------------------------------
  // Seam: the panel's bottom edge has to meet the speaker plate without a hard line.
  // A short scrim is drawn BELOW the panel (over the top of the video) plus a designed
  // accent hairline sitting exactly on the boundary. Height is clamped so it can never
  // reach the padded face box.
  // ---------------------------------------------------------------------
  function buildSeam(root, geometry, familyId, accentId) {
    var panelG = geometry.split.panel;
    // a no-face source (screen recording, b-roll, pet video...) reports a zero-size placeholder
    // rect at the frame centre — face.y is truthy (frame-centre y, not 0), so a plain `|| ` guard
    // would silently consume it as a real head position. Require a real detection (w>0 && h>0).
    var faceDet = geometry.split.face && geometry.split.face.w > 0 && geometry.split.face.h > 0 ? geometry.split.face : null;
    var faceY = (faceDet && faceDet.y) || panelG.y + panelG.h + 120;
    var bottom = panelG.y + panelG.h;
    var h = Math.max(0, Math.min(110, faceY - bottom - 8));

    var wrap = document.createElement("div");
    wrap.id = "film-seam";
    wrap.style.cssText =
      "position:absolute;left:" + panelG.x + "px;top:" + bottom + "px;width:" + panelG.w + "px;" +
      "height:" + (h + 6) + "px;pointer-events:none;opacity:0;z-index:5;";

    var light = familyId === "paper_editorial" || familyId === "clean_swiss";
    var swiss = familyId === "clean_swiss";
    var kinetic = familyId === "bold_kinetic";

    if (h > 0 && !swiss) {
      // scrim: carries the panel's own darkness a little way down over the video so the
      // cut reads as a light falloff rather than an edge.
      var scrimTop = light ? "rgba(58,44,22,.62)" : "rgba(0,0,0,.72)";
      var scrim = document.createElement("div");
      scrim.style.cssText =
        "position:absolute;left:0;right:0;top:0;height:" + h + "px;" +
        "background:linear-gradient(180deg," + scrimTop + " 0%,rgba(0,0,0,.28) 42%,rgba(0,0,0,0) 100%);";
      wrap.appendChild(scrim);
    }

    // designed hairline on the boundary itself
    var line = document.createElement("div");
    var lineH = swiss ? 4 : kinetic ? 0 : 2; // kinetic already has its own accent band
    if (lineH > 0) {
      line.style.cssText =
        "position:absolute;left:0;right:0;top:0;height:" + lineH + "px;" +
        (swiss
          ? "background:#0A0A0A;"
          : "background:linear-gradient(90deg,rgba(0,0,0,0) 0%,var(--accent) 22%,var(--accent-2) 50%,var(--accent) 78%,rgba(0,0,0,0) 100%);" +
            "box-shadow:0 0 16px -2px var(--accent-glow);");
      wrap.appendChild(line);
    }
    root.appendChild(wrap);
    return wrap;
  }

  // Back-compat shim for any caller still using the old static painter.
  function paintPanelBackdrop(panel, familyId, accentId) {
    buildPanelBackdrop(panel, familyId, accentId);
  }

  window.FilmThemes = {
    ACCENTS: ACCENTS,
    tokens: tokens,
    apply: apply,
    buildPanelBackdrop: buildPanelBackdrop,
    buildSeam: buildSeam,
    paintPanelBackdrop: paintPanelBackdrop,
    rgba: rgba,
    withAlpha: withAlpha,
  };
})();
