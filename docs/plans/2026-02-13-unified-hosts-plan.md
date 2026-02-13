# Unified Hosts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace separate Proxy Hosts, Redirections, Streams, and Groups sections with a single unified Hosts section that supports 4 host types (proxy, static, redirect, stream), labels, fuzzy search, and grouped/flat view modes.

**Architecture:** Merge 3 database tables (`proxy_hosts`, `redirections`, `streams`) into one `hosts` table with a `type` field. Add `host_labels` and `host_label_assignments` tables for colored tags. Build new unified UI with type selector, reusing existing form sub-components. Config generator outputs the same YAML formats so the Rust proxy requires zero changes.

**Tech Stack:** React 19, React Router 7, Drizzle ORM, SQLite, Tailwind CSS 4, Fuse.js (new), Bun runtime

---

## Task 1: Database Schema — New tables

**Files:**
- Modify: `web/app/lib/db/schema.ts`

**Step 1: Replace the proxyHosts, redirections, and streams tables with a unified hosts table**

In `web/app/lib/db/schema.ts`, replace the three table definitions (lines 34–127) with:

```typescript
// ─── Hosts (unified) ────────────────────────────────────
export const hosts = sqliteTable("hosts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["proxy", "static", "redirect", "stream"] })
    .notNull()
    .default("proxy"),
  groupId: integer("group_id").references(() => hostGroups.id, { onDelete: "set null" }),
  domains: text("domains", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

  // SSL (shared by proxy, static, redirect)
  sslType: text("ssl_type", { enum: ["none", "letsencrypt", "custom"] })
    .notNull()
    .default("none"),
  sslForceHttps: integer("ssl_force_https", { mode: "boolean" })
    .notNull()
    .default(false),
  sslCertPath: text("ssl_cert_path"),
  sslKeyPath: text("ssl_key_path"),

  // Proxy fields
  upstreams: text("upstreams", { mode: "json" })
    .$type<Array<{ server: string; port: number; weight: number }>>()
    .notNull()
    .default([]),
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

  // Static fields
  staticDir: text("static_dir"),
  cacheExpires: text("cache_expires"),

  // Redirect fields
  forwardScheme: text("forward_scheme"),
  forwardDomain: text("forward_domain"),
  forwardPath: text("forward_path").default("/"),
  preservePath: integer("preserve_path", { mode: "boolean" }).notNull().default(true),
  statusCode: integer("status_code").default(301),

  // Stream fields
  incomingPort: integer("incoming_port"),
  protocol: text("protocol", { enum: ["tcp", "udp"] }),

  // Common
  webhookUrl: text("webhook_url"),
  advancedYaml: text("advanced_yaml"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Host Labels ────────────────────────────────────────
export const hostLabels = sqliteTable("host_labels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Host Label Assignments ─────────────────────────────
export const hostLabelAssignments = sqliteTable("host_label_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  labelId: integer("label_id")
    .notNull()
    .references(() => hostLabels.id, { onDelete: "cascade" }),
});
```

**Step 2: Update healthChecks hostType enum**

In the same file, update the `healthChecks` table's `hostType` enum to include all types:

```typescript
hostType: text("host_type", { enum: ["proxy", "stream", "static", "redirect"] })
  .notNull()
  .default("proxy"),
```

**Step 3: Commit**

```bash
git add web/app/lib/db/schema.ts
git commit -m "feat: replace proxy_hosts/redirections/streams with unified hosts table schema"
```

---

## Task 2: Database Migration

**Files:**
- Create: `web/drizzle/0001_unified_hosts.sql`

**Step 1: Generate the migration**

```bash
cd /home/roman/Projects/hardskilled/pingora-manager/web && npx drizzle-kit generate
```

This will produce a new migration SQL file. Since drizzle-kit may generate a drop+create approach, we need to ensure data is migrated. Review the generated SQL, then modify or replace the migration file to include data migration logic.

**Step 2: Verify the generated migration includes data migration**

The migration should:
1. Create `hosts`, `host_labels`, `host_label_assignments` tables
2. Copy `proxy_hosts` rows into `hosts` with `type='proxy'`
3. Copy `redirections` rows into `hosts` with `type='redirect'`
4. Copy `streams` rows into `hosts` with `type='stream'`
5. Drop old tables

