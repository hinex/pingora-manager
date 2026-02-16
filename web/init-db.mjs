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

// ─── Post-migration: enrich existing locations with new fields ───
// Handles proxy hosts that had locations in the old schema (missing
// balanceMethod, redirect fields, headers, accessListId, etc.).
const LOCATION_DEFAULTS = {
  path: "/",
  matchType: "prefix",
  type: "proxy",
  upstreams: [],
  balanceMethod: "round_robin",
  staticDir: "",
  cacheExpires: "",
  forwardScheme: "https",
  forwardDomain: "",
  forwardPath: "/",
  preservePath: true,
  statusCode: 301,
  headers: {},
  accessListId: null,
};

const hostsToEnrich = db.query(
  "SELECT id, locations FROM hosts WHERE locations IS NOT NULL AND locations != '[]' AND locations != 'null'"
).all();

for (const host of hostsToEnrich) {
  let locations;
  try {
    locations = JSON.parse(host.locations);
  } catch {
    continue;
  }
  if (!Array.isArray(locations) || locations.length === 0) continue;

  let changed = false;
  const enriched = locations.map((loc) => {
    const updated = { ...LOCATION_DEFAULTS, ...loc };
    // Normalize: ensure upstreams is always an array (old schema had it optional)
    if (!Array.isArray(updated.upstreams)) updated.upstreams = [];
    // Normalize: ensure headers is always an object
    if (typeof updated.headers !== "object" || updated.headers === null) updated.headers = {};
    // Check if anything was actually added
    for (const key of Object.keys(LOCATION_DEFAULTS)) {
      if (!(key in loc)) {
        changed = true;
        break;
      }
    }
    return updated;
  });

  if (changed) {
    db.query("UPDATE hosts SET locations = ? WHERE id = ?").run(
      JSON.stringify(enriched),
      host.id
    );
    console.log(`[init-db] Enriched locations for host id=${host.id}`);
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
