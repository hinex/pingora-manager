import { db } from "~/lib/db/connection";
import {
  hosts,
  hostGroups,
  healthChecks,
  settings,
} from "~/lib/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { checkUpstream } from "./health-check";
import { sendWebhook, type WebhookPayload } from "./webhook";

function getSetting(key: string, defaultValue: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? defaultValue;
}

function getGlobalWebhookUrl(): string | null {
  const val = getSetting("global_webhook_url", "");
  return val || null;
}

function resolveWebhookUrl(
  hostWebhookUrl: string | null,
  groupId: number | null
): string | null {
  if (hostWebhookUrl) return hostWebhookUrl;

  if (groupId) {
    const group = db
      .select()
      .from(hostGroups)
      .where(eq(hostGroups.id, groupId))
      .get();
    if (group?.webhookUrl) return group.webhookUrl;
  }

  return getGlobalWebhookUrl();
}

function getLatestStatus(
  hostId: number,
  hostType: "proxy" | "stream",
  upstream: string
): "up" | "down" | null {
  const row = db
    .select()
    .from(healthChecks)
    .where(
      and(
        eq(healthChecks.hostId, hostId),
        eq(healthChecks.hostType, hostType),
        eq(healthChecks.upstream, upstream)
      )
    )
    .orderBy(healthChecks.checkedAt)
    .limit(1)
    .all()
    .pop();

  return (row?.status as "up" | "down") ?? null;
}

interface LocationData {
  type: string;
  upstreams: Array<{ server: string; port: number; weight: number }>;
}

interface StreamPortData {
  port: number;
  protocol: string;
  upstreams: Array<{ server: string; port: number; weight: number }>;
}

async function runChecks() {
  try {
    const enabledHosts = db
      .select()
      .from(hosts)
      .where(eq(hosts.enabled, true))
      .all();

    for (const host of enabledHosts) {
      const locations = (host.locations ?? []) as LocationData[];
      const streamPorts = (host.streamPorts ?? []) as StreamPortData[];
      const domains = host.domains as string[];
      const hostLabel = domains[0] ?? `host:${host.id}`;

      // Check proxy location upstreams
      for (const location of locations) {
        if (location.type !== "proxy" || !location.upstreams) continue;

        for (const upstream of location.upstreams) {
          const upstreamKey = `${upstream.server}:${upstream.port}`;
          const result = await checkUpstream(upstream.server, upstream.port);
          const prevStatus = getLatestStatus(host.id, "proxy", upstreamKey);

          db.insert(healthChecks)
            .values({
              hostId: host.id,
              hostType: "proxy",
              upstream: upstreamKey,
              status: result.status,
              responseMs: result.status === "up" ? result.responseMs : null,
              checkedAt: new Date(),
            })
            .run();

          if (prevStatus !== null && prevStatus !== result.status) {
            const webhookUrl = resolveWebhookUrl(host.webhookUrl, host.groupId);
            if (webhookUrl) {
              const group = host.groupId
                ? db
                    .select()
                    .from(hostGroups)
                    .where(eq(hostGroups.id, host.groupId))
                    .get()
                : null;

              const payload: WebhookPayload = {
                event: result.status === "down" ? "upstream_down" : "upstream_up",
                host: hostLabel,
                upstream: upstreamKey,
                group: group?.name ?? null,
                timestamp: new Date().toISOString(),
                response_ms: result.status === "up" ? result.responseMs : null,
                message:
                  result.status === "down"
                    ? result.error ?? "Connection failed"
                    : "Upstream recovered",
              };

              await sendWebhook(webhookUrl, payload);
            }
          }
        }
      }

      // Check stream port upstreams
      for (const sp of streamPorts) {
        if (!sp.upstreams) continue;
        const streamLabel = `stream:${sp.port}`;

        for (const upstream of sp.upstreams) {
          const upstreamKey = `${upstream.server}:${upstream.port}`;
          const result = await checkUpstream(upstream.server, upstream.port);
          const prevStatus = getLatestStatus(host.id, "stream", upstreamKey);

          db.insert(healthChecks)
            .values({
              hostId: host.id,
              hostType: "stream",
              upstream: upstreamKey,
              status: result.status,
              responseMs: result.status === "up" ? result.responseMs : null,
              checkedAt: new Date(),
            })
            .run();

          if (prevStatus !== null && prevStatus !== result.status) {
            const webhookUrl = resolveWebhookUrl(host.webhookUrl, host.groupId);
            if (webhookUrl) {
              const group = host.groupId
                ? db
                    .select()
                    .from(hostGroups)
                    .where(eq(hostGroups.id, host.groupId))
                    .get()
                : null;

              const payload: WebhookPayload = {
                event: result.status === "down" ? "upstream_down" : "upstream_up",
                host: streamLabel,
                upstream: upstreamKey,
                group: group?.name ?? null,
                timestamp: new Date().toISOString(),
                response_ms: result.status === "up" ? result.responseMs : null,
                message:
                  result.status === "down"
                    ? result.error ?? "Connection failed"
                    : "Upstream recovered",
              };

              await sendWebhook(webhookUrl, payload);
            }
          }
        }
      }
    }

    // Clean old health check records
    const retentionDays = Number(
      getSetting("health_retention_days", "7")
    );
    const cutoff = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000
    );
    db.delete(healthChecks)
      .where(lt(healthChecks.checkedAt, cutoff))
      .run();
  } catch (err) {
    console.error(
      "[watchdog] Error during health check cycle:",
      err instanceof Error ? err.message : err
    );
  }
}

export function startWatchdog(): void {
  const intervalMs = Number(getSetting("watchdog_interval_ms", "30000"));

  console.log(`[watchdog] Starting with interval ${intervalMs}ms`);

  // Run first check after a short delay to let the server boot
  setTimeout(() => {
    runChecks();
  }, 5000);

  setInterval(() => {
    runChecks();
  }, intervalMs);
}
