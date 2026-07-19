/**
 * billing.ts — Stripe via raw REST (undici), no SDK, consistent with the rest
 * of the codebase. Verified against docs.stripe.com/api: form-encoded bodies,
 * Basic auth with the secret key, Stripe-Version pinned below.
 *
 * Model: 14-day free trial (no card) starts at signup. One plan: ClipFlow Pro
 * (STRIPE_PRICE_ID). Checkout + Customer Portal are Stripe-hosted — we build
 * no card UI. Webhooks keep plan/subscriptionStatus in sync.
 *
 * With STRIPE_* unset, billing is "not configured": UI says so, trials never
 * expire (see db.isActive), and these functions return { ok:false }.
 */

import { request } from "undici";
import { createHmac, timingSafeEqual } from "node:crypto";
import { loadAppSettings } from "./appconfig.js";
import { getAccount, updateAccount, logEvent, type Account } from "./db.js";

/** Pinned so Stripe's payload shapes never change under us. */
const STRIPE_VERSION = "2024-06-20";
const API = "https://api.stripe.com/v1";

export type BillingResult = { ok: true; url: string } | { ok: false; error: string };

function cfg() {
  const s = loadAppSettings();
  return {
    key: s.stripeSecretKey,
    webhookSecret: s.stripeWebhookSecret,
    priceId: s.stripePriceId,
    baseUrl: s.baseUrl,
    configured: s.stripeConfigured,
  };
}

async function stripe(path: string, form: Record<string, string>): Promise<{ ok: boolean; json: any; status: number }> {
  const { key } = cfg();
  const res = await request(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_VERSION,
    },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.body.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { ok: res.statusCode >= 200 && res.statusCode < 300, json, status: res.statusCode };
}

/** Find-or-create the Stripe customer for an account. */
async function ensureCustomer(acct: Account): Promise<string | null> {
  if (acct.stripeCustomerId) return acct.stripeCustomerId;
  const r = await stripe("/customers", {
    email: acct.email,
    "metadata[clipflowAccountId]": acct.id,
  });
  if (!r.ok || !r.json?.id) {
    console.error(`[billing] create customer failed: ${JSON.stringify(r.json?.error ?? r.json).slice(0, 200)}`);
    return null;
  }
  await updateAccount(acct.id, { stripeCustomerId: r.json.id });
  return r.json.id;
}

/**
 * Card-first Checkout: captures a card and starts a subscription with a 1-week
 * free trial (no charge yet). Stripe handles the trial natively — after 7 days
 * it charges the card and moves the subscription to active. Card required to
 * unlock, so nothing posts until this completes.
 */
export const TRIAL_DAYS = 7;

export async function createCheckoutSession(acct: Account): Promise<BillingResult> {
  const c = cfg();
  if (!c.configured) return { ok: false, error: "Billing isn't configured yet." };
  const customer = await ensureCustomer(acct);
  if (!customer) return { ok: false, error: "Couldn't reach Stripe — try again in a moment." };
  const r = await stripe("/checkout/sessions", {
    mode: "subscription",
    customer,
    "line_items[0][price]": c.priceId,
    "line_items[0][quantity]": "1",
    // collect the card even though the 1-week trial means no immediate charge
    payment_method_collection: "always",
    "subscription_data[trial_period_days]": String(TRIAL_DAYS),
    "subscription_data[trial_settings][end_behavior][missing_payment_method]": "cancel",
    "subscription_data[metadata][clipflowAccountId]": acct.id,
    // session id in the return URL confirms the unlock without a webhook.
    success_url: `${c.baseUrl}/dashboard?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${c.baseUrl}/billing`,
    "metadata[clipflowAccountId]": acct.id,
  });
  if (!r.ok || !r.json?.url) {
    const msg = r.json?.error?.message ?? "Checkout couldn't start.";
    console.error(`[billing] checkout failed: ${msg}`);
    return { ok: false, error: msg };
  }
  return { ok: true, url: r.json.url };
}

/**
 * Confirm an upgrade on return from Checkout. Retrieves the session, and if it
 * paid, flips the account to Pro immediately — no webhook required. Idempotent.
 */
