import type { Route } from "./+types/dashboard";
import { db } from "~/lib/db/connection";
import { proxyHosts, hostGroups, streams, redirections, healthChecks } from "~/lib/db/schema";
import { sql, desc } from "drizzle-orm";

export async function loader({}: Route.LoaderArgs) {
  const hostCount = db.select({ count: sql<number>`count(*)` }).from(proxyHosts).get();
  const groupCount = db.select({ count: sql<number>`count(*)` }).from(hostGroups).get();
  const streamCount = db.select({ count: sql<number>`count(*)` }).from(streams).get();
  const redirectCount = db.select({ count: sql<number>`count(*)` }).from(redirections).get();

  const latestHealth = db
    .select()
    .from(healthChecks)
    .orderBy(desc(healthChecks.checkedAt))
    .limit(50)
    .all();

  const upstreamStatus = new Map<string, { status: string; responseMs: number | null }>();
  for (const h of latestHealth) {
    if (!upstreamStatus.has(h.upstream)) {
      upstreamStatus.set(h.upstream, { status: h.status, responseMs: h.responseMs });
    }
  }

  const upCount = [...upstreamStatus.values()].filter((s) => s.status === "up").length;
  const downCount = [...upstreamStatus.values()].filter((s) => s.status === "down").length;

  return {
    hosts: hostCount?.count ?? 0,
    groups: groupCount?.count ?? 0,
    streams: streamCount?.count ?? 0,
    redirects: redirectCount?.count ?? 0,
    upstreamsUp: upCount,
    upstreamsDown: downCount,
  };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const d = loaderData;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Proxy Hosts" value={d.hosts} />
        <StatCard label="Groups" value={d.groups} />
        <StatCard label="Streams" value={d.streams} />
        <StatCard label="Redirections" value={d.redirects} />
        <StatCard label="Upstreams Up" value={d.upstreamsUp} color="green" />
        <StatCard label="Upstreams Down" value={d.upstreamsDown} color="red" />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: "green" | "red";
}) {
  const colorClass =
    color === "green"
      ? "text-green-600"
      : color === "red"
        ? "text-red-600"
        : "text-gray-900";

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}
