/**
 * gemini.ts — AI thumbnail generation via Google's Generative Language REST
 * API (no SDK). Verified against ai.google.dev's generate-content reference:
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   header  x-goog-api-key: <GEMINI_API_KEY>
 *   body    { contents: [{ parts: [{ text }] }] }
 *   image   candidates[0].content.parts[].inlineData -> { mimeType, data(base64) }
 *
 * Everything returns { ok, error } — a bad key, a quota hit, or a safety
 * block must surface as a human sentence in the UI, never a crash.
 */

import { request } from "undici";

/** Models kept in one place so bumping any is a one-line change. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-image"; // image gen + edit
export const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest"; // headline writer
export const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-flash-latest"; // background QA scoring

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type ThumbStyle = "hype" | "clean" | "playful" | "luxury";

/**
 * How the code-rendered headline lockup is painted per style — consumed by
 * thumbrender's v3 layout engine and mirrored in app.js for the live preview.
 * Lines alternate through `fills` and alternate a ±`rotateMag`° tilt; the hero
 * word is scaled by `heroScale`. Sticker look = thick `outline` + hard offset
 * shadow (Luxury swaps to a hairline + glow).
 */
export interface TextTreatment {
  /** per-line alternating fills; a "gold" entry uses the `gold` gradient, "auto" picks by luminance */
  fills: string[];
  /** two-stop gold gradient used when a fill is "gold" */
  gold?: [string, string];
  outlineColor: string;
  /** stroke width as a fraction of font size */
  outlineScale: number;
  /** sticker shadow style */
  shadow: "hard" | "glow" | "soft";
  shadowColor: string;
  /** hero word size multiplier (1.7–2×) */
  heroScale: number;
  /** magnitude of the alternating per-line tilt, degrees */
  rotateMag: number;
}

export interface StyleSpec {
  label: string;
  blurb: string;
  /** accent colour (starburst badge + outlines) */
  accent: string;
  /** full-bleed saturated flood colour behind everything (Text-Wall mode) */
  base: string;
  /** radial burst-ray colour */
  rays: string;
  /** alternating fills for the stacked text wall */
  wallFills: string[];
  /** two colours for the UI's mini style-swatch gradient */
  swatch: [string, string];
  /** style lighting phrase injected into both prompts */
  lighting: string;
  /** style environment/backdrop phrase injected into both prompts */
  backdrop: string;
  /** two camera feels, one per variation, so the pair differs */
  cameraFeels: [string, string];
  /** editing verb phrase, e.g. "Transform this exact scene into an explosive" */
  editVerb: string;
  /** legibility scrim behind the top lockup */
  scrim: "top" | "none";
  text: TextTreatment;
}

const NO_TEXT =
  "Absolutely no text, no letters, no numbers, no words, no logos, no watermarks, no borders. Pure background artwork only.";

