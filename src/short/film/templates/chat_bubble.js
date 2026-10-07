// TemplateId: chat_bubble  fields: {from?, message}
Film.registerTemplate("chat_bubble", {
  underChin: false,
  build(root, fields, ctx) {
    const { fx } = ctx;
    root.style.cssText = "display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 56px;box-sizing:border-box;";

    let fromEl = null;
    if (fields.from) {
      fromEl = document.createElement("div");
      fromEl.style.cssText = `margin-bottom:24px;font-family:var(--font-body);font-weight:700;color:var(--text-dim);font-size:38px;text-transform:uppercase;letter-spacing:.04em;opacity:0;`;
      fromEl.textContent = String(fields.from);
      root.appendChild(fromEl);
    }

    const bubble = document.createElement("div");
    bubble.className = "fcard";
    // NOT background:var(--accent) — a flat single-hue fill throws away every family's designed
    // card surface (--card-bg: the glass gradient, paper stock, terminal panel, etc.) and reads
    // as a generic default chat-bubble box in all 8 families. --accent-grad is the same two-stop
    // accent gradient the rest of this system already uses for a "filled accent" surface (see
    // .fchip-on in themes.js) — it keeps the bubble legibly accent-colored without flattening it.
    bubble.style.cssText = `position:relative;max-width:800px;padding:44px 52px;background:var(--accent-grad);border-color:transparent;opacity:0;`;
    const msg = document.createElement("div");
    msg.style.cssText = `font-family:var(--font-body);font-weight:600;color:var(--accent-ink);font-size:56px;line-height:1.3;text-align:left;`;
    bubble.appendChild(msg);
    root.appendChild(bubble);

    const dots = document.createElement("div");
    dots.className = "fcard";
    dots.style.cssText = `display:flex;align-items:center;justify-content:center;gap:14px;padding:28px 40px;opacity:0;position:absolute;`;
    for (let i = 0; i < 3; i++) {
      const d = document.createElement("div");
      d.style.cssText = `width:18px;height:18px;border-radius:50%;background:var(--text-dim);`;
      dots.appendChild(d);
    }
    root.appendChild(dots);

    const msgHandle = fx.text(msg, String(fields.message || ""), ctx.textEffect);
    root._r = { fromEl, bubble, dots, msgHandle };
  },
  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const { fromEl, bubble, dots, msgHandle } = root._r;

    if (fromEl) {
      const fp = fx.ease.outCubic(fx.prog(lt, 0, 0.4));
      fromEl.style.opacity = String(fp);
      fromEl.style.transform = `translateY(${fx.lerp(14, 0, fp)}px)`;
    }

    const dotsStart = 0.15;
    const dotsDur = fx.clamp(dur * 0.28, 0.3, 0.6);
    const dotsP = fx.prog(lt, dotsStart, dotsDur);
    const typingEnd = dotsStart + dotsDur;
    if (lt < typingEnd) {
      dots.style.opacity = String(fx.clamp(fx.ease.outCubic(dotsP), 0, 1));
      [...dots.children].forEach((d, i) => {
        const phase = (lt * 4 + i * 0.9) % 3;
        const bounce = phase < 1 ? Math.sin(phase * Math.PI) : 0;
        d.style.transform = `translateY(${-bounce * 10}px)`;
        d.style.opacity = String(fx.lerp(0.4, 1, bounce));
      });
    } else {
      dots.style.opacity = "0";
    }

    const bp = fx.ease.outBack(fx.prog(lt, typingEnd, 0.4));
    bubble.style.opacity = String(lt >= typingEnd ? fx.clamp(bp, 0, 1) : 0);
    bubble.style.transform = `scale(${fx.lerp(0.85, 1, bp)})`;
    if (lt >= typingEnd) {
      msgHandle.update(fx.prog(lt, typingEnd + 0.05, fx.clamp(dur * 0.3, 0.35, 0.7)));
    } else {
      msgHandle.update(0);
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
