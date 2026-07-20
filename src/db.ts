/**
 * db.ts — the data façade. Same exported signatures the app has always used
 * (initDb, createAccount, verifyLogin, getAccount, updateAccount,
 * listAccounts) plus the business-layer additions: billing fields, post
 * history, password-reset tokens, events, admin queries, delete cascade.
 * All storage now lives in SQLite (src/sqlite.ts); JSON stores are imported
 * once at boot and retired.
 */

import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, DEFAULT_CAPTION_TEMPLATE } from "./sqlite.js";
import type { CaptionPreset } from "./caption.js";

export interface PlatformConnection {
  accountId: string;
  username: string;
}

export interface Account {
  id: string;
  email: string;
  createdAt: string;
  whatnotUsername: string;
  captionTemplate: string;
  /** 'hype' | 'chill' | 'minimal' use built-in templates; 'custom' uses captionTemplate */
  captionPreset: CaptionPreset;
  hashtags: string[];
  enabled: boolean;
  onboardedAt: string | null;
  zernioProfileId: string | null;
  instagram: PlatformConnection | null;
  tiktok: PlatformConnection | null;
  emailVerifiedAt: string | null;
  plan: string; // 'trial' | 'pro'
  trialEndsAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  isAdmin: boolean;
  disabled: boolean;
  deletedAt: string | null;
  lastFailureEmailAt: string | null;
  trialEmailSentAt: string | null;
  /** 'manual' = only post when the seller hits Check; 'auto' = engine posts on its own. */
  postingMode: "manual" | "auto";
  /** last time a full check ran for this account (manual check or auto pass) */
  lastCheckedAt: string | null;
  /** the seller actively chose/saved a caption style (setup-checklist step 3) */
  captionTouchedAt: string | null;
  /** the "You're all set" setup-complete card has been shown once */
  setupSeenAt: string | null;
  /** the one-time "your first clip is live" celebration has fired */
  firstPostCelebratedAt: string | null;
}

export type PostStatus = "pending" | "posted" | "failed";

export interface PostRow {
  id: string;
  accountId: string;
  clipId: string;
  clipTitle: string | null;
  platform: "instagram" | "tiktok";
  status: PostStatus;
  zernioPostId: string | null;
  via: string | null; // 'direct' | 'draft'
  error: string | null;
  attempts: number;
  nextRetryAt: string | null;
  createdAt: string;
  postedAt: string | null;
}

const DEFAULT_HASHTAGS = ["whatnot", "live"];

// ---------------------------------------------------------------------------
// row <-> shape
// ---------------------------------------------------------------------------

function rowToAccount(r: any): Account {
  return {
    id: r.id,
    email: r.email,
    createdAt: r.createdAt,
    whatnotUsername: r.whatnotUsername,
    captionTemplate: r.captionTemplate,
    captionPreset: (["hype", "chill", "minimal", "custom"].includes(r.captionPreset) ? r.captionPreset : "hype") as CaptionPreset,
    hashtags: JSON.parse(r.hashtags || "[]"),
    enabled: Boolean(r.enabled),
    onboardedAt: r.onboardedAt,
    zernioProfileId: r.zernioProfileId,
    instagram: r.instagram ? JSON.parse(r.instagram) : null,
    tiktok: r.tiktok ? JSON.parse(r.tiktok) : null,
    emailVerifiedAt: r.emailVerifiedAt,
    plan: r.plan,
    trialEndsAt: r.trialEndsAt,
    stripeCustomerId: r.stripeCustomerId,
    stripeSubscriptionId: r.stripeSubscriptionId,
    subscriptionStatus: r.subscriptionStatus,
    isAdmin: Boolean(r.isAdmin),
    disabled: Boolean(r.disabled),
    deletedAt: r.deletedAt,
    lastFailureEmailAt: r.lastFailureEmailAt,
    trialEmailSentAt: r.trialEmailSentAt,
    postingMode: r.postingMode === "manual" ? "manual" : "auto",
    lastCheckedAt: r.lastCheckedAt ?? null,
    captionTouchedAt: r.captionTouchedAt ?? null,
    setupSeenAt: r.setupSeenAt ?? null,
    firstPostCelebratedAt: r.firstPostCelebratedAt ?? null,
  };
}

/**
 * Is this account allowed to POST right now? Active = trial still running OR
 * a live subscription. With Stripe unconfigured (dev), trials never expire.
 * Admin-disabled and deleted accounts are never active.
 */
/** Length of the free trial a card unlocks, in days. */
export const TRIAL_DAYS = 7;

/**
 * Card-first model: an account may post only once a card is on file
 * (subscriptionStatus trialing/active). The operator (admin) and dev mode (no
 * Stripe) are always active; everyone else is locked until they add a card.
 */
