/* ==========================================================================
   Phorma UI — esteso
   - Nuove forme: triangle, hexagon, custom SVG path
   - Multi-line con auto-fit
   - Animazioni: jitter time-based, morph super-ellisse
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const byId = (id) => document.getElementById(id);

/* ---------- Tabs ---------- */
function initSidebarTabs() {
  const tabs = $$(".tabbar .tab");
  const panels = $$("#sidebar .panel");
  const activate = (id) => {
    tabs.forEach((t) => {
      const on = t.dataset.tabTarget === id;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach((p) => p.toggleAttribute("hidden", p.dataset.tab !== id));
  };
  tabs.forEach((t) =>
    t.addEventListener("click", () => activate(t.dataset.tabTarget))
  );
  activate("content");
}

/* ---------- Panel toggle ---------- */
function initPanelToggles() {
  $$("#sidebar .panel").forEach((panel) => {
    const header = $("h2", panel);
    if (!header) return;
    const set = (collapsed) => panel.classList.toggle("collapsed", collapsed);
    header.addEventListener("click", () =>
      set(!panel.classList.contains("collapsed"))
    );
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        set(!panel.classList.contains("collapsed"));
      }
    });
  });
}

/* ---------- Range dblclick reset ---------- */
function initRangeDoubleClickReset() {
  $$("#sidebar input[type=range]").forEach((r) => {
    r.dataset.defaultValue = r.getAttribute("value") ?? r.value;
    r.addEventListener("dblclick", () => {
      r.value = r.dataset.defaultValue;
      r.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}

/* ---------- Topbar mirror ---------- */
function initMirroredActions() {
  byId("btnRandom").addEventListener("click", () =>
    byId("actionRandom").click()
  );
  byId("btnPng").addEventListener("click", () => byId("actionPng").click());
  byId("btnSvg").addEventListener("click", () => byId("actionSvg").click());
}

/* ---------- UI state ---------- */
const ui = {};
const ids = [
  "word",
  "font",
  "cell",
  "dot",
  "th",
  "mode",
  "shape",
  "outline",
  "fg",
  "bg",
  "margin",
  "jitter",
  "variance",
  "anim",
  "speed",
  "morphTarget",
  "customPath",
];
function hookUI() {
  ids.forEach((id) => (ui[id] = byId(id)));
  ids.forEach((id) => ui[id]?.addEventListener("input", handleUIChange));

  // show/hide custom path & morph row
  const toggleCustom = () =>
    (byId("customRow").hidden = ui.shape.value !== "custom");
  const toggleMorph = () =>
    (byId("morphRow").hidden = ui.anim.value !== "morph");
  ui.shape.addEventListener("change", () => {
    toggleCustom();
    regenerate();
  });
  ui.anim.addEventListener("change", () => {
    toggleMorph();
    applyAnimMode();
  });

  byId("actionRandom").addEventListener("click", randomize);
  byId("actionPng").addEventListener(
    "click",
    () => p5Instance && p5Instance.saveCanvas("dot-type", "png")
  );
  byId("actionSvg").addEventListener("click", exportSVG);

  byId("btnPlay").addEventListener("click", () => {
    animPlaying = true;
    applyAnimMode(true);
  });
  byId("btnPause").addEventListener("click", () => {
    animPlaying = false;
    applyAnimMode(false);
  });

  ["fg", "bg"].forEach((id) => byId(id).addEventListener("change", regenerate));

  toggleCustom();
  toggleMorph();
}

function handleUIChange() {
  // alcuni controlli impattano solo in draw (anim) → forziamo redraw
  if (ui.anim.value !== "off") p5Instance?.loop();
  regenerate();
}

/* ---------- p5 / canvas ---------- */
let basePoints = []; // punti base (senza jitter dinamico)
let positions = []; // punti (con jitter statico in modalità C)
let offscreen;
let W = 960,
  H = 720;
let p5Instance = null;
let animPlaying = false;
let t0 = performance.now();

function computeCanvas34() {
  let cw = Math.min(window.innerWidth - 40, 1200);
  let ch = (cw * 3) / 4;
  if (ch > window.innerHeight - 180) {
    ch = Math.max(420, window.innerHeight - 180);
    cw = (ch * 4) / 3;
  }
  return { cw: Math.floor(cw), ch: Math.floor(ch) };
}

function createSketch(p) {
  p.setup = function () {
    const { cw, ch } = computeCanvas34();
    W = cw;
    H = ch;
    const c = p.createCanvas(W, H);
    c.parent(byId("canvasMount"));
    p.pixelDensity(1);
    offscreen = p.createGraphics(W, H);
    hookUI();
    regenerate();
    applyAnimMode();
  };
  p.windowResized = function () {
    const { cw, ch } = computeCanvas34();
    W = cw;
    H = ch;
    p.resizeCanvas(W, H);
    offscreen = p.createGraphics(W, H);
    regenerate();
  };
  p.draw = function () {
    const ctx = p.drawingContext;
    const now = performance.now();
    const dt = (now - t0) / 1000;
    const speed = +ui.speed.value || 1;

    if (ui.anim.value === "off" || !animPlaying) p.noLoop();
    else p.loop();

    p.background(ui.bg.value || "#ffffff");

    const col = ui.fg.value || "#111111";
    const cell = +ui.cell.value;
    const dotPct = +ui.dot.value / 100;
    const outline = ui.outline.value;
    const baseSize = cell * dotPct;

    // parametri anim
    const mode = ui.mode.value;
    const baseJitter = mode === "C" ? +ui.jitter.value : 0;
    const baseVar = mode === "C" ? +ui.variance.value : 0;

    const animType = ui.anim.value;
    const animT = Math.sin(now * 0.001 * speed) * 0.5 + 0.5; // 0..1

    p.push();
    p.noStroke();
    p.fill(col);

    const pts = mode === "C" ? positions : basePoints; // in Clean/Sharp niente jitter statico
    pts.forEach((pt) => {
      // size variance (static); in anim morph la usiamo uguale
      const s0 = Math.max(1, baseSize * (pt.v || 1));
      let x = pt.x,
        y = pt.y,
        size = s0;

      // jitter dinamico
      if (animType === "jitter") {
        const jScale = cell * (baseJitter || 0.12); // se Clean/Sharp, un po' di jitter lo permette l'anim stessa
        const phase = pt.seed;
        x += Math.sin(phase + now * 0.0015 * speed) * jScale;
        y += Math.cos(phase * 1.3 + now * 0.0012 * speed) * jScale;
      }

      if (outline !== "none") {
        p.stroke(0, 40);
        p.strokeWeight(outline === "bold" ? 2.2 : 1.2);
      } else p.noStroke();

      // morph: super-ellisse tra diamond (n≈1), circle (n=2), square (n→∞)
      const shape = ui.shape.value;
      if (animType === "morph") {
        const target = ui.morphTarget.value; // diamond/circle/square
        const nFrom = shapeToSuperellipseN(shape);
        const nTo = shapeToSuperellipseN(target);
        const n = lerp(nFrom, nTo, animT);
        drawSuperellipse(p, x, y, size, n, col);
      } else {
        drawShape(p, x, y, size, shape, col, ctx);
      }
    });
    p.pop();
  };
}

function shapeToSuperellipseN(shape) {
  if (shape === "diamond") return 1.0; // rombo
  if (shape === "circle") return 2.0; // cerchio
  if (shape === "square") return 30.0; // “quasi” quadrato
  // fallback per altre forme: usa cerchio
  return 2.0;
}

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/* ---------- Disegno forme ---------- */
function drawShape(p, cx, cy, size, shape, col, ctx) {
  switch (shape) {
    case "circle":
      p.fill(col);
      p.circle(cx, cy, size);
      break;
    case "square":
      p.rectMode(p.CENTER);
      p.rect(cx, cy, size, size, 0);
      break;
    case "diamond":
      p.push();
      p.translate(cx, cy);
      p.rotate(Math.PI / 4);
      p.rectMode(p.CENTER);
      p.rect(0, 0, size, size, 0);
      p.pop();
      break;
    case "triangle": {
      const r = size / 2;
      p.push();
      p.translate(cx, cy);
      p.beginShape();
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + i * ((2 * Math.PI) / 3);
        p.vertex(Math.cos(a) * r, Math.sin(a) * r);
      }
      p.endShape(p.CLOSE);
      p.pop();
      break;
    }
    case "hexagon": {
      const r = size / 2;
      p.push();
      p.translate(cx, cy);
      p.beginShape();
      for (let i = 0; i < 6; i++) {
        const a = i * ((2 * Math.PI) / 6);
        p.vertex(Math.cos(a) * r, Math.sin(a) * r);
      }
      p.endShape(p.CLOSE);
      p.pop();
      break;
    }
    case "custom": {
      const pathStr = (ui.customPath.value || "").trim();
      if (!pathStr) return;
      const path = new Path2D(pathStr);
      const ctx2 = p.drawingContext;
      ctx2.save();
      ctx2.translate(cx, cy);
      // il path è definito nel box -0.5..0.5 → scala a “size”
      ctx2.scale(size, size);
      ctx2.fillStyle = col;
      ctx2.fill(path);
      ctx2.restore();
      break;
    }
  }
}

// super-ellisse (|x|^n + |y|^n = 1) campionata come poligono
function drawSuperellipse(p, cx, cy, size, n, col) {
  const r = size / 2;
  const k = 64; // punti
  p.push();
  p.translate(cx, cy);
  p.beginShape();
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2;
    const ca = Math.cos(a),
      sa = Math.sin(a);
    const x = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / n) * r;
    const y = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / n) * r;
    p.vertex(x, y);
  }
  p.endShape(p.CLOSE);
  p.pop();
}

