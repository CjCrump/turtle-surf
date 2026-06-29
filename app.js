/* ==========================================================
   Turtle Surf — Chance IT Studio
   One-button ocean flapper. Flap = swim up; gravity sinks you.
   Glide the turtle through gaps in the reef (coral above, kelp below).
   Score = reefs cleared. Vanilla canvas, no deps.

   Screens (body[data-screen]): menu owns difficulty + per-tier best;
   play is a full-bleed field under the minimal strip. Game-over shows a
   run summary with Play again / Main menu. Same shell as the hub games.
   ========================================================== */

/* ---- DOM ---- */
const stage   = document.getElementById("stage");
const canvas  = document.getElementById("game");
const ctx     = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const scoreEl = document.getElementById("score");
const bestEl  = document.getElementById("best");

const diffNote  = document.getElementById("diffNote");
const bestMode  = document.getElementById("bestMode");
const bestValue = document.getElementById("bestValue");
const startBtn  = document.getElementById("startBtn");
const muteBtn   = document.getElementById("muteBtn");
const diffRadios = [...document.querySelectorAll('input[name="diff"]')];

/* ---- palette (matches styles.css tokens) ---- */
const C = {
  surf:"#1fe3a6", emerald:"#0c8f68", deep:"#063140",
  coral:"#ff7a52", gold:"#ffcf3a", foam:"#e6fff6",
  kelpA:"#0a4a3a", kelpB:"#052a30", kelpC:"#063140",
};

/* ---- difficulty tiers ---- */
const TIERS = {
  calm:    { label:"Calm",    gapFrac:0.36, speed:205, spacing:360, note:"Wide gaps, gentle current." },
  reef:    { label:"Reef",    gapFrac:0.28, speed:280, spacing:325, note:"Tighter gaps, brisker current." },
  riptide: { label:"Riptide", gapFrac:0.22, speed:350, spacing:295, note:"Narrow gaps, fast water." },
};
const bestKey = (tier) => `turtlesurf_best_${tier}_v1`;
const LS_SETTINGS = "turtlesurf_settings_v1";

/* ---- physics (px/s, scaled by S) ---- */
const GRAV = 2100;     // gravity accel
const FLAP = 560;      // upward impulse (set as velocity)
const VMAX = 900;      // terminal velocity

/* ---- state ---- */
let viewW = 0, viewH = 0, S = 1;
let turtleX = 0, turtleR = 22;
let y = 0, vy = 0, ang = 0;
let columns = [];
let score = 0, best = 0;
let cfg = TIERS.calm, tier = "calm", gap = 0;
let state = "menu";                // menu | ready | running | over
let bubbles = [], particles = [], flash = 0;
let lastTs = 0, t0;
let muted = false;

/* ---- helpers ---- */
const rand = (a, b) => a + Math.random() * (b - a);
const circle = (x, cy, r) => { ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill(); };
function roundRect(x, ry, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, ry); ctx.arcTo(x + w, ry, x + w, ry + h, r);
  ctx.arcTo(x + w, ry + h, x, ry + h, r); ctx.arcTo(x, ry + h, x, ry, r);
  ctx.arcTo(x, ry, x + w, ry, r); ctx.closePath();
}

/* ---- sound (synth, no assets) ---- */
let actx = null;
function ensureAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; } }
  if (actx && actx.state === "suspended") actx.resume();
}
function tone({ freq, dur = 0.08, type = "sine", gain = 0.16, slideTo = null }) {
  if (muted || !actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), a = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  a.gain.setValueAtTime(0.0001, t);
  a.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(a).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  flap:  () => tone({ freq: 420, slideTo: 600, dur: 0.09, type: "sine",     gain: 0.12 }),
  score: () => tone({ freq: 880, slideTo: 1240, dur: 0.10, type: "triangle", gain: 0.15 }),
  hit:   () => tone({ freq: 240, slideTo: 70,  dur: 0.45, type: "sawtooth", gain: 0.16 }),
  best:  () => [660, 990, 1320].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.13, type: "triangle", gain: 0.15 }), i * 110)),
};

