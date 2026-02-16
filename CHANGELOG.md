# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-02-16

### Added
- **File location type** — serve a single file at a specific path (e.g., `/sitemap.xml` → `/var/static/sitemap.xml`)
- **Per-host file logging** — proxy writes access and error logs to separate files per host (`proxy-host-{id}_access.log`, `proxy-host-{id}_error.log`)
- **Dashboard health overview** — upstream health status (up/down counts) and unhealthy upstreams table directly on the dashboard

### Changed
- **Dashboard redesign** — new layout with host stats, health summary, unhealthy upstreams table, and recent audit activity
- **Health page merged into Dashboard** — removed standalone Health page, all health data now on the Dashboard

### Removed
- Standalone Health page (`/admin/health`) — replaced by Dashboard health section
- "Powered by" footer from error pages

## [1.2.1] - 2026-02-16

### Fixed
- **Location routing priority** — longest prefix match now wins over shorter ones (e.g. `/api` correctly takes priority over `/`), preventing misrouted requests

## [1.2.0] - 2026-02-16

### Added
- **Upstream test button** — test TCP connectivity to any upstream directly from the host edit form (Locations and Stream Ports tabs)
- **Hostname support in upstreams** — proxy resolves DNS hostnames (e.g. Docker service names) to IP addresses, not just raw IPs
- API endpoint `POST /api/test-upstream` for on-demand upstream health checks

### Changed
- **Hosts page header redesign** — split into two rows: title + Add Host on top, search bar + view toggle + management buttons in a toolbar below
- **Compact upstream rows** — replaced bulky upstream cards with streamlined single-line layout (server, port, weight, test, delete)

## [1.1.0] - 2026-02-15

### Changed
- **Location-centric host model** — hosts now use a flexible locations array instead of a single upstream configuration, supporting multiple paths with different routing types per host

## [1.0.3] - 2026-02-13

### Added
- GitHub Actions workflow for automatic Docker Hub release on tag push
- `.dockerignore` to reduce Docker build context

### Changed
- Default page now shows generic "No site configured" message without product branding

## [1.0.2] - 2026-02-13

### Added
- **Unified Hosts page** — proxy, static, redirect, and stream hosts managed from a single page with type selector
- **Host type switching** — change host type at any time without data loss; all fields persist in the database
- **Color labels** — user-defined colored tags on hosts (create, edit, delete via modal)
- **Fuzzy search** — client-side search across domains, labels, and group names (Fuse.js)
- **Group/flat view toggle** — switch between grouped view (default) and flat list
- **Groups modal** — manage host groups inline from the Hosts page
- **Labels modal** — manage color labels inline from the Hosts page
- **Static host type** — serve static files directly without a proxy backend
- **Static host config example** in README

### Changed
- **Database schema**: replaced `proxy_hosts`, `redirections`, `streams` tables with a single unified `hosts` table
- **Sidebar**: consolidated Proxy Hosts, Groups, Redirections, Streams into a single "Hosts" entry
- **Dashboard**: shows per-type host counts (Proxy, Static, Streams, Redirections)
- **Config generator**: reads from unified `hosts` table, generates type-appropriate YAML
- **SSL page**: reads from unified `hosts` table
- **Logs page**: reads from unified `hosts` table
- **Error pages**: reads from unified `hosts` table
- **Watchdog**: reads from unified `hosts` table, filters by type

### Removed
- Separate Proxy Hosts, Redirections, Streams, Groups, and Static Dirs pages
- `proxy-host-form/` component directory (replaced by `host-form/`)

## [1.0.1] - 2026-02-13

### Added
- Initial setup page for first-time configuration
- Self-role protection (users cannot downgrade their own role)

### Fixed
- Logout redirect behavior

## [1.0.0] - 2026-02-13

### Added
- Initial release
- HTTP/HTTPS reverse proxy with domain-based routing
- SSL/TLS: Let's Encrypt (ACME HTTP-01) and custom certificates
- Load balancing: round robin, weighted, least connections, IP hash, random
- Access control: IP allowlist/denylist, Basic Auth
- Static file serving with caching
- TCP/UDP stream proxying
- HTTP redirections (301/302/307/308)
- Custom error pages (per-host, per-group, global)
- Health checks with webhook notifications
- Zero-downtime config reload via SIGHUP
- Audit logging
- Web admin UI (React 19 + React Router 7 + Tailwind CSS 4)