export function isActive(acct: Account, stripeConfigured: boolean): boolean {
  if (acct.disabled || acct.deletedAt) return false;
  if (acct.isAdmin) return true;            // operator's own account is never gated
  if (!stripeConfigured) return true;       // dev: no billing configured, no lock
  return ["active", "trialing"].includes(acct.subscriptionStatus ?? "");
}

export type AccountState = "dev" | "admin" | "locked" | "trial" | "active" | "past_due";

export function accountState(acct: Account, stripeConfigured: boolean): AccountState {
  if (!stripeConfigured) return "dev";
  if (acct.isAdmin) return "admin";
  const s = acct.subscriptionStatus ?? "";
  if (s === "past_due" || s === "incomplete" || s === "unpaid") return "past_due";
  if (s === "active") return "active";
  if (s === "trialing") {
    // Stripe charges when the 1-week trial ends; without a webhook the local
    // status can lag, so treat an elapsed trial as active (they're billed now).
    if (acct.trialEndsAt && new Date(acct.trialEndsAt).getTime() <= Date.now()) return "active";
    return "trial";
  }
  return "locked";
}

/** Whole days left in the free trial (0 if none / elapsed). */
export function trialDaysLeft(acct: Account): number {
  if (!acct.trialEndsAt) return 0;
  const ms = new Date(acct.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400_000));
}

// ---------------------------------------------------------------------------
// passwords
// ---------------------------------------------------------------------------

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function checkPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const candidate = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

export async function initDb(): Promise<void> {
  getDb(); // opens + migrates + one-time JSON import
  // Seed admin: the account matching ADMIN_EMAIL becomes admin at boot.
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (adminEmail) {
    getDb().prepare("UPDATE accounts SET isAdmin = 1 WHERE email = ?").run(adminEmail);
  }
}

export async function createAccount(email: string, password: string): Promise<Account | null> {
  const d = getDb();
  const normalized = email.trim().toLowerCase();
  const existing = d.prepare("SELECT id FROM accounts WHERE email = ?").get(normalized);
  if (existing) return null;
  const id = randomUUID();
  const now = new Date();
  // Card-first: a new account starts LOCKED (no card, no trial). The 1-week
  // trial + trialEndsAt begin when they add a card at Checkout.
  // New accounts start in MANUAL mode (default) — they post when they choose to.
  d.prepare(`
    INSERT INTO accounts (id, email, passwordHash, createdAt, captionTemplate, hashtags, plan, trialEndsAt, isAdmin, postingMode)
    VALUES (?, ?, ?, ?, ?, ?, 'free', NULL, ?, 'manual')
  `).run(
    id, normalized, hashPassword(password), now.toISOString(),
    DEFAULT_CAPTION_TEMPLATE, JSON.stringify(DEFAULT_HASHTAGS),
    normalized === (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase() ? 1 : 0
  );
  logEvent(id, "signup", normalized);
  return getAccount(id);
}

export async function verifyLogin(email: string, password: string): Promise<Account | null> {
  const d = getDb();
  const row: any = d.prepare("SELECT * FROM accounts WHERE email = ? AND deletedAt IS NULL")
    .get(email.trim().toLowerCase());
  if (!row) return null;
  return checkPassword(password, row.passwordHash) ? rowToAccount(row) : null;
}

export function getAccount(id: string): Account | null {
  const row: any = getDb().prepare("SELECT * FROM accounts WHERE id = ? AND deletedAt IS NULL").get(id);
  return row ? rowToAccount(row) : null;
}

export function getAccountByEmail(email: string): Account | null {
  const row: any = getDb().prepare("SELECT * FROM accounts WHERE email = ? AND deletedAt IS NULL")
    .get(email.trim().toLowerCase());
  return row ? rowToAccount(row) : null;
}

const ACCOUNT_COLUMNS = new Set([
  "whatnotUsername", "captionTemplate", "enabled", "onboardedAt", "zernioProfileId",
  "emailVerifiedAt", "plan", "trialEndsAt", "stripeCustomerId", "stripeSubscriptionId",
  "subscriptionStatus", "disabled", "lastFailureEmailAt", "trialEmailSentAt", "email",
  "postingMode", "lastCheckedAt", "captionPreset",
  "captionTouchedAt", "setupSeenAt", "firstPostCelebratedAt",
]);

/** Patch public fields (settings, platform connections, billing state). */
export async function updateAccount(
  id: string,
  patch: Partial<Omit<Account, "id" | "createdAt">>
): Promise<Account | null> {
  const d = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "hashtags") { sets.push("hashtags = ?"); vals.push(JSON.stringify(v ?? [])); continue; }
    if (k === "instagram" || k === "tiktok") {
      sets.push(`${k} = ?`);
      vals.push(v ? JSON.stringify(v) : null);
      continue;
    }
    if (k === "enabled" || k === "disabled" || k === "isAdmin") {
      sets.push(`${k} = ?`); vals.push(v ? 1 : 0); continue;
    }
    if (ACCOUNT_COLUMNS.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); }
  }
  if (sets.length === 0) return getAccount(id);
  vals.push(id);
  d.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getAccount(id);
}

