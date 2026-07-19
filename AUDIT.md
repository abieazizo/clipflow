# ClipFlow — Audit Inventory (Phase 0)
Generated 2026-07-17 by grep against `src/server.ts` @ HEAD. This is the map the
persona gauntlet + route matrix audit against.

## 1. Routes (53)
Legend: auth=session required · CSRF=token checked · RL=rate limit (per min unless noted)

| Method | Path | Auth | CSRF | RL | Notes |
|---|---|---|---|---|---|
| GET | / | – | – | – | landing (redirects to /dashboard when logged in) |
| GET | /privacy, /terms | – | – | – | legal |
| GET | /healthz | – | – | – | plain `ok`, for Railway |
| GET/POST | /signup | – | – | 10/m/ip (POST) | weak-pw + dup-email validation |
| GET/POST | /login | – | – | 10/m/ip (POST) | |
| GET | /logout | – | – | – | clears cookie |
| GET/POST | /forgot | – | – | 5/h/ip (POST) | never reveals existence |
| GET/POST | /reset/:token | – | – | – | hashed single-use 30-min token; peek for GET |
| GET | /verify/:token | – | – | – | email verify + email-change payload |
| GET | /api/whatnot-check | ✓ | – | 15/m/acct | live Whatnot profile probe |
| GET | /api/social-avatars | ✓ | – | – | data-URI pfps (CSP-safe) |
| GET | /welcome (+2 POSTs) | ✓ | ✓ (POSTs) | – | 4-step wizard |
| GET | /dashboard | ✓ | – | – | confirms Stripe session on return |
| POST | /settings | ✓ | ✓ | – | legacy full form + JSON branches onlyMode/onlyCaption/onlyUsername/onlyPause |
| POST | /check | ✓ | ✓ | 6/m/acct | manual engine pass; in-flight lock; paused guard |
| POST | /account/password,/email,/resend-verification,/delete | ✓ | ✓ | resend 3/h | delete = Zernio disconnect-all + Stripe cancel + cascade |
| GET | /billing · POST /billing/checkout,/portal | ✓ | ✓ (POSTs) | – | Stripe Checkout/Portal |
| POST | /webhooks/stripe | – (signed) | HMAC | – | raw body, signature verified |
| GET | /history · POST /history/retry/:id | ✓ | ✓ (POST) | – | ownership-checked |
| GET | /guide, /status | ✓ | – | – | |
| GET | /thumbnails | ✓ | – | – | Show Covers studio (locked state w/o key) |
| POST | /thumbnails/headline | ✓ | ✓ | 10/m | AI writer |
| POST | /thumbnails/cutout | ✓ | ✓ | 20/m | 16mb json; stores cutout |
| POST | /thumbnails/clone | ✓ | ✓ | 10/m | whatnot.com-whitelisted URL fetch |
| POST | /thumbnails/generate | ✓ | ✓ | daily cap THUMBS_PER_DAY | 2 variations |
| POST | /thumbnails/keep/:id,/regen/:id,/delete/:id | ✓ | ✓ | – | UUID + ownership |
| GET | /thumb-cutout/:file, /thumb-gen/:file | ✓ | – | – | UUID + ownership + extension whitelist |
| GET | /admin · POST /admin/toggle/:id | ✓ admin | ✓ (POST) | – | 404-invisible to non-admins |
| GET | /connect/:platform (+callback) | ✓ | ✓ (t=) | 10/m | Zernio OAuth boundary |
| GET | /disconnect/:platform | ✓ | ✓ (t=) | – | Zernio DELETE + local clear |
| GET | /thumb/:clipId | – | – | – | clip thumbnail webp (public, UUID-gated) |
| * | 404 + error handler | – | – | – | branded pages, error refs |

Session cookie: `cf_session` = HMAC-signed, HttpOnly, SameSite=Lax, Secure iff BASE_URL https, 30-day, rotated on login/reset.

