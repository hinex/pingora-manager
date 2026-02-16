# Location-Centric Hosts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor hosts from type-based to location-centric model, improve domains UX with visible "+" button, and add group combobox with inline creation.

**Architecture:** Remove host-level `type` and type-specific fields. All behavior lives in `locations[]` JSON (proxy/static/redirect per path) and optional `streamPorts[]` JSON. Config generator outputs a single unified `host-{id}.yaml` format. Rust proxy reads redirect rules from locations instead of separate files.

**Tech Stack:** Drizzle ORM (SQLite migration), React 19 + React Router 7, Radix UI, Tailwind CSS 4, Vitest, Rust/Pingora (serde_yaml)

---

### Task 1: Database Migration — Schema Changes

**Files:**
- Create: `web/drizzle/0002_location_centric_hosts.sql`
- Modify: `web/app/lib/db/schema.ts`

**Step 1: Write the migration SQL**

Create `web/drizzle/0002_location_centric_hosts.sql`:

```sql
-- Step 1: Add new column for stream ports
ALTER TABLE `hosts` ADD COLUMN `stream_ports` text DEFAULT '[]';

-- Step 2: Migrate existing data into locations-based format
-- For proxy hosts: move host-level upstreams/balanceMethod into a default location if no locations exist
UPDATE `hosts` SET `locations` = json_array(
  json_object(
    'path', '/',
    'matchType', 'prefix',
    'type', 'proxy',
    'upstreams', json(`upstreams`),
    'balanceMethod', `balance_method`,
    'staticDir', '',
    'cacheExpires', '',
    'forwardScheme', 'https',
    'forwardDomain', '',
    'forwardPath', '/',
    'preservePath', json('true'),
    'statusCode', 301,
    'headers', json_object(),
    'accessListId', null
  )
)
WHERE `type` = 'proxy'
  AND (`locations` IS NULL OR `locations` = '[]' OR `locations` = 'null')
  AND `upstreams` IS NOT NULL AND `upstreams` != '[]';

-- For proxy hosts WITH existing locations: add missing fields to each location
-- (SQLite doesn't have great JSON array iteration, so we handle this in init-db.mjs)

-- For static hosts: convert to a single static location
UPDATE `hosts` SET `locations` = json_array(
  json_object(
    'path', '/',
    'matchType', 'prefix',
    'type', 'static',
    'upstreams', json('[]'),
    'balanceMethod', 'round_robin',
    'staticDir', COALESCE(`static_dir`, ''),
    'cacheExpires', COALESCE(`cache_expires`, ''),
    'forwardScheme', 'https',
    'forwardDomain', '',
    'forwardPath', '/',
    'preservePath', json('true'),
    'statusCode', 301,
    'headers', json_object(),
    'accessListId', null
  )
)
WHERE `type` = 'static';

-- For redirect hosts: convert to a single redirect location
UPDATE `hosts` SET `locations` = json_array(
  json_object(
    'path', '/',
    'matchType', 'prefix',
    'type', 'redirect',
    'upstreams', json('[]'),
    'balanceMethod', 'round_robin',
    'staticDir', '',
    'cacheExpires', '',
    'forwardScheme', COALESCE(`forward_scheme`, 'https'),
    'forwardDomain', COALESCE(`forward_domain`, ''),
    'forwardPath', COALESCE(`forward_path`, '/'),
    'preservePath', CASE WHEN `preserve_path` THEN json('true') ELSE json('false') END,
    'statusCode', COALESCE(`status_code`, 301),
    'headers', json_object(),
    'accessListId', null
  )
)
WHERE `type` = 'redirect';

-- For stream hosts: move to streamPorts, clear locations
UPDATE `hosts` SET
  `stream_ports` = json_array(
    json_object(
      'port', `incoming_port`,
      'protocol', COALESCE(`protocol`, 'tcp'),
      'upstreams', json(`upstreams`),
      'balanceMethod', COALESCE(`balance_method`, 'round_robin')
    )
  ),
  `locations` = '[]'
WHERE `type` = 'stream' AND `incoming_port` IS NOT NULL;
```

**Step 2: Update Drizzle schema**

Modify `web/app/lib/db/schema.ts` — replace the hosts table definition:

