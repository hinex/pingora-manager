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
    const config = buildHostConfig(host);
    writeFileSync(join(CONFIGS_DIR, `host-${host.id}.yaml`), stringify(config));
  }
}

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
    compression: host.compression,
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

export function removeHostConfig(id: number) {
  try { unlinkSync(join(CONFIGS_DIR, `host-${id}.yaml`)); } catch {}
  // Clean up legacy files from before location-centric migration
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
