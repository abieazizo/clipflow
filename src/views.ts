/**
 * views.ts — server-rendered HTML for the hosted app. No framework, no build:
 * semantic markup referencing public/styles.css (design system) and
 * public/app.js (progressive enhancement — every page works with JS off).
 *
 * Structure:
 *   helpers · icons · logo · layout
 *   phone-frame illustrations (original, abstract — never Whatnot's real UI)
 *   landing · auth · onboarding wizard · app shell
 *   dashboard · thumbnails · guide · status · legal · error pages
 */

import type { Account, PostRow } from "./db.js";
import type { ClipRow } from "./engine.js";
import type { ThumbRecord } from "./thumbstore.js";
import { STYLE_SPECS, deriveSubject, type ThumbStyle, type StyleSpec } from "./gemini.js";
import { CAPTION_PRESETS, effectiveTemplate, renderTemplate } from "./caption.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

/** Safe JSON for a <script type="application/json"> island (CSP-exempt: not executable). */
function jsonIsland(id: string, data: unknown): string {
  return `<script type="application/json" id="${id}">${JSON.stringify(data)
    .replace(/</g, "\\u003c")}</script>`;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initials(email: string): string {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._\-+]/).filter(Boolean);
  const two = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return (two || "cf").toUpperCase();
}

function firstName(email: string): string {
  const raw = (email.split("@")[0] ?? "").split(/[._\-+]/)[0] || "there";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// ---------------------------------------------------------------------------
// icons — one inline set, 24px grid, stroke 1.75, round caps (Lucide-style)
// ---------------------------------------------------------------------------

const ICON_PATHS: Record<string, string> = {
  clip: '<rect x="3.5" y="5" width="17" height="14" rx="3.5"/><path d="M10.5 9.7v4.6l4.2-2.3z"/>',
  instagram:
    '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.4"/><circle cx="16.9" cy="7.1" r="1" stroke="none" fill="currentColor"/>',
  tiktok:
    '<path fill="currentColor" stroke="none" d="M14.8 3h2.9c.3 2.3 1.6 3.6 3.8 3.9v3c-1.5-.03-2.8-.5-3.9-1.3v6.1a6 6 0 1 1-6-6.1l.6.02v3.2a2.9 2.9 0 1 0 2.6 2.9V3z"/>',
  check: '<path d="m4.5 12.8 4.8 4.7L19.5 6.5"/>',
  "check-circle": '<circle cx="12" cy="12" r="8.75"/><path d="m8.4 12.3 2.5 2.5 4.7-5.4"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  settings:
    '<path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2.2"/><circle cx="8" cy="16" r="2.2"/>',
  "log-out": '<path d="M9 20.5H6.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2H9"/><path d="m15.5 16.5 4.5-4.5-4.5-4.5M20 12H9.5"/>',
  radio:
    '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M7.4 7.4a6.5 6.5 0 0 0 0 9.2M16.6 7.4a6.5 6.5 0 0 1 0 9.2"/>',
  clock: '<circle cx="12" cy="12" r="8.75"/><path d="M12 7.4V12l3 1.8"/>',
  bolt: '<path d="M13 2.5 4.8 13.4h6L10.9 21.5l8.3-10.9h-6z"/>',
  "arrow-right": '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  "external-link":
    '<path d="M13.5 5H6.7A2.2 2.2 0 0 0 4.5 7.2v10.1a2.2 2.2 0 0 0 2.2 2.2h10.1a2.2 2.2 0 0 0 2.2-2.2v-6.8"/><path d="M14 10 20.5 3.5M15 3.5h5.5V9"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  image:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m3.5 16.5 4.6-4.2 4 3.6 3.3-2.9 5.1 4.5"/>',
  sparkles:
    '<path d="M12 4.5c.6 3.3 2.2 4.9 5.5 5.5-3.3.6-4.9 2.2-5.5 5.5-.6-3.3-2.2-4.9-5.5-5.5 3.3-.6 4.9-2.2 5.5-5.5z"/><path d="M18.8 15.2c.3 1.6 1 2.3 2.7 2.7-1.7.3-2.4 1-2.7 2.7-.3-1.7-1-2.4-2.7-2.7 1.7-.4 2.4-1.1 2.7-2.7zM5.6 3.6c.3 1.4 1 2.1 2.4 2.4-1.4.3-2.1 1-2.4 2.4-.3-1.4-1-2.1-2.4-2.4 1.4-.3 2.1-1 2.4-2.4z"/>',
  copy:
    '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5.5 14.5A1.5 1.5 0 0 1 4 13V5.5A1.5 1.5 0 0 1 5.5 4H13a1.5 1.5 0 0 1 1.5 1.5"/>',
  "chevron-down": '<path d="m6 9.5 6 6 6-6"/>',
  "chevron-right": '<path d="m9.5 6 6 6-6 6"/>',
  alert:
    '<path d="M12 3.8 2.8 19.5a.8.8 0 0 0 .7 1.2h17a.8.8 0 0 0 .7-1.2z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17.2" r="0.4" fill="currentColor" stroke="none"/>',
  eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  "eye-off":
    '<path d="M4 4l16 16"/><path d="M9.9 5.2A9.3 9.3 0 0 1 12 5c6 0 9.5 7 9.5 7a17.6 17.6 0 0 1-2.9 3.8M6.3 6.9C3.8 8.8 2.5 12 2.5 12s3.5 7 9.5 7a8.5 8.5 0 0 0 4-1"/><path d="M9.9 9.9a2.9 2.9 0 0 0 4.1 4.1"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5"/><path d="M4.5 19.5h15"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3V6.5"/><path d="M6.5 6.5 7.3 19a1.8 1.8 0 0 0 1.8 1.7h5.8A1.8 1.8 0 0 0 16.7 19l.8-12.5"/><path d="M10 10.5v6M14 10.5v6"/>',
  book: '<path d="M4.5 5.5A2 2 0 0 1 6.5 3.5H19.5v15H6.5a2 2 0 0 0-2 2z"/><path d="M4.5 20.5v-15M19.5 18.5v2H6.4"/>',
  activity: '<path d="M3.5 12h4l2.5-6.5 4 13L16.5 12h4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
  scissors: '<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="M8.6 8.3 20 19M8.6 15.7 20 5"/>',
  "help-circle": '<circle cx="12" cy="12" r="8.75"/><path d="M9.4 9.2a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 3.8"/><circle cx="12" cy="17" r="0.4" fill="currentColor" stroke="none"/>',
  wand: '<path d="m5 19 9.5-9.5M13 4.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7zM18.5 10l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5zM7.5 3.5l.4 1.2 1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4z"/>',
};

function icon(name: keyof typeof ICON_PATHS | string, cls = ""): string {
  const paths = ICON_PATHS[name] ?? ICON_PATHS.alert;
  return `<svg class="icon${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/** The ClipFlow mark: a clip frame whose corner opens into a flow arc + live dot. */
function logoMark(size = 28): string {
  return `<svg class="logo-mark" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
    <path d="M23 4.5H10A5.5 5.5 0 0 0 4.5 10v12A5.5 5.5 0 0 0 10 27.5h12A5.5 5.5 0 0 0 27.5 22v-4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <path d="M20 11.5c3.5-.5 6-2.5 7.5-5.5" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>
    <circle cx="29" cy="4" r="2.6" fill="var(--accent)"/>
    <path d="M13.5 12.7v6.6l5.6-3.3z" fill="currentColor"/>
  </svg>`;
}

function wordmark(size = 28): string {
  return `<span class="wordmark">${logoMark(size)}<span class="wordmark-text">Clip<span class="wordmark-accent">Flow</span></span></span>`;
}

// ---------------------------------------------------------------------------
// profile-picture avatars — a real Whatnot pfp (filled by app.js from the
// cached /api/whatnot-check endpoint), or a platform brand avatar when
// connected, or a dashed "pending" placeholder when not.
// ---------------------------------------------------------------------------

/** Whatnot avatar: JS swaps in the real pfp; falls back to the handle's initial. */
function whatnotAvatar(uname: string, extra = ""): string {
  const initial = uname ? esc(uname.charAt(0).toUpperCase()) : "";
  return `<span class="pfp pfp-wn${extra ? " " + extra : ""}"${uname ? ` data-wn-avatar="${esc(uname)}"` : ""} aria-hidden="true"><span class="pfp-fallback">${uname ? initial : icon("radio")}</span></span>`;
}

/** Platform avatar: real pfp (JS-filled) over a brand circle when connected,
 *  dashed pending placeholder when not. */
function platformAvatar(platform: "instagram" | "tiktok", connected: boolean, extra = ""): string {
  return connected
    ? `<span class="pfp pfp-${platform}${extra ? " " + extra : ""}" data-social-avatar="${platform}" aria-hidden="true">${icon(platform)}</span>`
    : `<span class="pfp pfp-pending${extra ? " " + extra : ""}" aria-hidden="true">${icon("clock")}</span>`;
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="ClipFlow turns your Whatnot show clips into Instagram Reels and TikToks — automatically.">
<meta name="theme-color" content="#0A0A0C">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/favicon.svg">
<meta name="robots" content="index, follow">
<!-- Open Graph / Twitter — shared links show a real card, not a bare URL. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="ClipFlow">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="Clip once on Whatnot — ClipFlow posts it to Instagram Reels and TikTok automatically.">
<meta property="og:image" content="/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="Clip once on Whatnot — ClipFlow posts it to Instagram Reels and TikTok automatically.">
<meta name="twitter:image" content="/og.png">
<!-- Self-hosted brand fonts (woff2); preload the two most-used weights. -->
<link rel="preload" href="/fonts/Satoshi-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/ClashDisplay-Semibold.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
<script src="/app.js" defer></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="canvas-glow" aria-hidden="true"></div>
${body}
<div class="toast-stack" id="toast-stack" role="status" aria-live="polite"></div>
<div id="modal-root"></div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// phone-frame illustrations — ORIGINAL abstract depictions in ClipFlow's
// palette. Deliberately not Whatnot's UI: rounded-rect stand-ins, a red LIVE
// pill, chat bubbles as bars, heart particles, one highlighted control.
// ---------------------------------------------------------------------------

function phoneFrame(inner: string, cls = ""): string {
  return `
  <div class="phone${cls ? " " + cls : ""}" aria-hidden="true">
    <span class="phone-notch"></span>
    <div class="phone-screen">${inner}</div>
  </div>`;
}

/**
 * Hero — a real @squishycrew clip playing inside the phone. The poster (a real
 * frame) paints instantly; the muted looped video streams in behind the LIVE
 * pill and the glowing Clip control. This is the seller's own footage, not stock.
 */
function heroVideo(): string {
  return `
  <div class="phone phone-hero" aria-hidden="true">
    <span class="phone-notch"></span>
    <div class="phone-screen">
      <video class="ph-video" autoplay muted loop playsinline preload="metadata"
             poster="/demo/live-clip-poster.webp">
        <source src="/demo/live-clip.mp4" type="video/mp4">
      </video>
      <span class="ph-live-pill"><span class="pulse-dot"></span>LIVE</span>
      <div class="ph-rail">
        <span class="ph-rail-btn"></span>
        <span class="ph-rail-btn"></span>
        <button type="button" tabindex="-1" class="ph-clip-btn">${icon("scissors")}<span class="ph-clip-label">Clip</span></button>
      </div>
    </div>
  </div>`;
}

/** Step 1 — a real live selling frame with the Clip control glowing. */
function illoClip(): string {
  return phoneFrame(`
    <img class="ph-shot" src="/demo/live-clip-poster.webp" alt="" loading="lazy" decoding="async">
    <span class="ph-live-pill"><span class="pulse-dot"></span>LIVE</span>
    <div class="ph-rail">
      <span class="ph-rail-btn"></span>
      <span class="ph-rail-btn"></span>
      <button type="button" tabindex="-1" class="ph-clip-btn">${icon("scissors")}<span class="ph-clip-label">Clip</span></button>
    </div>`, "phone-shot");
}

/** Step 2 — a grid of real clip covers, one selected, Publish highlighted. */
function illoPublish(): string {
  const covers = ["clip-squish", "clip-mystery", "clip-allnight", "clip-needoh"];
  const cells = covers.map((c, i) =>
    `<span class="ph-cell${i === 0 ? " ph-cell-selected" : ""}"><img src="/demo/${c}.webp" alt="" loading="lazy" decoding="async">${i === 0 ? icon("check", "ph-cell-check") : ""}</span>`
  ).join("");
  return phoneFrame(`
    <div class="ph-header"><span class="ph-avatar"></span><span class="ph-header-bar"></span></div>
    <div class="ph-grid">${cells}</div>
    <span class="ph-publish">${icon("bolt")}Publish</span>`, "phone-shot");
}

/** Step 3 — a real cover flowing to Instagram + TikTok. */
function illoFlow(): string {
  return phoneFrame(`
    <div class="ph-flow">
      <span class="ph-flow-cover"><img src="/demo/clip-squish.webp" alt="" loading="lazy" decoding="async"></span>
      <svg class="ph-flow-lines" viewBox="0 0 120 150" fill="none" preserveAspectRatio="none">
        <path class="ph-dash" d="M22 44 C 66 44, 66 52, 100 52"/>
        <path class="ph-dash ph-dash-late" d="M22 44 C 60 44, 60 84, 100 84"/>
      </svg>
      <div class="ph-flow-targets">
        <span class="ph-tile ph-tile-ig">${icon("instagram")}${icon("check", "ph-tile-check")}</span>
        <span class="ph-tile ph-tile-tt">${icon("tiktok")}${icon("check", "ph-tile-check")}</span>
      </div>
    </div>`, "phone-flow");
}

interface HiwStep { n: string; title: string; caption: string; illo: () => string }

const HIW_STEPS: HiwStep[] = [
  {
    n: "01",
    title: "Tap Clip during your live",
    caption: "Mid-show, tap the Clip button like you already do — Whatnot captures the last 60 seconds.",
    illo: illoClip,
  },
  {
    n: "02",
    title: "Publish it",
    caption: "After the show, open your clips, trim if you like, and hit Publish. Published clips appear on your public profile.",
    illo: illoPublish,
  },
  {
    n: "03",
    title: "ClipFlow does the rest",
    caption: "We detect it within minutes, caption it with your template, and post it to Instagram and TikTok. Automatically.",
    illo: illoFlow,
  },
];

function howItWorksGrid(compact = false): string {
  return `
  <ol class="hiw-grid${compact ? " hiw-compact" : ""}">
    ${HIW_STEPS.map((s) => `
    <li class="hiw-step">
      ${s.illo()}
      <div class="hiw-copy">
        <span class="hiw-num" aria-hidden="true">${s.n}</span>
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.caption)}</p>
      </div>
    </li>`).join("")}
  </ol>`;
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: "Why isn't my clip showing up?",
    a: "Clips must be <strong>published</strong> on Whatnot, not just saved. Open your clips in the Whatnot app and hit Publish — private clips are invisible to everyone, including ClipFlow.",
  },
  {
    q: "How fast do posts go out?",
    a: "ClipFlow checks your public clips page about every 5 minutes. A freshly published clip is usually posted within one check.",
  },
  {
    q: "What does Instagram require?",
    a: "Your Instagram must be a <strong>Business or Creator</strong> account linked to a Facebook Page — that's Meta's rule for automated posting, regardless of which tool you use. Switching takes about 60 seconds in the Instagram app: Settings → Account type and tools → Switch to professional account.",
  },
  {
    q: "Can I edit the captions?",
    a: "Yes — Settings has a caption template with tokens: <code>{title}</code> for the clip's title, <code>{hashtags}</code> for your hashtag list, <code>{username}</code> for your Whatnot handle. There's a live preview while you type.",
  },
  {
    q: "What does this cost me on Whatnot?",
    a: "Nothing. Clips are a built-in, free Whatnot feature — ClipFlow just watches your public clips page and posts what you publish.",
  },
];

function faqAccordion(items = FAQ_ITEMS): string {
  return `
  <div class="faq">
    ${items.map((f) => `
    <details class="faq-item">
      <summary class="faq-q">${esc(f.q)}${icon("chevron-down", "faq-caret")}</summary>
      <div class="faq-a-wrap"><div class="faq-a"><p>${f.a}</p></div></div>
    </details>`).join("")}
  </div>`;
}

// ---------------------------------------------------------------------------
// landing page
// ---------------------------------------------------------------------------

export function landingPage(): string {
  const features = [
    { icon: "clip", h: "Auto-detects your published clips", p: "No uploads, no exports. Publish a clip on Whatnot and ClipFlow finds it within minutes." },
    { icon: "arrow-right", h: "Posts to Instagram + TikTok", p: "Reels and TikToks publish directly to your accounts — no exporting, no re-uploading." },
    { icon: "check-circle", h: "Your accounts stay yours", p: "You sign in securely through Instagram and TikTok themselves. We never see your password." },
    { icon: "sparkles", h: "Captions & hashtags on autopilot", p: "Set a template once — clip title, your handle, your hashtags — and every post writes itself." },
    { icon: "wand", h: "Show covers included", p: "Design covers that pack your next show — your real products, bold type, one loud colour." },
    { icon: "bolt", h: "Works while you sell", p: "You're mid-show holding a squishy to the camera. ClipFlow is already posting the last one." },
  ];

  const body = `
<header class="site-nav">
  <div class="container site-nav-inner">
    <a class="site-nav-brand" href="/" aria-label="ClipFlow home">${wordmark(26)}</a>
    <nav class="site-nav-links" aria-label="Main">
      <a href="#how">How it works</a>
      <a href="#features">Features</a>
      <a href="#pricing">Pricing</a>
      <a href="#faq">FAQ</a>
    </nav>
    <div class="site-nav-actions">
      <a class="btn btn-ghost btn-sm" href="/login">Log in</a>
      <a class="btn btn-primary btn-sm" href="/signup">Get started</a>
    </div>
  </div>
</header>

<main id="main">
  <section class="hero">
    <div class="container hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">For Whatnot sellers</p>
        <h1 class="display hero-title">Clip once.<br>Post everywhere.</h1>
        <p class="hero-sub">ClipFlow turns your Whatnot show clips into Instagram Reels and TikToks — automatically. You clip. We post.</p>
        <div class="hero-ctas">
          <a class="btn btn-primary btn-lg" href="/signup">Start free ${icon("arrow-right")}</a>
          <a class="btn btn-secondary btn-lg" href="#how">See how it works</a>
        </div>
        <p class="hero-note">${icon("check-circle")} Secure sign-in — we never see your Instagram or TikTok password.</p>
      </div>
      <div class="hero-visual">${heroVideo()}</div>
    </div>
  </section>

  <section class="section" id="how">
    <div class="container">
      <p class="eyebrow">How it works</p>
      <h2 class="display section-title">Three steps. One of them is yours.</h2>
      ${howItWorksGrid()}
    </div>
  </section>

  <section class="section" id="features">
    <div class="container">
      <p class="eyebrow">Features</p>
      <h2 class="display section-title">Built for sellers who are busy selling.</h2>
      <ul class="features-grid">
        ${features.map((f) => `
        <li class="feature-card card">
          <span class="feature-icon">${icon(f.icon)}</span>
          <h3>${esc(f.h)}</h3>
          <p>${esc(f.p)}</p>
        </li>`).join("")}
      </ul>
    </div>
  </section>

  <section class="section" id="pricing">
    <div class="container">
      <p class="eyebrow">Pricing</p>
      <h2 class="display section-title">Simple. One plan.</h2>
      <div class="pricing-grid">
        <div class="price-card card">
          <h3>Free trial</h3>
          <p class="price-num display">1 week</p>
          <p class="price-sub">Full product free for 7 days.</p>
          <ul class="price-list">
            <li>${icon("check")}Everything in Pro</li>
            <li>${icon("check")}No charge for 7 days</li>
            <li>${icon("check")}Cancel any time — no charge</li>
          </ul>
          <a class="btn btn-secondary btn-block" href="/signup">Start free</a>
        </div>
        <div class="price-card card price-card-pro">
          <span class="pill pill-live price-badge"><span class="pulse-dot"></span>ClipFlow Pro</span>
          <h3>Pro</h3>
          <p class="price-num display">$19<span class="price-per">/mo</span></p>
          <p class="price-sub">Cancel anytime from the billing portal.</p>
          <ul class="price-list">
            <li>${icon("check")}Instagram + TikTok posting</li>
            <li>${icon("check")}Unlimited clips</li>
            <li>${icon("check")}AI show covers</li>
            <li>${icon("check")}Priority support</li>
          </ul>
          <a class="btn btn-primary btn-block" href="/signup">Get started ${icon("arrow-right")}</a>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="faq">
    <div class="container faq-section">
      <p class="eyebrow">FAQ</p>
      <h2 class="display section-title">Quick answers.</h2>
      ${faqAccordion()}
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="cta-band">
        <div>
          <h2 class="display cta-title">Your next clip could post itself.</h2>
          <p class="cta-sub">Connect your accounts in two minutes. 1 week free, then $19/mo — cancel anytime.</p>
        </div>
        <a class="btn btn-primary btn-lg" href="/signup">Get started ${icon("arrow-right")}</a>
      </div>
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="container site-footer-inner">
    <a class="site-nav-brand" href="/" aria-label="ClipFlow home">${wordmark(22)}</a>
    <nav class="site-footer-links" aria-label="Footer">
      <a href="#how">How it works</a>
      <a href="#features">Features</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/login">Log in</a>
      <a href="/signup">Sign up</a>
    </nav>
    <p class="site-footer-copy">© ${new Date().getFullYear()} ClipFlow</p>
  </div>
</footer>`;

  return layout("ClipFlow — Clip once. Post everywhere.", body);
}

// ---------------------------------------------------------------------------
// auth page
// ---------------------------------------------------------------------------

export function authPage(mode: "login" | "signup", error?: string): string {
  const isSignup = mode === "signup";
  const heading = isSignup ? "Create your account" : "Welcome back";
  const sub = isSignup
    ? "Two minutes from here to auto-posting."
    : "Log in to your ClipFlow dashboard.";
  const cta = isSignup ? "Create account" : "Log in";
  const switchLine = isSignup
    ? `Already have an account? <a href="/login">Log in</a>`
    : `New to ClipFlow? <a href="/signup">Create an account</a>`;

  const body = `
<main class="auth-wrap" id="main">
  <div class="auth-card card">
    <a class="auth-brand" href="/" aria-label="ClipFlow home">${wordmark(30)}</a>
    <h1 class="auth-title display">${heading}</h1>
    <p class="auth-sub">${sub}</p>
    ${error ? `
    <div class="banner banner-error" role="alert">
      ${icon("alert")}
      <span>${esc(error)}</span>
    </div>` : ""}
    <form method="post" action="/${mode}" class="auth-form" novalidate>
      <div class="field">
        <label class="field-label" for="email">Email</label>
        <input class="input" type="email" id="email" name="email" autocomplete="email" required
               placeholder="you@example.com" inputmode="email" autocapitalize="off" spellcheck="false">
      </div>
      <div class="field">
        <label class="field-label" for="password">Password</label>
        <div class="input-affix">
          <input class="input" type="password" id="password" name="password" required minlength="8"
                 autocomplete="${isSignup ? "new-password" : "current-password"}"
                 placeholder="${isSignup ? "At least 8 characters" : "Your password"}">
          <button type="button" class="input-affix-btn" data-toggle-password="password"
                  aria-label="Show password" aria-pressed="false" hidden>
            ${icon("eye", "icon-eye")}${icon("eye-off", "icon-eye-off")}
          </button>
        </div>
      </div>
      <button class="btn btn-primary btn-lg btn-block" type="submit" data-loading-text="${isSignup ? "Creating account…" : "Logging in…"}">${cta}</button>
    </form>
    <p class="auth-switch">${switchLine}${isSignup ? "" : ` · <a href="/forgot">Forgot password?</a>`}</p>
    <p class="auth-reassure">${icon("check-circle")} We never see your Instagram or TikTok password — you connect securely through them.</p>
  </div>
  <p class="auth-legal"><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></p>
</main>`;

  return layout(isSignup ? "Sign up — ClipFlow" : "Log in — ClipFlow", body);
}

// ---------------------------------------------------------------------------
// connection card (shared: dashboard + wizard step 3)
// ---------------------------------------------------------------------------

interface ConnCardOpts {
  platform: "instagram" | "tiktok";
  configured: boolean;
  conn: { accountId: string; username: string } | null;
  csrf: string;
  from?: "welcome";
}

function connectionCard(o: ConnCardOpts): string {
  const label = o.platform === "instagram" ? "Instagram" : "TikTok";
  const sub = o.platform === "instagram"
    ? "Clips publish as Reels on your account."
    : "Clips publish straight to your TikTok.";
  const handle = o.conn?.username ? `@${o.conn.username}` : "";
  const connectHref = `/connect/${o.platform}${o.from ? "?from=welcome" : ""}`;

  let action: string;
  if (o.conn) {
    action = `
      <span class="pill pill-active">${icon("check-circle")}Connected${handle ? ` ${esc(handle)}` : ""}</span>
      <a class="btn btn-ghost btn-sm" href="/disconnect/${o.platform}?t=${encodeURIComponent(o.csrf)}"
         data-confirm-title="Disconnect ${label}?"
         data-confirm-body="ClipFlow will stop posting to ${label}. Your ${label} account is untouched — you can reconnect any time."
         data-confirm-action="Disconnect">Disconnect</a>`;
  } else if (o.configured) {
    action = `
      <a class="btn btn-${o.platform === "instagram" ? "ig" : "tt"}" href="${connectHref}" data-loading-text="Opening ${label}…">
        ${icon(o.platform)} Connect ${label}
      </a>`;
  } else {
    action = `
      <button class="btn btn-secondary" type="button" disabled aria-disabled="true">
        ${icon(o.platform)} Connect ${label}
      </button>
      <p class="conn-unavailable">${icon("alert")} Setup pending — the operator still needs to add API keys.</p>`;
  }

  const igExtras = o.platform === "instagram" ? `
    <p class="conn-note">Instagram must be a <strong>Business or Creator</strong> account linked to a Facebook Page.</p>
    <details class="mini-accordion">
      <summary>60-second fix ${icon("chevron-down", "faq-caret")}</summary>
      <div class="faq-a-wrap"><div class="faq-a">
        <ol class="mini-steps">
          <li>Instagram app → <strong>Settings</strong></li>
          <li><strong>Account type and tools</strong></li>
          <li><strong>Switch to professional account</strong> → Business or Creator, then link your Facebook Page when asked.</li>
        </ol>
      </div></div>
    </details>` : "";

  // Never surface the raw provider accountId (a UUID) to the user — show the
  // handle when we have it, otherwise a plain "Connected".
  const detail = o.conn
    ? `<dl class="conn-detail"><dt>Connected account</dt><dd${handle ? ` class="mono"` : ""}>${handle ? esc(handle) : "Connected"}</dd></dl>`
    : "";

  return `
  <article class="conn-card card conn-${o.platform}${o.conn ? " is-connected" : ""}">
    <div class="conn-head">
      <span class="conn-icon">${icon(o.platform)}</span>
      <div class="conn-titles">
        <h3>${label}</h3>
        <p>${sub}</p>
      </div>
    </div>
    ${detail}${igExtras}
    <div class="conn-actions">${action}</div>
  </article>`;
}

// ---------------------------------------------------------------------------
// onboarding wizard — /welcome
// ---------------------------------------------------------------------------

export interface WizardQuery {
  connected?: string;
  error?: string;
}

export function welcomePage(
  acct: Account,
  step: number,
  csrf: string,
  status: { metaConfigured: boolean; tiktokConfigured: boolean },
  query: WizardQuery = {}
): string {
  const s = Math.min(4, Math.max(1, step));
  const dots = [1, 2, 3, 4].map((n) =>
    `<span class="wiz-dot${n === s ? " is-current" : n < s ? " is-done" : ""}"></span>`
  ).join("");

  const skipForm = `
    <form method="post" action="/welcome/complete" class="wiz-skip-form">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <button type="submit" class="text-link wiz-skip">Skip for now</button>
    </form>`;

  let stepHtml = "";
  let footerHtml = "";

  if (s === 1) {
    stepHtml = `
    <div class="wiz-hero">${logoMark(56)}</div>
    <h1 class="display wiz-title">Welcome to ClipFlow</h1>
    <p class="wiz-sub">Clip on Whatnot. We post it everywhere.</p>
    <ul class="wiz-bullets">
      <li>${icon("radio")}<span>We watch your Whatnot profile for new published clips</span></li>
      <li>${icon("sparkles")}<span>Each one gets your caption and hashtags automatically</span></li>
      <li>${icon("arrow-right")}<span>It posts to Instagram and TikTok — while you keep selling</span></li>
    </ul>`;
    footerHtml = `<a class="btn btn-primary btn-lg" href="/welcome?step=2">Set me up ${icon("arrow-right")}</a>`;
  } else if (s === 2) {
    stepHtml = `
    <h1 class="display wiz-title">Your Whatnot</h1>
    <p class="wiz-sub">This is the profile we watch for new published clips.</p>
    <form method="post" action="/welcome/username" class="wiz-form" id="wiz-username-form">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <div class="field">
        <label class="field-label" for="whatnotUsername">Whatnot username</label>
        <div class="input-affix input-affix-lead">
          <span class="input-lead" aria-hidden="true">@</span>
          <input class="input input-lg" type="text" id="whatnotUsername" name="whatnotUsername"
                 value="${esc(acct.whatnotUsername)}" placeholder="yourhandle" autocomplete="off"
                 autocapitalize="off" spellcheck="false" data-username-live data-username-check
                 pattern="[a-z0-9._\\-]{2,30}" maxlength="30" required>
        </div>
        <p class="field-hint">Lowercase letters, numbers, dots, dashes — exactly as it appears at whatnot.com/user/…</p>
        <div class="uname-check" id="uname-check" aria-live="polite" hidden>
          <span class="uname-avatar" data-uname-avatar aria-hidden="true"></span>
          <div class="uname-text">
            <strong data-uname-title></strong>
            <small data-uname-sub></small>
          </div>
        </div>
      </div>
    </form>`;
    footerHtml = `
      <a class="btn btn-ghost" href="/welcome?step=1">Back</a>
      <button class="btn btn-primary btn-lg" type="submit" form="wiz-username-form" data-loading-text="Saving…">Continue to connect ${icon("arrow-right")}</button>`;
  } else if (s === 3) {
    stepHtml = `
    <h1 class="display wiz-title">Connect where we post</h1>
    <p class="wiz-sub">Connect one now, both later, or skip — you can always do this from the dashboard.</p>
    <div class="conn-grid wiz-conn-grid">
      ${connectionCard({ platform: "instagram", configured: status.metaConfigured, conn: acct.instagram, csrf, from: "welcome" })}
      ${connectionCard({ platform: "tiktok", configured: status.tiktokConfigured, conn: acct.tiktok, csrf, from: "welcome" })}
    </div>`;
    footerHtml = `
      <a class="btn btn-ghost" href="/welcome?step=2">Back</a>
      <a class="btn btn-primary btn-lg" href="/welcome?step=4">Next ${icon("arrow-right")}</a>`;
  } else {
    stepHtml = `
    <h1 class="display wiz-title">How to clip on Whatnot</h1>
    <p class="wiz-sub">The one habit that makes everything else automatic.</p>
    ${howItWorksGrid(true)}
    <p class="wiz-mode-note">${icon("clock")} You're in <strong>manual mode</strong> — hit <strong>Check for clips</strong> whenever you publish. Flip to automatic in your dashboard anytime.</p>`;
    footerHtml = `
      <a class="btn btn-ghost" href="/welcome?step=3">Back</a>
      <form method="post" action="/welcome/complete" class="wiz-finish-form">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <button class="btn btn-primary btn-lg" type="submit" data-loading-text="Finishing up…">Take me to my dashboard ${icon("arrow-right")}</button>
      </form>`;
  }

  const body = `
<main class="wizard-wrap" id="main">
  <div class="wizard card">
    <header class="wiz-head">
      <a href="/" aria-label="ClipFlow home">${wordmark(24)}</a>
      ${skipForm}
    </header>
    <div class="wiz-progress" role="progressbar" aria-valuemin="1" aria-valuemax="4" aria-valuenow="${s}" aria-label="Step ${s} of 4">
      ${dots}
      <span class="wiz-progress-label">Step ${s} of 4</span>
    </div>
    <section class="wiz-step" data-wizard-step="${s}">
      ${stepHtml}
    </section>
    <footer class="wiz-foot">${footerHtml}</footer>
  </div>
</main>
${jsonIsland("cf-flash", { connected: query.connected ?? null, error: query.error ?? null })}`;

  return layout("Welcome — ClipFlow", body);
}

