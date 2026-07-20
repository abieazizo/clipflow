/**
 * server.ts — the hosted ClipFlow app.
 *
 * Product: sellers sign up (14-day trial), walk the wizard, connect platforms
 * through Zernio, and the engine posts published Whatnot clips automatically.
 * Business layer: Stripe billing (Checkout + Portal + webhooks), Resend email
 * (verification, reset, digests), SQLite persistence, visible post history
 * with retries, account lifecycle, admin.
 *
 * Route map (beyond the classics):
 *   GET  /forgot · POST /forgot · GET|POST /reset/:token · GET /verify/:token
 *   GET  /billing · POST /billing/checkout · POST /billing/portal
 *   POST /webhooks/stripe            raw body + signature (no CSRF — signed)
 *   GET  /history · POST /history/retry/:id
 *   POST /account/password /account/email /account/resend-verification /account/delete
 *   GET  /admin · POST /admin/toggle/:id
 *
 * Hardening: security headers + CSP, signed CSRF on all state changes,
 * in-memory rate limits, strict validation, branded error pages with refs.
 */

import "./env.js"; // must be first: loads .env into process.env before config

import express from "express";
import { request } from "undici";
import { createHmac, timingSafeEqual, randomUUID, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

import { loadAppSettings } from "./appconfig.js";
import {
  initDb, createAccount, verifyLogin, getAccount, getAccountByEmail, updateAccount,
  setPassword, verifyCurrentPassword, deleteAccountCascade,
  isActive, accountState, trialDaysLeft, TRIAL_DAYS,
  postStats, listPosts, getPostById, updatePost,
  createToken, consumeToken, peekToken, logEvent, adminStats, adminUserList, recentEvents,
  type Account,
} from "./db.js";
import { recentClips, startEngine, clipsDir, engineStatus, checkAccount } from "./engine.js";
import { getProfile as getWhatnotProfile, getBinary as getWhatnotBinary } from "./whatnot.js";
import * as zernio from "./zernio.js";
import * as gemini from "./gemini.js";
import * as billing from "./billing.js";
import { sendMail, verifyEmail as verifyEmailTpl, resetEmail } from "./mailer.js";
import { isCaptionPreset } from "./caption.js";
import {
  listKept, addThumb, ownsThumb, getThumb, keepThumb, discardSiblings, removeThumb,
  countGenerationsSince, thumbsDir, thumbPngPath, thumbWebpPath,
  cutoutsDir, cutoutPath, addCutout, ownsCutout,
} from "./thumbstore.js";
import { composeThumbnail, registerFonts, clipToImageInput } from "./thumbrender.js";
import * as renderer from "./thumbrender.js";
import {
  layout, landingPage, authPage, dashboard, welcomePage, guidePage,
  thumbnailsPage, statusPage, errorPage, privacyPage, termsPage,
  billingPage, historyPage, adminPage, forgotPage, resetPage, goodbyePage,
  type HistoryFilter,
} from "./views.js";

const APP_VERSION = "0.4.0";

const settings = loadAppSettings();
const app = express();

app.set("trust proxy", 1);

// ---------------------------------------------------------------------------
// Security headers — every response
// ---------------------------------------------------------------------------

const CSP = [
  "default-src 'self'",
  // Fonts are now self-hosted (public/fonts/*.woff2) — no third-party font host.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  // Stripe Checkout/Portal are reached by a POST that 302-redirects off-site;
  // form-action governs the whole redirect chain, so allow their hosts.
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
].join("; ");

app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// Stripe webhook needs the RAW body for signature verification — mount it
// BEFORE the urlencoded parser and exempt from CSRF (the signature IS auth).
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = String(req.headers["stripe-signature"] ?? "");
  if (!settings.stripeWebhookConfigured) return res.status(400).json({ ok: false, error: "webhook not configured" });
  if (!Buffer.isBuffer(req.body) || !sig || !billing.verifyWebhookSignature(req.body, sig)) {
    return res.status(400).json({ ok: false, error: "bad signature" });
  }
  try {
    const event = JSON.parse(req.body.toString("utf8"));
    await billing.handleWebhookEvent(event);
    res.json({ received: true });
  } catch (e) {
    console.error(`[billing] webhook error: ${(e as Error).message}`);
    res.status(400).json({ ok: false });
  }
});

app.use(express.urlencoded({ extended: false }));
// Guard: a POST with a content-type no parser handles (application/json to a
// urlencoded route, text/plain, none) leaves req.body undefined — reading
// req.body.csrf then throws a 500. Normalise to {} so handlers reject cleanly
// (missing csrf → 403) instead of crashing. Never clobbers a parsed body.
app.use((req, _res, next) => {
  if (req.body === undefined || req.body === null) req.body = {};
  next();
});
// Static assets. Brand fonts live at public/fonts/*.woff2 and are served here
// (same-origin → CSP font-src 'self'); the immutable, long-lived cache below
// covers /fonts specifically since those filenames never change.
app.use("/fonts", express.static("public/fonts", { immutable: true, maxAge: "30d" }));
app.use(express.static("public"));

// Dynamic pages must always revalidate. iPhone Safari (heuristic + back-forward
// cache) will otherwise re-render a stale HTML document, so a user never sees a
// deploy's changes. `no-cache` + the ETag Express sets = a cheap 304 when
// unchanged, fresh HTML when it changed. Static assets above keep their long
// cache (the stylesheet is cache-busted via /styles.css?v=<mtime>).
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-cache");
  next();
});

// ---------------------------------------------------------------------------
// Rate limiting — in-memory sliding window (per key)
// ---------------------------------------------------------------------------

const hits = new Map<string, number[]>();

function rateLimit(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) {
    const fresh = arr.filter((t) => now - t < 3600_000);
    if (fresh.length === 0) hits.delete(k); else hits.set(k, fresh);
  }
}, 5 * 60_000).unref();

function ip(req: express.Request): string {
  return req.ip ?? "unknown";
}

// ---------------------------------------------------------------------------
// Sessions — signed "<accountId>.<issuedAt>.<hmac>" cookie
// ---------------------------------------------------------------------------

const SESSION_COOKIE = "cf_session";
const SECURE_COOKIE = settings.baseUrl.startsWith("https:");

function cookieAttrs(maxAge: number): string {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIE ? "; Secure" : ""}`;
}

function sign(value: string): string {
  return createHmac("sha256", settings.sessionSecret).update(value).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

function readCookies(req: express.Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentAccount(req: express.Request): Account | null {
  const raw = readCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length === 3) {
    const [id, ts, sig] = parts;
    if (!/^[0-9a-f]+$/i.test(sig) || !safeEqualHex(sig, sign(`${id}.${ts}`))) return null;
    return getAccount(id);
  }
  if (parts.length === 2) {
    const [id, sig] = parts;
    if (!/^[0-9a-f]+$/i.test(sig) || !safeEqualHex(sig, sign(id))) return null;
    return getAccount(id);
  }
  return null;
}

/** Fresh issuedAt on every call = session rotation on login/reset. */
function setSession(res: express.Response, accountId: string): void {
  const base = `${accountId}.${Date.now()}`;
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(`${base}.${sign(base)}`)}; ${cookieAttrs(60 * 60 * 24 * 30)}`
  );
}

