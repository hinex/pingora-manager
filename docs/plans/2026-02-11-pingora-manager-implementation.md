# Pingora Manager — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full Nginx Proxy Manager analog powered by Cloudflare Pingora, with a Remix admin UI, SQLite storage, and Docker-based deployment.

**Architecture:** Single Docker container with two processes managed by s6-overlay: (1) Pingora reverse proxy (Rust) handling HTTP/HTTPS/TCP traffic on ports 80/443, proxying admin UI on port 81; (2) Remix web admin (Bun) on internal port 3001 with background watchdog worker. SQLite for persistence, YAML config files on disk for Pingora.

**Tech Stack:** Rust (Pingora, serde, tokio, rustls), TypeScript/Bun (React Router v7/Remix, Drizzle ORM, Zustand, Tailwind CSS v4, CodeMirror 6, jose, better-sqlite3), Docker (s6-overlay, multi-stage build)

**Reference:** See `docs/plans/2026-02-11-pingora-manager-design.md` for the full design document.

---

## Phase 1: Project Scaffolding & Foundation

### Task 1: Initialize Git Repository and Project Structure

**Files:**
- Create: `.gitignore`
- Create: `README.md` (minimal)

**Step 1: Initialize git repo**

```bash
cd /home/roman/Projects/hardskilled/pingora-manager
git init
```

**Step 2: Create .gitignore**

```gitignore
# Rust
proxy/target/
proxy/**/*.rs.bk

# Node/Bun
web/node_modules/
web/build/
web/.cache/

# Data (runtime, not committed)
data/
letsencrypt/

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
Thumbs.db

# Environment
.env
.env.local
```

**Step 3: Create directory structure**

```bash
mkdir -p proxy/src
mkdir -p web/app/{routes,components,lib/{db,auth,config-generator,watchdog,acme,signal},store}
mkdir -p s6/services/{pingora,web}
mkdir -p docs/plans
```

**Step 4: Commit**

```bash
git add .
git commit -m "chore: initialize project structure"
```

---

### Task 2: Initialize Rust Proxy Project

**Files:**
- Create: `proxy/Cargo.toml`
- Create: `proxy/src/main.rs`

**Step 1: Create Cargo.toml**

```toml
[package]
name = "pingora-manager-proxy"
version = "0.1.0"
edition = "2021"

[dependencies]
pingora = { version = "0.4", features = ["lb"] }
pingora-proxy = "0.4"
pingora-core = "0.4"
pingora-load-balancing = "0.4"
pingora-http = "0.4"
async-trait = "0.1"
serde = { version = "1", features = ["derive"] }
serde_yaml = "0.9"
tokio = { version = "1", features = ["full"] }
log = "0.4"
env_logger = "0.10"
regex = "1"
glob = "0.3"
notify = "6"
base64 = "0.22"
mime_guess = "2"
chrono = "0.4"
```

**Step 2: Create minimal main.rs that compiles**

```rust
use pingora::prelude::*;

fn main() {
    env_logger::init();
    log::info!("Pingora Manager Proxy starting...");

    let mut server = Server::new(None).unwrap();
    server.bootstrap();
    // Services will be registered here
    server.run_forever();
}
```

**Step 3: Verify it compiles**

```bash
cd proxy && cargo check
```

Expected: compiles with no errors.

**Step 4: Commit**

```bash
git add proxy/
git commit -m "feat: initialize Rust proxy project with Pingora dependencies"
```

---

### Task 3: Initialize Web Admin Project (Remix + Bun)

**Files:**
- Create: `web/package.json`
- Create: `web/app/root.tsx`
- Create: `web/app/routes.ts`
- Create: `web/app/app.css`
- Create: `web/app/routes/home.tsx`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/react-router.config.ts`

**Step 1: Initialize Bun project**

```bash
cd web
bun init -y
```

**Step 2: Install dependencies**

```bash
bun add react react-dom react-router
bun add @react-router/dev @react-router/node @react-router/serve
bun add better-sqlite3 drizzle-orm
bun add zustand jose yaml
bun add tailwindcss @tailwindcss/vite
bun add -d vite typescript @types/react @types/react-dom @types/better-sqlite3
bun add -d drizzle-kit vite-tsconfig-paths
```

**Step 3: Create react-router.config.ts**

```typescript
import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
} satisfies Config;
```

**Step 4: Create vite.config.ts**

```typescript
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
```

**Step 5: Create tsconfig.json**

```json
{
  "include": ["app/**/*.ts", "app/**/*.tsx"],
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "paths": {
      "~/*": ["./app/*"]
    }
  }
}
```

**Step 6: Create app/app.css**

```css
@import "tailwindcss";

@theme {
  --color-primary: #3b82f6;
  --color-primary-dark: #2563eb;
  --color-sidebar: #1e293b;
  --color-sidebar-hover: #334155;
}
```

**Step 7: Create app/root.tsx**

```tsx
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-gray-50 text-gray-900 antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}
```

**Step 8: Create app/routes.ts**

```typescript
import { type RouteConfig, route, index, layout } from "@react-router/dev/routes";

export default [
  index("./routes/home.tsx"),
] satisfies RouteConfig;
```

**Step 9: Create app/routes/home.tsx**

```tsx
export default function Home() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <h1 className="text-3xl font-bold text-primary">Pingora Manager</h1>
    </div>
  );
}
```

**Step 10: Verify it builds**

```bash
cd web && bun run build
```

Expected: builds successfully.

**Step 11: Commit**

```bash
git add web/
git commit -m "feat: initialize Remix web admin with Bun, Tailwind CSS v4"
```

---

## Phase 2: Database Layer

### Task 4: Drizzle ORM Schema

**Files:**
- Create: `web/app/lib/db/schema.ts`
- Create: `web/app/lib/db/connection.ts`
- Create: `web/drizzle.config.ts`

**Step 1: Create schema.ts**

```typescript
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
```

**Step 2: Create connection.ts**

```typescript
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const DB_PATH = process.env.DB_PATH || "/data/db.sqlite";

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
```

**Step 3: Create drizzle.config.ts**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_PATH || "./data/db.sqlite",
  },
});
```

