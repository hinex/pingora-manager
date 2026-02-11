import type { Route } from "./+types/redirections";
import { useFetcher } from "react-router";
import { db } from "~/lib/db/connection";
import { redirections, hostGroups } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { useState, useEffect } from "react";
import { toast } from "sonner";
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
import { Checkbox } from "~/components/ui/checkbox";
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

export function meta() {
  return [{ title: "Redirections — Pingora Manager" }];
}

export async function loader({}: Route.LoaderArgs) {
  const allRedirections = db.select().from(redirections).all();
  const groups = db.select().from(hostGroups).all();
  return { redirections: allRedirections, groups };
}

export async function action({ request }: Route.ActionArgs) {
  await requireEditor(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const user = await getSessionUser(request);
  const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";

  if (intent === "create" || intent === "update") {
    let domains: string[];
    try {
      domains = JSON.parse(formData.get("domains") as string);
    } catch {
      return { error: "Invalid domain data" };
    }
    const forwardScheme = formData.get("forwardScheme") as string;
    const forwardDomain = formData.get("forwardDomain") as string;
    const forwardPath = (formData.get("forwardPath") as string) || "/";
    const preservePath = formData.get("preservePath") === "true";
    const statusCode = Number(formData.get("statusCode")) || 301;
    const groupId = formData.get("groupId") ? Number(formData.get("groupId")) : null;
    const sslType = (formData.get("sslType") as string) || "none";

    if (!domains.length) {
      return { error: "At least one domain is required" };
    }
    if (!forwardDomain?.trim()) {
      return { error: "Forward domain is required" };
    }
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
    for (const d of domains) {
      if (!domainRegex.test(d) && !d.startsWith("*.")) {
        return { error: `Invalid domain format: ${d}` };
      }
    }

    if (intent === "create") {
      const result = db.insert(redirections)
        .values({
          domains,
          forwardScheme,
          forwardDomain,
          forwardPath,
          preservePath,
          statusCode,
          groupId,
          sslType: sslType as "none" | "letsencrypt" | "custom",
          createdAt: new Date(),
        })
        .returning()
        .get();

      logAudit({
        userId: user?.userId ?? null,
        action: "create",
        entity: "redirection",
        entityId: result.id,
        details: { domains },
        ipAddress,
      });
    } else {
      const id = Number(formData.get("id"));
      db.update(redirections)
        .set({
          domains,
          forwardScheme,
          forwardDomain,
          forwardPath,
          preservePath,
          statusCode,
          groupId,
          sslType: sslType as "none" | "letsencrypt" | "custom",
        })
        .where(eq(redirections.id, id))
        .run();

      logAudit({
        userId: user?.userId ?? null,
        action: "update",
        entity: "redirection",
        entityId: id,
        details: { domains },
        ipAddress,
      });
    }

    generateAllConfigs();
    reloadPingora();
  } else if (intent === "toggle") {
    const id = Number(formData.get("id"));
    const item = db.select().from(redirections).where(eq(redirections.id, id)).get();
    if (item) {
      db.update(redirections)
        .set({ enabled: !item.enabled })
        .where(eq(redirections.id, id))
        .run();

      logAudit({
        userId: user?.userId ?? null,
        action: "update",
        entity: "redirection",
        entityId: id,
        details: { enabled: !item.enabled },
        ipAddress,
      });

      generateAllConfigs();
      reloadPingora();
    }
  } else if (intent === "delete") {
    const id = Number(formData.get("id"));
    db.delete(redirections).where(eq(redirections.id, id)).run();

    logAudit({
      userId: user?.userId ?? null,
      action: "delete",
      entity: "redirection",
      entityId: id,
      ipAddress,
    });

    generateAllConfigs();
    reloadPingora();
  }

  return { ok: true };
}

export default function RedirectionsPage({ loaderData }: Route.ComponentProps) {
  const { redirections: items, groups } = loaderData;
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
        <h1 className="text-2xl font-semibold tracking-tight">Redirections</h1>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Redirection
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No redirections configured yet.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domains</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[70px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <RedirectionRow
                  key={item.id}
                  item={item}
                  onEdit={() => openEdit(item)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <RedirectionModal
        open={showModal}
        item={editItem}
        groups={groups}
        onClose={() => setShowModal(false)}
      />
    </div>
  );
}

function RedirectionRow({
  item,
  onEdit,
}: {
  item: typeof redirections.$inferSelect;
  onEdit: () => void;
}) {
  const toggleFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const [alertOpen, setAlertOpen] = useState(false);

  const domains = item.domains as string[];
  const target = `${item.forwardScheme}://${item.forwardDomain}${item.forwardPath}`;

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
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {domains.map((d, i) => (
            <Badge key={i} variant="secondary">
              {d}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{target}</TableCell>
      <TableCell>
        <Badge variant="outline">{item.statusCode}</Badge>
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
                Are you sure you want to delete this redirection? This action
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

function RedirectionModal({
  open,
  item,
  groups,
  onClose,
}: {
  open: boolean;
  item: (typeof redirections.$inferSelect) | null;
  groups: (typeof hostGroups.$inferSelect)[];
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";
  const [domains, setDomains] = useState<string[]>(
    item ? (item.domains as string[]) : [""]
  );
  const [preservePath, setPreservePath] = useState(item?.preservePath ?? true);

  const addDomain = () => setDomains([...domains, ""]);
  const removeDomain = (idx: number) =>
    setDomains(domains.filter((_, i) => i !== idx));
  const updateDomain = (idx: number, value: string) =>
    setDomains(domains.map((d, i) => (i === idx ? value : d)));

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const filteredDomains = domains.filter((d) => d.trim());
    if (filteredDomains.length === 0) {
      toast.error("At least one domain is required");
      return;
    }
    const domainRegex = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
    for (const d of filteredDomains) {
      if (!domainRegex.test(d)) {
        toast.error(`Invalid domain format: "${d}"`);
        return;
      }
    }
    const forwardDomain = (form.get("forwardDomain") as string)?.trim();
    if (!forwardDomain) {
      toast.error("Forward domain is required");
      return;
    }
    form.set("domains", JSON.stringify(filteredDomains));
    form.set("intent", item ? "update" : "create");
    form.set("preservePath", String(preservePath));
    if (item) form.set("id", String(item.id));
    fetcher.submit(form, { method: "post" });
  };

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    } else if (fetcher.data?.ok) {
      toast.success(item ? "Redirection updated" : "Redirection created");
      onClose();
    }
  }, [fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {item ? "Edit Redirection" : "Create Redirection"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Domains</Label>
              {domains.map((d, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    type="text"
                    value={d}
                    onChange={(e) => updateDomain(i, e.target.value)}
                    placeholder="example.com"
                  />
                  {domains.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => removeDomain(i)}
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
                onClick={addDomain}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Domain
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="forwardScheme">Scheme</Label>
                <select
                  id="forwardScheme"
                  name="forwardScheme"
                  defaultValue={item?.forwardScheme ?? "https"}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="http">http</option>
                  <option value="https">https</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="statusCode">Status Code</Label>
                <select
                  id="statusCode"
                  name="statusCode"
                  defaultValue={item?.statusCode ?? 301}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="301">301 (Permanent)</option>
                  <option value="302">302 (Temporary)</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="forwardDomain">Forward Domain</Label>
              <Input
                id="forwardDomain"
                name="forwardDomain"
                type="text"
                required
                defaultValue={item?.forwardDomain ?? ""}
                placeholder="example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="forwardPath">Forward Path</Label>
              <Input
                id="forwardPath"
                name="forwardPath"
                type="text"
                defaultValue={item?.forwardPath ?? "/"}
                placeholder="/"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="preservePath"
                checked={preservePath}
                onCheckedChange={(checked) =>
                  setPreservePath(checked === true)
                }
              />
              <Label htmlFor="preservePath" className="font-normal">
                Preserve Path
              </Label>
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
              <Label htmlFor="sslType">SSL Type</Label>
              <select
                id="sslType"
                name="sslType"
                defaultValue={item?.sslType ?? "none"}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="none">None</option>
                <option value="letsencrypt">Let's Encrypt</option>
                <option value="custom">Custom</option>
              </select>
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