```typescript
// Remove the type enum, remove host-level type-specific fields
export const hosts = sqliteTable("hosts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").references(() => hostGroups.id, { onDelete: "set null" }),
  domains: text("domains", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

  // SSL
  sslType: text("ssl_type", { enum: ["none", "letsencrypt", "custom"] })
    .notNull()
    .default("none"),
  sslForceHttps: integer("ssl_force_https", { mode: "boolean" })
    .notNull()
    .default(false),
  sslCertPath: text("ssl_cert_path"),
  sslKeyPath: text("ssl_key_path"),
  hsts: integer("hsts", { mode: "boolean" }).notNull().default(true),
  http2: integer("http2", { mode: "boolean" }).notNull().default(true),

  // Locations (all routing logic lives here)
  locations: text("locations", { mode: "json" })
    .$type<Array<{
      path: string;
      matchType: "prefix" | "exact" | "regex";
      type: "proxy" | "static" | "redirect";
      upstreams: Array<{ server: string; port: number; weight: number }>;
      balanceMethod: string;
      staticDir: string;
      cacheExpires: string;
      forwardScheme: string;
      forwardDomain: string;
      forwardPath: string;
      preservePath: boolean;
      statusCode: number;
      headers: Record<string, string>;
      accessListId: number | null;
    }>>()
    .notNull()
    .default([]),

  // Stream ports (TCP/UDP forwarding, separate from HTTP locations)
  streamPorts: text("stream_ports", { mode: "json" })
    .$type<Array<{
      port: number;
      protocol: "tcp" | "udp";
      upstreams: Array<{ server: string; port: number; weight: number }>;
      balanceMethod: string;
    }>>()
    .default([]),

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
```

**Step 3: Add a data migration script for proxy hosts with existing locations**

Add to `web/init-db.mjs` (after the Drizzle migrate call) a one-time migration that enriches existing location objects with the new fields (balanceMethod, redirect fields, headers, etc.) if they're missing. This handles the case where proxy hosts already had locations with the old schema.