**Step 4: Generate initial migration**

```bash
cd web && bunx drizzle-kit generate
```

**Step 5: Commit**

```bash
git add web/app/lib/db/ web/drizzle.config.ts web/drizzle/
git commit -m "feat: add Drizzle ORM schema and SQLite connection"
```

---

### Task 5: Database Seeding (Initial Admin User)

**Files:**
- Create: `web/app/lib/db/seed.ts`

**Step 1: Create seed.ts**

```typescript
import { db } from "./connection";
import { users, settings } from "./schema";
import { eq } from "drizzle-orm";

const DEFAULT_ADMIN_EMAIL = "admin@example.com";
const DEFAULT_ADMIN_PASSWORD = "changeme";

export async function seed() {
  // Check if admin user exists
  const existingAdmin = db
    .select()
    .from(users)
    .where(eq(users.email, DEFAULT_ADMIN_EMAIL))
    .get();

  if (!existingAdmin) {
    const hashedPassword = await Bun.password.hash(DEFAULT_ADMIN_PASSWORD, {
      algorithm: "argon2id",
    });

    db.insert(users).values({
      email: DEFAULT_ADMIN_EMAIL,
      password: hashedPassword,
      name: "Administrator",
      role: "admin",
      mustChangePassword: true,
    }).run();

    console.log(`[seed] Created default admin user: ${DEFAULT_ADMIN_EMAIL}`);
  }

  // Seed default settings
  const defaultSettings = [
    { key: "global_webhook_url", value: "" },
    { key: "watchdog_interval_ms", value: "30000" },
    { key: "audit_retention_days", value: "90" },
    { key: "health_retention_days", value: "30" },
  ];

  for (const s of defaultSettings) {
    const existing = db.select().from(settings).where(eq(settings.key, s.key)).get();
    if (!existing) {
      db.insert(settings).values(s).run();
    }
  }

  console.log("[seed] Default settings initialized");
}
```

**Step 2: Commit**

```bash
git add web/app/lib/db/seed.ts
git commit -m "feat: add database seeding with default admin user"
```

---

## Phase 3: Authentication

### Task 6: JWT and Auth Utilities

**Files:**
- Create: `web/app/lib/auth/jwt.server.ts`
- Create: `web/app/lib/auth/session.server.ts`
- Create: `web/app/lib/auth/middleware.ts`

**Step 1: Create jwt.server.ts**

```typescript
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "pingora-manager-default-secret-change-me!!"
);

export interface TokenPayload extends JWTPayload {
  userId: number;
  email: string;
  role: string;
}

export async function createToken(payload: {
  userId: number;
  email: string;
  role: string;
}): Promise<string> {
  return new SignJWT({
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(JWT_SECRET);
}

export async function verifyToken(
  token: string
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as TokenPayload;
  } catch {
    return null;
  }
}
```

**Step 2: Create session.server.ts**

```typescript
import { createToken, verifyToken, type TokenPayload } from "./jwt.server";

const COOKIE_NAME = "pm_session";

export function createSessionCookie(token: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  return [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    isProduction ? "Secure" : "",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=86400",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`;
}

export async function getSessionUser(
  request: Request
): Promise<TokenPayload | null> {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifyToken(match[1]);
}

export function requireRole(
  user: TokenPayload | null,
  ...roles: string[]
): TokenPayload {
  if (!user || !roles.includes(user.role)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}
```

**Step 3: Create middleware.ts**

```typescript
import { redirect } from "react-router";
import { getSessionUser } from "./session.server";

export async function requireAuth(request: Request) {
  const user = await getSessionUser(request);
  if (!user) {
    throw redirect("/login");
  }
  return user;
}

export async function requireAdmin(request: Request) {
  const user = await requireAuth(request);
  if (user.role !== "admin") {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}

export async function requireEditor(request: Request) {
  const user = await requireAuth(request);
  if (user.role === "viewer") {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}
```

**Step 4: Commit**

```bash
git add web/app/lib/auth/
git commit -m "feat: add JWT auth with session cookies and role middleware"
```

---

### Task 7: Login Page

**Files:**
- Create: `web/app/routes/login.tsx`
- Modify: `web/app/routes.ts`

**Step 1: Create login.tsx**

```tsx
import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { db } from "~/lib/db/connection";
import { users } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { createToken } from "~/lib/auth/jwt.server";
import {
  createSessionCookie,
  getSessionUser,
} from "~/lib/auth/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getSessionUser(request);
  if (user) throw redirect("/admin");
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const user = db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (!user) {
    return { error: "Invalid credentials" };
  }

  const valid = await Bun.password.verify(password, user.password);
  if (!valid) {
    return { error: "Invalid credentials" };
  }

  const token = await createToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const redirectTo = user.mustChangePassword ? "/admin/change-password" : "/admin";

  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": createSessionCookie(token),
    },
  });
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2">Pingora Manager</h1>
        <p className="text-gray-500 mb-6 text-sm">Sign in to your account</p>

        {actionData?.error && (
          <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">
            {actionData.error}
          </div>
        )}

        <Form method="post" className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              name="email"
              required
              autoFocus
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              name="password"
              required
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-primary text-white py-2 rounded hover:bg-primary-dark disabled:opacity-50"
          >
            {isSubmitting ? "Signing in..." : "Sign In"}
          </button>
        </Form>
      </div>
    </div>
  );
}
```

**Step 2: Update routes.ts**

```typescript
import { type RouteConfig, route, index, layout, prefix } from "@react-router/dev/routes";

export default [
  route("login", "./routes/login.tsx"),
  // Admin routes will be added in later tasks
] satisfies RouteConfig;
```

**Step 3: Commit**

```bash
git add web/app/routes/login.tsx web/app/routes.ts
git commit -m "feat: add login page with Argon2id password verification"
```

---

## Phase 4: Admin Layout & Dashboard

### Task 8: Admin Layout with Sidebar

**Files:**
- Create: `web/app/routes/admin/layout.tsx`
- Create: `web/app/components/Sidebar.tsx`
- Create: `web/app/store/ui.ts`
- Modify: `web/app/routes.ts`

**Step 1: Create ui store (Zustand)**

```typescript
// web/app/store/ui.ts
import { create } from "zustand";

