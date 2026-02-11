import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// ─── Users ───────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["admin", "editor", "viewer"] })
    .notNull()
    .default("viewer"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Host Groups ─────────────────────────────────────────
export const hostGroups = sqliteTable("host_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  webhookUrl: text("webhook_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Proxy Hosts ─────────────────────────────────────────
export const proxyHosts = sqliteTable("proxy_hosts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").references(() => hostGroups.id, { onDelete: "set null" }),
  domains: text("domains", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  sslType: text("ssl_type", { enum: ["none", "letsencrypt", "custom"] })
    .notNull()
    .default("none"),
  sslForceHttps: integer("ssl_force_https", { mode: "boolean" })
    .notNull()
    .default(false),
  sslCertPath: text("ssl_cert_path"),
  sslKeyPath: text("ssl_key_path"),
  upstreams: text("upstreams", { mode: "json" })
    .$type<Array<{ server: string; port: number; weight: number }>>()
    .notNull(),
  balanceMethod: text("balance_method", {
    enum: ["round_robin", "weighted", "least_conn", "ip_hash", "random"],
  })
    .notNull()
    .default("round_robin"),
  locations: text("locations", { mode: "json" })
    .$type<Array<{
      path: string;
      matchType: "prefix" | "exact" | "regex";
      type: "proxy" | "static";
      upstreams?: Array<{ server: string; port: number; weight: number }>;
      staticDir?: string;
      cacheExpires?: string;
      accessListId?: number;
      headers?: Record<string, string>;
      basicAuth?: { enabled: boolean; realm: string };
    }>>()
    .default([]),
  hsts: integer("hsts", { mode: "boolean" }).notNull().default(true),
  http2: integer("http2", { mode: "boolean" }).notNull().default(true),
  webhookUrl: text("webhook_url"),
  advancedYaml: text("advanced_yaml"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Redirections ────────────────────────────────────────
export const redirections = sqliteTable("redirections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").references(() => hostGroups.id, { onDelete: "set null" }),
  domains: text("domains", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  forwardScheme: text("forward_scheme").notNull().default("https"),
  forwardDomain: text("forward_domain").notNull(),
  forwardPath: text("forward_path").notNull().default("/"),
  preservePath: integer("preserve_path", { mode: "boolean" })
    .notNull()
    .default(true),
  statusCode: integer("status_code").notNull().default(301),
  sslType: text("ssl_type", { enum: ["none", "letsencrypt", "custom"] })
    .notNull()
    .default("none"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Streams (TCP/UDP) ──────────────────────────────────
export const streams = sqliteTable("streams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").references(() => hostGroups.id, { onDelete: "set null" }),
  incomingPort: integer("incoming_port").notNull(),
  protocol: text("protocol", { enum: ["tcp", "udp"] })
    .notNull()
    .default("tcp"),
  upstreams: text("upstreams", { mode: "json" })
    .$type<Array<{ server: string; port: number; weight: number }>>()
    .notNull(),
  balanceMethod: text("balance_method", {
    enum: ["round_robin", "weighted", "least_conn", "ip_hash", "random"],
  })
    .notNull()
    .default("round_robin"),
  webhookUrl: text("webhook_url"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Access Lists ────────────────────────────────────────
export const accessLists = sqliteTable("access_lists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  satisfy: text("satisfy", { enum: ["any", "all"] })
    .notNull()
    .default("any"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const accessListClients = sqliteTable("access_list_clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accessListId: integer("access_list_id")
    .notNull()
    .references(() => accessLists.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  directive: text("directive", { enum: ["allow", "deny"] })
    .notNull()
    .default("allow"),
});

export const accessListAuth = sqliteTable("access_list_auth", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accessListId: integer("access_list_id")
    .notNull()
    .references(() => accessLists.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  password: text("password").notNull(),
});

// ─── Health Checks ───────────────────────────────────────
export const healthChecks = sqliteTable(
  "health_checks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostId: integer("host_id"),
    hostType: text("host_type", { enum: ["proxy", "stream"] })
      .notNull()
      .default("proxy"),
    upstream: text("upstream").notNull(),
    status: text("status", { enum: ["up", "down"] }).notNull(),
    responseMs: integer("response_ms"),
    checkedAt: integer("checked_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_health_checks_host_time").on(table.hostId, table.checkedAt),
  ]
);

// ─── Audit Log ───────────────────────────────────────────
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action", {
      enum: ["create", "update", "delete", "login", "logout", "reload"],
    }).notNull(),
    entity: text("entity").notNull(),
    entityId: integer("entity_id"),
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_audit_log_created").on(table.createdAt),
  ]
);

// ─── Settings ────────────────────────────────────────────
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});
