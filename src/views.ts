/**
 * views.ts — server-rendered HTML for ClipFlow. No framework, no build step.
 * Design system lives in public/css/system.css ("a letter from a seller, with
 * receipts attached"); behavior in small vanilla modules under public/js/.
 *
 * The receipt is the product's memory: one component (receipt()) renders
 * every proof surface — landing, dashboard, post history, pricing, billing.
 * Mono type is for verifiable facts only. One accent. One primary action
 * per screen.
 */

import { statSync } from "node:fs";
import {
  accountState, trialDaysLeft, TRIAL_DAYS,
  type Account, type PostRow,
} from "./db.js";
import { loadAppSettings } from "./appconfig.js";
import type { ClipRow } from "./engine.js";
import type { ThumbRecord } from "./thumbstore.js";
import { STYLE_SPECS, type ThumbStyle, type StyleSpec } from "./gemini.js";
import { CAPTION_PRESETS, effectiveTemplate, renderTemplate } from "./caption.js";

/** Cache-buster: system.css mtime, read once at boot. */
const ASSET_VER = (() => {
  try { return statSync("public/css/system.css").mtimeMs.toString(36); } catch { return "1"; }
})();

// The founder — real, checkable handles. Never invent proof.
const SELLER_NAME = process.env.CF_SELLER_NAME || "Abie";
const SELLER_WN = (process.env.CF_SELLER_HANDLE || "squishycrew").replace(/^@+/, "");
const SELLER_IG = "squishycrew.live";
const SELLER_TT = "squisheycrew";
const CONTACT_EMAIL = "abieazizo@gmail.com";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

/** Safe JSON island for <script type="application/json"> (not executable). */
function jsonIsland(id: string, data: unknown): string {
  return `<script type="application/json" id="${id}">${JSON.stringify(data)
    .replace(/</g, "\\u003c")}</script>`;
}

/** A timestamp cell: SSR fallback text + data-iso so JS localizes it. */
function tstamp(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return `<span class="receipt-time">${fallback}</span>`;
  const d = new Date(iso);
  const txt = Number.isFinite(d.getTime())
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false })
    : fallback;
  return `<span class="receipt-time" data-iso="${esc(iso)}">${esc(txt)}</span>`;
}

// ---------------------------------------------------------------------------
// icons — 24px grid, stroke 1.75, round caps
// ---------------------------------------------------------------------------

const ICON_PATHS: Record<string, string> = {
  instagram: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.4"/><circle cx="16.9" cy="7.1" r="1" stroke="none" fill="currentColor"/>',
  tiktok: '<path fill="currentColor" stroke="none" d="M14.8 3h2.9c.3 2.3 1.6 3.6 3.8 3.9v3c-1.5-.03-2.8-.5-3.9-1.3v6.1a6 6 0 1 1-6-6.1l.6.02v3.2a2.9 2.9 0 1 0 2.6 2.9V3z"/>',
  whatnot: '<circle cx="12" cy="12" r="8.75"/><path d="M8 9.5l1.6 5 2.4-5 2.4 5 1.6-5"/>',
  clip: '<rect x="3.5" y="5" width="17" height="14" rx="3.5"/><path d="M10.5 9.7v4.6l4.2-2.3z"/>',
  scissors: '<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="M8.6 8.3 20 19M8.6 15.7 20 5"/>',
  play: '<path d="M9 6.8v10.4l8.6-5.2z" fill="currentColor" stroke="none"/>',
  check: '<path d="m4.5 12.8 4.8 4.7L19.5 6.5"/>',
  "check-circle": '<circle cx="12" cy="12" r="8.75"/><path d="m8.4 12.3 2.5 2.5 4.7-5.4"/>',
  "arrow-right": '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  "external-link": '<path d="M13.5 5H6.7A2.2 2.2 0 0 0 4.5 7.2v10.1a2.2 2.2 0 0 0 2.2 2.2h10.1a2.2 2.2 0 0 0 2.2-2.2v-6.8"/><path d="M14 10 20.5 3.5M15 3.5h5.5V9"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  "eye-off": '<path d="M4 4l16 16"/><path d="M9.9 5.2A9.3 9.3 0 0 1 12 5c6 0 9.5 7 9.5 7a17.6 17.6 0 0 1-2.9 3.8M6.3 6.9C3.8 8.8 2.5 12 2.5 12s3.5 7 9.5 7a8.5 8.5 0 0 0 4-1"/><path d="M9.9 9.9a2.9 2.9 0 0 0 4.1 4.1"/>',
  "chevron-right": '<path d="m9.5 6 6 6-6 6"/>',
  alert: '<path d="M12 3.8 2.8 19.5a.8.8 0 0 0 .7 1.2h17a.8.8 0 0 0 .7-1.2z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17.2" r="0.4" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3V6.5"/><path d="M6.5 6.5 7.3 19a1.8 1.8 0 0 0 1.8 1.7h5.8A1.8 1.8 0 0 0 16.7 19l.8-12.5"/><path d="M10 10.5v6M14 10.5v6"/>',
  sparkles: '<path d="M12 4.5c.6 3.3 2.2 4.9 5.5 5.5-3.3.6-4.9 2.2-5.5 5.5-.6-3.3-2.2-4.9-5.5-5.5 3.3-.6 4.9-2.2 5.5-5.5z"/><path d="M18.8 15.2c.3 1.6 1 2.3 2.7 2.7-1.7.3-2.4 1-2.7 2.7-.3-1.7-1-2.4-2.7-2.7 1.7-.4 2.4-1.1 2.7-2.7z"/>',
  home: '<path d="M4.5 10.5 12 4l7.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-5.5h-4v5.5H6A1.5 1.5 0 0 1 4.5 19z"/>',
  receipt: '<path d="M6 3.5h12V19l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m3.5 16.5 4.6-4.2 4 3.6 3.3-2.9 5.1 4.5"/>',
  sliders: '<path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2.2"/><circle cx="8" cy="16" r="2.2"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/>',
  "log-out": '<path d="M9 20.5H6.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2H9"/><path d="m15.5 16.5 4.5-4.5-4.5-4.5M20 12H9.5"/>',
  "help-circle": '<circle cx="12" cy="12" r="8.75"/><path d="M9.4 9.2a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 3.8"/><circle cx="12" cy="17" r="0.4" fill="currentColor" stroke="none"/>',
  card: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M3.5 10h17"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12h9M17 12v3M20.5 12v2"/>',
};

function icon(name: keyof typeof ICON_PATHS | string, cls = ""): string {
  const paths = ICON_PATHS[name] ?? ICON_PATHS.alert;
  return `<svg class="icon${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/** The brand device: display statements end with a berry full stop. */
function wordmark(): string {
  return `<span class="wordmark"><span class="wordmark-text">ClipFlow<span class="period">.</span></span></span>`;
}
const WORDMARK_INNER = `<span class="wordmark-text">ClipFlow<span class="period">.</span></span>`;

// ---------------------------------------------------------------------------
// mark chips + THE RECEIPT — one component, everywhere proof appears
// ---------------------------------------------------------------------------

/** 20px status glyphs — the check draws itself at celebration moments. */
const GLYPH = {
  ok: `<span class="glyph glyph-ok" aria-label="posted"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="draw" d="M6 10.4l2.6 2.6L14 7.6"/></svg></span>`,
  queue: `<span class="glyph glyph-queue" aria-label="queued"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="5.6"/><path d="M10 7.2V10l1.9 1.4"/></svg></span>`,
  err: `<span class="glyph glyph-err" aria-label="failed"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 5.6v5.2"/><circle cx="10" cy="14.2" r="0.6" fill="currentColor" stroke="none"/></svg></span>`,
  spin: `<span class="glyph glyph-spin" aria-label="retrying"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15.6 10a5.6 5.6 0 1 1-2.2-4.45"/></svg></span>`,
};
const MARK = {
  you: `<span class="status-word sw-faint">YOU</span>`,
  auto: `<span class="status-word sw-faint">AUTO</span>`,
  posted: GLYPH.ok,
  failed: GLYPH.err,
  retrying: GLYPH.spin,
  included: `<span class="status-word sw-faint">INCLUDED</span>`,
};

interface ReceiptLine {
  /** left cell: pre-rendered time html (tstamp()) or plain mono text */
  time: string;
  /** the fact, bold body type */
  what: string;
  /** line under the fact — platform + handle (mono unless whoPlain) */
  who?: string;
  /** labels read in body type; values stay mono */
  whoPlain?: boolean;
  /** right cell: a status glyph / mono word / amount */
  mark?: string;
  /** optional 44px thumbnail url */
  thumb?: string;
  /** wrap the line in a button that opens this sheet id */
  sheet?: string;
}

interface ReceiptOpts {
  head?: [string, string];
  lines: ReceiptLine[];
  total?: [string, string];
  note?: string;
  /** entrance choreography: the ledger card rises while its rows stagger in */
  print?: boolean;
  /** first-success moment: posted glyphs spring in and draw their checks */
  celebrate?: boolean;
  /** ms after the receipt scrolls into view before printing starts */
  printDelay?: number;
  /** who-lines wrap instead of truncating — for receipts where the handle IS the proof */
  loose?: boolean;
  /** barcode footer — pass a REAL post/clip id only; omit in demo contexts */
  code?: string;
  id?: string;
}

/** THE LEDGER. A white surface card of facts: mono time, event, status glyph. */
function receipt(o: ReceiptOpts): string {
  let i = 0;
  const line = (l: ReceiptLine) => {
    const noTime = !l.thumb && l.time === "";
    // a missing/black poster never renders as a black box — wash + glyph shows through
    const inner = `
      ${l.thumb ? `<span class="receipt-thumb">${icon("clip")}<img src="${esc(l.thumb)}" alt="" loading="lazy" data-thumb-fallback></span>` : noTime ? "" : l.time}
      <span class="receipt-what">
        ${l.thumb ? `<span class="who">${l.time}</span>` : ""}
        <span class="fact-row"><span class="what">${l.what}</span>${l.mark ?? ""}</span>
        ${l.who ? `<span class="who${l.whoPlain ? " who-plain" : " mono"}">${l.who}</span>` : ""}
      </span>`;
    const cls = `receipt-line${l.thumb ? " has-thumb" : ""}${noTime ? " no-time" : ""}`;
    const style = ` style="--i:${i++}"`;
    // Tappable lines are divs with role=button, NOT <button>: a failed line
    // carries a real <form> (Retry), and forms can't nest inside buttons.
    return l.sheet
      ? `<div class="${cls} is-tappable" role="button" tabindex="0"${style} data-sheet-open="${esc(l.sheet)}">${inner}</div>`
      : `<div class="${cls}"${style}>${inner}</div>`;
  };
  const paper = `
  <div class="receipt-paper">
    <div class="receipt${o.loose ? " receipt-loose" : ""}"${o.id ? ` id="${o.id}"` : ""}>
      ${o.head ? `<div class="receipt-head" style="--i:${i++}"><span>${esc(o.head[0])}</span><span>${esc(o.head[1])}</span></div>` : ""}
      ${o.lines.map(line).join("")}
      ${o.total ? `<div class="receipt-total" style="--i:${i++}"><span>${esc(o.total[0])}</span><span class="amount">${esc(o.total[1])}</span></div>` : ""}
      ${o.code ? `<div class="receipt-code" style="--i:${i++}"><div class="code-id">${esc(o.code)}</div></div>` : ""}
      ${o.note ? `<div class="receipt-note">${o.note}</div>` : ""}
    </div>
  </div>`;
  return o.print
    ? `<div class="will-print${o.celebrate ? " will-celebrate" : ""}"${o.printDelay ? ` data-print-delay="${o.printDelay}"` : ""}>${paper}</div>`
    : paper;
}

// ---------------------------------------------------------------------------
// how-to-clip demo — an abstract live-stream phone (never Whatnot's real UI)
// showing the two taps that matter: Clip during the live, then make it public.
// Pure CSS animation; reduced-motion shows the frozen final frame.
// ---------------------------------------------------------------------------

