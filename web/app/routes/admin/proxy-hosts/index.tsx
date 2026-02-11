import type { Route } from "./+types/index";
import { Link, useFetcher } from "react-router";
import { db } from "~/lib/db/connection";
import { proxyHosts, hostGroups } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { logAudit } from "~/lib/audit/log";
import { getSessionUser } from "~/lib/auth/session.server";

export async function loader({}: Route.LoaderArgs) {
  const hosts = db.select().from(proxyHosts).all();
  const groups = db.select().from(hostGroups).all();

  return { hosts, groups };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = Number(formData.get("id"));
  const user = await getSessionUser(request);
  const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";

  if (intent === "delete") {
    db.delete(proxyHosts).where(eq(proxyHosts.id, id)).run();
    logAudit({
      userId: user?.userId ?? null,
      action: "delete",
      entity: "proxy_host",
      entityId: id,
      ipAddress,
    });
  } else if (intent === "toggle") {
    const host = db.select().from(proxyHosts).where(eq(proxyHosts.id, id)).get();
    if (host) {
      db.update(proxyHosts)
        .set({ enabled: !host.enabled, updatedAt: new Date() })
        .where(eq(proxyHosts.id, id))
        .run();
      logAudit({
        userId: user?.userId ?? null,
        action: "update",
        entity: "proxy_host",
        entityId: id,
        details: { enabled: !host.enabled },
        ipAddress,
      });
    }
  }

  return { ok: true };
}

export default function ProxyHostsIndex({ loaderData }: Route.ComponentProps) {
  const { hosts, groups } = loaderData;
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Proxy Hosts</h1>
        <Link
          to="/admin/proxy-hosts/new"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Add Proxy Host
        </Link>
      </div>

      {hosts.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No proxy hosts configured yet.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Domains
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Group
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  SSL
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {hosts.map((host) => (
                <HostRow
                  key={host.id}
                  host={host}
                  groupName={host.groupId ? groupMap.get(host.groupId) || "-" : "-"}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HostRow({
  host,
  groupName,
}: {
  host: typeof proxyHosts.$inferSelect;
  groupName: string;
}) {
  const toggleFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const [showConfirm, setShowConfirm] = useState(false);

  const domains = host.domains as string[];
  const sslLabel =
    host.sslType === "letsencrypt"
      ? "Let's Encrypt"
      : host.sslType === "custom"
        ? "Custom"
        : "None";

  const handleToggle = () => {
    toggleFetcher.submit(
      { intent: "toggle", id: String(host.id) },
      { method: "post" }
    );
  };

  const handleDelete = () => {
    deleteFetcher.submit(
      { intent: "delete", id: String(host.id) },
      { method: "post" }
    );
    setShowConfirm(false);
  };

  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">
          {domains.map((d, i) => (
            <div key={i}>{d}</div>
          ))}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {groupName}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {sslLabel}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span
          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
            host.enabled
              ? "bg-green-100 text-green-800"
              : "bg-gray-100 text-gray-800"
          }`}
        >
          {host.enabled ? "Enabled" : "Disabled"}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
        <Link
          to={`/admin/proxy-hosts/${host.id}/edit`}
          className="text-blue-600 hover:text-blue-900"
        >
          Edit
        </Link>
        <button
          onClick={handleToggle}
          disabled={toggleFetcher.state !== "idle"}
          className="text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          {host.enabled ? "Disable" : "Enable"}
        </button>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={deleteFetcher.state !== "idle"}
          className="text-red-600 hover:text-red-900 disabled:opacity-50"
        >
          Delete
        </button>

        {showConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-sm">
              <h3 className="text-lg font-semibold mb-2">Confirm Delete</h3>
              <p className="text-gray-600 mb-4">
                Are you sure you want to delete this proxy host? This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}