// ---------------------------------------------------------------------------
// app shell (dashboard · thumbnails · guide · status)
// ---------------------------------------------------------------------------

type NavKey = "overview" | "thumbnails" | "history" | "billing" | "guide" | "status" | "admin";

function appShell(acct: Account, active: NavKey, content: string, flash?: unknown): string {
  const navLink = (key: NavKey | "clips" | "settings", href: string, ic: string, text: string) => `
    <a class="side-link${key === active ? " is-active" : ""}" href="${href}"${key === active ? ' aria-current="page"' : ""}>${icon(ic)}<span>${text}</span></a>`;

  const navLinks = `
    ${navLink("overview", "/dashboard", "bolt", "Overview")}
    ${navLink("history", "/history", "activity", "History")}
    ${navLink("thumbnails", "/thumbnails", "wand", "Show Covers")}
    ${navLink("billing", "/billing", "check-circle", "Billing")}
    ${navLink("guide", "/guide", "book", "Guide")}
    ${navLink("settings", "/dashboard#settings", "settings", "Settings")}
    ${acct.isAdmin ? navLink("admin", "/admin", "lock", "Admin") : ""}`;

  const engineDot = acct.enabled
    ? `<span class="engine-ind is-on"><span class="pulse-dot"></span>Engine active</span>`
    : `<span class="engine-ind"><span class="idle-dot"></span>Engine paused</span>`;

  const accountMenu = `
  <details class="dropdown" data-dropdown>
    <summary class="dropdown-trigger" aria-haspopup="menu">
      <span class="avatar" aria-hidden="true">${esc(initials(acct.email))}</span>
      <span class="dropdown-email">${esc(acct.email)}</span>
      ${icon("chevron-down", "dropdown-caret")}
    </summary>
    <div class="dropdown-menu" role="menu">
      <div class="dropdown-id">
        <strong>${esc(acct.email)}</strong>
        <small>Member since ${esc(new Date(acct.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }))}</small>
      </div>
      <a class="dropdown-item" role="menuitem" href="/welcome?step=1">${icon("help-circle")}Setup guide</a>
      <a class="dropdown-item" role="menuitem" href="/status">${icon("activity")}System status</a>
      <a class="dropdown-item" role="menuitem" href="/logout">${icon("log-out")}Log out</a>
    </div>
  </details>`;

  return `
<div class="shell">
  <aside class="sidebar" aria-label="Dashboard">
    <a class="sidebar-brand" href="/dashboard" aria-label="ClipFlow dashboard">${wordmark(26)}</a>
    <nav class="sidebar-nav" aria-label="Sections">${navLinks}</nav>
    <div class="sidebar-foot">
      ${engineDot}
      ${accountMenu}
    </div>
  </aside>

  <div class="shell-main">
    <header class="topbar">
      <button type="button" class="btn-icon topbar-menu" data-mobile-nav aria-label="Open menu"
              aria-expanded="false" aria-controls="mobile-nav" hidden>${icon("menu")}</button>
      <a class="topbar-brand" href="/dashboard" aria-label="ClipFlow dashboard">${wordmark(24)}</a>
      <div class="topbar-right">
        ${engineDot}
        ${accountMenu}
      </div>
    </header>
    <nav class="mobile-nav" id="mobile-nav" aria-label="Sections" hidden>${navLinks}</nav>

    <main id="main" class="content" data-stagger>
      ${content}
    </main>
  </div>
</div>
${flash !== undefined ? jsonIsland("cf-flash", flash) : ""}`;
}

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------

