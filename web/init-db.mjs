import { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || "/data/db.sqlite";
const DRIZZLE_DIR = join(__dirname, "drizzle");
const META_DIR = join(DRIZZLE_DIR, "meta");

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// Create migrations tracking table
db.exec(`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// Get already applied migrations
const applied = new Set(
  db.query("SELECT hash FROM __drizzle_migrations").all()
    .map((row) => row.hash)
);

// Read journal to get ordered migrations
const journalPath = join(META_DIR, "_journal.json");
if (existsSync(journalPath)) {
  const journal = JSON.parse(readFileSync(journalPath, "utf-8"));

  for (const entry of journal.entries) {
    const tag = entry.tag;
    if (applied.has(tag)) continue;

    const sqlPath = join(DRIZZLE_DIR, `${tag}.sql`);
    if (!existsSync(sqlPath)) {
      console.error(`[init-db] Migration file not found: ${sqlPath}`);
      continue;
    }

    const sql = readFileSync(sqlPath, "utf-8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    console.log(`[init-db] Applying migration: ${tag}`);

    const applyMigration = db.transaction(() => {
      for (const stmt of statements) {
        db.exec(stmt);
      }
      db.query(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)"
      ).run(tag, Date.now());
    });

    applyMigration();
  }
}

// One-time data migration: enrich existing location objects with new fields
// Handles proxy hosts that already had locations in the old schema
const hostsWithLocations = db.query(
  "SELECT id, locations FROM hosts WHERE locations IS NOT NULL AND locations != '[]' AND locations != 'null'"
).all();

for (const host of hostsWithLocations) {
  try {
    const locations = JSON.parse(host.locations);
    if (!Array.isArray(locations) || locations.length === 0) continue;

    let changed = false;
    for (const loc of locations) {
      if (!("balanceMethod" in loc)) { loc.balanceMethod = "round_robin"; changed = true; }
      if (!("staticDir" in loc)) { loc.staticDir = ""; changed = true; }
      if (!("cacheExpires" in loc)) { loc.cacheExpires = ""; changed = true; }
      if (!("forwardScheme" in loc)) { loc.forwardScheme = "https"; changed = true; }
      if (!("forwardDomain" in loc)) { loc.forwardDomain = ""; changed = true; }
      if (!("forwardPath" in loc)) { loc.forwardPath = "/"; changed = true; }
      if (!("preservePath" in loc)) { loc.preservePath = true; changed = true; }
      if (!("statusCode" in loc)) { loc.statusCode = 301; changed = true; }
      if (!("headers" in loc)) { loc.headers = {}; changed = true; }
      if (!("accessListId" in loc)) { loc.accessListId = null; changed = true; }
      if (!("upstreams" in loc)) { loc.upstreams = []; changed = true; }
    }

    if (changed) {
      db.query("UPDATE hosts SET locations = ? WHERE id = ?").run(
        JSON.stringify(locations),
        host.id
      );
    }
  } catch (e) {
    console.error(`[init-db] Failed to migrate locations for host ${host.id}:`, e.message);
  }
}

// Seed default data
const DEFAULT_ADMIN_EMAIL = "admin@example.com";
const existingAdmin = db.query(
  "SELECT id FROM users WHERE email = ?"
).get(DEFAULT_ADMIN_EMAIL);

if (!existingAdmin) {
  const hashedPassword = await Bun.password.hash("changeme", {
    algorithm: "argon2id",
  });

  db.query(
    "INSERT INTO users (email, password, name, role, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    DEFAULT_ADMIN_EMAIL,
    hashedPassword,
    "Administrator",
    "admin",
    1,
    Date.now(),
    Date.now()
  );
  console.log(`[init-db] Created default admin user: ${DEFAULT_ADMIN_EMAIL}`);
}

// Seed default settings
const defaultSettings = [
  { key: "global_webhook_url", value: "" },
  { key: "watchdog_interval_ms", value: "30000" },
  { key: "audit_retention_days", value: "90" },
  { key: "health_retention_days", value: "30" },
];

for (const s of defaultSettings) {
  const existing = db.query("SELECT key FROM settings WHERE key = ?").get(s.key);
  if (!existing) {
    db.query("INSERT INTO settings (key, value) VALUES (?, ?)").run(s.key, s.value);
  }
}

console.log("[init-db] Database initialized");
db.close();