function clipDemo(): string {
  return `
  <div class="clip-demo" role="img" aria-label="During your live, tap the Clip button. Then make the clip public so ClipFlow can see it.">
    <div class="cd-stage" aria-hidden="true">
      <div class="cd-phone">
        <span class="cd-island"></span>
        <div class="cd-screen">
          <img src="/demo/live-clip-poster.webp" alt="" loading="lazy">
          <span class="cd-scrim cd-scrim-top"></span>
          <span class="cd-scrim cd-scrim-bot"></span>
          <span class="cd-live"><span class="cd-livedot"></span>LIVE</span>
          <div class="cd-hearts"><i></i><i></i><i></i></div>
          <div class="cd-chat">
            <span class="cd-bubble" style="--b:0"><i class="cd-ava" style="--a:#7C5CFF"></i>need that one!!</span>
            <span class="cd-bubble" style="--b:1"><i class="cd-ava" style="--a:#2FB6A3"></i>&#128293;&#128293;&#128293;</span>
            <span class="cd-bubble" style="--b:2"><i class="cd-ava" style="--a:#F5A524"></i>W squish</span>
          </div>
          <span class="cd-clipbtn">${icon("scissors")}<span>Clip</span></span>
          <span class="cd-toast mono">Clip saved</span>
          <div class="cd-panel">
            <span class="cd-grab"></span>
            <div class="cd-cliprow">
              <img class="cd-clipthumb" src="/demo/live-clip-poster.webp" alt="">
              <div><p class="cd-panel-title">Your clip</p><p class="cd-panel-sub mono">just now</p></div>
            </div>
            <div class="cd-row"><span>Make it public</span><span class="cd-switch"><span class="cd-knob"></span></span></div>
            <p class="cd-public">Public &mdash; ClipFlow posts it</p>
          </div>
          <span class="cd-tap cd-tap1"></span>
          <span class="cd-tap cd-tap2"></span>
        </div>
      </div>
    </div>
    <ol class="cd-steps">
      <li><span class="step-num cd-n1">1</span><div><p class="s-label">Tap Clip during your live</p><p class="s-sub">The button you already use.</p></div></li>
      <li><span class="step-num cd-n2">2</span><div><p class="s-label">Make the clip public</p><p class="s-sub">Private clips are invisible to ClipFlow.</p></div></li>
      <li><span class="step-num cd-n3">3</span><div><p class="s-label">Done &mdash; it posts itself</p><p class="s-sub">Instagram Reels + TikTok, captioned.</p></div></li>
    </ol>
  </div>`;
}

function clipDemoSheet(): string {
  return sheet("clip-demo", "How to clip", clipDemo(),
    `<button class="btn btn-quiet" type="button" data-sheet-close>Got it</button>`);
}

// ---------------------------------------------------------------------------
// documents + shells
// ---------------------------------------------------------------------------

interface DocOpts {
  bodyClass?: string;
  scripts?: string[];
  csrf?: string;
  noindex?: boolean;
  /** stage-dominant page (404, goodbye): dark body + dark theme-color */
  stage?: boolean;
  /** extra page-scoped stylesheets loaded after system.css (landing only) */
  styles?: string[];
}

function doc(title: string, body: string, o: DocOpts = {}): string {
  const scripts = ["/js/core.js", ...(o.scripts ?? [])];
  const bodyClass = [o.stage ? "stage-body" : "", o.bodyClass ?? ""].filter(Boolean).join(" ");
  return `<!doctype html>
<html lang="en" class="js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="Every clip from your Whatnot live, posted to Instagram Reels and TikTok. Automatic.">
${(o.bodyClass ?? "").includes("land")
    ? `<meta name="theme-color" content="#FBFAF9">`
    : `<meta name="theme-color" content="#FAF8F3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141210" media="(prefers-color-scheme: dark)">`}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="Every clip from your Whatnot live, posted to Instagram Reels and TikTok. Automatic.">
<meta property="og:image" content="${esc(loadAppSettings().baseUrl)}/og.png">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
${o.noindex ? `<meta name="robots" content="noindex">` : ""}
${o.csrf ? `<meta name="cf-csrf" content="${esc(o.csrf)}">` : ""}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/Geist-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/Geist-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/GeistMono-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/ClashDisplay-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/system.css?v=${ASSET_VER}">
${(o.styles ?? []).map((s) => `<link rel="stylesheet" href="${s}?v=${ASSET_VER}">`).join("\n")}
<noscript><style>[data-rise],.late-rise{opacity:1 !important;transform:none !important}.will-print .receipt-paper,.will-print .receipt-line,.will-print .receipt-head,.will-print .receipt-total,.will-print .receipt-code{opacity:1 !important;transform:none !important}</style></noscript>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
<a class="skip-link" href="#main">Skip to content</a>
<div class="toast-zone" aria-live="polite"></div>
${body}
${scripts.map((s) => `<script src="${s}?v=${ASSET_VER}" defer></script>`).join("\n")}
</body>
</html>`;
}

/** Exported for compatibility — a bare document around a body. */
export function layout(title: string, body: string): string {
  return doc(title, body);
}

type Tab = "home" | "clips" | "studio" | "settings";

const TABS: Array<{ key: Tab; href: string; label: string; ic: string }> = [
  { key: "home", href: "/dashboard", label: "Home", ic: "home" },
  { key: "clips", href: "/history", label: "Clips", ic: "receipt" },
  { key: "studio", href: "/studio", label: "Studio", ic: "image" },
  { key: "settings", href: "/settings", label: "Settings", ic: "sliders" },
];

/** Filled variants for the active tab icon. */
const ICON_FILLED: Record<string, string> = {
  home: '<path d="M4.5 10.5 12 4l7.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-5.5h-4v5.5H6A1.5 1.5 0 0 1 4.5 19z" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  receipt: '<path d="M6 3.5h12V19l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8h6M9 11.5h6M9 15h3.5" stroke="#F6F6F8" stroke-width="1.6" stroke-linecap="round"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3" fill="currentColor"/><circle cx="9" cy="10" r="1.6" fill="#F6F6F8"/><path d="m3.5 16.5 4.6-4.2 4 3.6 3.3-2.9 5.1 4.5" stroke="#F6F6F8" stroke-width="1.6" fill="none"/>',
  sliders: '<path d="M4 8h10M18 8h2M4 16h2M10 16h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="8" r="3" fill="currentColor"/><circle cx="8" cy="16" r="3" fill="currentColor"/>',
};

