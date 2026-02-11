import type { Route } from "./+types/static-dirs";
import { Link } from "react-router";
import { db } from "~/lib/db/connection";
import { proxyHosts } from "~/lib/db/schema";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ExternalLink } from "lucide-react";

interface StaticLocation {
  hostId: number;
  domains: string[];
  locationPath: string;
  staticDir: string;
  cacheExpires: string;
}

export function meta() {
  return [{ title: "Static Directories — Pingora Manager" }];
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
      <div className="flex justify-between items-center min-h-10 mb-6">
        <h1 className="text-2xl font-bold">Static Directories</h1>
      </div>

      {staticLocations.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No static directory locations found.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host Domains</TableHead>
                <TableHead>Location Path</TableHead>
                <TableHead>Static Directory</TableHead>
                <TableHead>Cache Expires</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staticLocations.map((loc, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {loc.domains.map((d, di) => (
                        <Badge key={di} variant="outline">{d}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs font-mono text-muted-foreground">{loc.locationPath}</code>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs font-mono text-muted-foreground">{loc.staticDir}</code>
                  </TableCell>
                  <TableCell>{loc.cacheExpires}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/admin/proxy-hosts/${loc.hostId}/edit`}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Edit Host
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
