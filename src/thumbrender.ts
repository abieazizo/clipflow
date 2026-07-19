/**
 * thumbrender.ts — Whatnot show-cover compositor (BEAT-THE-BENCHMARK build).
 *
 * Modeled on the winning oncoast formula (assets/benchmark/oncoast.webp):
 *   • real tile ratio ≈ 0.647  →  COVER = 1080×1667 (NOT 9:16)
 *   • TEXT-WALL default: a big stacked type wall filling ~55% of the frame,
 *     each line width-filled, alternating fills, sticker + hard shadow + skew
 *   • full-bleed saturated flood colour + vector radial burst rays
 *   • real product cutouts collaged in front of / behind the letters (depth)
 *   • a BIG price/offer starburst overlapping the wall corner
 *   • "Poster" mode keeps the previous top-lockup engine as an option
 *
 * Gemini only ever paints artwork (backgrounds / product cutouts); every glyph
 * is code-rendered, so spelling is always exact. The offer/hero/line math is
 * MIRRORED in public/app.js for the live preview — keep them in sync.
 */

import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Canvas, type Image } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { STYLE_SPECS, type ThumbStyle, type TextTreatment, type ImageInput, type CoverRecipe } from "./gemini.js";

export const RENDER_W = 1080;
export const RENDER_H = 1667;         // Whatnot tile ≈ 0.647 (verified from real thumbnails)
export const COVER_ASPECT = RENDER_W / RENDER_H;
const SAFE = 0.05;                    // 5% safe-zone inset
const INNER_W = RENDER_W * (1 - SAFE * 2);
export const LEGIBILITY_MIN_XHEIGHT = 0.07; // headline x-height ≥ 7% of cover height

// Text-wall band (headline fills ~55% of the frame here).
const WALL_TOP = 0.125;
const WALL_BOTTOM = 0.68;
const WALL_FILL = 0.62;               // target fraction of height the stack occupies
const WALL_MAX_LINES = 5;
const WALL_LINE_LEADING = 0.9;
const LINE_TARGET_W = 0.94;           // each line stretched to ~94% of inner width

// Poster-mode lockup (previous engine) lives in the top region.
const MARGIN = RENDER_W * SAFE;
const MAX_W = RENDER_W - MARGIN * 2;
const LOCKUP_TOP = 0.075, LOCKUP_BOTTOM = 0.46, LOCKUP_CENTER = 0.26;
const BASE_START = 150, BASE_MIN = 40, POSTER_MAX_LINES = 4, POSTER_LEADING = 0.98;

const FONT_HEADLINE = "Clash Display";
const FONT_BADGE = "Satoshi Black";
const FONT_HANDLE = "Satoshi Medium";

let fontsReady = false;

export function registerFonts(): string[] {
  if (fontsReady) return [];
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "assets", "fonts"), join(process.cwd(), "assets", "fonts")];
  const dir = candidates.find((d) => existsSync(join(d, "ClashDisplay-Bold.ttf"))) ?? candidates[0];
  const reg: Array<[string, string]> = [
    ["ClashDisplay-Bold.ttf", "Clash Display"],
    ["ClashDisplay-Semibold.ttf", "Clash Display Semibold"],
    ["Satoshi-Black.otf", "Satoshi Black"],
    ["Satoshi-Bold.otf", "Satoshi"],
    ["Satoshi-Medium.otf", "Satoshi Medium"],
  ];
  const loaded: string[] = [];
  for (const [file, family] of reg) {
    const p = join(dir, file);
    if (existsSync(p) && GlobalFonts.registerFromPath(p, family)) loaded.push(family);
  }
  fontsReady = loaded.length > 0;
  return loaded;
}

// ---------------------------------------------------------------------------
// Offer + hero-word logic — MIRRORED in public/app.js
// ---------------------------------------------------------------------------