function iconFilled(name: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${ICON_FILLED[name] ?? ICON_PATHS[name]}</svg>`;
}

function tabbar(current: Tab): string {
  return `<nav class="tabbar" aria-label="App">
    ${TABS.map((t) => `<a href="${t.href}"${t.key === current ? ` aria-current="page"` : ""}>${icon(t.ic)}<span>${t.label}</span></a>`).join("")}
  </nav>`;
}

interface ShellOpts {
  title: string;
  tab: Tab;
  content: string;
  scripts?: string[];
  csrf?: string;
  /** extra html appended after main (sheets live here) */
  after?: string;
  /** takeover screens (celebration) hide the tab bar entirely */
  noTabs?: boolean;
  /** rail footer identity (desktop sidebar) */
  who?: { name: string; email: string };
}

function shellWho(acct: Account): { name: string; email: string } {
  return { name: acct.whatnotUsername ? `@${acct.whatnotUsername}` : "Your shop", email: acct.email };
}

/** App shell: mobile = slim top bar + floating glass tab bar;
    desktop (≥1024px) = fixed left rail with the same nav + account footer. */
function appShell(o: ShellOpts): string {
  const who = o.who;
  return doc(`${o.title} — ClipFlow`, `
<div class="shell">
  <aside class="rail">
    <a class="wordmark rail-brand" href="/dashboard" aria-label="ClipFlow home">${WORDMARK_INNER}</a>
    <nav class="rail-nav" aria-label="App">
      ${TABS.map((t) => `<a href="${t.href}"${t.key === o.tab ? ` aria-current="page"` : ""}>${icon(t.ic)}<span>${t.label}</span></a>`).join("")}
    </nav>
    ${who ? `<div class="rail-foot">
      <span class="rail-ava" aria-hidden="true">${esc((who.name.replace(/^@+/, "") || who.email).charAt(0).toUpperCase())}</span>
      <span class="rail-who"><span class="rw-name mono">${esc(who.name)}</span><span class="rw-mail">${esc(who.email)}</span></span>
      <a href="/logout" aria-label="Log out">${icon("log-out")}</a>
    </div>` : ""}
  </aside>
  <div class="shell-main">
    <div class="content-col">
      <header class="appbar">
        <a class="wordmark" href="/dashboard" aria-label="ClipFlow home">${WORDMARK_INNER}</a>
      </header>
      <main id="main">
        ${o.content}
      </main>
    </div>
  </div>
</div>
${o.after ?? ""}
<div class="sheet-scrim" data-sheet-scrim hidden></div>
${o.noTabs ? "" : tabbar(o.tab)}`, { bodyClass: o.noTabs ? undefined : "has-tabs", scripts: o.scripts, csrf: o.csrf, noindex: true });
}

/** A bottom sheet. Hidden until core.js opens it by id. */
function sheet(id: string, title: string, bodyHtml: string, actionsHtml = ""): string {
  return `
<section class="sheet" id="sheet-${id}" role="dialog" aria-modal="true" aria-label="${esc(title)}" hidden>
  <div class="sheet-handle" aria-hidden="true"></div>
  <h2 class="display">${esc(title)}</h2>
  <div class="sheet-body">${bodyHtml}</div>
  ${actionsHtml ? `<div class="sheet-actions">${actionsHtml}</div>` : ""}
</section>`;
}

// ---------------------------------------------------------------------------
// LANDING — skepticism → proof → belief → commitment. Under 220 words.
// ---------------------------------------------------------------------------

export function landingPage(): string {
  const proofReceipt = receipt({
    print: true,
    printDelay: 250,
    loose: true,
    lines: [
      { time: `<span class="receipt-time">9:41</span>`, what: "Clipped", who: `Whatnot @${SELLER_WN}`, mark: MARK.you },
      { time: `<span class="receipt-time">9:42</span>`, what: "Posted", who: `Instagram Reels @${SELLER_IG}`, mark: MARK.auto },
      { time: `<span class="receipt-time">9:42</span>`, what: "Posted", who: `TikTok @${SELLER_TT}`, mark: MARK.auto },
    ],
  });

  const pricing = receipt({
    head: ["ClipFlow", "Monthly"],
    lines: [
      { time: "", what: "Reels posting", mark: MARK.included },
      { time: "", what: "TikTok posting", mark: MARK.included },
      { time: "", what: "Auto-captions", mark: MARK.included },
      { time: "", what: "AI show covers", mark: MARK.included },
      { time: "", what: "Your first week", mark: `<span class="mono">$0.00</span>` },
    ],
    total: ["After that", "$19/mo"],
    note: "Cancel in Settings. Two taps.",
  });

  const body = `
<div class="land-atmos" aria-hidden="true" data-atmos>
  <span class="land-grid"></span>
  <span class="land-grain"></span>
</div>
<div class="wrap">
  <nav class="land-nav" data-land-nav>
    <a class="wordmark" href="/"><span class="wordmark-text">ClipFlow<span class="period">.</span></span></a>
    <a class="btn btn-quiet btn-small" href="/login">Log in</a>
  </nav>

  <header class="land-hero" id="main">
    <p class="eyebrow" data-rise style="--i:0"><span class="eyebrow-dot"></span>For Whatnot sellers</p>
    <h1 class="display" data-rise style="--i:1">Clip it<span class="period">.</span><br>It posts <span class="hl">itself</span><span class="period">.</span></h1>
    <p class="hero-sub" data-rise style="--i:2">Every clip from your live, posted to Instagram Reels + TikTok. Automatic.</p>

    <div class="proof-unit" id="proof-unit">
      <span class="hero-spot" aria-hidden="true"></span>
      <div class="stage-glow" aria-hidden="true"></div>
      <figure class="clip-card rise-hero" data-rise style="--i:3">
        <video src="/demo/live-clip.mp4" poster="/demo/live-clip-poster.webp" preload="metadata" muted playsinline loop autoplay data-clip-video></video>
        <span class="clip-chips">
          <span class="clip-chip"><span class="dot dot-live"></span>LIVE CLIP</span>
          <span class="clip-chip">0:23</span>
        </span>
        <figcaption class="clip-who">@${SELLER_WN} &middot; Whatnot</figcaption>
      </figure>
      ${proofReceipt}
    </div>
    <p class="proof-caption fine" data-rise style="--i:4">My real shop. Check my Reels after any live. &mdash; ${esc(SELLER_NAME)}, <a class="mono" href="https://www.whatnot.com/user/${SELLER_WN}" target="_blank" rel="noopener">@${SELLER_WN}</a></p>

    <div class="land-cta" data-rise style="--i:5">
      <a class="btn" href="/signup">Try it on your next show</a>
      <p class="fine">First week free &middot; $19/mo &middot; cancel in two taps</p>
    </div>
  </header>

  <section class="land-section" aria-label="Check your handle">
    <div class="card handle-check-card" data-rise>
      <h2 class="display">See it with your clips<span class="period">.</span></h2>
      <form class="handle-check-form" data-handle-check>
        <label class="field">
          <span class="field-label">Your Whatnot username</span>
          <span class="field-wrap has-prefix"><span class="field-prefix">@</span>
            <input class="field-input mono" name="u" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="text" required maxlength="30">
          </span>
        </label>
        <button class="btn" type="submit" data-loading-text="Looking&hellip;">Show me</button>
      </form>
      <div class="handle-result" data-handle-result hidden></div>
    </div>
  </section>

  <section class="land-section" aria-label="How it works">
    <div class="steps-list">
      <div class="step-line" data-rise style="--i:0"><span class="t">9:41</span><div><p class="what">You clip on Whatnot</p><p class="how">The button you already use.</p></div></div>
      <div class="step-line" data-rise style="--i:1"><span class="t">9:41</span><div><p class="what">We catch it</p><p class="how">Watching your public profile.</p></div></div>
      <div class="step-line" data-rise style="--i:2"><span class="t">9:42</span><div><p class="what">It&rsquo;s out</p><p class="how">Reels + TikTok posted, captioned.</p></div></div>
    </div>
  </section>

  <section class="land-section" aria-label="Safety">
    <div class="safety-card" data-rise>
      <ul>
        <li>${icon("check-circle")}<span>You log in on Instagram&rsquo;s and TikTok&rsquo;s own pages. We never see passwords.</span></li>
        <li>${icon("check-circle")}<span>One permission: publish. No DMs, no followers.</span></li>
        <li>${icon("check-circle")}<span>Disconnect any time &mdash; kills it instantly.</span></li>
      </ul>
    </div>
  </section>

  <section class="land-section" aria-label="Pricing">
    <div class="pricing-wrap" data-rise>${pricing}</div>
  </section>

  <section class="land-section" aria-label="Questions">
    <div class="faq-list">
      <div class="faq-item" data-rise style="--i:0"><p class="q">Will this get me banned?</p><p class="a">No. Official platform tools &mdash; the route brands use.</p></div>
      <div class="faq-item" data-rise style="--i:1"><p class="q">Do TikToks post by themselves?</p><p class="a">Yes. If TikTok&rsquo;s daily limit hits, the clip lands in your drafts &mdash; one tap.</p></div>
      <div class="faq-item" data-rise style="--i:2"><p class="q">What do I do during shows?</p><p class="a">Clip. That&rsquo;s it.</p></div>
    </div>
  </section>

  <section class="land-final">
    <span class="land-final-glow" aria-hidden="true"></span>
    <h2 class="display" data-rise>Your next clip could post <span class="grad">itself</span><span class="period">.</span></h2>
    <a class="btn" href="/signup" data-rise style="--i:1">Try it on your next show</a>
  </section>

  <footer class="land-footer">
    ${wordmark()}
    <nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/login">Log in</a></nav>
    <p class="land-sig">&copy; 2026 ClipFlow &middot; built by a seller, for sellers</p>
  </footer>
</div>

<div class="dock" data-dock hidden>
  <a class="btn" href="/signup">Try it on your next show</a>
</div>`;

  return doc("ClipFlow — your Whatnot clips post themselves", body, { scripts: ["/js/landing.js"], bodyClass: "washed land", styles: ["/css/landing.css"] });
}

// ---------------------------------------------------------------------------
// AUTH — one card, no marketing repeat
// ---------------------------------------------------------------------------

export function authPage(mode: "login" | "signup", error?: string, email?: string): string {
  const isSignup = mode === "signup";
  const errHtml = error
    ? `<p class="field-error" role="alert">${esc(error)}${/already has an account/i.test(error) ? ` <a href="/login">Log in</a>` : ""}</p>`
    : "";
  const body = `
<main class="auth-wrap" id="main">
  <div class="auth-grid">
    <div class="auth-hero">
      <span class="auth-bloom" aria-hidden="true"></span>
      <a class="auth-brand" href="/" aria-label="ClipFlow home">${wordmark()}</a>
      <h1 class="auth-statement" data-rise style="--i:0">Turn your lives into Reels &amp; TikToks<span class="period">.</span><br>Automatically<span class="period">.</span></h1>
      <p class="auth-hero-sub" data-rise style="--i:1">Clip on Whatnot like you already do &mdash; ClipFlow posts it everywhere else.</p>
    </div>
    <div class="card auth-card" data-rise style="--i:2">
      <h2 class="auth-title display">${isSignup ? "Create your account" : "Log in"}</h2>
      <form method="post" action="/${mode}">
        <label class="field">
          <span class="field-label">Email</span>
          <input class="field-input" type="email" name="email" value="${esc(email ?? "")}" autocomplete="email" inputmode="email" required maxlength="254">
        </label>
        <label class="field">
          <span class="field-label">Password</span>
          <span class="field-wrap">
            <input class="field-input" type="password" name="password" autocomplete="${isSignup ? "new-password" : "current-password"}" required minlength="8" maxlength="200">
            <button type="button" class="field-eye" data-eye aria-label="Show password">${icon("eye")}</button>
          </span>
          ${errHtml}
        </label>
        <button class="btn btn-block" type="submit" data-loading-text="${isSignup ? "Creating&hellip;" : "Logging in&hellip;"}">${isSignup ? "Create account" : "Log in"}</button>
      </form>
      ${isSignup
        ? `<p class="auth-fine fine">First week free. No card yet.</p>
           <p class="auth-switch">Already set up? <a href="/login">Log in</a></p>`
        : `<p class="auth-switch"><a href="/forgot">Forgot password?</a></p>
           <p class="auth-switch">New here? <a href="/signup">Create an account</a></p>`}
    </div>
  </div>
</main>`;
  return doc(`${isSignup ? "Create account" : "Log in"} — ClipFlow`, body, { noindex: true });
}

export function forgotPage(sent = false): string {
  const body = `
<main class="auth-wrap" id="main">
  <div class="card auth-card" data-rise style="--i:0">
    <a class="auth-brand" href="/" aria-label="ClipFlow home">${wordmark()}</a>
    <h1 class="auth-title display">Reset your password</h1>
    ${sent ? `
    <div class="banner banner-ok" role="status">${icon("check-circle")}<span>If that email has an account, a reset link is on the way. It works once, for 30 minutes.</span></div>
    <p class="auth-switch"><a href="/login">Back to log in</a></p>` : `
    <p class="auth-sub">We&rsquo;ll email you a one-time link.</p>
    <form method="post" action="/forgot">
      <label class="field">
        <span class="field-label">Email</span>
        <input class="field-input" type="email" name="email" autocomplete="email" inputmode="email" required maxlength="254">
      </label>
      <button class="btn btn-block" type="submit" data-loading-text="Sending&hellip;">Email me the link</button>
    </form>
    <p class="auth-switch"><a href="/login">Back to log in</a></p>`}
  </div>
</main>`;
  return doc("Reset password — ClipFlow", body, { noindex: true });
}

export function resetPage(token: string, invalid = false): string {
  const body = `
<main class="auth-wrap" id="main">
  <div class="card auth-card" data-rise style="--i:0">
    <a class="auth-brand" href="/" aria-label="ClipFlow home">${wordmark()}</a>
    ${invalid ? `
    <h1 class="auth-title display">Link expired</h1>
    <p class="auth-sub">Reset links work once, for 30 minutes. This one&rsquo;s done.</p>
    <a class="btn btn-block" href="/forgot">Get a new link</a>` : `
    <h1 class="auth-title display">New password</h1>
    <form method="post" action="/reset/${esc(token)}">
      <label class="field">
        <span class="field-label">New password</span>
        <span class="field-wrap">
          <input class="field-input" type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="200">
          <button type="button" class="field-eye" data-eye aria-label="Show password">${icon("eye")}</button>
        </span>
        <p class="field-help">8 characters or more.</p>
      </label>
      <button class="btn btn-block" type="submit" data-loading-text="Saving&hellip;">Save password</button>
    </form>`}
  </div>
</main>`;
  return doc("New password — ClipFlow", body, { noindex: true });
}

export function goodbyePage(): string {
  const body = `
<main class="error-wrap" id="main">
  <div class="stage-hero">
    <h1 class="display" data-rise style="--i:0">Account deleted<span class="period">.</span></h1>
    <p data-rise style="--i:1">Your data, clips, and covers are gone. Anything already posted stays on your accounts.</p>
    <a class="btn btn-block" data-rise style="--i:2" href="/">Back home</a>
  </div>
</main>`;
  return doc("Goodbye — ClipFlow", body, { noindex: true, stage: true });
}

// ---------------------------------------------------------------------------
// WIZARD — /welcome, six screens, one step each, back always works
// ---------------------------------------------------------------------------

export interface WizardQuery {
  connected?: string;
  error?: string;
}

const WIZ_STEPS = 7;

function wizDots(step: number): string {
  return `<div class="dots" role="progressbar" aria-valuemin="1" aria-valuemax="${WIZ_STEPS}" aria-valuenow="${step}" aria-label="Step ${step} of ${WIZ_STEPS}">
    ${Array.from({ length: WIZ_STEPS }, (_, i) => `<span${i < step ? ` class="on"` : ""}></span>`).join("")}
  </div>`;
}

export function welcomePage(
  acct: Account,
  step: number,
  csrf: string,
  status: { metaConfigured: boolean; tiktokConfigured: boolean; canConnect?: boolean },
  query: WizardQuery = {}
): string {
  const canConnect = status.canConnect ?? true;
  const s = Math.min(Math.max(Math.trunc(step) || 1, 1), WIZ_STEPS);
  const uname = acct.whatnotUsername;

  let content = "";
  let after = "";
  const scripts = ["/js/wizard.js"];

  if (s === 1) {
    content = `
    <section class="wiz-step" data-rise style="--i:0">
      <h1 class="display">What&rsquo;s your Whatnot username?</h1>
      <p class="wiz-sub">Just your public page. No Whatnot login exists here.</p>
      <form class="wiz-body stack" method="post" action="/welcome/username">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <label class="field">
          <span class="field-wrap has-prefix"><span class="field-prefix">@</span>
            <input class="field-input mono" name="whatnotUsername" value="${esc(uname)}" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="30" pattern="[a-zA-Z0-9._\\-]{2,30}">
          </span>
          ${query.error === "bad_username" ? `<p class="field-error" role="alert">Lowercase letters, numbers, dots and dashes only &mdash; like on your Whatnot page.</p>` : ""}
        </label>
        <div class="wiz-actions">
          <button class="btn" type="submit" data-loading-text="Looking&hellip;">Find my shop</button>
        </div>
      </form>
    </section>`;
  } else if (s === 2) {
    content = `
    <section class="wiz-step" data-wiz-proof data-handle="${esc(uname)}">
      <div data-proof-loading>
        <h1 class="display">Looking up <span class="mono">@${esc(uname)}</span>&hellip;</h1>
        <div class="wiz-body stack">
          <div class="skeleton" style="height:84px;width:84px;border-radius:50%;margin-inline:auto"></div>
          <div class="skeleton" style="height:180px"></div>
        </div>
      </div>
      <div data-proof-found hidden>
        <h1 class="display">Found you<span class="period">.</span></h1>
        <div class="wiz-found" data-proof-profile></div>
        <div class="wiz-body">
          <p class="sub" style="text-align:center">If ClipFlow had been on last show:</p>
          <div class="stack" data-proof-receipt style="margin-top:var(--s-3)"></div>
        </div>
      </div>
      <div data-proof-empty hidden>
        <h1 class="display">Found you<span class="period">.</span></h1>
        <div class="wiz-found" data-proof-profile-empty></div>
        <p class="wiz-sub" style="margin-top:var(--s-4)">No <strong>public</strong> clips yet. We can only see clips you&rsquo;ve made public on Whatnot.</p>
        <p class="wiz-sub" style="margin-top:var(--s-2)">Already clipped? Open your Whatnot clips and make them public &mdash; or publish one on your next live.</p>
      </div>
      <div data-proof-notfound hidden>
        <h1 class="display">That username isn&rsquo;t on Whatnot<span class="period">.</span></h1>
        <p class="wiz-sub">Couldn&rsquo;t find <span class="mono">@${esc(uname)}</span>. Check the spelling and try again.</p>
      </div>
      <div data-proof-error hidden>
        <h1 class="display">Couldn&rsquo;t reach Whatnot<span class="period">.</span></h1>
        <p class="wiz-sub">Give it a minute, or continue &mdash; we&rsquo;ll keep checking in the background.</p>
      </div>
      <div class="wiz-actions" data-proof-actions hidden>
        <a class="btn" href="/welcome?step=3">Yes &mdash; post my clips</a>
        <a class="wiz-quiet-link" href="/welcome?step=1">Wrong shop? Change username</a>
      </div>
      <div class="wiz-actions" data-proof-retry hidden>
        <a class="btn" href="/welcome?step=1">Try a different username</a>
      </div>
      <div class="wiz-actions" data-proof-continue hidden>
        <a class="btn" href="/welcome?step=3">Continue anyway</a>
        <a class="wiz-quiet-link" href="/welcome?step=1">Change username</a>
      </div>
    </section>`;
  } else if (s === 3 || s === 4) {
    const platform = s === 3 ? "instagram" : "tiktok";
    const label = s === 3 ? "Instagram" : "TikTok";
    const conn = acct[platform];
    const configured = s === 3 ? status.metaConfigured : status.tiktokConfigured;
    const next = s === 3 ? "/welcome?step=4" : "/welcome?step=5";
    content = `
    <section class="wiz-step" data-rise style="--i:0">
      <h1 class="display">Connect ${label}</h1>
      ${query.error ? `<p class="field-error" role="alert">${esc(connectError(query.error, label))}</p>` : ""}
      <div class="wiz-body card connect-card">
        <span class="connect-glyph">${icon(platform)}</span>
        ${conn
          ? `<p class="connect-done">${icon("check")} @${esc(conn.username || "connected")}</p>
             <p class="sub" style="margin-top:var(--s-3)">Connected. Clips will post here.</p>`
          : s === 3
            ? `<p class="sub">Opens Instagram&rsquo;s official login. We never see your password.</p>`
            : `<p class="sub">Opens TikTok&rsquo;s official login. We never see your password.</p>
               <p class="fine" style="margin-top:var(--s-3)">Posts straight to your TikTok. If TikTok&rsquo;s daily limit hits, it lands in your drafts &mdash; one tap.</p>`}
      </div>
      <div class="wiz-actions">
        ${conn
          ? `<a class="btn" href="${next}">Next</a>`
          : !configured
            ? `<button class="btn" disabled>Connect ${label}</button>
               <p class="fine">Connections are being set up on our end &mdash; skip for now.</p>
               <a class="wiz-quiet-link" href="${next}">Skip for now</a>`
            : !canConnect
              ? `<a class="btn" href="/billing?need=connect&platform=${platform}">Add a card to connect</a>
                 <p class="fine">First week free &mdash; your card just unlocks connecting. Nothing charges today.</p>
                 <a class="wiz-quiet-link" href="${next}">Skip for now</a>`
              : `<a class="btn" href="/connect/${platform}?from=welcome">${icon(platform, "brand")} Connect ${label}</a>
                 <a class="wiz-quiet-link" href="${next}">Skip for now</a>`}
      </div>
    </section>`;
  } else if (s === 5) {
    const presets = Object.keys(CAPTION_PRESETS) as Array<keyof typeof CAPTION_PRESETS>;
    content = `
    <section class="wiz-step" data-caption-editor>
      <h1 class="display">Your caption</h1>
      <p class="wiz-sub">Written for you on every post. Pick the voice.</p>
      <div class="wiz-body stack">
        <div class="preset-row" role="group" aria-label="Caption style">
          ${presets.map((p) => `<button type="button" class="preset-btn" data-preset="${p}" aria-pressed="${acct.captionPreset === p}">${p[0].toUpperCase() + p.slice(1)}</button>`).join("")}
          <button type="button" class="preset-btn" data-preset="custom" aria-pressed="${acct.captionPreset === "custom"}">Mine</button>
        </div>
        <label class="field" data-custom-wrap ${acct.captionPreset === "custom" ? "" : "hidden"}>
          <span class="field-label">Your template</span>
          <textarea class="field-input mono" data-custom-template rows="4" maxlength="2200">${esc(acct.captionTemplate)}</textarea>
          <p class="field-help">Slots: {title} {username} {hashtags}</p>
        </label>
        <div class="caption-preview" data-caption-preview aria-live="polite"></div>
      </div>
      <div class="wiz-actions">
        <button class="btn" type="button" data-caption-save data-next="/welcome?step=6" data-loading-text="Saving&hellip;">Looks good</button>
        <a class="wiz-quiet-link" href="/welcome?step=6">Skip &mdash; default is fine</a>
      </div>
    </section>
    ${captionIsland(acct)}`;
  } else if (s === 6) {
    content = `
    <section class="wiz-step" data-rise style="--i:0">
      <h1 class="display">One thing to remember<span class="period">.</span></h1>
      <p class="wiz-sub">Clips only reach ClipFlow when they&rsquo;re <strong>public</strong>. Here&rsquo;s the whole move:</p>
      <div class="wiz-body card">${clipDemo()}</div>
      <div class="wiz-actions">
        <a class="btn" href="/welcome?step=7">Got it</a>
      </div>
    </section>`;
  } else {
    // one signal per fact: the leading ✓ says "done"; the right side is the
    // quiet mono handle. Captions show the template's opening words, not a name.
    const capWords = (() => {
      const tpl = effectiveTemplate(acct)
        .replace(/\{title\}|\{hashtags\}|\{username\}/g, "")
        .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
        .replace(/\s+/g, " ").trim();
      return tpl ? (tpl.length > 24 ? tpl.slice(0, 23).trimEnd() + "…" : tpl) : "title + hashtags";
    })();
    const brandCell = (name: string) => `<span class="receipt-time">${icon(name, "brand-row")}</span>`;
    const quietHandle = (h: string) => `<span class="mono fine">${h}</span>`;
    content = `
    <section class="wiz-step" data-rise style="--i:0">
      <h1 class="display">You&rsquo;re set<span class="period">.</span></h1>
      <p class="wiz-sub">Go live like normal. Clip like normal &mdash; and make your clips <strong>public</strong>. That&rsquo;s the whole job.</p>
      <div class="wiz-body">
        ${receipt({
          head: ["ClipFlow", "Ready"],
          lines: [
            { time: brandCell("whatnot"), what: "Watching", mark: quietHandle(`@${esc(uname)}`) },
            { time: brandCell("instagram"), what: "Instagram Reels", mark: acct.instagram ? quietHandle(`@${esc(acct.instagram.username || "connected")}`) : quietHandle("not yet") },
            { time: brandCell("tiktok"), what: "TikTok", mark: acct.tiktok ? quietHandle(`@${esc(acct.tiktok.username || "connected")}`) : quietHandle("not yet") },
            { time: brandCell("receipt"), what: "Captions", mark: quietHandle(esc(capWords)) },
          ],
          print: true,
        })}
      </div>
      <div class="wiz-actions">
        <form method="post" action="/welcome/complete">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <button class="btn btn-block" type="submit" data-loading-text="Opening&hellip;">Open my dashboard</button>
        </form>
        <button type="button" class="wiz-quiet-link" data-sheet-open="founder" style="margin-inline:auto">Who made this?</button>
      </div>
    </section>`;
    after = sheet("founder", "Hi — I'm Abie.",
      `<p>I sell on Whatnot as <a class="mono" href="https://www.whatnot.com/user/${SELLER_WN}" target="_blank" rel="noopener">@${SELLER_WN}</a>. I built ClipFlow because after a long show, reposting clips was the chore I always skipped. It runs my shop&rsquo;s clips every show &mdash; yours go through the same pipeline.</p>
       <p class="mono" style="margin-top:var(--s-3);font-size:12.5px">IG @${SELLER_IG} &middot; TikTok @${SELLER_TT}</p>`);
  }

  const backHref = s > 1 ? `/welcome?step=${s - 1}` : null;
  const body = `
<div class="wrap wiz-wrap" id="main">
  <div class="wiz-top">
    ${backHref ? `<a class="wiz-back" href="${backHref}">${icon("chevron-right", "flip")} Back</a>` : `<span></span>`}
    ${wizDots(s)}
    <a class="wiz-back" href="/logout" aria-label="Log out">${icon("log-out")}</a>
  </div>
  ${content}
</div>
${after}
<div class="sheet-scrim" data-sheet-scrim hidden></div>`;

  return doc(`Set up — ClipFlow`, body, { scripts, csrf, noindex: true });
}

function connectError(code: string, label: string): string {
  switch (code) {
    case "zernio_not_configured": return `Connections aren't switched on yet — skip for now.`;
    case "zernio_plan_limit": return `Our connection provider is at capacity. Email ${CONTACT_EMAIL} and we'll fix it.`;
    case "connect_incomplete": return `${label} didn't finish connecting. Tap Connect and complete the login.`;
    case "slow_down": return `Too many tries at once. Give it a minute.`;
    default: return `${label} didn't connect. Tap Connect to try again.`;
  }
}

