import type { Route } from "./+types/new";
import { redirect } from "react-router";
import { db } from "~/lib/db/connection";
import { proxyHosts, hostGroups } from "~/lib/db/schema";
import { ProxyHostForm, type ProxyHostFormData } from "~/components/proxy-host-form/ProxyHostForm";
import { logAudit } from "~/lib/audit/log";
import { getSessionUser } from "~/lib/auth/session.server";

export async function loader({}: Route.LoaderArgs) {
  const groups = db.select().from(hostGroups).all();
  return { groups };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const data: ProxyHostFormData = JSON.parse(formData.get("formData") as string);

  // Validation
  if (!data.domains || data.domains.length === 0) {
    throw new Error("At least one domain is required");
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
      <h1 className="text-2xl font-bold mb-6">Add Proxy Host</h1>
      <ProxyHostForm groups={groups} submitLabel="Create Proxy Host" />
    </div>
  );
}