/* ---- settings + best ---- */
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}");
    muted = !!s.muted;
    if (s.diff && TIERS[s.diff]) {
      const r = diffRadios.find((x) => x.value === s.diff);
      if (r) r.checked = true;
    }
  } catch {}
}
function saveSettings() {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify({ diff: selectedTier(), muted })); } catch {}
}
function selectedTier() { return (diffRadios.find((r) => r.checked) || diffRadios[0]).value; }
function loadBest(t) { return Number(localStorage.getItem(bestKey(t)) || 0); }
function saveBest(t, v) { try { localStorage.setItem(bestKey(t), String(v)); } catch {} }

function refreshMenuBest() {
  const t = selectedTier(), b = loadBest(t);
  bestMode.textContent = TIERS[t].label;
  bestValue.innerHTML = b > 0 ? `${b} reef${b === 1 ? "" : "s"}` : `<span class="dim">no run yet</span>`;
  diffNote.textContent = TIERS[t].note;
}

/* ---- layout ---- */
function computeLayout() {
  viewW = stage.clientWidth; viewH = stage.clientHeight;
  if (!viewW || !viewH) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S = viewH / 720;
  turtleX = viewW * 0.30;
  turtleR = 22 * S;
  gap = viewH * cfg.gapFrac;
}

/* ---- columns ---- */
function spawnColumn(x) {
  const margin = gap / 2 + 40 * S;
  const gapY = rand(margin, viewH - margin);
  columns.push({ x, gapY, scored: false });
}
function maybeSpawn() {
  const last = columns[columns.length - 1];
  if (!last || last.x <= viewW - cfg.spacing * S) spawnColumn(viewW + (last ? 0 : 0));
}

/* ---- bubbles (decor) ---- */
function seedBubbles() {
  bubbles = [];
  for (let i = 0; i < 26; i++)
    bubbles.push({ x: rand(0, viewW), y: rand(0, viewH), r: rand(1, 3.5) * S, v: rand(18, 46) * S, a: rand(0.04, 0.16) });
}
function burst(x, cy, color, n) {
  for (let i = 0; i < n; i++) {
    const an = Math.random() * Math.PI * 2, sp = rand(40, 200) * S;
    particles.push({ x, y: cy, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life: 1, color, r: rand(2, 4) * S });
  }
}

/* ---- flow ---- */
function enterPlay() {
  ensureAudio();
  tier = selectedTier(); cfg = TIERS[tier];
  best = loadBest(tier);
  setScreen("play");
  computeLayout();
  seedBubbles();
  resetReady();
}
function setScreen(s) { document.body.dataset.screen = s; }

function resetReady() {
  columns = []; particles = []; flash = 0;
  score = 0; vy = 0; ang = 0;
  y = viewH / 2;
  scoreEl.textContent = "0";
  bestEl.textContent = String(best);
  state = "ready";
  showReady();
}
function startRun() {
  columns = []; particles = []; flash = 0;
  score = 0; scoreEl.textContent = "0";
  y = viewH / 2; vy = -FLAP * S; ang = -0.5;
  spawnColumn(viewW + 60 * S);
  hideOverlay();
  state = "running";
  lastTs = performance.now();
  sfx.flap();
}
function flap() {
  if (state === "ready") { startRun(); return; }
  if (state !== "running") return;
  vy = -FLAP * S;
  sfx.flap();
  burst(turtleX - 14 * S, y + 8 * S, "rgba(230,255,246,0.7)", 5);
}
function gameOver() {
  state = "over";
  sfx.hit();
  burst(turtleX, y, C.coral, 26);
  flash = 0.6;
  const newBest = score > best;
  if (newBest) { best = score; saveBest(tier, best); sfx.best(); }
  bestEl.textContent = String(best);
  window.HubBridge?.score({ mode: tier, points: score });
  window.HubBridge?.event("run_finished", { mode: tier });
  showOver(newBest);
}
function goMenu() {
  state = "menu";
  hideOverlay();
  setScreen("menu");
  refreshMenuBest();
}