export interface DashboardQuery {
  connected?: string;
  disconnected?: string;
  partial?: string;
  error?: string;
  saved?: string;
  onboarded?: string;
  billing?: string;
}

export interface DashboardExtras {
  csrf?: string;
  /** posting mode + last full check, for the header pill + Check button */
  mode?: "manual" | "auto";
  lastCheckedAt?: string | null;
  gemini?: { configured: boolean; thumbCount: number };
  /** posts-table stats; falls back to clip-derived counts when absent */
  stats?: { postedWeek: number; pending: number; failed: number };
  billing?: {
    configured: boolean;
    /** posting allowed right now (card on file / admin / dev) */
    active: boolean;
    /** locked | trial | active | past_due | admin | dev */
    state: string;
    /** days left in the free trial */
    daysLeft: number;
    trialDays: number;
  };
  showVerifyBanner?: boolean;
}

export function dashboard(
  acct: Account,
  status: { metaConfigured: boolean; tiktokConfigured: boolean },
  clips: ClipRow[],
  query: DashboardQuery = {},
  extras: DashboardExtras = {}
): string {
  const csrf = extras.csrf ?? "";
  const uname = acct.whatnotUsername;
  const total = clips.length;
  const posted = clips.filter((c) => c.instagram || c.tiktok).length;
  const pending = total - posted;
  const connectedCount = (acct.instagram ? 1 : 0) + (acct.tiktok ? 1 : 0);

  // ---- posting mode + manual check controls ---------------------------------

  const mode = extras.mode ?? "auto";
  const lastCheckedText = extras.lastCheckedAt ? `Last checked ${relTime(extras.lastCheckedAt)}` : "Never checked yet";
  // Primary in manual (it's THE action); secondary in auto (still useful, less loud).
  const checkButton = uname
    ? `<button type="button" class="btn ${mode === "manual" ? "btn-primary" : "btn-secondary"} check-btn" data-check data-username="${esc(uname)}" data-loading-text="Checking…">${icon("radio")} <span class="check-label">Check for clips</span></button>`
    : "";
  // Compact segmented pill — lives IN the section header row next to the button.
  const modeSeg = `
    <div class="mode-seg" role="radiogroup" aria-label="Posting mode" data-mode-controls data-csrf="${esc(csrf)}">
      <button type="button" role="radio" class="mode-seg-opt${mode === "manual" ? " is-active" : ""}" data-mode="manual" aria-checked="${mode === "manual"}">Manual</button>
      <button type="button" role="radio" class="mode-seg-opt${mode === "auto" ? " is-active" : ""}" data-mode="auto" aria-checked="${mode === "auto"}">Auto</button>
      <span class="mode-info" tabindex="0" aria-label="Auto checks every few minutes and posts new clips for you.">${icon("help-circle")}<span class="mode-tip" role="tooltip">Auto checks every few minutes and posts new clips for you.</span></span>
    </div>`;
  const checkMicrocopy = `
    <div class="check-micro">
      <span class="check-last" data-check-last>${esc(lastCheckedText)}</span>
      <span class="check-result" data-check-result hidden aria-live="polite"></span>
    </div>`;
  const emptyCopy = !uname
    ? "First, add your Whatnot username in <strong>Your Whatnot</strong> above — that's how we know whose clips to watch."
    : mode === "manual"
    ? "Publish a clip on your next show, then hit Check for clips."
    : "Publish a clip during your next Whatnot show — it shows up here within minutes and posts itself.";

  // ---- clip cards -----------------------------------------------------------

  function clipCard(c: ClipRow): string {
    const title = c.title?.trim() || "Untitled clip";
    const igBadge = c.instagram
      ? `<span class="pill pill-posted">${icon("check")}Reel posted</span>`
      : `<span class="pill pill-pending">${icon("instagram")}Pending</span>`;
    const ttBadge = c.tiktok
      ? (c.tiktokDraft
          ? `<span class="pill pill-draft" title="Delivered to your TikTok inbox — tap the notification in the app to post">${icon("check")}In TikTok inbox</span>`
          : `<span class="pill pill-posted">${icon("check")}TikTok posted</span>`)
      : `<span class="pill pill-pending">${icon("tiktok")}Pending</span>`;
    // The branded placeholder is ALWAYS in the DOM (gradient + icon + title);
    // when a thumbnail exists an <img> covers it, and if that img 404s the
    // client removes it, revealing the placeholder — never a black rectangle.
    return `
    <li class="clip-card card">
      <div class="clip-thumb">
        <span class="clip-thumb-fallback" aria-hidden="true">${icon("clip")}<small>${esc(title.slice(0, 34))}</small></span>
        ${c.hasThumb ? `<img class="clip-thumb-img" src="/thumb/${esc(c.clipId)}" alt="" loading="lazy" data-thumb-img>` : ""}
      </div>
      <div class="clip-body">
        <h3 class="clip-title" title="${esc(title)}">${esc(title)}</h3>
        <div class="clip-badges">${igBadge}${ttBadge}</div>
        <p class="clip-time">${esc(relTime(c.downloadedAt))}</p>
      </div>
    </li>`;
  }

  const clipsSection = total === 0
    ? `
    <div class="empty-state card">
      ${illoClip()}
      <h3>No clips yet</h3>
      <p>${emptyCopy}</p>
      ${checkButton ? `<div class="empty-check">${checkButton}</div>` : ""}
      <a class="text-link" href="/guide">See how clipping works ${icon("arrow-right")}</a>
    </div>`
    : `<ul class="clips-grid">${clips.map(clipCard).join("")}</ul>`;

  // ---- thumbnail studio card -------------------------------------------------

  const gem = extras.gemini ?? { configured: false, thumbCount: 0 };
  const studioCard = gem.configured
    ? `
    <section class="studio-card card" aria-label="Show Covers studio">
      <div class="studio-copy">
        <span class="studio-icon">${icon("wand")}</span>
        <div>
          <h2 class="section-h display">Show Covers</h2>
          <p>Covers that pack your next show — designed from your real products.</p>
        </div>
      </div>
      <div class="studio-actions">
        ${gem.thumbCount > 0 ? `<span class="pill pill-neutral">${icon("image")}${gem.thumbCount} generated</span>` : ""}
        <a class="btn btn-primary" href="/thumbnails">${gem.thumbCount > 0 ? "Open studio" : "Design your first"} ${icon("arrow-right")}</a>
      </div>
    </section>`
    : `
    <section class="studio-card card is-locked" aria-label="Show Covers studio (locked)">
      <div class="studio-copy">
        <span class="studio-icon">${icon("lock")}</span>
        <div>
          <h2 class="section-h display">Show Covers</h2>
          <p>Add a Gemini API key to unlock the cover studio — your products, bold type, one loud colour.</p>
        </div>
      </div>
      <div class="studio-actions">
        <a class="text-link" href="/guide#gemini">How to get a key ${icon("arrow-right")}</a>
      </div>
    </section>`;

  // ---- settings ---------------------------------------------------------------

  const hashtagsValue = acct.hashtags.join(" ");
  const sampleTitle = "🔥 $1 SQUISHIES ALL NIGHT — NONSTOP GIVEAWAYS";
  const previewVars = { title: sampleTitle, username: uname || "yourhandle", hashtags: acct.hashtags };
  const previewCaption = renderTemplate(effectiveTemplate(acct), previewVars);

  // ---- card 1: Your Whatnot ---------------------------------------------------

  // When there's no username yet, this is the single most important field on the
  // page — it's promoted to the top with an accent ring and a "Start here" cue.
  const whatnotCard = `
  <div class="card settings-card${uname ? "" : " settings-card-empty"}" data-csrf="${esc(csrf)}" id="whatnot-card">
    <div class="field">
      <label class="field-label" for="whatnotUsername">Whatnot username${uname ? "" : ` <span class="start-here">Start here</span>`}</label>
      <div class="whatnot-row">
        <div class="input-affix input-affix-lead">
          <span class="input-lead" aria-hidden="true">@</span>
          <input class="input" type="text" id="whatnotUsername" name="whatnotUsername"
                 value="${esc(uname)}" placeholder="yourhandle" autocomplete="off"
                 autocapitalize="off" spellcheck="false" data-username-live maxlength="30">
        </div>
        <button type="button" class="btn btn-primary" id="save-username" data-loading-text="Saving…">Save username</button>
      </div>
      <p class="field-hint">${uname
        ? "The public Whatnot handle whose clips ClipFlow watches — the bit after whatnot.com/user/."
        : "Add the handle from your Whatnot profile URL (whatnot.com/user/<strong>yourhandle</strong>) so we know whose clips to watch."}</p>
    </div>
  </div>`;

  // Reorderable "Your Whatnot" section — promoted above connections when empty.
  const whatnotSection = `
      <section class="section-block${uname ? "" : " section-promoted"}" id="settings">
        <div class="section-head">
          <h2 class="display section-h">Your Whatnot</h2>
          <span class="saved-flash" id="whatnot-saved" hidden>Saved ✓</span>
        </div>
        ${whatnotCard}
      </section>`;

  // ---- card 2: Your captions ----------------------------------------------------

  const PRESET_META: Array<{ key: "hype" | "chill" | "minimal"; label: string; blurb: string }> = [
    { key: "hype", label: "Hype", blurb: "Loud, live-show energy" },
    { key: "chill", label: "Chill", blurb: "Friendly and low-key" },
    { key: "minimal", label: "Minimal", blurb: "Just the essentials" },
  ];
  const presetCards = PRESET_META.map((p) => {
    const demo = renderTemplate(CAPTION_PRESETS[p.key], previewVars);
    return `
      <label class="preset-card${acct.captionPreset === p.key ? " is-selected" : ""}" data-preset="${p.key}" data-template="${esc(CAPTION_PRESETS[p.key])}">
        <input type="radio" name="captionPreset" value="${p.key}" class="visually-hidden"${acct.captionPreset === p.key ? " checked" : ""}>
        <span class="preset-name"><strong>${p.label}</strong><small>${p.blurb}</small></span>
        <span class="preset-demo" aria-hidden="true">
          <span class="preset-demo-head"><span class="preset-demo-avatar">${esc(initials(acct.email))}</span>@${esc(uname || "yourhandle")}</span>
          <span class="preset-demo-text">${esc(demo)}</span>
        </span>
      </label>`;
  }).join("") + `
      <label class="preset-card preset-card-custom${acct.captionPreset === "custom" ? " is-selected" : ""}" data-preset="custom">
        <input type="radio" name="captionPreset" value="custom" class="visually-hidden"${acct.captionPreset === "custom" ? " checked" : ""}>
        <span class="preset-name"><strong>Custom</strong><small>Write your own</small></span>
        <span class="preset-demo preset-demo-custom" aria-hidden="true">${icon("wand")}<span>Your words, exactly how you type them.</span></span>
      </label>`;

  const customEditor = `
    <div class="custom-editor" id="custom-editor"${acct.captionPreset === "custom" ? "" : " hidden"}>
      <div class="field">
        <label class="field-label" for="captionTemplate">Your caption template</label>
        <div class="token-chips" data-token-target="captionTemplate" hidden>
          <span class="field-hint">Insert:</span>
          <button type="button" class="chip chip-token" data-token="{title}">{title}</button>
          <button type="button" class="chip chip-token" data-token="{hashtags}">{hashtags}</button>
          <button type="button" class="chip chip-token" data-token="{username}">{username}</button>
        </div>
        <textarea class="textarea" id="captionTemplate" rows="4" maxlength="2200"
                  placeholder="{title}&#10;&#10;{hashtags}">${esc(acct.captionTemplate)}</textarea>
        <p class="field-hint"><code>{title}</code> becomes the clip's title · <code>{hashtags}</code> your hashtags · <code>{username}</code> your Whatnot handle.</p>
      </div>
      <button type="button" class="btn btn-primary" id="save-template" data-loading-text="Saving…">Save caption</button>
    </div>`;

  const captionsCard = `
  <div class="captions-grid" id="captions-root" data-csrf="${esc(csrf)}" data-preset="${esc(acct.captionPreset)}">
    <div class="card settings-card captions-main">
      <p class="field-label captions-q">How should your captions sound?</p>
      <div class="preset-grid" role="radiogroup" aria-label="Caption style">${presetCards}</div>
      ${customEditor}
      <div class="field field-hashtags">
        <label class="field-label" for="hashtags">Hashtags</label>
        <div class="chip-input" id="hashtag-chip-input" hidden>
          <ul class="chip-list" id="hashtag-chip-list" aria-label="Current hashtags"></ul>
          <input class="chip-input-field" type="text" id="hashtag-entry"
                 placeholder="Add a hashtag, press Enter" autocomplete="off"
                 autocapitalize="off" spellcheck="false" aria-describedby="hashtag-hint">
        </div>
        <input class="input" type="text" id="hashtags" name="hashtags" value="${esc(hashtagsValue)}"
               placeholder="whatnot live smallbusiness" autocomplete="off" autocapitalize="off" spellcheck="false">
        <p class="field-hint" id="hashtag-hint">Separate with spaces or commas — the # is added for you.</p>
        <div class="suggest-row" id="suggest-tags" data-uname="${esc(uname)}" hidden>
          <span class="field-hint">Suggested:</span>
        </div>
      </div>
    </div>

    <div class="settings-col">
      <div class="preview-card card" aria-label="Live caption preview">
        <div class="preview-tabs" role="group" aria-label="Preview network">
          <button type="button" class="preview-tab is-active" data-net="instagram" aria-pressed="true">Instagram</button>
          <button type="button" class="preview-tab" data-net="tiktok" aria-pressed="false">TikTok</button>
        </div>
        <div class="preview-head">
          <span class="preview-avatar avatar" aria-hidden="true">${esc(initials(acct.email))}</span>
          <div class="preview-id">
            <strong id="preview-handle">@${esc(uname || "yourhandle")}</strong>
            <small id="preview-net-label">Instagram · Reel caption</small>
          </div>
          <span class="preview-net-wrap">${icon("instagram", "preview-net-icon net-ig")}${icon("tiktok", "preview-net-icon net-tt")}</span>
        </div>
        <div class="preview-thumb" aria-hidden="true">
          ${logoMark(36)}
          <span class="pill pill-live"><span class="pulse-dot"></span>Clip</span>
        </div>
        <p class="preview-caption" id="caption-preview">${esc(previewCaption)}</p>
        <p class="field-hint">Live preview with a sample clip title.</p>
      </div>
    </div>
  </div>`;

  // ---- card 3: Account (pause + credentials + danger) --------------------------

  const pauseCard = `
  <div class="card settings-card pause-card" data-csrf="${esc(csrf)}">
    <label class="switch">
      <input type="checkbox" id="pause-switch" role="switch" ${acct.enabled ? "checked" : ""}>
      <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
      <span class="switch-label">
        <strong id="pause-title">${acct.enabled ? "ClipFlow is on" : "Paused"}</strong>
        <small id="pause-copy">${acct.enabled ? "Checking and posting normally." : "Paused — nothing checks or posts until you turn this back on."}</small>
      </span>
    </label>
  </div>`;

  // ---- header row -------------------------------------------------------------

  const watchLine = uname
    ? `<p class="watch-line">Watching <strong class="mono">@${esc(uname)}</strong><span class="wn-display" data-wn-name></span>
        <button type="button" class="btn-icon" data-copy="https://www.whatnot.com/user/${esc(encodeURIComponent(uname))}"
                aria-label="Copy Whatnot profile link" hidden>${icon("copy")}</button></p>`
    : `<p class="watch-line watch-line-nudge">${icon("alert")} Set your Whatnot username so ClipFlow knows whose clips to watch. <a href="#settings">Go to settings</a></p>`;

  const modePill = acct.enabled
    ? `<span class="pill ${mode === "auto" ? "pill-live" : "pill-neutral"}" data-mode-pill>${mode === "auto" ? '<span class="pulse-dot"></span>Auto-posting' : "Manual mode"}</span>`
    : "";

  const b = extras.billing;
  // Trial pill: show days left in the free week.
  const trialPill = b && b.configured && b.state === "trial"
    ? `<a class="pill pill-neutral pill-link" href="/billing">${icon("bolt")}${b.daysLeft} day${b.daysLeft === 1 ? "" : "s"} left free</a>`
    : "";

  // Locked banner (card-first): no card yet → posting is gated.
  const lockedBanner = b && b.configured && b.state === "locked" && !acct.disabled
    ? `
    <div class="banner banner-upgrade" role="status">
      <div>
        <strong>Add a card to unlock ClipFlow — 1 week free.</strong>
        <span>Connect your accounts now if you like, but nothing posts until a card is on file. No charge for your first week, then $19/mo. Cancel any time.</span>
      </div>
      <a class="btn btn-primary" href="/billing">Add card to unlock ${icon("arrow-right")}</a>
    </div>`
    : "";

  const pastDueBanner = b && b.configured && b.state === "past_due" && !acct.disabled
    ? `
    <div class="banner banner-upgrade" role="status">
      <div>
        <strong>Payment issue — posting is paused.</strong>
        <span>Stripe couldn't charge your card. Update it and posting resumes on the next check.</span>
      </div>
      <a class="btn btn-primary" href="/billing">Fix payment ${icon("arrow-right")}</a>
    </div>`
    : "";

  const upgradeBanner = lockedBanner + pastDueBanner;

  const verifyBanner = extras.showVerifyBanner
    ? `
    <div class="banner banner-verify" role="status">
      ${icon("alert")}
      <span>Please verify your email — check your inbox for the link, or resend it from Settings.</span>
    </div>`
    : "";

  const content = `
      ${upgradeBanner}${verifyBanner}
      <section class="page-head" id="overview">
        <div class="page-head-main">
          ${uname ? whatnotAvatar(uname, "pfp-hero") : ""}
          <div class="page-head-text">
            <p class="eyebrow">${esc(timeGreeting())}</p>
            <h1 class="display page-title">${esc(firstName(acct.email))}</h1>
            ${watchLine}
          </div>
        </div>
        <div class="page-head-status">
          ${acct.enabled
            ? `<span class="pill pill-live" data-active-pill><span class="pulse-dot"></span>Active</span>`
            : `<span class="pill pill-paused" data-active-pill>${icon("alert")}Paused</span>`}
          ${modePill}
          ${trialPill}
        </div>
      </section>

      ${uname ? "" : whatnotSection}

      <section class="conn-grid" aria-label="Platform connections">
        ${connectionCard({ platform: "instagram", configured: status.metaConfigured, conn: acct.instagram, csrf })}
        ${connectionCard({ platform: "tiktok", configured: status.tiktokConfigured, conn: acct.tiktok, csrf })}
      </section>

      <section class="pipeline card" aria-label="Posting pipeline">
        <div class="pipe-node">
          ${uname ? whatnotAvatar(uname, "pfp-pipe") : platformAvatar("instagram", false, "pfp-pipe")}
          <span class="pipe-label">Whatnot${uname ? `<br><span class="mono">@${esc(uname)}</span>` : `<br><span class="pipe-pending-text">Not set</span>`}</span>
        </div>
        <div class="pipe-link" aria-hidden="true"><span class="pipe-dot"></span></div>
        <div class="pipe-node">
          <span class="pipe-icon pipe-cf">${logoMark(24)}</span>
          <span class="pipe-label">ClipFlow</span>
        </div>
        <div class="pipe-link" aria-hidden="true"><span class="pipe-dot pipe-dot-late"></span></div>
        <div class="pipe-node pipe-node-targets">
          <div class="pipe-target">
            ${platformAvatar("instagram", Boolean(acct.instagram), "pfp-pipe")}
            <span class="pipe-target-label">${acct.instagram
              ? `Instagram<br><span class="mono">${acct.instagram.username ? "@" + esc(acct.instagram.username) : "connected"}</span>`
              : `Instagram<br><span class="pipe-pending-text">Not connected</span>`}</span>
          </div>
          <div class="pipe-target">
            ${platformAvatar("tiktok", Boolean(acct.tiktok), "pfp-pipe")}
            <span class="pipe-target-label">${acct.tiktok
              ? `TikTok<br><span class="mono">${acct.tiktok.username ? "@" + esc(acct.tiktok.username) : "connected"}</span>`
              : `TikTok<br><span class="pipe-pending-text">Not connected</span>`}</span>
          </div>
        </div>
      </section>

      <section class="stats-row" aria-label="Stats">
        ${extras.stats ? `
        <div class="stat-card card"><span class="stat-num">${extras.stats.postedWeek}</span><span class="stat-label">Posted this week</span></div>
        <div class="stat-card card"><span class="stat-num">${extras.stats.pending}</span><span class="stat-label">Pending</span></div>
        <div class="stat-card card"><span class="stat-num">${extras.stats.failed}</span><span class="stat-label">Failed <a class="stat-link" href="/history?filter=failed">view</a></span></div>` : `
        <div class="stat-card card"><span class="stat-num">${total}</span><span class="stat-label">Total clips</span></div>
        <div class="stat-card card"><span class="stat-num">${posted}</span><span class="stat-label">Posted</span></div>
        <div class="stat-card card"><span class="stat-num">${pending}</span><span class="stat-label">Pending</span></div>`}
        <div class="stat-card card"><span class="stat-num">${connectedCount}<span class="stat-of">/2</span></span><span class="stat-label">Platforms connected</span></div>
      </section>

      ${uname ? whatnotSection : ""}

      <section class="section-block" id="clips">
        <div class="section-head section-head-clips">
          <h2 class="display section-h">Recent clips</h2>
          <div class="section-head-actions">
            ${uname ? `<a class="text-link" href="https://www.whatnot.com/user/${esc(encodeURIComponent(uname))}/clips" target="_blank" rel="noopener">View on Whatnot ${icon("external-link")}</a>` : ""}
            ${checkButton}
            ${modeSeg}
          </div>
        </div>
        ${checkMicrocopy}
        ${clipsSection}
      </section>

      ${studioCard}

      <section class="section-block" id="captions">
        <div class="section-head">
          <h2 class="display section-h">Your captions</h2>
          <span class="saved-flash" id="captions-saved" hidden>Saved ✓</span>
        </div>
        ${captionsCard}
      </section>

      <section class="section-block" id="account">
        <div class="section-head">
          <h2 class="display section-h">Account</h2>
        </div>
        ${pauseCard}
        <div class="account-grid">
          <form method="post" action="/account/password" class="card account-card">
            <input type="hidden" name="csrf" value="${esc(csrf)}">
            <h3>Change password</h3>
            <div class="field">
              <label class="field-label" for="pw-current">Current password</label>
              <input class="input" type="password" id="pw-current" name="current" autocomplete="current-password" required>
            </div>
            <div class="field">
              <label class="field-label" for="pw-new">New password</label>
              <input class="input" type="password" id="pw-new" name="next" minlength="8" autocomplete="new-password" required>
            </div>
            <button class="btn btn-secondary" type="submit" data-loading-text="Updating…">Update password</button>
          </form>

          <form method="post" action="/account/email" class="card account-card">
            <input type="hidden" name="csrf" value="${esc(csrf)}">
            <h3>Change email</h3>
            <p class="field-hint">${acct.emailVerifiedAt
              ? `Verified as <strong>${esc(acct.email)}</strong>. A new address needs re-verification.`
              : `Currently <strong>${esc(acct.email)}</strong> — not verified yet.`}</p>
            <div class="field">
              <label class="field-label" for="email-new">New email</label>
              <input class="input" type="email" id="email-new" name="email" autocomplete="email" required placeholder="new@example.com">
            </div>
            <div class="account-card-actions">
              <button class="btn btn-secondary" type="submit" data-loading-text="Sending…">Change email</button>
              ${acct.emailVerifiedAt ? "" : `<button class="btn btn-ghost" type="submit" formaction="/account/resend-verification">Resend verification</button>`}
            </div>
          </form>

          <form method="post" action="/account/delete" class="card account-card account-danger" id="delete-account-form">
            <input type="hidden" name="csrf" value="${esc(csrf)}">
            <h3>Delete account</h3>
            <p class="field-hint">Cancels any subscription, deletes your data, clips, and covers. This cannot be undone.</p>
            <div class="field">
              <label class="field-label" for="delete-confirm">Type your email to confirm</label>
              <input class="input" type="text" id="delete-confirm" name="confirm" autocomplete="off"
                     placeholder="${esc(acct.email)}" data-expected-email="${esc(acct.email)}">
            </div>
            <button class="btn btn-danger" type="submit"
                    data-confirm-title="Delete your account?"
                    data-confirm-body="Your subscription is cancelled and every clip, cover, and setting is permanently removed."
                    data-confirm-action="Delete forever">Delete my account</button>
          </form>
        </div>
      </section>`;

  const flash = {
    connected: query.connected ?? null,
    disconnected: query.disconnected ?? null,
    partial: query.partial ?? null,
    error: query.error ?? null,
    saved: query.saved ?? null,
    onboarded: query.onboarded ?? null,
    billing: query.billing ?? null,
  };

  return layout("Dashboard — ClipFlow", appShell(acct, "overview", content, flash));
}

