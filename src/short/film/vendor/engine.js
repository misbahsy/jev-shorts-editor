/* 24fps editor engine · MIT · https://24fps.dev/video-editor
 *
 * One dependency-free module that renders captions, kinetic text, transitions, effects and layouts
 * on top of video. Every frame is a pure function of time, so it is seek-safe in HyperFrames,
 * Remotion and the browser alike:
 *
 *   const fx = mount(rootEl, { kind: "captions", preset, script, media });
 *   fx.render(seconds);   // call per frame
 *   await fx.ready;       // fonts loaded: wait for it before the first captured frame
 *   fx.destroy();
 *
 * rootEl must be a positioned box laid over the video. Sizes in presets are fractions of the
 * frame height (0.06 = 6% of the height), positions are fractions of width/height (0..1).
 */

export const VERSION = "0.4.0";

/* ---------- time helpers ---------- */

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, p) => a + (b - a) * p;
export const EASE = {
  linear: (p) => p,
  out: (p) => 1 - Math.pow(1 - p, 3),
  in: (p) => p * p * p,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  expo: (p) => (p === 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  back: (p) => 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2),
  elastic: (p) => (p === 0 || p === 1 ? p : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  snap: (p) => (p < 1 ? 0 : 1),
  bounce: (p) => {
    const n = 7.5625, d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
    if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
    return n * (p -= 2.625 / d) * p + 0.984375;
  },
};
const ease = (name) => EASE[name] || EASE.out;
const prog = (t, at, dur, e = "out") => ease(e)(clamp(dur > 0 ? (t - at) / dur : t >= at ? 1 : 0));
/* deterministic pseudo-noise in [-1, 1] */
const noise = (x, seed = 1) => {
  const s = Math.sin(x * 12.9898 + seed * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};
const smoothNoise = (x, seed) => {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(noise(i, seed), noise(i + 1, seed), u);
};

/* ---------- DOM helpers ---------- */

const el = (tag, style = {}, parent) => {
  const n = document.createElement(tag);
  Object.assign(n.style, style);
  if (parent) parent.appendChild(n);
  return n;
};
const FILL = { position: "absolute", inset: "0" };
const fontCss = (f = {}) => ({
  fontFamily: `"${f.family || "Inter"}", system-ui, sans-serif`,
  fontWeight: String(f.weight || 400),
  fontStyle: f.italic ? "italic" : "normal",
});
/* sizes are fractions of frame height; the root is a size container so 1cqh = 1% of height */
const h = (v) => `${(v * 100).toFixed(3)}cqh`;

const loaded = new Set();
let fontsPending = Promise.resolve(), fontsBusy = 0, fontEpoch = 0;
/** Load Google Fonts used by a preset (no-op outside a browser document). Resolves when they are in. */
export function loadFonts(families) {
  if (typeof document === "undefined") return;
  const need = families.filter((f) => f && f.family && !loaded.has(f.family + (f.italic ? "i" : "") + (f.weight || 400)));
  if (!need.length) return fontsPending;
  const q = need.map((f) => {
    loaded.add(f.family + (f.italic ? "i" : "") + (f.weight || 400));
    return `family=${encodeURIComponent(f.family)}:ital,wght@${f.italic ? 1 : 0},${f.weight || 400}`;
  });
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${q.join("&")}&display=block`;
  document.head.appendChild(link);
  fontsBusy++;
  const ready = new Promise((r) => { link.onload = link.onerror = r; }).then(() => Promise.allSettled(need.map((f) => document.fonts.load(`${f.italic ? "italic " : ""}${f.weight || 400} 1em "${f.family}"`)))).then(() => { fontsBusy--; fontEpoch++; });
  return (fontsPending = Promise.all([fontsPending, ready]));
}
/* font-display:block shows chips and panels with invisible text until the font arrives: keep text boxes hidden until then */
const afterFonts = (...nodes) => {
  if (typeof document === "undefined") return;
  nodes.forEach((n) => { n.style.visibility = "hidden"; });
  const show = () => nodes.forEach((n) => { n.style.visibility = ""; });
  Promise.race([fontsPending, new Promise((r) => setTimeout(r, 3000))]).then(show, show);
};

/* ---------- shared text animation ---------- */

/** State of one text unit `p` (0..1 progress of its entrance) for an entrance style. */
function enter(type, p, i = 0) {
  const s = { o: 1, x: 0, y: 0, sc: 1, rot: 0, blur: 0, clip: 0, sx: 1, sy: 1, rx: 0, ry: 0, hue: 0, cp: "" };
  const q = 1 - p;
  switch (type) {
    case "none": break;
    case "fade": s.o = p; break;
    case "rise": s.o = p; s.y = (1 - p) * 0.6; break;
    case "drop": s.o = p; s.y = -(1 - p) * 0.6; break;
    case "slide-left": s.o = p; s.x = (1 - p) * 0.8; break;
    case "slide-right": s.o = p; s.x = -(1 - p) * 0.8; break;
    case "pop": s.o = clamp(p * 3); s.sc = lerp(0.4, 1, EASE.back(p)); break;
    case "slam": s.o = clamp(p * 4); s.sc = lerp(2.2, 1, EASE.expo(p)); break;
    case "scale": s.o = p; s.sc = lerp(0.7, 1, p); break;
    case "blur": s.o = p; s.blur = (1 - p) * 0.5; break;
    case "bounce": s.o = clamp(p * 3); s.y = (1 - EASE.elastic(p)) * 0.5; break;
    case "mask-up": s.clip = 1 - p; s.y = (1 - p) * 0.3; break;
    case "flip": s.o = clamp(p * 2); s.rot = (1 - p) * -90; break;
    case "stretch": s.o = clamp(p * 2); s.sx = lerp(2.4, 1, EASE.expo(p)); break;
    case "spin": s.o = p; s.rot = (1 - p) * 180; s.sc = lerp(0.3, 1, p); break;
    case "type": s.o = p > 0 ? 1 : 0; break;
    case "glitch": s.o = p > 0 ? 1 : 0; s.x = p < 1 ? noise(i + Math.floor(p * 12), 3) * 0.25 : 0; break;
    case "wipe-right": s.cp = `inset(-20% ${(q * 100).toFixed(1)}% -20% 0)`; break;
    case "wipe-left": s.cp = `inset(-20% 0 -20% ${(q * 100).toFixed(1)}%)`; break;
    case "wipe-down": s.cp = `inset(0 0 ${(q * 100).toFixed(1)}% 0)`; break;
    case "reveal-center": s.cp = `inset(-20% ${(q * 50).toFixed(1)}% -20% ${(q * 50).toFixed(1)}%)`; break;
    case "iris": s.cp = `circle(${(p * 80).toFixed(1)}% at 50% 50%)`; break;
    case "flip-x": s.o = clamp(p * 2); s.rx = q * 90; break;
    case "flip-y": s.o = clamp(p * 2); s.ry = q * -90; break;
    case "zoom-in": s.o = clamp(p * 2); s.sc = Math.max(0.001, p); break;
    case "shrink": s.o = p; s.sc = lerp(1.8, 1, p); break;
    case "swing": s.o = clamp(p * 3); s.rot = (1 - EASE.elastic(p)) * 40; break;
    case "roll": s.o = p; s.x = -q * 1.2; s.rot = -q * 240; break;
    case "fly-in": s.o = p; s.x = -q * 1.5; s.y = q; s.rot = -q * 15; break;
    case "corner": s.o = p; s.x = -q * 0.8; s.y = -q * 0.8; break;
    case "drop-bounce": s.o = clamp(p * 4); s.y = -(1 - EASE.bounce(p)) * 1.2; break;
    case "jelly": { const w = Math.sin(p * Math.PI * 3) * q * 0.4; s.o = clamp(p * 3); s.sx = 1 + w; s.sy = 1 - w; break; }
    case "flicker": s.o = p >= 1 ? 1 : noise(Math.floor(p * 20) + i * 7, 7) > 0 ? 1 : 0.12; break;
    case "blur-slide": s.o = p; s.x = q * 0.6; s.blur = q * 0.4; break;
    case "rise-blur": s.o = p; s.y = q * 0.5; s.blur = q * 0.4; break;
    case "squeeze": s.o = clamp(p * 3); s.sx = lerp(0.1, 1, EASE.back(p)); break;
    case "rotate-in": s.o = p; s.rot = -q * 90; s.sc = lerp(0.6, 1, p); break;
    case "disintegrate": { const r = (noise(i, 5) + 1) / 2; s.o = p; s.x = q * (0.2 + 0.5 * r); s.y = -q * 0.45 * (noise(i, 6) + 1) / 2 + q * 0.1 * noise(i, 8); s.rot = q * 30 * noise(i, 7); s.blur = q * 0.12; break; }
    default: s.o = p;
  }
  return s;
}
/* em-relative transform so motion scales with font size */
const apply = (n, s) => {
  n.style.opacity = s.o.toFixed(3);
  const d3 = s.rx || s.ry ? `perspective(6em) rotateX(${s.rx.toFixed(2)}deg) rotateY(${s.ry.toFixed(2)}deg) ` : "";
  n.style.transform = `translate(${s.x.toFixed(3)}em, ${s.y.toFixed(3)}em) ${d3}rotate(${s.rot.toFixed(2)}deg) scale(${(s.sc * s.sx).toFixed(3)}, ${(s.sc * s.sy).toFixed(3)})`;
  n.style.filter = `${s.blur ? `blur(${s.blur.toFixed(3)}em)` : ""}${s.hue ? ` hue-rotate(${s.hue.toFixed(1)}deg)` : ""}`.trim();
  n.style.clipPath = s.cp || (s.clip ? `inset(${(s.clip * 100).toFixed(1)}% 0 0 0)` : "");
};
/* which slot unit k animates in for an order: forward, reverse, random, center (middle out), edges */
const ordered = (k, n, order) => {
  if (order === "reverse") return n - 1 - k;
  if (order === "random") return [...Array(n).keys()].sort((a, b) => noise(a, 11) - noise(b, 11)).indexOf(k);
  if (order === "center") return Math.abs(k - (n - 1) / 2);
  if (order === "edges") return (n - 1) / 2 - Math.abs(k - (n - 1) / 2);
  return k;
};
/* continuous per-unit motion after the entrance */
const LOOPS = {
  float: (s, t, k) => { s.y += Math.sin(t * 2 + k) * 0.03; },
  pulse: (s, t) => { s.sc *= 1 + Math.sin(t * 6) * 0.03; },
  shake: (s, t) => { s.x += smoothNoise(t * 18, 2) * 0.02; s.y += smoothNoise(t * 18, 5) * 0.02; },
  swing: (s, t, k) => { s.rot += Math.sin(t * 3 + k * 0.3) * 6; },
  wobble: (s, t, k) => { s.rot += smoothNoise(t * 4, k + 3) * 5; },
  jump: (s, t, k) => { s.y -= Math.abs(Math.sin(t * 5 + k * 0.4)) * 0.15; },
  wave: (s, t, k) => { s.y += Math.sin(t * 4 + k * 0.6) * 0.12; },
  flicker: (s, t, k) => { if (noise(Math.floor(t * 16), k + 1) < -0.6) s.o *= 0.2; },
  spin: (s, t) => { s.rot += t * 90; },
  heartbeat: (s, t) => { s.sc *= 1 + Math.pow(Math.max(0, Math.sin(t * 8)), 8) * 0.12; },
  breathe: (s, t) => { s.sc *= 1 + Math.sin(t * 1.5) * 0.04; },
  rainbow: (s, t, k) => { s.hue += t * 120 + k * 20; },
  glitch: (s, t, k) => { const g = noise(Math.floor(t * 20), k + 9); if (g > 0.7) { s.x += noise(Math.floor(t * 40), k) * 0.1; s.hue += 90; } },
};

function decorate(n, d = {}) {
  if (d.color) n.style.color = d.color;
  if (d.stroke) n.style.webkitTextStroke = `${d.stroke.width || 0.06}em ${d.stroke.color || "#000"}`;
  if (d.stroke) n.style.paintOrder = "stroke fill";
  if (d.shadow) n.style.textShadow = d.shadow === true ? "0 0.06em 0.18em rgba(0,0,0,.55)" : d.shadow;
  if (d.case === "upper") n.style.textTransform = "uppercase";
  if (d.case === "lower") n.style.textTransform = "lowercase";
  if (d.tracking != null) n.style.letterSpacing = `${d.tracking}em`;
  if (d.gradient) {
    n.style.backgroundImage = d.gradient;
    n.style.webkitBackgroundClip = "text";
    n.style.color = "transparent";
  }
}

/* ---------- captions ---------- */

/** Split plain text into evenly timed words. `*word*` marks emphasis. */
export function timeWords(text, start = 0, wps = 2.6) {
  return text.split(/\s+/).filter(Boolean).map((raw, i) => {
    const emph = /^\*.*\*[.,!?]*$/.test(raw);
    return { w: raw.replace(/\*/g, ""), s: start + i / wps, e: start + (i + 1) / wps, emph };
  });
}

function captions(root, preset, script) {
  const p = { size: 0.06, y: 0.72, wordsPerLine: 3, maxLines: 1, animIn: "pop", animDur: 0.18, karaoke: "color", align: "center", gap: 0.25, ...preset };
  const words = Array.isArray(script) ? script : timeWords(script || "Every word lands *right* on the beat");
  loadFonts([p.font, p.emphasisFont]);
  const box = el("div", { position: "absolute", left: "6%", right: "6%", top: `${p.y * 100}%`, transform: "translateY(-50%)", display: "flex", flexDirection: "column", alignItems: p.align === "left" ? "flex-start" : p.align === "right" ? "flex-end" : "center", gap: `${p.gap * 0.5}em`, fontSize: h(p.size), lineHeight: String(p.lineHeight || 1.05), textAlign: p.align }, root);
  afterFonts(box);
  const per = p.wordsPerLine * p.maxLines;
  const pages = [];
  for (let i = 0; i < words.length; i += per) pages.push(words.slice(i, i + per));
  const built = pages.map((pg) => {
    const page = el("div", { display: "none", flexDirection: "column", alignItems: "inherit", gap: "inherit" }, box);
    const spans = [], lines = [];
    for (let l = 0; l < pg.length; l += p.wordsPerLine) {
      const line = el("div", { display: "flex", flexWrap: "wrap", justifyContent: "inherit", gap: `0 ${p.gap}em`, ...(p.box ? { padding: `${p.box.pad ?? 0.12}em ${(p.box.pad ?? 0.12) * 2}em`, borderRadius: `${p.box.radius ?? 0.2}em` } : {}) }, page);
      lines.push({ n: line, from: spans.length });
      for (const w of pg.slice(l, l + p.wordsPerLine)) {
        const f = w.emph && p.emphasisFont ? p.emphasisFont : p.font;
        const s = el("span", { display: "inline-block", position: "relative", ...fontCss(f), fontSize: w.emph && p.emphasisFont?.scale ? `${p.emphasisFont.scale}em` : "1em", padding: "0 0.06em", borderRadius: "0.18em", whiteSpace: "pre" }, line);
        s.textContent = w.w;
        decorate(s, { ...p, ...(w.emph && p.emphasisFont ? p.emphasisFont : {}) });
        spans.push({ n: s, w });
      }
    }
    return { page, spans, lines, s: pg[0].s, e: pg[pg.length - 1].e };
  });
  return (t) => {
    built.forEach((b, i) => {
      const next = built[i + 1];
      const on = t >= b.s - 0.05 && (next ? t < next.s - 0.05 : t < b.e + (p.hold ?? 0.6));
      b.page.style.display = on ? "flex" : "none";
      if (!on) return;
      b.spans.forEach(({ n, w }, k) => {
        const start = p.animScope === "page" ? b.s + k * (p.stagger ?? 0) : w.s;
        const st = enter(p.animIn, prog(t, start, p.animDur, p.ease || "out"), k);
        if (p.animIn === "type" && t < w.s) st.o = 0;
        apply(n, st);
        const active = t >= w.s && t < w.e;
        const past = t >= w.e;
        const k8 = p.karaoke;
        const base = (w.emph && p.emphasisFont?.color) || p.color || "#fff";
        n.style.color = k8 === "color" && active ? p.activeColor || "#ffd400" : k8 === "past" && (active || past) ? p.activeColor || "#ffd400" : p.gradient ? "transparent" : base;
        n.style.backgroundColor = k8 === "bg" && active ? p.activeBg || "#7c3aed" : "";
        if (k8 === "scale" && active) n.style.transform += " scale(1.12)";
        n.style.textDecoration = k8 === "underline" && active ? `underline ${p.activeColor || "#ffd400"} 0.08em` : "";
        if (k8 === "dim") n.style.opacity = String(active ? 1 : past ? 0.85 : 0.35);
      });
      /* a line's box shows once one of its words is visible, not before */
      if (p.box) b.lines.forEach((L, i) => { L.n.style.background = b.spans.slice(L.from, b.lines[i + 1]?.from).some(({ n }) => +n.style.opacity > 0.01) ? p.box.bg || "rgba(0,0,0,.6)" : ""; });
    });
  };
}

/* ---------- kinetic text scene ---------- */

function textScene(root, preset, media) {
  const layers = (preset.layers || []).map((L, i) => {
    loadFonts([L.font]);
    const z = L.z === "back" ? 1 : L.z === "behind-subject" ? 2 : 4;
    const wrap = el("div", { position: "absolute", left: `${(L.x ?? 0.5) * 100}%`, top: `${(L.y ?? 0.5) * 100}%`, zIndex: String(z), fontSize: h(L.size ?? 0.1), lineHeight: String(L.lineHeight ?? 0.95), textAlign: L.align || "center", width: L.width ? `${L.width * 100}%` : "max-content", maxWidth: "94%", whiteSpace: "pre-line", ...fontCss(L.font), color: L.color || "#fff", mixBlendMode: L.blend || "normal", opacity: String(L.opacity ?? 1) }, root);
    const ax = L.align === "left" ? "0%" : L.align === "right" ? "-100%" : "-50%";
    wrap.style.transform = `translate(${ax}, -50%) rotate(${L.rotate || 0}deg)`;
    decorate(wrap, L);
    const split = L.in?.split || "none";
    if (L.bg) Object.assign(wrap.style, { padding: "0.08em 0.22em", borderRadius: `${L.radius ?? 0.12}em`, ...(split === "none" && { background: L.bg }) });
    const units = [];
    const text = L.text || "Your text";
    if (split === "chars" || split === "words") {
      const parts = split === "chars" ? [...text] : text.split(/(\s+)/);
      for (const part of parts) {
        if (part.includes("\n")) { el("br", {}, wrap); continue; }
        const s = el("span", { display: "inline-block", whiteSpace: "pre" }, wrap);
        s.textContent = part;
        if (L.gradient) Object.assign(s.style, { backgroundImage: L.gradient, webkitBackgroundClip: "text", backgroundClip: "text" }); // clipping on the parent skips inline-block children
        units.push(s);
      }
      if (L.gradient) wrap.style.backgroundImage = "";
    } else {
      wrap.textContent = text.trim() ? text : "\u00a0"; // a blank layer is a panel one line tall
      units.push(wrap);
    }
    /* split layers: the box is its own node so it can enter with the first letters instead of sitting empty */
    const box = L.bg && split !== "none" ? el("div", { position: "absolute", inset: "0", zIndex: "-1", background: L.bg, borderRadius: `${L.radius ?? 0.12}em` }, wrap) : null;
    if (box) box.dataset.box = "";
    /* shine: a copy of the text, clipped to the letters, carrying a moving highlight */
    const shine = L.shine ? el("div", { position: "absolute", inset: "0", padding: "inherit", color: "transparent", webkitTextStroke: "0", textShadow: "none", pointerEvents: "none", webkitBackgroundClip: "text", backgroundClip: "text" }, wrap) : null;
    if (shine) { shine.textContent = text.trim() ? text : "\u00a0"; shine.dataset.shine = ""; }
    const emit = L.emit && L.loop !== "marquee" ? letterParticles(root, L, wrap, units, z) : null;
    return { L, wrap, units, box, emit, shine, i };
  });
  afterFonts(...layers.map((l) => l.wrap));
  if (media?.fg) media.fg.style.zIndex = "3";
  return (t) => {
    for (const { L, wrap, units, box, emit, shine } of layers) {
      let shown = 0;
      const at = L.in?.at ?? 0, dur = L.in?.dur ?? 0.5, stg = L.in?.stagger ?? 0.04;
      const outAt = L.out?.at, outDur = L.out?.dur ?? 0.3;
      units.forEach((u, k) => {
        const slot = ordered(k, units.length, L.in?.order);
        const st = enter(L.in?.type || "fade", prog(t, at + slot * stg, dur, L.in?.ease || "out"), k);
        if (outAt != null && t >= outAt) {
          const q = prog(t, outAt + ordered(k, units.length, L.out?.order) * stg * 0.5, outDur, L.out?.ease || "in");
          const o = enter(L.out.type || "fade", 1 - q, k);
          st.o *= o.o; st.y += o.y; st.x += o.x; st.blur += o.blur; st.clip = Math.max(st.clip, o.clip);
          st.sc *= o.sc; st.sx *= o.sx; st.sy *= o.sy; st.rot += o.rot; st.rx += o.rx; st.ry += o.ry; st.cp = o.cp || st.cp;
        }
        if (LOOPS[L.loop]) LOOPS[L.loop](st, t, k);
        shown = Math.max(shown, st.o);
        if (units.length === 1 && u === wrap) {
          const ax = L.align === "left" ? "0%" : L.align === "right" ? "-100%" : "-50%";
          apply(u, st);
          u.style.transform = `translate(${ax}, -50%) rotate(${L.rotate || 0}deg) ` + u.style.transform;
          u.style.opacity = String(st.o * (L.opacity ?? 1));
        } else apply(u, st);
      });
      if (box) box.style.opacity = t < at || (outAt != null && t >= outAt + outDur + units.length * stg * 0.5) ? "0" : shown.toFixed(3);
      if (emit) emit(t);
      if (shine) {
        const { every = 2.5, width = 0.2, dur: sd = 0.8, color = "rgba(255,255,255,.9)" } = L.shine, w = width * 100;
        const age = t - (at + (units.length - 1) * stg + dur + 0.15), p = age >= 0 && (outAt == null || t < outAt) ? (age % every) / sd : 2;
        const x = lerp(-w, 100 + w, EASE.inOut(clamp(p)));
        shine.style.backgroundImage = p <= 1 ? `linear-gradient(105deg, transparent ${(x - w).toFixed(1)}%, ${color} ${x.toFixed(1)}%, transparent ${(x + w).toFixed(1)}%)` : "none";
      }
      if (L.loop === "marquee") wrap.style.left = `${(((L.x ?? 0.5) - t * 0.08) % 1.4) * 100}%`;
    }
  };
}

/* ---------- transitions between media.a and media.b ---------- */

const pct = (pts) => `polygon(${pts.map(([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`).join(", ")})`;
/* unit shapes (centred on 0,0, radius ~1) for shape-reveal transitions */
const SHAPES = {
  diamond: [[0, -1], [1, 0], [0, 1], [-1, 0]],
  star: [...Array(10)].map((_, i) => { const r = i % 2 ? 0.45 : 1, a = (i / 10) * Math.PI * 2 - Math.PI / 2; return [Math.cos(a) * r, Math.sin(a) * r]; }),
  heart: [...Array(24)].map((_, i) => { const a = (i / 24) * Math.PI * 2; return [(16 * Math.sin(a) ** 3) / 17, -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17]; }),
};
function clockPoly(q, cx = 0.5, cy = 0.5) {
  const pts = [[cx, cy], [cx, -1]];
  const end = q * Math.PI * 2;
  for (let a = Math.PI / 4; a < end; a += Math.PI / 2) pts.push([cx + Math.sin(a) * 2, cy - Math.cos(a) * 2]);
  pts.push([cx + Math.sin(end) * 2, cy - Math.cos(end) * 2]);
  return pct(pts);
}

function transition(root, preset, media) {
  const p = { at: 1.2, dur: 0.5, type: "whip", dir: "left", color: "#fff", ease: "inOut", ...preset };
  const { a, b } = media;
  [a, b].forEach((m, i) => Object.assign(m.style, { ...FILL, zIndex: String(i + 1), willChange: "transform, filter, clip-path" }));
  const over = el("div", { ...FILL, zIndex: "5", pointerEvents: "none", opacity: "0" }, root);
  const sign = p.dir === "left" || p.dir === "up" ? -1 : 1;
  const axis = p.dir === "up" || p.dir === "down" ? "Y" : "X";
  return (t) => {
    const q = prog(t, p.at, p.dur, p.ease);
    const pre = t < p.at + p.dur / 2;
    const reset = (m, z) => Object.assign(m.style, { transform: "", filter: "", clipPath: "", opacity: "1", maskImage: "", webkitMaskImage: "", transformOrigin: "", backfaceVisibility: "", zIndex: z });
    reset(a, "1"); reset(b, "2");
    over.style.opacity = "0";
    over.style.background = "";
    b.style.visibility = q > 0 ? "visible" : "hidden";
    const blurPeak = Math.sin(q * Math.PI);
    switch (p.type) {
      case "cut": b.style.visibility = t >= p.at ? "visible" : "hidden"; break;
      case "crossfade": b.style.opacity = String(q); break;
      case "dip": over.style.background = p.color; over.style.opacity = String(blurPeak); b.style.visibility = pre ? "hidden" : "visible"; break;
      case "flash": over.style.background = p.color; over.style.opacity = String(Math.pow(blurPeak, 3)); b.style.visibility = pre ? "hidden" : "visible"; break;
      case "push":
        a.style.transform = `translate${axis}(${sign * q * 100}%)`;
        b.style.transform = `translate${axis}(${-sign * (1 - q) * 100}%)`;
        break;
      case "whip": {
        const off = (x) => `translate${axis}(${x}%)`;
        a.style.transform = off(sign * q * 60);
        b.style.transform = off(-sign * (1 - q) * 60);
        a.style.filter = b.style.filter = `blur(${(blurPeak * (p.blur ?? 24)).toFixed(1)}px)`;
        b.style.visibility = pre ? "hidden" : "visible";
        break;
      }
      case "zoom-in":
        a.style.transform = `scale(${1 + q * 1.6})`;
        b.style.transform = `scale(${0.6 + q * 0.4})`;
        a.style.filter = b.style.filter = `blur(${(blurPeak * 14).toFixed(1)}px)`;
        b.style.visibility = pre ? "hidden" : "visible";
        break;
      case "zoom-out":
        a.style.transform = `scale(${1 - q * 0.5})`;
        b.style.transform = `scale(${2 - q})`;
        a.style.filter = b.style.filter = `blur(${(blurPeak * 14).toFixed(1)}px)`;
        b.style.visibility = pre ? "hidden" : "visible";
        break;
      case "spin":
        a.style.transform = `rotate(${q * 180 * sign}deg) scale(${1 + blurPeak * 0.4})`;
        b.style.transform = `rotate(${(q - 1) * 180 * sign}deg) scale(${1 + blurPeak * 0.4})`;
        a.style.filter = b.style.filter = `blur(${(blurPeak * 10).toFixed(1)}px)`;
        b.style.visibility = pre ? "hidden" : "visible";
        break;
      case "wipe": {
        const v = (q * 100).toFixed(2);
        b.style.clipPath = p.dir === "left" ? `inset(0 0 0 ${100 - v}%)` : p.dir === "right" ? `inset(0 ${100 - v}% 0 0)` : p.dir === "up" ? `inset(${100 - v}% 0 0 0)` : `inset(0 0 ${100 - v}% 0)`;
        break;
      }
      case "circle": b.style.clipPath = `circle(${(q * 75).toFixed(2)}% at ${(p.cx ?? 0.5) * 100}% ${(p.cy ?? 0.5) * 100}%)`; break;
      case "diagonal": b.style.clipPath = `polygon(0 0, ${q * 200}% 0, ${q * 200 - 100}% 100%, 0 100%)`; break;
      case "blinds": {
        const n = p.slices || 8;
        const pts = [];
        for (let i = 0; i < n; i++) pts.push(`${(i / n) * 100}% 0, ${((i + q) / n) * 100}% 0, ${((i + q) / n) * 100}% 100%, ${(i / n) * 100}% 100%`);
        b.style.clipPath = `polygon(${pts.join(", ")})`;
        break;
      }
      case "glitch": {
        const k = Math.floor(t * 30);
        const j = blurPeak > 0.05;
        a.style.transform = j ? `translateX(${noise(k, 1) * 6 * blurPeak}%)` : "";
        b.style.transform = j ? `translateX(${noise(k, 2) * 6 * blurPeak}%)` : "";
        const y = ((noise(k, 4) + 1) / 2) * 80;
        b.style.clipPath = pre ? `inset(${y}% 0 ${Math.max(0, 90 - y)}% 0)` : "";
        b.style.visibility = q > 0 ? "visible" : "hidden";
        a.style.filter = b.style.filter = j ? `hue-rotate(${noise(k, 5) * 90}deg) saturate(${1 + blurPeak * 2})` : "";
        break;
      }
      case "burn":
        over.style.background = `radial-gradient(circle at ${30 + q * 40}% 60%, rgba(255,240,200,${blurPeak}), rgba(255,120,30,${blurPeak * 0.8}) 35%, rgba(120,20,0,${blurPeak * 0.4}) 70%, transparent)`;
        over.style.opacity = "1";
        over.style.mixBlendMode = "screen";
        b.style.opacity = String(q);
        break;
      case "rgb-split":
        a.style.filter = b.style.filter = `drop-shadow(${blurPeak * 12}px 0 0 rgba(255,0,60,.8)) drop-shadow(${-blurPeak * 12}px 0 0 rgba(0,200,255,.8))`;
        b.style.opacity = String(q);
        break;
      case "flip": {
        const r = axis === "X" ? "rotateY" : "rotateX";
        a.style.transform = `perspective(1400px) ${r}(${-sign * q * 180}deg)`;
        b.style.transform = `perspective(1400px) ${r}(${sign * (1 - q) * 180}deg)`;
        a.style.backfaceVisibility = b.style.backfaceVisibility = "hidden";
        break;
      }
      case "cube": {
        const r = axis === "X" ? "rotateY" : "rotateX", f = axis === "X" ? 1 : -1;
        a.style.transformOrigin = axis === "X" ? (sign < 0 ? "100% 50%" : "0% 50%") : sign < 0 ? "50% 100%" : "50% 0%";
        b.style.transformOrigin = axis === "X" ? (sign < 0 ? "0% 50%" : "100% 50%") : sign < 0 ? "50% 0%" : "50% 100%";
        a.style.transform = `perspective(1400px) translate${axis}(${sign * q * 100}%) ${r}(${f * sign * q * 90}deg)`;
        b.style.transform = `perspective(1400px) translate${axis}(${-sign * (1 - q) * 100}%) ${r}(${-f * sign * (1 - q) * 90}deg)`;
        a.style.filter = `brightness(${1 - q * 0.5})`;
        b.style.filter = `brightness(${0.5 + q * 0.5})`;
        break;
      }
      case "page-turn":
        a.style.zIndex = "3";
        a.style.transformOrigin = sign < 0 ? "0% 50%" : "100% 50%";
        a.style.transform = `perspective(1600px) rotateY(${-sign * q * 180}deg)`;
        a.style.backfaceVisibility = "hidden";
        a.style.filter = `brightness(${1 - blurPeak * 0.35})`;
        break;
      case "split": {
        const v = ((1 - q) * 50).toFixed(2);
        b.style.clipPath = axis === "X" ? `inset(0 ${v}% 0 ${v}%)` : `inset(${v}% 0 ${v}% 0)`;
        break;
      }
      case "clock": b.style.clipPath = q >= 1 ? "" : clockPoly(q, p.cx ?? 0.5, p.cy ?? 0.5); break;
      case "strips": {
        const n = p.slices || 6, pts = [];
        for (let i = 0; i < n; i++) {
          const qi = clamp(q * 1.6 - (i / n) * 0.6), y0 = i / n, y1 = (i + 1) / n;
          const x0 = i % 2 ? 1 - qi : 0, x1 = i % 2 ? 1 : qi;
          pts.push([x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]);
        }
        b.style.clipPath = pct(pts);
        break;
      }
      case "checker": {
        const n = p.slices || 6, pts = [];
        for (let i = 0; i < n * n; i++) {
          if (q < (noise(i, 13) + 1) / 2 * 0.85) continue;
          const x0 = (i % n) / n, y0 = Math.floor(i / n) / n, d = 1 / n;
          pts.push([x0, y0], [x0 + d, y0], [x0 + d, y0 + d], [x0, y0 + d], [x0, y0]);
        }
        b.style.clipPath = q >= 1 ? "" : pts.length ? pct(pts) : "inset(50% 50% 50% 50%)";
        break;
      }
      case "shape": {
        const sh = SHAPES[p.shape] || SHAPES.diamond, k = q * 2.2, cx = p.cx ?? 0.5, cy = p.cy ?? 0.5;
        b.style.clipPath = q >= 1 ? "" : pct(sh.map(([x, y]) => [cx + x * k * 0.5625, cy + y * k * 0.5]));
        break;
      }
      case "luma": {
        const g = (p.soft ?? 0.4) * 100, e = q * (100 + g), ang = { left: 270, right: 90, up: 0, down: 180 }[p.dir] ?? 270;
        b.style.maskImage = b.style.webkitMaskImage = q >= 1 ? "" : `linear-gradient(${ang}deg, #000 ${(e - g).toFixed(2)}%, transparent ${e.toFixed(2)}%)`;
        if (preset.color) { over.style.background = preset.color; over.style.opacity = String(blurPeak); }
        break;
      }
      case "ink": {
        const r = q * 140 - 15, m = `radial-gradient(circle at ${(p.cx ?? 0.5) * 100}% ${(p.cy ?? 0.5) * 100}%, #000 ${r}%, transparent ${r + 15}%)`;
        b.style.maskImage = b.style.webkitMaskImage = q >= 1 ? "" : m;
        break;
      }
      case "slide": b.style.transform = `translate${axis}(${-sign * (1 - q) * 100}%)`; break;
      case "uncover":
        a.style.zIndex = "3";
        a.style.transform = `translate${axis}(${sign * q * 100}%)`;
        break;
      case "stretch":
        a.style.transform = axis === "X" ? `scaleX(${1 + q * 3})` : `scaleY(${1 + q * 3})`;
        b.style.transform = axis === "X" ? `scaleX(${lerp(3, 1, q)})` : `scaleY(${lerp(3, 1, q)})`;
        a.style.filter = b.style.filter = `blur(${(blurPeak * 10).toFixed(1)}px)`;
        b.style.visibility = pre ? "hidden" : "visible";
        break;
      case "swirl":
        a.style.transform = `rotate(${sign * q * 360}deg) scale(${1 - q * 0.6})`;
        b.style.transform = `rotate(${-sign * (1 - q) * 360}deg) scale(${lerp(0.4, 1, q)})`;
        a.style.filter = b.style.filter = `blur(${(blurPeak * 16).toFixed(1)}px)`;
        b.style.visibility = pre ? "hidden" : "visible";
        break;
      case "blur-dissolve":
        b.style.opacity = String(q);
        a.style.filter = b.style.filter = `blur(${(blurPeak * (p.blur ?? 20)).toFixed(1)}px)`;
        break;
      case "light-sweep":
        over.style.background = `linear-gradient(${axis === "X" ? 100 : 190}deg, transparent ${q * 140 - 50}%, ${p.color === "#fff" ? "rgba(255,255,255,.95)" : p.color} ${q * 140 - 25}%, transparent ${q * 140}%)`;
        over.style.opacity = "1";
        over.style.mixBlendMode = "screen";
        b.style.opacity = String(clamp((q - 0.3) / 0.4));
        break;
      default: b.style.opacity = String(q);
    }
  };
}

/* ---------- effects on media.main ---------- */

const PARTICLE_GLYPH = { sparkle: "✦", hearts: "♥", stars: "★" };
const particleColors = (kind, cfg) => cfg.colors || (kind === "confetti" ? ["#ff3b6b", "#ffd400", "#2ee6a6", "#3b82f6", "#fff"] : [cfg.color || (kind === "embers" ? "#ffb347" : "#fff")]);
/* one particle node (glyph or dot) for particle i */
function particleNode(parent, kind, cfg, colors, i) {
  const glyph = PARTICLE_GLYPH[kind];
  const size = (cfg.size ?? (kind === "bokeh" ? 0.12 : kind === "rain" ? 0.04 : 0.012)) * (0.5 + (noise(i, 3) + 1) / 2);
  const d = el("div", { position: "absolute", left: "0", top: "0", color: colors[i % colors.length], fontSize: h(size * 2.2), lineHeight: "1" }, parent);
  if (glyph) d.textContent = glyph;
  else Object.assign(d.style, {
    width: kind === "rain" ? "0.12cqh" : kind === "confetti" ? h(size * 0.8) : h(size),
    height: kind === "rain" ? h(size) : h(size),
    borderRadius: kind === "confetti" || kind === "rain" ? "1px" : "50%",
    background: kind === "bokeh" ? `radial-gradient(circle, ${colors[i % colors.length]}88, ${colors[i % colors.length]}00 70%)` : colors[i % colors.length],
    boxShadow: kind === "embers" ? `0 0 1.2cqh ${colors[0]}` : "",
  });
  return d;
}
/* deterministic particle field: every particle's position is a function of t */
function particles(root, cfg) {
  const kind = cfg.kind || "snow", n = cfg.count ?? (kind === "rain" ? 70 : 40);
  const layer = el("div", { ...FILL, zIndex: "6", pointerEvents: "none", overflow: "hidden" }, root);
  const colors = particleColors(kind, cfg);
  const ps = [...Array(n)].map((_, i) => {
    const d = particleNode(layer, kind, cfg, colors, i);
    return { d, x: (noise(i, 1) + 1) / 2, y: (noise(i, 2) + 1) / 2, v: 0.5 + (noise(i, 4) + 1) / 2, ph: noise(i, 5) * 6 };
  });
  return (t) => {
    for (const P of ps) {
      let x = P.x, y = P.y, o = 1, r = 0;
      if (kind === "snow" || kind === "dust") { y = (P.y + t * 0.06 * P.v) % 1; x += Math.sin(t * 0.8 + P.ph) * 0.03; o = kind === "dust" ? 0.5 : 0.9; }
      else if (kind === "rain") { y = (P.y + t * 1.4 * P.v) % 1.1 - 0.05; x += y * 0.08; o = 0.55; }
      else if (kind === "confetti") { y = (P.y + t * 0.25 * P.v) % 1.1 - 0.05; x += Math.sin(t * 2 + P.ph) * 0.04; r = t * 300 * P.v + P.ph * 60; }
      else if (kind === "embers" || kind === "bubbles") { y = 1 - ((P.y + t * 0.12 * P.v) % 1.1); x += Math.sin(t * 1.5 + P.ph) * 0.03; o = 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + P.ph)); }
      else if (kind === "bokeh") { x += Math.sin(t * 0.3 + P.ph) * 0.04; y += Math.cos(t * 0.25 + P.ph) * 0.04; o = 0.35 + 0.35 * Math.sin(t + P.ph); }
      else { o = Math.max(0, Math.sin(t * 3 * P.v + P.ph)); r = t * 40; }
      P.d.style.transform = `translate(${(x * 100).toFixed(2)}cqw, ${(y * 100).toFixed(2)}cqh) rotate(${r.toFixed(1)}deg)`;
      P.d.style.opacity = o.toFixed(2);
    }
  };
}

/* [speed (frame heights/s), gravity (heights/s², negative rises), spin (deg/s), life (s)] per kind for particles shed by letters */
const EMIT = {
  snow: [0.04, 0.05, 0, 1.8], dust: [0.05, -0.01, 0, 1.4], sparkle: [0.12, 0, 90, 0.9], embers: [0.05, -0.1, 0, 1.4], confetti: [0.28, 0.5, 520, 1.5],
  hearts: [0.05, -0.08, 0, 1.5], stars: [0.2, 0, 220, 1], bubbles: [0.03, -0.1, 0, 1.7], bokeh: [0.04, 0, 0, 1.6], rain: [0, 1.2, 0, 0.8],
};
/* glyph boxes of a text layer as fractions of the root (so they hold at any size), measured with entrance transforms off */
function glyphBoxes(root, L, wrap, units) {
  const rr = root.getBoundingClientRect(), nodes = [wrap, ...units.filter((u) => u !== wrap)];
  const kept = nodes.map((n) => [n.style.transform, n.style.clipPath]);
  const ax = L.align === "left" ? "0%" : L.align === "right" ? "-100%" : "-50%";
  nodes.forEach((n) => { n.style.transform = n === wrap ? `translate(${ax}, -50%) rotate(${L.rotate || 0}deg)` : ""; n.style.clipPath = ""; });
  const out = [], range = document.createRange(), walk = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode()); ) {
    if (n.parentElement.hasAttribute("data-shine")) continue;
    const u = Math.max(0, units.findIndex((x) => x !== wrap && x.contains(n)));
    for (let c = 0; c < n.data.length; c++) {
      if (!n.data[c].trim()) continue;
      range.setStart(n, c);
      range.setEnd(n, c + 1);
      const r = range.getBoundingClientRect();
      out.push({ x: (r.left - rr.left) / rr.width, y: (r.top - rr.top) / rr.height, w: r.width / rr.width, h: r.height / rr.height, u });
    }
  }
  nodes.forEach((n, k) => { [n.style.transform, n.style.clipPath] = kept[k]; });
  return { glyphs: out, ar: rr.height / rr.width };
}
/* particles that burst from each letter's box on entrance (when "in"), exit ("out") or continuously ("loop") */
function letterParticles(root, L, wrap, units, z) {
  const cfg = L.emit, kind = cfg.kind || "sparkle", when = cfg.when || "out", colors = particleColors(kind, cfg);
  const [spd, grav, spin, life0] = EMIT[kind] || EMIT.sparkle, life = cfg.life ?? life0;
  const layer = el("div", { ...FILL, zIndex: String(z), pointerEvents: "none" }, root);
  const at = L.in?.at ?? 0, dur = L.in?.dur ?? 0.5, stg = L.in?.stagger ?? 0.04, outAt = L.out?.at, outDur = L.out?.dur ?? 0.3;
  const per = L.in?.split && L.in.split !== "none" ? 0 : 0.03;
  let geo = null, ps = [];
  return (t) => {
    if (fontsBusy) return;
    const key = `${fontEpoch}|${root.clientWidth}|${root.clientHeight}`;
    if (!geo || geo.key !== key) {
      geo = { ...glyphBoxes(root, L, wrap, units), key };
      layer.textContent = "";
      const n = Math.min(Math.round(cfg.count ?? 3), Math.max(1, Math.floor(600 / Math.max(1, geo.glyphs.length))));
      ps = geo.glyphs.flatMap((g, gi) => [...Array(n)].map((_, k) => ({ g, gi, id: gi * n + k, d: particleNode(layer, kind, cfg, colors, gi * n + k) })));
    }
    for (const { g, gi, id, d } of ps) {
      const r = (s) => (noise(id, s) + 1) / 2;
      let age = -1, cyc = 0;
      if (when === "loop") {
        if (t >= at) { age = t - at + r(21) * life; cyc = Math.floor(age / life); age -= cyc * life; }
      } else if (when === "in" || outAt != null) {
        const s0 = when === "in" ? at + ordered(g.u, units.length, L.in?.order) * stg + gi * per : outAt + ordered(g.u, units.length, L.out?.order) * stg * 0.5 + gi * per;
        age = t - (s0 + r(21) * (when === "in" ? dur : outDur));
      }
      if (age < 0 || age >= life) { d.style.opacity = "0"; continue; }
      const j = id + cyc * 97, ang = noise(j, 23) * Math.PI, sp = spd * (0.5 + r(24));
      const x = (g.x + g.w * (noise(j, 22) + 1) / 2) * 100 + Math.cos(ang) * sp * age * 100 * geo.ar;
      const y = (g.y + g.h * (noise(j, 25) + 1) / 2) * 100 + (Math.sin(ang) * sp * age + 0.5 * grav * age * age) * 100;
      const f = age / life;
      d.style.transform = `translate(${x.toFixed(2)}cqw, ${y.toFixed(2)}cqh) rotate(${(spin * age * (r(26) < 0.5 ? -1 : 1)).toFixed(1)}deg)`;
      d.style.opacity = (Math.min(1, age * 14) * (kind === "sparkle" ? Math.sin(f * Math.PI) : 1 - f)).toFixed(3);
    }
  };
}

let svgId = 0;
/* SVG filter for warps CSS can't do: directional blur, wave and heat distortion */
function svgFilter(root, type, amount) {
  const id = `fx24-${++svgId}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  Object.assign(svg.style, { position: "absolute", width: "0", height: "0" });
  svg.innerHTML = type === "dir-blur"
    ? `<filter id="${id}" x="-10%" width="120%"><feGaussianBlur stdDeviation="${amount ?? 14} 0"/></filter>`
    : `<filter id="${id}"><feTurbulence type="${type === "heat" ? "fractalNoise" : "turbulence"}" baseFrequency="${type === "heat" ? "0.02 0.09" : "0.006 0.02"}" numOctaves="2" seed="1"/><feDisplacementMap in="SourceGraphic" scale="${amount ?? (type === "heat" ? 5 : 14)}"/></filter>`;
  root.appendChild(svg);
  const turb = svg.querySelector("feTurbulence");
  return { css: `url(#${id})`, tick: (t) => turb && turb.setAttribute("seed", String(Math.floor(t * (type === "heat" ? 12 : 6)))) };
}

/* cloned copies of the cut-out beneath the real one: echoes, afterimages, "triple" looks. Video cut-outs are seeked per copy */
function echoes(root, fg, cfg) {
  const n = clamp(Math.round(cfg.count ?? 2), 1, 6), id = `fx24-${++svgId}`;
  if (cfg.tint) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    Object.assign(svg.style, { position: "absolute", width: "0", height: "0" });
    svg.innerHTML = `<filter id="${id}" color-interpolation-filters="sRGB"><feFlood flood-color="${cfg.tint}"/><feComposite in2="SourceAlpha" operator="in"/></filter>`;
    root.appendChild(svg);
  }
  const copies = [];
  let prev = fg;
  for (let i = 0; i < n; i++) {
    const c = fg.cloneNode(true);
    for (const e of [c, ...c.querySelectorAll("*")]) {
      e.removeAttribute("id");
      e.classList.remove("clip");
      [...e.attributes].filter((a) => a.name.startsWith("data-")).forEach((a) => e.removeAttribute(a.name));
    }
    const v = c.matches("video") ? c : c.querySelector("video");
    if (v) { v.removeAttribute("autoplay"); v.pause(); }
    Object.assign(c.style, { zIndex: "2", pointerEvents: "none", transformOrigin: `${(cfg.ox ?? 0.5) * 100}% ${(cfg.oy ?? 0.6) * 100}%`, mixBlendMode: cfg.blend || "", filter: cfg.tint ? `url(#${id})` : "" });
    c.dataset.echo = String(i);
    fg.parentNode.insertBefore(c, prev);
    copies.push({ c, v });
    prev = c;
  }
  return {
    render: (t) => copies.forEach(({ c, v }, i) => {
      const k = i + 1, sway = cfg.spread ? Math.sin(t * 2.2 + i * 0.9) * cfg.spread * k : 0;
      c.style.transform = `translate(${(((cfg.dx ?? 0.05) * k + sway) * 100).toFixed(3)}cqw, ${((cfg.dy ?? 0) * k * 100).toFixed(3)}cqh) scale(${(1 + (cfg.scale ?? 0) * k).toFixed(4)})`;
      c.style.opacity = ((cfg.opacity ?? 0.5) * (1 - i / n)).toFixed(3);
      if (v) {
        const d = v.duration || 0, s = t - (cfg.delay ?? 0) * k, to = d ? ((s % d) + d) % d : Math.max(0, s);
        if (Math.abs(v.currentTime - to) > 0.02) v.currentTime = to;
      }
    }),
    destroy: () => copies.forEach(({ c }) => c.remove()),
  };
}

/* one effect: sets its own overlays and returns what it adds to the footage transform (composed in effect()) */
function fxLayer(root, p, media) {
  const m = media.main;
  const over = el("div", { ...FILL, zIndex: "5", pointerEvents: "none" }, root);
  if (p.type === "grain" || p.grain) {
    over.style.backgroundImage = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`;
    over.style.mixBlendMode = "overlay";
  }
  const vig = el("div", { ...FILL, zIndex: "6", pointerEvents: "none", background: p.vignette ? `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${p.vignette}) 100%)` : "" }, root);
  const lines = p.type === "vhs" ? el("div", { ...FILL, zIndex: "7", pointerEvents: "none", background: "repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 2px, transparent 2px 4px)" }, root) : null;
  const bars = p.type === "letterbox" ? [el("div", { position: "absolute", left: 0, right: 0, top: 0, background: "#000", zIndex: "8" }, root), el("div", { position: "absolute", left: 0, right: 0, bottom: 0, background: "#000", zIndex: "8" }, root)] : null;
  if (p.type === "tilt-shift") ["top", "bottom"].filter((s) => !p.only || p.only === s).forEach((s) => {
    const m = `linear-gradient(to ${s === "top" ? "bottom" : "top"}, #000, transparent)`, b = `blur(${p.amount ?? 10}px)`;
    return el("div", { position: "absolute", left: 0, right: 0, [s]: 0, height: `${clamp((p.size ?? 0.35) + ((p.focus ?? 0.5) - 0.5) * (s === "top" ? 1 : -1)) * 100}%`, zIndex: "5", pointerEvents: "none", backdropFilter: b, webkitBackdropFilter: b, maskImage: m, webkitMaskImage: m }, root);
  });
  const grade = p.grade ? `contrast(${p.grade.contrast ?? 1}) saturate(${p.grade.saturate ?? 1}) brightness(${p.grade.brightness ?? 1}) sepia(${p.grade.sepia ?? 0}) hue-rotate(${p.grade.hue ?? 0}deg)${p.grade.grayscale ? ` grayscale(${p.grade.grayscale})` : ""}${p.grade.invert ? ` invert(${p.grade.invert})` : ""}` : "";
  const parts = p.particles || (p.type === "particles" ? { kind: p.kind, count: p.count, colors: p.colors, color: p.color, size: p.size } : null);
  const field = parts ? particles(root, parts) : null;
  const split = (p.type === "rgb-split" || p.type === "vhs") && typeof document !== "undefined" ? splitFilter(root) : null;
  const pix = p.type === "pixelate" && typeof document !== "undefined" ? pixelFilter(root) : null;
  const warp = ["dir-blur", "wave", "heat"].includes(p.type) && typeof document !== "undefined" ? svgFilter(root, p.type, p.amount) : null;
  const flare = p.type === "flare" ? el("div", { ...FILL, zIndex: "6", pointerEvents: "none", mixBlendMode: "screen" }, root) : null;
  const tint = p.grade?.tint ? el("div", { ...FILL, zIndex: "4", pointerEvents: "none", background: p.grade.tint, mixBlendMode: p.grade.tintBlend || "soft-light" }, root) : null;
  const beats = p.beats || [0.4, 1.6, 2.8, 4.0];
  const subj = p.subject && media.fg ? p.subject : null;
  const echo = p.echo && media.fg ? echoes(root, media.fg, p.echo) : null;
  const run = (t) => {
    if (echo) echo.render(t);
    if (subj) {
      const w = subj.width ?? 0.35, pulse = subj.pulse ? 0.6 + 0.4 * Math.sin(t * subj.pulse * Math.PI * 2) : 1;
      const line = subj.outline ? [[w, 0], [-w, 0], [0, w], [0, -w]].map(([a, b]) => `drop-shadow(${a}cqh ${b}cqh 0 ${subj.outline})`).join(" ") : "";
      const glow = subj.glow ? ` drop-shadow(0 0 ${((subj.blur ?? 1.2) * pulse).toFixed(2)}cqh ${subj.glow}) drop-shadow(0 0 ${((subj.blur ?? 1.2) * 2.5 * pulse).toFixed(2)}cqh ${subj.glow})` : "";
      media.fg.style.filter = (line + glow).trim();
    }
    let sc = 1, x = 0, y = 0, rot = 0, ry = 0, blur = 0, f = grade, flip = false, origin = null;
    switch (p.type) {
      case "punch-in": {
        const last = beats.filter((b) => b <= t).length;
        const target = 1 + (last % 2) * (p.amount ?? 0.18);
        const b = beats[last - 1] ?? 0;
        sc = lerp(last % 2 ? 1 : 1 + (p.amount ?? 0.18), target, prog(t, b, p.dur ?? 0.12, "expo"));
        break;
      }
      case "slow-zoom": sc = 1 + (p.amount ?? 0.12) * clamp(t / (p.over ?? 6)); break;
      case "ken-burns": sc = 1.08 + (p.amount ?? 0.1) * clamp(t / (p.over ?? 6)); x = lerp(-2, 2, clamp(t / (p.over ?? 6))); break;
      case "shake": { const a = p.amount ?? 1.2; x = smoothNoise(t * (p.speed ?? 14), 1) * a; y = smoothNoise(t * (p.speed ?? 14), 7) * a; rot = smoothNoise(t * 9, 3) * a * 0.4; sc = 1.06; break; }
      case "handheld": x = smoothNoise(t * 1.3, 1) * 0.8; y = smoothNoise(t * 1.1, 4) * 0.8; rot = smoothNoise(t * 0.9, 2) * 0.4; sc = 1.05; break;
      case "bounce-zoom": sc = 1 + Math.abs(Math.sin(t * Math.PI * (p.bpm ?? 120) / 60)) * (p.amount ?? 0.05); break;
      case "blur-in": blur = (1 - prog(t, 0, p.dur ?? 0.6)) * 16; break;
      case "rgb-split": { const a = (p.amount ?? 6) * (0.5 + 0.5 * Math.abs(Math.sin(t * 7))); if (split) { split.set(a); f += ` ${split.css}`; } sc = 1 + (2 * a) / (root.clientWidth || 1000); break; }
      case "flicker": f += ` brightness(${1 + noise(Math.floor(t * 24), 9) * (p.amount ?? 0.12)})`; break;
      case "vhs": f += " saturate(1.4) contrast(1.1)"; if (split) { split.set(p.amount ?? 3); f += ` ${split.css}`; } x = noise(Math.floor(t * 12), 2) * 0.3; break;
      case "mirror": flip = true; break;
      case "letterbox": { const v = (p.size ?? 0.12) * prog(t, 0, 0.6) * 100; bars[0].style.height = bars[1].style.height = `${v}%`; break; }
      case "speed-ramp": if (m.playbackRate !== undefined && m.tagName === "VIDEO") m.playbackRate = t % 3 < 1.2 ? 1 : 0.35; break;
      case "light-leak": over.style.background = `linear-gradient(${110 + t * 20}deg, transparent 20%, rgba(255,140,60,${0.35 + 0.25 * Math.sin(t * 1.7)}) 45%, rgba(255,60,120,.25) 60%, transparent 80%)`; over.style.mixBlendMode = "screen"; break;
      case "freeze-flash": { const fp = prog(t, p.at ?? 1.5, 0.25, "out"); over.style.background = "#fff"; over.style.opacity = String(t >= (p.at ?? 1.5) ? 1 - fp : 0); f += t >= (p.at ?? 1.5) ? " contrast(1.2) saturate(0.6)" : ""; break; }
      case "duotone": f += " grayscale(1) contrast(1.2)"; break;
      case "swing": origin = "50% 0%"; rot = Math.sin(t * (p.speed ?? 2)) * (p.amount ?? 5); sc = 1.12; break;
      case "sway": x = Math.sin(t * (p.speed ?? 1.5)) * (p.amount ?? 2); rot = Math.sin(t * (p.speed ?? 1.5) + 1) * 1.2; sc = 1.08; break;
      case "spin-loop": rot = t * (p.speed ?? 30); sc = 1.5; break;
      case "flip-3d": ry = Math.sin(t * (p.speed ?? 1.5)) * (p.amount ?? 25); sc = 1.1; break;
      case "zoom-hit": {
        const b = beats.filter((v) => v <= t).pop();
        const q = b == null ? 1 : prog(t, b, p.dur ?? 0.35, "out");
        sc = 1 + (1 - q) * (p.amount ?? 0.25);
        blur = (1 - q) * 6;
        break;
      }
      case "strobe": f += ` brightness(${Math.floor((t * (p.bpm ?? 120)) / 30) % 2 ? 1.7 : 1})`; break;
      case "invert-flash": if (beats.some((b) => t >= b && t < b + (p.dur ?? 0.08))) f += " invert(1)"; break;
      case "blur": blur = p.amount ?? 8; break;
      case "dir-blur": case "wave": case "heat": f += ` ${warp ? warp.css : ""}`; if (warp) warp.tick(t); sc = p.type === "dir-blur" ? 1.04 : 1.1; break;
      case "pixelate": {
        const a = p.from ?? p.size ?? 0.04, b = Math.round(lerp(a, p.to ?? p.size ?? 0.04, prog(t, p.at ?? 0, p.dur ?? 1.2, p.ease || "inOut")) * root.clientHeight);
        if (pix && b >= 2) { pix.set(b); f += ` ${pix.css}`; }
        break;
      }
      case "flare": {
        const fx = 0.2 + 0.6 * ((Math.sin(t * 0.6) + 1) / 2);
        flare.style.background = `radial-gradient(circle at ${fx * 100}% 30%, rgba(255,250,230,.85), rgba(255,200,120,.35) 8%, transparent 22%), linear-gradient(90deg, transparent, rgba(255,220,180,.25) ${fx * 100}%, transparent)`;
        break;
      }
    }
    if (field) field(t);
    if (lines) lines.style.backgroundPosition = `0 ${Math.floor(t * 60) % 4}px`;
    if (p.type === "grain" || p.grain) over.style.backgroundPosition = `${noise(Math.floor(t * 24), 1) * 100}px ${noise(Math.floor(t * 24), 2) * 100}px`;
    if (tint) tint.style.opacity = "1";
    void vig;
    return { sc, x, y, rot, ry, blur, f: f.trim(), flip, origin };
  };
  run.destroy = echo?.destroy;
  return run;
}

/* effects stack: the preset is the first layer, preset.stack adds more on the same footage.
   Scale multiplies, translate/rotate/blur add, filters concatenate, overlays all apply. */
/* channel split: red and green+blue copies of the frame pulled apart horizontally (a drop-shadow would hide behind an opaque frame) */
function splitFilter(root) {
  const id = `fx24-${++svgId}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  Object.assign(svg.style, { position: "absolute", width: "0", height: "0" });
  svg.innerHTML = `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/><feOffset result="r"/><feColorMatrix in="SourceGraphic" values="0 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/><feOffset result="gb"/><feComposite in="r" in2="gb" operator="arithmetic" k2="1" k3="1"/></filter>`;
  root.appendChild(svg);
  const [, r, , gb] = svg.querySelector("filter").children;
  return { css: `url(#${id})`, set: (a) => { r.setAttribute("dx", a.toFixed(2)); gb.setAttribute("dx", (-a).toFixed(2)); } };
}

/* mosaic: sample one pixel per block (flood + tile + mask), then grow each sample to fill its block */
function pixelFilter(root) {
  const id = `fx24-${++svgId}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  Object.assign(svg.style, { position: "absolute", width: "0", height: "0" });
  svg.innerHTML = `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feFlood/><feComposite/><feTile result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/><feMorphology operator="dilate"/></filter>`;
  root.appendChild(svg);
  const [flood, comp, , , morph] = svg.querySelector("filter").children;
  return {
    css: `url(#${id})`,
    set: (b) => { // odd block size: the dilate window then holds exactly one sample
      b |= 1;
      Object.entries({ x: (b - 1) / 2, y: (b - 1) / 2, width: 1, height: 1 }).forEach(([k, v]) => flood.setAttribute(k, v));
      comp.setAttribute("width", b);
      comp.setAttribute("height", b);
      morph.setAttribute("radius", (b - 1) / 2);
    },
  };
}

function effect(root, preset, media) {
  const { stack = [], ...top } = preset;
  const layers = [{ type: "punch-in", ...top }, ...stack.map((s) => ({ type: "grade", ...s }))].map((p) => fxLayer(root, p, media));
  const m = media.main, origin = `${(top.ox ?? 0.5) * 100}% ${(top.oy ?? 0.4) * 100}%`;
  const run = (t) => {
    const c = { sc: 1, x: 0, y: 0, rot: 0, ry: 0, blur: 0, f: [], flip: false, origin };
    for (const L of layers) {
      const l = L(t);
      c.sc *= l.sc; c.x += l.x; c.y += l.y; c.rot += l.rot; c.ry += l.ry; c.blur += l.blur;
      if (l.f) c.f.push(l.f);
      c.flip ||= l.flip;
      c.origin = l.origin || c.origin;
    }
    m.style.transformOrigin = c.origin;
    m.style.transform = `translate(${c.x}%, ${c.y}%) ${c.ry ? `perspective(1400px) rotateY(${c.ry}deg) ` : ""}rotate(${c.rot}deg) scale(${c.sc})${c.flip ? " scaleX(-1)" : ""}`;
    m.style.filter = `${c.f.join(" ")}${c.blur ? ` blur(${c.blur}px)` : ""}`.trim();
  };
  run.destroy = () => layers.forEach((L) => L.destroy?.());
  return run;
}

/* ---------- layouts: place media.main / media.second / media.fg ---------- */

function layout(root, preset, media) {
  const slots = preset.slots || {};
  const place = (m, s) => {
    if (!m || !s) { if (m) m.style.display = "none"; return; }
    Object.assign(m.style, { position: "absolute", left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%`, borderRadius: s.radius ? `${s.radius * 100}cqh` : "", overflow: "hidden", zIndex: String(s.z ?? 1), boxShadow: s.shadow ? "0 2cqh 6cqh rgba(0,0,0,.45)" : "", outline: s.border ? `${s.border.width ?? 0.4}cqh solid ${s.border.color ?? "#fff"}` : "", objectFit: s.fit || "cover", display: "block" });
    /* crop toward the face, not the centre: people sit in the upper third of most talking shots */
    const inner = m.matches("video,img") ? m : m.querySelector("video,img");
    if (inner) Object.assign(inner.style, { objectFit: s.fit || "cover", objectPosition: `${(s.focus?.x ?? 0.5) * 100}% ${(s.focus?.y ?? 0.25) * 100}%` });
  };
  if (preset.bg) root.style.background = preset.bg;
  const text = preset.layers ? textScene(root, { layers: preset.layers }, media) : null;
  return (t) => {
    const k = prog(t, 0, preset.inDur ?? 0.5, "out");
    for (const name of ["main", "second", "fg"]) {
      const s = slots[name];
      place(media[name], s);
      if (s && s.from && media[name]) {
        media[name].style.transform = `translate(${(1 - k) * (s.from.x ?? 0) * 100}%, ${(1 - k) * (s.from.y ?? 0) * 100}%) scale(${lerp(s.from.scale ?? 1, 1, k)})`;
      }
    }
    if (text) text(t);
  };
}

/* ---------- mount ---------- */

const KINDS = { captions, text: textScene, transition, effect, layout };

/**
 * @param {HTMLElement} root  positioned overlay box (gets container-type: size)
 * @param {{kind: "captions"|"text"|"transition"|"effect"|"layout", preset: object, script?: any, media?: Record<string, HTMLElement>}} opts
 */
export function mount(root, { kind, preset, script, media = {} }) {
  Object.assign(root.style, { containerType: "size", overflow: "hidden" });
  if (getComputedStyle(root).position === "static") root.style.position = "relative";
  const make = KINDS[kind];
  if (!make) throw new Error(`24fps editor: unknown kind "${kind}"`);
  const before = new Set(root.children);
  /* captions sit in their own top layer; text scenes share the root so "behind-subject" layers can slot under media.fg */
  const host = kind === "captions" ? el("div", { ...FILL, pointerEvents: "none", zIndex: "6" }, root) : root;
  const render = make(host, preset, kind === "captions" ? script : media);
  return {
    ready: fontsPending,
    render: (t) => render(Math.max(0, t)),
    destroy: () => {
      render.destroy?.();
      [...root.children].forEach((n) => before.has(n) || n.remove());
    },
  };
}