/** Caption data island: presets + user vars for the live preview. */
function captionIsland(acct: Account): string {
  return jsonIsland("caption-data", {
    presets: CAPTION_PRESETS,
    preset: acct.captionPreset,
    template: acct.captionTemplate,
    username: acct.whatnotUsername || "yourshop",
    hashtags: acct.hashtags,
    sample: "Squishy haul round 2 🧸",
  });
}

// ---------------------------------------------------------------------------
// DASHBOARD — /dashboard
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
  mode?: "manual" | "auto";
  lastCheckedAt?: string | null;
  gemini?: { configured: boolean; thumbCount: number };
  stats?: { postedWeek: number; pending: number; failed: number };
  billing?: {
    configured: boolean;
    active: boolean;
    state: string;
    daysLeft: number;
    trialDays: number;
  };
  showVerifyBanner?: boolean;
  setup?: {
    captionTouched: boolean;
    hasPosts: boolean;
    setupSeen: boolean;
    celebrateFirstPost: boolean;
  };
}

/** ClipRow → ledger lines (one line per platform outcome, newest clips first). */
function clipReceiptLines(acct: Account, clips: ClipRow[], max: number): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const postedMark = () => GLYPH.ok;
  for (const c of clips) {
    if (lines.length >= max) break;
    const title = c.title?.trim() || "Clip";
    if (c.instagram) lines.push({
      time: tstamp(c.downloadedAt), what: esc(title),
      who: `Instagram Reels${acct.instagram ? ` @${esc(acct.instagram.username)}` : ""}`,
      mark: postedMark(), thumb: c.hasThumb ? `/thumb/${c.clipId}` : undefined,
    });
    if (lines.length >= max) break;
    if (c.tiktok || c.tiktokDraft) lines.push({
      time: tstamp(c.downloadedAt), what: esc(title),
      who: `TikTok${c.tiktokDraft ? " drafts" : ""}${acct.tiktok ? ` @${esc(acct.tiktok.username)}` : ""}`,
      mark: postedMark(), thumb: c.hasThumb ? `/thumb/${c.clipId}` : undefined,
    });
    if (!c.instagram && !c.tiktok && !c.tiktokDraft && lines.length < max) lines.push({
      time: tstamp(c.downloadedAt), what: esc(title),
      who: "on its way",
      mark: GLYPH.queue, thumb: c.hasThumb ? `/thumb/${c.clipId}` : undefined,
    });
  }
  return lines.slice(0, max);
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
  const connected = Boolean(acct.instagram || acct.tiktok);
  const b = extras.billing;
  const locked = b ? !b.active : false;
  const celebrate = Boolean(extras.setup?.celebrateFirstPost);

  // --- banners -------------------------------------------------------------
  let banners = "";
  const setupMode = !celebrate && (!connected || (locked && clips.length === 0));
  if (query.saved) banners += `<div class="banner banner-ok" role="status">${icon("check-circle")}<span>Saved.</span></div>`;
  if (query.onboarded && !setupMode) banners += `<div class="banner banner-ok" role="status">${icon("check-circle")}<span>Set up. Clip on your next live &mdash; it&rsquo;ll land here.</span></div>`;
  if (query.connected) banners += `<div class="banner banner-ok" role="status">${icon("check-circle")}<span>${query.connected === "tiktok" ? "TikTok" : "Instagram"} connected.</span></div>`;
  if (query.disconnected) banners += `<div class="banner banner-info" role="status">${icon("check-circle")}<span>${query.disconnected === "tiktok" ? "TikTok" : "Instagram"} disconnected. Posting there stopped.</span></div>`;
  if (query.billing === "success") banners += `<div class="banner banner-ok" role="status">${icon("check-circle")}<span>Card added. Posting is unlocked.</span></div>`;
  if (query.error && query.error !== "bad_username") banners += `<div class="banner banner-err" role="alert">${icon("alert")}<span>${esc(decodeURIComponentSafe(query.error))}</span></div>`;

  if (locked && b?.state === "locked" && !setupMode) {
    banners += `<div class="lock-banner">${icon("lock")}<span>Free week ended &middot; <a href="/billing">Add a card to keep posting</a></span></div>`;
  } else if (b && b.state === "trial" && b.daysLeft > 0) {
    banners += `<p class="trial-line" data-trial-banner hidden>
      <span>Free week</span> &middot; <span class="trial-days">${b.daysLeft}</span> <span>day${b.daysLeft === 1 ? "" : "s"} left</span> &middot; <a href="/billing">Add billing</a>
      <button type="button" class="dismiss" data-trial-dismiss aria-label="Dismiss">${icon("x")}</button>
    </p>`;
  } else if (b && b.state === "past_due") {
    banners += `<div class="lock-banner">${icon("alert")}<span>Your card didn&rsquo;t go through &middot; <a href="/billing">Fix billing</a></span></div>`;
  }

  // --- main card -----------------------------------------------------------
  let hero: string;
  if (celebrate) {
    // full-screen takeover — the check drawing itself is the fireworks
    const postedClips = clips.filter((c) => c.instagram || c.tiktok || c.tiktokDraft);
    hero = `
    <section class="takeover" data-celebrate>
      <div class="celebrate-inner">
        <p class="eyebrow late-rise" style="--i:0">First clip</p>
        ${receipt({ print: true, printDelay: 350, id: "first-receipt", code: postedClips[0] ? `clip ${postedClips[0].clipId}` : undefined, celebrate: true, lines: clipReceiptLines(acct, postedClips, 2) })}
        <h1 class="display late-rise" style="--i:1">Your first clip is out<span class="period">.</span></h1>
        <div class="celebrate-actions">
          ${acct.instagram ? `<a class="btn late-rise" style="--i:2" href="https://www.instagram.com/${esc(acct.instagram.username)}/reels/" target="_blank" rel="noopener">View on Instagram ${icon("external-link")}</a>` : ""}
          ${acct.tiktok ? `<a class="btn ${acct.instagram ? "btn-quiet" : ""} late-rise" style="--i:3" href="https://www.tiktok.com/@${esc(acct.tiktok.username)}" target="_blank" rel="noopener">View on TikTok ${icon("external-link")}</a>` : ""}
          <a class="wiz-quiet-link late-rise" style="--i:4" href="/dashboard">Go to my dashboard</a>
        </div>
      </div>
    </section>`;
  } else if (!connected || (locked && clips.length === 0)) {
    // guided setup: one card that says exactly where you are and what's next
    const billingRow = b?.configured ?? false;
    const cardDone = b ? b.active : true;
    type StepState = "done" | "current" | "next";
    // Card-first order: Whatnot → card → connect → clip. Connecting is what
    // starts Zernio billing, so the card genuinely comes first now.
    const steps: Array<{ state: StepState; label: string; sub: string }> = [
      { state: "done", label: "Add your Whatnot", sub: `@${esc(uname)}` },
      ...(billingRow ? [{
        state: (cardDone ? "done" : "current") as StepState,
        label: "Add a card",
        sub: cardDone ? "Free week running" : "Starts your free week — nothing charges today",
      }] : []),
      {
        state: connected ? "done" : (billingRow && !cardDone ? "next" : "current") as StepState,
        label: "Connect Instagram or TikTok",
        sub: connected
          ? [acct.instagram && `@${esc(acct.instagram.username)}`, acct.tiktok && `@${esc(acct.tiktok.username)}`].filter(Boolean).join(" · ")
          : (billingRow && !cardDone ? "Unlocks once your card's on" : "Where your clips will go"),
      },
      { state: "next" as StepState, label: "Clip on your next live", sub: "Make it public — it posts itself from there" },
    ];
    let n = 0;
    const stepRows = steps.map((st) => {
      n++;
      const bullet = st.state === "done"
        ? GLYPH.ok
        : `<span class="step-num${st.state === "current" ? " is-current" : ""}">${n}</span>`;
      return `
      <div class="setup-row is-${st.state}">
        ${bullet}
        <div class="s-body">
          <p class="s-label">${st.label}</p>
          <p class="s-sub${st.state === "done" ? " mono" : ""}">${st.sub}</p>
        </div>
      </div>`;
    }).join("");

    // Card-first: connecting creates a billable Zernio account, so a no-card
    // seller is pointed at billing (their free week starts there); once a card
    // is on file the real Connect buttons appear.
    const actions = !connected
      ? locked
        ? `<a class="btn btn-block" href="/billing?need=connect&platform=instagram">Add a card to connect</a>
           <p class="fine">First week free &mdash; your card unlocks connecting. Nothing charges today.</p>`
        : `${status.metaConfigured ? `<a class="btn btn-block" href="/connect/instagram">${icon("instagram", "brand")} Connect Instagram</a>` : ""}
           ${status.tiktokConfigured ? `<a class="btn btn-quiet btn-block" href="/connect/tiktok">${icon("tiktok", "brand")} Connect TikTok</a>` : ""}
           ${!status.metaConfigured ? `<p class="fine">Connections are being set up on our end &mdash; check back soon.</p>` : ""}`
      : `<a class="btn btn-block" href="/billing">Add a card &mdash; first week free</a>`;

    const doneCount = steps.filter((st) => st.state === "done").length;
    const pct = Math.round((doneCount / steps.length) * 100);
    hero = `
    <section class="card setup-card" data-rise style="--i:1">
      <h2 class="display">${connected ? "One step left" : "Two quick steps"}<span class="period">.</span></h2>
      <div class="launch-meta"><span class="mono-label">Launch sequence</span><span class="mono launch-count">${doneCount} of ${steps.length}</span></div>
      <div class="launch-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${doneCount}" aria-label="Setup progress"><span style="--p:${pct}%"></span></div>
      <div class="setup-rows">${stepRows}</div>
      <div class="setup-actions">${actions}
        <button class="howto-btn" type="button" data-sheet-open="clip-demo" style="justify-self:center">${icon("scissors")}See how to clip</button>
      </div>
    </section>`;
  } else {
    const failed = extras.stats?.failed ?? 0;
    const hasReceipts = clips.length > 0;
    // the watcher card holds exactly three things: ping, who, ticking elapsed
    hero = `
    <section class="card status-card" data-rise style="--i:0">
      <div class="status-head">
        <span class="dot dot-idle" data-watch-dot></span>
        <div>
          <p class="status-title">Watching <span class="mono">@${esc(uname)}</span></p>
          ${extras.lastCheckedAt ? `<p class="since mono">checked <span data-check-tick data-ts="${esc(extras.lastCheckedAt)}">${esc(relShort(extras.lastCheckedAt))}</span> ago</p>` : ""}
        </div>
      </div>
      ${hasReceipts ? "" : `<p class="status-line">Clip during your live and make it <strong>public</strong> &mdash; it&rsquo;ll show up here.</p>`}
    </section>
    <p data-rise style="--i:1;text-align:center"><button class="btn-text" type="button" data-check-now data-loading-text="Checking&hellip;">Check for clips now</button>${hasReceipts ? "" : `<button class="howto-btn" type="button" data-sheet-open="clip-demo">${icon("scissors")}How to clip</button>`}</p>
    ${failed > 0 ? `<p class="fail-row" data-rise style="--i:2">${failed} post${failed === 1 ? "" : "s"} didn&rsquo;t go out &mdash; <a href="/history?filter=failed">Fix in Clips</a></p>` : ""}`;
  }

  const recent = clipReceiptLines(acct, clips, 3);
  const recents = celebrate ? "" : recent.length ? `
    <section class="home-receipts" data-rise style="--i:1">
      <div class="row-between"><h2>Latest</h2><a class="see-all" href="/history">All clips ${icon("arrow-right")}</a></div>
      ${receipt({ lines: recent, print: true })}
    </section>` : connected ? `
    <section class="home-receipts" data-rise style="--i:1">
      <div class="empty">
        <div class="empty-art">${icon("receipt")}</div>
        <h3>No clips yet<span class="period">.</span></h3>
        <p>Clip on your next live and make it public &mdash; we can only see public clips.</p>
      </div>
    </section>` : "";

  const hello = celebrate || !uname ? "" : `
    <header class="hello" data-rise style="--i:0">
      <span class="hello-pfp" data-hello-pfp>${esc(uname.charAt(0).toUpperCase())}</span>
      <div>
        <p class="hello-hi" data-greet>Hi</p>
        <p class="hello-name" data-hello-name>@${esc(uname)}</p>
      </div>
    </header>`;

  const content = `
    ${hello}
    ${banners}
    ${hero}
    ${recents}
  `;

  return appShell({
    title: "Home", tab: "home", content, csrf, who: shellWho(acct),
    scripts: ["/js/home.js"],
    noTabs: celebrate,
    after: celebrate ? "" : clipDemoSheet(),
  });
}

