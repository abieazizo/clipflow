/**
 * caption.ts — builds the post caption from the clip title + the seller's
 * caption style.
 *
 * Sellers pick a PRESET (hype / chill / minimal) — friendly, token-free UI —
 * or "custom", which uses their own template. Template tokens (custom only,
 * and inside the preset definitions):
 *   {title}    -> the clip's show title
 *   {hashtags} -> the user's hashtags joined with spaces
 *   {username} -> the user's whatnot username
 */

import type { ClipMeta } from "./whatnot.js";

export type CaptionPreset = "hype" | "chill" | "minimal" | "custom";

/** The preset templates — the single source of truth (server render + engine). */
export const CAPTION_PRESETS: Record<Exclude<CaptionPreset, "custom">, string> = {
  hype: "{title}\n\n🔴 LIVE on Whatnot — come say hi! @{username}\n{hashtags}",
  chill: "{title}\n\nMore where this came from — @{username} on Whatnot\n{hashtags}",
  minimal: "{title}\n{hashtags}",
};

export function isCaptionPreset(v: string): v is CaptionPreset {
  return v === "hype" || v === "chill" || v === "minimal" || v === "custom";
}

/** The slice of a seller either config.ts (UserConfig) or db.ts (Account) satisfies. */
export interface CaptionUser {
  whatnotUsername: string;
  captionTemplate?: string;
  captionPreset?: string;
  hashtags?: string[];
}

/** The template that actually applies: the chosen preset, or the user's own. */
export function effectiveTemplate(user: CaptionUser): string {
  const p = user.captionPreset;
  if (p && p !== "custom" && p in CAPTION_PRESETS) {
    return CAPTION_PRESETS[p as Exclude<CaptionPreset, "custom">];
  }
  return user.captionTemplate ?? "{title}\n\n{hashtags}";
}

/** Fill a template's tokens. Shared by the engine and the settings preview cards. */
export function renderTemplate(
  template: string,
  vars: { title: string; username: string; hashtags: string[] }
): string {
  const hashtags = vars.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  let out = template
    .replaceAll("{title}", vars.title)
    .replaceAll("{hashtags}", hashtags)
    .replaceAll("{username}", vars.username);
  // Instagram caption hard limit is 2200 chars; keep well under.
  if (out.length > 2200) out = out.slice(0, 2190) + "…";
  return out.trim();
}

export function buildCaption(meta: ClipMeta, user: CaptionUser): string {
  return renderTemplate(effectiveTemplate(user), {
    title: (meta.title ?? "").trim(),
    username: user.whatnotUsername,
    hashtags: user.hashtags ?? [],
  });
}