interface UIState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
```

**Step 2: Create Sidebar.tsx**

```tsx
// web/app/components/Sidebar.tsx
import { NavLink } from "react-router";
import { useUIStore } from "~/store/ui";

const navItems = [
  { to: "/admin", label: "Dashboard", icon: "grid" },
  { to: "/admin/proxy-hosts", label: "Proxy Hosts", icon: "server" },
  { to: "/admin/groups", label: "Groups", icon: "folder" },
  { to: "/admin/redirections", label: "Redirections", icon: "arrow-right" },
  { to: "/admin/streams", label: "Streams", icon: "activity" },
  { to: "/admin/ssl", label: "SSL Certificates", icon: "lock" },
  { to: "/admin/access-lists", label: "Access Lists", icon: "shield" },
  { to: "/admin/error-pages", label: "Error Pages", icon: "alert-triangle" },
  { to: "/admin/default-page", label: "Default Page", icon: "file-text" },
  { to: "/admin/static", label: "Static Directories", icon: "hard-drive" },
  { to: "/admin/logs", label: "Logs", icon: "terminal" },
  { to: "/admin/health", label: "Health Dashboard", icon: "heart" },
  { to: "/admin/audit-log", label: "Audit Log", icon: "list" },
  { to: "/admin/users", label: "Users", icon: "users" },
  { to: "/admin/settings", label: "Settings", icon: "settings" },
];

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  return (
    <aside
      className={`bg-sidebar text-white h-screen fixed left-0 top-0 overflow-y-auto transition-all ${
        sidebarOpen ? "w-64" : "w-16"
      }`}
    >
      <div className="p-4 border-b border-sidebar-hover">
        <h1 className={`font-bold ${sidebarOpen ? "text-lg" : "text-xs text-center"}`}>
          {sidebarOpen ? "Pingora Manager" : "PM"}
        </h1>
      </div>
      <nav className="mt-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/admin"}
            className={({ isActive }) =>
              `flex items-center px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-primary text-white"
                  : "text-gray-300 hover:bg-sidebar-hover"
              }`
            }
          >
            <span className={sidebarOpen ? "ml-2" : "mx-auto text-xs"}>
              {sidebarOpen ? item.label : item.label.charAt(0)}
            </span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
```

**Step 3: Create admin layout**

```tsx
// web/app/routes/admin/layout.tsx
import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout";
import { getSessionUser } from "~/lib/auth/session.server";
import { Sidebar } from "~/components/Sidebar";
import { useUIStore } from "~/store/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getSessionUser(request);
  if (!user) throw redirect("/login");
  return { user };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className={`transition-all ${sidebarOpen ? "ml-64" : "ml-16"}`}>
        <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
          <button
            onClick={toggleSidebar}
            className="text-gray-500 hover:text-gray-700"
          >
            {sidebarOpen ? "<<" : ">>"}
          </button>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{loaderData.user.email}</span>
            <form method="post" action="/logout">
              <button
                type="submit"
                className="text-sm text-red-600 hover:text-red-800"
              >
                Logout
              </button>
            </form>
          </div>
        </header>
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

**Step 4: Create logout route**

```tsx
// web/app/routes/logout.tsx
import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { clearSessionCookie } from "~/lib/auth/session.server";

export async function action({}: Route.ActionArgs) {
  return redirect("/login", {
    headers: { "Set-Cookie": clearSessionCookie() },
  });
}
```

**Step 5: Update routes.ts**

```typescript
import { type RouteConfig, route, index, layout, prefix } from "@react-router/dev/routes";

export default [
  route("login", "./routes/login.tsx"),
  route("logout", "./routes/logout.tsx"),

  layout("./routes/admin/layout.tsx", [
    ...prefix("admin", [
      index("./routes/admin/dashboard.tsx"),
      route("proxy-hosts", "./routes/admin/proxy-hosts/index.tsx"),
      route("proxy-hosts/new", "./routes/admin/proxy-hosts/new.tsx"),
      route("proxy-hosts/:id/edit", "./routes/admin/proxy-hosts/edit.tsx"),
      route("groups", "./routes/admin/groups.tsx"),
      route("redirections", "./routes/admin/redirections.tsx"),
      route("streams", "./routes/admin/streams.tsx"),
      route("ssl", "./routes/admin/ssl.tsx"),
      route("access-lists", "./routes/admin/access-lists.tsx"),
      route("error-pages", "./routes/admin/error-pages.tsx"),
      route("default-page", "./routes/admin/default-page.tsx"),
      route("static", "./routes/admin/static-dirs.tsx"),
      route("logs", "./routes/admin/logs.tsx"),
      route("health", "./routes/admin/health.tsx"),
      route("audit-log", "./routes/admin/audit-log.tsx"),
      route("users", "./routes/admin/users.tsx"),
      route("settings", "./routes/admin/settings.tsx"),
      route("change-password", "./routes/admin/change-password.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
```

**Step 6: Commit**

```bash
git add web/app/routes/ web/app/components/ web/app/store/
git commit -m "feat: add admin layout with sidebar navigation and auth guard"
```

---

### Task 9: Dashboard Page

**Files:**
- Create: `web/app/routes/admin/dashboard.tsx`

**Step 1: Create dashboard.tsx**