// ---------------------------------------------------------------------------
// thumbnails — /thumbnails
// ---------------------------------------------------------------------------

export function thumbnailsPage(
  acct: Account,
  thumbs: ThumbRecord[],
  clips: ClipRow[],
  opts: { configured: boolean; csrf: string; styles: Record<ThumbStyle, StyleSpec>; left: number; perDay: number }
): string {
  const styleKeys = Object.keys(opts.styles) as ThumbStyle[];
  const defaultSubject = deriveSubject(clips[0]?.title ?? "") || "squishy toys";

  // Config for the client: line-break/size math + per-style paint treatment,
  // so the live preview matches the server render. MIRRORED in app.js.
  const clientCfg = {
    csrf: opts.csrf,
    handle: acct.whatnotUsername || "",
    left: opts.left,
    perDay: opts.perDay,
    styles: Object.fromEntries(styleKeys.map((k) => {
      const s = opts.styles[k];
      return [k, { label: s.label, blurb: s.blurb, accent: s.accent, base: s.base, rays: s.rays, wallFills: s.wallFills, scrim: s.scrim, swatch: s.swatch, text: s.text }];
    })),
  };

  if (!opts.configured) {
    const locked = `
      <section class="card studio-locked" aria-label="Show Covers studio (locked)">
        <span class="studio-icon">${icon("lock")}</span>
        <h2 class="display section-h">Unlock Show Covers</h2>
        <p>Add a <strong>Gemini API key</strong> to design show covers built on the winning Whatnot formula — your real products cut out and collaged, a bold text wall, one loud colour. Every headline is set in crisp brand type, so the spelling is always perfect. Grab a free key at aistudio.google.com, paste it into <code>.env</code> as <code>GEMINI_API_KEY</code>, and restart.</p>
        <a class="text-link" href="/guide#gemini">Full instructions ${icon("arrow-right")}</a>
      </section>`;
    return layout("Show Covers — ClipFlow", appShell(acct, "thumbnails",
      `<section class="page-head"><div>
        <p class="eyebrow">Show Covers</p>
        <h1 class="display page-title">Covers that pack your next show</h1>
        <p class="watch-line">Designed from your real products — bold type, one loud colour, perfect spelling.</p>
      </div></section>${locked}`));
  }

  const clipOptions = clips.slice(0, 20).map((c) =>
    `<option value="${esc(c.clipId)}" data-title="${esc(c.title ?? "")}" data-thumb="${c.hasThumb ? "1" : "0"}">${esc((c.title ?? "Untitled clip").slice(0, 60))}</option>`
  ).join("");

  const styleCards = styleKeys.map((k, i) => {
    const s = opts.styles[k];
    return `
      <label class="style-card${i === 0 ? " is-selected" : ""}" data-style="${k}">
        <input type="radio" name="style" value="${k}"${i === 0 ? " checked" : ""} class="visually-hidden">
        <span class="style-card-swatch" style="background:linear-gradient(150deg, ${s.swatch[0]}, ${s.swatch[1]})">
          <span class="style-card-bar" style="background:${s.accent}"></span>
        </span>
        <span class="style-card-name"><strong>${esc(s.label)}</strong><small>${esc(s.blurb)}</small></span>
      </label>`;
  }).join("");

  const left = `
    <section class="studio-controls card" aria-label="Design your cover">
      <h2 class="display section-h">Design</h2>
      <form id="gen-form" class="gen-form" autocomplete="off">
        <input type="hidden" name="heroWordIndex" id="gen-hero" value="">
        <input type="hidden" name="useClip" id="gen-useclip" value="1">
        <input type="hidden" name="layout" id="gen-layout" value="wall">
        <input type="hidden" name="cutoutIds" id="gen-cutouts" value="">
        <input type="hidden" name="recipe" id="gen-recipe" value="">
        <fieldset class="field">
          <legend class="field-label">Layout</legend>
          <div class="seg" role="radiogroup" aria-label="Layout mode">
            <button type="button" role="radio" class="seg-btn is-active" data-layout="wall" aria-checked="true">Text Wall</button>
            <button type="button" role="radio" class="seg-btn" data-layout="poster" aria-checked="false">Poster</button>
          </div>
          <p class="field-hint">Text Wall is the winning Whatnot formula. Poster puts the headline over an AI hero scene.</p>
        </fieldset>
        <div class="field">
          <label class="field-label" for="gen-clip">Clip <span class="field-opt">optional</span></label>
          <select class="input select" id="gen-clip" name="clipId">
            <option value="">No specific clip</option>
            ${clipOptions}
          </select>
          <div class="clip-hero" id="clip-hero" hidden>
            <div class="clip-hero-frame"><img id="clip-hero-img" alt="Your clip frame"></div>
            <div class="clip-hero-side">
              <p class="clip-hero-badge">Using your clip's image ✨</p>
              <label class="toggle-row" for="gen-useclip-toggle">
                <input type="checkbox" id="gen-useclip-toggle" checked>
                <span>Use my clip's image</span>
              </label>
              <p class="field-hint">Off = pure AI art from the subject instead.</p>
            </div>
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="gen-subject">What's in this clip?</label>
          <input class="input" type="text" id="gen-subject" name="subject" maxlength="80" spellcheck="true"
                 value="${esc(defaultSubject)}" placeholder="squishy toys, pokémon cards…">
          <p class="field-hint">Feeds the AI hero. The headline text is set separately below.</p>
        </div>
        <div class="field">
          <label class="field-label">Product photos <span class="field-opt">up to 3</span></label>
          <div class="uploads" id="uploads">
            <label class="upload-tile" id="upload-add">
              <input type="file" id="upload-input" accept="image/*" multiple hidden>
              ${icon("image")}<span>Add photo</span>
            </label>
          </div>
          <p class="field-hint">Real product photos perform best on Whatnot — we cut them out and collage them in.</p>
        </div>
        <details class="field clone-field">
          <summary class="clone-summary">${icon("wand")} Clone a winning cover's style</summary>
          <div class="clone-body">
            <label class="field-label" for="clone-url">Whatnot cover image URL</label>
            <div class="headline-row">
              <input class="input" type="url" id="clone-url" placeholder="https://images.whatnot.com/…">
              <button type="button" class="btn btn-secondary btn-sm" id="clone-go" data-loading-text="Analyzing…">Analyze</button>
            </div>
            <p class="clone-status" id="clone-status" hidden></p>
            <p class="field-hint">We read the <em>style</em> only — your words and products, never theirs.</p>
          </div>
        </details>
        <fieldset class="field">
          <legend class="field-label">Style</legend>
          <div class="style-grid" role="radiogroup" aria-label="Cover style">${styleCards}</div>
        </fieldset>
        <div class="field">
          <label class="field-label" for="gen-headline">Headline <span class="char-count" data-char-count-for="gen-headline" aria-live="polite">0/80</span></label>
          <div class="headline-row">
            <input class="input" type="text" id="gen-headline" name="headline" maxlength="80" required spellcheck="true"
                   placeholder="$1 SQUISHIES ALL NIGHT">
            <button type="button" class="btn btn-secondary btn-sm headline-write" id="headline-write">${icon("wand")} Write it for me</button>
          </div>
          <div class="headline-ideas" id="headline-ideas" hidden aria-live="polite"></div>
          <div class="hero-pick" id="hero-pick" hidden>
            <span class="hero-pick-label">Big word:</span>
            <div class="hero-pick-words" id="hero-pick-words" role="group" aria-label="Choose the emphasized word"></div>
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="gen-date">Date / time ribbon <span class="field-opt">optional</span></label>
          <input class="input" type="text" id="gen-date" name="dateText" maxlength="24" placeholder="SAT 8PM ET">
        </div>
        <button class="btn btn-primary btn-lg btn-block" type="submit" id="gen-submit">
          ${icon("wand")} <span class="gen-submit-label">Generate 2 variations</span>
        </button>
        <p class="field-hint gen-allowance"><span id="gen-left">${opts.left}</span> of ${opts.perDay} left today.</p>
      </form>
    </section>`;

  const right = `
    <section class="studio-preview" aria-label="Live preview">
      <div class="preview-sticky">
        <div class="preview-frame" id="preview-frame" data-style="${styleKeys[0]}">
          <canvas id="preview-canvas" width="1080" height="1667" aria-label="Cover preview"></canvas>
          <div class="preview-status" id="preview-status" hidden>
            <span class="preview-spinner" aria-hidden="true"></span>
            <span id="preview-status-text"></span>
          </div>
        </div>
        <p class="preview-hint">Live preview — your cover updates as you type.</p>
      </div>
    </section>`;

  const gallery = thumbs.length === 0
    ? `<div class="empty-state card">
        ${icon("image", "empty-icon")}
        <h3>No saved covers yet</h3>
        <p>Design one on the left, generate two variations, and keep your favourite.</p>
      </div>`
    : `<ul class="thumb-grid">
      ${thumbs.map((t) => {
        const slug = slugify(t.headline) || t.id.slice(0, 8);
        return `
        <li class="thumb-card card" data-id="${esc(t.id)}">
          <div class="thumb-img-wrap">
            <img src="/thumb-gen/${esc(t.id)}.webp" alt="${esc(t.headline)} — ${esc(t.style)} cover" loading="lazy">
            <div class="thumb-hover">
              <a class="btn btn-primary btn-sm" href="/thumb-gen/${esc(t.id)}.png" download="${esc(slug)}.png">${icon("download")} Download</a>
              <button class="btn btn-secondary btn-sm" data-regen="${esc(t.id)}" data-loading-text="Regenerating…">${icon("wand")} Regenerate</button>
              <button class="btn btn-ghost btn-sm" data-delete="${esc(t.id)}"
                      data-confirm-title="Delete this cover?"
                      data-confirm-body="Removes the image permanently. Anything already downloaded is unaffected."
                      data-confirm-action="Delete">${icon("trash")} Delete</button>
            </div>
          </div>
          <div class="thumb-meta">
            <p class="thumb-headline" title="${esc(t.headline)}">${esc(t.headline)}</p>
            <p class="thumb-sub">${esc(opts.styles[t.style as ThumbStyle]?.label ?? t.style)} · ${esc(relTime(t.createdAt))}</p>
          </div>
        </li>`;
      }).join("")}
    </ul>`;

  const content = `
      <section class="page-head">
        <div>
          <p class="eyebrow">Show Covers</p>
          <h1 class="display page-title">Covers that pack your next show</h1>
          <p class="watch-line">Built on the winning Whatnot formula — a bold text wall, your real products collaged in, flooded in one loud colour. Perfect spelling, every time.</p>
        </div>
      </section>
      <div class="studio-grid">
        ${left}
        ${right}
      </div>
      <section class="section-block">
        <div class="section-head"><h2 class="display section-h">Your covers</h2></div>
        ${gallery}
      </section>
      ${jsonIsland("cf-thumbstudio", clientCfg)}`;

  return layout("Show Covers — ClipFlow", appShell(acct, "thumbnails", content));
}