function clearSession(res: express.Response): void {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; ${cookieAttrs(0)}`);
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

function csrfToken(accountId: string): string {
  return sign(`csrf.${accountId}`);
}

function csrfOk(acct: Account, provided: unknown): boolean {
  const token = typeof provided === "string" ? provided : "";
  return /^[0-9a-f]+$/i.test(token) && safeEqualHex(token, csrfToken(acct.id));
}

function makeState(platform: string, accountId: string): string {
  const base = `${platform}.${accountId}.${Date.now()}`;
  return `${base}.${sign(base)}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[a-z0-9._-]{2,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanUsername(raw: unknown): string | null {
  const v = String(raw ?? "").trim().replace(/^@+/, "").toLowerCase();
  if (v === "") return "";
  return USERNAME_RE.test(v) ? v : null;
}

/** Everything a dashboard render needs beyond the account. */
function dashboardExtras(acct: Account) {
  const thumbs = listKept(acct.id);
  return Promise.resolve(thumbs).then((t) => ({
    csrf: csrfToken(acct.id),
    mode: acct.postingMode,
    lastCheckedAt: acct.lastCheckedAt,
    gemini: { configured: settings.geminiConfigured, thumbCount: t.length },
    stats: postStats(acct.id),
    billing: {
      configured: settings.stripeConfigured,
      active: isActive(acct, settings.stripeConfigured),
      state: accountState(acct, settings.stripeConfigured),
      daysLeft: trialDaysLeft(acct),
      trialDays: TRIAL_DAYS,
    },
    showVerifyBanner: !acct.emailVerifiedAt && settings.mailConfigured,
  }));
}

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------

app.get("/", (req, res) => {
  if (currentAccount(req)) return res.redirect("/dashboard");
  res.send(landingPage());
});

app.get("/privacy", (_req, res) => res.send(privacyPage()));
app.get("/terms", (_req, res) => res.send(termsPage()));
app.get("/healthz", (_req, res) => res.status(200).type("text/plain").send("ok"));

// ---------------------------------------------------------------------------
// Auth + verification + reset
// ---------------------------------------------------------------------------

app.get("/signup", (req, res) => {
  if (currentAccount(req)) return res.redirect("/dashboard");
  res.send(authPage("signup"));
});

app.post("/signup", async (req, res) => {
  if (!rateLimit(`signup:${ip(req)}`, 10)) {
    return res.status(429).send(authPage("signup", "Too many attempts — wait a minute and try again."));
  }
  const email = String(req.body.email ?? "").trim();
  const password = String(req.body.password ?? "");
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).send(authPage("signup", "That doesn't look like an email address.", email));
  }
  if (password.length < 8 || password.length > 200) {
    return res.status(400).send(authPage("signup", "Password needs at least 8 characters.", email));
  }
  const acct = await createAccount(email, password);
  if (!acct) {
    return res.status(400).send(authPage("signup", "That email already has an account — try logging in.", email));
  }
  // Verification email (console-logged in dev). Never blocks signup.
  const token = createToken(acct.id, "verify", 24 * 60);
  sendMail(verifyEmailTpl(acct.email, `${settings.baseUrl}/verify/${token}`)).catch(() => {});
  setSession(res, acct.id);
  res.redirect("/dashboard");
});

app.get("/login", (req, res) => {
  if (currentAccount(req)) return res.redirect("/dashboard");
  res.send(authPage("login"));
});

app.post("/login", async (req, res) => {
  if (!rateLimit(`login:${ip(req)}`, 10)) {
    return res.status(429).send(authPage("login", "Too many attempts — wait a minute and try again."));
  }
  const loginEmail = String(req.body.email ?? "").trim();
  const acct = await verifyLogin(loginEmail, String(req.body.password ?? ""));
  if (!acct) return res.status(401).send(authPage("login", "Wrong email or password.", loginEmail));
  setSession(res, acct.id);
  res.redirect("/dashboard");
});

app.get("/logout", (_req, res) => {
  clearSession(res);
  res.redirect("/");
});

app.get("/forgot", (_req, res) => res.send(forgotPage()));

app.post("/forgot", async (req, res) => {
  // 5/hour/IP; the response never reveals whether the email exists.
  if (!rateLimit(`forgot:${ip(req)}`, 5, 3600_000)) {
    return res.status(429).send(forgotPage(true));
  }
  const email = String(req.body.email ?? "").trim();
  const acct = EMAIL_RE.test(email) ? getAccountByEmail(email) : null;
  if (acct) {
    const token = createToken(acct.id, "reset", 30);
    sendMail(resetEmail(acct.email, `${settings.baseUrl}/reset/${token}`)).catch(() => {});
    logEvent(acct.id, "reset_requested");
  }
  res.send(forgotPage(true));
});

app.get("/reset/:token", (req, res) => {
  const token = String(req.params.token);
  if (!/^[0-9a-f]{64}$/.test(token) || !peekToken(token, "reset")) {
    return res.status(400).send(resetPage("", true));
  }
  res.send(resetPage(token));
});

app.post("/reset/:token", async (req, res) => {
  const token = String(req.params.token);
  const password = String(req.body.password ?? "");
  if (!/^[0-9a-f]{64}$/.test(token)) return res.status(400).send(resetPage("", true));
  if (password.length < 8 || password.length > 200) return res.status(400).send(resetPage(token));
  const consumed = consumeToken(token, "reset"); // single-use: dies here
  if (!consumed) return res.status(400).send(resetPage("", true));
  await setPassword(consumed.accountId, password);
  setSession(res, consumed.accountId); // rotate session
  res.redirect("/dashboard?saved=1");
});

app.get("/verify/:token", async (req, res) => {
  const token = String(req.params.token);
  if (!/^[0-9a-f]{64}$/.test(token)) return res.status(400).send(errorPage(404));
  const consumed = consumeToken(token, "verify");
  if (!consumed) return res.status(400).send(resetPage("", true));
  if (consumed.payload) {
    // email-change verification: payload carries the new address
    await updateAccount(consumed.accountId, { email: consumed.payload, emailVerifiedAt: new Date().toISOString() });
  } else {
    await updateAccount(consumed.accountId, { emailVerifiedAt: new Date().toISOString() });
  }
  res.redirect("/dashboard?saved=1");
});

// ---------------------------------------------------------------------------
// Whatnot username check — live validation for the wizard (+ avatar preview)
// ---------------------------------------------------------------------------

// Small TTL cache so typing pauses don't hammer Whatnot.
const unameCache = new Map<string, { at: number; body: unknown }>();
const UNAME_TTL_MS = 10 * 60_000;

