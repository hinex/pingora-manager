# Unified Hosts Design

## Goal

Replace separate Proxy Hosts, Redirections, Streams, and Groups sections with a single **Hosts** section. Add static file serving as a first-class host type. Add labels and fuzzy search.

## Requirements

- One unified **Hosts** page replaces Proxy Hosts, Groups, Redirections, Streams, Static Dirs
- Host type (`proxy`, `static`, `redirect`, `stream`) is selectable and **changeable** — switching type preserves all previously entered data
- Groups become a **view mode** toggle: grouped (default) vs flat list
- Groups manageable via modal within the Hosts page
- **Fuzzy search** across domains, labels, group names
- **Labels**: user-defined colored tags (e.g., green "Back", yellow "Front"), manageable via settings or inline modal
- Rust proxy unchanged — config generator adapts output format

## Database

### New table: `hosts`

Merges `proxy_hosts`, `redirections`, `streams` into one table. All type-specific fields are nullable — switching type doesn't erase data.

```
id                INTEGER PK autoincrement
type              TEXT NOT NULL ("proxy" | "static" | "redirect" | "stream")
groupId           INTEGER FK host_groups (on delete set null)
domains           JSON TEXT (string[]) NOT NULL
enabled           BOOLEAN NOT NULL default true

-- SSL (shared by proxy, static, redirect)
sslType           TEXT ("none" | "letsencrypt" | "custom") default "none"
sslForceHttps     BOOLEAN default false
sslCertPath       TEXT nullable
sslKeyPath        TEXT nullable

-- Proxy fields
upstreams         JSON TEXT (Array<{server, port, weight}>) default []
balanceMethod     TEXT ("round_robin"|"weighted"|"least_conn"|"ip_hash"|"random") default "round_robin"
locations         JSON TEXT (LocationConfig[]) default []
hsts              BOOLEAN default true
http2             BOOLEAN default true

-- Static fields (whole-host static serving)
staticDir         TEXT nullable
cacheExpires      TEXT nullable

-- Redirect fields
forwardScheme     TEXT nullable
forwardDomain     TEXT nullable
forwardPath       TEXT nullable default "/"
preservePath      BOOLEAN default true
statusCode        INTEGER nullable default 301

-- Stream fields
incomingPort      INTEGER nullable
protocol          TEXT ("tcp" | "udp") nullable

-- Common
webhookUrl        TEXT nullable
advancedYaml      TEXT nullable
createdAt         TIMESTAMP NOT NULL
updatedAt         TIMESTAMP NOT NULL
```

### New table: `host_labels`

```
id        INTEGER PK autoincrement
name      TEXT NOT NULL
color     TEXT NOT NULL (e.g., "green", "yellow", "blue", "red", "purple", "orange", "pink", "gray")
createdAt TIMESTAMP NOT NULL
```

### New table: `host_label_assignments`

```
id      INTEGER PK autoincrement
hostId  INTEGER FK hosts (on delete cascade)
labelId INTEGER FK host_labels (on delete cascade)
```

### Migration

1. Create `hosts`, `host_labels`, `host_label_assignments` tables
2. Copy data from `proxy_hosts` → `hosts` (type='proxy')
3. Copy data from `redirections` → `hosts` (type='redirect')
4. Copy data from `streams` → `hosts` (type='stream')
5. Drop `proxy_hosts`, `redirections`, `streams` tables

## UI

### Sidebar

**Before (Proxy section):**
- Proxy Hosts, Groups, Redirections, Streams

**After (Proxy section):**
- **Hosts** (single entry)

**Configuration section:** remove Static Dirs (no longer needed as separate page).

### Hosts List Page (`/admin/hosts`)

**Header bar:**
- Title "Hosts"
- View mode toggle: Groups (default) | All
- Fuzzy search input
- "Add Host" button

**Groups mode:**
- Hosts grouped under collapsible group headers
- "Ungrouped" section for hosts without a group
- Group management button (opens modal for CRUD groups)