function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function relShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// CLIPS / POST HISTORY — /history
// ---------------------------------------------------------------------------

export type HistoryFilter = "all" | "posted" | "failed";

export function historyPage(
  acct: Account,
  posts: PostRow[],
  opts: { csrf: string; filter: HistoryFilter; query?: { retried?: string; error?: string }; active?: boolean }
): string {
  const startFilter = opts.filter === "failed" ? "failed" : "all";

  const handleFor = (p: PostRow) =>
    p.platform === "instagram"
      ? `Instagram Reels${acct.instagram ? ` @${esc(acct.instagram.username)}` : ""}`
      : `TikTok${p.via === "draft" ? " drafts" : ""}${acct.tiktok ? ` @${esc(acct.tiktok.username)}` : ""}`;

  const counts = {
    all: posts.length,
    instagram: posts.filter((p) => p.platform === "instagram").length,
    tiktok: posts.filter((p) => p.platform === "tiktok").length,
    failed: posts.filter((p) => p.status === "failed").length,
  };

  const statusChip = (p: PostRow) =>
    p.status === "posted" ? `<span class="chip chip-ok">Posted</span>`
      : p.status === "failed" ? `<span class="chip chip-flare">Failed</span>`
      : `<span class="chip chip-wait">${p.attempts > 0 ? "Retrying" : "Queued"}</span>`;

  // populated: a gallery of clip cards — the "my content lives here" surface
  const stack = posts.length
    ? `<div class="clipgrid" data-history-stack>
        ${posts.map((p, i) => `
        <div class="clipcard" data-post data-platform="${p.platform}" data-status="${p.status}">
          <button type="button" class="clipcard-media" data-sheet-open="post-${i}" aria-label="Open details: ${esc(p.clipTitle?.trim() || "Clip")}">
            ${icon("clip")}
            <img src="/thumb/${esc(p.clipId)}" alt="" loading="lazy" data-thumb-fallback>
            ${statusChip(p)}
            <span class="clip-badge" aria-hidden="true">${icon(p.platform === "instagram" ? "instagram" : "tiktok")}</span>
            <span class="clip-play" aria-hidden="true">${icon("play")}</span>
          </button>
          <div class="clipcard-body">
            <p class="clipcard-title">${esc(p.clipTitle?.trim() || "Clip")}</p>
            <p class="clipcard-meta mono">${p.platform === "instagram" ? "Reels" : p.via === "draft" ? "TT drafts" : "TikTok"} &middot; <span data-iso="${esc(p.postedAt ?? p.createdAt)}">${esc(relShort(p.postedAt ?? p.createdAt))}</span></p>
          </div>
          ${p.status === "failed" ? `<form class="retry-inline" method="post" action="/history/retry/${esc(p.id)}"><input type="hidden" name="csrf" value="${esc(opts.csrf)}"><button class="retry-btn" type="submit" data-loading-text="&hellip;">Retry now</button></form>` : ""}
        </div>`).join("")}
      </div>
      <div class="empty" data-filter-empty hidden>
        <h3>Nothing here</h3>
        <p>No posts match this filter.</p>
      </div>`
    : `<div class="empty" style="padding-bottom:var(--s-4)">
        <h3>No clips yet<span class="period">.</span></h3>
        <p>Here&rsquo;s the whole move on your next live:</p>
      </div>
      <div class="card">${clipDemo()}</div>`;

  const sheets = posts.map((p, i) => {
    const caption = renderTemplate(effectiveTemplate(acct), {
      title: p.clipTitle ?? "", username: acct.whatnotUsername, hashtags: acct.hashtags,
    });
    const profileUrl = p.platform === "instagram"
      ? (acct.instagram ? `https://www.instagram.com/${esc(acct.instagram.username)}/reels/` : null)
      : (acct.tiktok ? `https://www.tiktok.com/@${esc(acct.tiktok.username)}` : null);
    return sheet(`post-${i}`, p.clipTitle?.trim() || "Clip", `
      <img class="clip-detail-thumb" src="/thumb/${esc(p.clipId)}" alt="" loading="lazy" data-thumb-fallback>
      <p class="mono" style="font-size:12.5px">${handleFor(p)} &middot; <span data-iso="${esc(p.postedAt ?? p.createdAt)}">${esc(relShort(p.postedAt ?? p.createdAt))}</span></p>
      ${p.status === "failed" && p.error ? `<p class="field-error" style="margin-top:var(--s-3)">${esc(trimError(p.error))}</p>` : ""}
      <p class="fine" style="margin-top:var(--s-4)">Caption used</p>
      <div class="caption-preview">${esc(caption)}</div>
      <div class="receipt-code"><div class="code-id">post ${esc(p.id)}</div></div>`,
      `${p.status === "failed" ? `<form method="post" action="/history/retry/${esc(p.id)}"><input type="hidden" name="csrf" value="${esc(opts.csrf)}"><button class="btn btn-block" type="submit" data-loading-text="Queuing&hellip;">Retry this post</button></form>` : ""}
       ${profileUrl && p.status === "posted" ? `<a class="btn" href="${profileUrl}" target="_blank" rel="noopener">${p.platform === "instagram" ? "View on Instagram" : "Open TikTok"} ${icon("external-link")}</a>` : ""}
       <button class="btn btn-quiet" type="button" data-sheet-close>Close</button>`);
  }).join("");

  const content = `
    <section class="page-head row-between" data-rise style="--i:0">
      <h1 class="display page-title">Clips</h1>
      ${posts.length ? `<button class="howto-btn" type="button" data-sheet-open="clip-demo">${icon("scissors")}How to clip</button>` : ""}
    </section>
    ${opts.query?.retried ? `<div class="banner banner-ok" role="status">${icon("check-circle")}<span>Retry queued. It posts within a few minutes.</span></div>` : ""}
    <div class="seg" role="group" aria-label="Filter clips" data-filters data-start="${startFilter}">
      <span class="seg-pill" aria-hidden="true"></span>
      <button type="button" data-filter="all" aria-pressed="true">All <span class="seg-n">${counts.all}</span></button>
      <button type="button" data-filter="instagram" aria-pressed="false">IG <span class="seg-n">${counts.instagram}</span></button>
      <button type="button" data-filter="tiktok" aria-pressed="false">TikTok <span class="seg-n">${counts.tiktok}</span></button>
      <button type="button" data-filter="failed" aria-pressed="false">Failed <span class="seg-n">${counts.failed}</span></button>
    </div>
    ${stack}`;

  return appShell({
    title: "Clips", tab: "clips", content, csrf: opts.csrf, who: shellWho(acct),
    scripts: ["/js/clips.js"], after: sheets + clipDemoSheet(),
  });
}

