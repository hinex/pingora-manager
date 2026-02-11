import type { Route } from "./+types/edit";
import { redirect } from "react-router";
import { db } from "~/lib/db/connection";
import { proxyHosts, hostGroups } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { ProxyHostForm, type ProxyHostFormData } from "~/components/proxy-host-form/ProxyHostForm";
import { logAudit } from "~/lib/audit/log";
import { getSessionUser } from "~/lib/auth/session.server";

export function meta() {
  return [{ title: "Edit Proxy Host — Pingora Manager" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const id = Number(params.id);
  const host = db.select().from(proxyHosts).where(eq(proxyHosts.id, id)).get();

  if (!host) {
    throw new Response("Proxy host not found", { status: 404 });
  }

  const groups = db.select().from(hostGroups).all();

  return { host, groups };
}

export async function action({ request, params }: Route.ActionArgs) {
  const id = Number(params.id);
  const formData = await request.formData();
  let data: ProxyHostFormData;
  try {
    data = JSON.parse(formData.get("formData") as string);
  } catch {
    return { error: "Invalid form data" };
  }

  // Validation
  if (!data.domains || data.domains.length === 0) {
    return { error: "At least one domain is required" };
  }

  if (data.upstreams.length === 0 && data.locations.length === 0) {
    return { error: "At least one upstream or location is required" };
  }
  for (const u of data.upstreams) {
    if (!u.server?.trim()) return { error: "All upstreams must have a server address" };
    if (!u.port || u.port < 1 || u.port > 65535) return { error: "Upstream port must be between 1 and 65535" };
  }
  if (data.sslType === "custom" && (!data.sslCertPath || !data.sslKeyPath)) {
    return { error: "Custom SSL requires both certificate and key paths" };
  }

  // Update the proxy host
  db.update(proxyHosts)
    .set({
      domains: data.domains,
      groupId: data.groupId,
      enabled: data.enabled,
      upstreams: data.upstreams,
      balanceMethod: data.balanceMethod as any,
      locations: data.locations as any,
      sslType: data.sslType as any,
      sslCertPath: data.sslCertPath || null,
      sslKeyPath: data.sslKeyPath || null,
      sslForceHttps: data.sslForceHttps,
      hsts: data.hsts,
      http2: data.http2,
      webhookUrl: data.webhookUrl || null,
      advancedYaml: data.advancedYaml || null,
      updatedAt: new Date(),
    })
    .where(eq(proxyHosts.id, id))
    .run();

  const user = await getSessionUser(request);
  logAudit({
    userId: user?.userId ?? null,
    action: "update",
    entity: "proxy_host",
    entityId: id,
    details: { domains: data.domains },
    ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
  });

  return redirect("/admin/proxy-hosts");
}

export default function EditProxyHost({ loaderData }: Route.ComponentProps) {
  const { host, groups } = loaderData;

  const initialData: Partial<ProxyHostFormData> = {
    domains: host.domains as string[],
    groupId: host.groupId,
    enabled: host.enabled,
    upstreams: host.upstreams as any,
    balanceMethod: host.balanceMethod,
    locations: host.locations as any,
    sslType: host.sslType,
    sslCertPath: host.sslCertPath || "",
    sslKeyPath: host.sslKeyPath || "",
    sslForceHttps: host.sslForceHttps,
    hsts: host.hsts,
    http2: host.http2,
    webhookUrl: host.webhookUrl || "",
    advancedYaml: host.advancedYaml || "",
  };

  return (
    <div>
      <div className="flex items-center min-h-10 mb-6">
        <h1 className="text-2xl font-bold">Edit Proxy Host</h1>
      </div>
      <ProxyHostForm
        initialData={initialData}
        groups={groups}
        submitLabel="Update Proxy Host"
      />
    </div>
  );
}