**All mode:**
- Flat list of all hosts sorted by creation date

**Each host row shows:**
- Type badge (Proxy / Static / Redirect / Stream) with distinct colors
- Domains as badges
- Labels as colored chips
- SSL status
- Type-specific info (upstreams count for proxy, target for redirect, port for stream, dir for static)
- Enabled/disabled status
- Actions dropdown (Edit, Toggle, Delete)

### Host Form (`/admin/hosts/new`, `/admin/hosts/:id/edit`)

**Top of form:** Type selector (segmented control or tabs) — Proxy / Static / Redirect / Stream. Always visible, always changeable.

**Common fields (always visible):**
- Domains (multi-input)
- Group (select)
- Labels (multi-select with color chips)
- SSL (type, force HTTPS, cert/key paths)
- Enabled toggle

**Type-specific sections (show/hide based on selected type):**

| Type | Visible Sections |
|------|-----------------|
| Proxy | Upstreams, Balance Method, Locations, HSTS, HTTP/2 |
| Static | Static Directory, Cache Expires |
| Redirect | Forward Scheme, Forward Domain, Forward Path, Preserve Path, Status Code |
| Stream | Incoming Port, Protocol, Upstreams, Balance Method |

**Advanced (always available):**
- Webhook URL
- Advanced YAML

**Key behavior:** Switching type only toggles visibility. Form state retains all values. Saving with type=static ignores proxy fields in config generation, but they remain in DB.

### Labels Management

Accessible from:
- Settings page (dedicated Labels section)
- Inline from host form (small manage button next to label selector)

Label form: Name + Color picker (preset palette: green, yellow, blue, red, purple, orange, pink, gray).

### Fuzzy Search

Use **Fuse.js** library. Search targets:
- `domains` array values
- Label names
- Group name

Results update as user types (client-side filtering).

## Config Generator

`generateAllConfigs()` reads from unified `hosts` table and generates YAML files based on type:

- `type=proxy` → `host-{id}.yaml` (same format as current proxy host config)
- `type=static` → `host-{id}.yaml` (generates a host config with single location: `{path: "/", matchType: "prefix", type: "static", staticDir, cacheExpires}`)
- `type=redirect` → `redirect-{id}.yaml` (same format as current redirect config)
- `type=stream` → `stream-{id}.yaml` (same format as current stream config)

**Rust proxy is unchanged** — it reads the same YAML structure.

## Affected Files

### Delete
- `web/app/routes/admin/proxy-hosts/` (entire directory)
- `web/app/routes/admin/redirections.tsx`
- `web/app/routes/admin/streams.tsx`
- `web/app/routes/admin/groups.tsx`
- `web/app/routes/admin/static-dirs.tsx`

### Create
- `web/app/routes/admin/hosts/index.tsx` — list page
- `web/app/routes/admin/hosts/new.tsx` — create form
- `web/app/routes/admin/hosts/$id.edit.tsx` — edit form
- `web/app/components/host-form/HostForm.tsx` — unified form component
- `web/app/components/host-form/ProxySection.tsx`
- `web/app/components/host-form/StaticSection.tsx`
- `web/app/components/host-form/RedirectSection.tsx`
- `web/app/components/host-form/StreamSection.tsx`
- `web/app/components/host-form/CommonFields.tsx`
- `web/app/components/host-form/LabelSelector.tsx`
- `web/app/components/LabelsModal.tsx` — CRUD for labels
- `web/app/components/GroupsModal.tsx` — CRUD for groups (moved from page)

### Modify
- `web/app/lib/db/schema.ts` — new schema
- `web/drizzle/` — new migration
- `web/app/lib/config-generator/generate.ts` — read from `hosts` table
- `web/app/components/Sidebar.tsx` — simplified nav
- `web/app/routes/admin/settings.tsx` — add labels management section
- Dashboard, health, audit-log pages — update references from proxy_hosts/redirections/streams to hosts
- `web/package.json` — add `fuse.js` dependency