If drizzle-kit generates a destructive migration, manually write the SQL migration to preserve data. The migration SQL should look like:

```sql
-- Create new tables
CREATE TABLE `hosts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `type` text DEFAULT 'proxy' NOT NULL,
  `group_id` integer REFERENCES `host_groups`(`id`) ON DELETE set null,
  `domains` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `ssl_type` text DEFAULT 'none' NOT NULL,
  `ssl_force_https` integer DEFAULT false NOT NULL,
  `ssl_cert_path` text,
  `ssl_key_path` text,
  `upstreams` text DEFAULT '[]' NOT NULL,
  `balance_method` text DEFAULT 'round_robin' NOT NULL,
  `locations` text DEFAULT '[]',
  `hsts` integer DEFAULT true NOT NULL,
  `http2` integer DEFAULT true NOT NULL,
  `static_dir` text,
  `cache_expires` text,
  `forward_scheme` text,
  `forward_domain` text,
  `forward_path` text DEFAULT '/',
  `preserve_path` integer DEFAULT true NOT NULL,
  `status_code` integer DEFAULT 301,
  `incoming_port` integer,
  `protocol` text,
  `webhook_url` text,
  `advanced_yaml` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `host_labels` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `color` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE TABLE `host_label_assignments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `host_id` integer NOT NULL REFERENCES `hosts`(`id`) ON DELETE cascade,
  `label_id` integer NOT NULL REFERENCES `host_labels`(`id`) ON DELETE cascade
);

-- Migrate proxy_hosts data
INSERT INTO `hosts` (
  `type`, `group_id`, `domains`, `enabled`,
  `ssl_type`, `ssl_force_https`, `ssl_cert_path`, `ssl_key_path`,
  `upstreams`, `balance_method`, `locations`, `hsts`, `http2`,
  `webhook_url`, `advanced_yaml`, `created_at`, `updated_at`
)
SELECT
  'proxy', `group_id`, `domains`, `enabled`,
  `ssl_type`, `ssl_force_https`, `ssl_cert_path`, `ssl_key_path`,
  `upstreams`, `balance_method`, `locations`, `hsts`, `http2`,
  `webhook_url`, `advanced_yaml`, `created_at`, `updated_at`
FROM `proxy_hosts`;

-- Migrate redirections data
INSERT INTO `hosts` (
  `type`, `group_id`, `domains`, `enabled`,
  `ssl_type`, `forward_scheme`, `forward_domain`, `forward_path`,
  `preserve_path`, `status_code`, `created_at`, `updated_at`
)
SELECT
  'redirect', `group_id`, `domains`, `enabled`,
  `ssl_type`, `forward_scheme`, `forward_domain`, `forward_path`,
  `preserve_path`, `status_code`, `created_at`, `created_at`
FROM `redirections`;

-- Migrate streams data
INSERT INTO `hosts` (
  `type`, `group_id`, `domains`, `enabled`,
  `incoming_port`, `protocol`, `upstreams`, `balance_method`,
  `webhook_url`, `created_at`, `updated_at`
)
SELECT
  'stream', `group_id`, '[]', `enabled`,
  `incoming_port`, `protocol`, `upstreams`, `balance_method`,
  `webhook_url`, `created_at`, `created_at`
FROM `streams`;

-- Drop old tables
DROP TABLE `proxy_hosts`;
DROP TABLE `redirections`;
DROP TABLE `streams`;
```

**Step 3: Commit**

```bash
git add web/drizzle/
git commit -m "feat: add migration to unify proxy_hosts, redirections, streams into hosts table"
```

---

## Task 3: Install Fuse.js dependency

**Step 1: Install**

```bash
cd /home/roman/Projects/hardskilled/pingora-manager/web && bun add fuse.js
```

**Step 2: Commit**

```bash
git add web/package.json web/bun.lock
git commit -m "feat: add fuse.js for fuzzy search"
```

---

## Task 4: Config Generator — Read from unified hosts table

**Files:**
- Modify: `web/app/lib/config-generator/generate.ts`

**Step 1: Rewrite generate.ts to use unified hosts table**

