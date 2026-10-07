// TemplateId: confidence_meter  fields: {label, pct, revealAt?}
//
// The donut chart is gone — a stroke-dashoffset ring reads as a 2019 admin dashboard.
// Composition is the `swiss` reference card: meta rule + micro-caps band on top, a huge
// tabular figure as the single hero, a full-width segmented readout, and a closing meta
// band. Authored on the 940:550 stage so measureFit maps it 1:1 onto the panel box.
Film.registerTemplate("confidence_meter", {
  underChin: false,
  build(root, fields, ctx) {
    root.style.cssText = "display:flex;align-items:center;justify-content:center;";

    const pct = Math.max(0, Math.min(100, Number(fields.pct) || 0));
    const band = pct >= 80 ? "High" : pct >= 55 ? "Medium" : "Low";

    const stage = document.createElement("div");
    stage.className = "fstage fcard";
    stage.style.cssText += "padding:38px 46px 34px;gap:0;";
    root.appendChild(stage);

    // --- top meta band
    const top = document.createElement("div");
    top.className = "fmeta fmeta-top";
    const topL = document.createElement("span");
    topL.textContent = "Confidence";
    const topR = document.createElement("span");
    topR.className = "on";
    topR.textContent = String(fields.label || "Signal");
    top.appendChild(topL);
    top.appendChild(topR);
    stage.appendChild(top);

    // --- body: hero figure on the left, accent slab on the right. The slab is what stops
    //     the composition being a small figure floating in a wide empty box.
    const body = document.createElement("div");
    body.style.cssText =
      "flex:1 1 auto;min-height:0;display:flex;align-items:stretch;gap:36px;padding:22px 0 6px;";
    stage.appendChild(body);

    const left = document.createElement("div");
    left.style.cssText =
      "flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:12px;";
    body.appendChild(left);

    // NOTE: no kicker here — the top meta band already says "Confidence" and repeating it
    // 60px lower as an ink block read as a duplicated label, not as hierarchy. The figure is
    // the hero and needs no introduction.
    // figure row: the number and its unit share a baseline
    const figure = document.createElement("div");
    figure.style.cssText = "display:flex;align-items:baseline;gap:6px;";
    left.appendChild(figure);

    const num = document.createElement("div");
    num.className = "fnum";
    num.style.cssText += "font-size:218px;color:var(--text);";
    num.textContent = "0";
    figure.appendChild(num);

    const unit = document.createElement("div");
    unit.className = "fnum";
    unit.style.cssText += "font-size:92px;color:var(--accent);";
    unit.textContent = "%";
    figure.appendChild(unit);

    const slab = document.createElement("div");
    slab.className = "fslab";
    slab.style.cssText += "flex:none;width:286px;";
    const slabV = document.createElement("div");
    slabV.className = "fhero";
    // color:inherit, NOT var(--accent-ink) — that hardcoding was a real bug. `.fslab` is
    // normally an accent-filled rectangle (ink text is right), but a family may restyle it as
    // an OUTLINED box: dark_luxe sets `.fslab{background:none;color:var(--accent)}`. An inline
    // colour on the child beats that class override, so the verdict word rendered near-black
    // on near-black and was effectively invisible. Inheriting lets each family's `.fslab` rule
    // decide, which is the whole point of the primitive.
    slabV.style.cssText +=
      "font-size:76px;line-height:.92;color:inherit;-webkit-text-stroke:0;text-shadow:none;";
    slabV.textContent = band;
    const slabS = document.createElement("small");
    slabS.textContent = "Certainty band";
    slab.appendChild(slabV);
    slab.appendChild(slabS);
    body.appendChild(slab);

    // The 76px above is the CEILING, not the size. "High" fits a 286px slab at 76px in every
    // family; "Medium" does not once the family sets a fat uppercase display face — bold_kinetic
    // rendered "MEDIU" with the M sheared off by the slab's overflow. Fit it down instead.
    //
    // Two things make this call work and both are load-bearing:
    //  - it runs AFTER body.appendChild(slab), because a detached subtree reports
    //    scrollWidth/scrollHeight 0 and the shrink loop would never run (the "CHATGP" bug);
    //  - align-self:flex-start first, because .fslab is a flex COLUMN and a stretched flex item
    //    can never report scrollWidth < clientWidth, so any maxW under the slab's own width
    //    would be unsatisfiable and fitText would walk straight down to `min`.
    slabV.style.alignSelf = "flex-start";
    const slabInner = Math.max(120, slab.clientWidth - 60); // 30px padding each side
    Film.util.fitText(slabV, band, slabInner, 110, {
      max: 76,
      min: 38,
      lineHeight: 0.92,
      wrap: false,
    });

    // --- segmented readout: 30 cells, far more designed than a smooth bar and it fills
    //     the full stage width. No per-cell shadow (30 shadows would cost real capture time);
    //     the wrapper carries one glow instead.
    const N = 30;
    const barWrap = document.createElement("div");
    barWrap.style.cssText =
      "flex:none;display:flex;gap:6px;height:46px;width:100%;margin-bottom:20px;" +
      "filter:none;";
    const cells = [];
    for (let i = 0; i < N; i++) {
      const cell = document.createElement("div");
      cell.style.cssText =
        "flex:1 1 0;height:100%;background:var(--meter-track);" +
        "border-radius:var(--chip-radius);box-shadow:var(--meter-inset);";
      barWrap.appendChild(cell);
      cells.push(cell);
    }
    stage.appendChild(barWrap);

    // --- bottom meta band
    const bot = document.createElement("div");
    bot.className = "fmeta fmeta-bot";
    const botL = document.createElement("span");
    botL.textContent = "0";
    const botR = document.createElement("span");
    botR.textContent = "100";
    bot.appendChild(botL);
    bot.appendChild(botR);
    stage.appendChild(bot);

    root._r = { stage, top, num, unit, cells, N, pct, band, barWrap, bot, slab, revealAt: fields.revealAt };
  },

  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const { top, num, unit, cells, N, pct, barWrap, bot, slab, revealAt } = root._r;
    const enterDur = fx.clamp(dur * 0.3, 0.4, 0.7);

    // build 0-30%: frame first, then the label block, then the empty readout. Offset off
    // t=0 so the beat does not start mid-motion.
    const fp = fx.ease.outCubic(fx.prog(lt, 0.08, enterDur));
    top.style.opacity = String(fp);
    top.style.transform = `translateY(${fx.lerp(-12, 0, fp)}px)`;
    bot.style.opacity = String(fp);

    const bp = fx.ease.outCubic(fx.prog(lt, 0.28, enterDur));
    barWrap.style.opacity = String(bp);

    // the figure arrives on its own, slightly later — it is the hero
    const np = fx.ease.outBack(fx.prog(lt, 0.3, enterDur));
    const figure = num.parentNode;
    figure.style.opacity = String(fx.clamp(fx.prog(lt, 0.3, enterDur) * 1.6, 0, 1));
    figure.style.transform = `translateY(${fx.lerp(26, 0, np)}px)`;

    // resolve: the count-up is speech-synced when finalize gave us a revealAt
    const hasReveal = typeof revealAt === "number";
    const dataStart = hasReveal ? fx.clamp(revealAt, 0.5, Math.max(0.5, dur - 0.9)) : Math.min(dur * 0.35, 1.6);
    let dataDur = fx.clamp(dur * 0.3, 0.5, 1.1);
    if (hasReveal) dataDur = Math.min(dataDur, Math.max(0.05, dur - 0.3 - dataStart));
    const dp = fx.ease.outCubic(fx.prog(lt, dataStart, dataDur));
    const shown = dp * pct;
    num.textContent = String(Math.round(shown));

    // cells light in order; the leading cell is brighter so the fill has a head
    const lit = (shown / 100) * N;
    for (let i = 0; i < N; i++) {
      const on = i < Math.floor(lit);
      const lead = !on && i < lit;
      cells[i].style.background = on || lead ? "var(--accent-grad)" : "var(--meter-track)";
      cells[i].style.opacity = lead ? String(fx.clamp(lit - i, 0.15, 1)) : "1";
      cells[i].style.transform = on || lead ? "scaleY(1)" : "scaleY(0.62)";
    }
    // The verdict slab is STRUCTURE, not payoff: if it waited for revealAt the right half of
    // the card would sit empty for most of the beat. It arrives with the build, from the right.
    const sp = fx.ease.outCubic(fx.prog(lt, 0.34, enterDur));
    slab.style.opacity = String(sp);
    slab.style.transform = `translateX(${fx.lerp(46, 0, sp)}px)`;

    barWrap.style.boxShadow = dp > 0.02 ? `0 0 26px -14px var(--accent-glow)` : "none";
    unit.style.opacity = String(fx.clamp(0.45 + dp * 0.55, 0, 1));

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
