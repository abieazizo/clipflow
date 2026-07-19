/**
 * engine.ts — the background worker behind the hosted app.
 *
 * Watch -> download -> post -> record, driven by SQLite: every clip/platform
 * pair is a row in the posts table (pending -> posted | failed), which is both
 * the dedupe and the user-visible history. Failures retry with backoff
 * (+2m/+10m/+30m/+2h, 4 attempts max) and surface in /history with a Retry
 * button. Accounts whose trial/subscription lapsed are skipped (paywall) —
 * their data is untouched, only posting pauses.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  listAccounts, isActive, updateAccount, logEvent,
  getPost as getPostRow, createPost, updatePost, listPosts,
  type Account, type PostRow,
} from "./db.js";
import { listClipIds, getClipMeta, type ClipMeta } from "./whatnot.js";
import { downloadFile, clipPaths } from "./download.js";
import { postEverywhere, type PlatformName } from "./poster.js";
import { getPost as zernioGetPost } from "./zernio.js";
import { loadAppSettings } from "./appconfig.js";
import { sendMail, postFailedEmail } from "./mailer.js";

const CLIPS_DIR = process.env.WN_CLIPS_DIR || "./clips";
const POLL_SECONDS = Number(process.env.WN_POLL_SECONDS || 300);
const MAX_PER_PASS = Number(process.env.WN_MAX_PER_PASS || 10);

/** Retry ladder: delay AFTER attempt N fails (1-indexed). 4 fails = final. */
const RETRY_DELAYS_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3600_000];
export const MAX_ATTEMPTS = 4;
/** Give up polling a Zernio post that never reaches published/failed. */
const IN_FLIGHT_MAX_AGE_MS = 6 * 3600_000;

export function clipsDir(): string {
  return CLIPS_DIR;
}

/** One row of the dashboard's Recent Clips grid (derived from posts rows). */
export interface ClipRow {
  clipId: string;
  title: string | null;
  downloadedAt: string;
  instagram: boolean;
  tiktok: boolean;
  tiktokDraft: boolean;
  hasThumb: boolean;
}

/** Newest-first clips for one account, grouped from the posts table. */
export async function recentClips(acct: Account, limit = 60): Promise<ClipRow[]> {
  const rows = listPosts(acct.id, 400);
  const byClip = new Map<string, ClipRow>();
  for (const r of rows) {
    let c = byClip.get(r.clipId);
    if (!c) {
      c = {
        clipId: r.clipId,
        title: r.clipTitle,
        downloadedAt: r.createdAt,
        instagram: false,
        tiktok: false,
        tiktokDraft: false,
        hasThumb: existsSync(join(CLIPS_DIR, `${r.clipId}.webp`)),
      };
      byClip.set(r.clipId, c);
    }
    if (r.platform === "instagram" && r.status === "posted") c.instagram = true;
    if (r.platform === "tiktok" && r.status === "posted") {
      c.tiktok = true;
      if (r.via === "draft") c.tiktokDraft = true;
    }
    if (r.createdAt < c.downloadedAt) c.downloadedAt = r.createdAt;
  }
  return [...byClip.values()]
    .sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt))
    .slice(0, limit);
}

function log(...a: unknown[]) {
  console.log(`[${new Date().toISOString()}] engine:`, ...a);
}

const label: Record<PlatformName, string> = { instagram: "IG", tiktok: "TikTok" };

function scheduleRetryOrFail(row: PostRow, error: string, uname: string): void {
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    updatePost(row.id, { status: "failed", attempts, error, nextRetryAt: null, zernioPostId: null });
    log(`@${uname}: ${label[row.platform]} FAILED for good (${attempts} attempts) — ${error}`);
  } else {
    const delay = RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    const nextRetryAt = new Date(Date.now() + delay).toISOString();
    updatePost(row.id, { attempts, error, nextRetryAt, zernioPostId: null });
    log(`@${uname}: ${label[row.platform]} failed (attempt ${attempts}/${MAX_ATTEMPTS}) — ${error} — retry after ${nextRetryAt}`);
  }
}

/** Counts returned to the manual "Check for clips" caller. */
export interface PassSummary { found: number; queued: number; alreadyPosted: number }