Replace the entire file content with:

```typescript
import { stringify } from "yaml";
import { db } from "~/lib/db/connection";
import {
  hosts,
  accessLists,
  accessListClients,
  accessListAuth,
  settings,
} from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";

const CONFIGS_DIR = process.env.CONFIGS_DIR || "/data/configs";

export function generateAllConfigs() {
  mkdirSync(CONFIGS_DIR, { recursive: true });

  // Clean old host/redirect/stream configs
  try {
    const files = readdirSync(CONFIGS_DIR);
    for (const f of files) {
      if (f.startsWith("host-") || f.startsWith("redirect-") || f.startsWith("stream-")) {
        unlinkSync(join(CONFIGS_DIR, f));
      }
    }
  } catch {}

  generateGlobalConfig();
  generateAccessListsConfig();

  const allHosts = db.select().from(hosts).all();
  for (const host of allHosts) {
    switch (host.type) {
      case "proxy":
        generateProxyHostConfig(host);
        break;
      case "static":
        generateStaticHostConfig(host);
        break;
      case "redirect":
        generateRedirectConfig(host);
        break;
      case "stream":
        generateStreamConfig(host);
        break;
    }
  }
}

export function buildProxyHostConfig(host: typeof hosts.$inferSelect) {
  return {
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
}

function generateProxyHostConfig(host: typeof hosts.$inferSelect) {
  const config = buildProxyHostConfig(host);
  writeFileSync(join(CONFIGS_DIR, `host-${host.id}.yaml`), stringify(config));
}

export function buildStaticHostConfig(host: typeof hosts.$inferSelect) {
  return {
    id: host.id,
    domains: host.domains,
    group_id: host.groupId,
    ssl: {
      type: host.sslType,
      force_https: host.sslForceHttps,
      cert_path: host.sslCertPath,
      key_path: host.sslKeyPath,
    },
    upstreams: [],
    balance_method: "round_robin",
    locations: [
      {
        path: "/",
        matchType: "prefix",
        type: "static",
        staticDir: host.staticDir,
        cacheExpires: host.cacheExpires,
      },
    ],
    hsts: host.hsts,
    http2: host.http2,
    advanced_yaml: host.advancedYaml,
    enabled: host.enabled,
  };
}

function generateStaticHostConfig(host: typeof hosts.$inferSelect) {
  const config = buildStaticHostConfig(host);
  writeFileSync(join(CONFIGS_DIR, `host-${host.id}.yaml`), stringify(config));
}

export function buildRedirectConfig(host: typeof hosts.$inferSelect) {
  return {
    id: host.id,
    domains: host.domains,
    forward_scheme: host.forwardScheme,
    forward_domain: host.forwardDomain,
    forward_path: host.forwardPath,
    preserve_path: host.preservePath,
    status_code: host.statusCode,
    ssl_type: host.sslType,
    enabled: host.enabled,
  };
}

function generateRedirectConfig(host: typeof hosts.$inferSelect) {
  const config = buildRedirectConfig(host);
  writeFileSync(join(CONFIGS_DIR, `redirect-${host.id}.yaml`), stringify(config));
}

export function buildStreamConfig(host: typeof hosts.$inferSelect) {
  return {
    id: host.id,
    incoming_port: host.incomingPort,
    protocol: host.protocol,
    upstreams: host.upstreams,
    balance_method: host.balanceMethod,
    enabled: host.enabled,
  };
}

function generateStreamConfig(host: typeof hosts.$inferSelect) {
  const config = buildStreamConfig(host);
  writeFileSync(join(CONFIGS_DIR, `stream-${host.id}.yaml`), stringify(config));
}

export function removeHostConfig(id: number) {
  try { unlinkSync(join(CONFIGS_DIR, `host-${id}.yaml`)); } catch {}
  try { unlinkSync(join(CONFIGS_DIR, `redirect-${id}.yaml`)); } catch {}
  try { unlinkSync(join(CONFIGS_DIR, `stream-${id}.yaml`)); } catch {}
}

export function buildGlobalConfig(settingsMap: Record<string, string>) {
  return {
    listen: { http: 80, https: 443, admin: 81 },
    admin_upstream: "127.0.0.1:3001",
    default_page: "/data/default-page/index.html",
    error_pages_dir: "/data/error-pages",
    logs_dir: "/data/logs",
    ssl_dir: "/etc/letsencrypt",
    global_webhook_url: settingsMap["global_webhook_url"] || "",
  };
}

function generateGlobalConfig() {
  const allSettings = db.select().from(settings).all();
  const settingsMap = Object.fromEntries(allSettings.map((s) => [s.key, s.value]));
  const config = buildGlobalConfig(settingsMap);
  writeFileSync(join(CONFIGS_DIR, "global.yaml"), stringify(config));
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
      clients: clients.map((c) => ({ address: c.address, directive: c.directive })),
      auth: auth.map((a) => ({ username: a.username, password: a.password })),
    };
  });
  writeFileSync(join(CONFIGS_DIR, "access-lists.yaml"), stringify(result));
}
```

