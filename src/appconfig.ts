/**
 * appconfig.ts — operator-level settings for the hosted web app (server.ts).
 *
 * Posting goes through Zernio (see zernio.ts): the operator sets one
 * ZERNIO_API_KEY and Zernio handles the Instagram/TikTok OAuth + publishing.
 * When the key is missing, the dashboard renders the Connect buttons DISABLED
 * ("Setup pending"), and /connect/:platform refuses to leave the app.
 *
 * Env (canonical name first, legacy fallback in parens):
 *   PORT            (CF_PORT)        web app port — Railway injects PORT     default 4400
 *   BASE_URL        (CF_BASE_URL)    public base URL for OAuth redirects     default http://localhost:<port>
 *   SESSION_SECRET  (CF_SESSION_SECRET)  HMAC secret; blank -> auto-generated (per-process)
 *   ZERNIO_API_KEY                   Zernio API key (zernio.com dashboard)
 *
 * Load order matters: import "./env.js" before calling loadAppSettings() so a
 * local .env is in process.env first.
 */

import { randomBytes } from "node:crypto";

/** Callback paths registered with Zernio's connect flow (single source of truth). */
export const INSTAGRAM_CALLBACK_PATH = "/connect/instagram/callback";
export const TIKTOK_CALLBACK_PATH = "/connect/tiktok/callback";

export interface AppSettings {
  port: number;
  baseUrl: string;
  sessionSecret: string;
  /** true when SESSION_SECRET was blank and we generated an ephemeral one */
  sessionSecretEphemeral: boolean;
  zernioApiKey: string;
  zernioConfigured: boolean;
  geminiApiKey: string;
  geminiConfigured: boolean;
  /** how many thumbnails a (non-admin) seller may generate per rolling 24h */
  thumbsPerDay: number;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  stripePriceId: string;
  stripeConfigured: boolean;
  stripeWebhookConfigured: boolean;
  mailConfigured: boolean;
  /** fully-qualified redirect URIs handed to Zernio's connect flow */
  instagramRedirectUri: string;
  tiktokRedirectUri: string;
}

/** First non-empty env var among the given names. */
function env(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

let cached: AppSettings | null = null;

export function loadAppSettings(): AppSettings {
  if (cached) return cached;

  const port = Number(env("PORT", "CF_PORT") || 4400);
  const baseUrl = (env("BASE_URL", "CF_BASE_URL") || `http://localhost:${port}`).replace(/\/+$/, "");
  const zernioApiKey = env("ZERNIO_API_KEY");
  const geminiApiKey = env("GEMINI_API_KEY");
  const thumbsPerDay = Math.max(1, Number(env("THUMBS_PER_DAY") || 10) || 10);
  const stripeSecretKey = env("STRIPE_SECRET_KEY");
  const stripeWebhookSecret = env("STRIPE_WEBHOOK_SECRET");
  const stripePriceId = env("STRIPE_PRICE_ID");
  const sessionSecretFromEnv = env("SESSION_SECRET", "CF_SESSION_SECRET");

  cached = {
    port,
    baseUrl,
    // A blank secret gets a random one: sessions survive the process but not a
    // restart, which is the safe default for a dev box.
    sessionSecret: sessionSecretFromEnv || randomBytes(32).toString("hex"),
    sessionSecretEphemeral: !sessionSecretFromEnv,
    zernioApiKey,
    zernioConfigured: Boolean(zernioApiKey),
    geminiApiKey,
    geminiConfigured: Boolean(geminiApiKey),
    thumbsPerDay,
    stripeSecretKey,
    stripeWebhookSecret,
    stripePriceId,
    // Checkout + Portal + trial enforcement need only the key + price. The
    // webhook secret is separate: it gates the /webhooks/stripe route, which
    // handles renewals/cancellations once the app is on a public URL. Locally,
    // the upgrade is confirmed on return from Checkout via the session id.
    stripeConfigured: Boolean(stripeSecretKey && stripePriceId),
    stripeWebhookConfigured: Boolean(stripeSecretKey && stripeWebhookSecret),
    mailConfigured: Boolean(env("RESEND_API_KEY")),
    instagramRedirectUri: baseUrl + INSTAGRAM_CALLBACK_PATH,
    tiktokRedirectUri: baseUrl + TIKTOK_CALLBACK_PATH,
  };
  return cached;
}
