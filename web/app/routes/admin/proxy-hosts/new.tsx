import type { Route } from "./+types/new";
import { redirect } from "react-router";
import { db } from "~/lib/db/connection";
import { proxyHosts, hostGroups } from "~/lib/db/schema";
import { ProxyHostForm, type ProxyHostFormData } from "~/components/proxy-host-form/ProxyHostForm";
import { logAudit } from "~/lib/audit/log";
import { getSessionUser } from "~/lib/auth/session.server";

export function meta() {
  return [{ title: "Add Proxy Host — Pingora Manager" }];
}

export async function loader({}: Route.LoaderArgs) {
  const groups = db.select().from(hostGroups).all();
  return { groups };
}

export async function action({ request }: Route.ActionArgs) {
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

  // Insert the new proxy host
  const result = db.insert(proxyHosts)
    .values({
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
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
    .get();

  const user = await getSessionUser(request);
  logAudit({
    userId: user?.userId ?? null,
    action: "create",
    entity: "proxy_host",
    entityId: result.id,
    details: { domains: data.domains },
    ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
  });

  return redirect("/admin/proxy-hosts");
}

export default function NewProxyHost({ loaderData }: Route.ComponentProps) {
  const { groups } = loaderData;

  return (
    <div>
      <div className="flex items-center min-h-10 mb-6">
        <h1 className="text-2xl font-bold">Add Proxy Host</h1>
      </div>
      <ProxyHostForm groups={groups} submitLabel="Create Proxy Host" />
    </div>
  );
}