async function processAccount(acct: Account, opts: { retriesOnly?: boolean } = {}): Promise<PassSummary> {
  const uname = acct.whatnotUsername;
  const summary: PassSummary = { found: 0, queued: 0, alreadyPosted: 0 };

  let ids: string[];
  if (opts.retriesOnly) {
    // Manual mode's polling pass: DON'T discover new clips — only revisit clips
    // that already have a due retry or an in-flight Zernio post (finishing work
    // the seller already started).
    const now = Date.now();
    const due = listPosts(acct.id, 400).filter((p) =>
      p.status === "pending" && (p.zernioPostId || !p.nextRetryAt || new Date(p.nextRetryAt).getTime() <= now));
    ids = [...new Set(due.map((p) => p.clipId))];
    if (ids.length === 0) return summary;
  } else {
    // A full check touches Whatnot — stamp lastCheckedAt even if discovery fails.
    await updateAccount(acct.id, { lastCheckedAt: new Date().toISOString() });
    let listed: string[] = [];
    try {
      listed = await listClipIds(uname);
    } catch (e) {
      log(`@${uname}: could not read clips page: ${(e as Error).message}`);
      // Don't bail — a due retry on an older clip still needs finishing even
      // when the listing is momentarily unreadable.
    }
    // Union the listing with clips that have a DUE retry or an in-flight post.
    // Without this, a failed retry on a clip that has scrolled off the Whatnot
    // clips page would stall forever (its retry ladder never advances).
    const now = Date.now();
    const dueRetryIds = listPosts(acct.id, 400)
      .filter((p) => p.status === "pending" && (p.zernioPostId || !p.nextRetryAt || new Date(p.nextRetryAt).getTime() <= now))
      .map((p) => p.clipId);
    ids = [...new Set([...listed, ...dueRetryIds])];
    if (ids.length === 0) return summary;
  }

  const connected: PlatformName[] = [];
  if (acct.instagram) connected.push("instagram");
  if (acct.tiktok) connected.push("tiktok");

  let handled = 0;
  for (const clipId of ids) {
    if (handled >= MAX_PER_PASS) break;
    if (connected.length === 0) continue;

    // Rows for this clip (created lazily below once the clip is confirmed public).
    const rows = new Map<PlatformName, PostRow | null>();
    for (const p of connected) rows.set(p, getPostRow(acct.id, clipId, p));

    const now = Date.now();
    const needsWork = connected.some((p) => {
      const r = rows.get(p);
      if (!r) return true; // never seen
      if (r.status !== "pending") return false;
      if (r.zernioPostId) return true; // in-flight check
      return !r.nextRetryAt || new Date(r.nextRetryAt).getTime() <= now;
    });
    if (!needsWork) {
      if (connected.every((p) => rows.get(p)?.status === "posted")) summary.alreadyPosted++;
      continue;
    }

    let meta: ClipMeta;
    try {
      meta = await getClipMeta(clipId);
    } catch (e) {
      log(`@${uname}: clip ${clipId} unreadable: ${(e as Error).message}`);
      continue;
    }
    if (!meta.mp4Url) continue; // not published/public yet
    summary.found++; // a public clip we're acting on this pass

    // Download once (dashboard thumbnail + archive).
    const paths = clipPaths(CLIPS_DIR, clipId);
    if (!existsSync(paths.mp4)) {
      try {
        const bytes = await downloadFile(meta.mp4Url, paths.mp4);
        if (meta.thumbnailUrl) {
          try { await downloadFile(meta.thumbnailUrl, paths.webp); } catch {}
        }
        log(`@${uname}: downloaded ${clipId} ${(bytes / 1e6).toFixed(1)}MB "${meta.title ?? ""}"`);
      } catch (e) {
        log(`@${uname}: download failed ${clipId}: ${(e as Error).message}`);
        // posting can still proceed — Zernio fetches the signed URL itself
      }
    }

    // Ensure a row per connected platform.
    for (const p of connected) {
      if (!rows.get(p)) {
        rows.set(p, createPost({
          accountId: acct.id, clipId, clipTitle: meta.title, platform: p,
          status: "pending", zernioPostId: null, via: null, error: null,
          attempts: 0, nextRetryAt: null, postedAt: null,
        }));
      } else if (meta.title && !rows.get(p)!.clipTitle) {
        updatePost(rows.get(p)!.id, { clipTitle: meta.title });
      }
    }

    // Phase 1 — rows with an in-flight Zernio post: check its REAL status.
    const stillToPost: PlatformName[] = [];
    for (const p of connected) {
      const row = rows.get(p)!;
      if (row.status !== "pending") continue;
      if (!row.zernioPostId) {
        const due = !row.nextRetryAt || new Date(row.nextRetryAt).getTime() <= now;
        if (due) stillToPost.push(p);
        continue;
      }
      const st = await zernioGetPost(row.zernioPostId);
      if (!st.ok) continue; // transient — check next pass
      const entry = st.data.platforms.find((e) => e.platform === p);
      if (entry?.status === "published") {
        updatePost(row.id, { status: "posted", postedAt: new Date().toISOString(), error: null, nextRetryAt: null });
        log(`@${uname}: ${label[p]} ok — published${entry.url ? ` — ${entry.url}` : ""}`);
      } else if (entry?.status === "failed") {
        scheduleRetryOrFail(row, entry.error ?? "platform publish failed", uname);
      } else if (Date.now() - new Date(row.createdAt).getTime() > IN_FLIGHT_MAX_AGE_MS) {
        // Zernio has been sitting in a non-terminal state too long — stop
        // re-polling it forever and surface it as a failure.
        updatePost(row.id, { status: "failed", error: "Zernio never confirmed this publish — timed out.", nextRetryAt: null, zernioPostId: null });
        log(`@${uname}: ${label[p]} in-flight timeout (post ${row.zernioPostId}) — marked failed`);
      } else {
        log(`@${uname}: ${label[p]} still publishing (post ${row.zernioPostId})`);
      }
    }

    // Phase 2 — create posts for the due platforms.
    if (stillToPost.length > 0) {
      const outcome = await postEverywhere(meta, acct, stillToPost);
      for (const p of stillToPost) {
        const row = getPostRow(acct.id, clipId, p)!;
        const r = outcome[p];
        if (!r.attempted) continue;
        summary.queued++;
        if (r.ok) {
          updatePost(row.id, {
            status: "posted", postedAt: new Date().toISOString(),
            zernioPostId: r.postId ?? null, via: r.draft ? "draft" : "direct",
            error: null, nextRetryAt: null, attempts: row.attempts + 1,
          });
          log(`@${uname}: ${label[p]} ok — ${r.detail}`);
        } else if (r.pending && r.postId) {
          updatePost(row.id, { zernioPostId: r.postId, via: r.draft ? "draft" : "direct" });
          log(`@${uname}: ${label[p]} publishing — will confirm next pass (post ${r.postId})`);
        } else {
          scheduleRetryOrFail(row, r.detail, uname);
        }
      }
    }

    handled++;
  }

  await maybeSendFailureDigest(acct);
  return summary;
}

