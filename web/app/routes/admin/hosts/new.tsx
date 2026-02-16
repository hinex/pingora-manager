import type { Route } from "./+types/new";
import { redirect } from "react-router";
import { db } from "~/lib/db/connection";
import { hosts, hostGroups, hostLabels, hostLabelAssignments, accessLists } from "~/lib/db/schema";
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
  const acls = db.select({ id: accessLists.id, name: accessLists.name }).from(accessLists).all();
  return { groups, labels, accessLists: acls };
}

export async function action({ request }: Route.ActionArgs) {
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

  const result = db.insert(hosts)
    .values({
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
    details: { domains: data.domains },
    ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
  });

  generateAllConfigs();
  reloadPingora();

  return redirect("/admin/hosts");
}

export default function NewHost({ loaderData }: Route.ComponentProps) {
  const { groups, labels, accessLists: acls } = loaderData;

  return (
    <div>
      <div className="flex items-center min-h-10 mb-6">
        <h1 className="text-2xl font-bold">Add Host</h1>
      </div>
      <HostForm groups={groups} labels={labels} accessLists={acls} submitLabel="Create Host" />
    </div>
  );
}