/* ---- overlays ---- */
function showReady() {
  overlay.className = "overlay is-ready";
  overlay.style.display = "grid";
  overlay.innerHTML = `<div class="overlay__card">
    <div class="overlay__eyebrow">${cfg.label} water</div>
    <p class="overlay__hint">Tap, click, or <kbd>Space</kbd> to swim up</p>
  </div>`;
}
function showOver(newBest) {
  overlay.className = "overlay";
  overlay.style.display = "grid";
  overlay.innerHTML = `<div class="overlay__card">
    <h1 class="overlay__title ${newBest ? "is-best" : "is-over"}">${newBest ? "New best!" : "Wiped out"}</h1>
    <div class="results">
      <div class="results__cell"><div class="results__k">Reefs cleared</div><div class="results__v">${score}</div></div>
      <div class="results__cell"><div class="results__k">Best · ${cfg.label}</div><div class="results__v">${best}</div></div>
    </div>
    <div class="overlay__actions">
      <button class="btn btn--primary" data-action="again">Play again</button>
      <button class="btn btn--ghost" data-action="menu">Main menu</button>
    </div>
    <p class="overlay__hint"><kbd>Space</kbd> again · <kbd>Esc</kbd> menu</p>
  </div>`;
}
function hideOverlay() { overlay.style.display = "none"; }

