import type { Route } from "./+types/streams";
import { useFetcher } from "react-router";
import { db } from "~/lib/db/connection";
import { streams, hostGroups } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { useState, useEffect } from "react";
import { requireEditor } from "~/lib/auth/middleware";
import { generateAllConfigs } from "~/lib/config-generator/generate";
import { reloadPingora } from "~/lib/signal/reload";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
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
import { Plus, MoreHorizontal, Pencil, Trash2, Power, X } from "lucide-react";
import { toast } from "sonner";

export function meta() {
  return [{ title: "Streams — Pingora Manager" }];
}

export async function loader({}: Route.LoaderArgs) {
  const allStreams = db.select().from(streams).all();
  const groups = db.select().from(hostGroups).all();
  return { streams: allStreams, groups };
}

export async function action({ request }: Route.ActionArgs) {
  await requireEditor(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const user = await getSessionUser(request);
  const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";

  if (intent === "create" || intent === "update") {
    const incomingPort = Number(formData.get("incomingPort"));
    const protocol = formData.get("protocol") as string;
    const balanceMethod = formData.get("balanceMethod") as string;
    const groupId = formData.get("groupId") ? Number(formData.get("groupId")) : null;
    const webhookUrl = (formData.get("webhookUrl") as string) || null;

    if (!incomingPort) return { error: "Port is required" };
    if (incomingPort < 1 || incomingPort > 65535) return { error: "Port must be between 1 and 65535" };

    let upstreams;
    try {
      upstreams = JSON.parse(formData.get("upstreams") as string);
    } catch {
      return { error: "Invalid upstream data" };
    }

    if (!Array.isArray(upstreams) || upstreams.length === 0) return { error: "At least one upstream is required" };
    for (const u of upstreams) {
      if (!u.server?.trim()) return { error: "All upstreams must have a server address" };
      if (!u.port || u.port < 1 || u.port > 65535) return { error: "Upstream port must be between 1 and 65535" };
    }

    if (intent === "create") {
      const result = db.insert(streams)
        .values({
          incomingPort,
          protocol: protocol as "tcp" | "udp",
          upstreams,
          balanceMethod: balanceMethod as any,
          groupId,
          webhookUrl,
          createdAt: new Date(),
        })
        .returning()
        .get();

      logAudit({
        userId: user?.userId ?? null,
        action: "create",
        entity: "stream",
        entityId: result.id,
        details: { incomingPort, protocol },
        ipAddress,
      });
    } else {
      const id = Number(formData.get("id"));
      db.update(streams)
        .set({
          incomingPort,
          protocol: protocol as "tcp" | "udp",
          upstreams,
          balanceMethod: balanceMethod as any,
          groupId,
          webhookUrl,
        })
        .where(eq(streams.id, id))
        .run();

      logAudit({
        userId: user?.userId ?? null,
        action: "update",
        entity: "stream",
        entityId: id,
        details: { incomingPort, protocol },
        ipAddress,
      });
    }

    generateAllConfigs();
    reloadPingora();
  } else if (intent === "toggle") {
    const id = Number(formData.get("id"));
    const item = db.select().from(streams).where(eq(streams.id, id)).get();
    if (item) {
      db.update(streams)
        .set({ enabled: !item.enabled })
        .where(eq(streams.id, id))
        .run();

      logAudit({
        userId: user?.userId ?? null,
        action: "update",
        entity: "stream",
        entityId: id,
        details: { enabled: !item.enabled },
        ipAddress,
      });

      generateAllConfigs();
      reloadPingora();
    }
  } else if (intent === "delete") {
    const id = Number(formData.get("id"));
    db.delete(streams).where(eq(streams.id, id)).run();

    logAudit({
      userId: user?.userId ?? null,
      action: "delete",
      entity: "stream",
      entityId: id,
      ipAddress,
    });

    generateAllConfigs();
    reloadPingora();
  }

  return { ok: true };
}

export default function StreamsPage({ loaderData }: Route.ComponentProps) {
  const { streams: items, groups } = loaderData;
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<(typeof items)[0] | null>(null);

  const openCreate = () => {
    setEditItem(null);
    setShowModal(true);
  };

  const openEdit = (item: (typeof items)[0]) => {
    setEditItem(item);
    setShowModal(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between min-h-10">
        <h1 className="text-2xl font-semibold tracking-tight">Streams</h1>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Stream
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No streams configured yet.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Port</TableHead>
                <TableHead>Protocol</TableHead>
                <TableHead>Upstreams</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[70px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <StreamRow
                  key={item.id}
                  item={item}
                  onEdit={() => openEdit(item)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <StreamModal
        open={showModal}
        item={editItem}
        groups={groups}
        onClose={() => setShowModal(false)}
      />
    </div>
  );
}

function StreamRow({
  item,
  onEdit,
}: {
  item: typeof streams.$inferSelect;
  onEdit: () => void;
}) {
  const toggleFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const [alertOpen, setAlertOpen] = useState(false);

  const upstreams = item.upstreams as Array<{ server: string; port: number; weight: number }>;

  const handleToggle = () => {
    toggleFetcher.submit(
      { intent: "toggle", id: String(item.id) },
      { method: "post" }
    );
  };

  const handleDelete = () => {
    deleteFetcher.submit(
      { intent: "delete", id: String(item.id) },
      { method: "post" }
    );
    setAlertOpen(false);
  };

  return (
    <TableRow>
      <TableCell className="font-medium">{item.incomingPort}</TableCell>
      <TableCell>
        <Badge variant="outline" className="uppercase">
          {item.protocol}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        <div className="space-y-0.5 text-sm">
          {upstreams.map((u, i) => (
            <div key={i}>
              {u.server}:{u.port}{" "}
              <span className="text-xs text-muted-foreground/70">
                (w:{u.weight})
              </span>
            </div>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={item.enabled ? "default" : "secondary"}>
          {item.enabled ? "Enabled" : "Disabled"}
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
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleToggle}
                disabled={toggleFetcher.state !== "idle"}
              >
                <Power className="mr-2 h-4 w-4" />
                {item.enabled ? "Disable" : "Enable"}
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
                Are you sure you want to delete this stream? This action cannot
                be undone.
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

function StreamModal({
  open,
  item,
  groups,
  onClose,
}: {
  open: boolean;
  item: (typeof streams.$inferSelect) | null;
  groups: (typeof hostGroups.$inferSelect)[];
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  const initialUpstreams = item
    ? (item.upstreams as Array<{ server: string; port: number; weight: number }>)
    : [{ server: "", port: 0, weight: 1 }];

  const [upstreams, setUpstreams] = useState(initialUpstreams);

  const addUpstream = () =>
    setUpstreams([...upstreams, { server: "", port: 0, weight: 1 }]);
  const removeUpstream = (idx: number) =>
    setUpstreams(upstreams.filter((_, i) => i !== idx));
  const updateUpstream = (idx: number, field: string, value: string | number) =>
    setUpstreams(
      upstreams.map((u, i) => (i === idx ? { ...u, [field]: value } : u))
    );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const port = Number(new FormData(e.currentTarget).get("incomingPort"));
    if (!port || port < 1 || port > 65535) {
      toast.error("Port must be between 1 and 65535");
      return;
    }

    if (upstreams.length === 0) {
      toast.error("At least one upstream is required");
      return;
    }
    const emptyUpstreams = upstreams.filter(u => !u.server.trim());
    if (emptyUpstreams.length > 0) {
      toast.error("All upstreams must have a server address");
      return;
    }
    const badPorts = upstreams.filter(u => !u.port || u.port < 1 || u.port > 65535);
    if (badPorts.length > 0) {
      toast.error("All upstream ports must be between 1 and 65535");
      return;
    }

    const form = new FormData(e.currentTarget);
    form.set("upstreams", JSON.stringify(upstreams));
    form.set("intent", item ? "update" : "create");
    if (item) form.set("id", String(item.id));
    fetcher.submit(form, { method: "post" });
  };

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    } else if (fetcher.data?.ok) {
      toast.success(item ? "Stream updated" : "Stream created");
      onClose();
    }
  }, [fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {item ? "Edit Stream" : "Create Stream"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="incomingPort">Incoming Port</Label>
                <Input
                  id="incomingPort"
                  name="incomingPort"
                  type="number"
                  required
                  min={1}
                  max={65535}
                  defaultValue={item?.incomingPort ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="protocol">Protocol</Label>
                <select
                  id="protocol"
                  name="protocol"
                  defaultValue={item?.protocol ?? "tcp"}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Upstreams</Label>
              {upstreams.map((u, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    type="text"
                    value={u.server}
                    onChange={(e) => updateUpstream(i, "server", e.target.value)}
                    placeholder="Server"
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={u.port || ""}
                    onChange={(e) =>
                      updateUpstream(i, "port", Number(e.target.value))
                    }
                    placeholder="Port"
                    className="w-24"
                  />
                  <Input
                    type="number"
                    value={u.weight}
                    onChange={(e) =>
                      updateUpstream(i, "weight", Number(e.target.value))
                    }
                    placeholder="Weight"
                    className="w-20"
                  />
                  {upstreams.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => removeUpstream(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addUpstream}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Upstream
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="balanceMethod">Balance Method</Label>
              <select
                id="balanceMethod"
                name="balanceMethod"
                defaultValue={item?.balanceMethod ?? "round_robin"}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="round_robin">Round Robin</option>
                <option value="weighted">Weighted</option>
                <option value="least_conn">Least Connections</option>
                <option value="ip_hash">IP Hash</option>
                <option value="random">Random</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="groupId">Group</Label>
              <select
                id="groupId"
                name="groupId"
                defaultValue={item?.groupId ?? ""}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">No Group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Webhook URL</Label>
              <Input
                id="webhookUrl"
                name="webhookUrl"
                type="url"
                defaultValue={item?.webhookUrl ?? ""}
                placeholder="https://..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {item ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
