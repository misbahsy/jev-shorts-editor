// TemplateId: icon_row  fields: {items:{emoji,label}[2..4]}
Film.registerTemplate("icon_row", {
  underChin: false,
  build(root, fields, ctx) {
    root.style.cssText = "display:flex;align-items:center;justify-content:center;padding:40px;box-sizing:border-box;gap:24px;flex-wrap:wrap;";

    const items = (fields.items || []).slice(0, 4);
    const cards = items.map((it) => {
      const c = document.createElement("div");
      c.className = "fcard";
      c.style.cssText = `flex:0 0 auto;width:220px;min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;opacity:0;`;
      const emoji = document.createElement("div");
      emoji.style.cssText = `font-size:96px;line-height:1;`;
      emoji.textContent = String(it.emoji || "");
      const label = document.createElement("div");
      label.style.cssText = `margin-top:22px;font-family:var(--font-body);font-weight:600;color:var(--text);font-size:36px;line-height:1.2;text-align:center;`;
      label.textContent = String(it.label || "");
      c.appendChild(emoji);
      c.appendChild(label);
      root.appendChild(c);
      return { c, emoji };
    });

    root._r = { cards };
  },
  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const { cards } = root._r;
    const enterDur = fx.clamp(dur * 0.3, 0.4, 0.65);
    const stagger = Math.min(0.14, enterDur / (cards.length + 1));

    cards.forEach((c, i) => {
      const p = fx.ease.outBack(fx.prog(lt, i * stagger, 0.45));
      c.c.style.opacity = String(fx.clamp(p, 0, 1));
      c.c.style.transform = `translateY(${fx.lerp(30, 0, p)}px) scale(${fx.lerp(0.8, 1, p)})`;
    });

    const dataStart = dur * 0.45;
    const sweepStagger = 0.2;
    cards.forEach((c, i) => {
      const hp = fx.prog(lt, dataStart + i * sweepStagger, 0.4);
      const bump = Math.sin(fx.clamp(hp, 0, 1) * Math.PI);
      c.emoji.style.transform = `scale(${1 + bump * 0.25})`;
      c.c.style.boxShadow = bump > 0.02 ? `var(--card-shadow), 0 0 ${fx.lerp(0, 28, bump)}px var(--accent)` : "";
    });

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