const FILLER = new Set(["the", "a", "an", "and", "or", "for", "with", "of", "to", "in", "on", "at", "my", "your", "all", "night", "tonight"]);
const OFFER_PATTERNS: RegExp[] = [
  /\$\s?\d[\d,]*(?:\.\d+)?\+?/, /\b\d[\d,]*\s?\$/, /\b\d{1,3}\s?%\s?off\b/i,
  /\b\d+\s+for\s+\$?\d+\b/i, /\bbogo\b/i, /\bfree\b/i,
];

export function detectOffer(headline: string): { offer: string | null; rest: string[] } {
  const clean = headline.replace(/\s+/g, " ").trim();
  let offer: string | null = null, rest = clean;
  for (const re of OFFER_PATTERNS) {
    const m = clean.match(re);
    if (m) { offer = normalizeOffer(m[0]); rest = (clean.slice(0, m.index) + clean.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim(); break; }
  }
  const words = rest ? rest.toUpperCase().split(" ") : [];
  if (words.length === 0 && offer) return { offer: null, rest: [offer] };
  return { offer, rest: words };
}
function normalizeOffer(raw: string): string {
  const t = raw.replace(/\s+/g, "").toUpperCase();
  const m = t.match(/^(\d[\d,]*)\$$/);
  return m ? `$${m[1]}` : t;
}
export function pickHeroIndex(rest: string[], override?: number | null): number {
  if (override != null && override >= 0 && override < rest.length) return override;
  let best = 0, bestLen = -1;
  rest.forEach((w, i) => { const s = FILLER.has(w.toLowerCase()) ? w.length - 100 : w.length; if (s > bestLen) { bestLen = s; best = i; } });
  return best;
}

// ---------------------------------------------------------------------------
// Seeded RNG (deterministic collage that varies on regenerate)
// ---------------------------------------------------------------------------
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------
// Text-wall layout — MIRRORED in public/app.js
// ---------------------------------------------------------------------------

interface WallLine { text: string; size: number; }

/** Balance words into `count` lines of roughly-equal character length. */
function groupLines(words: string[], count: number): string[] {
  if (words.length <= count) return words.slice();
  const total = words.join(" ").length;
  const per = total / count;
  const lines: string[] = []; let cur: string[] = [], curLen = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const remainingLines = count - lines.length;
    const remainingWords = words.length - i;
    cur.push(w); curLen += w.length + 1;
    const mustBreak = remainingWords <= remainingLines - 1; // leave ≥1 word per remaining line
    if ((curLen >= per && lines.length < count - 1) || mustBreak) { lines.push(cur.join(" ")); cur = []; curLen = 0; }
  }
  if (cur.length) lines.push(cur.join(" "));
  return lines;
}

/**
 * Build the stacked type wall: choose the line count whose width-filled stack
 * height lands closest to WALL_FILL of the frame. `refMeasure(text)` = width at
 * REF px. Each line's font size fills LINE_TARGET_W of the inner width.
 */
export function layoutWall(
  words: string[],
  refMeasure: (text: string) => number,
  ref: number,
  innerW: number,
  targetH: number
): { lines: WallLine[]; stackH: number } {
  const targetW = innerW * LINE_TARGET_W;
  const sizeFor = (text: string) => { const w = refMeasure(text) / ref; return w > 0 ? targetW / w : ref; };
  let best: { lines: WallLine[]; stackH: number; err: number } | null = null;
  const maxLines = Math.min(WALL_MAX_LINES, Math.max(1, words.length));
  for (let count = 1; count <= maxLines; count++) {
    const grouped = groupLines(words, count);
    const lines: WallLine[] = grouped.map((t) => ({ text: t, size: Math.min(sizeFor(t), RENDER_H * 0.24) }));
    const stackH = lines.reduce((h, l) => h + l.size * WALL_LINE_LEADING, 0);
    const err = Math.abs(stackH - targetH);
    if (!best || err < best.err) best = { lines, stackH, err };
  }
  return { lines: best!.lines, stackH: best!.stackH };
}