export const STYLE_SPECS: Record<ThumbStyle, StyleSpec> = {
  hype: {
    label: "Hype",
    blurb: "Explosive, high-energy",
    accent: "#FF5A3C",
    base: "#D81E2F",
    rays: "#FF7A2C",
    wallFills: ["#ffffff", "#FFD400", "#ffffff"],
    swatch: ["#FF7A3C", "#E8323C"],
    lighting: "dramatic red and orange rim lighting with a bright center flare and lens streaks",
    backdrop: "an explosive radial burst of red and orange light rays with confetti particles and deep vignette edges",
    cameraFeels: ["a low dynamic hero angle with a touch of motion blur", "a straight-on punchy hero shot with shallow depth of field"],
    editVerb: "Transform this exact scene into an explosive",
    scrim: "top",
    text: { fills: ["#ffffff", "#FFD84D"], outlineColor: "#B3231A", outlineScale: 0.085, shadow: "hard", shadowColor: "rgba(20,0,0,0.55)", heroScale: 1.9, rotateMag: 2.5 },
  },
  clean: {
    label: "Clean",
    blurb: "Minimal, premium",
    accent: "#1f6f5c",
    base: "#F2ECD9",
    rays: "#E4D9BE",
    wallFills: ["#1c2a20", "#1f6f5c", "#1c2a20"],
    swatch: ["#eef1e8", "#cdd8c4"],
    lighting: "soft even studio light with a gentle rim and long soft shadows",
    backdrop: "a soft seamless cream and sage studio gradient with generous negative space",
    cameraFeels: ["a calm centered catalog hero shot", "a slightly elevated editorial hero shot"],
    editVerb: "Restage this exact scene into a minimal premium",
    scrim: "none",
    text: { fills: ["#17251c", "#2c6b52"], outlineColor: "#ffffff", outlineScale: 0.028, shadow: "soft", shadowColor: "rgba(0,0,0,0.16)", heroScale: 1.7, rotateMag: 1.5 },
  },
  playful: {
    label: "Playful",
    blurb: "Bubbly, kawaii fun",
    accent: "#ff5aa8",
    base: "#FF2D9E",
    rays: "#B06BFF",
    wallFills: ["#ffffff", "#FFE14D", "#8A5CFF"],
    swatch: ["#ffd1ec", "#c9b8ff"],
    lighting: "bright bubbly candy lighting with soft glossy highlights",
    backdrop: "pastel clouds, floating bubbles and candy-coloured pink, lavender and mint shapes",
    cameraFeels: ["a bouncy playful hero angle", "a cute straight-on toy-commercial hero shot"],
    editVerb: "Transform this exact scene into a joyful bubbly",
    scrim: "top",
    text: { fills: ["#ffffff", "#ff5aa8"], outlineColor: "#6C3EC7", outlineScale: 0.1, shadow: "hard", shadowColor: "rgba(60,0,60,0.35)", heroScale: 1.85, rotateMag: 3 },
  },
  luxury: {
    label: "Luxury",
    blurb: "Dark, gold, editorial",
    accent: "#d4af37",
    base: "#0A0A0C",
    rays: "#2A2418",
    wallFills: ["#F4E4A8", "#ffffff", "#F4E4A8"],
    swatch: ["#2a2418", "#0a0a0c"],
    lighting: "a single dramatic gold spotlight from above with elegant reflections and deep shadows",
    backdrop: "black silk with drifting gold dust particles and cinematic darkness",
    cameraFeels: ["a low reverent hero angle", "a centered editorial jewelry-ad hero shot"],
    editVerb: "Transform this exact scene into a premium dark editorial",
    scrim: "top",
    text: { fills: ["gold", "#f6eccf"], gold: ["#f9e9a8", "#c69320"], outlineColor: "#ffffff", outlineScale: 0.012, shadow: "glow", shadowColor: "rgba(212,175,55,0.55)", heroScale: 1.8, rotateMag: 1.5 },
  },
};

export function isThumbStyle(v: string): v is ThumbStyle {
  return v === "hype" || v === "clean" || v === "playful" || v === "luxury";
}

/** Derive a "what's in this clip" subject from a clip title (strip filler). MIRRORED in app.js. */
export function deriveSubject(title: string): string {
  const FILLER = new Set([
    "the", "a", "an", "and", "or", "for", "with", "of", "to", "in", "on", "at", "my", "your",
    "live", "stream", "streaming", "clip", "video", "today", "tonight", "now", "new", "watch",
    "come", "join", "us", "get", "shop", "sale", "deal", "deals", "giveaway",
  ]);
  const words = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));
  return words.slice(0, 6).join(" ").trim();
}

