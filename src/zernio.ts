/**
 * zernio.ts — the posting backend. One integration replaces the old direct
 * Meta/TikTok OAuth + Graph/TikTok-API code: Zernio (docs.zernio.com) holds the
 * platform OAuth tokens and does the actual publishing; ClipFlow stores only
 * profile/account ids.
 *
 * Base: https://zernio.com/api/v1 · Auth: `Authorization: Bearer ZERNIO_API_KEY`
 *
 * Every function is throw-safe: it returns { ok: false, error } instead of
 * throwing, so the engine loop and request handlers never crash on API errors.
 *
 * Dry-run (WN_DRY_RUN=1): logs the exact payloads instead of calling Zernio.
 * Useful before an API key exists and for verifying the pipeline end-to-end.
 */

import { request } from "undici";
import { loadAppSettings } from "./appconfig.js";

const API_BASE = process.env.ZERNIO_API_BASE?.replace(/\/+$/, "") || "https://zernio.com/api/v1";

export type ZernioPlatform = "instagram" | "tiktok";

export interface ZernioAccount {
  accountId: string;
  platform: string;
  profileId: string;
  username?: string;
  displayName?: string;
  /** URL of the account's profile picture (IG/TikTok CDN — expires) */
  avatarUrl?: string;
}

export interface PostTarget {
  platform: ZernioPlatform;
  accountId: string;
}

export type ZernioResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

function dryRun(): boolean {
  return process.env.WN_DRY_RUN === "1" || process.env.WN_DRY_RUN === "true";
}

function log(...a: unknown[]) {
  console.log(`[${new Date().toISOString()}] zernio:`, ...a);
}

/** Low-level call: Bearer auth, JSON in/out, errors as values. */
async function api(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<ZernioResult<any>> {
  const key = loadAppSettings().zernioApiKey;
  if (!key) return { ok: false, error: "ZERNIO_API_KEY is not set" };
  try {
    const res = await request(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.body.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const detail = json?.error?.message ?? json?.error ?? json?.message ?? text.slice(0, 200);
      return { ok: false, error: `${method} ${path} -> HTTP ${res.statusCode}: ${detail}`, status: res.statusCode };
    }
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: `${method} ${path} failed: ${(e as Error).message}` };
  }
}

/** POST /profiles — one Zernio profile per ClipFlow seller. Returns its _id. */
export async function createProfile(name: string): Promise<ZernioResult<string>> {
  if (dryRun()) {
    log(`DRY RUN — POST /profiles`, JSON.stringify({ name }));
    return { ok: true, data: `dryrun-profile-${name.replace(/[^a-z0-9]/gi, "").slice(0, 12)}` };
  }
  const r = await api("POST", "/profiles", { name });
  if (!r.ok) return r;
  const id: string | undefined = r.data?.profile?._id ?? r.data?._id;
  if (!id) return { ok: false, error: `POST /profiles returned no _id: ${JSON.stringify(r.data).slice(0, 200)}` };
  return { ok: true, data: id };
}

/**
 * GET /connect/{platform}?profileId&redirect_url — begin the OAuth flow for a
 * seller's profile. Returns the URL to send the seller's browser to; after
 * they authorize, Zernio redirects them back to redirectUrl and the account
 * shows up in listAccounts().
 */
export async function startConnect(
  profileId: string,
  platform: ZernioPlatform,
  redirectUrl: string
): Promise<ZernioResult<string>> {
  const qs = `profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(redirectUrl)}`;
  const path = `/connect/${platform}?${qs}`;
  if (dryRun()) {
    log(`DRY RUN — GET ${API_BASE}${path}`);
    // In dry-run the request URL itself stands in for the OAuth URL so the
    // whole redirect chain can be exercised without an API key.
    return { ok: true, data: `${API_BASE}${path}` };
  }
  const r = await api("GET", path);
  if (!r.ok) return r;
  const url: string | undefined = r.data?.authUrl ?? r.data?.url;
  if (!url) return { ok: false, error: `GET /connect/${platform} returned no authUrl: ${JSON.stringify(r.data).slice(0, 200)}` };
  return { ok: true, data: url };
}