/** Errors say what broke + the fix — never a raw provider dump. */
function trimError(err: string): string {
  const s = err.replace(/\s+/g, " ").trim();
  return s.length > 160 ? s.slice(0, 157) + "…" : s;
}

// ---------------------------------------------------------------------------
// STUDIO — /thumbnails
// ---------------------------------------------------------------------------

export function thumbnailsPage(
  acct: Account,
  thumbs: ThumbRecord[],
  clips: ClipRow[],
  opts: { configured: boolean; csrf: string; styles: Record<ThumbStyle, StyleSpec>; left: number; perDay: number; active?: boolean }
): string {
  const kept = thumbs.filter((t) => t.kept);
  const styleKeys = Object.keys(opts.styles) as ThumbStyle[];
  const latestTitle = clips[0]?.title?.trim() ?? "";

  const form = opts.configured ? `
    <section class="card">
      <form class="studio-form" data-studio-form>
        <label class="field">
          <span class="field-label">Show title</span>
          <input class="field-input" name="headline" value="${esc(latestTitle.slice(0, 60))}" maxlength="80" required placeholder="Friday squish night">
        </label>
        <div class="style-row" role="group" aria-label="Style">
          ${styleKeys.map((k, i) => `
          <button type="button" class="style-btn" data-style="${k}" aria-pressed="${i === 0}">
            <span class="swatch" style="background:linear-gradient(135deg, ${opts.styles[k].swatch[0]}, ${opts.styles[k].swatch[1]})"></span>
            ${esc(opts.styles[k].label)}
          </button>`).join("")}
        </div>
        <button class="btn" type="submit" ${opts.left <= 0 ? "disabled" : ""}>Make my cover</button>
        <p class="fine quota-line"><span class="quota-meter" aria-hidden="true"><span style="--q:${opts.perDay > 0 ? Math.round((opts.left / opts.perDay) * 100) : 0}%"></span></span><span><span class="mono">${opts.left} of ${opts.perDay}</span> left today</span></p>
      </form>
      <div class="gen-stage" data-studio-loading hidden>
        <div class="gen-skels" aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div></div>
        <p class="gen-status" data-studio-status aria-live="polite">warming up&hellip;</p>
      </div>
      <div class="cover-result" data-studio-result hidden></div>
    </section>` : `
    <section class="card">
      <p class="sub">Covers aren&rsquo;t switched on yet. Everything else works &mdash; check back soon.</p>
    </section>`;

  const grid = kept.length ? `
    <section class="home-receipts">
      <div class="row-between"><h2>Your covers</h2></div>
      <div class="cover-grid" data-cover-grid>
        ${kept.map((t) => `
        <figure data-cover-id="${esc(t.id)}">
          <img src="/thumb-gen/${esc(t.id)}.webp" alt="${esc(t.headline)}" loading="lazy">
          <button type="button" class="cover-del" data-cover-del="${esc(t.id)}" aria-label="Delete cover">${icon("trash")}</button>
        </figure>`).join("")}
      </div>
    </section>` : opts.configured ? `
    <section class="home-receipts">
      <div class="row-between"><h2>Your covers</h2></div>
      <div class="cover-grid ghost" aria-hidden="true">
        <figure class="ghost-cover"><span class="ghost-type">FRIDAY<br>NIGHT<br>SQUISH</span></figure>
        <figure class="ghost-cover"><span class="ghost-type">$1<br>STARTS</span></figure>
        <figure class="ghost-cover"><span class="ghost-type">BIG<br>BREAKS</span></figure>
      </div>
      <div class="empty" style="padding-top:var(--s-4);padding-bottom:var(--s-2)">
        <h3>No covers yet<span class="period">.</span></h3>
        <p>Type your show title above &mdash; first one takes about a minute.</p>
      </div>
    </section>` : "";

  const content = `
    <section class="page-head" data-rise style="--i:0">
      <h1 class="display page-title">Covers for your next show<span class="period">.</span></h1>
    </section>
    ${form}
    ${grid}`;

  return appShell({
    title: "Studio", tab: "studio", content, csrf: opts.csrf, who: shellWho(acct),
    scripts: ["/js/studio.js"],
  });
}

// ---------------------------------------------------------------------------
// SETTINGS — /settings, grouped iOS-style list
// ---------------------------------------------------------------------------

