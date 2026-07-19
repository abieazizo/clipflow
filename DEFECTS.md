# ClipFlow — Defect Ledger (Final Audit)
Severity: P0 blocker · P1 bad · P2 rough · P3 nit. Status: OPEN → FIXED (evidence).

**Two gauntlet passes run. Pass 1: 16 found, 13 fixed, 3 P3 accepted. Pass 2
(crash/WAL, signed webhooks, deletion cascade, garbage HTML, measured mobile
overflow): ZERO new P0–P2.** Acceptance loop is clean. See REPORT.md for the
pass-2 evidence.

**Master polish pass (2026-07-19): premium UI + deploy hardening.** Self-hosted
woff2 fonts (Fontshare CDN removed), layered elevation, aurora, hover-guarded
motion, 44px tap targets, dashboard IA reorder + empty-username promotion, UUID
leak fixed, OAuth→"secure sign-in", 4 dead files deleted, thumbnail-delete 404,
loud prod SESSION_SECRET warning, designed 404/500, OG image. An adversarial
multi-agent review then found 6 confirmed P2/P3 nits (selector collisions, coarse
tap targets, webkit fallback) — **all fixed**. Full ledger + evidence in
PREMIUM-POLISH.md.

## Hostile tester (Persona 3)

### D1 — [P2] POST with unparsed content-type crashes (500) instead of clean reject
- **Where:** every route reading `req.body.X` directly; global parser is only `express.urlencoded`. A POST with `Content-Type: application/json` (or none) leaves `req.body === undefined` → `req.body.csrf` throws `TypeError: Cannot read properties of undefined` → 500 error page (ref logged).
- **Evidence:** `POST /settings` with JSON body → `[error ref=6ad432] TypeError: Cannot read properties of undefined (reading 'csrf')` at server.js:474.
- **Fix:** guard middleware after the parsers normalises `req.body` to `{}` (server.ts ~line 113). Never clobbers a parsed body (Stripe raw route, cutout/clone json unaffected).
- **Status:** FIXED — re-test: JSON `POST /settings`→403, JSON `POST /check`→403, text/plain `POST /account/password`→403 (all clean CSRF-reject, no 500). typecheck+build clean.

## Engine / billing (Persona 5 + engine auditor)

### D2 — [P2] No SIGTERM graceful shutdown
- **Where:** src/server.ts main() — Railway sends SIGTERM on every deploy; app exited abruptly.
- **Fix:** capture the http.Server, add SIGTERM/SIGINT handlers that server.close() then exit; hard-exit fallback after 8s.
- **Status:** FIXED (see D-block below).

### D3 — [P2] Auto accounts stall retries for clips that scroll off the Whatnot listing
- **Where:** engine.ts processAccount full-pass — `ids = listClipIds(uname)` only; a due retry on an older clip no longer listed never advanced its ladder (stuck `pending` forever). Manual mode was unaffected.
- **Fix:** union the listing with clipIds of pending posts that have a due retry or in-flight Zernio id.
- **Status:** FIXED.

### D4 — [P2] In-flight Zernio posts never time out (unbounded `pending`)
- **Where:** engine.ts Phase-1 else branch only logged "still publishing"; a post Zernio never resolves polled forever.
- **Fix:** IN_FLIGHT_MAX_AGE_MS = 6h; older in-flight rows marked `failed` (surfaced in /history + digest).
- **Status:** FIXED.

### D5 — [P3] checkout.session.completed mislabels the 7-day trial as `active` (no trialEndsAt)
- **Where:** billing.ts webhook — only bites if the webhook lands before the dashboard-return confirm.
- **Fix:** record `trialing` + provisional trialEndsAt (now+TRIAL_DAYS); confirm path / subscription.updated correct it exactly.
- **Status:** FIXED.

### D6 — [P3] `canceled` subscription shows as generic "locked" (no distinct state)
- **Where:** db.accountState — canceled falls through to `locked`.
- **Decision:** ACCEPTED AS-IS. isActive() correctly returns false (posting halts), and the "locked / add a card" CTA is the correct next action for a canceled user. Adding a state risked billing-view exhaustiveness for zero functional gain. Documented, not changed.

### D7 — [P3] retry `+2h` rung never reached; failure digest keys on createdAt not failure-time; listPosts capped at 400
- **Decision:** ACCEPTED for a solo-seller scale (≤ dozens of clips/day). Noted for future; no user-visible impact at current scale.

## Copy / a11y / design (Persona 4 + 1)

### D8 — [P1] Mobile chooser hid the 2nd cover variation (`display:none`)
- **Where:** styles.css @media 560px `.chooser-card:nth-child(2){display:none}` — defeated the compare-two-variations feature and violated the "both variations visible, no scroll" gate.
- **Fix:** keep 2-column side-by-side on phones (shrunk, smaller button text) so both show without scroll.
- **Status:** FIXED.

### D9 — [P1] Landing pricing self-contradiction ("Free while in early access" vs $19/mo card-first)
- **Fix:** CTA sub now "1 week free, then $19/mo — cancel anytime." Matches billing.
- **Status:** FIXED.

### D10 — [P1/P2] Leftover "AI thumbnails"/"thumbnail" in customer-facing pricing, billing, aria-labels, alt text, modals, legal, goodbye
- **Fix:** all user-facing strings → "cover"/"AI show covers"/"Show Covers" (internal route `/thumbnails`, NavKey, fn name, comments left as-is). Grep-verified zero remaining user-facing "thumbnail".
- **Status:** FIXED.

### D11 — [P2] Undefined token `var(--font-body)` on `.price-per`
- **Fix:** → `var(--font-ui)`. **Status:** FIXED.

### D12 — [P2] Segmented controls used contradictory ARIA (radiogroup+aria-pressed; tablist+plain buttons)
- **Fix:** mode + layout segments → `role="radio"`+`aria-checked` (JS toggles aria-checked); preview switcher → `role="group"` toggle buttons.
- **Status:** FIXED.

### D13 — [P2] Low contrast: `--text-faint` ~3.8:1; white-on-accent active segment ~3.1:1
- **Fix:** `--text-faint` #6B6C75→#8C8D97 (≈5:1); active segment text → dark #1A0B07 on accent (matches primary buttons).
- **Status:** FIXED.

### D14 — [P2] Touch tap targets < 44px (`.btn-sm`, `.btn-icon` at 32px)
- **Fix:** `@media (pointer:coarse)` bumps both to ≥44px.
- **Status:** FIXED.

### D15 — [P3] `.upload-spin` not motion-guarded; `.clone-status` wrong hex fallback
- **Fix:** added `.upload-spin` to reduced-motion `animation:none`; `.clone-status` → `var(--success)` (dropped stale #4ec38a).
- **Status:** FIXED.

### D16 — [P3] Dead CSS (`.hero-mock*`, `.steps-grid*`, `.variations*`, `.field-badge`), operator dev-speak on locked states, empty-state actions
- **Decision:** ACCEPTED. Dead CSS is inert (no runtime cost, removal risk > benefit); dev-speak only shows before the operator configures keys (invisible to sellers on a live deploy). Noted.
