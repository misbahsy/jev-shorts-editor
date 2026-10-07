// TemplateId: option_chips  fields: {question?, options:string[2..5], pickedIndex, confidencePct?, revealAt?}
//
// Composition: a 940:550 stage (the aspect measureFit maps 1:1 onto the panel content box).
// The question is the kicker header on the top edge, the options are full-width chips that
// share the whole middle band, and the confidence stat is a designed footer (rule + label +
// display numeral + meter) on the bottom edge. Nothing floats in the middle of an empty box.
// The picked chip LANDS at fields.revealAt: .fchip-on, accent glow, a check that draws in,
// while the rejected chips fall back. Its settle scale is capped at 1.02 so the lit chip can
// never widen the measured bbox and shrink the whole card.
Film.registerTemplate("option_chips", {
  underChin: false,
  build(root, fields, ctx) {
    const { fx } = ctx;
    root.style.cssText = "display:flex;align-items:center;justify-content:center;";

    const heroTok = parseFloat(ctx.theme["--t-hero"]) || 128;
    const titleTok = parseFloat(ctx.theme["--t-title"]) || 78;
    const labelTok = parseFloat(ctx.theme["--t-label"]) || 36;

    const options = (fields.options || []).slice(0, 5).map((s) => String(s));
    if (!options.length) options.push("");
    const n = options.length;
    const pickedIndex = typeof fields.pickedIndex === "number" ? fields.pickedIndex : -1;
    const confidencePct = typeof fields.confidencePct === "number" ? fields.confidencePct : null;

    // Fixed px, not 100%: a column wider than the narrowed stage makes the core's
    // virtual-width candidates overflow and disqualify themselves, so the layout is always
    // authored at 1:1 — and the 20px inset leaves room for the picked chip's settle scale.
    const COL_W = 920;
    const CHIP_PAD = 38;
    const IDX_W = 58;
    const CHECK_W = 64;

    const stage = document.createElement("div");
    stage.className = "fstage";
    stage.style.cssText += "align-items:center;";
    root.appendChild(stage);

    const col = document.createElement("div");
    col.style.cssText =
      "position:relative;width:" + COL_W + "px;height:100%;display:flex;flex-direction:column;";
    stage.appendChild(col);

    // ---- kicker header: the question ----
    const kicker = document.createElement("div");
    kicker.className = "fkicker";
    kicker.style.cssText += "flex:none;";
    const tick = document.createElement("div");
    tick.className = "ftick";
    tick.style.cssText += "transform-origin:left center;";
    const q = document.createElement("div");
    q.className = "flabel";
    q.style.cssText += "color:var(--text);opacity:.9;";
    kicker.appendChild(tick);
    kicker.appendChild(q);
    col.appendChild(kicker);

    const qStr = fields.question ? String(fields.question) : n + " Options";
    Film.util.fitText(q, qStr, COL_W - 64 - 18 - 8, 96, {
      max: Math.round(labelTok * 1.08),
      min: 22,
      lineHeight: 1.1,
      wrap: false,
    });
    q.style.display = "block";
    const qHandle = fx.text(q, qStr, ctx.textEffect);

    // ---- chips ----
    const chipsWrap = document.createElement("div");
    chipsWrap.style.cssText =
      "flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:16px;margin:20px 0 18px;";
    col.appendChild(chipsWrap);

    const chips = [];
    options.forEach((txt, i) => {
      const chip = document.createElement("div");
      chip.className = "fchip";
      chip.style.cssText +=
        "flex:1 1 0;min-height:0;display:flex;align-items:center;box-sizing:border-box;" +
        "padding:0 " + CHIP_PAD + "px;overflow:hidden;opacity:0;";

      // the accent wash the picked chip fades UP through, so the selection lands as a move
      // rather than a class snapping on. inset:0, so it can never widen the measured bbox.
      let wash = null;
      if (i === pickedIndex) {
        wash = document.createElement("div");
        wash.style.cssText =
          "position:absolute;left:0;top:0;right:0;bottom:0;background:var(--accent-grad);" +
          "border-radius:inherit;opacity:0;z-index:0;";
        chip.style.position = "relative";
        chip.appendChild(wash);
      }

      const idx = document.createElement("div");
      idx.className = "fnum";
      idx.style.cssText = "position:relative;z-index:1;flex:none;width:" + IDX_W + "px;opacity:.4;";
      idx.textContent = String(i + 1);

      const label = document.createElement("div");
      label.className = "fhero";
      label.style.cssText += "position:relative;z-index:1;flex:1 1 auto;min-width:0;color:inherit;";

      // reserved check box: always present and sized (a real box, not an opacity-0 gap) so
      // every chip has identical internal geometry whether or not it is the picked one.
      const checkBox = document.createElement("div");
      checkBox.style.cssText =
        "flex:none;position:relative;z-index:1;width:" + CHECK_W + "px;height:" + CHECK_W + "px;margin-left:20px;";
      const check = document.createElement("div");
      // drawn from borders, not a glyph: no font can fail to have it
      check.style.cssText =
        "position:absolute;left:" + (CHECK_W / 2 - 12) + "px;top:" + (CHECK_W / 2 - 24) + "px;" +
        "width:22px;height:42px;border-right:9px solid var(--accent-ink);" +
        "border-bottom:9px solid var(--accent-ink);transform:rotate(45deg);opacity:0;";
      checkBox.appendChild(check);

      chip.appendChild(idx);
      chip.appendChild(label);
      chip.appendChild(checkBox);
      chipsWrap.appendChild(chip);
      chips.push({ el: chip, idx, label, check, wash, picked: i === pickedIndex });
    });

    // ---- footer: rule + label + display numeral + meter ----
    const foot = document.createElement("div");
    foot.style.cssText = "position:relative;flex:none;padding-top:20px;";
    const rule = document.createElement("div");
    rule.className = "frule";
    rule.style.cssText += "position:absolute;left:0;right:0;top:0;height:2px;transform-origin:left center;";
    foot.appendChild(rule);

    const statRow = document.createElement("div");
    statRow.style.cssText = "display:flex;align-items:flex-end;justify-content:space-between;";
    const statLabel = document.createElement("div");
    statLabel.className = "flabel";
    statLabel.style.cssText += "opacity:0;padding-bottom:6px;";
    statLabel.textContent = confidencePct != null ? "Confidence" : "Selected";
    statRow.appendChild(statLabel);

    let badge = null;
    let meter = null;
    let fill = null;
    if (confidencePct != null) {
      badge = document.createElement("div");
      badge.className = "fnum fnum-accent";
      // see numbered_point: keeps the clipped accent gradient on its strong half at display
      // size, and drops any letterpress shadow that would paint over the clipped fill
      badge.style.cssText =
        "--num-weight:900;background-size:260% 100%;text-shadow:none;font-size:" +
        Math.round(fx.clamp(heroTok * 0.62, 52, 88)) + "px;opacity:0;";
      badge.textContent = "0%";
      statRow.appendChild(badge);
    } else {
      badge = document.createElement("div");
      badge.className = "fhero";
      badge.style.cssText +=
        "font-size:" + Math.round(fx.clamp(titleTok * 0.52, 34, 56)) + "px;opacity:0;";
      badge.textContent = pickedIndex >= 0 && options[pickedIndex] ? options[pickedIndex] : "";
      statRow.appendChild(badge);
    }
    foot.appendChild(statRow);

    if (confidencePct != null) {
      meter = document.createElement("div");
      meter.className = "fmeter";
      meter.style.cssText += "width:100%;height:12px;margin-top:14px;opacity:0;";
      fill = document.createElement("div");
      fill.className = "fmeter-fill";
      fill.style.cssText += "width:0%;";
      meter.appendChild(fill);
      foot.appendChild(meter);
    }
    col.appendChild(foot);

    // ---- build-time measurement only (never per-frame) ----
    const chipH = chips[0].el.getBoundingClientRect().height;
    const idxSize = Math.round(fx.clamp(chipH * 0.3, 22, 42));
    chips.forEach((c) => (c.idx.style.fontSize = idxSize + "px"));

    // the label is a stretched flex item: its scrollWidth floors at the box width, so maxW has
    // to BE that box (an arithmetic guess a few px under it shrinks every label to the floor)
    const labelMaxW = Math.max(200, chips[0].label.clientWidth);
    let size = Math.round(fx.clamp(chipH * 0.54, 32, titleTok * 0.95));
    chips.forEach((c, i) => {
      const got = Film.util.fitText(c.label, options[i], labelMaxW, Math.max(40, chipH - 22), {
        max: size,
        min: 26,
        lineHeight: 1.04,
        wrap: false,
      });
      if (typeof got === "number" && got < size) size = got;
    });
    chips.forEach((c) => {
      c.label.style.fontSize = size + "px";
      c.label.style.display = "block";
    });

    root._r = {
      qHandle,
      tick,
      chips,
      rule,
      statLabel,
      badge,
      meter,
      fill,
      n,
      pickedIndex,
      confidencePct,
      revealAt: fields.revealAt,
    };
  },

  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const r = root._r;
    const n = r.n;

    // ---- build 0-30%: header, chips from the left, then the footer frame. The stagger is
    //      divided by the option count, so 2 chips and 5 chips both land inside 500ms.
    r.tick.style.transform = "scaleX(" + fx.ease.outExpo(fx.prog(lt, 0.1, 0.42)) + ")";
    r.qHandle.update(fx.prog(lt, 0.12, fx.clamp(dur * 0.24, 0.35, 0.6)));

    const stagger = Math.min(0.1, 0.32 / Math.max(1, n - 1));
    const chipDur = fx.clamp(dur * 0.28, 0.38, 0.58);

    // ---- reveal timing: honours fields.revealAt (seconds into the beat, synced to speech) ----
    const revealAt = r.revealAt;
    const hasReveal = typeof revealAt === "number";
    const dataStart = hasReveal
      ? fx.clamp(revealAt, 0.5, Math.max(0.5, dur - 0.9))
      : Math.min(dur * 0.4, 1.6);
    let dataDur = fx.clamp(dur * 0.22, 0.35, 0.7);
    if (hasReveal) dataDur = Math.min(dataDur, Math.max(0.05, dur - 0.3 - dataStart));
    const dp = fx.prog(lt, dataStart, dataDur);
    const de = fx.ease.outCubic(dp);
    const land = fx.ease.outBack(dp);

    // breathe 30-70%: ONE slow ambient — the whole option stack swells a fraction and settles
    const amb = (1 - Math.cos(fx.clamp(lt / Math.max(dur, 0.001), 0, 1) * Math.PI * 2)) / 2;

    r.chips.forEach((c, i) => {
      const p = fx.ease.outCubic(fx.prog(lt, 0.16 + i * stagger, chipDur));
      const enterX = fx.lerp(-44, 0, p);

      if (c.picked) {
        // the wash carries the whole transition; the class (which swaps the ink colour) only
        // flips once the accent is already dominant, so nothing pops ahead of the stat
        if (c.wash) c.wash.style.opacity = String(fx.clamp(de * 1.25, 0, 1));
        c.el.classList.toggle("fchip-on", de > 0.55);
        c.el.style.opacity = String(fx.clamp(p * 1.25, 0, 1));
        // capped at 1.02: a wider chip would widen the measured bbox and shrink the card
        const s = 1 + 0.02 * fx.clamp(land, 0, 1.6) + amb * 0.004;
        c.el.style.transform = "translateX(" + enterX + "px) scale(" + s + ")";
        c.el.style.boxShadow =
          de > 0.02
            ? "inset 0 1.5px 0 rgba(255,255,255,.45), 0 0 " +
              fx.lerp(0, 70, de) +
              "px -10px var(--accent-glow), 0 18px 40px -16px rgba(0,0,0,.6)"
            : "";
        c.idx.style.opacity = String(fx.lerp(0.4, 0.75, de));
        c.check.style.opacity = String(fx.clamp((dp - 0.25) * 2.6, 0, 1));
        c.check.style.transform =
          "rotate(45deg) scale(" + fx.lerp(0.4, 1, fx.ease.outBack(fx.prog(lt, dataStart + 0.08, 0.34))) + ")";
      } else {
        // rejected options fall back but stay legible (and stay measurable — never opacity 0)
        c.el.style.opacity = String(fx.clamp(p * 1.25, 0, 1) * fx.lerp(1, 0.46, de));
        c.el.style.transform =
          "translateX(" + enterX + "px) scale(" + fx.lerp(1, 0.975, de) + ")";
        c.idx.style.opacity = String(fx.lerp(0.4, 0.22, de));
      }
    });

    // ---- footer ----
    r.rule.style.transform = "scaleX(" + fx.ease.outExpo(fx.prog(lt, 0.3, 0.5)) + ")";
    const sp = fx.ease.outCubic(fx.prog(lt, 0.34, 0.4));
    r.statLabel.style.opacity = String(sp * 0.85);
    r.statLabel.style.transform = "translateX(" + fx.lerp(-14, 0, sp) + "px)";

    // ---- resolve: the stat counts up with the reveal ----
    if (r.confidencePct != null) {
      // counts from the same instant the chip starts lighting, so the stat and the selection
      // read as one event rather than two
      const bp = fx.prog(lt, dataStart, dataDur);
      const be = fx.ease.outCubic(bp);
      r.badge.textContent = Math.round(be * r.confidencePct) + "%";
      r.badge.style.opacity = String(fx.clamp(bp * 2.2, 0, 1) * 0.15 + sp * 0.85);
      r.badge.style.transform = "translateY(" + fx.lerp(12, 0, fx.ease.outCubic(fx.prog(lt, 0.34, 0.4))) + "px)";
      if (r.meter) {
        r.meter.style.opacity = String(sp);
        r.fill.style.width = (be * r.confidencePct).toFixed(2) + "%";
      }
    } else {
      r.badge.style.opacity = String(de * 0.92);
      r.badge.style.transform = "translateY(" + fx.lerp(14, 0, de) + "px)";
    }

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