/* ---- update ---- */
function update(dt) {
  // decor bubbles always drift
  for (const b of bubbles) {
    b.y -= b.v * dt;
    if (b.y < -b.r) { b.y = viewH + b.r; b.x = rand(0, viewW); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt / 0.6; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += GRAV * 0.25 * S * dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  if (flash > 0) flash = Math.max(0, flash - dt / 0.5);

  if (state === "ready") { y = viewH / 2 + Math.sin(performance.now() / 420) * 10 * S; ang = Math.sin(performance.now() / 420) * 0.12; return; }
  if (state !== "running") return;

  vy = Math.min(VMAX * S, vy + GRAV * S * dt);
  y += vy * dt;
  ang = Math.max(-0.6, Math.min(1.25, vy / (1000 * S) * 1.2));

  // ceiling clamp, floor death
  if (y < turtleR) { y = turtleR; vy = 0; }
  if (y + turtleR > viewH) { y = viewH - turtleR; gameOver(); return; }

  const v = cfg.speed * S * dt;
  for (const col of columns) col.x -= v;
  maybeSpawn();
  while (columns.length && columns[0].x + 70 * S < 0) columns.shift();

  for (const col of columns) {
    if (!col.scored && col.x + 70 * S < turtleX) { col.scored = true; score++; scoreEl.textContent = String(score); if (score > best) bestEl.textContent = String(score); sfx.score(); }
    if (hitsColumn(col)) { gameOver(); return; }
  }
}
function hitsColumn(col) {
  const w = 70 * S, top = col.gapY - gap / 2, bot = col.gapY + gap / 2;
  return circleRect(turtleX, y, turtleR, col.x, 0, w, top) ||
         circleRect(turtleX, y, turtleR, col.x, bot, w, viewH - bot);
}
function circleRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

/* ==========================================================
   Render
   ========================================================== */
function render(now) {
  const t = (now - t0) / 1000;
  drawBG(t);
  for (const col of columns) drawColumn(col);
  drawBubbles();
  drawParticles();
  drawTurtle(turtleX, y, ang, t);
  if (flash > 0) { ctx.fillStyle = `rgba(255,122,82,${flash * 0.4})`; ctx.fillRect(0, 0, viewW, viewH); }
}
function drawBG(t) {
  const g = ctx.createLinearGradient(0, 0, 0, viewH);
  g.addColorStop(0, "#073246"); g.addColorStop(0.5, "#04161f"); g.addColorStop(1, "#02090d");
  ctx.fillStyle = g; ctx.fillRect(0, 0, viewW, viewH);
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4; i++) {
    const x = ((t * 16 + i * 240) % (viewW + 460)) - 230;
    ctx.fillStyle = "rgba(31,227,166,0.035)";
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 64, 0); ctx.lineTo(x + 210, viewH); ctx.lineTo(x + 120, viewH); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function drawBubbles() {
  for (const b of bubbles) { ctx.fillStyle = `rgba(31,227,166,${b.a})`; circle(b.x, b.y, b.r); }
}
function drawParticles() {
  for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color; circle(p.x, p.y, p.r); }
  ctx.globalAlpha = 1;
}
function drawColumn(col) {
  const w = 70 * S, top = col.gapY - gap / 2, bot = col.gapY + gap / 2;
  colBody(col.x, 0, w, top, true);
  colBody(col.x, bot, w, viewH - bot, false);
}
function colBody(x, ry, w, h, isTop) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, C.kelpB); g.addColorStop(0.5, C.kelpA); g.addColorStop(1, C.kelpC);
  roundRect(x, ry, w, h, 7 * S); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = "rgba(31,227,166,0.06)"; ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + (w * i) / 3, ry); ctx.lineTo(x + (w * i) / 3, ry + h); ctx.stroke(); }
  const edgeY = isTop ? ry + h : ry;
  ctx.save(); ctx.shadowColor = C.surf; ctx.shadowBlur = 16; ctx.fillStyle = C.coral;
  roundRect(x - 2 * S, isTop ? edgeY - 11 * S : edgeY - 1 * S, w + 4 * S, 12 * S, 6 * S); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = C.surf; ctx.lineWidth = 2 * S; ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.moveTo(x, edgeY); ctx.lineTo(x + w, edgeY); ctx.stroke(); ctx.globalAlpha = 1;
}
function paddle(fx, fy, len, wid, rot, color) {
  // long tapered sea-turtle flipper, drawn along +x from its root
  ctx.save(); ctx.translate(fx, fy); ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -wid * 0.5);
  ctx.quadraticCurveTo(len * 0.55, -wid, len, -wid * 0.22);
  ctx.quadraticCurveTo(len * 1.06, 0, len, wid * 0.22);
  ctx.quadraticCurveTo(len * 0.55, wid, 0, wid * 0.5);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