```tsx
import type { Route } from "./+types/dashboard";
import { db } from "~/lib/db/connection";
import { proxyHosts, hostGroups, streams, redirections, healthChecks } from "~/lib/db/schema";
import { sql, eq, desc } from "drizzle-orm";

export async function loader({}: Route.LoaderArgs) {
  const hostCount = db.select({ count: sql<number>`count(*)` }).from(proxyHosts).get();
  const groupCount = db.select({ count: sql<number>`count(*)` }).from(hostGroups).get();
  const streamCount = db.select({ count: sql<number>`count(*)` }).from(streams).get();
  const redirectCount = db.select({ count: sql<number>`count(*)` }).from(redirections).get();

  // Get latest health status per upstream
  const latestHealth = db
    .select()
    .from(healthChecks)
    .orderBy(desc(healthChecks.checkedAt))
    .limit(50)
    .all();

  // Deduplicate by upstream (keep latest)
  const upstreamStatus = new Map<string, { status: string; responseMs: number | null }>();
  for (const h of latestHealth) {
    if (!upstreamStatus.has(h.upstream)) {
      upstreamStatus.set(h.upstream, { status: h.status, responseMs: h.responseMs });
    }
  }

  const upCount = [...upstreamStatus.values()].filter((s) => s.status === "up").length;
  const downCount = [...upstreamStatus.values()].filter((s) => s.status === "down").length;

  return {
    hosts: hostCount?.count ?? 0,
    groups: groupCount?.count ?? 0,
    streams: streamCount?.count ?? 0,
    redirects: redirectCount?.count ?? 0,
    upstreamsUp: upCount,
    upstreamsDown: downCount,
  };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const d = loaderData;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Proxy Hosts" value={d.hosts} />
        <StatCard label="Groups" value={d.groups} />
        <StatCard label="Streams" value={d.streams} />
        <StatCard label="Redirections" value={d.redirects} />
        <StatCard label="Upstreams Up" value={d.upstreamsUp} color="green" />
        <StatCard label="Upstreams Down" value={d.upstreamsDown} color="red" />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: "green" | "red";
}) {
  const colorClass =
    color === "green"
      ? "text-green-600"
      : color === "red"
        ? "text-red-600"
        : "text-gray-900";

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add web/app/routes/admin/dashboard.tsx
git commit -m "feat: add dashboard with stats overview"
```

---

## Phase 5: Core CRUD — Proxy Hosts

### Task 10: Proxy Hosts List Page

**Files:**
- Create: `web/app/routes/admin/proxy-hosts/index.tsx`

**Step 1: Create proxy hosts list**

