/**
 * download.ts — pulls the signed MP4 to disk.
 * The signed URL expires, so this runs immediately after a clip is discovered.
 *
 * Uses node:https (not undici) for the same reason as whatnot.ts: Whatnot's
 * WAF 403s requests whose header names aren't Title-Case like a real browser's.
 */

import https from "node:https";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const HEADERS = {
  "User-Agent": UA,
  "Referer": "https://www.whatnot.com/",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "video",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "same-site",
};

function getStream(url: string, hops = 0): Promise<import("node:http").IncomingMessage> {
  return new Promise((resolvePromise, reject) => {
    const req = https.request(url, { method: "GET", headers: HEADERS }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 301 && status <= 308 && res.headers.location && hops < 3) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        getStream(next, hops + 1).then(resolvePromise, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`download ${url} -> HTTP ${status}`));
        return;
      }
      resolvePromise(res);
    });
    req.on("error", reject);
    req.end();
  });
}

export async function downloadFile(url: string, destPath: string): Promise<number> {
  const dir = destPath.substring(0, destPath.lastIndexOf("/"));
  if (dir && !existsSync(dir)) await mkdir(dir, { recursive: true });

  const res = await getStream(url);
  const out = createWriteStream(destPath);
  await pipeline(res, out);

  const len = res.headers["content-length"];
  return len ? Number(Array.isArray(len) ? len[0] : len) : 0;
}

export function clipPaths(clipsDir: string, clipId: string) {
  return {
    mp4: join(clipsDir, `${clipId}.mp4`),
    webp: join(clipsDir, `${clipId}.webp`),
  };
}
