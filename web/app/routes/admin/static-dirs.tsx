import type { Route } from "./+types/static-dirs";
import { Link } from "react-router";
import { db } from "~/lib/db/connection";
import { proxyHosts } from "~/lib/db/schema";

interface StaticLocation {
  hostId: number;
  domains: string[];
  locationPath: string;
  staticDir: string;
  cacheExpires: string;
}

export async function loader({}: Route.LoaderArgs) {
  const hosts = db.select().from(proxyHosts).all();

  const staticLocations: StaticLocation[] = [];

  for (const host of hosts) {
    const domains = host.domains as string[];
    const locations = (host.locations ?? []) as Array<{
      path: string;
      type: string;
      staticDir?: string;
      cacheExpires?: string;
    }>;

    for (const loc of locations) {
      if (loc.type === "static") {
        staticLocations.push({
          hostId: host.id,
          domains,
          locationPath: loc.path,
          staticDir: loc.staticDir ?? "",
          cacheExpires: loc.cacheExpires ?? "-",
        });
      }
    }
  }

  return { staticLocations };
}

export default function StaticDirsPage({ loaderData }: Route.ComponentProps) {
  const { staticLocations } = loaderData;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Static Directories</h1>

      {staticLocations.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No static directory locations found. Add static locations to your proxy hosts.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Host Domains
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Location Path
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Static Directory
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cache Expires
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {staticLocations.map((loc, i) => (
                <tr key={i}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {loc.domains.map((d, di) => (
                      <div key={di}>{d}</div>
                    ))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                    {loc.locationPath}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                    {loc.staticDir}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {loc.cacheExpires}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <Link
                      to={`/admin/proxy-hosts/${loc.hostId}/edit`}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      Edit Host
                    </Link>
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