**Step 2: Commit**

```bash
git add web/app/lib/config-generator/generate.ts
git commit -m "feat: update config generator to read from unified hosts table"
```

---

## Task 5: Sidebar Navigation

**Files:**
- Modify: `web/app/components/Sidebar.tsx`

**Step 1: Update navSections**

Replace the "Proxy" section (lines 58-66) with:

```typescript
  {
    title: "Proxy",
    items: [
      { to: "/admin/hosts", label: "Hosts", icon: Globe },
    ],
  },
```

Remove the Static Dirs item from Configuration section (line 74). The Configuration section becomes:

```typescript
  {
    title: "Configuration",
    items: [
      { to: "/admin/ssl", label: "SSL Certificates", icon: ShieldCheck },
      { to: "/admin/access-lists", label: "Access Lists", icon: Lock },
      { to: "/admin/error-pages", label: "Error Pages", icon: AlertTriangle },
      { to: "/admin/default-page", label: "Default Page", icon: FileText },
    ],
  },
```

Remove unused imports: `FolderOpen`, `ArrowRightLeft`, `Radio`, `HardDrive`.

**Step 2: Commit**

```bash
git add web/app/components/Sidebar.tsx
git commit -m "feat: simplify sidebar - merge proxy/redirections/streams/groups into single Hosts entry"
```

---

## Task 6: Route Configuration

**Files:**
- Modify: `web/app/routes.ts`

**Step 1: Update routes**

Replace the proxy-hosts, groups, redirections, streams, static routes with unified hosts routes:

```typescript
// Remove these:
// route("proxy-hosts", ...),
// route("proxy-hosts/new", ...),
// route("proxy-hosts/:id/edit", ...),
// route("groups", ...),
// route("redirections", ...),
// route("streams", ...),
// route("static", ...),

// Add these:
route("hosts", "./routes/admin/hosts/index.tsx"),
route("hosts/new", "./routes/admin/hosts/new.tsx"),
route("hosts/:id/edit", "./routes/admin/hosts/edit.tsx"),
```

**Step 2: Commit**

```bash
git add web/app/routes.ts
git commit -m "feat: update routes for unified hosts"
```

---

## Task 7: Labels Modal Component

**Files:**
- Create: `web/app/components/LabelsModal.tsx`

**Step 1: Create labels CRUD modal**

This component manages creating, editing, and deleting labels. It is used from both the hosts page and the host form.