**Step 4: Run migration locally to verify**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run drizzle-kit generate`

Verify the migration file was created and looks correct.

**Step 5: Commit**

```bash
git add web/drizzle/0002_location_centric_hosts.sql web/app/lib/db/schema.ts web/init-db.mjs
git commit -m "feat: add location-centric hosts migration and schema"
```

---

### Task 2: Update Config Generator

**Files:**
- Modify: `web/app/lib/config-generator/generate.ts`
- Modify: `web/app/lib/config-generator/generate.test.ts`

**Step 1: Write failing tests for the new `buildHostConfig` function**

Replace `buildProxyHostConfig`, `buildStaticHostConfig`, `buildRedirectConfig`, `buildStreamConfig` with a single `buildHostConfig` that outputs a unified format:

Add to `generate.test.ts`:

```typescript
describe("buildHostConfig (unified)", () => {
  it("maps a host with proxy locations", () => {
    const host = {
      id: 1,
      groupId: 5,
      domains: ["example.com"],
      sslType: "letsencrypt",
      sslForceHttps: true,
      sslCertPath: "/path/cert.pem",
      sslKeyPath: "/path/key.pem",
      hsts: true,
      http2: true,
      locations: [
        {
          path: "/",
          matchType: "prefix",
          type: "proxy",
          upstreams: [{ server: "10.0.0.1", port: 8080, weight: 1 }],
          balanceMethod: "round_robin",
          staticDir: "",
          cacheExpires: "",
          forwardScheme: "https",
          forwardDomain: "",
          forwardPath: "/",
          preservePath: true,
          statusCode: 301,
          headers: { "X-Custom": "value" },
          accessListId: 2,
        },
      ],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.id).toBe(1);
    expect(cfg.domains).toEqual(["example.com"]);
    expect(cfg.ssl.type).toBe("letsencrypt");
    expect(cfg.locations).toHaveLength(1);
    expect(cfg.locations[0].type).toBe("proxy");
    expect(cfg.locations[0].upstreams).toHaveLength(1);
    expect(cfg.locations[0].headers).toEqual({ "X-Custom": "value" });
    expect(cfg.locations[0].access_list_id).toBe(2);
    expect(cfg.stream_ports).toEqual([]);
  });

  it("maps a host with mixed locations (proxy + static + redirect)", () => {
    const host = {
      id: 2,
      groupId: null,
      domains: ["mysite.com"],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: true,
      locations: [
        {
          path: "/",
          matchType: "prefix",
          type: "proxy",
          upstreams: [{ server: "127.0.0.1", port: 3000, weight: 1 }],
          balanceMethod: "round_robin",
          staticDir: "", cacheExpires: "",
          forwardScheme: "https", forwardDomain: "", forwardPath: "/",
          preservePath: true, statusCode: 301,
          headers: {}, accessListId: null,
        },
        {
          path: "/uploads",
          matchType: "prefix",
          type: "static",
          upstreams: [],
          balanceMethod: "round_robin",
          staticDir: "/var/uploads",
          cacheExpires: "30d",
          forwardScheme: "https", forwardDomain: "", forwardPath: "/",
          preservePath: true, statusCode: 301,
          headers: { "Cache-Control": "max-age=31536000" },
          accessListId: null,
        },
        {
          path: "/old",
          matchType: "exact",
          type: "redirect",
          upstreams: [],
          balanceMethod: "round_robin",
          staticDir: "", cacheExpires: "",
          forwardScheme: "https",
          forwardDomain: "newsite.com",
          forwardPath: "/new",
          preservePath: false,
          statusCode: 301,
          headers: {}, accessListId: null,
        },
      ],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.locations).toHaveLength(3);
    expect(cfg.locations[0].type).toBe("proxy");
    expect(cfg.locations[1].type).toBe("static");
    expect(cfg.locations[1].staticDir).toBe("/var/uploads");
    expect(cfg.locations[1].headers).toEqual({ "Cache-Control": "max-age=31536000" });
    expect(cfg.locations[2].type).toBe("redirect");
    expect(cfg.locations[2].forwardDomain).toBe("newsite.com");
  });

  it("maps a host with stream ports", () => {
    const host = {
      id: 3,
      groupId: null,
      domains: [],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [],
      streamPorts: [
        {
          port: 3306,
          protocol: "tcp",
          upstreams: [{ server: "db.internal", port: 3306, weight: 1 }],
          balanceMethod: "least_conn",
        },
      ],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.stream_ports).toHaveLength(1);
    expect(cfg.stream_ports[0].port).toBe(3306);
    expect(cfg.stream_ports[0].protocol).toBe("tcp");
    expect(cfg.stream_ports[0].upstreams).toHaveLength(1);
    expect(cfg.locations).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run test`

Expected: FAIL — `buildHostConfig` is not exported.

**Step 3: Implement the new config generator**

Replace the type-based build functions in `generate.ts` with a single unified function:

```typescript
export function buildHostConfig(host: typeof hosts.$inferSelect) {
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
    hsts: host.hsts,
    http2: host.http2,
    locations: (host.locations ?? []).map((loc: any) => ({
      path: loc.path,
      matchType: loc.matchType,
      type: loc.type,
      upstreams: loc.upstreams ?? [],
      balanceMethod: loc.balanceMethod ?? "round_robin",
      staticDir: loc.staticDir ?? "",
      cacheExpires: loc.cacheExpires ?? "",
      forwardScheme: loc.forwardScheme ?? "https",
      forwardDomain: loc.forwardDomain ?? "",
      forwardPath: loc.forwardPath ?? "/",
      preservePath: loc.preservePath ?? true,
      statusCode: loc.statusCode ?? 301,
      headers: loc.headers ?? {},
      access_list_id: loc.accessListId ?? null,
    })),
    stream_ports: (host.streamPorts ?? []).map((sp: any) => ({
      port: sp.port,
      protocol: sp.protocol ?? "tcp",
      upstreams: sp.upstreams ?? [],
      balance_method: sp.balanceMethod ?? "round_robin",
    })),
    advanced_yaml: host.advancedYaml,
    enabled: host.enabled,
  };
}
```

Update `generateAllConfigs()` to iterate all hosts and call `buildHostConfig` for each, writing to `host-{id}.yaml`. Remove the switch on `host.type`. Remove the separate `generateRedirectConfig` and `generateStreamConfig` functions. Remove old `buildProxyHostConfig`, `buildStaticHostConfig`, `buildRedirectConfig`, `buildStreamConfig`.

Update `removeHostConfig` to only remove `host-{id}.yaml` (no more redirect-/stream- prefixes).

**Step 4: Update old tests to match new function names**

Remove tests for `buildProxyHostConfig`, `buildStaticHostConfig`, `buildRedirectConfig`, `buildStreamConfig`. Keep edge case tests adapted to `buildHostConfig`.

**Step 5: Run tests to verify they pass**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run test`

Expected: All tests PASS.

**Step 6: Commit**

```bash
git add web/app/lib/config-generator/generate.ts web/app/lib/config-generator/generate.test.ts
git commit -m "feat: unified buildHostConfig replacing type-based config builders"
```

---

### Task 3: Update HostForm Data Model and LocationsTab

**Files:**
- Modify: `web/app/components/host-form/HostForm.tsx`
- Modify: `web/app/components/host-form/LocationsTab.tsx`
- Delete: `web/app/components/host-form/UpstreamsTab.tsx`

**Step 1: Update HostFormData interface**

In `HostForm.tsx`, replace `HostFormData` with the new shape — remove `type`, `upstreams`, `balanceMethod`, `staticDir`, `cacheExpires`, `forwardScheme`, `forwardDomain`, `forwardPath`, `preservePath`, `statusCode`, `incomingPort`, `protocol`. Add `streamPorts`.

New interface:

```typescript
export interface LocationFormData {
  path: string;
  matchType: "prefix" | "exact" | "regex";
  type: "proxy" | "static" | "redirect";
  upstreams: Array<{ server: string; port: number; weight: number }>;
  balanceMethod: string;
  staticDir: string;
  cacheExpires: string;
  forwardScheme: string;
  forwardDomain: string;
  forwardPath: string;
  preservePath: boolean;
  statusCode: number;
  headers: Record<string, string>;
  accessListId: number | null;
}

export interface StreamPortFormData {
  port: number | null;
  protocol: "tcp" | "udp";
  upstreams: Array<{ server: string; port: number; weight: number }>;
  balanceMethod: string;
}

export interface HostFormData {
  domains: string[];
  groupId: number | null;
  enabled: boolean;
  labelIds: number[];

  // SSL
  sslType: string;
  sslCertPath: string;
  sslKeyPath: string;
  sslForceHttps: boolean;
  hsts: boolean;
  http2: boolean;

  // Locations (all routing)
  locations: LocationFormData[];

  // Stream ports (optional TCP/UDP)
  streamPorts: StreamPortFormData[];

  // Common
  webhookUrl: string;
  advancedYaml: string;
}
```

Default for new host — one empty proxy location pre-populated:

```typescript
const defaultLocation: LocationFormData = {
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

const defaultFormData: HostFormData = {
  domains: [],
  groupId: null,
  enabled: true,
  labelIds: [],
  sslType: "none",
  sslCertPath: "",
  sslKeyPath: "",
  sslForceHttps: false,
  hsts: true,
  http2: true,
  locations: [{ ...defaultLocation }],
  streamPorts: [],
  webhookUrl: "",
  advancedYaml: "",
};
```

**Step 2: Update HostForm component**

Remove the host type selector buttons. Update tabs:
- General (always)
- Locations (always)
- SSL (show if domains.length > 0)
- Advanced (always, includes stream ports section)

Remove the Upstreams tab import and rendering. Remove all type-conditional rendering in General tab (stream port fields, static dir fields, redirect fields — all moved into locations).

**Step 3: Update LocationsTab with full location editing**

Rewrite `LocationsTab.tsx` to support all three location types with full inline editing:

Each location card (collapsed) shows a compact summary line:
- Path, match type, type, and type-specific info
- Delete button

Each location card (expanded) shows:
- Row 1: Path input + Match Type select + Type select (proxy/static/redirect)
- Type-specific section:
  - **Proxy**: upstreams list with Add/Remove, balance method
  - **Static**: directory path, cache expires
  - **Redirect**: scheme, domain, path, preservePath, statusCode
- Headers section: key-value table with Add/Remove
- Access List dropdown (from existing access lists)

Pass `accessLists` prop to LocationsTab (load from route loader).

**Step 4: Delete UpstreamsTab.tsx**

Remove `web/app/components/host-form/UpstreamsTab.tsx` — upstreams now live inside each location.

**Step 5: Update AdvancedTab with stream ports**

Add a "Stream Ports" section to `AdvancedTab.tsx` with:
- List of stream port entries
- Each entry: port number, protocol (tcp/udp), upstreams list, balance method
- Add/Remove buttons

**Step 6: Verify form renders without errors**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run build`

Expected: Build succeeds without TypeScript errors.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: location-centric HostForm with inline editing per location type"
```

---

### Task 4: Domains UX — Input + Add Button

**Files:**
- Modify: `web/app/components/host-form/HostForm.tsx`

**Step 1: Update domains input section**

Replace the current Enter-only pattern in the General tab with input + visible "+" button:

```tsx
{/* Domains */}
<div>
  <Label className="mb-1">Domains</Label>
  <div className="flex flex-wrap gap-2 mb-2">
    {formData.domains.map((domain, index) => (
      <Badge key={index} variant="secondary" className="gap-1">
        {domain}
        <button type="button" onClick={() => removeDomain(index)}>
          <X className="h-3 w-3" />
        </button>
      </Badge>
    ))}
  </div>
  <div className="flex gap-2">
    <Input
      type="text"
      value={domainInput}
      onChange={(e) => setDomainInput(e.target.value)}
      onKeyDown={handleAddDomain}
      placeholder="example.com"
      className="flex-1"
    />
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={addDomainFromInput}
      disabled={!domainInput.trim()}
    >
      <Plus className="h-4 w-4" />
    </Button>
  </div>
</div>
```

Add the `addDomainFromInput` function:

```typescript
const addDomainFromInput = () => {
  const value = domainInput.trim();
  if (value && !formData.domains.includes(value)) {
    update({ domains: [...formData.domains, value] });
    setDomainInput("");
  }
};
```

Remove the old helper text "Press Enter to add each domain".

**Step 2: Verify visually**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run dev`

Check `/admin/hosts/new` — domains input should have a "+" button.

**Step 3: Commit**

```bash
git add web/app/components/host-form/HostForm.tsx
git commit -m "feat: add visible '+' button for domains input"
```

---

### Task 5: Groups Combobox with Inline Creation

**Files:**
- Create: `web/app/components/host-form/GroupCombobox.tsx`
- Modify: `web/app/components/host-form/HostForm.tsx`
- Modify: `web/app/routes/admin/hosts/new.tsx` (action to handle createGroup intent)
- Modify: `web/app/routes/admin/hosts/edit.tsx` (action to handle createGroup intent)
- Modify: `web/app/routes/admin/hosts/index.tsx` (empty state)

**Step 1: Create GroupCombobox component**

Create `web/app/components/host-form/GroupCombobox.tsx`:

A combobox (using Radix Popover + Command or custom implementation) that:
- Shows selected group name (or "No group" placeholder)
- Opens dropdown with search input
- Filters existing groups by typed text
- Shows "+ Create [typed text]" option when no exact match
- Calls onCreateGroup callback when "Create" is clicked
- Has "×" button to clear selection

Props:
```typescript
interface GroupComboboxProps {
  groups: Array<{ id: number; name: string }>;
  value: number | null;
  onChange: (groupId: number | null) => void;
  onCreateGroup: (name: string) => Promise<number>; // returns new group id
}
```

Implementation: Use a Popover with an input for filtering and a scrollable list of groups. At the bottom, show the create option if the search text doesn't exactly match an existing group name.

**Step 2: Wire GroupCombobox into HostForm**

Replace the `<select>` for Group in HostForm.tsx General tab with `<GroupCombobox>`.

For `onCreateGroup`, use a fetcher to POST to the current route with `intent: "createGroup"` and `name`. The route action must handle this intent and return the new group ID.

**Step 3: Add createGroup intent to new.tsx and edit.tsx actions**

Add group creation handling to both route actions:

```typescript
if (intent === "createGroup") {
  const name = formData.get("name") as string;
  if (!name?.trim()) return { error: "Group name is required" };
  const result = db.insert(hostGroups)
    .values({ name: name.trim(), createdAt: new Date() })
    .returning()
    .get();
  return { groupId: result.id };
}
```

**Step 4: Improve Groups empty state on hosts list**

In `hosts/index.tsx`, update the GroupedHostsView to show a better empty state when there are no groups:

```tsx
{groups.length === 0 && filteredHosts.length > 0 && (
  <div className="rounded-md border border-dashed p-6 text-center">
    <p className="text-sm text-muted-foreground">
      Organize your hosts into groups when creating or editing a host.
    </p>
  </div>
)}
```

When all hosts are ungrouped, skip the "Ungrouped" section header and show a flat table.

**Step 5: Verify**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run build`

Check no TypeScript errors.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: group combobox with inline creation on host form"
```

---

### Task 6: Update Create/Edit Route Actions (Validation)

**Files:**
- Modify: `web/app/routes/admin/hosts/new.tsx`
- Modify: `web/app/routes/admin/hosts/edit.tsx`

**Step 1: Rewrite validation logic**

Replace type-based validation with location-based validation:

```typescript
// Domains required if host has HTTP locations
const hasHttpLocations = data.locations.some(l => ["proxy", "static", "redirect"].includes(l.type));
if (hasHttpLocations && (!data.domains || data.domains.length === 0)) {
  return { error: "At least one domain is required for HTTP locations" };
}

// Must have at least one location or stream port
if (data.locations.length === 0 && data.streamPorts.length === 0) {
  return { error: "At least one location or stream port is required" };
}

// Validate each location
for (const loc of data.locations) {
  if (loc.type === "proxy") {
    if (!loc.upstreams || loc.upstreams.length === 0) {
      return { error: `Proxy location "${loc.path}" needs at least one upstream` };
    }
    for (const u of loc.upstreams) {
      if (!u.server?.trim()) return { error: "All upstreams must have a server address" };
      if (!u.port || u.port < 1 || u.port > 65535) return { error: "Upstream port must be 1-65535" };
    }
  }
  if (loc.type === "static") {
    if (!loc.staticDir?.trim()) return { error: `Static location "${loc.path}" needs a directory path` };
  }
  if (loc.type === "redirect") {
    if (!loc.forwardDomain?.trim()) return { error: `Redirect location "${loc.path}" needs a forward domain` };
  }
}

// Validate stream ports
for (const sp of data.streamPorts) {
  if (!sp.port || sp.port < 1 || sp.port > 65535) {
    return { error: "Stream port must be 1-65535" };
  }
  if (!sp.upstreams || sp.upstreams.length === 0) {
    return { error: `Stream port ${sp.port} needs at least one upstream` };
  }
}
```

**Step 2: Update DB insert/update to new schema**

Replace the insert/update calls — remove old fields (`type`, `upstreams`, `balanceMethod`, `staticDir`, etc.), add `streamPorts`:

```typescript
const result = db.insert(hosts)
  .values({
    domains: data.domains,
    groupId: data.groupId,
    enabled: data.enabled,
    sslType: data.sslType as any,
    sslForceHttps: data.sslForceHttps,
    sslCertPath: data.sslCertPath || null,
    sslKeyPath: data.sslKeyPath || null,
    hsts: data.hsts,
    http2: data.http2,
    locations: data.locations as any,
    streamPorts: data.streamPorts as any,
    webhookUrl: data.webhookUrl || null,
    advancedYaml: data.advancedYaml || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .returning()
  .get();
```

**Step 3: Update edit.tsx loader to map to new initialData shape**

```typescript
const initialData: Partial<HostFormData> = {
  domains: host.domains as string[],
  groupId: host.groupId,
  enabled: host.enabled,
  labelIds: assignedLabelIds,
  sslType: host.sslType,
  sslCertPath: host.sslCertPath || "",
  sslKeyPath: host.sslKeyPath || "",
  sslForceHttps: host.sslForceHttps,
  hsts: host.hsts,
  http2: host.http2,
  locations: host.locations as any,
  streamPorts: host.streamPorts as any ?? [],
  webhookUrl: host.webhookUrl || "",
  advancedYaml: host.advancedYaml || "",
};
```

**Step 4: Load access lists in route loaders**

Both `new.tsx` and `edit.tsx` loaders need to also load access lists and pass them to HostForm, so LocationsTab can show the access list dropdown.

```typescript
const allAccessLists = db.select().from(accessLists).all();
return { groups, labels, accessLists: allAccessLists };
```

Pass `accessLists` prop to HostForm → LocationsTab.

**Step 5: Run build**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run build`

Expected: Build succeeds.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: update host create/edit routes for location-centric model"
```

---

### Task 7: Update Hosts List Page

**Files:**
- Modify: `web/app/routes/admin/hosts/index.tsx`

**Step 1: Update HostRow info column**

Replace `getTypeBadge` and `getTypeInfo` with derived display logic:

```typescript
function getHostTypeBadge(host: HostRecord) {
  const locationTypes = new Set((host.locations as any[] ?? []).map((l: any) => l.type));
  const hasStreams = (host.streamPorts as any[] ?? []).length > 0;

  if (locationTypes.size === 0 && hasStreams) return <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">Stream</Badge>;
  if (locationTypes.size === 1 && !hasStreams) {
    const type = [...locationTypes][0];
    if (type === "proxy") return <Badge>Proxy</Badge>;
    if (type === "static") return <Badge variant="secondary">Static</Badge>;
    if (type === "redirect") return <Badge variant="outline">Redirect</Badge>;
  }
  return <Badge variant="outline">Mixed</Badge>;
}

function getHostInfo(host: HostRecord) {
  const locations = (host.locations as any[] ?? []);
  const streams = (host.streamPorts as any[] ?? []);

  if (locations.length === 1 && streams.length === 0) {
    const loc = locations[0];
    if (loc.type === "proxy" && loc.upstreams?.length > 0) {
      const u = loc.upstreams[0];
      return `→ ${u.server}:${u.port}`;
    }
    if (loc.type === "static") return `Static: ${loc.staticDir || "-"}`;
    if (loc.type === "redirect") return `→ ${loc.forwardScheme}://${loc.forwardDomain}${loc.forwardPath}`;
  }

  const parts = [];
  if (locations.length > 0) parts.push(`${locations.length} location${locations.length > 1 ? "s" : ""}`);
  if (streams.length > 0) parts.push(`${streams.length} stream${streams.length > 1 ? "s" : ""}`);
  return parts.join(" + ") || "-";
}
```

**Step 2: Remove host.type references**

Update Fuse.js search keys — remove type-based searching, add location-type awareness if needed.

**Step 3: Run build**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run build`

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add web/app/routes/admin/hosts/index.tsx
git commit -m "feat: update hosts list for location-centric display"
```

---

### Task 8: Update Rust Proxy — Config Structs

**Files:**
- Modify: `proxy/src/config.rs`

**Step 1: Update LocationConfig to support redirect fields**

Add redirect fields and headers to `LocationConfig`:

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct LocationConfig {
    pub path: String,
    #[serde(alias = "matchType", default = "default_match_type")]
    pub match_type: String,
    #[serde(alias = "type", default = "default_location_type")]
    pub location_type: Option<String>,
    #[serde(default)]
    pub upstreams: Vec<UpstreamConfig>,
    #[serde(alias = "balanceMethod", default = "default_balance_method")]
    pub balance_method: String,
    #[serde(alias = "staticDir")]
    pub static_dir: Option<String>,
    #[serde(alias = "cacheExpires")]
    pub cache_expires: Option<String>,
    // Redirect fields
    #[serde(alias = "forwardScheme")]
    pub forward_scheme: Option<String>,
    #[serde(alias = "forwardDomain")]
    pub forward_domain: Option<String>,
    #[serde(alias = "forwardPath")]
    pub forward_path: Option<String>,
    #[serde(alias = "preservePath", default)]
    pub preserve_path: bool,
    #[serde(alias = "statusCode")]
    pub status_code: Option<u16>,
    // Common
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(alias = "accessListId", alias = "access_list_id")]
    pub access_list_id: Option<u64>,
}
```

**Step 2: Add StreamPortConfig struct**

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct StreamPortConfig {
    pub port: u16,
    #[serde(default = "default_stream_protocol")]
    pub protocol: String,
    #[serde(default)]
    pub upstreams: Vec<UpstreamConfig>,
    #[serde(default = "default_balance_method")]
    pub balance_method: String,
}
```

**Step 3: Add stream_ports to HostConfig**

```rust
pub struct HostConfig {
    // ... existing fields ...
    #[serde(default)]
    pub stream_ports: Vec<StreamPortConfig>,
}
```

**Step 4: Update AppConfig to remove separate redirects/streams**

Load all hosts from `host-*.yaml` only. Remove separate `redirect-*.yaml` and `stream-*.yaml` loading. Update `AppConfig`:

```rust
pub struct AppConfig {
    pub global: GlobalConfig,
    pub hosts: Vec<HostConfig>,
    pub access_lists: HashMap<u64, AccessListConfig>,
}
```

Remove the `redirects` and `streams` fields.

**Step 5: Update Rust tests**

Update tests in `config.rs` to add redirect fields to LocationConfig tests, add StreamPortConfig tests, update AppConfig::load tests to not expect separate redirect/stream files.

**Step 6: Run Rust tests**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/proxy && cargo test`

Expected: All tests pass.

**Step 7: Commit**

```bash
git add proxy/src/config.rs
git commit -m "feat: update Rust config structs for location-centric model"
```

---

### Task 9: Update Rust Proxy — Request Routing

**Files:**
- Modify: `proxy/src/router.rs`
- Modify: `proxy/src/main.rs`
- Modify: `proxy/src/streams.rs`

**Step 1: Add redirect handling in router**

Update the location matching logic in `router.rs` to handle redirect-type locations. When a request matches a redirect location, return a 301/302 response with the `Location` header constructed from `forward_scheme`, `forward_domain`, `forward_path`, and `preserve_path`.

**Step 2: Add per-location headers**

When a location has custom headers, add them to the response. This applies to all location types (proxy, static, redirect).

**Step 3: Update stream handling in main.rs**

Read stream ports from `host.stream_ports` instead of the separate `config.streams`. Update the stream listener setup to iterate over all hosts' `stream_ports`.

**Step 4: Remove redirect handling from main.rs**

Remove the code that reads `config.redirects` and handles redirect-type hosts separately. Redirects are now handled per-location within the normal host routing flow.

**Step 5: Run Rust tests**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/proxy && cargo test`

Expected: All tests pass.

**Step 6: Build the proxy**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/proxy && cargo build`

Expected: Build succeeds.

**Step 7: Commit**

```bash
git add proxy/src/
git commit -m "feat: redirect handling per location, per-location headers, unified streams"
```

---

### Task 10: Update Remaining References

**Files:**
- Modify: `web/app/lib/watchdog/` (if it references host.type)
- Modify: `web/app/routes/admin/health.tsx` (if it uses hostType)
- Modify: Any other files that reference old `host.type` field

**Step 1: Search for all references to `host.type` and old fields**

Run: `grep -rn "host\.type\|hostType\|host_type\|\.upstreams\b" web/app/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".test."`

Fix each reference to work with the new location-centric model.

**Step 2: Update health checks**

`healthChecks` table has a `hostType` column. This can be derived from locations now. Either keep the column for backwards compatibility or update it.

**Step 3: Run full test suite**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run test`

Expected: All tests pass.

**Step 4: Run full build**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run build`

Expected: Build succeeds.

**Step 5: Commit**

```bash
git add -A
git commit -m "fix: update all references to old host.type and type-specific fields"
```

---

### Task 11: End-to-End Verification

**Step 1: Build web**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run build`

**Step 2: Run web tests**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/web && bun run test`

**Step 3: Build proxy**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/proxy && cargo build`

**Step 4: Run proxy tests**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager/proxy && cargo test`

**Step 5: Docker build**

Run: `cd /home/roman/Projects/hardskilled/pingora-manager && docker build -t pingora-manager:test .`

Expected: All steps succeed.

**Step 6: Final commit**

```bash
git add -A
git commit -m "v1.1.0: location-centric hosts, domains UX, groups combobox"
```