app.get("/api/whatnot-check", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.status(401).json({ ok: false, error: "Log in first." });
  const uname = cleanUsername(req.query.u);
  if (!uname) return res.json({ ok: true, exists: false, reason: "invalid" });

  const cached = unameCache.get(uname);
  if (cached && Date.now() - cached.at < UNAME_TTL_MS) return res.json(cached.body);

  if (!rateLimit(`uname:${acct.id}`, 15)) {
    return res.status(429).json({ ok: false, error: "Checking too fast — give it a beat." });
  }

  try {
    const profile = await getWhatnotProfile(uname);
    let avatar: string | null = null;
    if (profile.exists && profile.avatarUrl) {
      try {
        const img = await getWhatnotBinary(profile.avatarUrl);
        avatar = `data:${img.contentType};base64,${img.buf.toString("base64")}`;
      } catch { /* profile is real even if the avatar won't load */ }
    }
    const body = { ok: true, exists: profile.exists, displayName: profile.displayName, avatar };
    unameCache.set(uname, { at: Date.now(), body });
    return res.json(body);
  } catch {
    // Whatnot unreachable/WAF — honestly "couldn't check", never "fake".
    return res.status(200).json({ ok: false, error: "Couldn't reach Whatnot to check — you can still continue." });
  }
});

// Real Instagram/TikTok profile pictures. The CDN URLs come from Zernio and
// can't be embedded directly (CSP img-src is 'self' data: only, and they
// expire), so we fetch them server-side and return data URIs the dashboard
// swaps into the pipeline avatars.
const socialAvatarCache = new Map<string, { at: number; body: unknown }>();
const SOCIAL_TTL_MS = 10 * 60_000;

app.get("/api/social-avatars", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.status(401).json({ ok: false });
  if (!acct.zernioProfileId || !settings.zernioConfigured) return res.json({ ok: true, instagram: null, tiktok: null });

  const cached = socialAvatarCache.get(acct.id);
  if (cached && Date.now() - cached.at < SOCIAL_TTL_MS) return res.json(cached.body);

  const out: { ok: true; instagram: string | null; tiktok: string | null } = { ok: true, instagram: null, tiktok: null };
  try {
    const listed = await zernio.listAccounts();
    if (listed.ok) {
      for (const platform of ["instagram", "tiktok"] as const) {
        const match = listed.data.find((a) => a.profileId === acct.zernioProfileId && a.platform === platform);
        if (match?.avatarUrl) {
          try {
            const img = await request(match.avatarUrl, { headersTimeout: 8000, bodyTimeout: 8000 });
            if (img.statusCode >= 200 && img.statusCode < 300) {
              const buf = Buffer.from(await img.body.arrayBuffer());
              if (buf.length > 0 && buf.length < 2_000_000) {
                const ct = String(img.headers["content-type"] ?? "image/jpeg").split(";")[0];
                out[platform] = `data:${ct};base64,${buf.toString("base64")}`;
              }
            } else { await img.body.dump(); }
          } catch { /* one avatar failing shouldn't sink the rest */ }
        }
      }
    }
  } catch { /* fall through with nulls — the brand icon stays */ }
  socialAvatarCache.set(acct.id, { at: Date.now(), body: out });
  res.json(out);
});

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

function isFreshAccount(acct: Account): boolean {
  return !acct.onboardedAt && !acct.whatnotUsername && !acct.instagram && !acct.tiktok;
}

app.get("/welcome", (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  const step = Number((req.query.step as string) ?? "1") || 1;
  const q = req.query as Record<string, string | undefined>;
  res.send(welcomePage(
    acct, step, csrfToken(acct.id),
    { metaConfigured: settings.zernioConfigured, tiktokConfigured: settings.zernioConfigured },
    { connected: q.connected, error: q.error }
  ));
});

app.post("/welcome/username", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).send(errorPage(500, "csrf"));
  const uname = cleanUsername(req.body.whatnotUsername);
  if (uname === null || uname === "") return res.redirect("/welcome?step=2&error=bad_username");
  await updateAccount(acct.id, { whatnotUsername: uname });
  res.redirect("/welcome?step=3");
});

app.post("/welcome/complete", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).send(errorPage(500, "csrf"));
  if (!acct.onboardedAt) await updateAccount(acct.id, { onboardedAt: new Date().toISOString() });
  res.redirect("/dashboard?onboarded=1");
});

// ---------------------------------------------------------------------------
// Dashboard + settings
// ---------------------------------------------------------------------------

app.get("/dashboard", async (req, res) => {
  let acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (isFreshAccount(acct)) return res.redirect("/welcome");
  const q = req.query as Record<string, string | undefined>;
  // Returning from Stripe Checkout — confirm the upgrade without a webhook.
  if (q.billing === "success" && q.session_id && settings.stripeConfigured) {
    try {
      const upgraded = await billing.confirmCheckoutSession(acct, String(q.session_id));
      if (upgraded) acct = getAccount(acct.id) ?? acct;
    } catch (e) { console.error(`[billing] confirm on return failed: ${(e as Error).message}`); }
  }
  const clips = await recentClips(acct);
  res.send(dashboard(
    acct,
    { metaConfigured: settings.zernioConfigured, tiktokConfigured: settings.zernioConfigured },
    clips,
    { connected: q.connected, disconnected: q.disconnected, partial: q.partial, error: q.error, saved: q.saved, onboarded: q.onboarded, billing: q.billing },
    await dashboardExtras(acct)
  ));
});

