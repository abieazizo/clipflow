/**
 * mailer.ts — transactional email via Resend's REST API (undici, no SDK).
 *
 * Env: RESEND_API_KEY + MAIL_FROM ("ClipFlow <hello@yourdomain.com>").
 * Without a key, every email logs to the console instead — dev mode keeps
 * every flow (reset links, verification) fully usable from the terminal.
 */

import { request } from "undici";

const RESEND_API = "https://api.resend.com/emails";

function apiKey(): string {
  return (process.env.RESEND_API_KEY ?? "").trim();
}

function from(): string {
  return (process.env.MAIL_FROM ?? "ClipFlow <onboarding@resend.dev>").trim();
}

export function mailConfigured(): boolean {
  return Boolean(apiKey());
}

/** Branded minimal HTML shell: wordmark, dark-on-light, one button. */
function template(opts: { heading: string; body: string; ctaLabel?: string; ctaUrl?: string; footer?: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f6;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px;">
  <tr><td style="font-size:20px;font-weight:800;color:#0a0a0c;padding-bottom:20px;">
    Clip<span style="color:#FF5A3C;">Flow</span>
  </td></tr>
  <tr><td style="font-size:22px;font-weight:700;color:#0a0a0c;padding-bottom:12px;">${opts.heading}</td></tr>
  <tr><td style="font-size:15px;line-height:1.6;color:#3d3e46;padding-bottom:24px;">${opts.body}</td></tr>
  ${opts.ctaUrl ? `<tr><td style="padding-bottom:24px;">
    <a href="${opts.ctaUrl}" style="display:inline-block;background:#FF5A3C;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">${opts.ctaLabel ?? "Open ClipFlow"}</a>
  </td></tr>` : ""}
  <tr><td style="font-size:12px;color:#9b9ca5;line-height:1.5;">${opts.footer ?? "You're receiving this because you have a ClipFlow account."}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export interface MailInput {
  to: string;
  subject: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
}

/** Send (or console-log in dev). Never throws. */
export async function sendMail(input: MailInput): Promise<{ ok: boolean; error?: string }> {
  const html = template(input);
  if (!mailConfigured()) {
    console.log(`\n[mail:dev] To: ${input.to}\n[mail:dev] Subject: ${input.subject}\n[mail:dev] ${input.body.replace(/<[^>]+>/g, "")}${input.ctaUrl ? `\n[mail:dev] Link: ${input.ctaUrl}` : ""}\n`);
    return { ok: true };
  }
  try {
    const res = await request(RESEND_API, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
      body: JSON.stringify({ from: from(), to: [input.to], subject: input.subject, html }),
    });
    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.error(`[mail] send failed HTTP ${res.statusCode}: ${text.slice(0, 200)}`);
      return { ok: false, error: `HTTP ${res.statusCode}` };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[mail] send failed: ${(e as Error).message}`);
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// The five product emails
// ---------------------------------------------------------------------------

export function verifyEmail(to: string, url: string): MailInput {
  return {
    to,
    subject: "Verify your ClipFlow email",
    heading: "One tap to verify",
    body: "Confirm this is your email and your account is all set. The link works for 24 hours.",
    ctaLabel: "Verify email",
    ctaUrl: url,
  };
}

export function resetEmail(to: string, url: string): MailInput {
  return {
    to,
    subject: "Reset your ClipFlow password",
    heading: "Reset your password",
    body: "Someone (hopefully you) asked to reset your ClipFlow password. This link works once, for 30 minutes. If it wasn't you, ignore this email — nothing changes.",
    ctaLabel: "Choose a new password",
    ctaUrl: url,
  };
}

export function postFailedEmail(to: string, count: number, historyUrl: string): MailInput {
  return {
    to,
    subject: `ClipFlow: ${count === 1 ? "a post" : `${count} posts`} need${count === 1 ? "s" : ""} attention`,
    heading: "Some posts didn't go out",
    body: `${count === 1 ? "One of your clips" : `${count} of your clips`} couldn't be posted after several tries. Open your history to see what happened and retry with one click.`,
    ctaLabel: "Open post history",
    ctaUrl: historyUrl,
  };
}

export function trialEndingEmail(to: string, daysLeft: number, billingUrl: string): MailInput {
  return {
    to,
    subject: `Your ClipFlow trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
    heading: `${daysLeft} day${daysLeft === 1 ? "" : "s"} left on your trial`,
    body: "Your clips keep posting until it ends — upgrade to Pro and don't miss a single one. Your settings, history, and connections are safe either way.",
    ctaLabel: "Upgrade to Pro",
    ctaUrl: billingUrl,
  };
}

export function paymentFailedEmail(to: string, billingUrl: string): MailInput {
  return {
    to,
    subject: "ClipFlow: payment didn't go through",
    heading: "Your payment needs a look",
    body: "Stripe couldn't charge your card. Update your payment method to keep posting uninterrupted — your account and history are untouched.",
    ctaLabel: "Fix payment",
    ctaUrl: billingUrl,
  };
}
