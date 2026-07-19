/**
 * poster.ts — publishes one clip via Zernio and reports the REAL per-platform
 * outcome. Zernio accepting the post (201) is not success: each platform
 * publish is async and can fail on its own (e.g. TikTok's daily quota). So
 * after creating the post we poll GET /posts/{id} briefly and classify every
 * target platform as published / failed / still-pending. The engine records
 * pending post ids and re-checks them next pass instead of re-posting.
 *
 * The video is passed as the Whatnot *signed* MP4 URL — publicly fetchable, so
 * Zernio downloads it server-side. No local upload. The URL expires, which is
 * why the engine posts immediately after discovery.
 */

import type { ClipMeta } from "./whatnot.js";
import type { Account } from "./db.js";
import { buildCaption } from "./caption.js";
import * as zernio from "./zernio.js";

export type PlatformName = "instagram" | "tiktok";

export interface PlatformResult {
  attempted: boolean;
  /** platform CONFIRMED the publish */
  ok: boolean;
  /** publish still in flight — re-check postId later, do NOT re-post */
  pending: boolean;
  /** the Zernio post id covering this platform (set when attempted) */
  postId?: string;
  /** TikTok only: delivered to the seller's inbox (tap-to-post), not the profile */
  draft?: boolean;
  detail: string;
}

export interface PostOutcome {
  instagram: PlatformResult;
  tiktok: PlatformResult;
}

const notAttempted = (): PlatformResult => ({
  attempted: false, ok: false, pending: false, detail: "not connected",
});

/** How long to wait for platforms to confirm before handing off to the engine. */
const VERIFY_POLLS = 4;
const VERIFY_INTERVAL_MS = 10_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Publish to the given platforms (defaults to every connected one).
 * Pass `only` to retry a subset, e.g. just the platform that failed.
 */
export async function postEverywhere(
  meta: ClipMeta,
  acct: Account,
  only?: PlatformName[]
): Promise<PostOutcome> {
  const outcome: PostOutcome = { instagram: notAttempted(), tiktok: notAttempted() };

  const want = (p: PlatformName) => !only || only.includes(p);
  const targets: zernio.PostTarget[] = [];
  if (acct.instagram && want("instagram")) targets.push({ platform: "instagram", accountId: acct.instagram.accountId });
  if (acct.tiktok && want("tiktok")) targets.push({ platform: "tiktok", accountId: acct.tiktok.accountId });
  if (targets.length === 0) return outcome;

  const fail = (detail: string): PlatformResult => ({ attempted: true, ok: false, pending: false, detail });

  if (!meta.mp4Url) {
    for (const t of targets) outcome[t.platform] = fail("clip has no public MP4 URL yet");
    return outcome;
  }

  const caption = buildCaption(meta, acct);
  const r = await zernio.post({ caption, videoUrl: meta.mp4Url, targets });

  if (!r.ok) {
    // Zernio 409 = this exact content already posted to the account within
    // 24h. Treat as done: retrying would eventually push a real duplicate.
    const duplicate = r.status === 409;
    for (const t of targets) {
      outcome[t.platform] = duplicate
        ? { attempted: true, ok: true, pending: false, detail: "already on the account (Zernio duplicate protection)" }
        : fail(r.error);
    }
    return outcome;
  }

  const postId = r.data.postId;
  for (const t of targets) {
    outcome[t.platform] = { attempted: true, ok: false, pending: true, postId, detail: "publishing…" };
  }
  if (postId.startsWith("dryrun")) {
    for (const t of targets) outcome[t.platform] = { attempted: true, ok: true, pending: false, postId, detail: "DRY RUN — payload logged" };
    return outcome;
  }

  // Poll briefly so fast publishes resolve within this pass.
  for (let i = 0; i < VERIFY_POLLS; i++) {
    await sleep(VERIFY_INTERVAL_MS);
    const st = await zernio.getPost(postId);
    if (!st.ok) continue; // transient read error — stays pending, engine re-checks
    let unresolved = false;
    for (const t of targets) {
      const entry = st.data.platforms.find((p) => p.platform === t.platform);
      if (!entry) { unresolved = true; continue; }
      if (entry.status === "published") {
        outcome[t.platform] = { attempted: true, ok: true, pending: false, postId, detail: `published${entry.url ? ` — ${entry.url}` : ""}` };
      } else if (entry.status === "failed") {
        outcome[t.platform] = { attempted: true, ok: false, pending: false, postId, detail: entry.error ?? "platform publish failed" };
      } else {
        unresolved = true;
      }
    }
    if (!unresolved) break;
  }

  // TikTok quota fallback: direct publish is quota-capped for third-party
  // apps, but the inbox/draft endpoint is separate — deliver there instead so
  // the clip still reaches the seller today (they tap once in the app).
  const tt = outcome.tiktok;
  if (tt.attempted && !tt.ok && !tt.pending && /quota|too many posts/i.test(tt.detail)) {
    outcome.tiktok = await deliverTiktokDraft(meta, acct, caption, tt.detail);
  }

  return outcome;
}

async function deliverTiktokDraft(
  meta: ClipMeta,
  acct: Account,
  caption: string,
  directError: string
): Promise<PlatformResult> {
  const failed: PlatformResult = { attempted: true, ok: false, pending: false, detail: directError };
  if (!acct.tiktok || !meta.mp4Url) return failed;

  const r = await zernio.post({
    caption,
    videoUrl: meta.mp4Url,
    targets: [{ platform: "tiktok", accountId: acct.tiktok.accountId }],
    tiktokMode: "draft",
  });
  if (!r.ok) {
    return { ...failed, detail: `${directError}; draft fallback also failed: ${r.error}` };
  }
  const postId = r.data.postId;
  if (postId.startsWith("dryrun")) {
    return { attempted: true, ok: true, pending: false, postId, draft: true, detail: "DRY RUN — draft payload logged" };
  }
  for (let i = 0; i < VERIFY_POLLS; i++) {
    await sleep(VERIFY_INTERVAL_MS);
    const st = await zernio.getPost(postId);
    if (!st.ok) continue;
    const entry = st.data.platforms.find((p) => p.platform === "tiktok");
    if (entry?.status === "published") {
      return {
        attempted: true, ok: true, pending: false, postId, draft: true,
        detail: "quota hit — delivered to TikTok inbox instead (tap to post in the app)",
      };
    }
    if (entry?.status === "failed") {
      return { ...failed, postId, detail: `${directError}; draft fallback failed: ${entry.error ?? "unknown"}` };
    }
  }
  // Draft still processing — hand the id to the engine to confirm next pass.
  return { attempted: true, ok: false, pending: true, postId, draft: true, detail: "draft delivery in flight" };
}
