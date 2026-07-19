# ClipFlow — Credentials & Go-Live

Publishing goes through **Zernio** (zernio.com): one API key replaces the old
Meta + TikTok developer apps, and Zernio hosts the Instagram/TikTok OAuth.
The only manual step left is getting that key.

---

## TL;DR

1. Sign up at **zernio.com** → dashboard → create an **API key** (`sk_…`).
2. Paste it into `.env` as `ZERNIO_API_KEY=sk_…`.
3. `npm run doctor` to confirm it loaded → restart `npm run app`.
4. In the dashboard, click **Connect Instagram** / **Connect TikTok** and
   authorize — Zernio handles the platform OAuth and sends you back.

## Where the key goes — `.env`

```dotenv
ZERNIO_API_KEY=sk_your_key_here
```

`npm run doctor` prints a ✅/❌ readiness checklist any time. The old
`META_*` / `TIKTOK_*` variables are no longer read (they're kept commented in
`.env` only as a historical note).

## Platform requirements (seller-side, one-time)

- **Instagram** — must be a **Business/Creator** account linked to a
  **Facebook Page**. That's Meta's rule for API publishing, regardless of
  provider; the dashboard shows this note under the Instagram card.
- **TikTok** — any account; authorize when Zernio's OAuth screen appears.

## Verifying without a key

`npm run check:zernio` runs the wiring in dry-run (no network): it prints the
exact connect URL sellers get redirected to and the exact `POST /posts`
payload, with structural ✅ checks. `WN_DRY_RUN=1 npm run app` runs the whole
app in simulate mode — the engine logs payloads instead of posting.

## Optional: AI Thumbnail Studio (Gemini)

The Thumbnail Studio generates 9:16 clip covers with Google Gemini. To unlock:

1. Create a free API key at **aistudio.google.com** (API keys section).
2. Paste it into `.env` as `GEMINI_API_KEY=…`
3. Restart `npm run app` — the studio unlocks instantly (`npm run doctor` confirms).

Leave it blank and the studio simply shows a locked card — nothing breaks.

## Deploying

See **DEPLOY.md** for Railway (build/start commands, env vars, persistent
volume at `/data`).
