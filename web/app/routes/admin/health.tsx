import type { Route } from "./+types/health";
import { db } from "~/lib/db/connection";
import { healthChecks } from "~/lib/db/schema";
import { desc } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Server, CircleCheck, CircleX } from "lucide-react";

export function meta() {
  return [{ title: "Health — Pingora Manager" }];
}

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
      <div className="flex items-center min-h-10 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Health Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">Total Upstreams</p>
              <Server className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-3xl font-bold">{checks.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">Up</p>
              <CircleCheck className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-3xl font-bold text-emerald-500">{upCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">Down</p>
              <CircleX className="h-4 w-4 text-destructive" />
            </div>
            <p className="text-3xl font-bold text-destructive">{downCount}</p>
          </CardContent>
        </Card>
      </div>

      {checks.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No health check data available yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host Type</TableHead>
                <TableHead>Host ID</TableHead>
                <TableHead>Upstream</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Response Time</TableHead>
                <TableHead>Last Checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((check) => (
                <TableRow key={check.id}>
                  <TableCell className="capitalize">{check.hostType}</TableCell>
                  <TableCell>{check.hostId ?? "-"}</TableCell>
                  <TableCell className="font-mono">{check.upstream}</TableCell>
                  <TableCell>
                    {check.status === "up" ? (
                      <Badge>UP</Badge>
                    ) : (
                      <Badge variant="destructive">DOWN</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {check.responseMs != null ? `${check.responseMs}ms` : "-"}
                  </TableCell>
                  <TableCell>
                    {check.checkedAt
                      ? new Date(check.checkedAt).toLocaleString()
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
