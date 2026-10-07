// big_statement — underChin: true. fields: {text, sub?}
(function () {
  "use strict";
  Film.registerTemplate("big_statement", {
    underChin: true,
    build: function (root, fields, ctx) {
      root.style.position = "relative";
      var card = document.createElement("div");
      card.className = "fcard";
      Object.assign(card.style, {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        padding: "40px 52px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        overflow: "hidden",
      });
      root.appendChild(card);

      var main = document.createElement("div");
      Object.assign(main.style, {
        fontFamily: "var(--font-display)",
        fontWeight: "var(--display-weight)",
        color: "var(--text)",
        textTransform: "var(--display-case)",
        letterSpacing: "var(--display-tracking)",
        WebkitTextStroke: "var(--text-stroke)",
      });
      card.appendChild(main);

      var maxH = fields.sub ? ctx.rect.h * 0.58 : ctx.rect.h - 110;
      Film.util.fitText(main, fields.text, ctx.rect.w - 168, maxH, { max: 150, min: 58 });
      var textHandle = ctx.fx.text(main, fields.text, ctx.textEffect);

      var subEl = null,
        subHandle = null;
      if (fields.sub) {
        subEl = document.createElement("div");
        Object.assign(subEl.style, {
          marginTop: "20px",
          color: "var(--text-dim)",
          fontFamily: "var(--font-body)",
          fontWeight: "500",
        });
        Film.util.fitText(subEl, fields.sub, ctx.rect.w - 168, ctx.rect.h * 0.3, { max: 54, min: 28 });
        card.appendChild(subEl);
        subHandle = ctx.fx.text(subEl, fields.sub, "slide_up");
      }

      root.__state = { card: card, textHandle: textHandle, subHandle: subHandle };
    },
    update: function (root, lt, dur, ctx) {
      var st = root.__state,
        fx = ctx.fx;
      var enterP = fx.prog(lt, 0, 0.45);
      var e = fx.ease.outCubic(enterP);
      var exitStart = Math.max(0.1, dur - 0.2);
      var exitP = fx.ease.inOutCubic(fx.prog(lt, exitStart, 0.2));
      var scale = fx.lerp(0.94, 1, e) * fx.lerp(1, 0.96, exitP);
      st.card.style.opacity = String(e * (1 - exitP));
      st.card.style.transform = "translateY(" + (1 - e) * 22 + "px) scale(" + scale + ")";
      st.textHandle.update(fx.clamp(enterP * 1.3, 0, 1));
      if (st.subHandle) st.subHandle.update(fx.clamp((enterP - 0.15) / 0.85, 0, 1));
    },
  });
})();