/* ---------- Generazione punti ---------- */
function regenerate() {
  if (!offscreen) return;

  const text = (ui.word.value || "PHORMA").toString();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const margin = +ui.margin.value;

  // 1) rasterizza testo multiline
  offscreen.clear();
  offscreen.pixelDensity(1);
  offscreen.background(0, 0);
  const ctx = offscreen.drawingContext;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.font = ui.font.value;

  const px = parseInt(/(\d+)px/.exec(ui.font.value)?.[1] || 280, 10);
  const lineHeightFac = parseFloat(
    /\/\s*([0-9.]+)/.exec(ui.font.value)?.[1] || "1"
  );
  const lineH = px * lineHeightFac;

  // misura multiline
  const widths = lines.map((l) => ctx.measureText(l).width);
  const textW = Math.max(...widths, 1);
  const textH = Math.max(lines.length * lineH, 1);

  const maxW = W - margin * 2;
  const maxH = H - margin * 2;
  const scaleFit = Math.min(maxW / textW, maxH / textH);

  ctx.translate(W / 2, (H - textH * scaleFit) / 2); // top centrato
  ctx.scale(scaleFit, scaleFit);
  ctx.fillStyle = "#fff";
  lines.forEach((l, i) => {
    const y = (i + 1) * lineH; // baseline per riga
    ctx.fillText(l, 0, y);
  });
  ctx.restore();

  // 2) campiona griglia
  basePoints.length = 0;
  positions.length = 0;
  offscreen.loadPixels();
  const cell = +ui.cell.value;
  let th = +ui.th.value;
  const mode = ui.mode.value;
  // Modalità B “Sharp” → alza la soglia (più selettivo)
  if (mode === "B") th = Math.min(255, th + 30);

  for (let y = 0; y < H; y += cell) {
    for (let x = 0; x < W; x += cell) {
      const cx = Math.floor(x + cell / 2);
      const cy = Math.floor(y + cell / 2);
      const idx = 4 * (cy * W + cx);
      const r = offscreen.pixels[idx];
      const g = offscreen.pixels[idx + 1];
      const b = offscreen.pixels[idx + 2];
      const lum = (r + g + b) / 3;
      if (lum > th) {
        const seed = ((cx * 131 + cy * 173) % 10000) / 1000; // seed stabile
        const v =
          1 + (Math.random() * 2 - 1) * (mode === "C" ? +ui.variance.value : 0);
        const jx =
          (Math.random() * 2 - 1) *
          cell *
          (mode === "C" ? +ui.jitter.value : 0);
        const jy =
          (Math.random() * 2 - 1) *
          cell *
          (mode === "C" ? +ui.jitter.value : 0);
        basePoints.push({ x: x + cell / 2, y: y + cell / 2, v, seed });
        positions.push({ x: x + cell / 2 + jx, y: y + cell / 2 + jy, v, seed });
      }
    }
  }

  byId("hint").textContent = `Cells: ${Math.ceil(W / cell)}×${Math.ceil(
    H / cell
  )} — Points: ${positions.length} — Mode: ${mode}`;

  p5Instance && p5Instance.redraw();
}

