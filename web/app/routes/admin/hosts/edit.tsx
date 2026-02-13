import type { Route } from "./+types/edit";
import { redirect } from "react-router";
import { db } from "~/lib/db/connection";
import { hosts, hostGroups, hostLabels, hostLabelAssignments } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { HostForm, type HostFormData } from "~/components/host-form/HostForm";
import { logAudit } from "~/lib/audit/log";
import { getSessionUser } from "~/lib/auth/session.server";
import { generateAllConfigs } from "~/lib/config-generator/generate";
import { reloadPingora } from "~/lib/signal/reload";

export function meta() {
  return [{ title: "Edit Host — Pingora Manager" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const id = Number(params.id);
  const host = db.select().from(hosts).where(eq(hosts.id, id)).get();

  if (!host) {
    throw new Response("Host not found", { status: 404 });
  }

  const groups = db.select().from(hostGroups).all();
  const labels = db.select().from(hostLabels).all();
  const assignments = db
    .select()
    .from(hostLabelAssignments)
    .where(eq(hostLabelAssignments.hostId, id))
    .all();

  return { host, groups, labels, assignedLabelIds: assignments.map((a) => a.labelId) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const id = Number(params.id);
  const formData = await request.formData();
  let data: HostFormData;
  try {
    data = JSON.parse(formData.get("formData") as string);
  } catch {
    return { error: "Invalid form data" };
  }

  // Validation (same as create)
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

  db.update(hosts)
    .set({
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
      updatedAt: new Date(),
    })
    .where(eq(hosts.id, id))
    .run();

  // Sync label assignments: delete old, insert new
  db.delete(hostLabelAssignments)
    .where(eq(hostLabelAssignments.hostId, id))
    .run();
  if (data.labelIds && data.labelIds.length > 0) {
    for (const labelId of data.labelIds) {
      db.insert(hostLabelAssignments)
        .values({ hostId: id, labelId })
        .run();
    }
  }

  const user = await getSessionUser(request);
  logAudit({
    userId: user?.userId ?? null,
    action: "update",
    entity: "host",
    entityId: id,
    details: { type: data.type, domains: data.domains },
    ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
  });

  generateAllConfigs();
  reloadPingora();

  return redirect("/admin/hosts");
}

export default function EditHost({ loaderData }: Route.ComponentProps) {
  const { host, groups, labels, assignedLabelIds } = loaderData;

  const initialData: Partial<HostFormData> = {
    type: host.type as HostFormData["type"],
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
    upstreams: host.upstreams as any,
    balanceMethod: host.balanceMethod,
    locations: host.locations as any,
    staticDir: host.staticDir || "",
    cacheExpires: host.cacheExpires || "",
    forwardScheme: host.forwardScheme || "https",
    forwardDomain: host.forwardDomain || "",
    forwardPath: host.forwardPath || "/",
    preservePath: host.preservePath,
    statusCode: host.statusCode || 301,
    incomingPort: host.incomingPort || null,
    protocol: host.protocol || "tcp",
    webhookUrl: host.webhookUrl || "",
    advancedYaml: host.advancedYaml || "",
  };

  return (
    <div>
      <div className="flex items-center min-h-10 mb-6">
        <h1 className="text-2xl font-bold">Edit Host</h1>
      </div>
      <HostForm
        initialData={initialData}
        groups={groups}
        labels={labels}
        submitLabel="Update Host"
      />
    </div>
  );
}
