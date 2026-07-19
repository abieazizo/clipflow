/**
 * thumbstore.ts — per-account records of generated thumbnails.
 * One JSON file per account (<WN_DATA_DIR>/thumbs-<accountId>.json); the PNG +
 * webp preview live in <WN_CLIPS_DIR>/thumbs/<id>.png|.webp (served by
 * /thumb-gen/:id after an ownership check against this store).
 *
 * Generation produces two throwaway *variations*; the seller keeps one and the
 * rest auto-purge after PURGE_HOURS so we never hoard discarded artwork.
 */

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { CoverRecipe } from "./gemini.js";

export interface ThumbRecord {
  id: string;        // uuid, also the PNG/webp filename
  clipId: string | null;
  subject: string;
  style: string;
  headline: string;
  badgeText?: string;         // the auto-detected price/offer badge (record only)
  heroWordIndex?: number | null; // tap-to-choose hero word, preserved for regen
  useClip?: boolean;          // whether the clip frame fed the collage
  layout?: string;            // "wall" | "poster"
  dateText?: string;          // optional date/time ribbon
  cutoutIds?: string[];       // product cutouts used in the collage (for regen)
  recipe?: CoverRecipe;       // clone-a-winner style recipe
  createdAt: string;
  kept: boolean;     // false = un-kept variation, eligible for auto-purge
}

const DATA_DIR = process.env.WN_DATA_DIR || "./data";
const CLIPS_DIR = process.env.WN_CLIPS_DIR || "./clips";
const PURGE_HOURS = 24;

export function thumbsDir(): string {
  return join(CLIPS_DIR, "thumbs");
}

export function thumbPngPath(id: string): string {
  return join(thumbsDir(), `${id}.png`);
}

export function thumbWebpPath(id: string): string {
  return join(thumbsDir(), `${id}.webp`);
}

// --- product cutouts (transparent PNGs used in the collage) ---
export function cutoutsDir(): string {
  return join(CLIPS_DIR, "thumbs", "cutouts");
}
export function cutoutPath(id: string): string {
  return join(cutoutsDir(), `${id}.png`);
}
function cutoutStorePath(accountId: string): string {
  return join(DATA_DIR, `cutouts-${accountId}.json`);
}
interface CutoutRec { id: string; createdAt: string }

export async function addCutout(accountId: string, id: string): Promise<void> {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  const all = await readCutouts(accountId);
  all.unshift({ id, createdAt: nowIso() });
  await writeFile(cutoutStorePath(accountId), JSON.stringify(all, null, 2), "utf8");
}
async function readCutouts(accountId: string): Promise<CutoutRec[]> {
  const p = cutoutStorePath(accountId);
  if (!existsSync(p)) return [];
  try { const raw = JSON.parse(await readFile(p, "utf8")); return Array.isArray(raw) ? raw : []; } catch { return []; }
}
/** Cutouts the account owns, purging any older than PURGE_HOURS. */
export async function listCutouts(accountId: string): Promise<string[]> {
  const all = await readCutouts(accountId);
  const cutoff = Date.parse(nowIso()) - PURGE_HOURS * 3600_000;
  const live = all.filter((c) => Date.parse(c.createdAt) >= cutoff);
  const dead = all.filter((c) => Date.parse(c.createdAt) < cutoff);
  if (dead.length) {
    await writeFile(cutoutStorePath(accountId), JSON.stringify(live, null, 2), "utf8");
    for (const c of dead) { try { await unlink(cutoutPath(c.id)); } catch { /* gone */ } }
  }
  return live.map((c) => c.id);
}
export async function ownsCutout(accountId: string, id: string): Promise<boolean> {
  return (await readCutouts(accountId)).some((c) => c.id === id);
}

function storePath(accountId: string): string {
  return join(DATA_DIR, `thumbs-${accountId}.json`);
}

async function writeStore(accountId: string, rows: ThumbRecord[]): Promise<void> {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(storePath(accountId), JSON.stringify(rows, null, 2), "utf8");
}

