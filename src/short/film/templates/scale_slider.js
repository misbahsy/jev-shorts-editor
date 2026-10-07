// TemplateId: scale_slider  fields: {question?, labels:string[2..5], value(float 0..labels.length-1), valueLabel?}
//
// The iOS track-and-knob is gone. This is a stepped ladder / equalizer: one full-height
// column per label, rising left to right, with the landed step lit in accent and a thin
// marker that carries the FLOAT precision of `value`. Built on the 940:550 stage with the
// `swiss` meta bands top and bottom so the composition fills the panel edge to edge.
Film.registerTemplate("scale_slider", {
  underChin: false,
  build(root, fields, ctx) {
    const { fx } = ctx;
    root.style.cssText = "display:flex;align-items:center;justify-content:center;";

    const labels = (fields.labels || []).slice(0, 5).map((s) => String(s));
    const n = Math.max(2, labels.length);
    while (labels.length < n) labels.push("");
    const value = fx.clamp(Number(fields.value) || 0, 0, n - 1);
    const vl = String(fields.valueLabel || "");
    const valueLabel = /^[\d.,%\s/]+$/.test(vl) && vl.trim() ? vl.trim() : labels[Math.round(value)] || "";

    const stage = document.createElement("div");
    stage.className = "fstage fcard";
    stage.style.cssText += "padding:36px 44px 32px;gap:0;";
    root.appendChild(stage);

    // --- top meta band
    const top = document.createElement("div");
    top.className = "fmeta fmeta-top";
    const topL = document.createElement("span");
    topL.textContent = "Scale";
    const topR = document.createElement("span");
    topR.className = "on";
    topR.textContent = valueLabel;
    top.appendChild(topL);
    top.appendChild(topR);
    stage.appendChild(top);

    // --- question as the hero line (fitted at build time, never re-measured)
    let qEl = null,
      qHandle = null;
    if (fields.question) {
      qEl = document.createElement("div");
      qEl.className = "fhero";
      // align-self:flex-start is LOAD-BEARING, not cosmetic — see the fitText note below.
      qEl.style.cssText += "margin-top:20px;flex:none;align-self:flex-start;";
      stage.appendChild(qEl);
      // TWO TRAPS live in these four lines.
      // 1) fitText sets display:inline-block, but a direct child of a flex column is
      //    BLOCKIFIED and STRETCHED, so clientWidth is the whole container — and scrollWidth
      //    can never report less than clientWidth. Every maxW below the container width is
      //    then unsatisfiable and the loop walks straight down to `min` (this is why the
      //    headline kept rendering at ~48px). `align-self:flex-start` above restores
      //    shrink-to-fit, which is what makes maxW mean anything at all here.
      // 2) .fstage only holds its 940:550 aspect while its content fits. A headline that
      //    wraps to a second line grows the stage, measureFit then divides by the taller box
      //    and the WHOLE card shrinks. Keeping short questions on one line is therefore a
      //    layout constraint, not a stylistic preference.
      const qs = String(fields.question);
      const oneLine = qs.length <= 26;
      Film.util.fitText(qEl, qs, 820, oneLine ? 200 : 158, {
        max: oneLine ? 116 : 74,
        min: 42,
        lineHeight: 1.02,
        wrap: oneLine ? false : undefined,
      });
      qEl.style.display = "block";
      qHandle = fx.text(qEl, String(fields.question), ctx.textEffect);
    }

    // --- ladder
    const ladder = document.createElement("div");
    ladder.style.cssText = "position:relative;flex:1 1 auto;min-height:0;margin-top:22px;";
    stage.appendChild(ladder);

    // bars live in their own row so every column shares one baseline; the labels sit in a
    // matching row underneath, separated by a rule the columns visibly stand on.
    const bars = document.createElement("div");
    bars.style.cssText =
      "position:absolute;left:0;right:0;top:26px;bottom:0;display:flex;align-items:flex-end;gap:12px;";
    ladder.appendChild(bars);

    const labelRow = document.createElement("div");
    labelRow.style.cssText =
      "flex:none;display:flex;gap:12px;margin-top:14px;padding-top:14px;border-top:2px solid var(--rule);";
    stage.appendChild(labelRow);

    const cols = labels.map((txt, i) => {
      // rising step heights: this is what makes it read as a SCALE and not a bar chart
      const h = 48 + (i / (n - 1)) * 52;
      const bar = document.createElement("div");
      bar.style.cssText =
        `flex:1 1 0;min-width:0;height:${h}%;background:var(--meter-track);box-shadow:var(--meter-inset);` +
        "border-radius:var(--bar-radius,16px) var(--bar-radius,16px) 0 0;transform-origin:bottom center;";
      bars.appendChild(bar);
      const lab = document.createElement("div");
      lab.style.cssText =
        "flex:1 1 0;min-width:0;text-align:center;font-family:var(--font-body);font-weight:800;" +
        "font-size:var(--t-label);letter-spacing:-0.012em;color:var(--text-dim);" +
        "overflow-wrap:anywhere;line-height:1.08;";
      lab.textContent = txt;
      labelRow.appendChild(lab);
      return { bar, lab, i };
    });

    // --- marker: rides the exact float position across the column centres
    const marker = document.createElement("div");
    marker.style.cssText =
      "position:absolute;top:0;width:3px;height:100%;background:var(--accent);opacity:0;" +
      "transform:translateX(-50%);border-radius:999px;box-shadow:0 0 16px -4px var(--accent-glow);";
    const cap = document.createElement("div");
    cap.style.cssText =
      "position:absolute;left:50%;top:-9px;width:20px;height:20px;margin-left:-10px;" +
      "border-radius:50%;background:var(--accent);";
    marker.appendChild(cap);
    ladder.appendChild(marker);

    root._r = { top, qHandle, cols, n, value, marker, bot: labelRow, ladder, revealAt: fields.revealAt };
  },

  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const { top, qHandle, cols, n, value, marker, bot, revealAt } = root._r;
    const enterDur = fx.clamp(dur * 0.3, 0.4, 0.7);

    const fp = fx.ease.outCubic(fx.prog(lt, 0.08, enterDur));
    top.style.opacity = String(fp);
    bot.style.opacity = String(fp);
    if (qHandle) qHandle.update(fx.prog(lt, 0.16, enterDur * 0.85));

    // build: columns grow from the baseline left to right, 90ms apart
    const stagger = Math.min(0.09, enterDur / (n + 2));
    cols.forEach((c) => {
      const p = fx.ease.outCubic(fx.prog(lt, 0.26 + c.i * stagger, 0.45));
      c.bar.style.transform = `scaleY(${fx.lerp(0.04, 1, p)})`;
      c.bar.style.opacity = String(p);
      c.lab.style.opacity = String(p);
      c.lab.style.transform = `translateY(${fx.lerp(10, 0, p)}px)`;
    });

    // resolve: speech-synced landing on the value
    const hasReveal = typeof revealAt === "number";
    const dataStart = hasReveal ? fx.clamp(revealAt, 0.5, Math.max(0.5, dur - 0.9)) : Math.min(dur * 0.35, 1.6);
    let dataDur = fx.clamp(dur * 0.3, 0.5, 1.0);
    if (hasReveal) dataDur = Math.min(dataDur, Math.max(0.05, dur - 0.3 - dataStart));
    const kp = fx.ease.outCubic(fx.prog(lt, dataStart, dataDur));
    const pos = kp * value;

    // column centres are (i+0.5)/n of the ladder width
    marker.style.left = ((pos + 0.5) / n) * 100 + "%";
    marker.style.opacity = String(fx.clamp(kp * 3, 0, 1));

    // A scale FILLS UP TO the value — it is a level, not a single selected option. Lighting
    // only Math.round(value) is wrong: 1.6 would light "Furious" while the marker (correctly)
    // sits between Frustrated and Furious. Columns up to floor(pos) are solid, the column the
    // value reaches into is held at a softer accent, and the marker carries the exact float.
    const live = kp > 0.06;
    const floorI = Math.floor(pos + 1e-6);
    const frac = pos - floorI;
    cols.forEach((c) => {
      const solid = live && c.i <= floorI;
      const partial = live && c.i === floorI + 1 && frac > 0.18;
      c.bar.style.background = solid
        ? "var(--accent-grad)"
        : partial
          ? "var(--accent-soft)"
          : "var(--meter-track)";
      c.bar.style.boxShadow =
        solid && c.i === floorI ? "0 0 54px -12px var(--accent-glow)" : "var(--meter-inset)";
      c.lab.style.color = solid ? "var(--accent)" : partial ? "var(--text)" : "var(--text-dim)";
    });

    const exitDur = 0.2,
      exitStart = dur - exitDur;
    if (lt >= exitStart) {
      const xp = fx.prog(lt, exitStart, exitDur);
      root.style.opacity = String(1 - xp);
      root.style.transform = `scale(${fx.lerp(1, 0.97, xp)})`;
    } else {
      root.style.opacity = "1";
      root.style.transform = "scale(1)";
    }
  },
});
