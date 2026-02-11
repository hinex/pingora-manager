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

export function buildHostConfig(host: typeof proxyHosts.$inferSelect) {
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

export function generateHostConfig(host: typeof proxyHosts.$inferSelect) {
  mkdirSync(CONFIGS_DIR, { recursive: true });
  const config = buildHostConfig(host);
  writeFileSync(join(CONFIGS_DIR, `host-${host.id}.yaml`), stringify(config));
}

export function removeHostConfig(id: number) {
  try { unlinkSync(join(CONFIGS_DIR, `host-${id}.yaml`)); } catch {}
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

export function buildRedirectConfig(r: typeof redirections.$inferSelect) {
  return {
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
}

function generateRedirectConfig(r: typeof redirections.$inferSelect) {
  const config = buildRedirectConfig(r);
  writeFileSync(join(CONFIGS_DIR, `redirect-${r.id}.yaml`), stringify(config));
}

export function removeRedirectConfig(id: number) {
  try { unlinkSync(join(CONFIGS_DIR, `redirect-${id}.yaml`)); } catch {}
}

export function buildStreamConfig(s: typeof streams.$inferSelect) {
  return {
    id: s.id,
    incoming_port: s.incomingPort,
    protocol: s.protocol,
    upstreams: s.upstreams,
    balance_method: s.balanceMethod,
    enabled: s.enabled,
  };
}

function generateStreamConfig(s: typeof streams.$inferSelect) {
  const config = buildStreamConfig(s);
  writeFileSync(join(CONFIGS_DIR, `stream-${s.id}.yaml`), stringify(config));
}

export function removeStreamConfig(id: number) {
  try { unlinkSync(join(CONFIGS_DIR, `stream-${id}.yaml`)); } catch {}
}