function randomize() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  ui.cell.value = String(Math.floor(8 + Math.random() * 28));
  ui.dot.value = String(Math.floor(55 + Math.random() * 40));
  ui.th.value = String(Math.floor(90 + Math.random() * 90));
  ui.margin.value = String(Math.floor(Math.random() * 60));
  ui.shape.value = pick(["circle", "square", "diamond", "triangle", "hexagon"]);
  ui.outline.value = pick(["none", "thin", "bold"]);
  ["jitter", "variance"].forEach(
    (id) => (ui[id].value = (Math.random() * 0.4 + 0.05).toFixed(2))
  );
  regenerate();
}

/* ---------- SVG export ---------- */
function exportSVG() {
  const cell = +ui.cell.value;
  const dotPct = +ui.dot.value / 100;
  const outline = ui.outline.value;
  const col = ui.fg.value || "#111111";
  const bg = ui.bg.value || "#ffffff";
  const baseSize = cell * dotPct;
  const toFixed = (n) => Number(n.toFixed(3));
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  let svg = "";
  svg += `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="geometricPrecision">\n`;
  svg += `  <rect x="0" y="0" width="${W}" height="${H}" fill="${esc(bg)}"/>\n`;
  svg += `  <g fill="${esc(col)}">\n`;

  const shape = ui.shape.value;
  const customPath = ui.customPath.value?.trim();

  (positions.length ? positions : basePoints).forEach((p) => {
    const s = Math.max(1, baseSize * (p.v || 1));
    const half = s / 2;
    const x = toFixed(p.x),
      y = toFixed(p.y);
    const strokeAttr =
      outline === "none"
        ? ""
        : ` stroke="rgba(0,0,0,0.16)" stroke-width="${
            outline === "bold" ? 2.2 : 1.2
          }"`;

    if (shape === "circle") {
      svg += `    <circle cx="${x}" cy="${y}" r="${toFixed(
        half
      )}"${strokeAttr}/>\n`;
    } else if (shape === "square") {
      svg += `    <rect x="${toFixed(x - half)}" y="${toFixed(
        y - half
      )}" width="${toFixed(s)}" height="${toFixed(s)}"${strokeAttr}/>\n`;
    } else if (shape === "diamond") {
      svg += `    <g transform="translate(${x},${y}) rotate(45)">\n`;
      svg += `      <rect x="${toFixed(-half)}" y="${toFixed(
        -half
      )}" width="${toFixed(s)}" height="${toFixed(s)}"${strokeAttr}/>\n`;
      svg += `    </g>\n`;
    } else if (shape === "triangle") {
      const r = half;
      const p0 = `${toFixed(x)} ${toFixed(y - r)}`;
      const p1 = `${toFixed(x - r * Math.cos(Math.PI / 6))} ${toFixed(
        y + r * Math.sin(Math.PI / 6)
      )}`;
      const p2 = `${toFixed(x + r * Math.cos(Math.PI / 6))} ${toFixed(
        y + r * Math.sin(Math.PI / 6)
      )}`;
      svg += `    <polygon points="${p0} ${p1} ${p2}"${strokeAttr}/>\n`;
    } else if (shape === "hexagon") {
      const r = half;
      let pts = [];
      for (let i = 0; i < 6; i++) {
        const a = i * ((2 * Math.PI) / 6);
        pts.push(
          `${toFixed(x + Math.cos(a) * r)} ${toFixed(y + Math.sin(a) * r)}`
        );
      }
      svg += `    <polygon points="${pts.join(" ")}"${strokeAttr}/>\n`;
    } else if (shape === "custom" && customPath) {
      // scala il path definito su -0.5..0.5 al size del dot
      svg += `    <g transform="translate(${x},${y}) scale(${toFixed(s)})">\n`;
      svg += `      <path d="${esc(customPath)}"${strokeAttr}/>\n`;
      svg += `    </g>\n`;
    }
  });

  svg += `  </g>\n</svg>\n`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "dot-type.svg";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Anim engine ---------- */
function applyAnimMode(forcePlay = false) {
  const animType = ui.anim.value;
  if (animType === "off" || (!animPlaying && !forcePlay)) {
    p5Instance?.noLoop();
  } else {
    p5Instance?.loop();
  }
}

/* ---------- Bootstrap ---------- */
let resizeObserver;
document.addEventListener("DOMContentLoaded", () => {
  initSidebarTabs();
  initPanelToggles();
  initRangeDoubleClickReset();
  initMirroredActions();
  p5Instance = new p5(createSketch);

  resizeObserver = new ResizeObserver(() => p5Instance && regenerate());
  resizeObserver.observe(byId("canvasWrap"));
});