```typescript
import { useFetcher } from "react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { cn } from "~/lib/utils";

const LABEL_COLORS = [
  { value: "green", bg: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  { value: "yellow", bg: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  { value: "blue", bg: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  { value: "red", bg: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  { value: "purple", bg: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  { value: "orange", bg: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  { value: "pink", bg: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200" },
  { value: "gray", bg: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" },
];

export { LABEL_COLORS };

export interface LabelItem {
  id: number;
  name: string;
  color: string;
}

interface LabelsModalProps {
  open: boolean;
  onClose: () => void;
  labels: LabelItem[];
  actionUrl: string;
}

export function LabelsModal({ open, onClose, labels, actionUrl }: LabelsModalProps) {
  const fetcher = useFetcher();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("green");

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setColor("green");
  };

  const startEdit = (label: LabelItem) => {
    setEditingId(label.id);
    setName(label.name);
    setColor(label.color);
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Label name is required");
      return;
    }
    fetcher.submit(
      {
        intent: editingId ? "updateLabel" : "createLabel",
        ...(editingId ? { id: String(editingId) } : {}),
        name: name.trim(),
        color,
      },
      { method: "post", action: actionUrl }
    );
    resetForm();
  };

  const handleDelete = (id: number) => {
    fetcher.submit(
      { intent: "deleteLabel", id: String(id) },
      { method: "post", action: actionUrl }
    );
  };

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Labels</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Label list */}
          <div className="space-y-2">
            {labels.map((label) => (
              <div key={label.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    "px-2 py-1 rounded text-xs font-medium flex-1",
                    LABEL_COLORS.find((c) => c.value === label.color)?.bg
                  )}
                >
                  {label.name}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(label)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(label.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {labels.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">No labels yet</p>
            )}
          </div>

          {/* Add/edit form */}
          <div className="border-t pt-4 space-y-3">
            <div>
              <Label className="text-xs mb-1">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Backend"
              />
            </div>
            <div>
              <Label className="text-xs mb-1">Color</Label>
              <div className="flex gap-2 flex-wrap">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={cn(
                      "px-3 py-1 rounded text-xs font-medium border-2 transition-colors",
                      c.bg,
                      color === c.value ? "border-foreground" : "border-transparent"
                    )}
                  >
                    {c.value}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave}>
                {editingId ? "Update" : "Add"} Label
              </Button>
              {editingId && (
                <Button size="sm" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function getLabelColorClass(color: string): string {
  return LABEL_COLORS.find((c) => c.value === color)?.bg ?? LABEL_COLORS[7].bg;
}
```

**Step 2: Commit**

```bash
git add web/app/components/LabelsModal.tsx
git commit -m "feat: add LabelsModal component for label CRUD"
```

---

## Task 8: Groups Modal Component

**Files:**
- Create: `web/app/components/GroupsModal.tsx`

**Step 1: Create groups CRUD modal**

Extract the groups modal from `web/app/routes/admin/groups.tsx` into a reusable component:

```typescript
import { useFetcher } from "react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";

export interface GroupItem {
  id: number;
  name: string;
  description: string | null;
  webhookUrl: string | null;
  hostCount: number;
}

interface GroupsModalProps {
  open: boolean;
  onClose: () => void;
  groups: GroupItem[];
  actionUrl: string;
}

export function GroupsModal({ open, onClose, groups, actionUrl }: GroupsModalProps) {
  const fetcher = useFetcher();
  const [editingGroup, setEditingGroup] = useState<GroupItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");

  const resetForm = () => {
    setEditingGroup(null);
    setShowForm(false);
    setName("");
    setDescription("");
    setWebhookUrl("");
  };

  const startEdit = (group: GroupItem) => {
    setEditingGroup(group);
    setShowForm(true);
    setName(group.name);
    setDescription(group.description ?? "");
    setWebhookUrl(group.webhookUrl ?? "");
  };

  const startCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Group name is required");
      return;
    }
    if (webhookUrl && !/^https?:\/\/.+/.test(webhookUrl)) {
      toast.error("Webhook URL must be a valid HTTP/HTTPS URL");
      return;
    }
    fetcher.submit(
      {
        intent: editingGroup ? "updateGroup" : "createGroup",
        ...(editingGroup ? { id: String(editingGroup.id) } : {}),
        name: name.trim(),
        description,
        webhookUrl,
      },
      { method: "post", action: actionUrl }
    );
    resetForm();
  };

  const handleDelete = (id: number) => {
    fetcher.submit(
      { intent: "deleteGroup", id: String(id) },
      { method: "post", action: actionUrl }
    );
  };

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Groups</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Group list */}
          <div className="space-y-2">
            {groups.map((group) => (
              <div key={group.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="font-medium text-sm">{group.name}</p>
                  {group.description && (
                    <p className="text-xs text-muted-foreground">{group.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{group.hostCount} hosts</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(group)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(group.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">No groups yet</p>
            )}
          </div>

          {/* Add/edit form */}
          {showForm ? (
            <div className="border-t pt-4 space-y-3">
              <div>
                <Label className="text-xs mb-1">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
              </div>
              <div>
                <Label className="text-xs mb-1">Description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs mb-1">Webhook URL</Label>
                <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave}>
                  {editingGroup ? "Update" : "Create"} Group
                </Button>
                <Button size="sm" variant="outline" onClick={resetForm}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={startCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Group
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Commit**

```bash
git add web/app/components/GroupsModal.tsx
git commit -m "feat: add GroupsModal component for group CRUD"
```

---

## Task 9: Host Form — Unified form component

**Files:**
- Create: `web/app/components/host-form/HostForm.tsx`

**Step 1: Create the unified HostForm**

This is the main form component that wraps type selection, common fields, and type-specific sections. It reuses the existing tab components (UpstreamsTab, LocationsTab, SslTab, AdvancedTab) from the old proxy-host-form directory — those will be moved here.

The form data interface includes ALL fields from all types. Switching type only changes which sections are visible. Data is never lost.

See `docs/plans/2026-02-13-unified-hosts-design.md` for the full field list per type.

Key implementation details:
- `HostFormData` interface includes `type` field plus all proxy/static/redirect/stream fields
- Type selector at top: segmented control with 4 options
- Common section: domains, group, labels, SSL, enabled (always visible)
- Type-specific sections render conditionally
- Form state is a single `useState<HostFormData>` — switching type only changes `formData.type`
- Validation adapts to the selected type
- Hidden input serializes the full formData as JSON (same pattern as current ProxyHostForm)
- Reuse existing components: `SslTab`, `UpstreamsTab`, `LocationsTab`, `AdvancedTab` — copy them into `web/app/components/host-form/`

**Step 2: Copy existing form tab components**

Copy these files from `web/app/components/proxy-host-form/` to `web/app/components/host-form/`:
- `UpstreamsTab.tsx`
- `LocationsTab.tsx`
- `SslTab.tsx`
- `AdvancedTab.tsx`

These files remain unchanged — they are self-contained components with prop-driven interfaces.

**Step 3: Create the new HostForm.tsx**

The form should have this structure:
1. Type selector (segmented control): Proxy / Static / Redirect / Stream
2. Tabs for content:
   - General (domains, group, labels, enabled) — always visible
   - SSL — visible for proxy, static, redirect
   - Type-specific tab name changes:
     - Proxy: "Upstreams" tab + "Locations" tab
     - Static: "Static Files" section within General
     - Redirect: "Redirect" section within General
     - Stream: "Upstreams" tab (reused)
   - Advanced — always visible

**Step 4: Commit**

```bash
git add web/app/components/host-form/
git commit -m "feat: add unified HostForm with type selector and all sub-components"
```

---

## Task 10: Hosts List Page

**Files:**
- Create: `web/app/routes/admin/hosts/index.tsx`

**Step 1: Create the unified hosts list page**

This page replaces proxy-hosts/index, redirections, streams, and groups pages.

Features:
- Loader: fetch all hosts, groups, labels, label assignments from unified tables. Compute host counts per group.
- Action handlers: toggle, delete, createGroup/updateGroup/deleteGroup, createLabel/updateLabel/deleteLabel
- View mode toggle (Groups/All) with `useState`
- Fuzzy search with Fuse.js (client-side)
- Host rows show: type badge, domains, labels, SSL, type-specific info, status, actions
- Groups modal and Labels modal triggered by buttons in the header

Type badge colors:
- proxy → default (blue)
- static → secondary (gray)
- redirect → orange variant
- stream → purple variant

**Step 2: Commit**

```bash
git add web/app/routes/admin/hosts/index.tsx
git commit -m "feat: add unified hosts list page with groups, labels, fuzzy search"
```

---

## Task 11: Host Create Page

**Files:**
- Create: `web/app/routes/admin/hosts/new.tsx`

**Step 1: Create the new host page**

Pattern: same as current `web/app/routes/admin/proxy-hosts/new.tsx` but:
- Loader: fetch groups AND labels
- Action: validates based on `type` field, inserts into `hosts` table, saves label assignments
- Validation rules per type:
  - proxy: at least one domain, upstreams or location upstreams required
  - static: at least one domain, staticDir required
  - redirect: at least one domain, forwardDomain required
  - stream: incomingPort required, at least one upstream
- After save: generateAllConfigs(), reloadPingora(), redirect to /admin/hosts

**Step 2: Commit**

```bash
git add web/app/routes/admin/hosts/new.tsx
git commit -m "feat: add host create page with unified form"
```

---

## Task 12: Host Edit Page

**Files:**
- Create: `web/app/routes/admin/hosts/edit.tsx`

**Step 1: Create the edit host page**

Pattern: same as current `web/app/routes/admin/proxy-hosts/edit.tsx` but:
- Loader: fetch host by id, groups, labels, host's assigned labels
- Action: validates based on type, updates hosts table, syncs label assignments
- Uses same HostForm component with initialData populated from the DB record
- After save: generateAllConfigs(), reloadPingora(), redirect to /admin/hosts

**Step 2: Commit**

```bash
git add web/app/routes/admin/hosts/edit.tsx
git commit -m "feat: add host edit page with unified form"
```

---

## Task 13: Dashboard — Update to use unified hosts table

**Files:**
- Modify: `web/app/routes/admin/dashboard.tsx`

**Step 1: Update imports and queries**

Replace:
```typescript
import { proxyHosts, hostGroups, streams, redirections, healthChecks } from "~/lib/db/schema";
```
With:
```typescript
import { hosts, hostGroups, healthChecks } from "~/lib/db/schema";
import { eq, sql } from "drizzle-orm";
```

Replace the 4 separate count queries with:
```typescript
const allHosts = db.select().from(hosts).all();
const hostCount = allHosts.filter(h => h.type === "proxy").length;
const staticCount = allHosts.filter(h => h.type === "static").length;
const streamCount = allHosts.filter(h => h.type === "stream").length;
const redirectCount = allHosts.filter(h => h.type === "redirect").length;
const groupCount = db.select({ count: sql<number>`count(*)` }).from(hostGroups).get();
```

Update the return and stat cards to show all 4 types.

**Step 2: Commit**

```bash
git add web/app/routes/admin/dashboard.tsx
git commit -m "feat: update dashboard to use unified hosts table"
```

---

## Task 14: Delete old files

**Files:**
- Delete: `web/app/routes/admin/proxy-hosts/index.tsx`
- Delete: `web/app/routes/admin/proxy-hosts/new.tsx`
- Delete: `web/app/routes/admin/proxy-hosts/edit.tsx`
- Delete: `web/app/routes/admin/redirections.tsx`
- Delete: `web/app/routes/admin/streams.tsx`
- Delete: `web/app/routes/admin/groups.tsx`
- Delete: `web/app/routes/admin/static-dirs.tsx`
- Delete: `web/app/components/proxy-host-form/` (entire directory)

**Step 1: Remove the old files**

```bash
rm -rf web/app/routes/admin/proxy-hosts/
rm web/app/routes/admin/redirections.tsx
rm web/app/routes/admin/streams.tsx
rm web/app/routes/admin/groups.tsx
rm web/app/routes/admin/static-dirs.tsx
rm -rf web/app/components/proxy-host-form/
```

**Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove old proxy-hosts, redirections, streams, groups, static-dirs pages"
```

---

## Task 15: Build and verify

**Step 1: Run the build**

```bash
cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run build
```

Expected: Build succeeds with no TypeScript errors.

**Step 2: Fix any build errors**

If there are import errors or type mismatches, fix them. Common issues:
- Old imports of `proxyHosts`, `redirections`, `streams` from schema in other files
- Route type mismatches
- Missing component imports

**Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve build errors after unified hosts migration"
```

---

## Task 16: Final verification and commit

**Step 1: Run tests**

```bash
cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run test
```

**Step 2: Verify the app starts**

```bash
cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run dev
```

Open the browser, navigate to /admin/hosts, verify:
- Hosts list displays correctly
- Groups/All toggle works
- Fuzzy search works
- Can create each host type (proxy, static, redirect, stream)
- Can edit a host and switch type without losing data
- Labels work
- Dashboard shows correct counts

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: unified hosts section complete - proxy/static/redirect/stream in one page"
```
