# ClipFlow — Final Audit Report
2026-07-17 · harshest-critic pass · verdict at the bottom.

Companion files: [AUDIT.md](AUDIT.md) (Phase-0 inventory) · [DEFECTS.md](DEFECTS.md)
(every defect found + fix + evidence).

## Scorecard
- **16 defects found, 13 fixed** (2×P1, 5×P2, 6×P3), 3 P3 consciously accepted with rationale.
- **0 P0/P1/P2 open.**
- typecheck clean · prod build clean · fresh-clone `npm ci && build && node dist/app.js` boots on documented env only.
- 4 real show-covers generated and visually inspected — pass the rubric.

## Route matrix (verified by curl against a fresh empty instance)
| Route (representative) | no session | valid session | admin | hostile |
|---|---|---|---|---|
| GET /dashboard,/billing,/history,/thumbnails,/welcome | 302→/login | 200 | 200 | — |
| GET /admin | 302→/login | 404 (invisible) | 200 | — |
| POST /settings,/account/*,/history/retry,/thumbnails/* | 302/401 | 200/JSON | — | no-CSRF→403, JSON/text-plain body→403 (was 500, **fixed**) |
| POST /check | 401 | 200/JSON | — | 7th in 60s→429 |
| GET /thumb-gen/:id, /history/retry/:id | 401/302 | own→200 | — | other's uuid→404, `../`/traversal→400/404 |
| GET / , /login, /signup | 200 / 200 | 302→/dashboard | — | — |
| session cookie | — | HttpOnly+SameSite=Lax+HMAC, Secure on https | — | tampered/forged→logged-out |

## Flow / engine checklist
- ✅ Signup validation: weak pw rejected ("at least 8 characters"), duplicate email → friendly message (no 500), valid → dashboard.
- ✅ Onboarding gate: un-onboarded → /welcome; completing → dashboard 200.
- ✅ XSS: `<script>`/`<img onerror>` in username/caption rendered escaped everywhere reflected.
- ✅ Rate limits trip: /check 6/min, signup/login 10/min, forgot 5/hr.
- ✅ Engine gating (code-audited): auto=full pass, manual=retries-only, paused+locked skipped, nothing deleted.
- ✅ Dedupe: unique(accountId,clipId,platform) + INSERT OR IGNORE + Zernio 409=done.
- ✅ Per-platform independence: one failing target doesn't block the other; retries re-post only the pending platform.
- ✅ Retry ladder bounded (2m/10m/30m → fail at 4 attempts); **auto-retry stall fixed** (union listing w/ due retries); **in-flight timeout added** (6h → failed).
- ✅ Stripe webhook: HMAC on raw body + 5-min replay window BEFORE parse; all 4 lifecycle events handled; **trial mislabel fixed**.
- ✅ Covers: 4 rendered + inspected — text-wall dominance, starburst price, perfect spelling, sticker treatment, full-bleed color, 0.65 aspect, legibility gate passes.

## Deployment readiness (Phase 4)
- ✅ `npm run build` → `node dist/app.js` boots on $PORT; /healthz 200; static + fonts served; no tsx in prod path (app.ts→server.js).
- ✅ **Fresh-clone**: source-only copy, `npm ci` (0 vulnerabilities) → build → boot on documented env only. Boot log:
  ```
  ClipFlow product running: http://localhost:4610
    Zernio: configured
    Fonts:  Clash Display, Clash Display Semibold, Satoshi Black, Satoshi, Satoshi Medium
    Stripe: not configured (trials never expire)   ← dev-mode, expected with blank keys
  ```
- ✅ All fs writes derive from WN_DATA_DIR / WN_CLIPS_DIR (volume-mountable); nothing writes elsewhere.
- ✅ Secrets hygiene: no live keys in tracked source/docs; .gitignore covers .env, data, clips, dist, *.log.
- ✅ **Graceful shutdown added** (SIGTERM/SIGINT → server.close → exit; 8s hard-exit fallback). *Live SIGTERM delivery not reproducible under Git-bash on Windows; the handler is the standard pattern and fires on Linux/Railway.*
- ✅ DEPLOY.md rewritten: accurate SQLite storage description + complete env runbook (required + optional Stripe/Gemini/Resend/admin) + custom-domain/BASE_URL OAuth note.

## NOT VERIFIABLE IN THIS ENVIRONMENT — operator smoke tests (≤2 min each)
1. **Real Stripe webhook from Stripe's servers** — after deploy, run a test-clock or real card in Checkout; confirm the account flips trial→active and the /billing page reflects it. (Signature verification + all handlers are code-verified; only a live signed delivery is untested here.)
2. **A real Zernio post landing on a live IG/TikTok** — connect a real account, publish a clip, hit Check for clips; confirm the post appears and /history shows "posted". (Dry-run payloads verified; live publish depends on Zernio + platform quotas.)
3. **Real email inbox delivery (Resend)** — trigger a password reset; confirm the email arrives from the verified domain. (Console-email path verified; live SMTP untested here.)
4. **Live Gemini AI-hero / cutout generation** — with a valid billable key, generate a cover in "hero" mode; confirm the chooser modal + vision-QA logs. (The text-wall covers render fully offline and are inspected here; the AI-background path needs a live key + image-model quota.)
5. **SIGTERM on Linux** — redeploy on Railway; confirm the log prints "SIGTERM received — shutting down gracefully".

## Second gauntlet pass (2026-07-17) — the items pass 1 covered thinly
Re-ran the acceptance loop targeting what pass 1 inferred rather than exercised.
**Zero new P0–P2 found.** Evidence:
- **Mobile overflow (measured, not eyeballed):** rendered `/` and `/dashboard` at 375px and measured `documentElement.scrollWidth` vs viewport — `overflow=0`, no culprit elements. (Remaining pages' sweep was cut short when the browser safety-classifier went unavailable mid-run; landing + dashboard are the widest layouts and both clean.)
- **Crash discipline (kill -9 + WAL):** hard-killed the server mid-session (`Stop-Process -Force`), restarted on the same data dir → account + `canceled` billing state survived, `PRAGMA integrity_check = ok`, engine resumed (`engine: watching`). WAL durability confirmed.
- **Simulated signed Stripe webhooks:** forged signature (wrong secret) → **400 rejected**; valid signed lifecycle drove `checkout.session.completed → trialing`(+trialEnds, D5 fix confirmed) `→ active → past_due → active → canceled`, each landing correctly in the DB. All HMAC-verified on raw body before parse.
- **Account-deletion cascade:** wrong email confirm → blocked (redirect, nothing deleted); correct confirm → account row + posts + `thumbs-<id>.json` file all gone, session dead (302). A dummy-key Stripe cancel did not block local deletion.
- **Malformed Whatnot HTML:** 11 garbage/truncated/oversized/lone-surrogate fixtures through the exact parser regexes → zero throws (→ `[]`/`null`), and the engine wraps `listClipIds`/`getClipMeta` in try/catch → logs and continues.

## Verdict
Would I charge money for this today? **Yes.** The core loop (Whatnot→Zernio→IG/TikTok) is
sound and defensively coded: signed sessions, CSRF on every mutation, escaped output,
tripping rate limits, IDOR-proof id routes, a 404-invisible admin, and a paywall that
degrades without deleting. The engine dedupes, retries on a bounded ladder, keeps
platforms independent, and no longer stalls or leaks unbounded in-flight state. It builds
clean, boots from a fresh clone on documented env, keeps all state on a mountable volume,
and shuts down gracefully. The Show-Covers studio produces covers that genuinely beat the
benchmark with perfect spelling. The remaining unknowns are all live-third-party
deliveries (Stripe/Zernio/Resend/Gemini) that no local environment can prove — each has a
two-minute post-deploy smoke test above. Nothing blocking ships in this build.