## 2. Pages × states
- landing `/`: logged-out only (else redirect).
- auth pages: error banner variants (wrong creds, rate-limited, weak pw, dup email).
- wizard: steps 1–4, skip, back, connected/error flash.
- dashboard: locked-banner (no card) / past-due banner / verify banner / paused / manual vs auto pill / empty clips (mode-aware copy + Check) / clips grid (placeholder fallback) / settings 3 cards (preset selected variants, custom editor) / account.
- covers studio: locked (no key) / studio (wall|poster, clip-hero, uploads, clone) / chooser modal / gallery empty+cards.
- history: empty / rows / filter failed / retry pending states.
- billing: dev (no Stripe) / locked / trial / active / past_due states.
- status, guide, privacy, terms, goodbye, 404, 500(ref).

## 3. Env vars (canonical — appconfig/env greps)
Required in prod: `PORT` (Railway injects), `BASE_URL`, `SESSION_SECRET`, `ZERNIO_API_KEY`, `WN_DATA_DIR`, `WN_CLIPS_DIR`.
Optional: `GEMINI_API_KEY` (+`GEMINI_MODEL`,`GEMINI_TEXT_MODEL`,`GEMINI_VISION_MODEL`,`THUMBS_PER_DAY`,`THUMBS_QA`), `STRIPE_SECRET_KEY`,`STRIPE_PRICE_ID`,`STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,`MAIL_FROM`, `ADMIN_EMAIL`, `WN_POLL_SECONDS`,`WN_MAX_PER_PASS`,`WN_DRY_RUN`,`CF_NO_ENGINE`, `ZERNIO_API_BASE`, `DOTENV_PATH`.
Legacy (CLI mode only, ignored by server): `WN_USER`, `WN_USERS_FILE`, `WN_DASHBOARD_PORT`.
Cross-check result: `.env.example` was missing THUMBS_PER_DAY/THUMBS_QA (fixed);
DEPLOY.md was missing the entire optional business set (fixed in Phase 4 runbook).

## 4. DB schema (data/clipflow.db, WAL)
- `accounts`: id, email, passwordHash, createdAt, whatnotUsername, captionTemplate,
  captionPreset('hype'|'chill'|'minimal'|'custom'), hashtags(json), enabled, onboardedAt,
  zernioProfileId, instagram(json), tiktok(json), emailVerifiedAt, plan, trialEndsAt,
  stripeCustomerId, stripeSubscriptionId, subscriptionStatus, isAdmin, disabled,
  deletedAt, lastFailureEmailAt, trialEmailSentAt, postingMode('manual'|'auto'), lastCheckedAt.
  All columns read/written by db.ts. `plan` is written but only loosely read (state
  derives from subscriptionStatus) — kept for admin display.
- `posts`: dedupe+history; unique (accountId,clipId,platform). Engine + /history read/write.
- `password_resets`: hashed single-use tokens (reset/verify/email-change).
- `events`: append-only admin log.
- JSON sidecars (per-account, under WN_DATA_DIR): thumbs-<id>.json, cutouts-<id>.json (24h purge).

## 5. Background processes
- Engine loop (engine.ts startEngine): every WN_POLL_SECONDS; auto accounts full pass,
  manual accounts retries-only; paused + locked accounts logged-skipped. Stopped by
  process exit only; `CF_NO_ENGINE=1` disables. Per-account in-flight lock shared with POST /check.
- Retry ladder: +2m/+10m/+30m/+2h, 4 attempts → failed (surfaced in /history + email digest ≤1/24h).
- Un-kept cover variations + cutouts: 24h lazy purge on list access.

## 6. Legacy/dead code (compiled but not in the server path)
`src/index.ts`, `src/config.ts`, `src/store.ts`, `src/dashboard.ts` — the original
single-user CLI mode (npm run start/once/dashboard). Harmless in dist; kept for the
CLI workflow. `plan` column semi-dead (display only). No other dead columns found.