function scute(cx, cy, r, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const an = rot + (i * Math.PI * 2) / n;
    const px = cx + Math.cos(an) * r, py = cy + Math.sin(an) * r * 0.86;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function drawTurtle(x, cy, a, t) {
  const s = S, swim = Math.sin(t * 9) * 0.5;
  ctx.save(); ctx.translate(x, cy); ctx.rotate(a);
  ctx.shadowColor = C.surf; ctx.shadowBlur = 16;
  // rear flippers — short paddles sweeping back
  paddle(-14 * s, 9 * s,  16 * s, 7 * s,  2.55 - swim * 0.3, C.emerald);
  paddle(-14 * s, -9 * s, 16 * s, 7 * s, -2.55 + swim * 0.3, C.emerald);
  // front flippers — long sea-turtle paddles sweeping out and back
  paddle(8 * s, 8 * s,  30 * s, 11 * s,  2.25 - swim * 0.4, C.surf);
  paddle(8 * s, -8 * s, 30 * s, 11 * s, -2.25 + swim * 0.4, C.surf);
  // tail
  ctx.fillStyle = C.emerald;
  ctx.beginPath(); ctx.moveTo(-23 * s, 0); ctx.lineTo(-30 * s, -5 * s); ctx.lineTo(-30 * s, 5 * s); ctx.closePath(); ctx.fill();
  // shell
  const g = ctx.createRadialGradient(-4 * s, -6 * s, 2 * s, 0, 0, 26 * s);
  g.addColorStop(0, C.foam); g.addColorStop(0.4, C.surf); g.addColorStop(1, C.emerald);
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 26 * s, 19 * s, 0, 0, Math.PI * 2); ctx.fill();
  // scutes — hex/pentagon carapace plates
  ctx.shadowBlur = 0; ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(3,32,24,0.55)"; ctx.lineWidth = 1.4 * s;
  const plates = [
    [9 * s, 0, 6 * s, 6], [0, 0, 6.6 * s, 6], [-9 * s, 0, 6 * s, 6],   // central row (hex)
    [3 * s, -9.5 * s, 5.4 * s, 5], [-6 * s, -9 * s, 5 * s, 5],         // upper costals (pent)
    [3 * s, 9.5 * s, 5.4 * s, 5], [-6 * s, 9 * s, 5 * s, 5],           // lower costals (pent)
    [16 * s, 0, 4.6 * s, 5], [-17 * s, 0, 4.4 * s, 5],                 // front / back marginals
  ];
  for (const [px, py, pr, pn] of plates) {
    scute(px, py, pr, pn, pn === 6 ? 0 : -Math.PI / 2);
    ctx.fillStyle = "rgba(12,143,104,0.18)"; ctx.fill();
    ctx.stroke();
  }
  // head + eye
  ctx.shadowColor = C.surf; ctx.shadowBlur = 12; ctx.fillStyle = C.surf;
  ctx.beginPath(); ctx.ellipse(26 * s, 0, 9 * s, 7 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = C.foam; circle(29 * s, -2.5 * s, 2.3 * s);
  ctx.fillStyle = "#04141d"; circle(30 * s, -2.5 * s, 1.1 * s);
  ctx.restore();
}

/* ==========================================================
   Loop
   ========================================================== */
function loop(now) {
  if (t0 === undefined) t0 = now;
  requestAnimationFrame(loop);
  if (document.body.dataset.screen !== "play") { lastTs = now; return; }
  const dt = Math.min(0.033, (now - (lastTs || now)) / 1000);
  lastTs = now;
  update(dt);
  render(now);
}

/* ==========================================================
   Input
   ========================================================== */
stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest("[data-action]")) return;     // overlay buttons handle themselves
  if (state === "ready" || state === "running") flap();
});
overlay.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (b) { if (b.dataset.action === "again") startRun(); else if (b.dataset.action === "menu") goMenu(); return; }
  if (state === "ready") flap();                      // tap the ready prompt to launch
});
window.addEventListener("keydown", (e) => {
  if (document.body.dataset.screen !== "play") return;
  if (e.code === "Space" || e.code === "ArrowUp" || e.key === "w" || e.key === "W") {
    e.preventDefault();
    if (state === "over") startRun(); else flap();
  } else if (e.key === "Escape") {
    e.preventDefault(); goMenu();
  }
});

startBtn.addEventListener("click", enterPlay);
muteBtn.addEventListener("click", () => {
  ensureAudio();
  muted = !muted;
  muteBtn.classList.toggle("is-muted", muted);
  muteBtn.setAttribute("aria-label", muted ? "Sound off" : "Sound on");
  if (!muted) sfx.flap();
  saveSettings();
});
diffRadios.forEach((r) => r.addEventListener("change", () => { refreshMenuBest(); saveSettings(); }));

window.addEventListener("resize", () => {
  if (document.body.dataset.screen !== "play") return;
  computeLayout();
  seedBubbles();
  if (state === "ready") y = viewH / 2;
});

/* ==========================================================
   Boot
   ========================================================== */
loadSettings();
muteBtn.classList.toggle("is-muted", muted);
refreshMenuBest();
requestAnimationFrame(loop);