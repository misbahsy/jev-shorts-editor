// TemplateId: flow_steps  fields: {steps:string[2..4]}
//
// Composition: a 940:550 stage (the aspect measureFit maps 1:1 onto the panel content box) that
// fills top-to-bottom — kicker header on the top edge, full-width step cards that share the
// whole middle, progress meter on the bottom edge. The connector is a real accent-gradient
// column that DRAWS DOWN as the flow advances; each connector lives in its own sized wrapper so
// the row geometry stays identical whether the line is drawn or not (a 0-height line is skipped
// by the fitter, a fixed wrapper is not).
Film.registerTemplate("flow_steps", {
  underChin: false,
  build(root, fields, ctx) {
    const { fx } = ctx;
    root.style.cssText = "display:flex;align-items:center;justify-content:center;";

    const titleTok = parseFloat(ctx.theme["--t-title"]) || 78;

    const steps = (fields.steps || []).slice(0, 4).map((s) => String(s));
    if (steps.length < 2) while (steps.length < 2) steps.push("");
    const n = steps.length;

    // Fixed px, not 100%: a column wider than the narrowed stage makes the core's
    // virtual-width candidates overflow and disqualify themselves, so the layout is
    // always authored at 1:1 against the 940-wide target.
    const COL_W = 940;
    const PAD_X = 34;
    const NUM_W = 96;
    const CONN_H = n >= 4 ? 22 : n === 3 ? 26 : 32;
    const SEP_INSET = n >= 4 ? 18 : n === 3 ? 26 : 38;

    const stage = document.createElement("div");
    stage.className = "fstage";
    stage.style.cssText += "align-items:center;";
    root.appendChild(stage);

    const col = document.createElement("div");
    col.style.cssText =
      "position:relative;width:" + COL_W + "px;height:100%;display:flex;flex-direction:column;";
    stage.appendChild(col);

    // ---- kicker header, anchored to both edges of the stage ----
    const kicker = document.createElement("div");
    kicker.className = "fkicker";
    kicker.style.cssText += "flex:none;";
    const tick = document.createElement("div");
    tick.className = "ftick";
    tick.style.cssText += "transform-origin:left center;";
    const klabel = document.createElement("div");
    klabel.className = "flabel";
    klabel.textContent = "Flow";
    const kspace = document.createElement("div");
    kspace.style.cssText = "flex:1 1 auto;";
    const kcount = document.createElement("div");
    kcount.className = "flabel";
    kcount.style.cssText += "color:var(--text);opacity:.5;";
    kcount.textContent = n + " Steps";
    kicker.appendChild(tick);
    kicker.appendChild(klabel);
    kicker.appendChild(kspace);
    kicker.appendChild(kcount);
    col.appendChild(kicker);

    // ---- step rows ----
    const rowsWrap = document.createElement("div");
    rowsWrap.style.cssText =
      "flex:1 1 auto;min-height:0;display:flex;flex-direction:column;margin:22px 0 20px;";
    col.appendChild(rowsWrap);

    const rows = [];
    const conns = [];
    steps.forEach((txt, i) => {
      if (i > 0) {
        const cw = document.createElement("div");
        cw.style.cssText = "position:relative;flex:none;width:100%;height:" + CONN_H + "px;";
        const line = document.createElement("div");
        line.style.cssText =
          "position:absolute;top:0;left:" + (PAD_X + NUM_W / 2 - 3) + "px;width:6px;height:100%;" +
          "background:var(--accent-grad-v);border-radius:999px;transform-origin:center top;" +
          "box-shadow:0 0 16px -8px var(--accent-glow);transform:scaleY(0);";
        cw.appendChild(line);
        rowsWrap.appendChild(cw);
        conns.push(line);
      }

      const row = document.createElement("div");
      row.className = "fcard";
      row.style.cssText =
        "flex:1 1 0;min-height:0;display:flex;align-items:center;box-sizing:border-box;" +
        "padding:0 " + PAD_X + "px;overflow:hidden;opacity:0;";

      const idx = document.createElement("div");
      idx.className = "fnum";
      // background-size keeps the accent gradient (added by .fnum-accent as the step lights) on
      // its strong half; text-shadow:none stops a family letterpress shadow painting over the
      // background-clip:text fill and washing the numeral out.
      idx.style.cssText =
        "flex:none;width:" + NUM_W + "px;text-align:center;color:var(--text);opacity:.34;" +
        "background-size:260% 100%;text-shadow:none;";
      idx.textContent = String(i + 1);

      const sep = document.createElement("div");
      sep.className = "frule";
      // px, never %: a percentage block margin resolves against the containing block WIDTH,
      // which would eat the whole row height and make the separator vanish.
      sep.style.cssText += "flex:none;width:2px;align-self:stretch;margin:" + SEP_INSET + "px 26px;";

      const label = document.createElement("div");
      label.className = "fhero";
      label.style.cssText += "flex:1 1 auto;min-width:0;";

      const dot = document.createElement("div");
      dot.style.cssText =
        "flex:none;width:16px;height:16px;border-radius:50%;margin-left:22px;background:var(--rule);";

      row.appendChild(idx);
      row.appendChild(sep);
      row.appendChild(label);
      row.appendChild(dot);
      rowsWrap.appendChild(row);
      rows.push({ el: row, idx, label, dot });
    });

    // ---- footer meter, anchored to the bottom edge ----
    const meter = document.createElement("div");
    meter.className = "fmeter";
    meter.style.cssText += "flex:none;width:100%;height:12px;";
    const fill = document.createElement("div");
    fill.className = "fmeter-fill";
    fill.style.cssText += "width:0%;";
    meter.appendChild(fill);
    col.appendChild(meter);

    // ---- build-time measurement only (never per-frame) ----
    const rowH = rows[0].el.getBoundingClientRect().height;
    const numSize = Math.round(fx.clamp(rowH * 0.5, 38, 94));
    rows.forEach((r) => (r.idx.style.fontSize = numSize + "px"));

    // the label is a stretched flex item: its scrollWidth floors at the box width, so maxW has
    // to BE that box (an arithmetic guess a few px under it shrinks every label to the floor)
    const labelMaxW = Math.max(200, rows[0].label.clientWidth);
    let size = Math.round(fx.clamp(rowH * 0.42, 30, titleTok));
    rows.forEach((r, i) => {
      const got = Film.util.fitText(r.label, steps[i], labelMaxW, Math.max(48, rowH - 28), {
        max: size,
        min: 26,
        lineHeight: 1.04,
        wrap: false,
      });
      if (typeof got === "number" && got < size) size = got;
    });
    // one type size across the whole flow so it reads as a single designed system
    rows.forEach((r) => {
      r.label.style.fontSize = size + "px";
      r.label.style.display = "block";
    });

    root._r = { stage, col, tick, klabel, kcount, rows, conns, meter, fill, n };
  },

  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const r = root._r;
    const n = r.n;

    // ---- build 0-30%: header, then rows from the left. The stagger is divided by the row
    //      count so 2 steps and 4 steps both finish arriving well inside 500ms.
    const kp = fx.ease.outCubic(fx.prog(lt, 0.1, 0.4));
    r.tick.style.transform = "scaleX(" + fx.ease.outExpo(fx.prog(lt, 0.12, 0.42)) + ")";
    r.klabel.style.opacity = String(kp);
    r.kcount.style.opacity = String(kp * 0.5);
    r.kcount.style.transform = "translateX(" + fx.lerp(18, 0, kp) + "px)";

    // ---- the steps arrive one at a time across the hold, so the card keeps changing while the
    //      speaker walks through them (slots stay reserved, so nothing reflows). Row i enters at
    //      enter0 + i * reveal; each lights as it lands and stays lit. All pure functions of lt.
    const rowDur = fx.clamp(dur * 0.22, 0.34, 0.5);
    const enter0 = 0.14;
    const revealSpan = Math.max(0.2, dur * 0.64 - enter0 - rowDur);
    const reveal = n > 1 ? Math.min(0.85, revealSpan / (n - 1)) : 0;
    const entryAt = (i) => enter0 + i * reveal;

    r.rows.forEach((row, i) => {
      const p = fx.ease.outCubic(fx.prog(lt, entryAt(i), rowDur));
      row.el.style.opacity = String(fx.clamp(p * 1.25, 0, 1));
      row.el.style.transform = "translateX(" + fx.lerp(-64, 0, p) + "px)";

      const ip = fx.ease.outBack(fx.prog(lt, entryAt(i) + 0.06, 0.46));
      row.idx.style.transform = "scale(" + fx.lerp(0.5, 1, ip) + ")";

      // a step lights as it lands
      const lp = fx.ease.outCubic(fx.prog(lt, entryAt(i) + rowDur * 0.45, 0.34));
      row.el.classList.toggle("fcard-lit", lp > 0.12);
      row.idx.classList.toggle("fnum-accent", lp > 0.35);
      row.idx.style.opacity = String(fx.lerp(0.34, 1, lp) * fx.clamp(p * 1.25, 0, 1));
      row.label.style.opacity = String(fx.lerp(0.62, 1, lp) * fx.clamp(p * 1.25, 0, 1));
      row.dot.style.background = lp > 0.45 ? "var(--accent-grad)" : "var(--rule)";
      row.dot.style.boxShadow = lp > 0.45 ? "0 0 " + fx.lerp(0, 26, lp) + "px -4px var(--accent-glow)" : "none";
      row.dot.style.transform = "scale(" + fx.lerp(1, 1.35, lp) + ")";
    });

    // the connector draws down between the two steps it joins, just before the next one lands
    r.conns.forEach((line, i) => {
      const cp = fx.ease.outExpo(fx.prog(lt, entryAt(i + 1) - 0.08, Math.min(0.34, reveal + 0.1)));
      line.style.transform = "scaleY(" + cp + ")";
      line.style.opacity = String(fx.clamp(cp * 2, 0, 1));
    });

    const mp = fx.ease.inOutCubic(fx.prog(lt, enter0, Math.max(0.3, (n - 1) * reveal + rowDur)));
    r.fill.style.width = (mp * 100).toFixed(2) + "%";
    r.meter.style.opacity = String(fx.ease.outCubic(fx.prog(lt, 0.2, 0.3)));

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
