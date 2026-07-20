/**
 * sqlite.ts — the datastore. One better-sqlite3 database (synchronous,
 * zero-config, WAL) at <WN_DATA_DIR>/clipflow.db.
 *
 * Boot runs idempotent CREATE TABLE IF NOT EXISTS migrations, then a one-time
 * import: if legacy data/accounts.json exists and the accounts table is empty,
 * accounts are imported (with a fresh 14-day trial so nobody gets locked out
 * by the upgrade) and each seen-<user>.json becomes posted rows in the posts
 * table. Imported files are renamed *.imported so it never re-runs.
 *
 * Tables:
 *   accounts         sellers + billing + lifecycle
 *   posts            one row per clip per platform — THE dedupe + history
 *   password_resets  hashed single-use tokens (reset / verify / email change)
 *   events           append-only admin log
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = process.env.WN_DATA_DIR || "./data";
const DB_PATH = join(DATA_DIR, "clipflow.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  migrate(db);
  importLegacyJson(db);
  return db;
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      whatnotUsername TEXT NOT NULL DEFAULT '',
      captionTemplate TEXT NOT NULL DEFAULT '',
      hashtags TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      onboardedAt TEXT NULL,
      zernioProfileId TEXT NULL,
      instagram TEXT NULL,
      tiktok TEXT NULL,
      emailVerifiedAt TEXT NULL,
      plan TEXT NOT NULL DEFAULT 'trial',
      trialEndsAt TEXT NULL,
      stripeCustomerId TEXT NULL,
      stripeSubscriptionId TEXT NULL,
      subscriptionStatus TEXT NULL,
      isAdmin INTEGER NOT NULL DEFAULT 0,
      disabled INTEGER NOT NULL DEFAULT 0,
      deletedAt TEXT NULL,
      lastFailureEmailAt TEXT NULL,
      trialEmailSentAt TEXT NULL,
      postingMode TEXT NOT NULL DEFAULT 'auto',
      lastCheckedAt TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      clipId TEXT NOT NULL,
      clipTitle TEXT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      zernioPostId TEXT NULL,
      via TEXT NULL,
      error TEXT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      nextRetryAt TEXT NULL,
      createdAt TEXT NOT NULL,
      postedAt TEXT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_dedupe ON posts (accountId, clipId, platform);
    CREATE INDEX IF NOT EXISTS idx_posts_account ON posts (accountId, createdAt);

    CREATE TABLE IF NOT EXISTS password_resets (
      tokenHash TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      purpose TEXT NOT NULL,
      payload TEXT NULL,
      expiresAt TEXT NOT NULL,
      usedAt TEXT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      accountId TEXT NULL,
      type TEXT NOT NULL,
      detail TEXT NULL
    );
  `);

  // Additive column migrations for DBs created before the column existed. The
  // DEFAULT 'auto' means pre-existing accounts keep auto-posting; brand-new
  // accounts are created as 'manual' (see db.createAccount) so nobody's flow
  // silently stops on upgrade.
  ensureColumn(d, "accounts", "postingMode", "TEXT NOT NULL DEFAULT 'auto'");
  ensureColumn(d, "accounts", "lastCheckedAt", "TEXT NULL");

  // Caption presets: the ONE-TIME backfill (runs only when the column is first
  // added) marks accounts whose template differs from the stock default as
  // 'custom' so their wording survives the redesign untouched; everyone else
  // starts on 'hype'.
  if (ensureColumn(d, "accounts", "captionPreset", "TEXT NOT NULL DEFAULT 'hype'")) {
    d.prepare(
      "UPDATE accounts SET captionPreset = 'custom' WHERE captionTemplate != ? AND captionTemplate != ''"
    ).run(DEFAULT_CAPTION_TEMPLATE);
  }

  // Guided-setup milestones. captionTouchedAt = the seller has actively chosen
  // (or saved) a caption style; setupSeenAt = the "You're all set" collapse has
  // been shown once; firstPostCelebratedAt = the one-time first-post moment
  // fired. Each gets a one-time backfill so veteran accounts don't regress
  // into the new-user checklist or get a false "first clip!" celebration:
  // customized captions or any post history counts as having chosen captions;
  // any post history means setup was completed long ago; any POSTED clip means
  // the first-post moment already happened (quietly, before it existed).
  if (ensureColumn(d, "accounts", "captionTouchedAt", "TEXT NULL")) {
    d.prepare(`
      UPDATE accounts SET captionTouchedAt = createdAt
      WHERE captionPreset = 'custom' OR id IN (SELECT DISTINCT accountId FROM posts)
    `).run();
  }
  if (ensureColumn(d, "accounts", "setupSeenAt", "TEXT NULL")) {
    d.prepare(`
      UPDATE accounts SET setupSeenAt = createdAt
      WHERE id IN (SELECT DISTINCT accountId FROM posts)
    `).run();
  }
  if (ensureColumn(d, "accounts", "firstPostCelebratedAt", "TEXT NULL")) {
    d.prepare(`
      UPDATE accounts SET firstPostCelebratedAt = createdAt
      WHERE id IN (SELECT DISTINCT accountId FROM posts WHERE status = 'posted')
    `).run();
  }
}

/** The stock template new accounts start with — also the migration's "untouched" marker. */
export const DEFAULT_CAPTION_TEMPLATE = "{title}\n\nCatch me LIVE on Whatnot @{username}\n{hashtags}";