export async function setPassword(id: string, newPassword: string): Promise<void> {
  getDb().prepare("UPDATE accounts SET passwordHash = ? WHERE id = ?").run(hashPassword(newPassword), id);
  logEvent(id, "password_changed");
}

export function verifyCurrentPassword(id: string, password: string): boolean {
  const row: any = getDb().prepare("SELECT passwordHash FROM accounts WHERE id = ?").get(id);
  return row ? checkPassword(password, row.passwordHash) : false;
}

/** All non-deleted accounts, for the engine loop. */
export function listAccounts(): Account[] {
  return (getDb().prepare("SELECT * FROM accounts WHERE deletedAt IS NULL").all() as any[]).map(rowToAccount);
}

/**
 * Hard-delete an account and everything it owns: rows, downloaded clips for
 * its whatnot user (only if no other account watches the same handle), and
 * generated thumbnails. Returns info the caller needs to cancel Stripe first.
 */
export async function deleteAccountCascade(id: string, clipsDir: string, dataDir: string): Promise<void> {
  const d = getDb();
  const acct = getAccount(id);
  if (!acct) return;

  // thumbnails: records + PNGs
  const thumbsPath = join(dataDir, `thumbs-${id}.json`);
  try {
    if (existsSync(thumbsPath)) {
      const recs = JSON.parse(readFileSync(thumbsPath, "utf8"));
      for (const t of Array.isArray(recs) ? recs : []) {
        try { rmSync(join(clipsDir, "thumbs", `${t.id}.png`), { force: true }); } catch {}
      }
      rmSync(thumbsPath, { force: true });
    }
  } catch { /* best effort */ }

  // clip files: remove only if this account exclusively watches the handle
  if (acct.whatnotUsername) {
    const others = d.prepare(
      "SELECT COUNT(*) AS n FROM accounts WHERE whatnotUsername = ? AND id != ? AND deletedAt IS NULL"
    ).get(acct.whatnotUsername, id) as { n: number };
    if (others.n === 0) {
      const clipIds = d.prepare("SELECT DISTINCT clipId FROM posts WHERE accountId = ?").all(id) as any[];
      for (const c of clipIds) {
        try { rmSync(join(clipsDir, `${c.clipId}.mp4`), { force: true }); } catch {}
        try { rmSync(join(clipsDir, `${c.clipId}.webp`), { force: true }); } catch {}
      }
    }
  }

  d.prepare("DELETE FROM posts WHERE accountId = ?").run(id);
  d.prepare("DELETE FROM password_resets WHERE accountId = ?").run(id);
  d.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  logEvent(null, "account_deleted", acct.email);
}

// ---------------------------------------------------------------------------
// posts — history + dedupe (replaces the seen-store for the hosted engine)
// ---------------------------------------------------------------------------

export function getPost(accountId: string, clipId: string, platform: string): PostRow | null {
  return (getDb().prepare(
    "SELECT * FROM posts WHERE accountId = ? AND clipId = ? AND platform = ?"
  ).get(accountId, clipId, platform) as PostRow | undefined) ?? null;
}

export function getPostById(id: string): PostRow | null {
  return (getDb().prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRow | undefined) ?? null;
}

