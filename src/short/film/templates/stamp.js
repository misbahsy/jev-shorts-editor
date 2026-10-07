// TemplateId: stamp  fields: {text, tone:"negative"|"positive"|"neutral"}
//
// underChin: this renders small, OVER the speaker, inside the rect the core hands us
// (geometry.full.visualRect). It must never grow past that rect — the resting mark is sized to
// ~72% of it and the impact overshoot is capped so the rotated bounding box still fits, so
// nothing can ever ride up over the face.
//
// Craft: a real rubber-stamp impact mark instead of a thin outlined rectangle — heavy tone
// border with an inset second rule, a ground mixed from --panel-bg so the ink keeps contrast
// over arbitrary busy video, generous letterspacing, a double-strike ghost impression, and
// static ink-dropout streaks whose opacity/placement come from fx.hash (built once, never
// re-rolled per frame, so the frame stays a pure function of lt).
Film.registerTemplate("stamp", {
  underChin: true,
  build(root, fields, ctx) {
    const { fx } = ctx;
    const U = Math.min(ctx.rect.w / 900, ctx.rect.h / 345);
    const u = (n) => n * U + "px";

    const str = String(fields.text || "");
    // --positive/--negative are RESERVED semantic inks: they read as a verdict, and in most
    // families they sit far off the chosen accent hue (a green stamp in a blue-accent video).
    // Only spend them when the copy layer actually judged the text. Anything else — "neutral",
    // or a missing/unknown value — takes the family accent, which is both on-palette and a far
    // safer default than the red this used to fall through to.
    const TONE =
      fields.tone === "positive" ? "var(--positive)" :
      fields.tone === "negative" ? "var(--negative)" :
      "var(--accent)";
    // family-aware ground: dark families get a dark plate, light families a light one, so the
    // tone ink is legible in all eight and nothing is hard-coded.
    const GROUND = "color-mix(in srgb, var(--panel-bg) 82%, " + TONE + ")";

    root.style.cssText = "position:relative;width:100%;height:100%;overflow:visible;";

    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:absolute;left:50%;top:50%;transform-origin:50% 50%;will-change:transform;";
    root.appendChild(wrap);

    // asymmetric vertical padding: uppercase ink sits LOW in a line-height:1 box (the cap band
    // starts below the box top), so extra room underneath optically centres the word. Measured
    // off a render, not guessed.
    const BORDER = 10, PAD_X = 42, PAD_TOP = 20, PAD_BOT = 32;
    const frame = document.createElement("div");
    frame.style.cssText =
      "position:relative;display:inline-flex;align-items:center;justify-content:center;" +
      "box-sizing:content-box;padding:" + u(PAD_TOP) + " " + u(PAD_X) + " " + u(PAD_BOT) + ";" +
      "border:" + u(BORDER) + " solid " + TONE + ";border-radius:" + u(8) + ";background:" + GROUND + ";" +
      "box-shadow:0 " + u(14) + " " + u(28) + " " + u(-16) + " rgba(0,0,0,.92);";
    wrap.appendChild(frame);

    // second, thinner rule inside the heavy one — the detail that reads "stamp" not "box"
    const ring = document.createElement("div");
    ring.style.cssText =
      "position:absolute;left:" + u(9) + ";right:" + u(9) + ";top:" + u(9) + ";bottom:" + u(9) + ";" +
      "border:" + u(3) + " solid color-mix(in srgb, " + TONE + " 52%, transparent);border-radius:" + u(4) + ";" +
      "pointer-events:none;";
    frame.appendChild(ring);

    const textBox = document.createElement("div");
    textBox.style.cssText = "position:relative;";
    frame.appendChild(textBox);

    const inkCss =
      "font-family:var(--font-display);font-weight:900;text-transform:uppercase;" +
      "white-space:nowrap;line-height:1;letter-spacing:0.075em;text-align:center;";

    // double-strike impression, offset a touch and much fainter
    const ghost = document.createElement("div");
    ghost.style.cssText =
      "position:absolute;left:0;top:0;width:100%;" + inkCss + "color:" + TONE + ";pointer-events:none;";
    textBox.appendChild(ghost);

    const main = document.createElement("div");
    main.style.cssText = "position:relative;" + inkCss + "color:" + TONE + ";";
    textBox.appendChild(main);

    const safeW = ctx.rect.w * 0.72;
    const safeH = ctx.rect.h * 0.46;
    const size = Film.util.fitText(main, str, safeW, safeH, {
      max: 104 * U,
      min: 34 * U,
      wrap: false,
      lineHeight: 1,
    });
    main.style.display = "block";
    ghost.style.fontSize = size + "px";

    // ink dropout: static streaks + speckles painted in the ground colour, so they eat the ink
    const marks = [];
    for (let i = 0; i < 9; i++) {
      const y = fx.hash(str + "|y" + i);
      const h = fx.hash(str + "|h" + i);
      const o = fx.hash(str + "|o" + i);
      const x = fx.hash(str + "|x" + i);
      // short broken segments read as ink dropout; full-width lines would read as scanlines
      const left = 4 + x * 40;
      const wide = Math.min(24 + fx.hash(str + "|w" + i) * 48, 94 - left);
      const m = document.createElement("div");
      m.style.cssText =
        "position:absolute;left:" + left.toFixed(1) + "%;width:" + wide.toFixed(1) + "%;" +
        // held inside the letter bodies: a streak that skims the top of the caps reads as a
        // macron over a single letter, while one that cuts through them reads as worn ink
        "top:" + (27 + y * 44).toFixed(1) + "%;height:" + u(2 + h * 5.4) + ";" +
        "background:" + GROUND + ";opacity:" + (0.52 + o * 0.4).toFixed(2) + ";pointer-events:none;";
      frame.appendChild(m);
      marks.push(m);
    }
    // speckles live in the empty margins above and below the line box. Their bands are derived
    // from the real padding metrics after the fit (below), never guessed as fixed percentages —
    // a speckle that lands on a cap reads as a diacritic, not as ink.
    const speckles = [];
    for (let i = 0; i < 6; i++) {
      const x = fx.hash(str + "|sx" + i);
      const s = fx.hash(str + "|ss" + i);
      const m = document.createElement("div");
      m.style.cssText =
        "position:absolute;left:" + (6 + x * 86).toFixed(1) + "%;" +
        "width:" + u(4 + s * 12) + ";height:" + u(3 + s * 7) + ";border-radius:" + u(3) + ";" +
        "background:" + GROUND + ";opacity:" + (0.35 + s * 0.45).toFixed(2) + ";pointer-events:none;";
      frame.appendChild(m);
      speckles.push(m);
      marks.push(m);
    }

    // impact flash — a single tone wash over the plate on landing
    const flash = document.createElement("div");
    flash.style.cssText =
      "position:absolute;left:0;right:0;top:0;bottom:0;background:" + TONE + ";opacity:0;pointer-events:none;";
    frame.appendChild(flash);

    const mh = fx.text(main, str, ctx.textEffect || "scale_punch");
    const gh = fx.text(ghost, str, ctx.textEffect || "scale_punch");

    // fx.text rebuilds the line as inline-block glyph boxes, which changes its width, so the
    // fit is re-measured AFTER the split (build time only, never per frame) and the width is
    // then pinned — a caret or scramble can never resize the frame, and the mark can never
    // grow past the rect the core handed us.
    let fs = size;
    while (main.scrollWidth > safeW && fs > 34 * U) {
      fs -= 2;
      main.style.fontSize = fs + "px";
      ghost.style.fontSize = fs + "px";
    }
    const w = Math.min(safeW, main.scrollWidth + 6 * U);
    main.style.width = w + "px";
    ghost.style.width = w + "px";

    // place the speckles now that the final line height is known: percentages resolve against the
    // frame's padding box, so the clear bands are exactly the two paddings, inset a little.
    const lineH = fs / U;
    const boxH = PAD_TOP + lineH + PAD_BOT;
    // the band tops leave room for the speckle's own height, so none can creep onto a cap
    const topBand = (PAD_TOP * 0.5) / boxH * 100;
    const botStart = (PAD_TOP + lineH + PAD_BOT * 0.18) / boxH * 100;
    const botBand = (PAD_BOT * 0.45) / boxH * 100;
    speckles.forEach((m, i) => {
      const y = fx.hash(str + "|sy" + i);
      m.style.top =
        (fx.hash(str + "|sb" + i) < 0.5 ? y * topBand : botStart + y * botBand).toFixed(2) + "%";
    });

    root.__state = { U, TONE, wrap, frame, ring, main, ghost, flash, mh, gh, marks, seed: str };
  },

  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const s = root.__state;
    const U = s.U;

    // ---- impact: fast, hard landing offset off t=0 so nothing is mid-move at lt=0 ----
    const impStart = 0.08;
    const impDur = 0.26;
    const p = fx.prog(lt, impStart, impDur);
    const e = fx.ease.outExpo(p);

    // the ink lands with the slam
    const tp = fx.prog(lt, impStart + 0.02, 0.3);
    s.mh.update(tp);
    s.gh.update(tp);
    s.ghost.style.opacity = String(0.26 * fx.clamp(p * 3, 0, 1));
    s.ghost.style.transform = "translate(" + u3(3.2 * U) + "," + u3(2.6 * U) + ")";

    // scale: overshoot is capped at 1.16 so the rotated box still fits the handed rect
    const recoil = 1 - 0.035 * Math.sin(Math.PI * fx.prog(lt, impStart + impDur * 0.9, 0.24));
    // one slow ambient breathe for the middle of the beat
    const breathe = 1 + 0.008 * Math.sin((lt / Math.max(0.6, dur)) * Math.PI * 2);
    const rot = fx.lerp(-13.5, -6.5, fx.ease.outCubic(p)) + 0.35 * Math.sin((lt / Math.max(0.6, dur)) * Math.PI * 2);

    // decaying hand-shake on the landing — quantised on lt, still a pure function of lt
    const shake = 1 - fx.clamp(fx.prog(lt, impStart, 0.2), 0, 1);
    const q = Math.floor(lt * 60);
    const jx = (fx.hash(s.seed + "|jx" + q) - 0.5) * 7 * shake;
    const jy = (fx.hash(s.seed + "|jy" + q) - 0.5) * 7 * shake;

    const exitDur = 0.2;
    const exitStart = dur - exitDur;
    const xp = lt >= exitStart ? fx.prog(lt, exitStart, exitDur) : 0;
    const scale = fx.lerp(1.16, 1, e) * recoil * breathe * fx.lerp(1, 0.94, xp);

    s.wrap.style.opacity = String(fx.clamp(p * 4, 0, 1) * (1 - xp));
    s.wrap.style.transform =
      "translate(-50%,-50%) translate(" + u3(jx) + "," + u3(jy) + ") rotate(" + rot.toFixed(2) + "deg) scale(" +
      scale.toFixed(4) + ")";

    // flash + a tone bloom that blows out on the hit and settles
    const fp = fx.ease.outCubic(fx.prog(lt, impStart + 0.04, 0.34));
    s.flash.style.opacity = String(0.85 * (1 - fp));
    s.frame.style.boxShadow =
      "0 " + (16 * U).toFixed(0) + "px " + (46 * U).toFixed(0) + "px " + (-18 * U).toFixed(0) + "px rgba(0,0,0,.92)," +
      "0 0 " + (34 * U + 46 * U * (1 - fp)).toFixed(0) + "px " + (-6 * U).toFixed(0) + "px " +
      "color-mix(in srgb, " + s.TONE + " " + (34 + 46 * (1 - fp)).toFixed(0) + "%, transparent)";

    root.style.opacity = "1";

    function u3(n) {
      return n.toFixed(2) + "px";
    }
  },
});
