import type { Route } from "./+types/dashboard";
import { db } from "~/lib/db/connection";
import { proxyHosts, hostGroups, streams, redirections, healthChecks } from "~/lib/db/schema";
import { sql, desc } from "drizzle-orm";
import { Card, CardContent } from "~/components/ui/card";
import {
  Globe,
  FolderOpen,
  Radio,
  ArrowRightLeft,
  CircleCheck,
  CircleX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "Dashboard — Pingora Manager" }];
}

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
      <div className="flex items-center min-h-10 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Proxy Hosts" value={d.hosts} icon={Globe} />
        <StatCard label="Groups" value={d.groups} icon={FolderOpen} />
        <StatCard label="Streams" value={d.streams} icon={Radio} />
        <StatCard label="Redirections" value={d.redirects} icon={ArrowRightLeft} />
        <StatCard label="Upstreams Up" value={d.upstreamsUp} color="green" icon={CircleCheck} />
        <StatCard label="Upstreams Down" value={d.upstreamsDown} color="red" icon={CircleX} />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  color?: "green" | "red";
  icon: LucideIcon;
}) {
  return (
    <Card
      className={cn(
        "border-l-4",
        color === "green"
          ? "border-l-emerald-500"
          : color === "red"
            ? "border-l-destructive"
            : "border-l-primary"
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-3xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