/** At most one failure email per 24h per account, covering all final failures. */
async function maybeSendFailureDigest(acct: Account): Promise<void> {
  const failed = listPosts(acct.id, 200).filter((p) => p.status === "failed");
  if (failed.length === 0) return;
  const last = acct.lastFailureEmailAt ? new Date(acct.lastFailureEmailAt).getTime() : 0;
  if (Date.now() - last < 24 * 3600_000) return;
  const fresh = failed.filter((p) => new Date(p.createdAt).getTime() > last);
  if (fresh.length === 0) return;
  const base = loadAppSettings().baseUrl;
  await sendMail(postFailedEmail(acct.email, fresh.length, `${base}/history`));
  await updateAccount(acct.id, { lastFailureEmailAt: new Date().toISOString() });
}

// Per-account in-flight lock: a manual check and a polling pass (or two rapid
// clicks) can never run two passes for the same account at once.
const inFlight = new Set<string>();

async function runAccount(acct: Account, opts: { retriesOnly?: boolean } = {}): Promise<PassSummary | { busy: true }> {
  if (inFlight.has(acct.id)) return { busy: true };
  inFlight.add(acct.id);
  try {
    return await processAccount(acct, opts);
  } finally {
    inFlight.delete(acct.id);
  }
}

/**
 * Run a full check for ONE account right now (the manual "Check for clips"
 * button). Returns { busy:true } if a pass for this account is already running.
 */
export async function checkAccount(acct: Account): Promise<PassSummary | { busy: true }> {
  return runAccount(acct, { retriesOnly: false });
}

async function onePass(): Promise<void> {
  const stripeConfigured = loadAppSettings().stripeConfigured;
  const candidates = listAccounts().filter((a) => a.whatnotUsername);
  for (const acct of candidates) {
    if (!acct.enabled) {
      log(`@${acct.whatnotUsername}: paused — skipped (nothing checks or posts until resumed)`);
      continue;
    }
    if (!isActive(acct, stripeConfigured)) {
      log(`@${acct.whatnotUsername}: skipped — ${acct.disabled ? "disabled by admin" : "no card on file (locked)"} (data untouched)`);
      continue;
    }
    if (acct.postingMode === "auto") {
      await runAccount(acct, { retriesOnly: false });
    } else {
      // Manual: auto-posting is off. Still finish already-started work (due
      // retries / in-flight posts) — the exception to manual mode.
      log(`@${acct.whatnotUsername}: manual mode — auto-post skipped (due retries still run)`);
      await runAccount(acct, { retriesOnly: true });
    }
  }
}

// ---------------------------------------------------------------------------
// loop + status
// ---------------------------------------------------------------------------

let running = false;
let startedAt: string | null = null;
let lastPassAt: string | null = null;
let lastPassMs: number | null = null;
let passCount = 0;

export function engineStatus() {
  const last = lastPassAt ? new Date(lastPassAt).getTime() : null;
  return {
    running,
    startedAt,
    lastPassAt,
    lastPassMs,
    passCount,
    pollSeconds: POLL_SECONDS,
    nextPassAt: last !== null ? new Date(last + (lastPassMs ?? 0) + POLL_SECONDS * 1000).toISOString() : null,
    dryRun: process.env.WN_DRY_RUN === "1" || process.env.WN_DRY_RUN === "true",
  };
}

export function startEngine(): void {
  if (running) return;
  running = true;
  startedAt = new Date().toISOString();
  const dryRun = process.env.WN_DRY_RUN === "1" || process.env.WN_DRY_RUN === "true";
  log(`watching every ${POLL_SECONDS}s${dryRun ? " [DRY RUN]" : ""}`);
  (async () => {
    for (;;) {
      const began = Date.now();
      lastPassAt = new Date(began).toISOString();
      try {
        await onePass();
      } catch (e) {
        log(`pass error: ${(e as Error).message}`);
      }
      lastPassMs = Date.now() - began;
      passCount++;
      await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
    }
  })();
}
