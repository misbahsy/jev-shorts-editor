// keyword_pill — underChin: true. fields: {text, emoji?}
(function () {
  "use strict";
  Film.registerTemplate("keyword_pill", {
    underChin: true,
    build: function (root, fields, ctx) {
      root.style.position = "relative";
      var wrap = document.createElement("div");
      Object.assign(wrap.style, {
        position: "absolute",
        left: "50%",
        top: "50%",
        transformOrigin: "50% 50%",
      });
      root.appendChild(wrap);

      var pill = document.createElement("div");
      pill.className = "fcard";
      Object.assign(pill.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "16px",
        borderRadius: "999px",
        padding: "26px 46px",
        whiteSpace: "nowrap",
      });
      wrap.appendChild(pill);

      if (fields.emoji) {
        var emojiEl = document.createElement("div");
        emojiEl.textContent = fields.emoji;
        emojiEl.style.fontSize = "64px";
        emojiEl.style.lineHeight = "1";
        pill.appendChild(emojiEl);
      }

      var main = document.createElement("div");
      Object.assign(main.style, {
        fontFamily: "var(--font-display)",
        fontWeight: "var(--display-weight)",
        color: "var(--accent)",
        textTransform: "var(--display-case)",
        letterSpacing: "var(--display-tracking)",
      });
      pill.appendChild(main);

      var safeW = ctx.rect.w * 0.82 - (fields.emoji ? 90 : 0);
      Film.util.fitText(main, fields.text, safeW, ctx.rect.h * 0.6, { max: 92, min: 40, wrap: false });
      var textHandle = ctx.fx.text(main, fields.text, ctx.textEffect || "word_pop");

      root.__state = { wrap: wrap, pill: pill, textHandle: textHandle };
    },
    update: function (root, lt, dur, ctx) {
      var st = root.__state,
        fx = ctx.fx;
      var enterP = fx.prog(lt, 0, 0.4);
      var e = fx.ease.outBack(enterP);
      var exitStart = Math.max(0.1, dur - 0.2);
      var exitP = fx.ease.inOutCubic(fx.prog(lt, exitStart, 0.2));
      var scale = fx.lerp(0.55, 1, e) * fx.lerp(1, 0.9, exitP);
      st.wrap.style.transform = "translate(-50%,-50%) scale(" + scale + ")";
      st.wrap.style.opacity = String(fx.clamp(enterP * 1.6, 0, 1) * (1 - exitP));
      st.textHandle.update(fx.clamp((enterP - 0.1) / 0.7, 0, 1));
    },
  });
})();