app.post("/settings", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!csrfOk(acct, req.body.csrf)) {
    return req.body.onlyMode ? res.status(403).json({ ok: false, error: "That form expired — reload and try again." }) : res.status(403).send(errorPage(500, "csrf"));
  }
  // Mode-only update from the dashboard's posting-mode toggle (JSON, no full save).
  if (req.body.onlyMode === "1" || req.body.onlyMode === true) {
    const mode = req.body.postingMode === "auto" ? "auto" : "manual";
    await updateAccount(acct.id, { postingMode: mode });
    logEvent(acct.id, "posting_mode", mode);
    return res.json({ ok: true, postingMode: mode });
  }
  // Caption-style auto-save (preset + hashtags; template too when Custom).
  if (req.body.onlyCaption === "1" || req.body.onlyCaption === true) {
    const preset = String(req.body.captionPreset ?? "");
    if (!isCaptionPreset(preset)) return res.status(400).json({ ok: false, error: "Pick one of the caption styles." });
    const patch: Partial<Account> = { captionPreset: preset };
    if (req.body.hashtags !== undefined) {
      patch.hashtags = String(req.body.hashtags ?? "")
        .split(/[\s,]+/).map((h) => h.trim().replace(/^#+/, "").slice(0, 30)).filter(Boolean).slice(0, 30);
    }
    if (preset === "custom" && req.body.captionTemplate !== undefined) {
      patch.captionTemplate = String(req.body.captionTemplate ?? "").slice(0, 2200).trim() || "{title}\n\n{hashtags}";
    }
    await updateAccount(acct.id, patch);
    return res.json({ ok: true, captionPreset: preset });
  }
  // Username-only save from the "Your Whatnot" card.
  if (req.body.onlyUsername === "1" || req.body.onlyUsername === true) {
    const u = cleanUsername(req.body.whatnotUsername);
    if (u === null) return res.status(400).json({ ok: false, error: "That username doesn't look right — lowercase letters, numbers, dots and dashes only." });
    await updateAccount(acct.id, { whatnotUsername: u });
    return res.json({ ok: true, whatnotUsername: u });
  }
  // Pause/resume from the Account card.
  if (req.body.onlyPause === "1" || req.body.onlyPause === true) {
    const enabled = String(req.body.enabled ?? "") === "1";
    await updateAccount(acct.id, { enabled });
    logEvent(acct.id, enabled ? "resumed" : "paused");
    return res.json({ ok: true, enabled });
  }
  const uname = cleanUsername(req.body.whatnotUsername);
  if (uname === null) return res.redirect("/dashboard?error=bad_username");
  const captionTemplate = String(req.body.captionTemplate ?? "").slice(0, 2200).trim() || "{title}\n\n{hashtags}";
  const hashtags = String(req.body.hashtags ?? "")
    .split(/[\s,]+/).map((h) => h.trim().replace(/^#+/, "").slice(0, 30)).filter(Boolean).slice(0, 30);
  const enabled = req.body.enabled === "on";
  await updateAccount(acct.id, { whatnotUsername: uname, captionTemplate, hashtags, enabled });
  res.redirect("/dashboard?saved=1");
});

// Manual "Check for clips" — run a full engine pass for JUST this account, now.
app.post("/check", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.status(401).json({ ok: false, error: "Log in first." });
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).json({ ok: false, error: "That form expired — reload and try again." });
  if (!rateLimit(`check:${acct.id}`, 6)) return res.status(429).json({ ok: false, error: "Easy — you can check a few times a minute. Give it a moment." });
  if (!acct.enabled) return res.json({ found: 0, queued: 0, alreadyPosted: 0, message: "ClipFlow is paused — turn it back on in Settings first." });
  if (!acct.whatnotUsername) return res.json({ found: 0, queued: 0, alreadyPosted: 0, message: "Add your Whatnot username in settings first." });
  if (!isActive(acct, settings.stripeConfigured)) return res.json({ found: 0, queued: 0, alreadyPosted: 0, message: "Add a card to unlock posting — nothing posts until then." });
  if (!acct.instagram && !acct.tiktok) return res.json({ found: 0, queued: 0, alreadyPosted: 0, message: "Connect Instagram or TikTok first, then check." });

  const r = await checkAccount(acct);
  if ("busy" in r) return res.json({ busy: true, message: "Already checking — one sec." });
  const message = r.found > 0
    ? `Found ${r.found} new clip${r.found === 1 ? "" : "s"} — posting now.`
    : "No new clips. Publish a clip on Whatnot, then check again.";
  res.json({ found: r.found, queued: r.queued, alreadyPosted: r.alreadyPosted, message });
});

// ---------------------------------------------------------------------------
// Account lifecycle
// ---------------------------------------------------------------------------

app.post("/account/password", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).send(errorPage(500, "csrf"));
  const current = String(req.body.current ?? "");
  const next = String(req.body.next ?? "");
  if (!verifyCurrentPassword(acct.id, current)) {
    return res.redirect("/dashboard?error=" + encodeURIComponent("Current password is wrong."));
  }
  if (next.length < 8 || next.length > 200) {
    return res.redirect("/dashboard?error=" + encodeURIComponent("New password needs at least 8 characters."));
  }
  await setPassword(acct.id, next);
  setSession(res, acct.id); // rotate
  res.redirect("/dashboard?saved=1");
});

app.post("/account/email", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).send(errorPage(500, "csrf"));
  const email = String(req.body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.redirect("/dashboard?error=" + encodeURIComponent("That doesn't look like an email address."));
  }
  if (getAccountByEmail(email)) {
    return res.redirect("/dashboard?error=" + encodeURIComponent("That email is already in use."));
  }
  // Verify the NEW address before switching (payload carries it).
  const token = createToken(acct.id, "verify", 24 * 60, email);
  await sendMail(verifyEmailTpl(email, `${settings.baseUrl}/verify/${token}`));
  res.redirect("/dashboard?saved=1");
});

app.post("/account/resend-verification", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).send(errorPage(500, "csrf"));
  if (!rateLimit(`verify:${acct.id}`, 3, 3600_000)) return res.redirect("/dashboard?error=slow_down");
  if (!acct.emailVerifiedAt) {
    const token = createToken(acct.id, "verify", 24 * 60);
    await sendMail(verifyEmailTpl(acct.email, `${settings.baseUrl}/verify/${token}`));
  }
  res.redirect("/dashboard?saved=1");
});

app.post("/account/delete", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).send(errorPage(500, "csrf"));
  if (String(req.body.confirm ?? "").trim().toLowerCase() !== acct.email) {
    return res.redirect("/dashboard?error=" + encodeURIComponent("Type your email exactly to confirm deletion."));
  }
  // Remove every connected social account on Zernio before wiping local rows.
  for (const platform of ["instagram", "tiktok"] as const) {
    const conn = acct[platform];
    if (conn?.accountId) {
      const r = await zernio.disconnectAccount(conn.accountId);
      if (!r.ok) console.error(`[delete] Zernio removal failed for ${platform} ${conn.accountId}: ${r.error}`);
    }
  }
  await billing.cancelSubscription(acct);
  await deleteAccountCascade(acct.id, clipsDir(), process.env.WN_DATA_DIR || "./data");
  clearSession(res);
  res.send(goodbyePage());
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

app.get("/billing", (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  res.send(billingPage(acct, {
    configured: settings.stripeConfigured,
    csrf: csrfToken(acct.id),
    state: accountState(acct, settings.stripeConfigured),
    daysLeft: trialDaysLeft(acct),
    trialDays: TRIAL_DAYS,
  }));
});

app.post("/billing/checkout", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).send(errorPage(500, "csrf"));
  const r = await billing.createCheckoutSession(acct);
  if (!r.ok) return res.redirect("/billing?error=" + encodeURIComponent(r.error));
  res.redirect(r.url);
});

app.post("/billing/portal", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).send(errorPage(500, "csrf"));
  const r = await billing.createPortalSession(acct);
  if (!r.ok) return res.redirect("/billing?error=" + encodeURIComponent(r.error));
  res.redirect(r.url);
});

// ---------------------------------------------------------------------------
// History + retries
// ---------------------------------------------------------------------------

app.get("/history", (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  const raw = String(req.query.filter ?? "all");
  const filter: HistoryFilter = raw === "posted" || raw === "failed" ? raw : "all";
  const q = req.query as Record<string, string | undefined>;
  res.send(historyPage(acct, listPosts(acct.id, 200), {
    csrf: csrfToken(acct.id),
    filter,
    query: { retried: q.retried, error: q.error },
  }));
});

app.post("/history/retry/:id", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).send(errorPage(500, "csrf"));
  const id = String(req.params.id).toLowerCase();
  if (!UUID_RE.test(id)) return res.redirect("/history");
  const post = getPostById(id);
  if (!post || post.accountId !== acct.id) return res.status(404).send(errorPage(404));
  if (post.status !== "failed") return res.redirect("/history");
  updatePost(id, { status: "pending", attempts: 0, nextRetryAt: null, error: null, zernioPostId: null });
  logEvent(acct.id, "retry_requested", `${post.platform} ${post.clipId}`);
  res.redirect("/history?retried=1");
});

