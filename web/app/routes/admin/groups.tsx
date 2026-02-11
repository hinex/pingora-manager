import type { Route } from "./+types/groups";
import { useFetcher } from "react-router";
import { db } from "~/lib/db/connection";
import { hostGroups, proxyHosts } from "~/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { requireEditor } from "~/lib/auth/middleware";
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
import { Plus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export function meta() {
  return [{ title: "Groups — Pingora Manager" }];
}

export async function loader({}: Route.LoaderArgs) {
  const groups = db.select().from(hostGroups).all();

  const hostCounts = db
    .select({
      groupId: proxyHosts.groupId,
      count: sql<number>`count(*)`,
    })
    .from(proxyHosts)
    .groupBy(proxyHosts.groupId)
    .all();

  const countMap = new Map(hostCounts.map((h) => [h.groupId, h.count]));

  return {
    groups: groups.map((g) => ({
      ...g,
      hostCount: countMap.get(g.id) ?? 0,
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireEditor(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const user = await getSessionUser(request);
  const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";

  if (intent === "create") {
    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;
    const webhookUrl = (formData.get("webhookUrl") as string) || null;

    if (!name) return { error: "Name is required" };

    if (webhookUrl && !/^https?:\/\/.+/.test(webhookUrl)) {
      return { error: "Webhook URL must be a valid HTTP/HTTPS URL" };
    }

    const result = db.insert(hostGroups)
      .values({ name, description, webhookUrl, createdAt: new Date() })
      .returning()
      .get();

    logAudit({
      userId: user?.userId ?? null,
      action: "create",
      entity: "group",
      entityId: result.id,
      details: { name },
      ipAddress,
    });
  } else if (intent === "update") {
    const id = Number(formData.get("id"));
    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;
    const webhookUrl = (formData.get("webhookUrl") as string) || null;

    if (!name) return { error: "Name is required" };

    if (webhookUrl && !/^https?:\/\/.+/.test(webhookUrl)) {
      return { error: "Webhook URL must be a valid HTTP/HTTPS URL" };
    }

    db.update(hostGroups)
      .set({ name, description, webhookUrl })
      .where(eq(hostGroups.id, id))
      .run();

    logAudit({
      userId: user?.userId ?? null,
      action: "update",
      entity: "group",
      entityId: id,
      details: { name },
      ipAddress,
    });
  } else if (intent === "delete") {
    const id = Number(formData.get("id"));
    db.delete(hostGroups).where(eq(hostGroups.id, id)).run();

    logAudit({
      userId: user?.userId ?? null,
      action: "delete",
      entity: "group",
      entityId: id,
      ipAddress,
    });
  }

  return { ok: true };
}

export default function GroupsPage({ loaderData }: Route.ComponentProps) {
  const { groups } = loaderData;
  const [showModal, setShowModal] = useState(false);
  const [editGroup, setEditGroup] = useState<(typeof groups)[0] | null>(null);

  const openCreate = () => {
    setEditGroup(null);
    setShowModal(true);
  };

  const openEdit = (group: (typeof groups)[0]) => {
    setEditGroup(group);
    setShowModal(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between min-h-10">
        <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Group
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No groups configured yet.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Webhook URL</TableHead>
                <TableHead>Hosts</TableHead>
                <TableHead className="w-[70px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  onEdit={() => openEdit(group)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <GroupModal
        open={showModal}
        group={editGroup}
        onClose={() => setShowModal(false)}
      />
    </div>
  );
}

function GroupRow({
  group,
  onEdit,
}: {
  group: { id: number; name: string; description: string | null; webhookUrl: string | null; hostCount: number };
  onEdit: () => void;
}) {
  const deleteFetcher = useFetcher();
  const [alertOpen, setAlertOpen] = useState(false);

  const handleDelete = () => {
    deleteFetcher.submit(
      { intent: "delete", id: String(group.id) },
      { method: "post" }
    );
    setAlertOpen(false);
  };

  return (
    <TableRow>
      <TableCell className="font-medium">{group.name}</TableCell>
      <TableCell className="text-muted-foreground">
        {group.description || "-"}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {group.webhookUrl ? (
          <span className="block max-w-xs truncate">{group.webhookUrl}</span>
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{group.hostCount}</TableCell>
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
              <AlertDialogTrigger asChild>
                <DropdownMenuItem className="text-destructive focus:text-destructive">
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
                Are you sure you want to delete the group &quot;{group.name}&quot;?
                This action cannot be undone.
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

function GroupModal({
  open,
  group,
  onClose,
}: {
  open: boolean;
  group: { id: number; name: string; description: string | null; webhookUrl: string | null } | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = (form.get("name") as string)?.trim();

    if (!name) {
      toast.error("Group name is required");
      return;
    }

    const webhookUrl = form.get("webhookUrl") as string;
    if (webhookUrl && !/^https?:\/\/.+/.test(webhookUrl)) {
      toast.error("Webhook URL must be a valid HTTP/HTTPS URL");
      return;
    }

    form.set("intent", group ? "update" : "create");
    if (group) form.set("id", String(group.id));

    fetcher.submit(form, { method: "post" });
  };

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    } else if (fetcher.data?.ok) {
      toast.success(group ? "Group updated" : "Group created");
      onClose();
    }
  }, [fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{group ? "Edit Group" : "Create Group"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={group?.name ?? ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                type="text"
                defaultValue={group?.description ?? ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Webhook URL</Label>
              <Input
                id="webhookUrl"
                name="webhookUrl"
                type="url"
                defaultValue={group?.webhookUrl ?? ""}
                placeholder="https://..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {group ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
