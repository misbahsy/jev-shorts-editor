// TemplateId: numbered_point  fields: {number, title, sub?}
//
// Composition: ONE full-bleed card that IS the 940:550 stage (the aspect measureFit maps 1:1
// onto the panel content box), so the card fills both axes with nothing left over. Three
// persistent layers anchor it: a kicker header pinned to the top edge, the hero band (giant
// accent numeral | accent rule | fitted title) in the middle, and a ruled footer pinned to the
// bottom. An oversized ghost numeral sits behind the type for depth — anchored inside the card
// box and only ever drifting INWARD, because a decorative element that leaves its parent's box
// silently shrinks the whole composition (a clipped element still reports its full rect).
Film.registerTemplate("numbered_point", {
  underChin: false,
  build(root, fields, ctx) {
    const { fx } = ctx;
    root.style.cssText = "display:flex;align-items:center;justify-content:center;";

    const heroTok = parseFloat(ctx.theme["--t-hero"]) || 128;
    const bodyTok = parseFloat(ctx.theme["--t-body"]) || 46;

    const PAD_X = 58;
    const PAD_Y = 44;
    // Fixed px, not 100%: a body wider than the narrowed stage makes the core's virtual-width
    // candidates overflow and disqualify themselves, so the card is always authored at 1:1.
    const BODY_W = 960 - PAD_X * 2;

    const stage = document.createElement("div");
    stage.className = "fstage fcard";
    stage.style.cssText +=
      "align-items:center;overflow:hidden;padding:" + PAD_Y + "px " + PAD_X + "px;opacity:0;";
    root.appendChild(stage);

    const body = document.createElement("div");
    body.style.cssText =
      "position:relative;width:" + BODY_W + "px;height:100%;display:flex;flex-direction:column;box-sizing:border-box;";
    stage.appendChild(body);

    // ---- ghost numeral: the depth layer, strictly inside the card box ----
    const numStr = String(fields.number != null ? fields.number : "");
    const ghost = document.createElement("div");
    ghost.className = "fghost";
    ghost.style.cssText +=
      "right:0;bottom:2px;font-size:" + Math.round(fx.clamp(heroTok * 2.7, 240, 360)) + "px;z-index:0;";
    ghost.textContent = numStr;
    body.appendChild(ghost);

    // ---- kicker header ----
    const kicker = document.createElement("div");
    kicker.className = "fkicker";
    kicker.style.cssText += "position:relative;z-index:2;flex:none;";
    const tick = document.createElement("div");
    tick.className = "ftick";
    tick.style.cssText += "transform-origin:left center;";
    const klabel = document.createElement("div");
    klabel.className = "flabel";
    klabel.textContent = "Step";
    kicker.appendChild(tick);
    kicker.appendChild(klabel);
    body.appendChild(kicker);

    // ---- hero band ----
    const hero = document.createElement("div");
    hero.style.cssText =
      "position:relative;z-index:2;flex:1 1 auto;min-height:0;display:flex;align-items:center;gap:38px;";
    body.appendChild(hero);

    const numSize = Math.round(
      fx.clamp(heroTok * (numStr.length >= 3 ? 1.1 : numStr.length === 2 ? 1.48 : 1.9), 118, 258)
    );
    const num = document.createElement("div");
    num.className = "fnum fnum-accent";
    // .fnum-accent clips --accent-grad to the glyph; across a numeral this big the gradient
    // would run all the way into its pale end, so it is stretched to show mostly the strong
    // half. text-shadow:none because a family-level letterpress shadow paints ON TOP of a
    // background-clip:text fill and washes the whole numeral out. Still 100% token-driven.
    num.style.cssText =
      "flex:none;--num-weight:900;background-size:260% 100%;text-shadow:none;font-size:" +
      numSize + "px;opacity:0;";
    num.textContent = numStr;
    hero.appendChild(num);

    const bar = document.createElement("div");
    bar.className = "fbar";
    bar.style.cssText += "flex:none;width:5px;align-self:stretch;margin:14px 0;transform-origin:center top;";
    hero.appendChild(bar);

    const col = document.createElement("div");
    col.style.cssText =
      "flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;";
    hero.appendChild(col);

    const title = document.createElement("div");
    title.className = "fhero";
    col.appendChild(title);

    // ---- footer: hairline + accent bar + optional sub ----
    const foot = document.createElement("div");
    foot.style.cssText =
      "position:relative;z-index:2;flex:none;padding-top:24px;display:flex;align-items:center;gap:24px;";
    const rule = document.createElement("div");
    rule.className = "frule";
    rule.style.cssText += "position:absolute;left:0;right:0;top:0;height:2px;transform-origin:left center;";
    foot.appendChild(rule);
    // with a subtitle the bar is a lead-in mark; without one it becomes the footer itself, so
    // it is drawn long enough to read as a deliberate accent rather than a stub
    const hasSub = !!fields.sub;
    const footBar = document.createElement("div");
    footBar.className = "fbar";
    footBar.style.cssText +=
      "flex:none;width:" + (hasSub ? 58 : 250) + "px;height:" + (hasSub ? 7 : 10) + "px;transform-origin:left center;";
    foot.appendChild(footBar);

    let sub = null;
    if (hasSub) {
      sub = document.createElement("div");
      sub.style.cssText =
        "flex:1 1 auto;min-width:0;font-family:var(--font-body);font-weight:500;color:var(--text);" +
        "opacity:0;letter-spacing:-0.012em;";
      foot.appendChild(sub);
    }
    body.appendChild(foot);

    // ---- build-time measurement only (never per-frame) ----
    // The title is a stretched flex item, so its scrollWidth can never fall below the box it
    // sits in: maxW MUST be that box, not an arithmetic guess a few px under it (anything
    // smaller makes fitText shrink to its floor no matter how short the string is).
    const heroH = hero.getBoundingClientRect().height;
    const titleMaxW = Math.max(240, col.clientWidth);
    const titleStr = String(fields.title || "");
    const oneWord = !/\s/.test(titleStr.trim());
    Film.util.fitText(title, titleStr, titleMaxW, Math.max(120, heroH - 14), {
      max: Math.round(heroTok * 0.9),
      min: 38,
      lineHeight: 1.0,
      wrap: oneWord ? false : undefined,
      // the title is shown with wordBreak "normal", so it has to be fitted in that mode: a
      // long word ("FRAMEWORKS") must shrink the type, not be split by the measuring pass
      wordBreak: "normal",
    });
    title.style.display = "block";
    title.style.wordBreak = "normal";
    const titleHandle = fx.text(title, titleStr, ctx.textEffect);

    if (sub) {
      Film.util.fitText(sub, String(fields.sub), Math.max(240, sub.clientWidth), 110, {
        max: Math.round(bodyTok * 0.92),
        min: 28,
        lineHeight: 1.12,
        wrap: false,
      });
      sub.style.display = "block";
    }

    root._r = {
      stage, body, ghost, tick, klabel, num, bar, titleHandle, rule, footBar, sub,
      footGrow: hasSub ? 2.4 : 1.5,
    };
  },

  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const r = root._r;
    const enter = fx.clamp(dur * 0.32, 0.42, 0.7);

    // ---- build 0-30%: card, then header, numeral, title, footer. Every start offset sits
    //      between 0.10s and 0.44s, so nothing is already moving at lt=0 and the whole
    //      stagger sequence closes inside 500ms however many elements there are.
    const cp = fx.ease.outCubic(fx.prog(lt, 0.1, enter));
    r.stage.style.opacity = String(fx.clamp(cp * 1.2, 0, 1));
    r.stage.style.transform = "translateY(" + fx.lerp(26, 0, cp) + "px)";

    r.tick.style.transform = "scaleX(" + fx.ease.outExpo(fx.prog(lt, 0.18, 0.42)) + ")";
    const kp = fx.ease.outCubic(fx.prog(lt, 0.2, 0.36));
    r.klabel.style.opacity = String(kp);
    r.klabel.style.transform = "translateX(" + fx.lerp(-14, 0, kp) + "px)";

    // ---- breathe 30-70%: ONE slow ambient — the numeral swells and the ghost drifts inward
    //      across the whole beat. (1-cos)/2 keeps the drift one-directional so the ghost can
    //      never push past the card edge and shrink the measured composition.
    const amb = (1 - Math.cos(fx.clamp(lt / Math.max(dur, 0.001), 0, 1) * Math.PI * 2)) / 2;
    const breathe = 1 + amb * 0.02;

    const np = fx.ease.outBack(fx.prog(lt, 0.24, 0.5));
    r.num.style.opacity = String(fx.clamp(fx.prog(lt, 0.24, 0.26) * 1.6, 0, 1));
    r.num.style.transform =
      "translateY(" + fx.lerp(30, 0, np) + "px) scale(" + fx.lerp(0.84, 1, np) * breathe + ")";

    r.ghost.style.setProperty("--ghost-alpha", String(fx.ease.outCubic(fx.prog(lt, 0.28, 0.6)) * 0.085));
    r.ghost.style.transform = "translate(" + -10 * amb + "px," + -8 * amb + "px)";

    r.bar.style.transform = "scaleY(" + fx.ease.outExpo(fx.prog(lt, 0.3, 0.45)) + ")";
    r.titleHandle.update(fx.prog(lt, 0.32, fx.clamp(dur * 0.34, 0.45, 0.8)));

    r.rule.style.transform = "scaleX(" + fx.ease.outExpo(fx.prog(lt, 0.36, 0.5)) + ")";
    const fp = fx.ease.outCubic(fx.prog(lt, 0.42, 0.42));
    if (r.sub) {
      r.sub.style.opacity = String(fp * 0.78);
      r.sub.style.transform = "translateX(" + fx.lerp(-16, 0, fp) + "px)";
    }

    // ---- resolve 70-100%: the card takes the accent ring and the footer bar extends ----
    const dp = fx.ease.outCubic(fx.prog(lt, dur * 0.68, fx.clamp(dur * 0.22, 0.3, 0.55)));
    r.stage.classList.toggle("fcard-lit", dp > 0.05);
    r.footBar.style.transform =
      "scaleX(" + fx.ease.outExpo(fx.prog(lt, 0.38, 0.46)) * fx.lerp(1, r.footGrow, dp) + ")";

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
