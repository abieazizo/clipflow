/**
 * doctor.ts — readiness checklist. Run any time to confirm your config loaded:
 *   npm run doctor
 *
 * Reads .env (via env.js) exactly like the app does, then prints ✅/❌ for the
 * Zernio key, the server port/base URL, and the connect callback URLs. No
 * network calls, no secrets printed — just what's configured and what's pending.
 */

import "./env.js";
import { loadAppSettings } from "./appconfig.js";

function tick(ok: boolean): string {
  return ok ? "✅" : "❌";
}

function main(): void {
  const s = loadAppSettings();
  const lines: string[] = [];

  lines.push("");
  lines.push("  ClipFlow — readiness check");
  lines.push("  ══════════════════════════");
  lines.push("");
  lines.push(`  ${tick(true)}  Server port          ${s.port}`);
  lines.push(`  ${tick(true)}  Base URL             ${s.baseUrl}`);
  lines.push(
    `  ${tick(!s.sessionSecretEphemeral)}  SESSION_SECRET       ${
      s.sessionSecretEphemeral
        ? "blank → auto-generated (sessions reset on restart; fine for dev)"
        : "set"
    }`
  );
  lines.push(`  ${tick(s.baseUrl.startsWith("https:"))}  HTTPS base URL       ${
    s.baseUrl.startsWith("https:") ? "yes (Secure cookies on)" : "http — fine locally; use https in production"
  }`);
  lines.push("");
  lines.push(`  ${tick(s.zernioConfigured)}  Zernio               ${s.zernioConfigured ? "configured" : "MISSING ZERNIO_API_KEY"}`);
  lines.push(`  ${tick(s.geminiConfigured)}  Gemini               ${s.geminiConfigured ? "configured (thumbnail studio unlocked)" : "no GEMINI_API_KEY — thumbnail studio locked (optional)"}`);
  lines.push(`  ${tick(s.stripeConfigured)}  Stripe               ${s.stripeConfigured ? "configured (card-first, 1-week free trial)" : "no STRIPE_SECRET_KEY / STRIPE_PRICE_ID — posting unlocked for all (dev mode)"}`);
  lines.push(`  ${tick(s.mailConfigured)}  Email (Resend)       ${s.mailConfigured ? "configured" : "no RESEND_API_KEY — emails print to the console (dev mode)"}`);
  lines.push(`  ${tick(Boolean(process.env.ADMIN_EMAIL))}  ADMIN_EMAIL          ${process.env.ADMIN_EMAIL ? "set — that account gets /admin" : "unset — no admin account"}`);

  // Secrets hygiene: warn on placeholder-looking values (never print them).
  const placeholderish = (v: string) => /your[_-]?key|paste|replace|example|xxxx|<|>/i.test(v);
  if (s.zernioApiKey && (placeholderish(s.zernioApiKey) || !s.zernioApiKey.startsWith("sk_"))) {
    lines.push("  ⚠️   ZERNIO_API_KEY looks like a placeholder (expected sk_…) — double-check it.");
  }
  if (s.geminiApiKey && placeholderish(s.geminiApiKey)) {
    lines.push("  ⚠️   GEMINI_API_KEY looks like a placeholder — double-check it.");
  }
  lines.push("");
  lines.push("  Connect URLs (Zernio sends sellers back to the callbacks)");
  lines.push("  ----------------------------------------------------------");
  lines.push(`  Instagram connect:   ${s.baseUrl}/connect/instagram`);
  lines.push(`  Instagram callback:  ${s.instagramRedirectUri}`);
  lines.push(`  TikTok connect:      ${s.baseUrl}/connect/tiktok`);
  lines.push(`  TikTok callback:     ${s.tiktokRedirectUri}`);
  lines.push("");

  if (s.zernioConfigured) {
    lines.push("  ✅  Zernio configured. Restart `npm run app` and connect from the dashboard.");
  } else {
    lines.push("  ⏳  Not configured yet. Get an API key from the Zernio dashboard (zernio.com),");
    lines.push("      paste it into .env as ZERNIO_API_KEY, then re-run `npm run doctor`.");
    lines.push("      Until then the dashboard shows Connect disabled.");
  }
  lines.push("");

  console.log(lines.join("\n"));
}

main();