export function createPost(p: Omit<PostRow, "id" | "createdAt">): PostRow {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  getDb().prepare(`
    INSERT OR IGNORE INTO posts (id, accountId, clipId, clipTitle, platform, status, zernioPostId, via, error, attempts, nextRetryAt, createdAt, postedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, p.accountId, p.clipId, p.clipTitle, p.platform, p.status, p.zernioPostId, p.via, p.error, p.attempts, p.nextRetryAt, createdAt, p.postedAt);
  return getPost(p.accountId, p.clipId, p.platform)!;
}

export function updatePost(id: string, patch: Partial<PostRow>): void {
  const allowed = ["status", "zernioPostId", "via", "error", "attempts", "nextRetryAt", "postedAt", "clipTitle"];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); }
  }
  if (!sets.length) return;
  vals.push(id);
  getDb().prepare(`UPDATE posts SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function listPosts(accountId: string, limit = 100): PostRow[] {
  return getDb().prepare(
    "SELECT * FROM posts WHERE accountId = ? ORDER BY createdAt DESC LIMIT ?"
  ).all(accountId, limit) as PostRow[];
}

/** Lifetime totals — powers the setup checklist ("publish + first check" done
 *  when any post row exists) and the one-time first-post celebration. */
export function postTotals(accountId: string): { total: number; posted: number } {
  const d = getDb();
  const total = (d.prepare("SELECT COUNT(*) AS n FROM posts WHERE accountId = ?").get(accountId) as { n: number }).n;
  const posted = (d.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE accountId = ? AND status = 'posted'"
  ).get(accountId) as { n: number }).n;
  return { total, posted };
}

/** Stats for the dashboard row. */
export function postStats(accountId: string): { postedWeek: number; pending: number; failed: number } {
  const d = getDb();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const postedWeek = (d.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE accountId = ? AND status = 'posted' AND postedAt >= ?"
  ).get(accountId, weekAgo) as { n: number }).n;
  const pending = (d.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE accountId = ? AND status = 'pending'"
  ).get(accountId) as { n: number }).n;
  const failed = (d.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE accountId = ? AND status = 'failed'"
  ).get(accountId) as { n: number }).n;
  return { postedWeek, pending, failed };
}

// ---------------------------------------------------------------------------
// tokens — password reset / email verification / email change (hashed, single-use)
// ---------------------------------------------------------------------------

export type TokenPurpose = "reset" | "verify" | "email-change";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mint a token; returns the RAW token (only ever shown in the email link). */
export function createToken(accountId: string, purpose: TokenPurpose, ttlMinutes: number, payload?: string): string {
  const raw = randomBytes(32).toString("hex");
  getDb().prepare(`
    INSERT INTO password_resets (tokenHash, accountId, purpose, payload, expiresAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(hashToken(raw), accountId, purpose, payload ?? null,
    new Date(Date.now() + ttlMinutes * 60_000).toISOString(), new Date().toISOString());
  return raw;
}

/** Consume a token (single-use). Returns its row or null if invalid/expired/used. */
export function consumeToken(raw: string, purpose: TokenPurpose): { accountId: string; payload: string | null } | null {
  const d = getDb();
  const row: any = d.prepare(
    "SELECT * FROM password_resets WHERE tokenHash = ? AND purpose = ?"
  ).get(hashToken(raw), purpose);
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() < Date.now()) return null;
  d.prepare("UPDATE password_resets SET usedAt = ? WHERE tokenHash = ?")
    .run(new Date().toISOString(), row.tokenHash);
  return { accountId: row.accountId, payload: row.payload };
}

/** Peek without consuming (to render the reset form only for valid tokens). */
export function peekToken(raw: string, purpose: TokenPurpose): boolean {
  const row: any = getDb().prepare(
    "SELECT expiresAt, usedAt FROM password_resets WHERE tokenHash = ? AND purpose = ?"
  ).get(hashToken(raw), purpose);
  return Boolean(row && !row.usedAt && new Date(row.expiresAt).getTime() > Date.now());
}

// ---------------------------------------------------------------------------
// events + admin
// ---------------------------------------------------------------------------

export function logEvent(accountId: string | null, type: string, detail?: string): void {
  getDb().prepare("INSERT INTO events (at, accountId, type, detail) VALUES (?, ?, ?, ?)")
    .run(new Date().toISOString(), accountId, type, detail ?? null);
}

export function recentEvents(limit = 50): Array<{ at: string; accountId: string | null; type: string; detail: string | null }> {
  return getDb().prepare("SELECT at, accountId, type, detail FROM events ORDER BY id DESC LIMIT ?").all(limit) as any[];
}

export function adminStats(): { users: number; activeSubs: number; posts7d: number; failures7d: number } {
  const d = getDb();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  return {
    users: (d.prepare("SELECT COUNT(*) AS n FROM accounts WHERE deletedAt IS NULL").get() as any).n,
    activeSubs: (d.prepare("SELECT COUNT(*) AS n FROM accounts WHERE subscriptionStatus IN ('active','trialing')").get() as any).n,
    posts7d: (d.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'posted' AND postedAt >= ?").get(weekAgo) as any).n,
    failures7d: (d.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'failed' AND createdAt >= ?").get(weekAgo) as any).n,
  };
}

export function adminUserList(): Array<Account & { postCount: number }> {
  const d = getDb();
  return (d.prepare("SELECT * FROM accounts WHERE deletedAt IS NULL ORDER BY createdAt DESC").all() as any[])
    .map((r) => ({
      ...rowToAccount(r),
      postCount: (d.prepare("SELECT COUNT(*) AS n FROM posts WHERE accountId = ? AND status = 'posted'").get(r.id) as any).n,
    }));
}
