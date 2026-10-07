// TemplateId: definition  fields: {term, meaning}
Film.registerTemplate("definition", {
  underChin: false,
  build(root, fields, ctx) {
    const { fx } = ctx;
    root.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 64px;box-sizing:border-box;";

    const term = document.createElement("div");
    term.style.cssText = `font-family:var(--font-display);font-weight:var(--display-weight);text-transform:var(--display-case);letter-spacing:var(--display-tracking);-webkit-text-stroke:var(--text-stroke);color:var(--text);font-size:96px;line-height:1.1;text-align:center;max-width:860px;`;
    root.appendChild(term);
    const termHandle = fx.text(term, String(fields.term || ""), ctx.textEffect);

    const divider = document.createElement("div");
    divider.style.cssText = `margin:34px 0;height:6px;width:0;background:var(--accent);border-radius:3px;`;
    root.appendChild(divider);

    const meaning = document.createElement("div");
    meaning.style.cssText = `font-family:var(--font-body);font-weight:500;color:var(--text-dim);font-size:48px;line-height:1.35;text-align:center;max-width:800px;opacity:0;`;
    meaning.textContent = String(fields.meaning || "");
    root.appendChild(meaning);

    root._r = { termHandle, divider, meaning };
  },
  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const { termHandle, divider, meaning } = root._r;
    const enterDur = fx.clamp(dur * 0.35, 0.45, 0.8);
    termHandle.update(fx.prog(lt, 0, enterDur));

    const dataStart = dur * 0.4;
    const dataDur = fx.clamp(dur * 0.25, 0.3, 0.55);
    const dp = fx.ease.outCubic(fx.prog(lt, dataStart, dataDur));
    divider.style.width = `${fx.lerp(0, 220, dp)}px`;

    const mp = fx.ease.outCubic(fx.prog(lt, dataStart + dataDur * 0.4, 0.5));
    meaning.style.opacity = String(mp);
    meaning.style.transform = `translateY(${fx.lerp(16, 0, mp)}px)`;

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
