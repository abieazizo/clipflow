/**
 * check-zernio.ts — prove the Zernio wiring is correct WITHOUT a real key.
 *   npm run check:zernio
 *
 * Runs zernio.ts in dry-run mode (no network): prints the connect URL that
 * /connect/:platform will redirect to and the exact POST /posts payload the
 * poster will send, so both can be eyeballed. Exits 1 if any structural check
 * fails.
 */

import "./env.js";

process.env.WN_DRY_RUN = "1"; // force dry-run: log payloads, no network

import { loadAppSettings } from "./appconfig.js";
import * as zernio from "./zernio.js";

let failures = 0;

function check(label: string, ok: boolean): void {
  console.log(`      ${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  const s = loadAppSettings();
  console.log("\n  ClipFlow — Zernio wiring check (dry-run, no network)");
  console.log("  =====================================================\n");

  // ---- connect URLs ----
  for (const platform of ["instagram", "tiktok"] as const) {
    const redirect = `${s.baseUrl}/connect/${platform}/callback`;
    const r = await zernio.startConnect("PROFILE_ID", platform, redirect);
    console.log(`\n  ${platform} connect target:`);
    if (!r.ok) {
      console.log(`      ❌ startConnect failed: ${r.error}`);
      failures++;
      continue;
    }
    console.log(`  ${r.data}\n`);
    const u = new URL(r.data);
    check("host is zernio.com", u.hostname === "zernio.com");
    check(`path is /api/v1/connect/${platform}`, u.pathname === `/api/v1/connect/${platform}`);
    check("carries profileId", u.searchParams.get("profileId") === "PROFILE_ID");
    check(`redirect_url matches BASE_URL (${redirect})`, u.searchParams.get("redirect_url") === redirect);
  }

  // ---- post payload ----
  console.log("\n  POST /posts payload (sample clip, both targets):\n");
  const r = await zernio.post({
    caption: "🔥 $1 SQUISHIES ALL NIGHT\n\n#whatnot #live",
    videoUrl: "https://s3ntry.whatnot.com/whatnot-klippy/sample/1700000000-1700000034.mp4?Key-Pair-Id=SAMPLE",
    targets: [
      { platform: "instagram", accountId: "IG_ACCOUNT_ID" },
      { platform: "tiktok", accountId: "TT_ACCOUNT_ID" },
    ],
  });
  check("post() returned ok in dry-run", r.ok);

  console.log("");
  if (failures > 0) {
    console.log(`  ❌ ${failures} check(s) failed.\n`);
    process.exit(1);
  }
  console.log("  ✅ All Zernio wiring checks passed.\n");
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
