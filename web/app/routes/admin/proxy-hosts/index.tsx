import type { Route } from "./+types/index";
import { Link, useFetcher } from "react-router";
import { db } from "~/lib/db/connection";
import { proxyHosts, hostGroups } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { logAudit } from "~/lib/audit/log";
import { getSessionUser } from "~/lib/auth/session.server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Plus, MoreHorizontal, Pencil, Trash2, Power } from "lucide-react";

export function meta() {
  return [{ title: "Proxy Hosts — Pingora Manager" }];
}

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
    <div className="space-y-6">
      <div className="flex items-center justify-between min-h-10">
        <h1 className="text-2xl font-semibold tracking-tight">Proxy Hosts</h1>
        <Button asChild>
          <Link to="/admin/proxy-hosts/new">
            <Plus className="mr-2 h-4 w-4" />
            Add Proxy Host
          </Link>
        </Button>
      </div>

      {hosts.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No proxy hosts configured yet.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domains</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>SSL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[70px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hosts.map((host) => (
                <HostRow
                  key={host.id}
                  host={host}
                  groupName={host.groupId ? groupMap.get(host.groupId) || "-" : "-"}
                />
              ))}
            </TableBody>
          </Table>
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
  const [alertOpen, setAlertOpen] = useState(false);

  const domains = host.domains as string[];
  const sslLabel =
    host.sslType === "letsencrypt"
      ? "Let's Encrypt"
      : host.sslType === "custom"
        ? "Custom"
        : "None";

  const sslVariant =
    host.sslType === "letsencrypt"
      ? "default"
      : host.sslType === "custom"
        ? "secondary"
        : "outline";

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
    setAlertOpen(false);
  };

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {domains.map((d, i) => (
            <Badge key={i} variant="secondary">
              {d}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{groupName}</TableCell>
      <TableCell>
        <Badge variant={sslVariant as "default" | "secondary" | "outline"}>
          {sslLabel}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant={host.enabled ? "default" : "secondary"}>
          {host.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </TableCell>
      <TableCell>
        <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/admin/proxy-hosts/${host.id}/edit`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleToggle}
                disabled={toggleFetcher.state !== "idle"}
              >
                <Power className="mr-2 h-4 w-4" />
                {host.enabled ? "Disable" : "Enable"}
              </DropdownMenuItem>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={deleteFetcher.state !== "idle"}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </AlertDialogTrigger>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Delete</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this proxy host? This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}
