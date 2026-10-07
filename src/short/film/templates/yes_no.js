// TemplateId: yes_no  fields: {question, answer:"yes"|"no", pct, revealAt?}
//
// Composition: a 940:550 .fstage (the aspect measureFit maps 1:1 onto the panel content box) with
// three anchored rows — kicker + status chip at the top, the question as a real headline in the
// middle, a verdict band pinned to the bottom. The band's geometry is identical before and after
// the reveal: one big answer plate plus a reserved confidence column. While the answer is pending
// the plate runs an indeterminate scanner, so the ~5s the question sits unanswered is a designed
// state rather than a grey box with a "?" in it.
//
// Everything is authored in units of U = rect.w/940, so the three virtual-width candidates the
// core builds are geometrically similar (same fit scale) and the composition lands exactly as
// drawn. Absolutely-positioned layers are always inset inside their parent's box — a child that
// pokes out still reports its full rect to measureFit and would silently shrink the whole card.
Film.registerTemplate("yes_no", {
  underChin: false,
  build(root, fields, ctx) {
    const { fx } = ctx;
    const U = ctx.rect.w / 940;
    const u = (n) => n * U + "px";
    // token type, kept on the family's scale but tied to the stage's unit
    const T = (name, k) => `calc(var(${name}) * ${(U * (k == null ? 1 : k)).toFixed(3)})`;

    root.style.cssText = "display:flex;align-items:center;justify-content:center;";

    const stage = document.createElement("div");
    stage.className = "fstage";
    stage.style.cssText += "justify-content:space-between;";
    root.appendChild(stage);

    const isYes = String(fields.answer).toLowerCase() === "yes";
    const TONE = isYes ? "var(--positive)" : "var(--negative)";
    const pct = fields.pct != null ? Number(fields.pct) : null;

    // ---------------- header: kicker + reserved status chip ----------------
    const head = document.createElement("div");
    head.style.cssText =
      "flex:none;height:" + u(64) + ";display:flex;align-items:center;justify-content:space-between;gap:" + u(28) + ";";
    stage.appendChild(head);

    const kick = document.createElement("div");
    kick.className = "fkicker";
    kick.style.cssText += "gap:" + u(20) + ";";
    const kickLabel = document.createElement("div");
    kickLabel.className = "flabel";
    kickLabel.style.cssText = "font-size:" + T("--t-label", 0.9) + ";white-space:nowrap;";
    kickLabel.textContent = "Question";
    const tick = document.createElement("div");
    tick.className = "ftick";
    tick.style.cssText += "width:" + u(86) + ";height:" + u(5) + ";transform-origin:left center;";
    kick.appendChild(kickLabel);
    kick.appendChild(tick);
    head.appendChild(kick);

    const chip = document.createElement("div");
    chip.className = "fchip";
    chip.style.cssText +=
      "flex:none;display:flex;align-items:center;justify-content:center;height:" + u(64) + ";" +
      "min-width:" + u(256) + ";padding:0 " + u(30) + ";white-space:nowrap;font-weight:800;" +
      "font-size:" + T("--t-label", 0.78) + ";letter-spacing:var(--label-tracking);text-transform:uppercase;";
    chip.textContent = "Pending";
    head.appendChild(chip);

    // ---------------- question headline ----------------
    const qWrap = document.createElement("div");
    qWrap.style.cssText = "flex:1 1 auto;min-height:0;display:flex;align-items:center;padding:" + u(18) + " 0;";
    stage.appendChild(qWrap);

    const q = document.createElement("div");
    q.className = "fhero";
    qWrap.appendChild(q);
    const qStr = String(fields.question || "");
    Film.util.fitText(q, qStr, 916 * U, 198 * U, { max: 112 * U, min: 42 * U, lineHeight: 1.0 });
    q.style.display = "block";
    q.style.wordBreak = "normal";
    const qHandle = fx.text(q, qStr, ctx.textEffect);
    // fx.text rebuilds the line out of inline-block glyph boxes and the negative display
    // tracking is not applied between boxes, so the settled headline can be wider/taller than
    // the size fitText picked. Re-measure once here (build time only) and step down.
    for (let i = 0; i < 14; i++) {
      const cur = parseFloat(q.style.fontSize) || 0;
      if (cur <= 42 * U) break;
      if (q.scrollWidth <= 916 * U + 1 && q.scrollHeight <= 198 * U + 1) break;
      q.style.fontSize = Math.max(42 * U, cur - 4 * U) + "px";
    }

    // ---------------- verdict band ----------------
    const band = document.createElement("div");
    band.style.cssText = "flex:none;height:" + u(250) + ";display:flex;align-items:stretch;gap:" + u(30) + ";";
    stage.appendChild(band);

    const plate = document.createElement("div");
    plate.className = "fcard";
    plate.style.cssText += "flex:1 1 0;min-width:0;position:relative;overflow:hidden;";
    band.appendChild(plate);

    // pending group — absolutely centred so it cross-fades with the answer at zero layout cost
    const pend = document.createElement("div");
    pend.style.cssText =
      "position:absolute;left:" + u(46) + ";right:" + u(46) + ";top:0;bottom:0;display:flex;" +
      "flex-direction:column;align-items:center;justify-content:center;gap:" + u(30) + ";";
    plate.appendChild(pend);

    const scanW = 140 * U;
    const meterW = 430 * U;
    const meter = document.createElement("div");
    meter.className = "fmeter";
    meter.style.cssText += "flex:none;width:" + meterW + "px;height:" + u(16) + ";";
    const scan = document.createElement("div");
    scan.style.cssText =
      "position:absolute;left:0;top:0;bottom:0;width:" + scanW + "px;border-radius:999px;" +
      "background:var(--accent-grad);box-shadow:0 0 " + u(18) + " " + u(-4) + " var(--accent-glow);";
    meter.appendChild(scan);
    pend.appendChild(meter);

    const pendLabel = document.createElement("div");
    pendLabel.className = "flabel";
    pendLabel.style.cssText = "flex:none;font-size:" + T("--t-label", 0.84) + ";text-align:center;white-space:nowrap;";
    pendLabel.textContent = "Deciding";
    pend.appendChild(pendLabel);

    // answer — the one hero of the card
    const ansWrap = document.createElement("div");
    ansWrap.style.cssText =
      "position:absolute;left:" + u(24) + ";right:" + u(24) + ";top:0;bottom:0;" +
      "display:flex;align-items:center;justify-content:center;";
    plate.appendChild(ansWrap);
    const ans = document.createElement("div");
    ans.className = "fhero";
    ans.style.cssText += "color:" + TONE + ";line-height:.9;";
    ansWrap.appendChild(ans);
    const ansStr = isYes ? "YES" : "NO";
    Film.util.fitText(ans, ansStr, 540 * U, 206 * U, { max: 232 * U, min: 72 * U, lineHeight: 0.9, wrap: false });
    ans.style.textShadow = "0 0 " + u(70) + " color-mix(in srgb, " + TONE + " 45%, transparent)";

    // reserved confidence column (hairline-separated, right-aligned editorial stat)
    let stat = null, statNum = null, statFill = null;
    if (pct != null) {
      stat = document.createElement("div");
      stat.style.cssText =
        "flex:none;width:" + u(250) + ";position:relative;box-sizing:border-box;display:flex;" +
        "flex-direction:column;align-items:stretch;justify-content:space-between;" +
        "padding:" + u(16) + " 0 " + u(14) + " " + u(34) + ";";
      band.appendChild(stat);

      const rule = document.createElement("div");
      rule.className = "frule";
      rule.style.cssText += "position:absolute;left:0;top:" + u(12) + ";bottom:" + u(12) + ";width:" + u(2) + ";";
      stat.appendChild(rule);

      const statLabel = document.createElement("div");
      statLabel.className = "flabel";
      statLabel.style.cssText = "flex:none;font-size:" + T("--t-label", 0.74) + ";text-align:right;white-space:nowrap;";
      statLabel.textContent = "Confidence";
      stat.appendChild(statLabel);

      statNum = document.createElement("div");
      statNum.className = "fnum";
      statNum.style.cssText = "flex:1 1 auto;display:flex;align-items:center;justify-content:flex-end;";
      const numInk = document.createElement("div");
      numInk.className = "fnum";
      statNum.appendChild(numInk);
      stat.appendChild(statNum);
      Film.util.fitText(numInk, Math.round(pct) + "%", 214 * U, 132 * U, {
        max: 124 * U,
        min: 52 * U,
        lineHeight: 0.94,
        wrap: false,
      });
      statNum = numInk;

      const statMeter = document.createElement("div");
      statMeter.className = "fmeter";
      statMeter.style.cssText += "flex:none;width:100%;height:" + u(12) + ";";
      statFill = document.createElement("div");
      statFill.className = "fmeter-fill";
      statFill.style.width = "0%";
      statMeter.appendChild(statFill);
      stat.appendChild(statMeter);
    }

    root._r = {
      U, stage, tick, chip, qHandle, plate, pend, scan, ansWrap, ans, stat, statNum, statFill,
      travel: meterW - scanW,
      pct, TONE,
      revealAt: fields.revealAt,
    };
  },

  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const r = root._r;
    const U = r.U;
    const enterDur = fx.clamp(dur * 0.3, 0.4, 0.7);

    // ---- build 0-30%: the stage settles, then header / plate / stat 120ms apart ----
    const sp = fx.ease.outCubic(fx.prog(lt, 0.1, enterDur));
    r.stage.style.opacity = String(sp);
    r.stage.style.transform = "translateY(" + fx.lerp(26 * U, 0, sp) + "px)";
    r.tick.style.transform = "scaleX(" + fx.ease.outExpo(fx.prog(lt, 0.26, 0.45)) + ")";
    r.qHandle.update(fx.prog(lt, 0.18, Math.max(0.32, enterDur * 1.05)));

    const cp = fx.prog(lt, 0.22, 0.38);
    r.chip.style.opacity = String(fx.clamp(cp * 1.6, 0, 1));
    r.chip.style.transform = "scale(" + fx.lerp(0.82, 1, fx.ease.outBack(cp)) + ")";

    const bp = fx.ease.outCubic(fx.prog(lt, 0.3, enterDur));
    r.plate.style.opacity = String(bp);
    r.plate.style.transform = "translateY(" + fx.lerp(38 * U, 0, bp) + "px)";
    if (r.stat) {
      const stp = fx.ease.outCubic(fx.prog(lt, 0.42, enterDur));
      r.stat.style.opacity = String(stp);
      r.stat.style.transform = "translateY(" + fx.lerp(38 * U, 0, stp) + "px)";
    }

    // ---- reveal timing: honours fields.revealAt exactly as before ----
    const hasReveal = typeof r.revealAt === "number";
    const dataStart = hasReveal ? fx.clamp(r.revealAt, 0.5, Math.max(0.5, dur - 0.9)) : Math.min(dur * 0.4, 1.6);
    let dataDur = fx.clamp(dur * 0.25, 0.35, 0.6);
    if (hasReveal) dataDur = Math.min(dataDur, Math.max(0.05, dur - 0.3 - dataStart));

    const revealed = lt >= dataStart;
    const punch = fx.prog(lt, dataStart, dataDur);
    const rp = fx.ease.outCubic(punch);

    // ---- ambient breathe: while pending, one slow indeterminate sweep, always inside the track
    const sweep = 0.5 - 0.5 * Math.cos((lt / 2.1) * Math.PI * 2);
    r.scan.style.transform = "translateX(" + (r.travel * sweep).toFixed(2) + "px)";
    r.pend.style.opacity = String(1 - fx.prog(lt, dataStart, Math.max(0.12, dataDur * 0.42)));

    // ---- resolve: the verdict lands ----
    const ae = fx.ease.outBack(fx.clamp(punch / 0.7, 0, 1));
    const punchScale = 1 + Math.sin(fx.clamp(punch, 0, 1) * Math.PI) * 0.12;
    r.ansWrap.style.opacity = String(fx.clamp(punch / 0.28, 0, 1));
    r.ans.style.transform = "scale(" + fx.lerp(0.55, 1, ae) * punchScale + ")";

    const glow = 0.86 + 0.14 * Math.sin((lt / Math.max(0.5, dur)) * Math.PI * 2);
    r.plate.style.boxShadow = revealed
      ? "var(--card-shadow), 0 0 0 " + (3 * U).toFixed(2) + "px color-mix(in srgb, " + r.TONE + " " +
        (rp * 100).toFixed(0) + "%, transparent), 0 0 " + (78 * U * glow).toFixed(0) + "px " + (-14 * U).toFixed(0) +
        "px color-mix(in srgb, " + r.TONE + " " + (rp * 85).toFixed(0) + "%, transparent)"
      : "";

    r.chip.textContent = revealed ? "Answered" : "Pending";
    r.chip.classList.toggle("fchip-on", punch > 0.5);

    if (r.stat) {
      const on = punch > 0.02;
      r.statNum.classList.toggle("fnum-accent", on);
      r.statNum.style.color = on ? "" : "var(--text-dim)";
      r.statNum.textContent = on ? Math.round(rp * r.pct) + "%" : "—";
      r.statFill.style.width = rp * r.pct + "%";
      r.statFill.style.opacity = String(fx.clamp(punch * 4, 0, 1));
    }

    // ---- exit ramp ----
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
