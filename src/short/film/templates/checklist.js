// TemplateId: checklist  fields: {title?, items:string[2..4]}
Film.registerTemplate("checklist", {
  underChin: false,
  build(root, fields, ctx) {
    const { fx } = ctx;
    root.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:40px 72px;box-sizing:border-box;";

    let titleEl = null,
      titleHandle = null;
    if (fields.title) {
      titleEl = document.createElement("div");
      titleEl.style.cssText = `align-self:center;margin-bottom:48px;font-family:var(--font-display);font-weight:var(--display-weight);text-transform:var(--display-case);letter-spacing:var(--display-tracking);color:var(--text);font-size:60px;text-align:center;`;
      root.appendChild(titleEl);
      titleHandle = fx.text(titleEl, String(fields.title), ctx.textEffect);
    }

    const items = (fields.items || []).slice(0, 4);
    const list = document.createElement("div");
    list.style.cssText = `display:flex;flex-direction:column;gap:30px;width:100%;align-self:center;max-width:820px;`;
    root.appendChild(list);

    const rows = items.map((txt) => {
      const row = document.createElement("div");
      row.className = "fcard";
      row.style.cssText = `display:flex;align-items:center;gap:28px;padding:28px 36px;box-sizing:border-box;`;
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("width", "56");
      svg.setAttribute("height", "56");
      svg.setAttribute("viewBox", "0 0 56 56");
      svg.style.cssText = "flex:0 0 auto;";
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", "28");
      circle.setAttribute("cy", "28");
      circle.setAttribute("r", "25");
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", "var(--accent)");
      circle.setAttribute("stroke-width", "5");
      const check = document.createElementNS(svgNS, "path");
      check.setAttribute("d", "M16 29 L24 37 L40 19");
      check.setAttribute("fill", "none");
      check.setAttribute("stroke", "var(--accent)");
      check.setAttribute("stroke-width", "6");
      check.setAttribute("stroke-linecap", "round");
      check.setAttribute("stroke-linejoin", "round");
      const len = 34;
      check.style.strokeDasharray = String(len);
      check.style.strokeDashoffset = String(len);
      svg.appendChild(circle);
      svg.appendChild(check);
      const label = document.createElement("div");
      label.style.cssText = `font-family:var(--font-body);font-weight:600;color:var(--text);font-size:42px;line-height:1.25;`;
      label.textContent = String(txt);
      row.appendChild(svg);
      row.appendChild(label);
      list.appendChild(row);
      return { row, check };
    });

    root._r = { titleHandle, rows };
  },
  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const { titleHandle, rows } = root._r;
    const enterDur = fx.clamp(dur * 0.3, 0.4, 0.65);
    if (titleHandle) titleHandle.update(fx.prog(lt, 0, enterDur * 0.8));

    const rowStagger = Math.min(0.15, enterDur / (rows.length + 1));
    const rowsStart = titleHandle ? enterDur * 0.3 : 0;
    rows.forEach((r, i) => {
      const p = fx.ease.outCubic(fx.prog(lt, rowsStart + i * rowStagger, 0.45));
      r.row.style.opacity = String(fx.clamp(p, 0, 1));
      r.row.style.transform = `translateX(${fx.lerp(-40, 0, p)}px)`;
    });

    const dataStart = dur * 0.45;
    const checkStagger = 0.18;
    rows.forEach((r, i) => {
      const cp = fx.ease.outCubic(fx.prog(lt, dataStart + i * checkStagger, 0.35));
      r.check.style.strokeDashoffset = String(34 * (1 - cp));
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
