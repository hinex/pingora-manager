import type { Route } from "./+types/edit";
import { redirect } from "react-router";
import { db } from "~/lib/db/connection";
import { hosts, hostGroups, hostLabels, hostLabelAssignments, accessLists } from "~/lib/db/schema";
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
  const acls = db.select({ id: accessLists.id, name: accessLists.name }).from(accessLists).all();
  const assignments = db
    .select()
    .from(hostLabelAssignments)
    .where(eq(hostLabelAssignments.hostId, id))
    .all();

  return { host, groups, labels, accessLists: acls, assignedLabelIds: assignments.map((a) => a.labelId) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const id = Number(params.id);
  const formData = await request.formData();

  const intent = formData.get("intent");
  if (intent === "createGroup") {
    const name = formData.get("name") as string;
    if (!name?.trim()) return { error: "Group name is required" };
    const result = db.insert(hostGroups)
      .values({ name: name.trim(), createdAt: new Date() })
      .returning()
      .get();
    return { groupId: result.id };
  }

  let data: HostFormData;
  try {
    data = JSON.parse(formData.get("formData") as string);
  } catch {
    return { error: "Invalid form data" };
  }

  // Validation
  if (data.locations.length === 0 && data.streamPorts.length === 0) {
    return { error: "At least one location or stream port is required" };
  }

  if (data.locations.length > 0 && (!data.domains || data.domains.length === 0)) {
    return { error: "At least one domain is required when locations are configured" };
  }

  // Per-location validation
  for (const loc of data.locations) {
    if (loc.type === "proxy") {
      if (!loc.upstreams || loc.upstreams.length === 0) {
        return { error: `Location "${loc.path}": at least one upstream is required for proxy type` };
      }
      for (const u of loc.upstreams) {
        if (!u.server?.trim()) return { error: "All upstreams must have a server address" };
        if (!u.port || u.port < 1 || u.port > 65535) return { error: "Upstream port must be between 1 and 65535" };
      }
    }
    if (loc.type === "static" && !loc.staticDir?.trim()) {
      return { error: `Location "${loc.path}": static directory path is required` };
    }
    if (loc.type === "redirect" && !loc.forwardDomain?.trim()) {
      return { error: `Location "${loc.path}": forward domain is required` };
    }
  }

  // Per-stream-port validation
  for (const sp of data.streamPorts) {
    if (!sp.port || sp.port < 1 || sp.port > 65535) {
      return { error: "Stream port must be between 1 and 65535" };
    }
    if (!sp.upstreams || sp.upstreams.length === 0) {
      return { error: `Stream port ${sp.port}: at least one upstream is required` };
    }
    for (const u of sp.upstreams) {
      if (!u.server?.trim()) return { error: "All upstreams must have a server address" };
      if (!u.port || u.port < 1 || u.port > 65535) return { error: "Upstream port must be between 1 and 65535" };
    }
  }

  if (data.sslType === "custom" && (!data.sslCertPath || !data.sslKeyPath)) {
    return { error: "Custom SSL requires both certificate and key paths" };
  }

  db.update(hosts)
    .set({
      domains: data.domains,
      groupId: data.groupId,
      enabled: data.enabled,
      sslType: data.sslType as any,
      sslForceHttps: data.sslForceHttps,
      sslCertPath: data.sslCertPath || null,
      sslKeyPath: data.sslKeyPath || null,
      hsts: data.hsts,
      http2: data.http2,
      locations: data.locations as any,
      streamPorts: data.streamPorts as any,
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
    details: { domains: data.domains },
    ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
  });

  generateAllConfigs();
  reloadPingora();

  return redirect("/admin/hosts");
}

export default function EditHost({ loaderData }: Route.ComponentProps) {
  const { host, groups, labels, accessLists: acls, assignedLabelIds } = loaderData;

  const initialData: Partial<HostFormData> = {
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
    locations: host.locations as any,
    streamPorts: (host.streamPorts as any) || [],
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
        accessLists={acls}
        submitLabel="Update Host"
      />
    </div>
  );
}
