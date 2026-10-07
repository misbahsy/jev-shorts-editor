// TemplateId: quote  fields: {text, by?}
Film.registerTemplate("quote", {
  underChin: false,
  build(root, fields, ctx) {
    const { fx } = ctx;
    root.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 72px;box-sizing:border-box;";

    const mark = document.createElement("div");
    mark.style.cssText = `font-family:var(--font-display);font-weight:900;color:var(--accent);font-size:160px;line-height:1;opacity:0;margin-bottom:-40px;`;
    mark.textContent = "“";
    root.appendChild(mark);

    const text = document.createElement("div");
    text.style.cssText = `font-family:var(--font-display);font-weight:var(--display-weight);text-transform:var(--display-case);letter-spacing:var(--display-tracking);-webkit-text-stroke:var(--text-stroke);color:var(--text);font-size:72px;line-height:1.25;text-align:center;max-width:840px;`;
    root.appendChild(text);
    const textHandle = fx.text(text, String(fields.text || ""), ctx.textEffect);

    let byEl = null,
      lineEl = null;
    if (fields.by) {
      lineEl = document.createElement("div");
      lineEl.style.cssText = `margin-top:36px;height:5px;width:0;background:var(--accent);border-radius:3px;`;
      root.appendChild(lineEl);
      byEl = document.createElement("div");
      byEl.style.cssText = `margin-top:24px;font-family:var(--font-body);font-weight:600;color:var(--text-dim);font-size:40px;opacity:0;`;
      byEl.textContent = String(fields.by);
      root.appendChild(byEl);
    }

    root._r = { mark, textHandle, byEl, lineEl };
  },
  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const { mark, textHandle, byEl, lineEl } = root._r;
    const enterDur = fx.clamp(dur * 0.35, 0.45, 0.8);
    const mp = fx.ease.outBack(fx.prog(lt, 0, enterDur * 0.6));
    mark.style.opacity = String(fx.clamp(mp, 0, 1));
    mark.style.transform = `scale(${fx.lerp(0.6, 1, mp)})`;

    textHandle.update(fx.prog(lt, enterDur * 0.2, enterDur));

    if (byEl) {
      const dataStart = dur * 0.5;
      const lp = fx.ease.outCubic(fx.prog(lt, dataStart, 0.4));
      lineEl.style.width = `${fx.lerp(0, 160, lp)}px`;
      const bp = fx.ease.outCubic(fx.prog(lt, dataStart + 0.15, 0.4));
      byEl.style.opacity = String(bp);
      byEl.style.transform = `translateY(${fx.lerp(12, 0, bp)}px)`;
    }

    const exitDur = 0.2,
      exitStart = dur - exitDur;
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