/** GET /accounts — every social account connected under this API key. */
export async function listAccounts(): Promise<ZernioResult<ZernioAccount[]>> {
  if (dryRun()) {
    log("DRY RUN — GET /accounts (returning [])");
    return { ok: true, data: [] };
  }
  const r = await api("GET", "/accounts");
  if (!r.ok) return r;
  const raw: any[] = Array.isArray(r.data) ? r.data : r.data?.accounts ?? r.data?.data ?? [];
  // profileId may arrive populated as an object ({_id, name, …}) — unwrap it.
  const idOf = (v: any): string =>
    typeof v === "string" ? v : v && typeof v === "object" ? String(v._id ?? "") : "";
  return {
    ok: true,
    data: raw.map((a) => ({
      accountId: idOf(a._id ?? a.accountId),
      platform: String(a.platform ?? ""),
      profileId: idOf(a.profileId),
      username: a.username ?? a.displayName ?? undefined,
      displayName: a.displayName ?? undefined,
      avatarUrl: a.profilePicture ?? a.profilePictureUrl ?? a.avatar ?? a.picture ?? undefined,
    })).filter((a) => a.accountId && a.platform),
  };
}

export interface PostInput {
  caption: string;
  /** Publicly fetchable MP4 URL — Zernio downloads it server-side. */
  videoUrl: string;
  targets: PostTarget[];
  /**
   * TikTok delivery mode. "direct" publishes straight to the profile (subject
   * to TikTok's strict third-party-API daily quota); "draft" delivers to the
   * seller's TikTok inbox — a different endpoint with its own limits — and
   * they tap once in the app to post. Used as the quota fallback.
   */
  tiktokMode?: "direct" | "draft";
}

/** TikTok legal-consent flags are mandatory either way. */
function tiktokSettings(mode: "direct" | "draft") {
  return mode === "draft"
    ? { draft: true, content_preview_confirmed: true, express_consent_given: true }
    : { privacy_level: "PUBLIC_TO_EVERYONE", content_preview_confirmed: true, express_consent_given: true };
}

export interface PostPlatformStatus {
  platform: string;
  /** e.g. "published" | "publishing" | "pending" | "failed" */
  status: string;
  error: string | null;
  url: string | null;
}

/**
 * GET /posts/{id} — the REAL per-platform outcome. Zernio accepting a post
 * (201) does not mean the platforms published it; each platform publish is
 * async and can fail on its own (quotas, processing errors).
 */
export async function getPost(
  postId: string
): Promise<ZernioResult<{ status: string; platforms: PostPlatformStatus[] }>> {
  if (dryRun() || postId.startsWith("dryrun")) {
    return { ok: true, data: { status: "published", platforms: [] } };
  }
  const r = await api("GET", `/posts/${encodeURIComponent(postId)}`);
  if (!r.ok) return r;
  const p = r.data?.post ?? r.data;
  const platforms: PostPlatformStatus[] = (p?.platforms ?? []).map((pl: any) => ({
    platform: String(pl.platform ?? ""),
    status: String(pl.status ?? ""),
    error: pl.error ?? pl.errorMessage ?? pl.failureReason ?? null,
    url: pl.platformPostUrl ?? null,
  }));
  return { ok: true, data: { status: String(p?.status ?? ""), platforms } };
}

/**
 * DELETE /accounts/{accountId} — disconnect + remove a connected social account
 * on Zernio (docs.zernio.com/accounts/delete-account: "Disconnects and removes a
 * connected social account"). A 404 means it's already gone, which is the same
 * end state we want, so it counts as success.
 */
export async function disconnectAccount(accountId: string): Promise<ZernioResult<null>> {
  if (!accountId) return { ok: false, error: "no accountId to disconnect" };
  if (dryRun()) {
    log(`DRY RUN — DELETE ${API_BASE}/accounts/${accountId}`);
    return { ok: true, data: null };
  }
  const r = await api("DELETE", `/accounts/${encodeURIComponent(accountId)}`);
  if (!r.ok) return r.status === 404 ? { ok: true, data: null } : r;
  return { ok: true, data: null };
}

/** POST /posts — one call publishes to every target platform at once. */
export async function post(input: PostInput): Promise<ZernioResult<{ postId: string }>> {
  const hasTiktok = input.targets.some((t) => t.platform === "tiktok");
  const payload = {
    content: input.caption,
    mediaItems: [{ type: "video", url: input.videoUrl }],
    platforms: input.targets.map((t) => ({ platform: t.platform, accountId: t.accountId })),
    publishNow: true,
    ...(hasTiktok ? { tiktokSettings: tiktokSettings(input.tiktokMode ?? "direct") } : {}),
  };
  if (dryRun()) {
    log("DRY RUN — POST /posts", JSON.stringify(payload, null, 2));
    return { ok: true, data: { postId: "dryrun-post" } };
  }
  const r = await api("POST", "/posts", payload);
  if (!r.ok) return r;
  const id: string = r.data?.post?._id ?? r.data?._id ?? "unknown";
  return { ok: true, data: { postId: id } };
}