/** Add a column only if it isn't already present (idempotent ALTER). Returns true when added. */
function ensureColumn(d: Database.Database, table: string, column: string, def: string): boolean {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    return true;
  }
  return false;
}

/** One-time import of the legacy JSON stores. Runs only into an empty DB. */
function importLegacyJson(d: Database.Database): void {
  const legacyAccounts = join(DATA_DIR, "accounts.json");
  if (!existsSync(legacyAccounts)) return;
  const count = (d.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
  if (count > 0) return;

  let rows: any[];
  try {
    rows = JSON.parse(readFileSync(legacyAccounts, "utf8"));
    if (!Array.isArray(rows)) throw new Error("not an array");
  } catch (e) {
    console.error(`[sqlite] legacy accounts.json unreadable — skipping import: ${(e as Error).message}`);
    return;
  }

  const now = new Date();
  const trialEnd = new Date(now.getTime() + 14 * 86400_000).toISOString();
  const insert = d.prepare(`
    INSERT INTO accounts (id, email, passwordHash, createdAt, whatnotUsername, captionTemplate,
      hashtags, enabled, onboardedAt, zernioProfileId, instagram, tiktok, plan, trialEndsAt)
    VALUES (@id, @email, @passwordHash, @createdAt, @whatnotUsername, @captionTemplate,
      @hashtags, @enabled, @onboardedAt, @zernioProfileId, @instagram, @tiktok, 'trial', @trialEndsAt)
  `);
  const insertPost = d.prepare(`
    INSERT OR IGNORE INTO posts (id, accountId, clipId, clipTitle, platform, status, via, attempts, createdAt, postedAt)
    VALUES (?, ?, ?, ?, ?, 'posted', ?, 1, ?, ?)
  `);

  const tx = d.transaction(() => {
    for (const r of rows) {
      if (!r?.id || !r?.email || !r?.passwordHash) continue;
      insert.run({
        id: r.id,
        email: r.email,
        passwordHash: r.passwordHash,
        createdAt: r.createdAt ?? now.toISOString(),
        whatnotUsername: r.whatnotUsername ?? "",
        captionTemplate: r.captionTemplate ?? "",
        hashtags: JSON.stringify(Array.isArray(r.hashtags) ? r.hashtags : []),
        enabled: r.enabled === false ? 0 : 1,
        onboardedAt: r.onboardedAt ?? null,
        zernioProfileId: r.zernioProfileId ?? null,
        instagram: r.instagram?.accountId ? JSON.stringify(r.instagram) : null,
        tiktok: r.tiktok?.accountId ? JSON.stringify(r.tiktok) : null,
        trialEndsAt: trialEnd,
      });

      // fold this account's seen-store into posts rows (posted platforms only)
      if (r.whatnotUsername) {
        const seenPath = join(DATA_DIR, `seen-${r.whatnotUsername}.json`);
        if (existsSync(seenPath)) {
          try {
            const seen = JSON.parse(readFileSync(seenPath, "utf8"));
            for (const s of Array.isArray(seen) ? seen : []) {
              for (const platform of ["instagram", "tiktok"] as const) {
                if (s?.posted?.[platform]) {
                  insertPost.run(
                    randomUUID(), r.id, s.clipId, s.title ?? null, platform,
                    platform === "tiktok" && s.tiktokDraft ? "draft" : "direct",
                    s.downloadedAt ?? now.toISOString(), s.downloadedAt ?? now.toISOString()
                  );
                }
              }
            }
            renameSync(seenPath, `${seenPath}.imported`);
          } catch { /* unreadable seen file — leave it */ }
        }
      }
    }
  });
  tx();

  renameSync(legacyAccounts, `${legacyAccounts}.imported`);
  const imported = (d.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
  console.log(`[sqlite] imported ${imported} account(s) from legacy JSON (renamed to accounts.json.imported)`);
  d.prepare("INSERT INTO events (at, type, detail) VALUES (?, 'migration', ?)")
    .run(new Date().toISOString(), `imported ${imported} accounts from JSON`);
}