/** Text-to-image hero-scene BACKGROUND prompt (no clip image). `variant` 0|1 picks a camera feel. */
export function buildBackgroundPrompt(style: ThumbStyle, subject: string, variant = 0): string {
  const s = STYLE_SPECS[style];
  const subj = subject.trim() || "the products being sold on a live shopping stream";
  return [
    `Vertical 9:16 promo cover background: one oversized ${subj} as the single clear hero subject filling the lower 55–60% of the frame,`,
    `shot with ${s.cameraFeels[variant % 2]}, dramatically lit with ${s.lighting}, set against ${s.backdrop}.`,
    "Keep the upper 40% clean and uncluttered — atmospheric empty space reserved for a text overlay.",
    NO_TEXT,
  ].join(" ");
}

/** Image-editing prompt that turns a real clip frame into a styled hero cover. `variant` 0|1 picks a camera feel. */
export function buildEditPrompt(style: ThumbStyle, variant = 0): string {
  const s = STYLE_SPECS[style];
  return [
    `${s.editVerb} vertical 9:16 promo cover:`,
    "keep the main product/subject from the photo recognizable as the oversized hero filling the lower 55% of the frame,",
    `re-light it dramatically with ${s.lighting}, replace the environment with ${s.backdrop},`,
    `compose it with ${s.cameraFeels[variant % 2]}, and keep the upper 40% clean and uncluttered for a text overlay.`,
    NO_TEXT,
  ].join(" ");
}

export type GeminiResult =
  | { ok: true; png: Buffer; mimeType: string }
  | { ok: false; error: string; status?: number };

/** One raw call to the model. Distinguishes hard errors from a text-only reply. */
type OneShot =
  | { kind: "image"; png: Buffer; mimeType: string }
  | { kind: "text" }                       // 200 but no image — worth retrying
  | { kind: "blocked"; reason: string }    // safety block — do not retry
  | { kind: "error"; error: string; status?: number; retry: boolean };

/** An input image for image-editing (base64) — turns generate into an edit request. */
export interface ImageInput { data: string; mimeType: string }

async function oneShot(apiKey: string, prompt: string, image?: ImageInput, aspect = "2:3"): Promise<OneShot> {
  try {
    // Multi-part contents: image first (when editing), then the instruction —
    // the shape Google's generate-content reference uses for image editing.
    const parts: any[] = [];
    if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    parts.push({ text: prompt });
    const res = await request(`${API_BASE}/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["IMAGE"], // return an image, not a text description
          temperature: 0.9,
          imageConfig: { aspectRatio: aspect }, // 2:3 tile (Whatnot ≈ 0.647), or "1:1" for cutouts
        },
      }),
      headersTimeout: 90_000,
      bodyTimeout: 150_000,
    });
    const text = await res.body.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }

    if (res.statusCode === 401 || res.statusCode === 403) {
      return { kind: "error", status: res.statusCode, retry: false, error: "Gemini rejected the API key — double-check GEMINI_API_KEY." };
    }
    if (res.statusCode === 429) {
      return { kind: "error", status: 429, retry: false, error: "Gemini is rate-limiting right now — wait a moment and try again." };
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { kind: "error", status: res.statusCode, retry: res.statusCode >= 500, error: `Gemini error: ${json?.error?.message ?? text.slice(0, 160)}` };
    }
    const blocked = json?.promptFeedback?.blockReason ?? json?.candidates?.[0]?.finishReason === "SAFETY" ? json?.promptFeedback?.blockReason : null;
    const respParts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = respParts.find((p) => p?.inlineData?.data);
    if (imagePart) {
      return { kind: "image", png: Buffer.from(imagePart.inlineData.data, "base64"), mimeType: imagePart.inlineData.mimeType ?? "image/png" };
    }
    if (blocked) return { kind: "blocked", reason: String(blocked).toLowerCase().replace(/_/g, " ") };
    return { kind: "text" }; // model replied with text only — retry
  } catch (e) {
    return { kind: "error", retry: true, error: `Couldn't reach Gemini: ${(e as Error).message}` };
  }
}

/**
 * Generate one image. The model is stochastic and occasionally answers with
 * text instead of drawing, so we retry a text-only (or transient) result up to
 * MAX_TRIES; a safety block or auth/quota error stops immediately.
 */
export async function generateImage(
  apiKey: string,
  prompt: string,
  opts?: { image?: ImageInput; aspect?: string }
): Promise<GeminiResult> {
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY is not set" };
  const MAX_TRIES = 3;
  let lastError = "Gemini returned text instead of an image — try again.";
  for (let i = 0; i < MAX_TRIES; i++) {
    const r = await oneShot(apiKey, prompt, opts?.image, opts?.aspect);
    if (r.kind === "image") return { ok: true, png: r.png, mimeType: r.mimeType };
    if (r.kind === "blocked") return { ok: false, error: `Gemini declined this prompt (${r.reason}) — try different wording.` };
    if (r.kind === "error") {
      lastError = r.error;
      if (!r.retry) return { ok: false, error: r.error, status: r.status };
    }
    // text-only or retryable error — loop again
  }
  return { ok: false, error: lastError };
}

/** Strip ```json fences / prose and pull the first JSON value out of a model reply. */
function extractJson(text: string): any {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through to slice */ }
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* give up */ }
  }
  return null;
}

