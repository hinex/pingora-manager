import type { Route } from "./+types/groups";
import { useFetcher } from "react-router";
import { db } from "~/lib/db/connection";
import { hostGroups, proxyHosts } from "~/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { useState } from "react";
import { requireEditor } from "~/lib/auth/middleware";
import { logAudit } from "~/lib/audit/log";
import { getSessionUser } from "~/lib/auth/session.server";

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
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Groups</h1>
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Add Group
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No groups configured yet.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Webhook URL
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Hosts
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {groups.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  onEdit={() => openEdit(group)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <GroupModal
          group={editGroup}
          onClose={() => setShowModal(false)}
        />
      )}
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
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDelete = () => {
    deleteFetcher.submit(
      { intent: "delete", id: String(group.id) },
      { method: "post" }
    );
    setShowConfirm(false);
  };

  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
        {group.name}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {group.description || "-"}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {group.webhookUrl ? (
          <span className="truncate block max-w-xs">{group.webhookUrl}</span>
        ) : (
          "-"
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {group.hostCount}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
        <button
          onClick={onEdit}
          className="text-blue-600 hover:text-blue-900"
        >
          Edit
        </button>
        <button
          onClick={() => setShowConfirm(true)}
          className="text-red-600 hover:text-red-900"
        >
          Delete
        </button>

        {showConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-sm">
              <h3 className="text-lg font-semibold mb-2">Confirm Delete</h3>
              <p className="text-gray-600 mb-4">
                Are you sure you want to delete the group "{group.name}"? This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

function GroupModal({
  group,
  onClose,
}: {
  group: { id: number; name: string; description: string | null; webhookUrl: string | null } | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">
          {group ? "Edit Group" : "Create Group"}
        </h3>
        <fetcher.Form method="post" onSubmit={() => setTimeout(onClose, 100)}>
          <input type="hidden" name="intent" value={group ? "update" : "create"} />
          {group && <input type="hidden" name="id" value={String(group.id)} />}

          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={group?.name ?? ""}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium mb-1">
                Description
              </label>
              <input
                id="description"
                name="description"
                type="text"
                defaultValue={group?.description ?? ""}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="webhookUrl" className="block text-sm font-medium mb-1">
                Webhook URL
              </label>
              <input
                id="webhookUrl"
                name="webhookUrl"
                type="url"
                defaultValue={group?.webhookUrl ?? ""}
                placeholder="https://..."
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {group ? "Update" : "Create"}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}