async function readStore(accountId: string): Promise<ThumbRecord[]> {
  const path = storePath(accountId);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(raw)) return [];
    // migrate legacy rows (missing kept/subject) — treat old thumbs as kept
    return (raw as any[]).map((r) => ({
      kept: r.kept ?? true,
      subject: r.subject ?? "",
      ...r,
    })) as ThumbRecord[];
  } catch {
    return [];
  }
}

/** Delete the PNG + webp for an id, ignoring already-gone files. */
async function unlinkFiles(id: string): Promise<void> {
  for (const p of [thumbPngPath(id), thumbWebpPath(id)]) {
    try { await unlink(p); } catch { /* already gone */ }
  }
}

/**
 * List an account's thumbnails (newest first), first purging un-kept variations
 * older than PURGE_HOURS. Purge writes back only when something was removed.
 */
export async function listThumbs(accountId: string): Promise<ThumbRecord[]> {
  const all = await readStore(accountId);
  const cutoff = Date.parse(nowIso()) - PURGE_HOURS * 3600_000;
  const live: ThumbRecord[] = [];
  const dead: string[] = [];
  for (const t of all) {
    const stale = !t.kept && Date.parse(t.createdAt) < cutoff;
    if (stale) dead.push(t.id);
    else live.push(t);
  }
  if (dead.length) {
    await writeStore(accountId, live);
    for (const id of dead) await unlinkFiles(id);
  }
  return live;
}

/** Kept thumbnails only — the gallery view. */
export async function listKept(accountId: string): Promise<ThumbRecord[]> {
  return (await listThumbs(accountId)).filter((t) => t.kept);
}

export async function getThumb(accountId: string, id: string): Promise<ThumbRecord | null> {
  return (await listThumbs(accountId)).find((t) => t.id === id) ?? null;
}

export async function addThumb(accountId: string, rec: ThumbRecord): Promise<void> {
  const all = await readStore(accountId);
  all.unshift(rec); // newest first
  await writeStore(accountId, all);
}

export async function ownsThumb(accountId: string, id: string): Promise<boolean> {
  return (await readStore(accountId)).some((t) => t.id === id);
}

/** Mark a variation kept; optionally discard the other un-kept siblings from the same batch. */
export async function keepThumb(accountId: string, id: string): Promise<boolean> {
  const all = await readStore(accountId);
  const row = all.find((t) => t.id === id);
  if (!row) return false;
  row.kept = true;
  await writeStore(accountId, all);
  return true;
}

export async function removeThumb(accountId: string, id: string): Promise<boolean> {
  const all = await readStore(accountId);
  const next = all.filter((t) => t.id !== id);
  if (next.length === all.length) return false;
  await writeStore(accountId, next);
  await unlinkFiles(id);
  return true;
}

/**
 * Number of *generate actions* since `sinceMs`. Both variations of one click
 * share a createdAt stamp, so distinct createdAt values = generations. Also
 * returns the oldest batch time in-window (for "resets in X hours").
 */
export async function countGenerationsSince(
  accountId: string,
  sinceMs: number
): Promise<{ count: number; oldestMs: number | null }> {
  const rows = (await readStore(accountId)).filter((t) => Date.parse(t.createdAt) >= sinceMs);
  const stamps = new Set(rows.map((t) => t.createdAt));
  let oldestMs: number | null = null;
  for (const s of stamps) {
    const ms = Date.parse(s);
    if (oldestMs === null || ms < oldestMs) oldestMs = ms;
  }
  return { count: stamps.size, oldestMs };
}

/** Remove the un-kept siblings of a just-kept variation (same batch, different id). */
export async function discardSiblings(accountId: string, keptId: string): Promise<void> {
  const all = await readStore(accountId);
  const kept = all.find((t) => t.id === keptId);
  if (!kept) return;
  const siblings = all.filter((t) => t.createdAt === kept.createdAt && !t.kept && t.id !== keptId);
  for (const s of siblings) await removeThumb(accountId, s.id);
}

// Date.now() is fine on the server (only the Workflow sandbox forbids it).
function nowIso(): string {
  return new Date().toISOString();
}
