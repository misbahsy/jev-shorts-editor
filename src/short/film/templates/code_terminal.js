// TemplateId: code_terminal  fields: {lines:string[1..4]}
Film.registerTemplate("code_terminal", {
  underChin: false,
  build(root, fields, ctx) {
    root.style.cssText = "display:flex;align-items:center;justify-content:center;padding:40px;box-sizing:border-box;";

    const lines = (fields.lines || []).slice(0, 4);
    const win = document.createElement("div");
    win.className = "fcard";
    win.style.cssText = `width:880px;max-width:100%;padding:0;overflow:hidden;opacity:0;`;

    const bar = document.createElement("div");
    bar.style.cssText = `display:flex;align-items:center;gap:14px;padding:22px 28px;border-bottom:1px solid var(--card-border);`;
    ["#ff5f57", "#febc2e", "#28c840"].forEach((color) => {
      const dot = document.createElement("div");
      dot.style.cssText = `width:22px;height:22px;border-radius:50%;background:${color};`;
      bar.appendChild(dot);
    });
    win.appendChild(bar);

    const body = document.createElement("div");
    body.style.cssText = `padding:36px 40px;display:flex;flex-direction:column;gap:20px;min-height:${Math.max(200, lines.length * 70)}px;`;
    win.appendChild(body);
    root.appendChild(win);

    const rows = lines.map(() => {
      const row = document.createElement("div");
      row.style.cssText = `display:flex;align-items:baseline;gap:18px;`;
      const prompt = document.createElement("span");
      prompt.style.cssText = `font-family:var(--font-mono);font-weight:600;color:var(--accent);font-size:38px;`;
      prompt.textContent = ">";
      const txt = document.createElement("span");
      txt.style.cssText = `font-family:var(--font-mono);font-weight:500;color:var(--text);font-size:38px;line-height:1.4;white-space:pre-wrap;`;
      row.appendChild(prompt);
      row.appendChild(txt);
      body.appendChild(row);
      return txt;
    });

    const cursor = document.createElement("span");
    cursor.style.cssText = `display:inline-block;width:20px;height:40px;background:var(--accent);margin-left:6px;vertical-align:middle;`;
    if (rows.length) rows[rows.length - 1].parentElement.appendChild(cursor);

    root._r = { win, rows, cursor, lineStrs: lines.map(String) };
  },
  update(root, lt, dur, ctx) {
    const { fx } = ctx;
    const { win, rows, cursor, lineStrs } = root._r;
    const enterDur = fx.clamp(dur * 0.25, 0.35, 0.6);
    const wp = fx.ease.outCubic(fx.prog(lt, 0, enterDur));
    win.style.opacity = String(wp);
    win.style.transform = `translateY(${fx.lerp(24, 0, wp)}px) scale(${fx.lerp(0.96, 1, wp)})`;

    const typeStart = enterDur * 0.7;
    const perLineDur = fx.clamp((dur - typeStart - 0.3) / Math.max(1, rows.length), 0.35, 1.2);
    let cursorRow = rows[rows.length - 1];
    rows.forEach((txt, i) => {
      const start = typeStart + i * perLineDur;
      const p = fx.clamp(fx.prog(lt, start, perLineDur * 0.85), 0, 1);
      const str = lineStrs[i];
      const n = Math.round(str.length * p);
      txt.textContent = str.slice(0, n);
      if (p > 0 && p < 1) cursorRow = txt.parentElement;
      else if (p >= 1 && i === rows.length - 1) cursorRow = txt.parentElement;
    });
    if (cursor.parentElement !== cursorRow) cursorRow.appendChild(cursor);
    const blink = Math.floor(lt * 2.2) % 2 === 0;
    cursor.style.opacity = blink ? "1" : "0";

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
