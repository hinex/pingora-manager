import type { Route } from "./+types/dashboard";
import { db } from "~/lib/db/connection";
import { hosts, hostGroups, healthChecks, auditLog, users } from "~/lib/db/schema";
import { sql, desc } from "drizzle-orm";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  Globe,
  Power,
  PowerOff,
  FolderOpen,
  Server,
  CircleCheck,
  CircleX,
  Activity,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "Dashboard — Pingora Manager" }];
}

export async function loader({}: Route.LoaderArgs) {
  const allHosts = db.select().from(hosts).all();
  const groupCount = db.select({ count: sql<number>`count(*)` }).from(hostGroups).get();

  const totalHosts = allHosts.length;
  const enabledHosts = allHosts.filter((h) => h.enabled).length;
  const disabledHosts = totalHosts - enabledHosts;

  // Health checks: latest per upstream
  const latestHealth = db
    .select()
    .from(healthChecks)
    .orderBy(desc(healthChecks.checkedAt))
    .limit(500)
    .all();

  const latestByUpstream = new Map<
    string,
    { hostId: number | null; hostType: string; upstream: string; status: string; responseMs: number | null; checkedAt: Date | null }
  >();
  for (const check of latestHealth) {
    const key = `${check.hostType}-${check.hostId}-${check.upstream}`;
    if (!latestByUpstream.has(key)) {
      latestByUpstream.set(key, {
        hostId: check.hostId,
        hostType: check.hostType,
        upstream: check.upstream,
        status: check.status,
        responseMs: check.responseMs,
        checkedAt: check.checkedAt,
      });
    }
  }

  const allChecks = [...latestByUpstream.values()];
  const upCount = allChecks.filter((c) => c.status === "up").length;
  const downCount = allChecks.filter((c) => c.status === "down").length;
  const downUpstreams = allChecks.filter((c) => c.status === "down");

  // Build hostId -> domains map for display
  const hostDomains = new Map<number, string[]>();
  for (const h of allHosts) {
    hostDomains.set(h.id, (h.domains as string[]) ?? []);
  }

  // Recent audit activity
  const recentAudit = db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(10)
    .all();

  // User map for audit display
  const allUsers = db.select({ id: users.id, email: users.email }).from(users).all();
  const userMap = new Map(allUsers.map((u) => [u.id, u.email]));

  return {
    totalHosts,
    enabledHosts,
    disabledHosts,
    groups: groupCount?.count ?? 0,
    totalUpstreams: allChecks.length,
    upstreamsUp: upCount,
    upstreamsDown: downCount,
    downUpstreams: downUpstreams.map((d) => ({
      ...d,
      domains: d.hostId ? hostDomains.get(d.hostId) ?? [] : [],
      checkedAt: d.checkedAt?.toISOString() ?? null,
    })),
    recentAudit: recentAudit.map((a) => ({
      id: a.id,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      userEmail: a.userId ? userMap.get(a.userId) ?? null : null,
      createdAt: a.createdAt?.toISOString() ?? null,
    })),
  };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const d = loaderData;

  return (
    <div className="space-y-6">
      <div className="flex items-center min-h-10">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      </div>

      {/* Row 1: Host stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Hosts" value={d.totalHosts} icon={Globe} />
        <StatCard label="Enabled" value={d.enabledHosts} color="green" icon={Power} />
        <StatCard label="Disabled" value={d.disabledHosts} color="red" icon={PowerOff} />
        <StatCard label="Groups" value={d.groups} icon={FolderOpen} />
      </div>

      {/* Row 2: Health stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Upstreams" value={d.totalUpstreams} icon={Server} />
        <StatCard label="Upstreams Up" value={d.upstreamsUp} color="green" icon={CircleCheck} />
        <StatCard label="Upstreams Down" value={d.upstreamsDown} color="red" icon={CircleX} />
      </div>

      {/* Unhealthy Upstreams */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <CircleX className="h-5 w-5 text-destructive" />
            <h2 className="text-lg font-medium">Unhealthy Upstreams</h2>
          </div>
          {d.downUpstreams.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <CircleCheck className="h-4 w-4 text-emerald-500" />
              All upstreams are healthy
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>Upstream</TableHead>
                  <TableHead>Response Time</TableHead>
                  <TableHead>Last Checked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.downUpstreams.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {item.domains.slice(0, 2).map((domain, di) => (
                          <Badge key={di} variant="secondary" className="text-xs">
                            {domain}
                          </Badge>
                        ))}
                        {item.domains.length > 2 && (
                          <Badge variant="outline" className="text-xs">
                            +{item.domains.length - 2}
                          </Badge>
                        )}
                        {item.domains.length === 0 && (
                          <span className="text-muted-foreground text-xs">
                            Host #{item.hostId ?? "?"}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{item.upstream}</TableCell>
                    <TableCell>
                      {item.responseMs != null ? `${item.responseMs}ms` : "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {item.checkedAt
                        ? new Date(item.checkedAt).toLocaleString()
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-medium">Recent Activity</h2>
          </div>
          {d.recentAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No recent activity.</p>
          ) : (
            <div className="space-y-2">
              {d.recentAudit.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 text-sm py-1.5 border-b border-border last:border-0"
                >
                  <span className="text-muted-foreground text-xs shrink-0 w-36">
                    {entry.createdAt
                      ? new Date(entry.createdAt).toLocaleString()
                      : "-"}
                  </span>
                  <ActionBadge action={entry.action} />
                  <span className="text-muted-foreground">{entry.entity}</span>
                  {entry.entityId && (
                    <span className="text-muted-foreground">#{entry.entityId}</span>
                  )}
                  {entry.userEmail && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {entry.userEmail}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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

function ActionBadge({ action }: { action: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    create: "default",
    update: "secondary",
    delete: "destructive",
    login: "outline",
    logout: "outline",
    reload: "secondary",
  };
  return (
    <Badge variant={variants[action] ?? "outline"} className="text-xs capitalize shrink-0">
      {action}
    </Badge>
  );
}