// ---------------------------------------------------------------------------
// Guide / status / thumbnails (unchanged behavior)
// ---------------------------------------------------------------------------

app.get("/guide", (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  res.send(guidePage(acct));
});

app.get("/status", (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  res.send(statusPage(acct, {
    version: APP_VERSION,
    engine: engineStatus(),
    zernioConfigured: settings.zernioConfigured,
    geminiConfigured: settings.geminiConfigured,
  }));
});

const DAY_MS = 24 * 3600_000;

/** Remaining generations today + when the next slot frees, for the daily cap. */
async function thumbAllowance(acct: Account): Promise<{ left: number; resetHrs: number }> {
  if (acct.isAdmin) return { left: settings.thumbsPerDay, resetHrs: 0 };
  const { count, oldestMs } = await countGenerationsSince(acct.id, Date.now() - DAY_MS);
  const left = Math.max(0, settings.thumbsPerDay - count);
  const resetHrs = left > 0 || oldestMs === null ? 0 : Math.max(1, Math.ceil((oldestMs + DAY_MS - Date.now()) / 3600_000));
  return { left, resetHrs };
}

app.get("/thumbnails", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  const thumbs = await listKept(acct.id);
  const clips = await recentClips(acct, 20);
  const { left } = await thumbAllowance(acct);
  res.send(thumbnailsPage(acct, thumbs, clips, {
    configured: settings.geminiConfigured,
    csrf: csrfToken(acct.id),
    styles: gemini.STYLE_SPECS,
    left,
    perDay: settings.thumbsPerDay,
  }));
});

const QA_ENABLED = process.env.THUMBS_QA !== "0"; // dev can disable the vision QA loop

/** Turn a set of failing QA scores into a corrective note folded into the retry prompt. */
function qaFailureNote(s: gemini.BgScore): string {
  const parts: string[] = [];
  if (s.d === 0) parts.push("the previous attempt contained text or a watermark — render absolutely no text, letters, numbers or logos");
  if (s.b < 6) parts.push("the previous attempt was too cluttered at the top — keep the entire upper 40% clean, empty and simple");
  if (s.a < 6) parts.push("make ONE single hero subject clearly dominant and oversized in the lower half");
  if (s.c < 6) parts.push("boost the lighting energy, contrast and colour");
  return parts.length ? `Previous attempt feedback: ${parts.join("; ")}.` : "";
}

/**
 * Generate a background and run it past the Gemini vision QA scorer. Regenerates
 * (up to 2 extra times, folding the failure into the prompt) until it passes, then
 * ships the best-scoring attempt. Costs ~1 cheap vision call per attempt — set
 * THUMBS_QA=0 to skip the loop in dev.
 */
async function generateBackground(
  style: gemini.ThumbStyle, subject: string, variant: number, image: gemini.ImageInput | null
): Promise<{ png: Buffer } | { error: string; status?: number }> {
  const maxAttempts = QA_ENABLED ? 3 : 1;
  let note = "";
  let best: { png: Buffer; composite: number } | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const base = image ? gemini.buildEditPrompt(style, variant) : gemini.buildBackgroundPrompt(style, subject, variant);
    const bg = await gemini.generateImage(settings.geminiApiKey, note ? `${base} ${note}` : base, { image: image ?? undefined });
    if (!bg.ok) { if (best) break; return { error: bg.error, status: bg.status }; }
    if (!QA_ENABLED) return { png: bg.png };
    const scored = await gemini.scoreBackground(settings.geminiApiKey, bg.png);
    if (!scored.ok) { console.log(`[thumbnails] QA scorer unavailable (${scored.error}) — accepting background`); return { png: bg.png }; }
    const { a, b, c, d } = scored.scores;
    const avg = (a + b + c) / 3;
    const pass = d !== 0 && avg >= 6;
    console.log(`[thumbnails] QA ${style} v${variant} attempt ${attempt}: a=${a} b=${b} c=${c} d=${d} avg=${avg.toFixed(1)} → ${pass ? "PASS" : "FAIL"}`);
    const composite = (d !== 0 ? 0 : -100) + avg; // prefer text-free, then higher a+b+c
    if (!best || composite > best.composite) best = { png: bg.png, composite };
    if (pass) return { png: bg.png };
    note = qaFailureNote(scored.scores);
  }
  if (best) { console.log(`[thumbnails] QA ${style} v${variant}: shipping best-scoring attempt`); return { png: best.png }; }
  return { error: "Couldn't produce a clean background — try again.", status: 502 };
}

interface RenderOpts {
  clipId: string | null; subject: string; style: gemini.ThumbStyle; headline: string;
  layout: renderer.LayoutMode; heroWordIndex: number | null; useClip: boolean;
  cutouts: Buffer[]; cutoutIds: string[]; recipe: gemini.CoverRecipe | null; dateText: string;
  variant: number; seed: number; createdAt: string;
}

/** Render one variation and persist it. Wall = deterministic flood+collage (no AI bg); Poster = QA'd AI hero. */
async function renderVariation(acct: Account, o: RenderOpts): Promise<{ id: string } | { error: string; status?: number }> {
  let background: Buffer | undefined;
  const mode: renderer.LayoutMode = o.recipe?.layoutStyle ?? o.layout;
  if (mode === "poster") {
    const bg = await generateBackground(o.style, o.subject, o.variant, null); // AI hero scene, QA'd
    if ("error" in bg) return bg;
    background = bg.png;
  }
  const { png, webp, offer, legible, legibilityPct } = await composeThumbnail({
    style: o.style, headline: o.headline, handle: acct.whatnotUsername, layout: o.layout,
    heroWordIndex: o.heroWordIndex, cutouts: o.cutouts, background, recipe: o.recipe, dateText: o.dateText, seed: o.seed,
  });
  if (!legible) console.log(`[thumbnails] legibility warning: headline x-height ${(legibilityPct * 100).toFixed(1)}% < ${(renderer.LEGIBILITY_MIN_XHEIGHT * 100)}%`);
  const id = randomUUID();
  if (!existsSync(thumbsDir())) await mkdir(thumbsDir(), { recursive: true });
  await writeFile(thumbPngPath(id), png);
  await writeFile(thumbWebpPath(id), webp);
  await addThumb(acct.id, {
    id, clipId: o.clipId, subject: o.subject, style: o.style, headline: o.headline,
    badgeText: offer ?? undefined, heroWordIndex: o.heroWordIndex, useClip: o.useClip,
    layout: o.layout, dateText: o.dateText || undefined, cutoutIds: o.cutoutIds, recipe: o.recipe ?? undefined,
    createdAt: o.createdAt, kept: false,
  });
  return { id };
}

/** Gather collage cutouts: stored product cutouts (owned) + the clip frame cut out once. */
async function buildCutouts(acct: Account, cutoutIds: string[], clipId: string | null, useClip: boolean): Promise<Buffer[]> {
  const bufs: Buffer[] = [];
  for (const id of cutoutIds) {
    if (bufs.length >= 3) break;
    if ((await ownsCutout(acct.id, id)) && existsSync(cutoutPath(id))) bufs.push(await readFile(cutoutPath(id)));
  }
  if (useClip && clipId && bufs.length < 3) {
    const img = await clipToImageInput(join(clipsDir(), `${clipId}.webp`));
    if (img) {
      const cut = await gemini.cutoutProduct(settings.geminiApiKey, img);
      if (cut.ok) { bufs.push(cut.png); console.log(`[thumbnails] cut out clip ${clipId}'s product for @${acct.whatnotUsername}`); }
    }
  }
  return bufs.slice(0, 3);
}

