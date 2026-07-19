/**
 * whatnot.ts — the proven core.
 *
 * Everything here was verified by hand against live Whatnot data before it was written:
 *  - A seller's public clips page lists /clip/<uuid> links in the raw HTML (no login).
 *  - Each clip page embeds a CloudFront **signed** MP4 URL in the raw HTML (no login).
 *    The signature IS the permission; it has an expiry, so we download promptly.
 *  - Clips are 720x1280 (vertical 9:16), with a matching .webp thumbnail and a title.
 *
 * No browser, no auth, no cookies. Plain HTTPS GET with a browser-like UA + Referer.
 */

import https from "node:https";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Whatnot's WAF rejects requests that don't look like a real browser: it wants
// the modern fetch-metadata headers AND Title-Case header names (undici
// lowercases everything -> 403, which is why this module uses node:https).
const COMMON_HEADERS = {
  "User-Agent": UA,
  "Referer": "https://www.whatnot.com/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

export interface ClipMeta {
  clipId: string;
  clipPageUrl: string;
  title: string | null;
  mp4Url: string | null; // full signed URL, ready to download
  thumbnailUrl: string | null; // signed .webp
  /** clip time window parsed from filename: unix start/end seconds of the show slice */
  startEpoch: number | null;
  endEpoch: number | null;
}

function getText(url: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const req = https.request(url, { method: "GET", headers: COMMON_HEADERS }, (res) => {
      const status = res.statusCode ?? 0;
      // Follow one hop of redirect (Whatnot occasionally 301s user pages).
      if (status >= 301 && status <= 308 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        getText(next).then(resolvePromise, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`GET ${url} -> HTTP ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

/** Fetch a small binary (avatar) with the same browser fingerprint. */
export function getBinary(url: string, maxBytes = 1_500_000): Promise<{ buf: Buffer; contentType: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = https.request(url, { method: "GET", headers: { ...COMMON_HEADERS, "Sec-Fetch-Dest": "image", "Accept": "image/*" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 301 && status <= 308 && res.headers.location) {
        res.resume();
        getBinary(new URL(res.headers.location, url).toString(), maxBytes).then(resolvePromise, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`GET ${url} -> HTTP ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); reject(new Error("image too large")); return; }
        chunks.push(c);
      });
      res.on("end", () => resolvePromise({
        buf: Buffer.concat(chunks),
        contentType: String(res.headers["content-type"] ?? "image/jpeg").split(";")[0],
      }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

export interface WhatnotProfile {
  exists: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Does this Whatnot user exist, and what do they look like?
 * Real profiles are 200 with og:image (avatar) and a
 * "Profile · <username> · <Display Name> · Whatnot…" title; unknowns are 404.
 */
export async function getProfile(username: string): Promise<WhatnotProfile> {
  const url = `https://www.whatnot.com/user/${encodeURIComponent(username)}`;
  let html: string;
  try {
    html = await getText(url);
  } catch (e) {
    if (/HTTP 404/.test((e as Error).message)) return { exists: false, displayName: null, avatarUrl: null };
    throw e; // 403/timeout etc. — caller treats as "couldn't check", not "fake"
  }
  const og = (prop: string): string | null => {
    const a = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i"));
    if (a) return decodeHtml(a[1]);
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, "i"));
    return b ? decodeHtml(b[1]) : null;
  };
  // title: "Profile · squishycrew · Squishy Crew · Whatnot: …"
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
  const parts = decodeHtml(title).split("·").map((s) => s.trim());
  const displayName = parts.length >= 3 && parts[0].toLowerCase().startsWith("profile") ? parts[2] : null;
  const avatarUrl = og("image");
  return {
    exists: true,
    displayName: displayName || null,
    avatarUrl: avatarUrl && /^https:\/\/[a-z0-9.-]*whatnot\.com\//i.test(avatarUrl) ? avatarUrl : null,
  };
}

/** Pull the distinct clip UUIDs from a seller's public clips page, in page order. */
export async function listClipIds(username: string): Promise<string[]> {
  const url = `https://www.whatnot.com/user/${encodeURIComponent(username)}/clips`;
  const html = await getText(url);
  const re = /\/clip\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of html.matchAll(re)) {
    const id = m[1].toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

/**
 * Extract the signed MP4 URL from a clip page's raw HTML.
 * The URL appears in JSON with escaped slashes (\u002F) and HTML-encoded ampersands (&amp;),
 * so we normalize both, then take the variant that carries the full signature.
 */
function extractSignedMp4(html: string): string | null {
  // Normalize the two escaping styles Whatnot uses in embedded JSON.
  const normalized = html
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

  // Match a klippy mp4 URL that includes the CloudFront signature params.
  const signedRe =
    /https:\/\/s3ntry\.whatnot\.com\/whatnot-klippy\/[^\s"'\\]+?\.mp4\?[^\s"'\\]*Key-Pair-Id=[A-Za-z0-9]+/g;
  const matches = [...normalized.matchAll(signedRe)].map((m) => m[0]);
  if (matches.length === 0) return null;
  // Prefer the longest (fully-signed) variant.
  matches.sort((a, b) => b.length - a.length);
  return matches[0];
}

function extractThumbnail(html: string): string | null {
  const normalized = html
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  const re =
    /https:\/\/s3ntry\.whatnot\.com\/whatnot-klippy\/[^\s"'\\]+?\.webp(\?[^\s"'\\]*)?/g;
  const matches = [...normalized.matchAll(re)].map((m) => m[0]);
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.length - a.length);
  return matches[0];
}

function extractTitle(html: string): string | null {
  // og:title is the clip's show title; fall back to <title>.
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeHtml(og[1]).trim();
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (t) return decodeHtml(t[1]).replace(/·\s*Whatnot.*$/i, "").trim();
  return null;
}

function parseEpochsFromMp4(mp4Url: string | null): { start: number | null; end: number | null } {
  if (!mp4Url) return { start: null, end: null };
  // filename pattern: <startEpoch>-<endEpoch>.mp4
  const m = mp4Url.match(/\/(\d{9,13})-(\d{9,13})\.mp4/);
  if (!m) return { start: null, end: null };
  return { start: Number(m[1]), end: Number(m[2]) };
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Fetch one clip page and pull everything we need out of it. */
export async function getClipMeta(clipId: string): Promise<ClipMeta> {
  const clipPageUrl = `https://www.whatnot.com/clip/${clipId}`;
  const html = await getText(clipPageUrl);
  const mp4Url = extractSignedMp4(html);
  const { start, end } = parseEpochsFromMp4(mp4Url);
  return {
    clipId,
    clipPageUrl,
    title: extractTitle(html),
    mp4Url,
    thumbnailUrl: extractThumbnail(html),
    startEpoch: start,
    endEpoch: end,
  };
}
