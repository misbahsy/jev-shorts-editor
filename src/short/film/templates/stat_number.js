// stat_number — underChin: true. fields: {value, unit?, label}
(function () {
  "use strict";

  function parseNumeric(value) {
    var s = String(value);
    var m = s.match(/^(-?[\d,.]+)(.*)$/);
    if (!m) return null;
    var numStr = m[1].replace(/,/g, "");
    var num = parseFloat(numStr);
    if (isNaN(num)) return null;
    var decimals = numStr.indexOf(".") >= 0 ? numStr.split(".")[1].length : 0;
    return { num: num, decimals: decimals, suffix: m[2] || "" };
  }

  Film.registerTemplate("stat_number", {
    underChin: true,
    build: function (root, fields, ctx) {
      root.style.position = "relative";
      var card = document.createElement("div");
      card.className = "fcard";
      Object.assign(card.style, {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        padding: "36px 44px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        overflow: "hidden",
      });
      root.appendChild(card);

      var numRow = document.createElement("div");
      Object.assign(numRow.style, {
        display: "flex",
        alignItems: "baseline",
        gap: "8px",
      });
      card.appendChild(numRow);

      var numEl = document.createElement("div");
      Object.assign(numEl.style, {
        fontFamily: "var(--font-display)",
        fontWeight: "var(--display-weight)",
        color: "var(--accent)",
        fontVariantNumeric: "tabular-nums",
      });
      numRow.appendChild(numEl);

      var unitEl = null;
      if (fields.unit) {
        unitEl = document.createElement("div");
        unitEl.textContent = fields.unit;
        Object.assign(unitEl.style, {
          fontFamily: "var(--font-display)",
          fontWeight: "700",
          color: "var(--text)",
        });
        numRow.appendChild(unitEl);
      }

      var parsed = parseNumeric(fields.value);
      var displayStr = parsed ? formatNum(parsed.num, parsed.decimals) + parsed.suffix : String(fields.value);
      var size = Film.util.fitText(numEl, displayStr, ctx.rect.w - 88, ctx.rect.h * 0.52, { max: 150, min: 64, wrap: false });
      if (unitEl) unitEl.style.fontSize = Math.round(size * 0.34) + "px";

      var labelEl = document.createElement("div");
      Object.assign(labelEl.style, {
        marginTop: "16px",
        color: "var(--text-dim)",
        fontFamily: "var(--font-body)",
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      });
      card.appendChild(labelEl);
      Film.util.fitText(labelEl, fields.label || "", ctx.rect.w - 88, ctx.rect.h * 0.22, { max: 44, min: 24 });
      var labelHandle = ctx.fx.text(labelEl, fields.label || "", "slide_up");

      root.__state = {
        card: card,
        numEl: numEl,
        parsed: parsed,
        rawStr: String(fields.value),
        labelHandle: labelHandle,
      };
    },
    update: function (root, lt, dur, ctx) {
      var st = root.__state,
        fx = ctx.fx;
      var enterP = fx.prog(lt, 0, 0.5);
      var e = fx.ease.outCubic(enterP);
      var exitStart = Math.max(0.1, dur - 0.2);
      var exitP = fx.ease.inOutCubic(fx.prog(lt, exitStart, 0.2));
      var scale = fx.lerp(0.85, 1, e) * fx.lerp(1, 0.95, exitP);
      st.card.style.opacity = String(fx.clamp(enterP * 1.4, 0, 1) * (1 - exitP));
      st.card.style.transform = "scale(" + scale + ")";

      if (st.parsed) {
        var countP = fx.ease.outExpo(fx.clamp(enterP * 1.15, 0, 1));
        var cur = st.parsed.num * countP;
        st.numEl.textContent = formatNum(cur, st.parsed.decimals) + st.parsed.suffix;
      }
      st.labelHandle.update(fx.clamp((enterP - 0.2) / 0.8, 0, 1));
    },
  });

  function formatNum(n, decimals) {
    return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
})();