function parseIdList(raw: unknown): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  let arr: string[] = [];
  try { const j = JSON.parse(s); if (Array.isArray(j)) arr = j.map(String); } catch { arr = s.split(","); }
  return arr.map((x) => x.trim().toLowerCase()).filter((x) => UUID_RE.test(x)).slice(0, 3);
}

// AI headline writer — 3 options from the clip title / subject (text model).
app.post("/thumbnails/headline", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.status(401).json({ ok: false, error: "Log in first." });
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).json({ ok: false, error: "That form expired — reload and try again." });
  if (!settings.geminiConfigured) return res.status(400).json({ ok: false, error: "AI is locked — no GEMINI_API_KEY." });
  if (!rateLimit(`headline:${acct.id}`, 10)) return res.status(429).json({ ok: false, error: "Slow down a moment — try again shortly." });
  const clipTitle = String(req.body.clipTitle ?? "").trim().slice(0, 160);
  const subject = String(req.body.subject ?? "").trim().slice(0, 80);
  const r = await gemini.writeHeadlines(settings.geminiApiKey, { clipTitle, subject });
  if (!r.ok) return res.status(502).json({ ok: false, error: r.error });
  res.json({ ok: true, headlines: r.headlines });
});

/** Pull base64 + mime out of a data URL or bare base64 string. */
function parseImagePayload(raw: unknown): gemini.ImageInput | null {
  const s = String(raw ?? "");
  const m = s.match(/^data:(image\/[a-z.+-]+);base64,(.+)$/i);
  if (m) return { mimeType: m[1], data: m[2] };
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 100) return { mimeType: "image/png", data: s.replace(/\s+/g, "") };
  return null;
}

// Isolate a product photo on a transparent background → stored cutout for the collage.
app.post("/thumbnails/cutout", express.json({ limit: "16mb" }), async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.status(401).json({ ok: false, error: "Log in first." });
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).json({ ok: false, error: "That form expired — reload and try again." });
  if (!settings.geminiConfigured) return res.status(400).json({ ok: false, error: "AI is locked — no GEMINI_API_KEY." });
  if (!rateLimit(`cutout:${acct.id}`, 20)) return res.status(429).json({ ok: false, error: "Slow down a moment — try again shortly." });
  const img = parseImagePayload(req.body.image);
  if (!img) return res.status(400).json({ ok: false, error: "Couldn't read that image." });
  const out = await gemini.cutoutProduct(settings.geminiApiKey, img);
  if (!out.ok) return res.status(out.status && out.status < 500 ? 400 : 502).json({ ok: false, error: out.error });
  const id = randomUUID();
  if (!existsSync(cutoutsDir())) await mkdir(cutoutsDir(), { recursive: true });
  await writeFile(cutoutPath(id), out.png);
  await addCutout(acct.id, id);
  res.json({ ok: true, id, preview: `/thumb-cutout/${id}.png` });
});

// Clone-a-winner: vision-analyze a reference cover URL (or image) → reusable style recipe.
app.post("/thumbnails/clone", express.json({ limit: "16mb" }), async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.status(401).json({ ok: false, error: "Log in first." });
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).json({ ok: false, error: "That form expired — reload and try again." });
  if (!settings.geminiConfigured) return res.status(400).json({ ok: false, error: "AI is locked — no GEMINI_API_KEY." });
  if (!rateLimit(`clone:${acct.id}`, 10)) return res.status(429).json({ ok: false, error: "Slow down a moment — try again shortly." });
  let img = parseImagePayload(req.body.image);
  const url = String(req.body.url ?? "").trim();
  if (!img && url) {
    if (!/^https:\/\/[\w.-]*whatnot\.com\//i.test(url) && !/^https:\/\/images\.whatnot\.com\//i.test(url)) {
      return res.status(400).json({ ok: false, error: "Paste a Whatnot cover image URL (images.whatnot.com…)." });
    }
    try {
      const r = await request(url, { method: "GET", headers: { "User-Agent": "Mozilla/5.0" }, maxRedirections: 3 });
      if (r.statusCode >= 300) return res.status(400).json({ ok: false, error: `Couldn't fetch that cover (HTTP ${r.statusCode}).` });
      const buf = Buffer.from(await r.body.arrayBuffer());
      const ct = String(r.headers["content-type"] ?? "image/jpeg").split(";")[0];
      img = { mimeType: ct.startsWith("image/") ? ct : "image/jpeg", data: buf.toString("base64") };
    } catch (e) {
      return res.status(502).json({ ok: false, error: `Couldn't fetch that cover: ${(e as Error).message}` });
    }
  }
  if (!img) return res.status(400).json({ ok: false, error: "Give a Whatnot cover URL or upload an image." });
  const out = await gemini.analyzeCover(settings.geminiApiKey, img);
  if (!out.ok) return res.status(502).json({ ok: false, error: out.error });
  console.log(`[thumbnails] clone recipe for @${acct.whatnotUsername}: ${JSON.stringify(out.recipe)}`);
  res.json({ ok: true, recipe: out.recipe });
});

// Generate 2 variations (Text-Wall flood+collage by default, or QA'd Poster hero).
app.post("/thumbnails/generate", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.status(401).json({ ok: false, error: "Log in first." });
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).json({ ok: false, error: "That form expired — reload and try again." });
  if (!settings.geminiConfigured) return res.status(400).json({ ok: false, error: "AI thumbnails are locked — the operator needs to add a GEMINI_API_KEY." });

  const { left, resetHrs } = await thumbAllowance(acct);
  if (left <= 0) {
    return res.status(429).json({ ok: false, error: `You've used all ${settings.thumbsPerDay} thumbnails for today — resets in about ${resetHrs} hour${resetHrs === 1 ? "" : "s"}.` });
  }

  const style = String(req.body.style ?? "");
  if (!gemini.isThumbStyle(style)) return res.status(400).json({ ok: false, error: "Pick one of the four styles." });
  const headline = String(req.body.headline ?? "").trim().slice(0, 80);
  if (!headline) return res.status(400).json({ ok: false, error: "Give your thumbnail a headline." });
  const subject = String(req.body.subject ?? "").trim().slice(0, 80);
  const layout: renderer.LayoutMode = String(req.body.layout ?? "wall") === "poster" ? "poster" : "wall";
  const dateText = String(req.body.dateText ?? "").trim().slice(0, 24);
  const clipIdRaw = String(req.body.clipId ?? "").trim();
  const clipId = clipIdRaw === "" ? null : UUID_RE.test(clipIdRaw) ? clipIdRaw.toLowerCase() : undefined;
  if (clipId === undefined) return res.status(400).json({ ok: false, error: "That clip reference doesn't look right." });
  const useClip = String(req.body.useClip ?? "1") !== "0";
  const heroRaw = Number.parseInt(String(req.body.heroWordIndex ?? ""), 10);
  const heroWordIndex = Number.isInteger(heroRaw) && heroRaw >= 0 ? heroRaw : null;
  const cutoutIds = parseIdList(req.body.cutoutIds);
  let recipe: gemini.CoverRecipe | null = null;
  try { const r = req.body.recipe ? JSON.parse(String(req.body.recipe)) : null; if (r && typeof r === "object") recipe = r; } catch { /* ignore */ }

  const cutouts = await buildCutouts(acct, cutoutIds, clipId, useClip);
  if (cutouts.length) console.log(`[thumbnails] ${cutouts.length} product cutout(s) for @${acct.whatnotUsername} (${layout} mode)`);

  const createdAt = new Date().toISOString(); // shared batch stamp → counts as ONE generation
  const seedBase = Date.parse(createdAt) & 0xffffff;
  const common = { clipId, subject, style, headline, layout, heroWordIndex, useClip, cutouts, cutoutIds, recipe, dateText, createdAt };
  const results = await Promise.all([
    renderVariation(acct, { ...common, variant: 0, seed: seedBase }),
    renderVariation(acct, { ...common, variant: 1, seed: seedBase + 777 }),
  ]);
  const ok = results.filter((r): r is { id: string } => "id" in r);
  if (ok.length === 0) {
    const firstErr = results.find((r): r is { error: string; status?: number } => "error" in r)!;
    return res.status(firstErr.status && firstErr.status < 500 ? 400 : 502).json({ ok: false, error: firstErr.error });
  }
  const after = await thumbAllowance(acct);
  res.json({ ok: true, variations: ok.map((r) => r.id), left: after.left });
});

