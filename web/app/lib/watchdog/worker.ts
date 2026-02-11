import { db } from "~/lib/db/connection";
import {
  proxyHosts,
  streams,
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

async function runChecks() {
  try {
    const allProxyHosts = db
      .select()
      .from(proxyHosts)
      .where(eq(proxyHosts.enabled, true))
      .all();

    const allStreams = db
      .select()
      .from(streams)
      .where(eq(streams.enabled, true))
      .all();

    // Check proxy host upstreams
    for (const host of allProxyHosts) {
      const upstreamsList = host.upstreams as Array<{
        server: string;
        port: number;
        weight: number;
      }>;
      const domains = host.domains as string[];
      const hostLabel = domains[0] ?? `proxy:${host.id}`;

      for (const upstream of upstreamsList) {
        const upstreamKey = `${upstream.server}:${upstream.port}`;
        const result = await checkUpstream(upstream.server, upstream.port);
        const prevStatus = getLatestStatus(host.id, "proxy", upstreamKey);

        // Insert health check record
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

        // Send webhook if status changed
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

    // Check stream upstreams
    for (const stream of allStreams) {
      const upstreamsList = stream.upstreams as Array<{
        server: string;
        port: number;
        weight: number;
      }>;
      const streamLabel = `stream:${stream.incomingPort}`;

      for (const upstream of upstreamsList) {
        const upstreamKey = `${upstream.server}:${upstream.port}`;
        const result = await checkUpstream(upstream.server, upstream.port);
        const prevStatus = getLatestStatus(stream.id, "stream", upstreamKey);

        db.insert(healthChecks)
          .values({
            hostId: stream.id,
            hostType: "stream",
            upstream: upstreamKey,
            status: result.status,
            responseMs: result.status === "up" ? result.responseMs : null,
            checkedAt: new Date(),
          })
          .run();

        if (prevStatus !== null && prevStatus !== result.status) {
          const webhookUrl = resolveWebhookUrl(
            stream.webhookUrl,
            stream.groupId
          );
          if (webhookUrl) {
            const group = stream.groupId
              ? db
                  .select()
                  .from(hostGroups)
                  .where(eq(hostGroups.id, stream.groupId))
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