// ---------------------------------------------------------------------------
// Poster lockup layout (previous engine, kept as an option)
// ---------------------------------------------------------------------------
interface Line { text: string; size: number; }
function wrapWords(words: string[], measure: (s: string) => number, maxWidth: number): string[] {
  const lines: string[] = []; let cur = "";
  for (const w of words) { const test = cur ? `${cur} ${w}` : w; if (!cur || measure(test) <= maxWidth) cur = test; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  return lines;
}
function layoutLockup(rest: string[], heroIdx: number, measure: (t: string, px: number) => number, heroScale: number, maxW: number): { lines: Line[]; blockH: number; heroLine: number } {
  const before = rest.slice(0, heroIdx), hero = rest[heroIdx] ?? "", after = rest.slice(heroIdx + 1);
  const maxBlockH = (LOCKUP_BOTTOM - LOCKUP_TOP) * RENDER_H;
  const build = (size: number) => {
    const bl = wrapWords(before, (s) => measure(s, size), maxW), al = wrapWords(after, (s) => measure(s, size), maxW);
    const lines: Line[] = [...bl.map((t) => ({ text: t, size })), ...(hero ? [{ text: hero, size: size * heroScale }] : []), ...al.map((t) => ({ text: t, size }))];
    return { lines, heroLine: hero ? bl.length : -1 };
  };
  for (let size = BASE_START; size >= BASE_MIN; size -= 4) {
    const { lines, heroLine } = build(size);
    if (!lines.length) continue;
    const ok = lines.every((l) => measure(l.text, l.size) <= maxW);
    const blockH = lines.reduce((h, l) => h + l.size * POSTER_LEADING, 0);
    if (lines.length <= POSTER_MAX_LINES && ok && blockH <= maxBlockH) return { lines, blockH, heroLine };
  }
  const f = build(BASE_MIN), lines = f.lines.slice(0, POSTER_MAX_LINES);
  return { lines, blockH: lines.reduce((h, l) => h + l.size * POSTER_LEADING, 0), heroLine: Math.min(f.heroLine, lines.length - 1) };
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function hexToRgb(h: string): [number, number, number] {
  let s = h.replace("#", ""); if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}
function luminance(hex: string): number { const [r, g, b] = hexToRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

/** Full-bleed flood colour + vector radial burst rays (not AI). */
function drawFlood(ctx: SKRSContext2D, base: string, rays: string) {
  // deep-to-bright radial flood
  const g = ctx.createRadialGradient(RENDER_W / 2, RENDER_H * 0.42, RENDER_H * 0.05, RENDER_W / 2, RENDER_H * 0.42, RENDER_H * 0.8);
  g.addColorStop(0, shade(base, 34)); g.addColorStop(1, shade(base, -26));
  ctx.fillStyle = g; ctx.fillRect(0, 0, RENDER_W, RENDER_H);
  // burst rays from the upper-middle
  const cx = RENDER_W / 2, cy = RENDER_H * 0.4, n = 24, R = RENDER_H * 1.1;
  ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = rays;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n, w = 0.10;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - w) * R, cy + Math.sin(a - w) * R);
    ctx.lineTo(cx + Math.cos(a + w) * R, cy + Math.sin(a + w) * R);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // corner vignette for depth
  const v = ctx.createRadialGradient(RENDER_W / 2, RENDER_H * 0.45, RENDER_H * 0.3, RENDER_W / 2, RENDER_H * 0.5, RENDER_H * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = v; ctx.fillRect(0, 0, RENDER_W, RENDER_H);
}

/** A stacked type-wall line: hard offset shadow + thick sticker stroke + fill, skewed. */
function drawWallLine(ctx: SKRSContext2D, line: WallLine, cx: number, y: number, skewDeg: number, fill: string | CanvasGradient, outline: string) {
  ctx.save();
  ctx.translate(cx, y);
  ctx.transform(1, 0, Math.tan((skewDeg * Math.PI) / 180), 1, 0, 0); // horizontal skew
  ctx.font = `${line.size}px "${FONT_HEADLINE}"`;
  try { (ctx as any).letterSpacing = "-1px"; } catch { /* */ }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  // hard offset shadow
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fillText(line.text, line.size * 0.045, line.size * 0.06);
  // sticker stroke + fill
  ctx.lineJoin = "round"; ctx.lineWidth = line.size * 0.075; ctx.strokeStyle = outline; ctx.strokeText(line.text, 0, 0);
  ctx.fillStyle = fill; ctx.fillText(line.text, 0, 0);
  try { (ctx as any).letterSpacing = "0px"; } catch { /* */ }
  ctx.restore();
}

/** Poster-mode sticker line (top lockup). */
function drawStickerLine(ctx: SKRSContext2D, line: Line, cx: number, y: number, rot: number, fill: string | CanvasGradient, t: TextTreatment) {
  ctx.save();
  ctx.translate(cx, y); ctx.rotate((rot * Math.PI) / 180);
  ctx.font = `${line.size}px "${FONT_HEADLINE}"`;
  try { (ctx as any).letterSpacing = "-1px"; } catch { /* */ }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const stroke = line.size * t.outlineScale;
  if (t.shadow === "hard") { ctx.fillStyle = t.shadowColor; ctx.fillText(line.text, line.size * 0.045, line.size * 0.065); }
  else if (t.shadow === "glow") { ctx.shadowColor = t.shadowColor; ctx.shadowBlur = 26; ctx.fillStyle = fill; ctx.fillText(line.text, 0, 0); ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; }
  else { ctx.shadowColor = t.shadowColor; ctx.shadowBlur = 14; ctx.shadowOffsetY = line.size * 0.03; ctx.fillStyle = fill; ctx.fillText(line.text, 0, 0); ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
  if (stroke > 0.4) { ctx.lineJoin = "round"; ctx.lineWidth = stroke; ctx.strokeStyle = t.outlineColor; ctx.strokeText(line.text, 0, 0); }
  ctx.fillStyle = fill; ctx.fillText(line.text, 0, 0);
  try { (ctx as any).letterSpacing = "0px"; } catch { /* */ }
  ctx.restore();
}

function starPath(ctx: SKRSContext2D, radius: number, inner: number, points: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? radius : inner, a = (Math.PI * i) / points - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const BADGE_RADIUS = RENDER_W * 0.115; // starburst ⌀ ≈ 23% of width

/** BIG gold price starburst overlapping the wall corner. */
function drawStarburst(ctx: SKRSContext2D, cx: number, cy: number, text: string) {
  const radius = BADGE_RADIUS;
  const inner = radius * 0.74, points = 16;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate((-8 * Math.PI) / 180);
  ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 34; ctx.shadowOffsetY = 12;
  const grad = ctx.createLinearGradient(0, -radius, 0, radius);
  grad.addColorStop(0, "#FFE79A"); grad.addColorStop(0.5, "#FFC01E"); grad.addColorStop(1, "#E48A00");
  starPath(ctx, radius, inner, points); ctx.fillStyle = grad; ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.lineWidth = 7; ctx.strokeStyle = "#ffffff"; starPath(ctx, radius * 0.86, inner * 0.86, points); ctx.stroke();
  // number/word — auto-fit inside the inner circle
  let fs = radius * 1.05;
  ctx.font = `${fs}px "${FONT_HEADLINE}"`;
  const maxTw = inner * 1.62;
  const tw = ctx.measureText(text).width;
  if (tw > maxTw) { fs *= maxTw / tw; ctx.font = `${fs}px "${FONT_HEADLINE}"`; }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineJoin = "round"; ctx.lineWidth = fs * 0.09; ctx.strokeStyle = "#7A3E00"; ctx.strokeText(text, 0, fs * 0.02);
  ctx.fillStyle = "#ffffff"; ctx.fillText(text, 0, fs * 0.02);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Product cutouts + collage
// ---------------------------------------------------------------------------

export interface PreppedCutout { canvas: Canvas; hasAlpha: boolean }

/**
 * Load a cutout buffer and make its background transparent. If the image already
 * carries alpha, keep it. Otherwise flood-fill from the borders, removing pixels
 * within tolerance of the (uniform) edge colour — this reliably clears a flat
 * magenta / grey / white studio background without holing the product interior.
 */
export async function prepCutout(buf: Buffer): Promise<PreppedCutout | null> {
  try {
    const img = await loadImage(buf);
    const W = img.width, H = img.height;
    const c = createCanvas(W, H);
    const cx = c.getContext("2d");
    cx.drawImage(img as unknown as Image, 0, 0);
    const data = cx.getImageData(0, 0, W, H);
    const d = data.data;
    let transparent = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) { n++; if (d[i + 3] < 245) transparent++; }
    if (transparent > n * 0.02) return { canvas: c, hasAlpha: true };

    // sample the border colour (average of edge pixels); bail if edges aren't uniform
    let br = 0, bg = 0, bb = 0, bc = 0;
    const sample = (x: number, y: number) => { const i = (y * W + x) * 4; br += d[i]; bg += d[i + 1]; bb += d[i + 2]; bc++; };
    for (let x = 0; x < W; x += 4) { sample(x, 0); sample(x, H - 1); }
    for (let y = 0; y < H; y += 4) { sample(0, y); sample(W - 1, y); }
    br /= bc; bg /= bc; bb /= bc;
    const TOL = 60;
    const isBg = (i: number) => Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb) < TOL;
    // flood-fill from every border pixel that matches the background colour
    const visited = new Uint8Array(W * H);
    const stack: number[] = [];
    const pushIf = (p: number) => { if (!visited[p]) { const i = p * 4; if (isBg(i)) { visited[p] = 1; stack.push(p); } } };
    for (let x = 0; x < W; x++) { pushIf(x); pushIf((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { pushIf(y * W); pushIf(y * W + W - 1); }
    let removed = 0;
    while (stack.length) {
      const p = stack.pop()!; const x = p % W, y = (p / W) | 0;
      d[p * 4 + 3] = 0; removed++;
      if (x > 0) pushIf(p - 1);
      if (x < W - 1) pushIf(p + 1);
      if (y > 0) pushIf(p - W);
      if (y < H - 1) pushIf(p + W);
    }
    if (removed > W * H * 0.03) { cx.putImageData(data, 0, 0); return { canvas: c, hasAlpha: true }; }
    return { canvas: c, hasAlpha: false };
  } catch { return null; }
}

interface Placement { cut: PreppedCutout; x: number; y: number; w: number; h: number; rot: number; over: boolean }

/**
 * Deterministic collage: fill the lower band with 5-6 product placements (cycling
 * the available cutouts), spread across the width, with 2 overlapping the bottom
 * of the letters for depth. Seeded so regenerate reshuffles it.
 */
function planCollage(cuts: PreppedCutout[], seed: number, wallBottomFrac: number): Placement[] {
  if (cuts.length === 0) return [];
  const r = rng(seed);
  const out: Placement[] = [];
  const wallBottomY = wallBottomFrac * RENDER_H;
  const count = Math.min(6, Math.max(3, cuts.length * 2));
  const overN = Math.min(count, 2);
  for (let k = 0; k < count; k++) {
    const cut = cuts[k % cuts.length];
    const over = k < overN; // the first ones tuck under the bottom edge of the letters
    const ar = cut.canvas.width / cut.canvas.height || 1;
    const w = RENDER_W * (over ? 0.36 + r() * 0.1 : 0.3 + r() * 0.14);
    const h = w / ar;
    const col = (k + 0.5) / count;
    const x = RENDER_W * (0.05 + col * 0.9 + (r() - 0.5) * 0.1) - w / 2;
    // over cutouts sit just below the wall, overlapping up ~30% into the last line;
    // behind cutouts fill the shelf from the wall bottom to near the base.
    const y = over
      ? wallBottomY - h * 0.3 + (r() - 0.5) * RENDER_H * 0.04
      : RENDER_H * (Math.max(wallBottomFrac + 0.01, 0.6) + r() * Math.max(0.06, 0.93 - Math.max(wallBottomFrac + 0.01, 0.6))) - h / 2;
    const rot = (r() - 0.5) * (over ? 15 : 24);
    out.push({ cut, x, y, w, h, rot, over });
  }
  return out;
}

function drawCutout(ctx: SKRSContext2D, p: Placement) {
  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
  ctx.rotate((p.rot * Math.PI) / 180);
  if (p.over) { ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = 12; }
  if (p.cut.hasAlpha) {
    ctx.drawImage(p.cut.canvas as unknown as Image, -p.w / 2, -p.h / 2, p.w, p.h);
  } else {
    // opaque photo → draw as a rounded "sticker" tile with a white border
    const pad = p.w * 0.03;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, -p.w / 2 - pad, -p.h / 2 - pad, p.w + pad * 2, p.h + pad * 2, p.w * 0.06); ctx.fill();
    ctx.save(); roundRect(ctx, -p.w / 2, -p.h / 2, p.w, p.h, p.w * 0.05); ctx.clip();
    ctx.drawImage(p.cut.canvas as unknown as Image, -p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
  }
  ctx.restore();
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Cinematic grade
// ---------------------------------------------------------------------------
interface Grade { contrast: number; saturation: number; grain: number; vignette: number }
const GRADE: Grade = { contrast: 1.08, saturation: 1.12, grain: 6, vignette: 0.12 };
function applyGrade(ctx: SKRSContext2D, accent: string) {
  const img = ctx.getImageData(0, 0, RENDER_W, RENDER_H), d = img.data, W = RENDER_W, H = RENDER_H;
  for (let i = 0, px = 0; i < d.length; i += 4, px++) {
    const x = px % W, y = (px / W) | 0;
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = luma + (r - luma) * GRADE.saturation; g = luma + (g - luma) * GRADE.saturation; b = luma + (b - luma) * GRADE.saturation;
    r = (r - 128) * GRADE.contrast + 128; g = (g - 128) * GRADE.contrast + 128; b = (b - 128) * GRADE.contrast + 128;
    const dx = x / W - 0.5, dy = y / H - 0.5, vig = 1 - GRADE.vignette * ((dx * dx + dy * dy) / 0.5);
    r *= vig; g *= vig; b *= vig;
    const n = (Math.random() * 2 - 1) * GRADE.grain;
    d[i] = clamp(r + n); d[i + 1] = clamp(g + n); d[i + 2] = clamp(b + n);
  }
  ctx.putImageData(img, 0, 0);
  ctx.save(); ctx.globalAlpha = 0.3; ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.strokeRect(4, 4, RENDER_W - 8, RENDER_H - 8); ctx.restore();
}
function clamp(v: number) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

export type LayoutMode = "wall" | "poster";
export interface ComposeOpts {
  style: ThumbStyle;
  headline: string;
  handle: string;
  layout?: LayoutMode;               // default "wall"
  heroWordIndex?: number | null;     // poster mode
  cutouts?: Buffer[];                // product/clip images (already isolated)
  background?: Buffer;               // optional AI hero (poster / pure-AI)
  recipe?: CoverRecipe | null;       // clone-a-winner overrides
  dateText?: string;                 // optional date/time ribbon
  seed?: number;                     // collage seed
}
export interface ComposeResult { png: Buffer; webp: Buffer; offer: string | null; legible: boolean; legibilityPct: number }

export async function composeThumbnail(opts: ComposeOpts): Promise<ComposeResult> {
  registerFonts();
  const spec = STYLE_SPECS[opts.style];
  const mode: LayoutMode = opts.recipe?.layoutStyle ?? opts.layout ?? "wall";
  const base = opts.recipe?.baseColorHex ?? spec.base;
  const rays = opts.recipe ? shade(base, 40) : spec.rays;
  const wallFills = opts.recipe?.textColors?.length ? opts.recipe.textColors : spec.wallFills;
  const seed = (opts.seed ?? 1) >>> 0;

  const canvas = createCanvas(RENDER_W, RENDER_H);
  const ctx = canvas.getContext("2d");

  // 1) background: flood + rays (wall / pure-AI-less), or a provided AI hero (poster)
  if (mode === "poster" && opts.background) {
    try {
      const img = await loadImage(opts.background);
      const scale = Math.max(RENDER_W / img.width, RENDER_H / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (RENDER_W - dw) / 2, (RENDER_H - dh) / 2, dw, dh);
    } catch { drawFlood(ctx, base, rays); }
  } else {
    drawFlood(ctx, base, rays);
  }

  // 2) detect offer + precompute the wall layout so the collage can tuck under the letters
  const { offer, rest } = detectOffer(opts.headline);
  const words = rest.length ? rest : ["YOUR", "HEADLINE"];
  let legibilityPct = 0;
  let starCx = RENDER_W * 0.8, starCy = RENDER_H * 0.2, wallBottomFrac = 0.62;
  let wallPlan: { lines: WallLine[]; textCenterX: number; firstTop: number } | null = null;
  if (mode === "wall") {
    const REF = 100;
    const refMeasure = (text: string) => { ctx.font = `${REF}px "${FONT_HEADLINE}"`; return ctx.measureText(text).width; };
    const effInnerW = INNER_W * (offer ? 0.74 : 1); // narrow + shift left to clear the badge strip
    const textCenterX = MARGIN + effInnerW / 2;
    const { lines, stackH } = layoutWall(words, refMeasure, REF, effInnerW, RENDER_H * WALL_FILL);
    const firstTop = (WALL_TOP + WALL_BOTTOM) / 2 * RENDER_H - stackH / 2;
    wallBottomFrac = (firstTop + stackH) / RENDER_H;
    wallPlan = { lines, textCenterX, firstTop };
    legibilityPct = (Math.max(...lines.map((l) => l.size)) * 0.68) / RENDER_H;
    starCx = MARGIN + effInnerW - 30 + BADGE_RADIUS;
    starCy = firstTop + ((lines[0]?.size ?? 100) + (lines[1]?.size ?? 0) * 0.5) * WALL_LINE_LEADING * 0.5;
  }

  // 3) prep + plan collage (knows where the wall ends), draw the behind cutouts
  const prepped: PreppedCutout[] = [];
  for (const buf of opts.cutouts ?? []) { const p = await prepCutout(buf); if (p) prepped.push(p); }
  const placements = planCollage(prepped, seed, wallBottomFrac);
  for (const p of placements) if (!p.over) drawCutout(ctx, p);

  // 4) headline
  if (mode === "wall" && wallPlan) {
    let cursorY = wallPlan.firstTop;
    wallPlan.lines.forEach((l, i) => {
      const lh = l.size * WALL_LINE_LEADING, cy = cursorY + lh / 2;
      const skew = (i % 2 === 0 ? 1 : -1) * 2;
      const fill = wallFills[i % wallFills.length];
      const outline = luminance(fill) > 150 ? shade(base, -60) : "#ffffff";
      drawWallLine(ctx, l, wallPlan.textCenterX, cy, skew, fill, outline);
      cursorY += lh;
    });
  } else {
    // poster mode — top-42% lockup over the (hero/flood) background
    if (!opts.background) { // add a top scrim for legibility on flood
      const g = ctx.createLinearGradient(0, 0, 0, RENDER_H * 0.5); g.addColorStop(0, "rgba(0,0,0,0.5)"); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, RENDER_W, RENDER_H * 0.5);
    }
    const t = spec.text;
    const heroIdx = pickHeroIndex(words, opts.heroWordIndex);
    const GUTTER = 240, effMaxW = MAX_W - (offer ? GUTTER : 0), textCenterX = MARGIN + effMaxW / 2;
    const measure = (text: string, px: number) => { ctx.font = `${px}px "${FONT_HEADLINE}"`; return ctx.measureText(text).width; };
    const { lines, blockH, heroLine } = layoutLockup(words, heroIdx, measure, t.heroScale, effMaxW);
    let cursorY = Math.max(LOCKUP_TOP * RENDER_H, LOCKUP_CENTER * RENDER_H - blockH / 2);
    const firstTop = cursorY, firstSize = lines[0]?.size ?? 100;
    legibilityPct = (Math.max(...lines.map((l) => l.size)) * 0.68) / RENDER_H;
    lines.forEach((l, i) => {
      const lh = l.size * POSTER_LEADING, cy = cursorY + lh / 2;
      const rot = (i % 2 === 0 ? 1 : -1) * t.rotateMag * (i === heroLine ? 0.5 : 1);
      const entry = wallFills[i % wallFills.length];
      const outline = luminance(entry) > 150 ? shade(base, -60) : "#ffffff";
      drawStickerLine(ctx, l, textCenterX, cy, rot, entry, { ...t, outlineColor: outline });
      cursorY += lh;
    });
    starCx = MARGIN + effMaxW + RENDER_W * 0.02; starCy = firstTop + firstSize * 0.3;
  }

  // over-the-text cutouts (depth)
  for (const p of placements) if (p.over) drawCutout(ctx, p);

  // 4) BIG offer starburst
  if (offer) drawStarburst(ctx, Math.min(starCx, RENDER_W - RENDER_W * 0.1), starCy, offer);

  // 5) date/time ribbon + @handle
  const date = (opts.dateText ?? "").trim().slice(0, 24);
  if (date) {
    ctx.font = `44px "${FONT_BADGE}"`;
    const tw = ctx.measureText(date.toUpperCase()).width, pad = 30, h = 76, w = tw + pad * 2;
    const x = (RENDER_W - w) / 2, y = RENDER_H * 0.9 - h;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.fillStyle = spec.accent; roundRect(ctx, x, y, w, h, h / 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(date.toUpperCase(), RENDER_W / 2, y + h / 2 + 2);
  }
  const handle = opts.handle.trim().replace(/^@+/, "");
  if (handle) {
    ctx.font = `40px "${FONT_HANDLE}"`;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 10;
    ctx.fillText(`@${handle}`, RENDER_W / 2, RENDER_H - 58);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
  }

  // 6) grade
  applyGrade(ctx, spec.accent);

  const png = canvas.toBuffer("image/png");
  const pw = 540, ph = Math.round(pw / COVER_ASPECT);
  const pv = createCanvas(pw, ph);
  pv.getContext("2d").drawImage(canvas as unknown as Image, 0, 0, pw, ph);
  const webp = pv.toBuffer("image/webp");
  return { png, webp, offer, legible: legibilityPct >= LEGIBILITY_MIN_XHEIGHT, legibilityPct };
}

/** Convert a saved clip thumbnail (webp) to a base64 PNG image-input. */
export async function clipToImageInput(webpPath: string): Promise<ImageInput | null> {
  if (!existsSync(webpPath)) return null;
  try {
    const img = await loadImage(webpPath);
    const cap = 1024, scale = Math.min(1, cap / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const c = createCanvas(w, h); c.getContext("2d").drawImage(img, 0, 0, w, h);
    return { data: c.toBuffer("image/png").toString("base64"), mimeType: "image/png" };
  } catch { return null; }
}

/** Downscale any cover PNG to a 200px-wide legibility-preview buffer. */
export async function downscalePreview(png: Buffer, width = 200): Promise<Buffer> {
  const img = await loadImage(png);
  const h = Math.round(width / (img.width / img.height));
  const c = createCanvas(width, h);
  c.getContext("2d").drawImage(img, 0, 0, width, h);
  return c.toBuffer("image/png");
}