// Keep a variation. By default its un-kept batch siblings are discarded; pass
// discard=0 (used by "Keep both") to keep it without touching the others.
app.post("/thumbnails/keep/:id", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.status(401).json({ ok: false, error: "Log in first." });
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).json({ ok: false, error: "csrf" });
  const id = String(req.params.id).toLowerCase();
  if (!UUID_RE.test(id) || !(await keepThumb(acct.id, id))) return res.status(404).json({ ok: false, error: "Not found." });
  if (String(req.body.discard ?? "1") !== "0") await discardSiblings(acct.id, id);
  res.json({ ok: true });
});

// Regenerate the AI background for an existing thumbnail (same text/style/subject).
app.post("/thumbnails/regen/:id", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.status(401).json({ ok: false, error: "Log in first." });
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).json({ ok: false, error: "csrf" });
  if (!settings.geminiConfigured) return res.status(400).json({ ok: false, error: "AI thumbnails are locked." });
  const id = String(req.params.id).toLowerCase();
  if (!UUID_RE.test(id)) return res.status(404).json({ ok: false, error: "Not found." });
  const row = await getThumb(acct.id, id);
  if (!row || !gemini.isThumbStyle(row.style)) return res.status(404).json({ ok: false, error: "Not found." });

  const layout: renderer.LayoutMode = row.layout === "poster" ? "poster" : "wall";
  const cutouts = await buildCutouts(acct, row.cutoutIds ?? [], row.clipId, row.useClip ?? false);
  let background: Buffer | undefined;
  if ((row.recipe?.layoutStyle ?? layout) === "poster") {
    const bg = await generateBackground(row.style, row.subject, 1, null);
    if ("error" in bg) return res.status(bg.status && bg.status < 500 ? 400 : 502).json({ ok: false, error: bg.error });
    background = bg.png;
  }
  const { png, webp } = await composeThumbnail({
    style: row.style, headline: row.headline, handle: acct.whatnotUsername, layout,
    heroWordIndex: row.heroWordIndex ?? null, cutouts, background, recipe: row.recipe ?? null,
    dateText: row.dateText, seed: (Date.now() & 0xffffff) >>> 0,
  });
  await writeFile(thumbPngPath(id), png);
  await writeFile(thumbWebpPath(id), webp);
  res.json({ ok: true, ts: Date.now() });
});

app.post("/thumbnails/delete/:id", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.status(401).json({ ok: false, error: "Log in first." });
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).json({ ok: false, error: "csrf" });
  const id = String(req.params.id).toLowerCase();
  if (!UUID_RE.test(id)) return res.status(404).json({ ok: false, error: "Not found." });
  // removeThumb returns false when nothing matched (unknown id or not this
  // account's) — report that honestly as a 404 rather than a misleading 200.
  const removed = await removeThumb(acct.id, id);
  if (!removed) return res.status(404).json({ ok: false, error: "That cover no longer exists." });
  res.json({ ok: true });
});

// Serve a product cutout preview (owner only).
app.get("/thumb-cutout/:file", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  const m = /^([0-9a-f-]{36})(\.png)?$/i.exec(req.params.file);
  if (!m || !UUID_RE.test(m[1])) return res.status(400).send(errorPage(404));
  const id = m[1].toLowerCase();
  if (!(await ownsCutout(acct.id, id))) return res.status(404).send(errorPage(404));
  const file = resolve(cutoutPath(id));
  if (!existsSync(file)) return res.status(404).send(errorPage(404));
  res.sendFile(file);
});

// Serve /thumb-gen/<uuid>.png (full cover) or .webp (preview).
app.get("/thumb-gen/:file", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  const m = /^([0-9a-f-]{36})(\.png|\.webp)?$/i.exec(req.params.file);
  if (!m || !UUID_RE.test(m[1])) return res.status(400).send(errorPage(404));
  const id = m[1].toLowerCase();
  if (!(await ownsThumb(acct.id, id))) return res.status(404).send(errorPage(404));
  const file = resolve(m[2] === ".webp" ? thumbWebpPath(id) : thumbPngPath(id));
  if (!existsSync(file)) return res.status(404).send(errorPage(404));
  res.sendFile(file);
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

app.get("/admin", (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!acct.isAdmin) return res.status(404).send(errorPage(404)); // invisible
  res.send(adminPage(acct, adminStats(), adminUserList(), recentEvents(50), csrfToken(acct.id)));
});

app.post("/admin/toggle/:id", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  if (!acct.isAdmin) return res.status(404).send(errorPage(404));
  if (!csrfOk(acct, req.body.csrf)) return res.status(403).send(errorPage(500, "csrf"));
  const id = String(req.params.id).toLowerCase();
  if (!UUID_RE.test(id)) return res.redirect("/admin");
  const target = getAccount(id);
  if (target && target.id !== acct.id) {
    await updateAccount(id, { disabled: !target.disabled });
    logEvent(acct.id, "admin_toggle", `${target.email} -> ${target.disabled ? "enabled" : "disabled"}`);
  }
  res.redirect("/admin");
});

// ---------------------------------------------------------------------------
// Platform connect (Zernio) — unchanged behavior
// ---------------------------------------------------------------------------

type Platform = zernio.ZernioPlatform;

function asPlatform(p: string): Platform | null {
  return p === "instagram" || p === "tiktok" ? p : null;
}

