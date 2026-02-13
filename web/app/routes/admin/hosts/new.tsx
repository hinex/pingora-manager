import type { Route } from "./+types/new";
import { redirect } from "react-router";
import { db } from "~/lib/db/connection";
import { hosts, hostGroups, hostLabels, hostLabelAssignments } from "~/lib/db/schema";
import { HostForm, type HostFormData } from "~/components/host-form/HostForm";
import { logAudit } from "~/lib/audit/log";
import { getSessionUser } from "~/lib/auth/session.server";
import { generateAllConfigs } from "~/lib/config-generator/generate";
import { reloadPingora } from "~/lib/signal/reload";

export function meta() {
  return [{ title: "Add Host — Pingora Manager" }];
}

export async function loader({}: Route.LoaderArgs) {
  const groups = db.select().from(hostGroups).all();
  const labels = db.select().from(hostLabels).all();
  return { groups, labels };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  let data: HostFormData;
  try {
    data = JSON.parse(formData.get("formData") as string);
  } catch {
    return { error: "Invalid form data" };
  }

  // Validation
  if (data.type !== "stream" && (!data.domains || data.domains.length === 0)) {
    return { error: "At least one domain is required" };
  }

  if (data.type === "proxy") {
    if (data.upstreams.length === 0 && data.locations.length === 0) {
      return { error: "At least one upstream or location is required" };
    }
    for (const u of data.upstreams) {
      if (!u.server?.trim()) return { error: "All upstreams must have a server address" };
      if (!u.port || u.port < 1 || u.port > 65535) return { error: "Upstream port must be between 1 and 65535" };
    }
  }

  if (data.type === "static") {
    if (!data.staticDir?.trim()) return { error: "Static directory path is required" };
  }

  if (data.type === "redirect") {
    if (!data.forwardDomain?.trim()) return { error: "Forward domain is required" };
  }

  if (data.type === "stream") {
    if (!data.incomingPort || data.incomingPort < 1 || data.incomingPort > 65535) {
      return { error: "Incoming port must be between 1 and 65535" };
    }
    if (!data.upstreams || data.upstreams.length === 0) {
      return { error: "At least one upstream is required" };
    }
    for (const u of data.upstreams) {
      if (!u.server?.trim()) return { error: "All upstreams must have a server address" };
      if (!u.port || u.port < 1 || u.port > 65535) return { error: "Upstream port must be between 1 and 65535" };
    }
  }

  if (data.sslType === "custom" && (!data.sslCertPath || !data.sslKeyPath)) {
    return { error: "Custom SSL requires both certificate and key paths" };
  }

  const result = db.insert(hosts)
    .values({
      type: data.type,
      domains: data.type === "stream" ? [] : data.domains,
      groupId: data.groupId,
      enabled: data.enabled,
      sslType: data.sslType as any,
      sslForceHttps: data.sslForceHttps,
      sslCertPath: data.sslCertPath || null,
      sslKeyPath: data.sslKeyPath || null,
      upstreams: data.upstreams,
      balanceMethod: data.balanceMethod as any,
      locations: data.locations as any,
      hsts: data.hsts,
      http2: data.http2,
      staticDir: data.staticDir || null,
      cacheExpires: data.cacheExpires || null,
      forwardScheme: data.forwardScheme || null,
      forwardDomain: data.forwardDomain || null,
      forwardPath: data.forwardPath || "/",
      preservePath: data.preservePath,
      statusCode: data.statusCode || 301,
      incomingPort: data.incomingPort || null,
      protocol: data.protocol as any || null,
      webhookUrl: data.webhookUrl || null,
      advancedYaml: data.advancedYaml || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
    .get();

  // Save label assignments
  if (data.labelIds && data.labelIds.length > 0) {
    for (const labelId of data.labelIds) {
      db.insert(hostLabelAssignments)
        .values({ hostId: result.id, labelId })
        .run();
    }
  }

  const user = await getSessionUser(request);
  logAudit({
    userId: user?.userId ?? null,
    action: "create",
    entity: "host",
    entityId: result.id,
    details: { type: data.type, domains: data.domains },
    ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
  });

  generateAllConfigs();
  reloadPingora();

  return redirect("/admin/hosts");
}

export default function NewHost({ loaderData }: Route.ComponentProps) {
  const { groups, labels } = loaderData;

  return (
    <div>
      <div className="flex items-center min-h-10 mb-6">
        <h1 className="text-2xl font-bold">Add Host</h1>
      </div>
      <HostForm groups={groups} labels={labels} submitLabel="Create Host" />
    </div>
  );
}