/** URL-safe slug for download filenames. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

// ---------------------------------------------------------------------------
// guide — /guide
// ---------------------------------------------------------------------------

export function guidePage(acct: Account): string {
  const content = `
      <section class="page-head">
        <div>
          <p class="eyebrow">Guide</p>
          <h1 class="display page-title">How ClipFlow works</h1>
          <p class="watch-line">Three steps on Whatnot's side, zero on yours after that.</p>
        </div>
      </section>
      <section class="section-block">
        ${howItWorksGrid()}
      </section>
      <section class="section-block" id="faq">
        <div class="section-head"><h2 class="display section-h">FAQ</h2></div>
        ${faqAccordion()}
      </section>
      <section class="section-block" id="gemini">
        <div class="section-head"><h2 class="display section-h">Show Covers setup</h2></div>
        <div class="card guide-gemini">
          <p>The Show Covers studio uses Google Gemini. To unlock it, the operator adds one key:</p>
          <ol class="mini-steps">
            <li>Create a free API key at <strong>aistudio.google.com</strong> (API keys section).</li>
            <li>Paste it into <code>.env</code> as <code>GEMINI_API_KEY=…</code></li>
            <li>Restart the app — the studio unlocks instantly. <code>npm run doctor</code> confirms it loaded.</li>
          </ol>
        </div>
      </section>`;

  return layout("Guide — ClipFlow", appShell(acct, "guide", content));
}

// ---------------------------------------------------------------------------
// status — /status
// ---------------------------------------------------------------------------

export interface StatusInfo {
  version: string;
  engine: {
    running: boolean;
    startedAt: string | null;
    lastPassAt: string | null;
    lastPassMs: number | null;
    passCount: number;
    pollSeconds: number;
    dryRun: boolean;
  };
  zernioConfigured: boolean;
  geminiConfigured: boolean;
}

export function statusPage(acct: Account, info: StatusInfo): string {
  const row = (label: string, value: string, ok?: boolean) => `
    <div class="status-row">
      <dt>${esc(label)}</dt>
      <dd>${ok === undefined ? "" : ok
        ? `<span class="pill pill-active">${icon("check-circle")}OK</span>`
        : `<span class="pill pill-paused">${icon("alert")}Attention</span>`} <span>${value}</span></dd>
    </div>`;

  const e = info.engine;
  const content = `
      <section class="page-head">
        <div>
          <p class="eyebrow">System status</p>
          <h1 class="display page-title">Is it working?</h1>
          <p class="watch-line">Live engine facts — the page to check before you worry.</p>
        </div>
      </section>
      <section class="section-block">
        <dl class="status-list card">
          ${row("Engine", e.running ? `running${e.dryRun ? " (dry run — nothing actually posts)" : ""}` : "not running", e.running)}
          ${row("Watching", acct.whatnotUsername ? `@${esc(acct.whatnotUsername)} every ${e.pollSeconds}s` : "no Whatnot username set", Boolean(acct.whatnotUsername))}
          ${row("Last check", e.lastPassAt ? `${esc(relTime(e.lastPassAt))}${e.lastPassMs !== null ? ` (took ${(e.lastPassMs / 1000).toFixed(1)}s)` : ""}` : "not yet — first pass runs shortly after boot", e.lastPassAt !== null)}
          ${row("Checks since boot", String(e.passCount))}
          ${row("Instagram", acct.instagram ? (acct.instagram.username ? `connected as @${esc(acct.instagram.username)}` : "connected") : "not connected", Boolean(acct.instagram))}
          ${row("TikTok", acct.tiktok ? (acct.tiktok.username ? `connected as @${esc(acct.tiktok.username)}` : "connected") : "not connected", Boolean(acct.tiktok))}
          ${row("Posting service (Zernio)", info.zernioConfigured ? "configured" : "no API key", info.zernioConfigured)}
          ${row("AI show covers (Gemini)", info.geminiConfigured ? "configured" : "no API key — studio locked", info.geminiConfigured)}
          ${row("Version", esc(info.version))}
        </dl>
      </section>`;

  return layout("Status — ClipFlow", appShell(acct, "status", content));
}

// ---------------------------------------------------------------------------
// error pages
// ---------------------------------------------------------------------------

export function errorPage(status: 404 | 429 | 500, refId?: string): string {
  const copy = status === 404
    ? { glyph: "404", eyebrow: "Lost the thread", title: "This page slipped away", body: "The link's broken or the page moved. Let's get you back to somewhere that works." }
    : status === 429
      ? { glyph: "429", eyebrow: "Easy does it", title: "That was a lot, fast", body: "You hit us with a quick burst of requests. Take a breath and try again in a minute." }
      : { glyph: "500", eyebrow: "On us, not you", title: "Something broke on our end", body: `This one's ours to fix, not yours.${refId ? ` If you reach out, mention ref #${refId} and we'll trace it.` : ""}` };
  return layout(`${copy.title} — ClipFlow`, `
    <main class="error-wrap" id="main">
      <div class="error-card">
        <a class="auth-brand" href="/" aria-label="ClipFlow home">${wordmark(26)}</a>
        <div class="error-glyph" aria-hidden="true">${esc(copy.glyph)}</div>
        <p class="eyebrow">${esc(copy.eyebrow)}</p>
        <h1 class="display error-title">${esc(copy.title)}</h1>
        <p class="text-muted error-body">${esc(copy.body)}</p>
        <div class="error-actions">
          <a class="btn btn-primary" href="/">${icon("arrow-right")} Back home</a>
          <a class="btn btn-ghost" href="/dashboard">Go to dashboard</a>
        </div>
      </div>
    </main>`);
}

// ---------------------------------------------------------------------------
// legal pages — served publicly at /privacy and /terms
// ---------------------------------------------------------------------------

/** The date these documents were last written. Bump when the content changes. */
const LEGAL_LAST_UPDATED = "July 13, 2026";
const CONTACT_EMAIL = "abieazizo@gmail.com";