app.get("/connect/:platform", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  const platform = asPlatform(req.params.platform);
  if (!platform) return res.redirect("/dashboard");
  const fromWelcome = req.query.from === "welcome";
  const back = fromWelcome ? "/welcome?step=3" : "/dashboard";
  const sep = back.includes("?") ? "&" : "?";
  if (!settings.zernioConfigured) return res.redirect(`${back}${sep}error=zernio_not_configured`);
  if (!rateLimit(`connect:${acct.id}`, 10)) return res.redirect(`${back}${sep}error=slow_down`);

  const errCode = (r: { error: string; status?: number }): string =>
    r.status === 402 ? "zernio_plan_limit" : "connect_failed";

  let profileId = acct.zernioProfileId;
  if (!profileId) {
    const created = await zernio.createProfile(acct.email);
    if (!created.ok) {
      console.error(`zernio createProfile failed: ${created.error}`);
      return res.redirect(`${back}${sep}error=${errCode(created)}`);
    }
    profileId = created.data;
    await updateAccount(acct.id, { zernioProfileId: profileId });
  }

  const redirectUrl = `${settings.baseUrl}/connect/${platform}/callback${fromWelcome ? "?from=welcome" : ""}`;
  const started = await zernio.startConnect(profileId, platform, redirectUrl);
  if (!started.ok) {
    console.error(`zernio startConnect(${platform}) failed: ${started.error}`);
    return res.redirect(`${back}${sep}error=${errCode(started)}`);
  }
  console.log(`[connect] redirecting ${acct.email} to ${started.data}`);
  res.redirect(started.data);
});

app.get("/connect/:platform/callback", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  const platform = asPlatform(req.params.platform);
  if (!platform) return res.redirect("/dashboard");
  const fromWelcome = req.query.from === "welcome";
  const back = fromWelcome ? "/welcome?step=3" : "/dashboard";
  const sep = back.includes("?") ? "&" : "?";
  if (!acct.zernioProfileId) return res.redirect(`${back}${sep}error=connect_failed`);

  const listed = await zernio.listAccounts();
  if (!listed.ok) {
    console.error(`zernio listAccounts failed: ${listed.error}`);
    return res.redirect(`${back}${sep}error=connect_failed`);
  }
  const match = listed.data.find(
    (a) => a.profileId === acct.zernioProfileId && a.platform === platform
  );
  if (!match) return res.redirect(`${back}${sep}error=connect_incomplete`);
  await updateAccount(acct.id, {
    [platform]: { accountId: match.accountId, username: match.username ?? "" },
  } as Partial<Account>);
  res.redirect(`${back}${sep}connected=${platform}`);
});

app.get("/disconnect/:platform", async (req, res) => {
  const acct = currentAccount(req);
  if (!acct) return res.redirect("/login");
  const platform = asPlatform(req.params.platform);
  if (!platform) return res.redirect("/dashboard");
  if (!csrfOk(acct, req.query.t)) return res.status(403).send(errorPage(500, "csrf"));
  const conn = acct[platform];
  let partial = false;
  if (conn?.accountId) {
    const r = await zernio.disconnectAccount(conn.accountId);
    if (!r.ok) { partial = true; console.error(`[disconnect] Zernio removal failed for ${platform} ${conn.accountId}: ${r.error}`); }
  }
  // Clear local state whether Zernio confirmed or not — never leave a pointer to a dead connection.
  await updateAccount(acct.id, { [platform]: null } as Partial<Account>);
  logEvent(acct.id, "disconnect", `${platform}${partial ? " (Zernio unconfirmed)" : ""}`);
  res.redirect(`/dashboard?disconnected=${platform}${partial ? "&partial=1" : ""}`);
});

// ---------------------------------------------------------------------------
// Clip thumbnails + errors
// ---------------------------------------------------------------------------

app.get("/thumb/:clipId", (req, res) => {
  const clipId = req.params.clipId.toLowerCase();
  if (!UUID_RE.test(clipId)) return res.status(404).end();
  const file = resolve(clipsDir(), `${clipId}.webp`);
  if (!existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

app.use((_req, res) => {
  res.status(404).send(errorPage(404));
});

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const ref = randomBytes(3).toString("hex");
  console.error(`[error ref=${ref}] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return;
  res.status(500).send(errorPage(500, ref));
});

// ---------------------------------------------------------------------------

function providerLine(name: string, configured: boolean, hint: string): string {
  return configured ? `  ${name}: configured` : `  ${name}: not configured (${hint})`;
}

async function main() {
  await initDb();
  const fonts = registerFonts(); // brand fonts for the thumbnail compositor
  if (process.env.CF_NO_ENGINE !== "1") startEngine();
  const server = app.listen(settings.port, () => {
    console.log(`ClipFlow product running: ${settings.baseUrl}`);
    console.log(`  Port:   ${settings.port}`);
    console.log(providerLine("Zernio", settings.zernioConfigured, "set ZERNIO_API_KEY"));
    console.log(providerLine("Gemini", settings.geminiConfigured, "GEMINI_API_KEY — thumbnails locked"));
    console.log(`  Fonts:  ${fonts.length ? fonts.join(", ") : "none found (assets/fonts missing)"}`);
    console.log(providerLine("Stripe", settings.stripeConfigured, "STRIPE_SECRET_KEY + STRIPE_PRICE_ID — trials never expire"));
    if (settings.stripeConfigured && !settings.stripeWebhookConfigured) {
      console.log("          (Checkout works; add STRIPE_WEBHOOK_SECRET on a public URL for renewals/cancellations)");
    }
    console.log(providerLine("Email ", settings.mailConfigured, "RESEND_API_KEY — emails log to console"));
    // Ephemeral session secret = every restart logs everyone out. Fine on a dev
    // box; a real hazard in production, so make it impossible to miss there.
    if (settings.sessionSecretEphemeral) {
      if (process.env.NODE_ENV === "production") {
        console.warn("");
        console.warn("  ⚠️  ⚠️  ⚠️  SESSION_SECRET IS NOT SET  ⚠️  ⚠️  ⚠️");
        console.warn("  A random secret was generated for THIS process only. Every restart or");
        console.warn("  redeploy will log out ALL users. Set SESSION_SECRET to a long random");
        console.warn("  string in your environment to keep sessions across restarts.");
        console.warn("");
      } else {
        console.log("  Session: ephemeral secret (set SESSION_SECRET to persist logins across restarts)");
      }
    }
    console.log("");
    console.log(`  Stripe webhook:     ${settings.baseUrl}/webhooks/stripe`);
    console.log(`  Instagram callback: ${settings.instagramRedirectUri}`);
    console.log(`  TikTok callback:    ${settings.tiktokRedirectUri}`);
    console.log("");
    console.log("  Run `npm run doctor` for a full readiness checklist.");
  });

  // Graceful shutdown — Railway (and most hosts) send SIGTERM on redeploy/restart.
  // Stop accepting connections, let in-flight requests drain, then exit. SQLite
  // WAL keeps the DB consistent even if an engine pass is mid-write.
  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${sig} received — shutting down gracefully…`);
    server.close(() => { console.log("closed. bye."); process.exit(0); });
    setTimeout(() => { console.error("forced exit after 8s"); process.exit(0); }, 8000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