async function textCall(apiKey: string, model: string, parts: any[]): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const res = await request(`${API_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.9, responseMimeType: "application/json" },
      }),
      headersTimeout: 60_000,
      bodyTimeout: 90_000,
    });
    const raw = await res.body.text();
    let json: any = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* non-JSON envelope */ }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { ok: false, error: `Gemini error: ${json?.error?.message ?? raw.slice(0, 160)}` };
    }
    const out = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("");
    return { ok: true, text: out };
  } catch (e) {
    return { ok: false, error: `Couldn't reach Gemini: ${(e as Error).message}` };
  }
}

/** Write 3 punchy headline options for a clip cover (text model). */
export async function writeHeadlines(
  apiKey: string,
  opts: { clipTitle: string; subject: string }
): Promise<{ ok: true; headlines: string[] } | { ok: false; error: string }> {
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY is not set" };
  const source = opts.clipTitle.trim() || opts.subject.trim() || "a live shopping stream";
  const prompt =
    "Write 3 thumbnail headlines for a live-shopping clip cover. " +
    "Each headline must be 6 words or fewer, ALL CAPS energy, and must include the price or offer if one appears in the source. " +
    "Punchy and scroll-stopping. No hashtags, no emojis, no quotation marks. " +
    `Source clip: "${source}". ` +
    'Return ONLY a JSON array of exactly 3 strings, e.g. ["ONE","TWO","THREE"].';
  const r = await textCall(apiKey, GEMINI_TEXT_MODEL, [{ text: prompt }]);
  if (!r.ok) return r;
  const parsed = extractJson(r.text);
  if (!Array.isArray(parsed)) return { ok: false, error: "The writer returned an unexpected format — try again." };
  const headlines = parsed
    .filter((s) => typeof s === "string")
    .map((s) => s.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 80))
    .filter(Boolean)
    .slice(0, 3);
  if (headlines.length === 0) return { ok: false, error: "The writer came back empty — try again." };
  return { ok: true, headlines };
}

/** Vision score for a background: a/b/c 0–10, d is 0 if any text/watermark is present. */
export interface BgScore { a: number; b: number; c: number; d: number }

