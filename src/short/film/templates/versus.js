// TemplateId: versus  fields: {left, right, leftSub?, rightSub?, winner?:"left"|"right"}
//
// Composition: two full-height cards on a 940:550 stage (the aspect measureFit maps 1:1 onto
// the panel content box) with the VS badge absolutely centred in the gutter so it can never
// collide with a card edge. Both cards are height:100% and carry a reserved status row, so a
// 1-line and a 2-line subtitle still produce identical card geometry.
Film.registerTemplate("versus", {
  underChin: false,
  build(root, fields, ctx) {
    root.style.cssText = "display:flex;align-items:center;justify-content:center;";

    const stage = document.createElement("div");
    stage.className = "fstage";
    // 72px gutter, not 92: the VS badge is 132px across and sits on top of the seam anyway, so
    // the extra 20px bought nothing but narrower cards — and card width is what sets how big
    // the two titles are allowed to be.
    stage.style.cssText += "flex-direction:row;align-items:stretch;gap:72px;";
    root.appendChild(stage);

    const winner = fields.winner === "left" || fields.winner === "right" ? fields.winner : null;

    function card(title, sub, side, index) {
      const c = document.createElement("div");
      c.className = "fcard";
      c.style.cssText =
        "flex:1 1 0;min-width:0;height:100%;display:flex;flex-direction:column;" +
        "padding:36px 34px 32px;box-sizing:border-box;overflow:hidden;";

      const kicker = document.createElement("div");
      kicker.className = "fkicker";
      kicker.style.cssText += "position:relative;display:flex;align-items:center;gap:14px;";
      const tick = document.createElement("div");
      tick.className = "ftick";
      kicker.appendChild(tick);
      // The kicker used to be a lone 40px dash — an ornament with nothing to introduce. An
      // index reads as deliberate editorial structure (the swiss/minimal references both
      // number their blocks) and costs no layout, because the row was already reserved.
      const kickTxt = document.createElement("div");
      kickTxt.className = "flabel";
      kickTxt.textContent = index;
      kicker.appendChild(kickTxt);
      c.appendChild(kicker);

      const mid = document.createElement("div");
      mid.style.cssText =
        "position:relative;flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;min-height:0;";
      c.appendChild(mid);

      // Oversized ghost index, pinned to the card's lower-right. This is what stops each card
      // reading as a caption floating in an empty rectangle. It is positioned with BOTH edges
      // inside the padding box on purpose: measureFit unions every descendant rect and
      // overflow:hidden does NOT shrink a clipped child's reported rect, so an ornament that
      // hangs past the card would silently inflate the union and shrink the whole composition.
      const ghost = document.createElement("div");
      ghost.className = "fghost";
      ghost.style.cssText +=
        "position:absolute;right:0;bottom:-18px;font-size:210px;line-height:.78;" +
        "pointer-events:none;z-index:0;";
      ghost.textContent = index;
      mid.appendChild(ghost);

      const t = document.createElement("div");
      t.className = "fhero";
      // position+z-index are LOAD-BEARING against the ghost above: a positioned element with
      // z-index:0 paints in step 8, above non-positioned inline text in step 5, so without
      // this the ghost index would sit on top of the title rather than behind it.
      t.style.cssText += "position:relative;z-index:1;";
      mid.appendChild(t);
      const titleStr = String(title || "");
      t.textContent = titleStr;

      let s = null;
      if (sub) {
        s = document.createElement("div");
        s.style.cssText =
          "position:relative;z-index:1;margin-top:18px;font-family:var(--font-body);font-weight:600;" +
          "color:var(--text);opacity:.78;" +
          "font-size:var(--t-body);line-height:1.16;letter-spacing:-0.012em;";
        s.textContent = String(sub);
        mid.appendChild(s);
      }

      // reserved status row — present (and sized) on BOTH cards so heights stay identical
      const status = document.createElement("div");
      status.className = "fchip";
      status.style.cssText +=
        "position:relative;align-self:flex-start;padding:12px 26px;font-size:var(--t-label);" +
        "font-weight:800;letter-spacing:var(--label-tracking);text-transform:uppercase;opacity:0;";
      status.textContent = "Winner";
      c.appendChild(status);

      return { el: c, title: t, titleStr, mid, sub: s, status, tick, ghost };
    }

    const L = card(fields.left, fields.leftSub, "left", "01");
    const R = card(fields.right, fields.rightSub, "right", "02");
    stage.appendChild(L.el);
    stage.appendChild(R.el);

    // THE TITLES ARE FITTED HERE, NOT INSIDE card(), AND THAT ORDER IS LOAD-BEARING.
    // fitText measures scrollWidth/scrollHeight, and a DETACHED subtree reports 0 for both —
    // the shrink loop then never runs and every title silently renders at `max`. That is what
    // produced the clipped "CHATGP" in the uppercase families: ChatGPT wanted 484px inside a
    // 348px card and overflow:hidden ate the T. Nothing was wrong with the numbers; the card
    // simply was not in the document yet when it was measured.
    [L, R].forEach(function (C) {
      // Measure the column we actually have instead of hardcoding a width: the card is
      // rebuilt once per VIRTUAL_WIDTHS candidate, so the real column is 348px in the full-
      // width candidate and much narrower in the 0.66 one.
      const avail = Math.max(140, C.mid.clientWidth);
      // A single word must never be broken mid-glyph ("ChatGP / T"), so it is fitted as one
      // unbreakable run and the size comes down instead. Multi-word titles may wrap.
      const oneWord = !/\s/.test(C.titleStr.trim());
      Film.util.fitText(C.title, C.titleStr, avail, 250, {
        max: 116,
        min: 34,
        lineHeight: 0.98,
        wrap: oneWord ? false : undefined,
      });
      C.title.style.display = "block";
      C.title.style.wordBreak = "normal";
      // Safety net for the wrapping branch: with white-space:normal a blockified flex item
      // reports scrollWidth == clientWidth however long the longest word is, so maxW cannot
      // bite and a single long word can still overflow once wordBreak goes back to normal.
      // One proportional step-down at build time (never per frame) closes that hole.
      if (C.title.scrollWidth > avail + 2) {
        const cur = parseFloat(getComputedStyle(C.title).fontSize) || 96;
        C.title.style.fontSize = Math.max(30, Math.floor(cur * (avail / C.title.scrollWidth))) + "px";
      }
    });

    // VS badge: absolutely placed in the gutter, out of flow, so nothing can overlap it
    const vs = document.createElement("div");
    vs.style.cssText =
      "position:absolute;left:50%;top:50%;width:132px;height:132px;margin:-66px 0 0 -66px;" +
      "border-radius:50%;display:flex;align-items:center;justify-content:center;" +
      "background:var(--panel-bg);box-shadow:0 0 0 3px var(--accent), 0 12px 24px -12px rgba(0,0,0,.75)," +
      "0 0 28px -14px var(--accent-glow);z-index:3;";
    const vsT = document.createElement("div");
    vsT.className = "fhero";
    vsT.style.cssText += "font-size:54px;color:var(--accent);line-height:1;-webkit-text-stroke:0;";
    vsT.textContent = "VS";
    vs.appendChild(vsT);
    stage.appendChild(vs);

    root._r = { L, R, vs, winner };
  },

  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const { L, R, vs, winner } = root._r;
    const enterDur = fx.clamp(dur * 0.35, 0.45, 0.8);

    // build 0-30%: cards arrive from their own side, 0.12s apart (well under the 500ms
    // total-stagger budget), first move offset off t=0 so the beat doesn't start mid-motion
    [[L, 0.1, -120], [R, 0.22, 120]].forEach(([c, delay, dx]) => {
      const p = fx.ease.outCubic(fx.prog(lt, delay, enterDur));
      c.el.style.opacity = String(p);
      c.el.style.transform = `translateX(${fx.lerp(dx, 0, p)}px)`;
      c.tick.style.transform = `scaleX(${fx.ease.outExpo(fx.prog(lt, delay + 0.14, 0.45))})`;
      c.tick.style.transformOrigin = "left center";
    });

    const vp = fx.prog(lt, enterDur * 0.55, 0.4);
    const ve = fx.ease.outBack(vp);
    vs.style.opacity = String(fx.clamp(vp * 1.4, 0, 1));
    // breathe 30-70%: one slow ambient rotation on the badge, nothing else moves
    const breathe = Math.sin((lt / dur) * Math.PI * 2) * 2.2;
    vs.style.transform = `scale(${fx.lerp(0.35, 1, ve)}) rotate(${breathe}deg)`;

    // resolve 70-100%: the verdict lands
    const dp = fx.ease.outCubic(fx.prog(lt, dur * 0.45, fx.clamp(dur * 0.25, 0.35, 0.6)));
    const win = winner === "left" ? L : winner === "right" ? R : null;
    const lose = winner === "left" ? R : winner === "right" ? L : null;
    if (win) {
      win.el.classList.toggle("fcard-lit", dp > 0.04);
      win.status.style.opacity = String(dp);
      win.status.style.transform = `translateY(${fx.lerp(14, 0, dp)}px)`;
      win.status.classList.toggle("fchip-on", dp > 0.5);
      win.el.style.transform += ` scale(${fx.lerp(1, 1.03, dp)})`;
      if (lose) lose.el.style.opacity = String(fx.lerp(1, 0.62, dp));
    }

    const exitDur = 0.2;
    const exitStart = dur - exitDur;
    if (lt >= exitStart) {
      const xp = fx.prog(lt, exitStart, exitDur);
      root.style.opacity = String(1 - xp);
      root.style.transform = `scale(${fx.lerp(1, 0.96, xp)})`;
    } else {
      root.style.opacity = "1";
      root.style.transform = "scale(1)";
    }
  },
});
