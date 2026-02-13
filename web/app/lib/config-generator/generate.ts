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