export async function scoreBackground(apiKey: string, png: Buffer): Promise<{ ok: true; scores: BgScore } | { ok: false; error: string }> {
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY is not set" };
  const prompt =
    "Score this vertical thumbnail background 0-10 on each criterion: " +
    "(a) ONE clear oversized hero subject in the lower half, " +
    "(b) upper 40% clean and uncluttered for a text overlay, " +
    "(c) strong colour contrast and lighting energy, " +
    "(d) contains NO text, letters, numbers, or watermarks — score 0 if any are present, else 10. " +
    'Return ONLY JSON: {"a":<n>,"b":<n>,"c":<n>,"d":<n>}.';
  const r = await textCall(apiKey, GEMINI_VISION_MODEL, [
    { inlineData: { mimeType: "image/png", data: png.toString("base64") } },
    { text: prompt },
  ]);
  if (!r.ok) return r;
  const p = extractJson(r.text);
  if (!p || typeof p !== "object") return { ok: false, error: "QA scorer returned an unexpected format." };
  const num = (v: any) => Math.max(0, Math.min(10, Number(v)));
  const scores = { a: num(p.a), b: num(p.b), c: num(p.c), d: num(p.d) };
  if ([scores.a, scores.b, scores.c, scores.d].some((n) => !Number.isFinite(n))) {
    return { ok: false, error: "QA scorer returned non-numeric values." };
  }
  return { ok: true, scores };
}

/**
 * Isolate the main product on a transparent background (image edit). Whether the
 * returned PNG actually carries alpha varies by model run — the caller checks
 * and falls back to server-side chroma-key removal. The `1:1` aspect keeps the
 * cutout square so collage placement is predictable.
 */
export async function cutoutProduct(apiKey: string, image: ImageInput): Promise<GeminiResult> {
  const prompt =
    "Isolate ONLY the single main product from this photo and place it on a PURE SOLID MAGENTA background, " +
    "hex #FF00FF, filling the entire background with that exact flat magenta — no gradient, no shadow, no reflection, no floor. " +
    "Keep the product centered, complete and with crisp edges. Absolutely no text, letters, numbers, logos or watermarks.";
  return generateImage(apiKey, prompt, { image, aspect: "1:1" });
}

/** A style recipe distilled from a reference cover — applied to OUR renderer with the user's own words/products. */
export interface CoverRecipe {
  baseColorHex: string;
  textColors: string[];
  layoutStyle: "wall" | "poster";
  badgeStyle: string;
  energyNotes: string;
}

/** Vision-analyze a reference cover into a reusable style recipe (never its words/products). */
export async function analyzeCover(apiKey: string, image: ImageInput): Promise<{ ok: true; recipe: CoverRecipe } | { ok: false; error: string }> {
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY is not set" };
  const prompt =
    "You are a design analyst. Study this live-shopping cover and extract a REUSABLE STYLE RECIPE " +
    "(colours, layout energy) — do NOT transcribe its words or describe its specific products. " +
    "Return ONLY JSON: {" +
    '"baseColorHex":"#RRGGBB" (the dominant flood colour), ' +
    '"textColors":["#RRGGBB", ...] (2-3 headline fill colours), ' +
    '"layoutStyle":"wall" if the headline is a big stacked type wall else "poster", ' +
    '"badgeStyle":"short phrase, e.g. gold starburst", ' +
    '"energyNotes":"one short sentence on the vibe"}.';
  const r = await textCall(apiKey, GEMINI_VISION_MODEL, [
    { inlineData: { mimeType: image.mimeType, data: image.data } },
    { text: prompt },
  ]);
  if (!r.ok) return r;
  const p = extractJson(r.text);
  if (!p || typeof p !== "object") return { ok: false, error: "Couldn't read a style recipe from that cover." };
  const hex = (v: any, fb: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : fb);
  const recipe: CoverRecipe = {
    baseColorHex: hex(p.baseColorHex, "#D81E2F"),
    textColors: Array.isArray(p.textColors) ? p.textColors.map((c: any) => hex(c, "#ffffff")).slice(0, 3) : ["#ffffff", "#FFD400"],
    layoutStyle: p.layoutStyle === "poster" ? "poster" : "wall",
    badgeStyle: String(p.badgeStyle ?? "gold starburst").slice(0, 60),
    energyNotes: String(p.energyNotes ?? "").slice(0, 160),
  };
  if (recipe.textColors.length === 0) recipe.textColors = ["#ffffff", "#FFD400"];
  return { ok: true, recipe };
}
