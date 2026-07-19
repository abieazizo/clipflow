# Deploying ClipFlow to Railway

ClipFlow is a single Node service: the Express app + the background posting
engine run in one process. Storage is a SQLite database (WAL mode) plus
downloaded clip files, both on a persistent volume. No database add-on needed.

## 1. Service setup

| Setting           | Value                |
|-------------------|----------------------|
| **Build command** | `npm run build`      |
| **Start command** | `npm run start:prod` (`node dist/app.js`) |
| **Health check**  | `GET /healthz` (returns `200 ok`) |

Railway injects `PORT` automatically; the app listens on it. It also sends
`SIGTERM` on every redeploy — the app drains in-flight requests and exits
cleanly (SQLite WAL keeps the DB consistent).

## 2. Environment variables

### Required
| Variable         | Value / where to get it                                     |
|------------------|--------------------------------------------------------------|
| `SESSION_SECRET` | **Set this first.** Any long random string (e.g. `openssl rand -hex 32`). If you leave it blank, the app generates a throwaway secret per process and **every restart or redeploy logs out all users** — the boot log prints a loud ⚠️ warning when this happens under `NODE_ENV=production`. |
| `ZERNIO_API_KEY` | Zernio API key — zernio.com dashboard → API keys            |
| `BASE_URL`       | the public app URL, e.g. `https://clipflow-production.up.railway.app` (no trailing slash) |
| `NODE_ENV`       | `production` (enables the Secure-cookie/secret-warning production behavior) |
| `WN_DATA_DIR`    | `/data`                                                      |
| `WN_CLIPS_DIR`   | `/data/clips`                                                |

`BASE_URL` drives everything public: the Zernio connect `redirect_url`s and
Secure cookies (https ⇒ the session cookie gets the `Secure` flag automatically).

### Optional — billing (blank = dev mode, trials never expire, nothing is paywalled)
| Variable                | Value / where to get it                              |
|-------------------------|------------------------------------------------------|
| `STRIPE_SECRET_KEY`     | Stripe dashboard → Developers → API keys (`sk_live_…`) |
| `STRIPE_PRICE_ID`       | create a "ClipFlow Pro" **$19/mo recurring** price, paste its `price_…` id |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → add endpoint `<BASE_URL>/webhooks/stripe` with events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`; paste its `whsec_…` |

Without the webhook secret, Checkout still works and the account unlocks on
return from Stripe (via `?session_id`); the webhook only matters for renewals
and cancellations that happen later.

### Optional — AI Show Covers (blank = the studio shows a locked state)
| Variable          | Value / where to get it                                   |
|-------------------|-----------------------------------------------------------|
| `GEMINI_API_KEY`  | free key from aistudio.google.com (needs billing enabled on the Google project for image models) |
| `THUMBS_PER_DAY`  | daily cover-generation cap per seller (default `10`)       |
| `THUMBS_QA`       | `1` runs the vision QA loop (default on); `0` disables it  |
| `GEMINI_MODEL` / `GEMINI_TEXT_MODEL` / `GEMINI_VISION_MODEL` | override model ids (sensible defaults baked in) |

### Optional — email (blank = emails print to the server console)
| Variable         | Value / where to get it                                     |
|------------------|--------------------------------------------------------------|
| `RESEND_API_KEY` | Resend dashboard → API keys                                 |
| `MAIL_FROM`      | e.g. `ClipFlow <hello@yourdomain.com>` (domain must be verified in Resend) |

### Optional — misc
| Variable          | Value                                                       |
|-------------------|-------------------------------------------------------------|
| `ADMIN_EMAIL`     | the account with this email gets the `/admin` page          |
| `WN_POLL_SECONDS` | engine poll interval, default `300`                         |
| `WN_MAX_PER_PASS` | max clips handled per account per pass, default `10`         |
| `WN_DRY_RUN`      | `0` posts for real; `1` simulates posting (logs payloads)   |
| `CF_NO_ENGINE`    | `1` starts the web app WITHOUT the background engine         |

## 3. Persistent volume

Mount a Railway **volume at `/data`**. It holds:

- `/data/clipflow.db` (+ `-wal`, `-shm`) — accounts, posts (dedupe + history), tokens, events
- `/data/clips/` — downloaded MP4s + clip thumbnails
- `/data/clips/thumbs/` — generated show covers (PNG + webp) and product cutouts
- `/data/thumbs-<id>.json`, `/data/cutouts-<id>.json` — per-account cover metadata

Without a volume these reset on every deploy — sellers would vanish and
already-posted clips would post again.

## 4. First boot checklist

1. Deploy; wait for the health check to go green.
2. Open the app URL — the landing page should render.
3. Check the deploy logs: `Zernio: configured`, and the printed
   Instagram/TikTok connect + callback URLs should show your Railway domain.
4. **OAuth redirect URLs:** the Zernio connect return URLs are derived from
   `BASE_URL`, so they must point at the final public domain. If you attach a
   custom domain later, update `BASE_URL` and redeploy so the connect flow
   returns to the right place.
5. Sign up, set your Whatnot username, connect Instagram + TikTok. New accounts
   start in **manual** mode — hit **Check for clips** after publishing, or flip
   to **automatic** in the dashboard. Publish a clip on Whatnot and watch it flow.

## Local development

```bash
npm install
cp .env.example .env    # fill in ZERNIO_API_KEY (others optional)
npm run app             # tsx, http://localhost:4400
npm run doctor          # readiness checklist
npm run check:zernio    # dry-run wiring check (no network, no key needed)
```
