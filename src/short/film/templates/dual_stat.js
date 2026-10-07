// TemplateId: dual_stat  fields: {leftValue, leftLabel, rightValue, rightLabel}
//
// Composition: ONE full-stage card split by a hairline rule, not two identical half-empty boxes.
// The pair is deliberately asymmetric — the left cell is wider and its figure is the accent hero,
// the right cell is a quieter counterweight capped below the left's size, so the card has a
// reading order instead of a tie. Each cell is anchored top (tick + .flabel kicker), middle
// (the huge .fnum figure) and bottom (an accent .fbar), with a giant faint index behind it so
// the cell never reads empty.
//
// Authored in units of U = rect.w/940 so the three virtual-width candidates the core builds are
// geometrically similar and the design lands exactly as drawn. Every absolute layer is inset
// inside its cell — a child that pokes out still reports its full rect to measureFit and would
// silently shrink the whole card.
Film.registerTemplate("dual_stat", {
  underChin: false,
  build(root, fields, ctx) {
    const { fx } = ctx;
    const U = ctx.rect.w / 940;
    const u = (n) => n * U + "px";
    const T = (name, k) => `calc(var(${name}) * ${(U * (k == null ? 1 : k)).toFixed(3)})`;

    root.style.cssText = "display:flex;align-items:center;justify-content:center;";

    const PAD_X = 52, PAD_Y = 40, GUT = 46, HEAD_H = 96, FOOT_H = 56;
    const stage = document.createElement("div");
    stage.className = "fstage fcard";
    stage.style.cssText +=
      "flex-direction:row;align-items:stretch;padding:" + u(PAD_Y) + " " + u(PAD_X) + ";overflow:hidden;";
    root.appendChild(stage);

    // proportional widths are computed, not measured, so both cells fit their own text box
    const contentW = 940 - PAD_X * 2;
    const availW = contentW - 2 - GUT * 2;
    const leftW = (availW * 1.2) / 2.2;
    const rightW = availW - leftW;
    const valueH = 550 - PAD_Y * 2 - HEAD_H - FOOT_H;

    function cell(value, label, boxW, opts) {
      const c = document.createElement("div");
      c.style.cssText =
        "position:relative;box-sizing:border-box;display:flex;flex-direction:column;" +
        "flex:" + opts.flex + " 1 0;min-width:0;" +
        (opts.side === "left" ? "padding-right:" + u(GUT) + ";" : "padding-left:" + u(GUT) + ";");

      // faint index — the persistent layer that stops the cell reading as empty. Bottom-right,
      // clear of the label band, and inside the cell box so it can never widen the measured bbox.
      const ghost = document.createElement("div");
      ghost.className = "fghost";
      ghost.style.cssText +=
        "right:" + u(opts.side === "left" ? GUT : 0) + ";bottom:" + u(-8) + ";font-family:var(--font-num);" +
        "font-weight:900;font-size:" + u(150) + ";line-height:.78;letter-spacing:-0.06em;";
      ghost.textContent = opts.index;
      c.appendChild(ghost);

      // header: tick over the label, fixed height so both figures share a baseline
      const head = document.createElement("div");
      head.style.cssText =
        "position:relative;flex:none;height:" + u(HEAD_H) + ";display:flex;flex-direction:column;" +
        "align-items:flex-start;justify-content:flex-start;gap:" + u(20) + ";";
      const tick = document.createElement("div");
      tick.className = "ftick";
      tick.style.cssText += "flex:none;width:" + u(opts.side === "left" ? 92 : 64) + ";height:" + u(5) + ";transform-origin:left center;";
      head.appendChild(tick);
      const lab = document.createElement("div");
      lab.className = "flabel";
      lab.style.cssText =
        "font-size:" + T("--t-label", opts.side === "left" ? 0.86 : 0.78) + ";line-height:1.12;max-width:100%;";
      lab.textContent = String(label || "");
      head.appendChild(lab);
      c.appendChild(head);

      // hero figure
      const mid = document.createElement("div");
      mid.style.cssText =
        "position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:flex-start;";
      c.appendChild(mid);
      const v = document.createElement("div");
      // NB: not .fnum-accent — background-clip:text does not clip through the inline-block spans
      // fx.text splits the string into, so a gradient figure would render invisible. Flat accent.
      v.className = "fnum";
      v.style.cssText += opts.accent
        // the halo uses --accent-soft, not --accent-glow: the glow token is 75% opaque, which
        // blooms well on the dark families but reads as a blur artefact on the light/paper ones.
        // A wide, very transparent wash gives weight in every family without smearing the glyphs.
        ? "color:var(--accent);text-shadow:0 0 " + u(60) + " var(--accent-soft);"
        : "color:var(--text);";
      mid.appendChild(v);
      const str = String(value == null ? "" : value);
      const oneWord = !/\s/.test(str.trim());
      const size = Film.util.fitText(v, str, boxW * U, valueH * U, {
        max: opts.max * U,
        min: 54 * U,
        lineHeight: 0.92,
        wrap: oneWord ? false : undefined,
      });
      v.style.display = "block";
      v.style.wordBreak = "normal";

      // footer accent bar
      const foot = document.createElement("div");
      foot.style.cssText = "flex:none;height:" + u(FOOT_H) + ";display:flex;align-items:center;";
      const bar = document.createElement("div");
      bar.className = "fbar";
      bar.style.cssText +=
        "width:" + u(opts.side === "left" ? 168 : 96) + ";height:" + u(opts.side === "left" ? 10 : 7) + ";" +
        "transform-origin:left center;" + (opts.side === "left" ? "" : "opacity:.5;");
      foot.appendChild(bar);
      c.appendChild(foot);

      return { el: c, tick, lab, v, bar, ghost, size, str };
    }

    const L = cell(fields.leftValue, fields.leftLabel, leftW, {
      flex: 1.2, side: "left", accent: true, index: "01", max: 288,
    });
    stage.appendChild(L.el);

    const rule = document.createElement("div");
    rule.className = "frule";
    rule.style.cssText += "flex:none;width:" + u(2) + ";align-self:stretch;margin:" + u(10) + " 0;transform-origin:center;";
    stage.appendChild(rule);

    const R = cell(fields.rightValue, fields.rightLabel, rightW, {
      flex: 1, side: "right", accent: false, index: "02", max: 216,
    });
    stage.appendChild(R.el);

    // glyph-level reveal on both figures (the beat's own text effect)
    const lh = fx.text(L.v, L.str, ctx.textEffect);
    const rh = fx.text(R.v, R.str, ctx.textEffect);

    // fx.text turns the string into inline-block glyph boxes, and the negative tracking
    // .fnum sets is NOT applied between boxes — the line comes out wider than the size
    // fitText picked. Re-measure once (still build time, never per frame) and shrink to the
    // cell, otherwise the hero figure crosses the divider.
    function refit(c, boxW) {
      const lim = boxW * U;
      const w = c.v.scrollWidth;
      if (w > lim + 1) {
        const size = parseFloat(c.v.style.fontSize) || c.size;
        c.size = Math.max(48 * U, Math.floor(size * (lim / w)));
        c.v.style.fontSize = c.size + "px";
      }
    }
    refit(L, leftW);
    refit(R, rightW);

    // hierarchy is deliberate: the secondary figure never outgrows 0.82 of the hero
    const capped = Math.min(R.size, L.size * 0.82);
    if (capped < R.size) R.v.style.fontSize = capped + "px";

    root._r = { U, stage, L, R, rule, lh, rh };
  },

  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const r = root._r;
    const U = r.U;
    const enterDur = fx.clamp(dur * 0.32, 0.4, 0.7);

    // build 0-30%: the card, then each cell's header 120ms apart, then the divider
    const sp = fx.ease.outCubic(fx.prog(lt, 0.1, enterDur));
    r.stage.style.opacity = String(sp);
    r.stage.style.transform = "translateY(" + fx.lerp(28 * U, 0, sp) + "px) scale(" + fx.lerp(0.975, 1, sp) + ")";

    [[r.L, 0.2], [r.R, 0.32]].forEach(([c, delay]) => {
      const hp = fx.ease.outCubic(fx.prog(lt, delay, enterDur));
      c.lab.style.opacity = String(hp);
      c.lab.style.transform = "translateY(" + fx.lerp(16 * U, 0, hp) + "px)";
      c.tick.style.transform = "scaleX(" + fx.ease.outExpo(fx.prog(lt, delay, 0.42)) + ")";
      c.bar.style.transform = "scaleX(" + fx.ease.outExpo(fx.prog(lt, delay + 0.18, 0.46)) + ")";
    });

    const rp = fx.ease.outCubic(fx.prog(lt, 0.26, 0.5));
    r.rule.style.transform = "scaleY(" + rp + ")";
    r.rule.style.opacity = String(rp);

    // resolve: the two figures land close together, the hero first. Short-form pacing — the
    // old formula (dataStart capped at 1.1s, dataDur capped at 0.7s, 0.12s R-offset) let the
    // right-hand figure's reveal finish as late as 1.92s after the card appeared, a dead beat
    // an audience reads as the card being broken/stalled. Worst case now lands at ~0.98s.
    const dataStart = fx.clamp(dur * 0.16, 0.28, 0.5);
    const dataDur = fx.clamp(dur * 0.18, 0.22, 0.4);
    [[r.L, r.lh, 0], [r.R, r.rh, 0.08]].forEach(([c, h, off]) => {
      const p = fx.prog(lt, dataStart + off, dataDur);
      h.update(p);
      const e = fx.ease.outBack(p);
      c.v.style.opacity = String(fx.clamp(p * 5, 0, 1));
      c.v.style.transform =
        "translateY(" + fx.lerp(22 * U, 0, fx.ease.outCubic(p)) + "px) scale(" + fx.lerp(0.88, 1, e) + ")";
    });

    // one slow ambient breathe: the hero figure and the faint indices, nothing else
    const breathe = Math.sin((lt / Math.max(0.5, dur)) * Math.PI * 2);
    r.L.ghost.style.transform = "translateY(" + (breathe * 5 * U).toFixed(2) + "px)";
    r.R.ghost.style.transform = "translateY(" + (-breathe * 5 * U).toFixed(2) + "px)";
    r.L.bar.style.boxShadow =
      "0 0 " + (26 * U * (0.7 + 0.3 * breathe)).toFixed(0) + "px " + (-8 * U).toFixed(0) + "px var(--accent-glow)";

    const exitDur = 0.2;
    const exitStart = dur - exitDur;
    if (lt >= exitStart) {
      const xp = fx.prog(lt, exitStart, exitDur);
      root.style.opacity = String(1 - xp);
      root.style.transform = "scale(" + fx.lerp(1, 0.96, xp) + ")";
    } else {
      root.style.opacity = "1";
      root.style.transform = "scale(1)";
    }
  },
});
