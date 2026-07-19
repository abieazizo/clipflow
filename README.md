# ClipFlow — Whatnot → Instagram + TikTok auto-clipper

Seller taps **clip + publish** on their phone during a Whatnot show. ClipFlow does
everything after: finds the published clip, grabs the vertical MP4, and publishes
it to their Instagram (Reel) and TikTok with a caption — automatically, for one
seller or many.

Publishing goes through **Zernio** (zernio.com): sellers connect their accounts
via Zernio's hosted OAuth from the ClipFlow dashboard, and one API call posts to
both platforms. ClipFlow never sees platform passwords or tokens.

## How it works
1. **Watch** — polls each seller's public clips page (no login).
2. **Extract** — pulls the CloudFront **signed** MP4 URL from the page (no auth).
3. **Download** — saves the 9:16 MP4 + thumbnail + title (dashboard + archive).
4. **Post** — one Zernio `POST /posts` with the signed MP4 URL publishes the
   Instagram Reel and the TikTok. No re-hosting, no upload.
5. **Remember** — per-clip, per-platform status in `data/seen-<user>.json` so
   nothing posts twice.

## Quick start (hosted app)
```bash
npm install
cp .env.example .env        # paste ZERNIO_API_KEY (see CREDENTIALS.md)
npm run app                 # http://localhost:4400
```
Sign up, set your Whatnot username, connect Instagram + TikTok, flip **Active**.

```bash
npm run doctor              # ✅/❌ readiness checklist
npm run check:zernio        # dry-run wiring check (no key needed)
WN_DRY_RUN=1 npm run app    # simulate: log payloads, post nothing
```

## Deploying
See **DEPLOY.md** (Railway: `npm run build` → `npm run start:prod`, persistent
volume at `/data`, health check `/healthz`).

## Files
```
src/server.ts     the hosted app: signup/login, dashboard, settings, connect
src/views.ts      server-rendered UI (landing, auth, dashboard, legal)
src/engine.ts     background loop: watch -> download -> post -> remember
src/zernio.ts     Zernio API client (profiles, connect, accounts, posts)
src/db.ts         account datastore (data/accounts.json)
src/appconfig.ts  operator settings from env (.env via src/env.ts)
src/whatnot.ts    watch + extract signed MP4/title/thumbnail   (proven)
src/download.ts   download the signed MP4                       (proven)
src/store.ts      per-clip per-platform dedupe
src/caption.ts    caption from title + template
src/poster.ts     publish one clip via Zernio
src/doctor.ts     readiness checklist        (npm run doctor)
src/check-zernio.ts  dry-run wiring check    (npm run check:zernio)
src/index.ts      legacy standalone watcher (download only)
src/dashboard.ts  legacy local status page
```

## Env
`PORT` (4400) · `BASE_URL` · `SESSION_SECRET` · `ZERNIO_API_KEY` ·
`WN_POLL_SECONDS` (300) · `WN_DRY_RUN` · `WN_DATA_DIR` (./data) ·
`WN_CLIPS_DIR` (./clips) · `WN_MAX_PER_PASS` (10)

## Honest limits (external rules, not bugs)
- A Whatnot clip must be **published/public** to flow (unpublished clips are skipped).
- Signed MP4 URLs **expire** — the engine posts promptly after discovery.
- Instagram publishing requires a **Business/Creator** account linked to a
  Facebook Page (Meta's rule, regardless of provider).
- Platform rate limits and video rules (H.264/AAC, 9:16, length caps) apply;
  Whatnot clips already comply.