export async function confirmCheckoutSession(acct: Account, sessionId: string): Promise<boolean> {
  const c = cfg();
  if (!c.configured || !sessionId) return false;
  const res = await request(`${API}/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${c.key}:`).toString("base64")}`,
      "stripe-version": STRIPE_VERSION,
    },
  });
  const text = await res.body.text();
  let session: any = null;
  try { session = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!session || session.id !== sessionId) return false;
  // Only trust a session that belongs to this account and actually completed.
  if (session.metadata?.clipflowAccountId && session.metadata.clipflowAccountId !== acct.id) return false;
  const complete = session.status === "complete" || session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (!complete) return false;

  const sub = typeof session.subscription === "object" && session.subscription ? session.subscription : null;
  const subStatus: string = sub?.status ?? "trialing"; // 7-day trial -> trialing
  const subId = sub?.id ?? (typeof session.subscription === "string" ? session.subscription : acct.stripeSubscriptionId);
  // Stripe tells us exactly when the 1-week trial ends (unix seconds).
  const trialEndsAt = typeof sub?.trial_end === "number"
    ? new Date(sub.trial_end * 1000).toISOString()
    : acct.trialEndsAt;

  await updateAccount(acct.id, {
    plan: ["active"].includes(subStatus) ? "pro" : "trial",
    subscriptionStatus: subStatus,
    trialEndsAt,
    stripeCustomerId: typeof session.customer === "string" ? session.customer : acct.stripeCustomerId,
    stripeSubscriptionId: subId,
  });
  logEvent(acct.id, "billing", `card added on checkout return (subscription ${subStatus})`);
  return true;
}

/** Stripe Customer Portal (manage/cancel/update card). */
export async function createPortalSession(acct: Account): Promise<BillingResult> {
  const c = cfg();
  if (!c.configured) return { ok: false, error: "Billing isn't configured yet." };
  if (!acct.stripeCustomerId) return { ok: false, error: "No billing profile yet — upgrade first." };
  const r = await stripe("/billing_portal/sessions", {
    customer: acct.stripeCustomerId,
    return_url: `${c.baseUrl}/billing`,
  });
  if (!r.ok || !r.json?.url) {
    return { ok: false, error: r.json?.error?.message ?? "Couldn't open the billing portal." };
  }
  return { ok: true, url: r.json.url };
}

/** Cancel the subscription immediately (account deletion path). */
export async function cancelSubscription(acct: Account): Promise<void> {
  const c = cfg();
  if (!c.configured || !acct.stripeSubscriptionId) return;
  const res = await request(`${API}/subscriptions/${encodeURIComponent(acct.stripeSubscriptionId)}`, {
    method: "DELETE",
    headers: {
      authorization: `Basic ${Buffer.from(`${c.key}:`).toString("base64")}`,
      "stripe-version": STRIPE_VERSION,
    },
  });
  console.log(`[billing] cancel subscription ${acct.stripeSubscriptionId} -> HTTP ${res.statusCode}`);
  await res.body.text().catch(() => "");
  logEvent(acct.id, "subscription_cancelled", acct.stripeSubscriptionId ?? undefined);
}

// ---------------------------------------------------------------------------
// Webhook — raw body + signature verification (Stripe-Signature: t=..,v1=..)
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(rawBody: Buffer, sigHeader: string): boolean {
  const c = cfg();
  if (!c.webhookSecret) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => p.split("=", 2) as [string, string])
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  // 5-minute tolerance against replay
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", c.webhookSecret)
    .update(`${t}.${rawBody.toString("utf8")}`)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Map a webhook event onto the account's billing state. */
export async function handleWebhookEvent(event: any): Promise<void> {
  const type: string = event?.type ?? "";
  const obj = event?.data?.object ?? {};

  const findAccount = async (): Promise<Account | null> => {
    const byMeta = obj?.metadata?.clipflowAccountId;
    if (byMeta) {
      const a = getAccount(byMeta);
      if (a) return a;
    }
    const customer = typeof obj?.customer === "string" ? obj.customer : null;
    if (customer) {
      const { listAccounts } = await import("./db.js");
      return listAccounts().find((a) => a.stripeCustomerId === customer) ?? null;
    }
    return null;
  };

  const acct = await findAccount();
  if (!acct) {
    console.log(`[billing] webhook ${type}: no matching account — ignored`);
    return;
  }

  switch (type) {
    case "checkout.session.completed": {
      // Card-first checkout always opens a 7-day trial. If this webhook lands
      // before the dashboard-return confirm, record it as trialing with a
      // provisional trial-end (the subsequent subscription.updated event, or the
      // confirm path, corrects trialEndsAt from the real sub.trial_end).
      const provisionalTrialEnd = acct.trialEndsAt ?? new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();
      await updateAccount(acct.id, {
        plan: "pro",
        subscriptionStatus: acct.subscriptionStatus === "active" ? "active" : "trialing",
        trialEndsAt: provisionalTrialEnd,
        stripeCustomerId: typeof obj.customer === "string" ? obj.customer : acct.stripeCustomerId,
        stripeSubscriptionId: typeof obj.subscription === "string" ? obj.subscription : acct.stripeSubscriptionId,
      });
      logEvent(acct.id, "billing", "checkout completed — trial active");
      break;
    }
    case "customer.subscription.updated": {
      await updateAccount(acct.id, {
        subscriptionStatus: obj.status ?? acct.subscriptionStatus,
        stripeSubscriptionId: obj.id ?? acct.stripeSubscriptionId,
        plan: ["active", "trialing"].includes(obj.status) ? "pro" : acct.plan,
      });
      logEvent(acct.id, "billing", `subscription ${obj.status}`);
      break;
    }
    case "customer.subscription.deleted": {
      await updateAccount(acct.id, { subscriptionStatus: "canceled", plan: "trial" });
      logEvent(acct.id, "billing", "subscription deleted");
      break;
    }
    case "invoice.payment_failed": {
      await updateAccount(acct.id, { subscriptionStatus: "past_due" });
      logEvent(acct.id, "billing", "payment failed");
      break;
    }
    default:
      // Unhandled event types are fine — we only track the lifecycle ones.
      break;
  }
}