function legalLayout(title: string, lastUpdated: string, sectionsHtml: string): string {
  const body = `
<header class="legal-header">
  <div class="container legal-header-inner">
    <a class="site-nav-brand" href="/" aria-label="ClipFlow home">${wordmark(26)}</a>
    <a class="btn btn-ghost btn-sm" href="/">Back to home</a>
  </div>
</header>
<main id="main" class="legal-main">
  <article class="container legal-doc">
    <p class="eyebrow">Legal</p>
    <h1 class="display legal-title">${esc(title)}</h1>
    <p class="legal-updated">Last updated ${esc(lastUpdated)}</p>
    ${sectionsHtml}
  </article>
</main>
<footer class="site-footer">
  <div class="container site-footer-inner">
    <a class="site-nav-brand" href="/" aria-label="ClipFlow home">${wordmark(22)}</a>
    <nav class="site-footer-links" aria-label="Footer">
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/login">Log in</a>
    </nav>
    <p class="site-footer-copy">© ${new Date().getFullYear()} ClipFlow</p>
  </div>
</footer>`;
  return layout(`${title} — ClipFlow`, body);
}

function mail(): string {
  return `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;
}

export function privacyPage(): string {
  const sections = `
    <p class="legal-lead">This policy explains what ClipFlow collects, why, and the control you have over it. We keep it short because ClipFlow does one thing.</p>

    <h2>What ClipFlow does</h2>
    <p>ClipFlow watches your public Whatnot clips page and, when you publish a clip, posts that vertical video to the Instagram and/or TikTok accounts you have connected — as a Reel on Instagram and as a TikTok. You clip; ClipFlow posts.</p>

    <h2>What we store</h2>
    <ul>
      <li><strong>Your email address</strong> — to identify your account and let you log in.</li>
      <li><strong>A hashed version of your password</strong> — we store a one-way scrypt hash, never the password itself.</li>
      <li><strong>Your Whatnot username</strong> — the public handle whose clips we watch.</li>
      <li><strong>Your caption template and hashtags</strong> — the settings you choose for your posts.</li>
      <li><strong>References to your connected accounts</strong> — when you connect Instagram or TikTok, you authorize our publishing provider (Zernio) directly with that platform. ClipFlow stores only the connected account's id and username; the OAuth tokens are held by Zernio. We never see or store your Instagram or TikTok password.</li>
      <li><strong>Generated covers</strong> — if you use the Show Covers studio, the images you generate and the headline/style you chose, so your gallery persists.</li>
    </ul>

    <h2>How your connections are used</h2>
    <p>Your connected accounts are used for one purpose only: to post your Whatnot clips on your behalf. We do not read your private messages, sell your data, or use your connections for anything else.</p>

    <h2>Disconnecting</h2>
    <p>You can disconnect Instagram or TikTok at any time from your dashboard. Disconnecting removes the stored account reference immediately, and ClipFlow can no longer post there until you reconnect. You can also stop the service entirely by turning off the “Active” switch.</p>

    <h2>Data retention</h2>
    <p>We keep your account data while your account is active. If you want your account and all associated data deleted, email us at ${mail()} and we will remove it.</p>

    <h2>Third parties</h2>
    <p>ClipFlow talks to Whatnot (to read your public clips), publishes through Zernio (our social-posting provider, which holds the platform authorizations you grant), and — if you use the Show Covers studio — sends your headline text and product photos to Google's Gemini API to generate images. Your use of those platforms is governed by their own policies. We do not share your data with anyone else.</p>

    <h2>Contact</h2>
    <p>Questions about your data or this policy? Email ${mail()}.</p>`;
  return legalLayout("Privacy Policy", LEGAL_LAST_UPDATED, sections);
}

export function termsPage(): string {
  const sections = `
    <p class="legal-lead">Plain-language terms for using ClipFlow. By creating an account you agree to these.</p>

    <h2>The service</h2>
    <p>ClipFlow automatically posts clips you publish on Whatnot to the Instagram and TikTok accounts you connect. It acts on your behalf using access you grant through Instagram's and TikTok's own secure sign-in.</p>

    <h2>Your responsibilities</h2>
    <ul>
      <li>You are responsible for the content of your clips, captions, and generated covers, and for having the rights to post them.</li>
      <li>You are responsible for complying with the rules and terms of Whatnot, Instagram, and TikTok. ClipFlow does not exempt you from any platform's policies.</li>
      <li>You must connect only accounts you own or are authorized to manage.</li>
    </ul>

    <h2>No warranty</h2>
    <p>ClipFlow is provided “as is,” without warranty of any kind. Posting depends on Whatnot, Instagram, TikTok, and our providers, whose APIs and rules can change or fail at any time. We do not guarantee that every clip will post, or that the service will be uninterrupted or error-free.</p>

    <h2>Limitation of liability</h2>
    <p>To the fullest extent permitted by law, ClipFlow and its operator are not liable for any indirect or consequential loss arising from your use of the service, including missed posts, removed content, or actions taken by Whatnot, Instagram, or TikTok on your accounts.</p>

    <h2>Changes and availability</h2>
    <p>The operator may change, suspend, or discontinue ClipFlow, in whole or in part, at any time. We may also update these terms; continued use after a change means you accept the updated terms.</p>

    <h2>Contact</h2>
    <p>Questions about these terms? Email ${mail()}.</p>`;
  return legalLayout("Terms of Service", LEGAL_LAST_UPDATED, sections);
}

// ---------------------------------------------------------------------------
// billing — /billing
// ---------------------------------------------------------------------------

export interface BillingView {
  configured: boolean;
  csrf: string;
  /** dev | admin | locked | trial | active | past_due */
  state: string;
  daysLeft: number;
  trialDays: number;
}

export function billingPage(acct: Account, v: BillingView): string {
  const portalForm = (label: string, primary = false) => `
      <form method="post" action="/billing/portal"><input type="hidden" name="csrf" value="${esc(v.csrf)}">
        <button class="btn ${primary ? "btn-primary" : "btn-secondary"}" type="submit" data-loading-text="Opening Stripe…">${label} ${icon("external-link")}</button>
      </form>`;

  let planCard: string;
  if (!v.configured || v.state === "dev") {
    planCard = `
    <div class="card plan-card">
      <span class="pill pill-neutral">${icon("alert")}Billing not configured</span>
      <h2 class="display section-h">Free while in development</h2>
      <p>Stripe isn't set up yet, so posting is unlocked for everyone. When billing goes live, new sellers will add a card to unlock their 1-week free trial.</p>
    </div>`;
  } else if (v.state === "admin") {
    planCard = `
    <div class="card plan-card plan-pro">
      <span class="pill pill-active">${icon("check-circle")}Operator</span>
      <h2 class="display section-h">Billing doesn't apply to you</h2>
      <p>This is the operator account — unlimited posting, never charged. Your sellers go through the card-first flow.</p>
    </div>`;
  } else if (v.state === "past_due") {
    planCard = `
    <div class="card plan-card plan-issue">
      <span class="pill pill-paused">${icon("alert")}Payment issue</span>
      <h2 class="display section-h">Your card needs a look</h2>
      <p>Stripe couldn't charge your card, so posting is paused. Update your payment method and everything resumes automatically.</p>
      ${portalForm("Fix payment", true)}
    </div>`;
  } else if (v.state === "active") {
    planCard = `
    <div class="card plan-card plan-pro">
      <span class="pill pill-active">${icon("check-circle")}ClipFlow Pro</span>
      <h2 class="display section-h">You're on Pro</h2>
      <p>Your free week is over and your subscription is live — unlimited posting, both platforms, AI show covers. Manage your card or cancel any time.</p>
      ${portalForm("Manage billing")}
    </div>`;
  } else if (v.state === "trial") {
    const left = v.daysLeft;
    const pct = Math.max(0, Math.min(100, Math.round((left / v.trialDays) * 100)));
    planCard = `
    <div class="card plan-card">
      <div class="trial-ring" style="--pct:${pct}" role="img" aria-label="${left} of ${v.trialDays} free days left">
        <span class="trial-ring-num display">${left}</span>
        <span class="trial-ring-label">day${left === 1 ? "" : "s"} left</span>
      </div>
      <h2 class="display section-h">Free trial</h2>
      <p>Your card's on file — nothing's been charged. You've got <strong>${left} day${left === 1 ? "" : "s"}</strong> left free. When the week's up, your subscription starts at $19/mo automatically. Cancel any time before then and you'll never be charged.</p>
      ${portalForm("Manage card")}
    </div>`;
  } else {
    // locked — no card yet
    planCard = `
    <div class="card plan-card">
      <span class="pill pill-paused">${icon("lock")}Locked</span>
      <h2 class="display section-h">Add a card to unlock</h2>
      <p><strong>1 week free</strong> — no charge for 7 days, then $19/mo. Add a card to unlock posting. Cancel any time during your free week and you're never charged.</p>
      <form method="post" action="/billing/checkout"><input type="hidden" name="csrf" value="${esc(v.csrf)}">
        <button class="btn btn-primary btn-lg" type="submit" data-loading-text="Opening Stripe…">Add card to unlock ${icon("arrow-right")}</button>
      </form>
    </div>`;
  }

  const content = `
      <section class="page-head">
        <div>
          <p class="eyebrow">Billing</p>
          <h1 class="display page-title">Your plan</h1>
          <p class="watch-line">One plan, everything included. Receipts come from Stripe.</p>
        </div>
      </section>
      <section class="section-block billing-wrap">
        ${planCard}
        <div class="card plan-card plan-includes">
          <h3>What Pro includes</h3>
          <ul class="price-list">
            <li>${icon("check")}Instagram + TikTok posting</li>
            <li>${icon("check")}Unlimited clips</li>
            <li>${icon("check")}AI show covers</li>
            <li>${icon("check")}Priority support</li>
          </ul>
          <p class="field-hint">Payments, invoices, and card storage are handled entirely by Stripe — ClipFlow never sees your card.</p>
        </div>
      </section>`;

  return layout("Billing — ClipFlow", appShell(acct, "billing", content));
}

// ---------------------------------------------------------------------------
// history — /history
// ---------------------------------------------------------------------------

export type HistoryFilter = "all" | "posted" | "failed";

export function historyPage(
  acct: Account,
  posts: PostRow[],
  opts: { csrf: string; filter: HistoryFilter; query?: { retried?: string; error?: string } }
): string {
  const f = opts.filter;
  const filtered = posts.filter((p) =>
    f === "all" ? true : f === "posted" ? p.status === "posted" : p.status === "failed");

  const filterPill = (key: HistoryFilter, text: string) =>
    `<a class="chip chip-filter${f === key ? " is-active" : ""}" href="/history${key === "all" ? "" : `?filter=${key}`}">${text}</a>`;

  function statusPill(p: PostRow): string {
    if (p.status === "posted") {
      return p.via === "draft"
        ? `<span class="pill pill-draft" title="Delivered to the TikTok inbox — tap in the app to post">${icon("check")}In inbox</span>`
        : `<span class="pill pill-posted">${icon("check")}Posted</span>`;
    }
    if (p.status === "failed") {
      return `<span class="pill pill-failed" title="${esc(p.error ?? "")}">${icon("alert")}Failed</span>`;
    }
    return p.attempts > 0
      ? `<span class="pill pill-pending" title="${esc(p.error ?? "")}">${icon("radio")}Retrying (${p.attempts}/4)</span>`
      : `<span class="pill pill-pending">${icon("radio")}Pending</span>`;
  }

  const rows = filtered.map((p) => `
    <li class="hist-row card">
      <span class="hist-platform">${icon(p.platform)}</span>
      <div class="hist-main">
        <p class="hist-title" title="${esc(p.clipTitle ?? p.clipId)}">${esc(p.clipTitle ?? "Untitled clip")}</p>
        <p class="hist-sub">${esc(relTime(p.postedAt ?? p.createdAt))}${p.error && p.status !== "posted" ? ` · <span class="hist-error" title="${esc(p.error)}">${esc(p.error.slice(0, 60))}${p.error.length > 60 ? "…" : ""}</span>` : ""}</p>
      </div>
      ${statusPill(p)}
      ${p.status === "failed" ? `
      <form method="post" action="/history/retry/${esc(p.id)}" class="hist-retry-form">
        <input type="hidden" name="csrf" value="${esc(opts.csrf)}">
        <button class="btn btn-secondary btn-sm" type="submit" data-loading-text="Queuing…">Retry</button>
      </form>` : ""}
    </li>`).join("");

  const empty = `
    <div class="empty-state card">
      ${icon("activity", "empty-icon")}
      <h3>${f === "failed" ? "Nothing has failed" : f === "posted" ? "Nothing posted yet" : "No posts yet"}</h3>
      <p>${f === "failed"
        ? "Love that for you. Failures would show up here with a one-click retry."
        : "Publish a clip on your next Whatnot show and every post lands here with its status."}</p>
    </div>`;

  const content = `
      <section class="page-head">
        <div>
          <p class="eyebrow">History</p>
          <h1 class="display page-title">Every post, accounted for</h1>
          <p class="watch-line">Each clip × platform, with live status and retries you control.</p>
        </div>
      </section>
      <div class="hist-filters">
        ${filterPill("all", "All")}
        ${filterPill("posted", "Posted")}
        ${filterPill("failed", "Failed")}
      </div>
      <section class="section-block">
        ${filtered.length === 0 ? empty : `<ul class="hist-list">${rows}</ul>`}
      </section>`;

  const flash = { retried: opts.query?.retried ?? null, error: opts.query?.error ?? null };
  return layout("History — ClipFlow", appShell(acct, "history", content, flash));
}

// ---------------------------------------------------------------------------
// admin — /admin
// ---------------------------------------------------------------------------

export function adminPage(
  acct: Account,
  stats: { users: number; activeSubs: number; posts7d: number; failures7d: number },
  users: Array<Account & { postCount: number }>,
  events: Array<{ at: string; accountId: string | null; type: string; detail: string | null }>,
  csrf: string
): string {
  const userRows = users.map((u) => `
    <tr>
      <td class="mono">${esc(u.email)}${u.isAdmin ? ` <span class="pill pill-neutral">admin</span>` : ""}</td>
      <td>${esc(u.plan)}${u.subscriptionStatus ? ` <small class="text-muted">(${esc(u.subscriptionStatus)})</small>` : ""}</td>
      <td>${u.postCount}</td>
      <td>${esc(new Date(u.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))}</td>
      <td>
        <form method="post" action="/admin/toggle/${esc(u.id)}" class="admin-toggle-form">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <button class="btn btn-ghost btn-sm" type="submit">${u.disabled ? "Enable" : "Disable"}</button>
        </form>
      </td>
    </tr>`).join("");

  const eventRows = events.map((e) => `
    <li class="event-row">
      <span class="event-time mono">${esc(new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</span>
      <span class="pill pill-neutral">${esc(e.type)}</span>
      <span class="event-detail">${esc(e.detail ?? "")}</span>
    </li>`).join("");

  const content = `
      <section class="page-head">
        <div>
          <p class="eyebrow">Admin</p>
          <h1 class="display page-title">Operator view</h1>
        </div>
      </section>
      <section class="stats-row" aria-label="Global stats">
        <div class="stat-card card"><span class="stat-num">${stats.users}</span><span class="stat-label">Users</span></div>
        <div class="stat-card card"><span class="stat-num">${stats.activeSubs}</span><span class="stat-label">Active subs</span></div>
        <div class="stat-card card"><span class="stat-num">${stats.posts7d}</span><span class="stat-label">Posts (7d)</span></div>
        <div class="stat-card card"><span class="stat-num">${stats.failures7d}</span><span class="stat-label">Failures (7d)</span></div>
      </section>
      <section class="section-block">
        <div class="section-head"><h2 class="display section-h">Users</h2></div>
        <div class="table-wrap card">
          <table class="admin-table">
            <thead><tr><th>Email</th><th>Plan</th><th>Posts</th><th>Joined</th><th></th></tr></thead>
            <tbody>${userRows}</tbody>
          </table>
        </div>
      </section>
      <section class="section-block">
        <div class="section-head"><h2 class="display section-h">Recent events</h2></div>
        <ul class="event-list card">${eventRows || `<li class="event-row"><span class="event-detail">Nothing yet.</span></li>`}</ul>
      </section>`;

  return layout("Admin — ClipFlow", appShell(acct, "admin", content));
}

// ---------------------------------------------------------------------------
// forgot / reset / goodbye
// ---------------------------------------------------------------------------

export function forgotPage(sent = false): string {
  const body = `
<main class="auth-wrap" id="main">
  <div class="auth-card card">
    <a class="auth-brand" href="/" aria-label="ClipFlow home">${wordmark(30)}</a>
    <h1 class="auth-title display">Reset your password</h1>
    ${sent ? `
    <div class="banner banner-info" role="status">${icon("check-circle")}<span>If that email exists, we sent a reset link. It works once, for 30 minutes.</span></div>
    <p class="auth-switch"><a href="/login">Back to log in</a></p>` : `
    <p class="auth-sub">Tell us your email and we'll send a one-time link.</p>
    <form method="post" action="/forgot" class="auth-form" novalidate>
      <div class="field">
        <label class="field-label" for="email">Email</label>
        <input class="input" type="email" id="email" name="email" autocomplete="email" required
               placeholder="you@example.com" inputmode="email" autocapitalize="off" spellcheck="false">
      </div>
      <button class="btn btn-primary btn-lg btn-block" type="submit" data-loading-text="Sending…">Send reset link</button>
    </form>
    <p class="auth-switch"><a href="/login">Back to log in</a></p>`}
  </div>
</main>`;
  return layout("Reset password — ClipFlow", body);
}

export function resetPage(token: string, invalid = false): string {
  const body = `
<main class="auth-wrap" id="main">
  <div class="auth-card card">
    <a class="auth-brand" href="/" aria-label="ClipFlow home">${wordmark(30)}</a>
    ${invalid ? `
    <h1 class="auth-title display">Link expired</h1>
    <p class="auth-sub">That reset link is no longer valid — they only work once, for 30 minutes.</p>
    <p><a class="btn btn-primary btn-block" href="/forgot">Request a new one</a></p>` : `
    <h1 class="auth-title display">Choose a new password</h1>
    <form method="post" action="/reset/${esc(token)}" class="auth-form" novalidate>
      <div class="field">
        <label class="field-label" for="password">New password</label>
        <div class="input-affix">
          <input class="input" type="password" id="password" name="password" required minlength="8"
                 autocomplete="new-password" placeholder="At least 8 characters">
          <button type="button" class="input-affix-btn" data-toggle-password="password"
                  aria-label="Show password" aria-pressed="false" hidden>
            ${icon("eye", "icon-eye")}${icon("eye-off", "icon-eye-off")}
          </button>
        </div>
      </div>
      <button class="btn btn-primary btn-lg btn-block" type="submit" data-loading-text="Saving…">Set new password</button>
    </form>`}
  </div>
</main>`;
  return layout("Choose a new password — ClipFlow", body);
}

export function goodbyePage(): string {
  const body = `
<main class="auth-wrap" id="main">
  <div class="auth-card card" style="text-align:center">
    ${logoMark(48)}
    <h1 class="auth-title display">Account deleted</h1>
    <p class="auth-sub">Everything's gone — data, clips, covers, and any subscription. Thanks for giving ClipFlow a spin. The door's always open.</p>
    <p><a class="btn btn-secondary" href="/">Back home</a></p>
  </div>
</main>`;
  return layout("Goodbye — ClipFlow", body);
}
