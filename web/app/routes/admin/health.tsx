import type { Route } from "./+types/health";
import { db } from "~/lib/db/connection";
import { healthChecks } from "~/lib/db/schema";
import { desc } from "drizzle-orm";

export async function loader({}: Route.LoaderArgs) {
  const allChecks = db
    .select()
    .from(healthChecks)
    .orderBy(desc(healthChecks.checkedAt))
    .limit(500)
    .all();

  // Get latest check per upstream
  const latestByUpstream = new Map<
    string,
    typeof healthChecks.$inferSelect
  >();
  for (const check of allChecks) {
    const key = `${check.hostType}-${check.hostId}-${check.upstream}`;
    if (!latestByUpstream.has(key)) {
      latestByUpstream.set(key, check);
    }
  }

  const checks = [...latestByUpstream.values()].sort((a, b) => {
    if (a.hostId !== b.hostId) return (a.hostId ?? 0) - (b.hostId ?? 0);
    return a.upstream.localeCompare(b.upstream);
  });

  return { checks };
}

export default function HealthPage({ loaderData }: Route.ComponentProps) {
  const { checks } = loaderData;

  const upCount = checks.filter((c) => c.status === "up").length;
  const downCount = checks.filter((c) => c.status === "down").length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Health Dashboard</h1>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Total Upstreams</p>
          <p className="text-3xl font-bold text-gray-900">{checks.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Up</p>
          <p className="text-3xl font-bold text-green-600">{upCount}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Down</p>
          <p className="text-3xl font-bold text-red-600">{downCount}</p>
        </div>
      </div>

      {checks.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No health check data available yet.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Host Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Host ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Upstream
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Response Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Checked
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {checks.map((check) => (
                <tr key={check.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                    {check.hostType}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {check.hostId ?? "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                    {check.upstream}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        check.status === "up"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {check.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {check.responseMs != null ? `${check.responseMs}ms` : "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {check.checkedAt
                      ? new Date(check.checkedAt).toLocaleString()
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