```tsx
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/index";
import { db } from "~/lib/db/connection";
import { proxyHosts, hostGroups } from "~/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireEditor } from "~/lib/auth/middleware";

export async function loader({}: Route.LoaderArgs) {
  const hosts = db
    .select({
      id: proxyHosts.id,
      domains: proxyHosts.domains,
      sslType: proxyHosts.sslType,
      enabled: proxyHosts.enabled,
      groupId: proxyHosts.groupId,
      balanceMethod: proxyHosts.balanceMethod,
      createdAt: proxyHosts.createdAt,
    })
    .from(proxyHosts)
    .orderBy(desc(proxyHosts.createdAt))
    .all();

  const groups = db.select().from(hostGroups).all();
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));

  return { hosts, groupMap };
}

export async function action({ request }: Route.ActionArgs) {
  await requireEditor(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = Number(formData.get("id"));

  if (intent === "delete") {
    db.delete(proxyHosts).where(eq(proxyHosts.id, id)).run();
    // TODO: regenerate configs + SIGHUP
    return { success: true };
  }

  if (intent === "toggle") {
    const host = db.select().from(proxyHosts).where(eq(proxyHosts.id, id)).get();
    if (host) {
      db.update(proxyHosts)
        .set({ enabled: !host.enabled })
        .where(eq(proxyHosts.id, id))
        .run();
      // TODO: regenerate configs + SIGHUP
    }
    return { success: true };
  }

  return { error: "Unknown intent" };
}

export default function ProxyHostsIndex({ loaderData }: Route.ComponentProps) {
  const { hosts, groupMap } = loaderData;
  const fetcher = useFetcher();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Proxy Hosts</h1>
        <Link
          to="/admin/proxy-hosts/new"
          className="bg-primary text-white px-4 py-2 rounded hover:bg-primary-dark"
        >
          Add Proxy Host
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Domains</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Group</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">SSL</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {hosts.map((host) => (
              <tr key={host.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  {(host.domains as string[]).map((d) => (
                    <span key={d} className="block text-sm">{d}</span>
                  ))}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {host.groupId ? groupMap[host.groupId] ?? "—" : "—"}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded ${
                    host.sslType === "letsencrypt" ? "bg-green-100 text-green-700" :
                    host.sslType === "custom" ? "bg-blue-100 text-blue-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>
                    {host.sslType}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="toggle" />
                    <input type="hidden" name="id" value={host.id} />
                    <button type="submit" className={`text-xs px-2 py-1 rounded ${
                      host.enabled ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}>
                      {host.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </fetcher.Form>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <Link
                    to={`/admin/proxy-hosts/${host.id}/edit`}
                    className="text-sm text-primary hover:underline"
                  >
                    Edit
                  </Link>
                  <fetcher.Form method="post" className="inline">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={host.id} />
                    <button
                      type="submit"
                      className="text-sm text-red-600 hover:underline"
                      onClick={(e) => {
                        if (!confirm("Delete this proxy host?")) e.preventDefault();
                      }}
                    >
                      Delete
                    </button>
                  </fetcher.Form>
                </td>
              </tr>
            ))}
            {hosts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No proxy hosts yet. Click "Add Proxy Host" to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add web/app/routes/admin/proxy-hosts/
git commit -m "feat: add proxy hosts list page with toggle and delete"
```

---

### Task 11: Proxy Host Create/Edit Form

**Files:**
- Create: `web/app/routes/admin/proxy-hosts/new.tsx`
- Create: `web/app/routes/admin/proxy-hosts/edit.tsx`
- Create: `web/app/components/proxy-host-form/ProxyHostForm.tsx`
- Create: `web/app/components/proxy-host-form/GeneralTab.tsx`
- Create: `web/app/components/proxy-host-form/UpstreamsTab.tsx`
- Create: `web/app/components/proxy-host-form/LocationsTab.tsx`
- Create: `web/app/components/proxy-host-form/SslTab.tsx`
- Create: `web/app/components/proxy-host-form/AdvancedTab.tsx`

This is the most complex UI component. Each tab is a separate component. The form state is managed with React `useState` and submitted as JSON via a hidden input.

**Step 1:** Create all form tab components. Each tab receives the form state and a setter. The parent `ProxyHostForm` manages tab switching and serializes the full state on submit.

**Step 2:** Create the `new.tsx` route with a Remix action that validates, inserts into SQLite, generates the YAML config file, and sends SIGHUP.

**Step 3:** Create the `edit.tsx` route that loads existing data and pre-fills the form.

**Step 4: Commit**

```bash
git add web/app/routes/admin/proxy-hosts/ web/app/components/proxy-host-form/
git commit -m "feat: add proxy host create/edit form with tabs"
```

---

## Phase 6: Config Generator & Reload

### Task 12: YAML Config Generator

**Files:**
- Create: `web/app/lib/config-generator/generate.ts`
- Create: `web/app/lib/config-generator/templates.ts`

**Step 1: Create generate.ts**

This module reads all proxy hosts, redirections, streams, and access lists from SQLite, generates YAML files, and writes them to `data/configs/`.

```typescript
import { stringify } from "yaml";
import { db } from "~/lib/db/connection";
import {
  proxyHosts,
  redirections,
  streams,
  accessLists,
  accessListClients,
  accessListAuth,
  settings,
} from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { writeFileSync, mkdirSync } from "fs";

const CONFIGS_DIR = process.env.CONFIGS_DIR || "/data/configs";

export function generateAllConfigs() {
  mkdirSync(CONFIGS_DIR, { recursive: true });

  generateGlobalConfig();
  generateAccessListsConfig();

  const hosts = db.select().from(proxyHosts).all();
  for (const host of hosts) {
    generateHostConfig(host);
  }

  const redirects = db.select().from(redirections).all();
  for (const r of redirects) {
    generateRedirectConfig(r);
  }

  const allStreams = db.select().from(streams).all();
  for (const s of allStreams) {
    generateStreamConfig(s);
  }
}

export function generateHostConfig(host: typeof proxyHosts.$inferSelect) {
  const config = {
    id: host.id,
    domains: host.domains,
    group_id: host.groupId,
    ssl: {
      type: host.sslType,
      force_https: host.sslForceHttps,
      cert_path: host.sslCertPath,
      key_path: host.sslKeyPath,
    },
    upstreams: host.upstreams,
    balance_method: host.balanceMethod,
    locations: host.locations,
    hsts: host.hsts,
    http2: host.http2,
    advanced_yaml: host.advancedYaml,
    enabled: host.enabled,
  };

  writeFileSync(`${CONFIGS_DIR}/host-${host.id}.yaml`, stringify(config));
}

function generateGlobalConfig() {
  const allSettings = db.select().from(settings).all();
  const settingsMap = Object.fromEntries(allSettings.map((s) => [s.key, s.value]));

  const config = {
    listen: { http: 80, https: 443, admin: 81 },
    admin_upstream: "127.0.0.1:3001",
    default_page: "/data/default-page/index.html",
    error_pages_dir: "/data/error-pages",
    logs_dir: "/data/logs",
    ssl_dir: "/etc/letsencrypt",
    global_webhook_url: settingsMap["global_webhook_url"] || "",
  };

  writeFileSync(`${CONFIGS_DIR}/global.yaml`, stringify(config));
}

function generateAccessListsConfig() {
  const lists = db.select().from(accessLists).all();
  const result = lists.map((list) => {
    const clients = db
      .select()
      .from(accessListClients)
      .where(eq(accessListClients.accessListId, list.id))
      .all();
    const auth = db
      .select()
      .from(accessListAuth)
      .where(eq(accessListAuth.accessListId, list.id))
      .all();

    return {
      id: list.id,
      name: list.name,
      satisfy: list.satisfy,
      clients: clients.map((c) => ({
        address: c.address,
        directive: c.directive,
      })),
      auth: auth.map((a) => ({
        username: a.username,
        password: a.password,
      })),
    };
  });

  writeFileSync(`${CONFIGS_DIR}/access-lists.yaml`, stringify(result));
}

function generateRedirectConfig(r: typeof redirections.$inferSelect) {
  const config = {
    id: r.id,
    domains: r.domains,
    forward_scheme: r.forwardScheme,
    forward_domain: r.forwardDomain,
    forward_path: r.forwardPath,
    preserve_path: r.preservePath,
    status_code: r.statusCode,
    ssl_type: r.sslType,
    enabled: r.enabled,
  };

  writeFileSync(`${CONFIGS_DIR}/redirect-${r.id}.yaml`, stringify(config));
}

function generateStreamConfig(s: typeof streams.$inferSelect) {
  const config = {
    id: s.id,
    incoming_port: s.incomingPort,
    protocol: s.protocol,
    upstreams: s.upstreams,
    balance_method: s.balanceMethod,
    enabled: s.enabled,
  };

  writeFileSync(`${CONFIGS_DIR}/stream-${s.id}.yaml`, stringify(config));
}
```

**Step 2: Commit**

```bash
git add web/app/lib/config-generator/
git commit -m "feat: add YAML config generator for Pingora"
```

---

### Task 13: Pingora Signal (SIGHUP) Module

**Files:**
- Create: `web/app/lib/signal/reload.ts`

**Step 1: Create reload.ts**

```typescript
import { execSync } from "child_process";

export function reloadPingora(): boolean {
  try {
    // In Docker with s6-overlay
    execSync("s6-svc -h /run/s6-rc/servicedirs/pingora", {
      timeout: 5000,
    });
    return true;
  } catch (e) {
    // Fallback: try sending SIGHUP via PID file
    try {
      const pid = execSync("cat /run/pingora.pid", { encoding: "utf-8" }).trim();
      execSync(`kill -HUP ${pid}`, { timeout: 5000 });
      return true;
    } catch {
      console.error("[reload] Failed to send SIGHUP to Pingora:", e);
      return false;
    }
  }
}
```

**Step 2: Commit**

```bash
git add web/app/lib/signal/
git commit -m "feat: add Pingora reload signal module"
```

---

## Phase 7: Pingora Proxy Server (Rust)

### Task 14: Config Parsing Module

**Files:**
- Create: `proxy/src/config.rs`

**Step 1: Create config.rs with all data structures for YAML parsing**

Define Rust structs for `GlobalConfig`, `HostConfig`, `RedirectConfig`, `StreamConfig`, `AccessListConfig` that map 1:1 to the YAML files generated by the admin. Include a `load_all_configs()` function that reads the configs directory.

**Step 2: Verify it compiles**

```bash
cd proxy && cargo check
```

**Step 3: Commit**

```bash
git add proxy/src/config.rs
git commit -m "feat: add YAML config parsing for Pingora"
```

---

### Task 15: Router Module (Domain + Location Matching)

**Files:**
- Create: `proxy/src/router.rs`

**Step 1: Create router.rs**

Implement a `Router` struct that holds all loaded host configs in a `HashMap<String, HostConfig>` (domain → config). The `resolve()` method takes a hostname and path, finds the matching host config and location. Location matching supports prefix, exact, and regex. Locations are evaluated in order (like nginx).

**Step 2: Commit**

```bash
git add proxy/src/router.rs
git commit -m "feat: add domain and location router"
```

---

### Task 16: Upstream Selection and Load Balancing

**Files:**
- Create: `proxy/src/upstream.rs`

**Step 1: Create upstream.rs**

Implement load balancer wrappers for each algorithm. For each proxy host, create the appropriate `LoadBalancer` based on `balance_method`. The module provides a `select_upstream()` function that takes the host config and returns an `HttpPeer`.

**Step 2: Commit**

```bash
git add proxy/src/upstream.rs
git commit -m "feat: add upstream selection with all LB algorithms"
```

---

### Task 17: Static File Serving

**Files:**
- Create: `proxy/src/static_files.rs`

**Step 1: Create static_files.rs**

Implement static file serving for locations with `static_dir`. Read the file from disk, determine MIME type with `mime_guess`, set cache headers based on `cache_expires`, and write the response. Handle conditional requests (If-Modified-Since, 304).

**Step 2: Commit**

```bash
git add proxy/src/static_files.rs
git commit -m "feat: add static file serving with cache headers"
```

---

### Task 18: Error Pages Module

**Files:**
- Create: `proxy/src/error_pages.rs`

**Step 1: Create error_pages.rs**

Implement error page resolution: `host-{id}/` → `group-{id}/` → `global/` → built-in fallback HTML. Read HTML from disk, cache in memory (invalidated on reload). The `serve_error_page()` function writes the error response to the session.

**Step 2: Commit**

```bash
git add proxy/src/error_pages.rs
git commit -m "feat: add error page serving with cascading resolution"
```

---

### Task 19: Access Control Module

**Files:**
- Create: `proxy/src/access_control.rs`

**Step 1: Create access_control.rs**

Implement IP whitelist/blacklist checking (CIDR matching) and Basic Auth verification. Load access lists from `access-lists.yaml`. The `check_access()` function returns `Allow` or `Deny` based on the `satisfy` mode (any/all).

**Step 2: Commit**

```bash
git add proxy/src/access_control.rs
git commit -m "feat: add access control with IP and basic auth"
```

---

### Task 20: SSL / TLS Module

**Files:**
- Create: `proxy/src/ssl.rs`

**Step 1: Create ssl.rs**

Build TLS settings with SNI-based certificate selection. Load all certificates (Let's Encrypt from `/etc/letsencrypt/`, custom from `data/ssl/custom/`). Create `TlsSettings` with certificate bundles. Handle HTTP→HTTPS redirect for hosts with `force_https`.

**Step 2: Commit**

```bash
git add proxy/src/ssl.rs
git commit -m "feat: add TLS/SSL configuration with SNI support"
```

---

### Task 21: TCP/UDP Stream Proxying

**Files:**
- Create: `proxy/src/streams.rs`

**Step 1: Create streams.rs**

Implement `ServerApp` trait for TCP proxying. For each enabled stream config, create a listener on the specified port and proxy bidirectionally to the upstream backend using `tokio::io::copy`.

**Step 2: Commit**

```bash
git add proxy/src/streams.rs
git commit -m "feat: add TCP/UDP stream proxying"
```

---

### Task 22: Main ProxyHttp Implementation

**Files:**
- Modify: `proxy/src/main.rs`

**Step 1: Implement the full ProxyHttp trait**

Wire all modules together in `main.rs`:
- `new_ctx()` — creates per-request context
- `request_filter()` — handles redirections, static files, error pages for unmatched hosts, ACME challenge, access control
- `upstream_peer()` — uses router to find host config, then upstream selector for load balancing
- `upstream_request_filter()` — sets Host, X-Real-IP, X-Forwarded-For, custom headers
- `response_filter()` — sets HSTS, removes sensitive upstream headers
- `fail_to_proxy()` — serves error page
- `logging()` — writes per-host access log

Register admin proxy on port 81 (proxies to `127.0.0.1:3001`).

Set up SIGHUP handler to reload configs.

**Step 2: Verify full compilation**

```bash
cd proxy && cargo build
```

**Step 3: Commit**

```bash
git add proxy/src/
git commit -m "feat: implement full Pingora proxy with routing, LB, SSL, static files"
```

---

## Phase 8: Remaining Admin UI Pages

### Task 23: Groups CRUD

**Files:**
- Create: `web/app/routes/admin/groups.tsx`

Implement list view with inline create/edit/delete. Simple table with name, description, webhook URL, host count.

**Commit:** `feat: add groups management page`

---

### Task 24: Redirections CRUD

**Files:**
- Create: `web/app/routes/admin/redirections.tsx`

List + modal form for create/edit. Fields: domains, forward scheme/domain/path, preserve path, status code, SSL type.

**Commit:** `feat: add redirections management page`

---

### Task 25: Streams CRUD

**Files:**
- Create: `web/app/routes/admin/streams.tsx`

List + modal form. Fields: incoming port, protocol (TCP/UDP), upstreams, balance method. Show warning about Docker port mapping.

**Commit:** `feat: add streams management page`

---

### Task 26: SSL Certificates Page

**Files:**
- Create: `web/app/routes/admin/ssl.tsx`
- Create: `web/app/lib/acme/client.ts`

List all certs (Let's Encrypt + custom). "Request Certificate" button triggers ACME flow. "Upload Custom" for .crt/.key upload. Show domain, type, expiry date, status.

**Commit:** `feat: add SSL certificates management with ACME client`

---

### Task 27: Access Lists CRUD

**Files:**
- Create: `web/app/routes/admin/access-lists.tsx`

Create/edit access list with: name, satisfy mode, IP rules (address + allow/deny), Basic Auth users (username + password).

**Commit:** `feat: add access lists management page`

---

### Task 28: Error Pages Editor

**Files:**
- Create: `web/app/routes/admin/error-pages.tsx`
- Create: `web/app/components/HtmlEditor.tsx`

Install: `bun add @uiw/react-codemirror @codemirror/lang-html`

Select scope (global/group/host) and error code (404, 502, 503, etc.). CodeMirror editor loads current HTML from `data/error-pages/`. Save writes to disk.

**Commit:** `feat: add error pages editor with CodeMirror`

---

### Task 29: Default Page Editor

**Files:**
- Create: `web/app/routes/admin/default-page.tsx`

CodeMirror HTML editor for `data/default-page/index.html`. Simple load + save.

**Commit:** `feat: add default page editor`

---

### Task 30: Static Directories Management

**Files:**
- Create: `web/app/routes/admin/static-dirs.tsx`

This page helps visualize and manage static location mappings across proxy hosts. Shows all locations of type "static" from all hosts in one view. Links to the host edit form for modifications.

**Commit:** `feat: add static directories overview page`

---

### Task 31: Logs Viewer

**Files:**
- Create: `web/app/routes/admin/logs.tsx`
- Create: `web/app/routes/api/logs.tsx` (API endpoint for log tail)

Select host from dropdown. Shows last N lines of access/error log. Auto-refresh polling every 3 seconds. Text search filter. Download button.

The API route reads log files and returns JSON with lines. The main route uses `useEffect` + `fetch` for polling.

**Commit:** `feat: add logs viewer with tail mode and search`

---

### Task 32: Health Dashboard

**Files:**
- Create: `web/app/routes/admin/health.tsx`

Table of all upstreams: host name, upstream address, status (up/down with colored badge), response time, last checked. Filter by group. Mini sparkline for 24h/7d uptime (SVG or simple CSS bars).

**Commit:** `feat: add health dashboard with upstream status`

---

### Task 33: Audit Log Viewer

**Files:**
- Create: `web/app/routes/admin/audit-log.tsx`

Chronological list with filters: user, action type, entity type, date range. Shows: timestamp, user name, action, entity, details summary.

**Commit:** `feat: add audit log viewer with filters`

---

### Task 34: Users Management

**Files:**
- Create: `web/app/routes/admin/users.tsx`

Admin-only page. List users with role badges. Create/edit modal: name, email, password, role. Delete with confirmation. Password stored as Argon2id hash.

**Commit:** `feat: add users management page (admin only)`

---

### Task 35: Settings Page

**Files:**
- Create: `web/app/routes/admin/settings.tsx`

Admin-only. Key-value settings form: global webhook URL, watchdog interval, audit retention days, health check retention days. Save updates the `settings` table and regenerates global config.

**Commit:** `feat: add settings page`

---

### Task 36: Change Password Page

**Files:**
- Create: `web/app/routes/admin/change-password.tsx`

Forced on first login (when `must_change_password` is true). Fields: current password, new password, confirm. Validates current password, hashes new one, clears the flag.

**Commit:** `feat: add forced password change on first login`

---

## Phase 9: Watchdog & Webhooks

### Task 37: Watchdog Background Worker

**Files:**
- Create: `web/app/lib/watchdog/worker.ts`
- Create: `web/app/lib/watchdog/health-check.ts`
- Create: `web/app/lib/watchdog/webhook.ts`

**Step 1: Create health-check.ts**

TCP connect to each upstream with a timeout. Returns `{ status: "up" | "down", responseMs: number }`.

**Step 2: Create webhook.ts**

`sendWebhook(url, payload)` — POST JSON to webhook URL. Webhook URL resolution: host → group → global.

**Step 3: Create worker.ts**

`startWatchdog()` — reads interval from settings, starts `setInterval`. Each tick:
1. Reads all enabled proxy hosts and streams
2. For each upstream, runs health check
3. Compares with previous status (query latest from `health_checks`)
4. If changed, sends webhook
5. Inserts result into `health_checks`
6. Periodically cleans old records

**Step 4: Integrate into server startup**

Call `startWatchdog()` when the Bun server starts (in `entry.server.ts` or server entry point).

**Step 5: Commit**

```bash
git add web/app/lib/watchdog/
git commit -m "feat: add watchdog with health checks and webhook notifications"
```

---

## Phase 10: Audit Log Integration

### Task 38: Audit Log Middleware

**Files:**
- Create: `web/app/lib/audit/log.ts`

**Step 1: Create log.ts**

```typescript
import { db } from "~/lib/db/connection";
import { auditLog } from "~/lib/db/schema";
import type { TokenPayload } from "~/lib/auth/jwt.server";

export function logAudit(
  user: TokenPayload | null,
  action: "create" | "update" | "delete" | "login" | "logout" | "reload",
  entity: string,
  entityId: number | null,
  details: Record<string, unknown> | null,
  ipAddress: string | null
) {
  db.insert(auditLog)
    .values({
      userId: user?.userId ?? null,
      action,
      entity,
      entityId,
      details,
      ipAddress,
    })
    .run();
}
```

**Step 2:** Integrate `logAudit()` calls into all existing action handlers (proxy hosts, groups, users, settings, SSL, login, logout, reload).

**Step 3: Commit**

```bash
git add web/app/lib/audit/
git commit -m "feat: add audit logging to all mutation actions"
```

---

## Phase 11: Docker & Deployment

### Task 39: s6-overlay Service Definitions

**Files:**
- Create: `s6/services/pingora/type`
- Create: `s6/services/pingora/run`
- Create: `s6/services/web/type`
- Create: `s6/services/web/run`
- Create: `s6/services/web/dependencies.d/pingora`

**Step 1: Create s6 service files**

`s6/services/pingora/type`:
```
longrun
```

`s6/services/pingora/run`:
```bash
#!/command/execlineb -P
/usr/local/bin/pingora-manager-proxy -c /data/configs/global.yaml
```

`s6/services/web/type`:
```
longrun
```

`s6/services/web/run`:
```bash
#!/command/execlineb -P
cd /app/web
bun run build/server/index.js
```

`s6/services/web/dependencies.d/pingora`:
(empty file — indicates web depends on pingora)

**Step 2: Commit**

```bash
git add s6/
git commit -m "feat: add s6-overlay service definitions"
```

---

### Task 40: Multi-Stage Dockerfile

**Files:**
- Create: `Dockerfile`

**Step 1: Create Dockerfile**

```dockerfile
# ─── Stage 1: Build Rust proxy ───────────────────────────
FROM rust:1.82-bookworm AS build-proxy
WORKDIR /build
COPY proxy/ ./
RUN cargo build --release

# ─── Stage 2: Build Bun web app ──────────────────────────
FROM oven/bun:1 AS build-web
WORKDIR /build
COPY web/package.json web/bun.lock* ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# ─── Stage 3: Runtime ────────────────────────────────────
FROM debian:bookworm-slim

# Install s6-overlay
ARG S6_OVERLAY_VERSION=3.1.6.2
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz /tmp
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz

# Install Bun runtime
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates logrotate curl && \
    rm -rf /var/lib/apt/lists/*

# Copy built artifacts
COPY --from=build-proxy /build/target/release/pingora-manager-proxy /usr/local/bin/
COPY --from=build-web /build/build /app/web/build
COPY --from=build-web /build/node_modules /app/web/node_modules
COPY --from=build-web /build/package.json /app/web/

# Copy s6 service definitions
COPY s6/services /etc/s6-overlay/s6-rc.d/

# Create data directories
RUN mkdir -p /data/configs /data/logs /data/error-pages/global \
    /data/default-page /data/ssl/custom /etc/letsencrypt

# Default error pages
COPY web/public/default-error-pages/ /data/error-pages/global/

EXPOSE 80 81 443

ENV NODE_ENV=production
ENV DB_PATH=/data/db.sqlite
ENV CONFIGS_DIR=/data/configs

ENTRYPOINT ["/init"]
```

**Step 2: Commit**

```bash
git add Dockerfile
git commit -m "feat: add multi-stage Dockerfile with s6-overlay"
```

---

### Task 41: Docker Compose File

**Files:**
- Create: `docker-compose.yml`

**Step 1: Create docker-compose.yml**

```yaml
services:
  pingora-manager:
    build: .
    # image: hardskilled/pingora-manager:latest
    restart: unless-stopped
    ports:
      - "80:80"
      - "81:81"
      - "443:443"
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
      # Mount static files directories as needed:
      # - /path/to/static:/var/static
    environment:
      - JWT_SECRET=change-me-to-a-random-secret-at-least-32-chars
```

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose.yml"
```

---

## Phase 12: ACME / Let's Encrypt Integration

### Task 42: ACME Client Module

**Files:**
- Create: `web/app/lib/acme/client.ts`

**Step 1: Install acme-client**

```bash
cd web && bun add acme-client
```

**Step 2: Implement ACME client**

Create functions for:
- `requestCertificate(domains: string[])` — initiates HTTP-01 challenge
- `renewCertificate(certPath: string)` — renews existing cert
- Challenge token storage (write to a temp directory that Pingora serves at `/.well-known/acme-challenge/`)
- Certificate storage to `/etc/letsencrypt/live/{domain}/`

**Step 3: Add auto-renewal to watchdog**

In the watchdog worker, check all LE certs every 12 hours. Renew if expiring within 30 days.

**Step 4: Commit**

```bash
git add web/app/lib/acme/
git commit -m "feat: add Let's Encrypt ACME client with auto-renewal"
```

---

## Phase 13: Default Error Pages & Polish

### Task 43: Built-in Default Error Pages

**Files:**
- Create: `web/public/default-error-pages/404.html`
- Create: `web/public/default-error-pages/502.html`
- Create: `web/public/default-error-pages/503.html`

Simple, clean HTML pages with Pingora Manager branding. Minimal CSS inline. Show error code, message, and timestamp.

**Commit:** `feat: add built-in default error pages`

---

### Task 44: Default Welcome Page

**Files:**
- Create: `web/public/default-page/index.html`

Landing page shown for unconfigured domains. "Welcome to Pingora Manager. Configure this domain in the admin panel at port 81."

**Commit:** `feat: add default welcome page`

---

## Phase 14: Integration Testing

### Task 45: Test Docker Build

**Step 1: Build the Docker image**

```bash
docker build -t pingora-manager:test .
```

**Step 2: Run the container**

```bash
docker run -d --name pm-test -p 8080:80 -p 8081:81 -p 8443:443 \
  -e JWT_SECRET=test-secret-at-least-32-characters-long \
  pingora-manager:test
```

**Step 3: Verify admin UI**

```bash
curl http://localhost:8081
```

Expected: Login page HTML.

**Step 4: Verify proxy**

```bash
curl http://localhost:8080
```

Expected: Default welcome page.

**Step 5: Login and create a proxy host via UI**

Navigate to `http://localhost:8081`, login with `admin@example.com` / `changeme`, create a proxy host.

**Step 6: Clean up**

```bash
docker rm -f pm-test
```

**Step 7: Commit any fixes**

```bash
git commit -am "fix: integration test fixes"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-3 | Project scaffolding (git, Rust, Remix) |
| 2 | 4-5 | Database schema and seeding |
| 3 | 6-7 | Authentication (JWT, login page) |
| 4 | 8-9 | Admin layout, sidebar, dashboard |
| 5 | 10-11 | Proxy hosts CRUD (core feature) |
| 6 | 12-13 | Config generator + Pingora reload |
| 7 | 14-22 | Pingora proxy server (Rust) — all modules |
| 8 | 23-36 | Remaining admin UI pages (14 pages) |
| 9 | 37 | Watchdog + webhooks |
| 10 | 38 | Audit log integration |
| 11 | 39-41 | Docker + s6-overlay + compose |
| 12 | 42 | Let's Encrypt ACME |
| 13 | 43-44 | Default pages |
| 14 | 45 | Integration testing |

**Total: 45 tasks across 14 phases.**

Critical path: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 11 → Phase 14. Phases 8-10, 12-13 can be parallelized after Phase 6.