export function settingsPage(acct: Account, opts: { csrf: string; active: boolean }): string {
  const csrf = opts.csrf;
  const settings = loadAppSettings();
  const state = accountState(acct, settings.stripeConfigured);
  const daysLeft = trialDaysLeft(acct);

  // Connecting is card-gated (it starts Zernio billing). A no-card seller's
  // "Connect" points at billing; a carded seller connects straight away.
  const canConnect = !(state === "locked" || state === "past_due");
  const platformRow = (platform: "instagram" | "tiktok", label: string) => {
    const conn = acct[platform];
    return conn
      ? `<button type="button" class="grow" data-sheet-open="disc-${platform}">
          ${icon(platform)}
          <span class="grow-label">${label}<span class="grow-sub">Locked to your account</span></span>
          <span class="grow-value mono"><span class="dot dot-ok"></span>@${esc(conn.username || "connected")}</span>
          ${icon("lock", "chev")}
        </button>`
      : `<a class="grow" href="${canConnect ? `/connect/${platform}` : `/billing?need=connect&platform=${platform}`}">
          ${icon(platform)}
          <span class="grow-label">${label}<span class="grow-sub">${canConnect ? "Not connected" : "Add a card to connect"}</span></span>
          <span class="grow-value grow-cta">Connect</span>
        </a>`;
  };

  const billingValue = !settings.stripeConfigured ? "—"
    : state === "trial" ? `Free week · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
    : state === "active" ? "$19/mo"
    : state === "past_due" ? "Card issue"
    : state === "locked" ? "Add a card"
    : "—";

  const presetLabel = acct.captionPreset === "custom" ? "Your own words"
    : acct.captionPreset[0].toUpperCase() + acct.captionPreset.slice(1);

  const content = `
    <section class="page-head" data-rise style="--i:0">
      <h1 class="display page-title">Settings</h1>
    </section>

    <div class="group">
      <p class="group-title">Connections</p>
      <div class="group-list">
        <button type="button" class="grow" data-sheet-open="handle">
          ${icon("whatnot")}
          <span class="grow-label">Whatnot</span>
          <span class="grow-value mono">${acct.whatnotUsername ? `@${esc(acct.whatnotUsername)}` : "Add handle"}</span>
          ${icon("chevron-right", "chev")}
        </button>
        ${platformRow("instagram", "Instagram")}
        ${platformRow("tiktok", "TikTok")}
      </div>
    </div>

    <div class="group">
      <p class="group-title">Posting</p>
      <div class="group-list">
        <label class="grow">
          ${icon("check-circle")}
          <span class="grow-label">Posting on<span class="grow-sub">Off = nothing posts anywhere</span></span>
          <span class="switch"><input type="checkbox" data-pause-toggle ${acct.enabled ? "checked" : ""}><span class="knob"></span></span>
        </label>
        <label class="grow">
          ${icon("sparkles")}
          <span class="grow-label">Post automatically<span class="grow-sub">Off = only when you tap Check</span></span>
          <span class="switch"><input type="checkbox" data-mode-toggle ${acct.postingMode === "auto" ? "checked" : ""}><span class="knob"></span></span>
        </label>
        <button type="button" class="grow" data-sheet-open="caption">
          ${icon("receipt")}
          <span class="grow-label">Caption style</span>
          <span class="grow-value">${esc(presetLabel)}</span>
          ${icon("chevron-right", "chev")}
        </button>
      </div>
    </div>

    <div class="group">
      <p class="group-title">Billing</p>
      <div class="group-list">
        <a class="grow" href="/billing">
          ${icon("card")}
          <span class="grow-label">Plan</span>
          <span class="grow-value mono">${esc(billingValue)}</span>
          ${icon("chevron-right", "chev")}
        </a>
      </div>
    </div>

    <div class="group">
      <p class="group-title">Account</p>
      <div class="group-list">
        <div class="grow">
          ${icon("mail")}
          <span class="grow-label">Email<span class="grow-sub">${esc(acct.email)}</span></span>
          ${acct.emailVerifiedAt ? `<span class="status-word sw-ok">VERIFIED</span>` : ""}
        </div>
        <button type="button" class="grow" data-sheet-open="password">
          ${icon("key")}
          <span class="grow-label">Change password</span>
          ${icon("chevron-right", "chev")}
        </button>
        <a class="grow grow-logout" href="/logout">
          ${icon("log-out")}
          <span class="grow-label">Log out</span>
          ${icon("chevron-right", "chev")}
        </a>
        <button type="button" class="grow grow-danger" data-sheet-open="delete">
          ${icon("trash")}
          <span class="grow-label">Delete account</span>
          ${icon("chevron-right", "chev")}
        </button>
      </div>
    </div>

    ${acct.isAdmin ? `
    <div class="group">
      <p class="group-title">Operator</p>
      <div class="group-list">
        <a class="grow" href="/admin">
          ${icon("sliders")}
          <span class="grow-label">Admin<span class="grow-sub">Every account, plan, and event</span></span>
          ${icon("chevron-right", "chev")}
        </a>
      </div>
    </div>` : ""}

    <div class="group">
      <p class="group-title">Help</p>
      <div class="group-list">
        <a class="grow" href="mailto:${CONTACT_EMAIL}">
          ${icon("mail")}
          <span class="grow-label">Email ${esc(SELLER_NAME)}<span class="grow-sub">A real person answers. It&rsquo;s the guy who built it.</span></span>
          ${icon("chevron-right", "chev")}
        </a>
        <a class="grow" href="/guide">
          ${icon("help-circle")}
          <span class="grow-label">How ClipFlow works</span>
          ${icon("chevron-right", "chev")}
        </a>
      </div>
    </div>`;

  const discSheet = (platform: "instagram" | "tiktok", label: string) => {
    const conn = acct[platform];
    if (!conn) return "";
    return sheet(`disc-${platform}`, label, `
      <p class="mono" style="font-size:13px"><span class="dot dot-ok"></span> @${esc(conn.username || "connected")}</p>
      <p style="margin-top:var(--s-3)">This ${label} account is locked to your ClipFlow to keep posting stable. Disconnecting stops posting there &mdash; you can connect a different account afterward while your plan is active.</p>`,
      `<a class="btn btn-quiet" href="/disconnect/${platform}?t=${esc(csrf)}" data-loading-text="Disconnecting&hellip;">Disconnect ${label}</a>
       <button class="btn btn-quiet" type="button" data-sheet-close>Keep it connected</button>`);
  };

  const after = `
    ${sheet("handle", "Whatnot handle", `
      <p>The public shop ClipFlow watches for clips.</p>
      <label class="field" style="margin-top:var(--s-4)">
        <span class="field-wrap has-prefix"><span class="field-prefix">@</span>
          <input class="field-input mono" data-handle-input value="${esc(acct.whatnotUsername)}" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="30">
        </span>
        <p class="field-error" data-handle-error hidden></p>
      </label>`,
      `<button class="btn" type="button" data-handle-save data-loading-text="Saving&hellip;">Save handle</button>
       <button class="btn btn-quiet" type="button" data-sheet-close>Cancel</button>`)}
    ${discSheet("instagram", "Instagram")}
    ${discSheet("tiktok", "TikTok")}
    ${sheet("caption", "Caption style", `
      <div data-caption-editor>
        <div class="preset-row" role="group" aria-label="Caption style">
          ${(Object.keys(CAPTION_PRESETS) as Array<keyof typeof CAPTION_PRESETS>).map((p) => `<button type="button" class="preset-btn" data-preset="${p}" aria-pressed="${acct.captionPreset === p}">${p[0].toUpperCase() + p.slice(1)}</button>`).join("")}
          <button type="button" class="preset-btn" data-preset="custom" aria-pressed="${acct.captionPreset === "custom"}">Mine</button>
        </div>
        <label class="field" data-custom-wrap ${acct.captionPreset === "custom" ? "" : "hidden"} style="margin-top:var(--s-4)">
          <span class="field-label">Your template</span>
          <textarea class="field-input mono" data-custom-template rows="4" maxlength="2200">${esc(acct.captionTemplate)}</textarea>
          <p class="field-help">Slots: {title} {username} {hashtags}</p>
        </label>
        <div class="caption-preview" data-caption-preview aria-live="polite" style="margin-top:var(--s-4)"></div>
      </div>`,
      `<button class="btn" type="button" data-caption-save data-loading-text="Saving&hellip;">Save caption</button>
       <button class="btn btn-quiet" type="button" data-sheet-close>Cancel</button>`)}
    ${sheet("password", "Change password", `
      <form method="post" action="/account/password" data-password-form>
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <label class="field">
          <span class="field-label">Current password</span>
          <input class="field-input" type="password" name="current" autocomplete="current-password" required>
        </label>
        <label class="field">
          <span class="field-label">New password</span>
          <span class="field-wrap">
            <input class="field-input" type="password" name="next" autocomplete="new-password" required minlength="8" maxlength="200">
            <button type="button" class="field-eye" data-eye aria-label="Show password">${icon("eye")}</button>
          </span>
          <p class="field-help">8 characters or more.</p>
        </label>
        <div class="sheet-actions">
          <button class="btn" type="submit" data-loading-text="Saving&hellip;">Save password</button>
          <button class="btn btn-quiet" type="button" data-sheet-close>Cancel</button>
        </div>
      </form>`)}
    ${sheet("delete", "Delete account", `
      <p>Deletes your account, history, and covers. Clips already posted stay on your Instagram and TikTok.</p>
      <form method="post" action="/account/delete" data-delete-form>
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <label class="field" style="margin-top:var(--s-4)">
          <span class="field-label">Type your email to confirm</span>
          <input class="field-input mono" name="confirm" data-delete-confirm data-email="${esc(acct.email)}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${esc(acct.email)}">
        </label>
        <div class="sheet-actions">
          <button class="btn" type="submit" disabled data-delete-btn data-loading-text="Deleting&hellip;" style="background:var(--err);border-color:var(--err)">Delete everything</button>
          <button class="btn btn-quiet" type="button" data-sheet-close>Keep my account</button>
        </div>
      </form>`)}
    ${captionIsland(acct)}`;

  return appShell({
    title: "Settings", tab: "settings", content, csrf, who: shellWho(acct),
    scripts: ["/js/settings.js"], after,
  });
}

// ---------------------------------------------------------------------------
// BILLING — /billing
// ---------------------------------------------------------------------------

export interface BillingView {
  configured: boolean;
  csrf: string;
  /** dev | admin | locked | trial | active | past_due */
  state: string;
  daysLeft: number;
  trialDays: number;
  /** set when the seller was sent here trying to connect without a card */
  needConnect?: string;
}

export function billingPage(acct: Account, v: BillingView, active = true): string {
  const portalForm = (label: string, quiet = false, sheetClose = false) => `
    <form method="post" action="/billing/portal"><input type="hidden" name="csrf" value="${esc(v.csrf)}">
      <button class="btn ${quiet ? "btn-quiet" : ""} btn-block" type="submit" data-loading-text="Opening Stripe&hellip;"${sheetClose ? ` data-sheet-close-after` : ""}>${label}</button>
    </form>`;
  const checkoutForm = (label: string) => `
    <form method="post" action="/billing/checkout"><input type="hidden" name="csrf" value="${esc(v.csrf)}">
      <button class="btn btn-block" type="submit" data-loading-text="Opening Stripe&hellip;">${label}</button>
    </form>`;

  let planReceipt: string;
  let actions = "";
  let after = "";

  if (!v.configured || v.state === "dev") {
    planReceipt = receipt({
      head: ["ClipFlow", "Plan"],
      lines: [{ time: "", what: "Billing isn't switched on here", who: "nothing to pay", mark: MARK.included }],
    });
  } else if (v.state === "admin") {
    planReceipt = receipt({
      head: ["ClipFlow", "Plan"],
      lines: [{ time: "", what: "Operator account", who: `@${esc(acct.whatnotUsername || acct.email)}`, mark: MARK.included }],
    });
  } else if (v.state === "trial") {
    const firstCharge = acct.trialEndsAt ? new Date(acct.trialEndsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
    planReceipt = receipt({
      head: ["ClipFlow", "Monthly"],
      lines: [
        { time: "", what: "Everything included", who: "Reels · TikTok · captions · covers", whoPlain: true },
        { time: "", what: "Your first week", who: `${v.daysLeft} day${v.daysLeft === 1 ? "" : "s"} left`, whoPlain: true, mark: `<span class="mono">$0.00</span>` },
        ...(firstCharge ? [{ time: "", what: "First charge", who: firstCharge, whoPlain: true, mark: `<span class="mono">$19.00</span>` }] : []),
      ],
      total: ["After the week", "$19/mo"],
      note: firstCharge ? `Cancel any time before ${esc(firstCharge)} — nothing charges.` : "Cancel any time — nothing charges.",
    });
    actions = `${portalForm("Update card", true)}
      <button class="btn btn-quiet" type="button" data-sheet-open="cancel">Cancel plan</button>`;
  } else if (v.state === "active") {
    planReceipt = receipt({
      head: ["ClipFlow", "Monthly"],
      lines: [
        { time: "", what: "Everything included", who: "Reels · TikTok · captions · covers", whoPlain: true },
        { time: "", what: "Card on file", who: "manage in Stripe", whoPlain: true, mark: `<span class="status-word sw-quiet">ON FILE</span>` },
      ],
      total: ["Each month", "$19.00"],
    });
    actions = `${portalForm("Update card", true)}
      <button class="btn btn-quiet" type="button" data-sheet-open="cancel">Cancel plan</button>`;
  } else if (v.state === "past_due") {
    planReceipt = receipt({
      head: ["ClipFlow", "Monthly"],
      lines: [
        { time: "", what: "Last charge failed", who: "posting is paused until it clears", mark: MARK.failed },
      ],
      total: ["Each month", "$19.00"],
    });
    actions = portalForm("Fix my card");
  } else {
    // locked — trial over or never started, no card
    planReceipt = receipt({
      head: ["ClipFlow", "Monthly"],
      lines: [
        { time: "", what: "Free week", who: `${v.trialDays} days, starts when your card is added`, whoPlain: true, mark: `<span class="mono">$0.00</span>` },
        { time: "", what: "Everything included", who: "Reels · TikTok · captions · covers", whoPlain: true },
      ],
      total: ["After the week", "$19/mo"],
      note: "Nothing is deleted while you decide. History stays.",
    });
    actions = checkoutForm("Add card — start my free week");
  }

  if (v.state === "trial" || v.state === "active") {
    after = sheet("cancel", "Cancel plan", `
      <p>Posting stops at the end of the period you&rsquo;ve paid for. Your posted clips stay on your accounts.</p>`,
      `${portalForm("Cancel plan", true)}
       <button class="btn btn-quiet" type="button" data-sheet-close>Keep posting</button>`);
  }

  const content = `
    <section class="page-head" data-rise style="--i:0">
      <h1 class="display page-title">Billing</h1>
    </section>
    ${v.needConnect && (v.state === "locked" || v.state === "past_due") ? `<div class="banner banner-info" role="status">${icon("lock")}<span>Add a card to connect ${v.needConnect === "tiktok" ? "TikTok" : "Instagram"}. Your first week is free &mdash; nothing charges today.</span></div>` : ""}
    ${planReceipt}
    <div class="billing-actions">${actions}</div>`;

  return appShell({
    title: "Billing", tab: "settings", content, csrf: v.csrf, after, who: shellWho(acct),
  });
}

// ---------------------------------------------------------------------------
// GUIDE — /guide
// ---------------------------------------------------------------------------

export function guidePage(acct: Account, active = true): string {
  const content = `
    <section class="page-head" data-rise style="--i:0">
      <h1 class="display page-title">How ClipFlow works</h1>
    </section>
    <div class="card" style="margin-bottom:var(--s-5)">
      ${clipDemo()}
    </div>
    <div class="faq-list">
      <div class="faq-item"><p class="q">A clip didn&rsquo;t show up?</p><p class="a">Make sure the clip is <strong>public</strong> on Whatnot &mdash; private or saved-only clips are invisible to ClipFlow. Then tap Check on Home.</p></div>
      <div class="faq-item"><p class="q">Will this get me banned?</p><p class="a">No. Posting goes through Instagram&rsquo;s and TikTok&rsquo;s official tools &mdash; the route brands use.</p></div>
      <div class="faq-item"><p class="q">Something else?</p><p class="a"><a href="mailto:${CONTACT_EMAIL}">Email ${esc(SELLER_NAME)}</a>. A real person answers.</p></div>
    </div>`;
  return appShell({ title: "Guide", tab: "settings", content, who: shellWho(acct) });
}

// ---------------------------------------------------------------------------
// STATUS — /status
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
  };
  zernioConfigured: boolean;
  geminiConfigured: boolean;
}

export function statusPage(acct: Account, info: StatusInfo, active = true): string {
  const row = (label: string, value: string, ok?: boolean) => `
    <div class="status-row">
      <dt>${esc(label)}</dt>
      <dd>${ok === undefined ? "" : ok ? `${GLYPH.ok} ` : `${GLYPH.err} `}${esc(value)}</dd>
    </div>`;
  const content = `
    <section class="page-head" data-rise style="--i:0">
      <h1 class="display page-title">Status</h1>
    </section>
    <div class="card">
      <dl class="status-rows">
        ${row("App", `v${info.version}`, true)}
        ${row("Clip watcher", info.engine.running ? `every ${info.engine.pollSeconds}s` : "stopped", info.engine.running)}
        ${row("Last pass", info.engine.lastPassAt ? relShort(info.engine.lastPassAt) : "not yet", undefined)}
        ${row("Passes", String(info.engine.passCount))}
        ${row("Posting provider", info.zernioConfigured ? "configured" : "not configured", info.zernioConfigured)}
        ${row("Cover studio", info.geminiConfigured ? "configured" : "not configured", info.geminiConfigured)}
      </dl>
    </div>`;
  return appShell({ title: "Status", tab: "settings", content, who: shellWho(acct) });
}

// ---------------------------------------------------------------------------
// ERROR PAGES
// ---------------------------------------------------------------------------

export function errorPage(status: 404 | 429 | 500, refId?: string): string {
  const copy = status === 404
    ? { title: "This page doesn't exist", body: "Your dashboard does.", cta: "Open my dashboard", href: "/dashboard" }
    : status === 429
      ? { title: "Too fast", body: "A quick burst of requests hit us. Wait a minute, try again.", cta: "Back", href: "/dashboard" }
      : { title: "That broke on our end", body: `Not your fault. Try again in a minute.${refId ? ` Mention ref #${refId} if you email us.` : ""}`, cta: "Open my dashboard", href: "/dashboard" };
  const body = `
<main class="error-wrap" id="main">
  <div class="stage-hero">
    <p class="error-glyph mono" data-rise style="--i:0">${status}</p>
    <h1 class="display" data-rise style="--i:1">${esc(copy.title)}<span class="period">.</span></h1>
    <p data-rise style="--i:2">${esc(copy.body)}</p>
    <a class="btn btn-block" data-rise style="--i:3" href="${copy.href}">${esc(copy.cta)}</a>
  </div>
</main>`;
  return doc(`${status} — ClipFlow`, body, { noindex: true, stage: true });
}

// ---------------------------------------------------------------------------
// LEGAL
// ---------------------------------------------------------------------------

const LEGAL_LAST_UPDATED = "July 26, 2026";

function mail(): string {
  return `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;
}

