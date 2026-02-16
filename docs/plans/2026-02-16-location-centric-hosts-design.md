# Location-Centric Hosts + UX Improvements

**Date:** 2026-02-16
**Status:** Approved

## Summary

Three changes to Pingora Manager:

1. **Location-centric host model** — drop host-level `type`, every host is domains + locations + optional stream ports
2. **Domains UX** — input + visible "+" button (Enter still works as shortcut)
3. **Groups UX** — combobox with inline creation on host form

---

## 1. Location-Centric Host Model

### Before

A host has a `type` (proxy / static / redirect / stream) that determines its form and behavior. Proxy hosts can have locations (proxy or static). Other types are flat.

### After

A host has no type. It has:

- **Domains** — list of domain names (optional if stream-only)
- **Locations** — ordered list, each with its own type and full config
- **Stream Ports** — optional list of TCP/UDP port forwarding rules (in Advanced tab)

### Location types

| Type | Fields |
|------|--------|
| **proxy** | upstreams[], balanceMethod |
| **static** | staticDir, cacheExpires |
| **redirect** | forwardScheme, forwardDomain, forwardPath, preservePath, statusCode |

### Common fields on every location

- `path` — URL path (e.g. `/`, `/api`, `/uploads`)
- `matchType` — prefix, exact, regex
- `type` — proxy, static, redirect
- `headers` — key-value pairs (response headers)
- `accessListId` — optional reference to an access list

### Type switching preserves data

Each location stores all fields for all types simultaneously. Switching `type` only changes which fields are visible — data is never cleared. Only the active type's fields are serialized to config.

### Examples

**Site 1** — frontend + uploads + API:
- `/` prefix proxy → localhost:3000
- `/uploads` prefix static → /var/uploads
- `/api` prefix proxy → localhost:8080

**Site 2** — frontend + cached uploads:
- `/` prefix proxy → localhost:3000
- `/uploads` prefix static → /var/uploads, headers: `Cache-Control: max-age=31536000`

**Site 3** — static site with custom headers:
- `/` prefix static → /var/www, headers: `X-Frame-Options: DENY`

**Site 4** — admin panel:
- `/` prefix proxy → localhost:9090

### Stream ports

Separate from HTTP locations (streams have no paths). Stored in `hosts.streamPorts` JSON:

```typescript
Array<{
  port: number;
  protocol: "tcp" | "udp";
  upstreams: Array<{ server: string; port: number; weight: number }>;
  balanceMethod: string;
}>
```

A host can have HTTP locations AND stream ports, or just one.

---

## 2. Host Form Structure

### Tabs

| Tab | Contents |
|-----|----------|
| **General** | Domains (input + "+" button), Group (combobox), Labels, Enabled |
| **Locations** | List of locations with full inline editing |
| **SSL** | Certificate config (hidden if no domains) |
| **Advanced** | Stream ports, Webhook URL, Advanced YAML |

### Location card (collapsed)

Compact summary line showing path, match type, location type, and key info:

```
/           prefix   Proxy     → 2 upstreams (round robin)     [×]
/uploads    prefix   Static    → /var/uploads                   [×]
/api        prefix   Proxy     → 1 upstream                     [×]
```

### Location card (expanded)

All settings in one place:

1. **Row 1**: Path + Match Type + Type selector (inline)
2. **Type-specific section**: upstreams (proxy), directory (static), target (redirect)
3. **Headers section**: key-value pairs with "+" button to add
4. **Access Control**: dropdown to select an existing access list

### Default state for new host

One pre-populated proxy location at `/` (prefix), expanded and ready to fill.

---

## 3. Domains UX

Replace "press Enter to add" with input + visible "+" button:

```
[example.com ×]  [www.example.com ×]

[ Type a domain...          ] [ + ]
```

- Visible "+" button makes the interaction discoverable
- Enter key still works as shortcut
- Helper text removed (button is self-explanatory)

---

## 4. Groups UX

### Combobox with inline creation (on host form)

Replace the plain `<select>` with a searchable combobox:

- Type to filter existing groups
- No match → shows `+ Create "typed text"` option at bottom
- Click to create group and assign it immediately
- `×` button to remove group assignment (set to null)

### Hosts list — Manage Groups modal

Stays for editing/deleting groups (name, description, webhook).

Empty state improved: instead of "No groups yet", show explanatory text about what groups are for and how to assign them.

### Groups view edge case

If all hosts are ungrouped, show flat list without the "Ungrouped" section header.

---

## 5. Database Changes

### Remove from `hosts` table

- `type` — no longer needed (derived from locations content)
- `upstreams` — moved into each proxy location
- `balanceMethod` — moved into each proxy location
- `staticDir` — moved into static locations
- `cacheExpires` — moved into static locations
- `forwardScheme` — moved into redirect locations
- `forwardDomain` — moved into redirect locations
- `forwardPath` — moved into redirect locations
- `preservePath` — moved into redirect locations
- `statusCode` — moved into redirect locations
- `incomingPort` — replaced by streamPorts
- `protocol` — replaced by streamPorts

### Modify in `hosts` table

- `locations` JSON — expand schema to include all location types, headers, accessListId, balanceMethod per proxy location

### Add to `hosts` table

- `streamPorts` JSON — array of stream port forwarding rules

### Location JSON schema

```typescript
interface Location {
  path: string;
  matchType: "prefix" | "exact" | "regex";
  type: "proxy" | "static" | "redirect";

  // Proxy (preserved across type switches)
  upstreams: Array<{ server: string; port: number; weight: number }>;
  balanceMethod: string;

  // Static (preserved across type switches)
  staticDir: string;
  cacheExpires: string;

  // Redirect (preserved across type switches)
  forwardScheme: string;
  forwardDomain: string;
  forwardPath: string;
  preservePath: boolean;
  statusCode: number;

  // Common
  headers: Record<string, string>;
  accessListId: number | null;
}
```

---

## 6. Config Generator Changes

- Read upstreams and balanceMethod from each location (not host level)
- Generate redirect rules per location
- Generate stream config from `streamPorts` field
- Derive display "type" at render time for hosts list Info column

## 7. Proxy (Rust) Changes

- Add redirect handling in per-location router
- Read stream config from new `streamPorts` field instead of separate stream host type
- Remove host-level upstream/balanceMethod reading

## 8. Hosts List — Info Column

Derive display from actual content:

| Content | Display |
|---------|---------|
| 1 proxy location | `→ 10.0.0.1:3000` |
| Multiple locations | `3 locations` |
| 1 static location | `Static: /var/www` |
| 1 redirect | `→ https://new.example.com` |
| Stream only | `Stream :3306 TCP` |
| Mixed | `3 locations + 1 stream` |

---

## Migration Strategy

Database migration must:

1. Read existing hosts with their current type-specific fields
2. Convert each host to the new locations-based model:
   - `proxy` → one proxy location at `/` with host-level upstreams
   - `static` → one static location at `/` with host-level staticDir/cacheExpires
   - `redirect` → one redirect location at `/` with host-level redirect fields
   - `stream` → empty locations, one streamPorts entry
   - Existing proxy hosts with locations — merge host-level upstreams as default for locations without their own
3. Drop removed columns, add new columns