function legalLayout(title: string, sections: string): string {
  const body = `
<div class="wrap">
  <nav class="land-nav">
    <a class="wordmark" href="/"><span class="wordmark-text">ClipFlow<span class="period">.</span></span></a>
    <a class="btn btn-quiet btn-small" href="/login">Log in</a>
  </nav>
  <main class="legal" id="main">
    <h1 class="display">${esc(title)}</h1>
    <p class="fine">Last updated ${LEGAL_LAST_UPDATED}</p>
    ${sections}
  </main>
</div>`;
  return doc(`${title} — ClipFlow`, body);
}

export function privacyPage(): string {
  const sections = `
    <p class="legal-lead">What ClipFlow collects, why, and the control you have over it. It&rsquo;s short because ClipFlow does one thing.</p>
    <h2>What ClipFlow does</h2>
    <p>ClipFlow watches your public Whatnot clips page and, when you publish a clip, posts that video to the Instagram and/or TikTok accounts you have connected — as a Reel on Instagram and as a post on TikTok (if TikTok’s daily third-party limit is reached, the clip is delivered to your TikTok drafts instead). You clip; ClipFlow posts.</p>
    <h2>What we store</h2>
    <ul>
      <li><strong>Your email address</strong> — to identify your account and let you log in.</li>
      <li><strong>A hashed version of your password</strong> — a one-way scrypt hash, never the password itself.</li>
      <li><strong>Your Whatnot username</strong> — the public handle whose clips we watch.</li>
      <li><strong>Your caption style and hashtags</strong> — the settings you choose for your posts.</li>
      <li><strong>References to your connected accounts</strong> — when you connect Instagram or TikTok, you authorize our publishing provider (Zernio) directly with that platform. ClipFlow stores only the connected account's id and username; the OAuth tokens are held by Zernio. We never see or store your Instagram or TikTok password.</li>
      <li><strong>Generated covers</strong> — if you use the Studio, the images you generate and the title/style you chose, so your gallery persists.</li>
    </ul>
    <h2>How your connections are used</h2>
    <p>One purpose only: posting your Whatnot clips on your behalf. We do not read your messages, sell your data, or use your connections for anything else.</p>
    <h2>Disconnecting</h2>
    <p>Disconnect Instagram or TikTok any time in Settings. It removes the stored account reference immediately, and ClipFlow can no longer post there until you reconnect. You can also flip Posting off entirely.</p>
    <h2>Data retention</h2>
    <p>We keep your account data while your account is active. Delete your account in Settings and everything goes with it, or email ${mail()} and we'll remove it.</p>
    <h2>Third parties</h2>
    <p>ClipFlow talks to Whatnot (to read your public clips), publishes through Zernio (our social-posting provider, which holds the platform authorizations you grant), and — if you use the Studio — sends your title text and product photos to Google's Gemini API to generate images. Your use of those platforms is governed by their own policies. We do not share your data with anyone else.</p>
    <h2>Contact</h2>
    <p>Questions about your data or this policy? Email ${mail()}.</p>`;
  return legalLayout("Privacy Policy", sections);
}

export function termsPage(): string {
  const sections = `
    <p class="legal-lead">Plain-language terms for using ClipFlow. By creating an account you agree to these.</p>
    <h2>The service</h2>
    <p>ClipFlow automatically posts clips you publish on Whatnot to the Instagram and TikTok accounts you connect. It acts on your behalf using access you grant through Instagram's and TikTok's own secure sign-in.</p>
    <h2>Your responsibilities</h2>
    <ul>
      <li>You are responsible for the content of your clips, captions, and generated covers, and for having the rights to post them.</li>
      <li>You are responsible for complying with the rules of Whatnot, Instagram, and TikTok. ClipFlow does not exempt you from any platform's policies.</li>
      <li>Connect only accounts you own or are authorized to manage.</li>
    </ul>
    <h2>No warranty</h2>
    <p>ClipFlow is provided "as is," without warranty of any kind. Posting depends on Whatnot, Instagram, TikTok, and our providers, whose APIs and rules can change or fail at any time. We do not guarantee that every clip will post, or that the service will be uninterrupted or error-free.</p>
    <h2>Limitation of liability</h2>
    <p>To the fullest extent permitted by law, ClipFlow and its operator are not liable for any indirect or consequential loss arising from your use of the service, including missed posts, removed content, or actions taken by Whatnot, Instagram, or TikTok on your accounts.</p>
    <h2>Changes and availability</h2>
    <p>The operator may change, suspend, or discontinue ClipFlow at any time, and may update these terms; continued use after a change means you accept the updated terms.</p>
    <h2>Contact</h2>
    <p>Questions about these terms? Email ${mail()}.</p>`;
  return legalLayout("Terms of Service", sections);
}

// ---------------------------------------------------------------------------
// ADMIN — operator-only, dense and plain
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
      <td class="mono">${esc(u.email)}</td>
      <td class="mono">${u.whatnotUsername ? `@${esc(u.whatnotUsername)}` : "—"}</td>
      <td>${u.instagram ? "IG " : ""}${u.tiktok ? "TT" : ""}</td>
      <td class="mono">${u.postCount}</td>
      <td class="mono">${esc(u.subscriptionStatus ?? u.plan)}</td>
      <td>${u.disabled ? MARK.failed : `<span class="status-word sw-ok">ON</span>`}</td>
      <td>${u.id === acct.id ? "" : `
        <form method="post" action="/admin/toggle/${esc(u.id)}"><input type="hidden" name="csrf" value="${esc(csrf)}">
          <button class="retry-btn" type="submit">${u.disabled ? "Enable" : "Disable"}</button>
        </form>`}</td>
    </tr>`).join("");

  const eventRows = events.map((e) => `
    <tr>
      <td class="mono">${esc(relShort(e.at))}</td>
      <td class="mono">${esc(e.type)}</td>
      <td class="mono">${esc(e.detail ?? "")}</td>
    </tr>`).join("");

  const content = `
    <section class="page-head" data-rise style="--i:0">
      <h1 class="display page-title">Operator</h1>
    </section>
    <div class="admin-stats">
      <div class="card admin-stat card-pad-tight"><p class="n">${stats.users}</p><p class="l">accounts</p></div>
      <div class="card admin-stat card-pad-tight"><p class="n">${stats.activeSubs}</p><p class="l">paying</p></div>
      <div class="card admin-stat card-pad-tight"><p class="n">${stats.posts7d}</p><p class="l">posts · 7d</p></div>
      <div class="card admin-stat card-pad-tight"><p class="n">${stats.failures7d}</p><p class="l">failures · 7d</p></div>
    </div>
    <div class="card card-pad-tight admin-table-wrap" style="margin-bottom:var(--s-5)">
      <table class="admin-table">
        <thead><tr><th>Email</th><th>Whatnot</th><th>Conn</th><th>Posts</th><th>Plan</th><th>State</th><th></th></tr></thead>
        <tbody>${userRows}</tbody>
      </table>
    </div>
    <div class="card card-pad-tight admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>When</th><th>Event</th><th>Detail</th></tr></thead>
        <tbody>${eventRows}</tbody>
      </table>
    </div>`;

  return appShell({ title: "Operator", tab: "settings", content, csrf, who: shellWho(acct) });
}
