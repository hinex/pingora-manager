import type { Route } from "./+types/streams";
import { useFetcher } from "react-router";
import { db } from "~/lib/db/connection";
import { streams, hostGroups } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { requireEditor } from "~/lib/auth/middleware";
import { generateAllConfigs } from "~/lib/config-generator/generate";
import { reloadPingora } from "~/lib/signal/reload";
import { logAudit } from "~/lib/audit/log";
import { getSessionUser } from "~/lib/auth/session.server";

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
    const upstreams = JSON.parse(formData.get("upstreams") as string);
    const balanceMethod = formData.get("balanceMethod") as string;
    const groupId = formData.get("groupId") ? Number(formData.get("groupId")) : null;
    const webhookUrl = (formData.get("webhookUrl") as string) || null;

    if (!incomingPort) return { error: "Port is required" };

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
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Streams</h1>
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Add Stream
        </button>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No streams configured yet.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Incoming Port
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Protocol
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Upstreams
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map((item) => (
                <StreamRow
                  key={item.id}
                  item={item}
                  onEdit={() => openEdit(item)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <StreamModal
          item={editItem}
          groups={groups}
          onClose={() => setShowModal(false)}
        />
      )}
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
  const [showConfirm, setShowConfirm] = useState(false);

  const upstreams = item.upstreams as Array<{ server: string; port: number; weight: number }>;

  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
        {item.incomingPort}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 uppercase">
        {item.protocol}
      </td>
      <td className="px-6 py-4 text-sm text-gray-500">
        {upstreams.map((u, i) => (
          <div key={i}>
            {u.server}:{u.port} (w:{u.weight})
          </div>
        ))}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span
          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
            item.enabled
              ? "bg-green-100 text-green-800"
              : "bg-gray-100 text-gray-800"
          }`}
        >
          {item.enabled ? "Enabled" : "Disabled"}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
        <button onClick={onEdit} className="text-blue-600 hover:text-blue-900">
          Edit
        </button>
        <button
          onClick={() =>
            toggleFetcher.submit(
              { intent: "toggle", id: String(item.id) },
              { method: "post" }
            )
          }
          disabled={toggleFetcher.state !== "idle"}
          className="text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          {item.enabled ? "Disable" : "Enable"}
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
                Are you sure you want to delete this stream?
              </p>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    deleteFetcher.submit(
                      { intent: "delete", id: String(item.id) },
                      { method: "post" }
                    );
                    setShowConfirm(false);
                  }}
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

function StreamModal({
  item,
  groups,
  onClose,
}: {
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
    const form = new FormData(e.currentTarget);
    form.set("upstreams", JSON.stringify(upstreams));
    form.set("intent", item ? "update" : "create");
    if (item) form.set("id", String(item.id));
    fetcher.submit(form, { method: "post" });
    setTimeout(onClose, 100);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">
          {item ? "Edit Stream" : "Create Stream"}
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="incomingPort" className="block text-sm font-medium mb-1">
                  Incoming Port
                </label>
                <input
                  id="incomingPort"
                  name="incomingPort"
                  type="number"
                  required
                  min={1}
                  max={65535}
                  defaultValue={item?.incomingPort ?? ""}
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="protocol" className="block text-sm font-medium mb-1">
                  Protocol
                </label>
                <select
                  id="protocol"
                  name="protocol"
                  defaultValue={item?.protocol ?? "tcp"}
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Upstreams</label>
              {upstreams.map((u, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={u.server}
                    onChange={(e) => updateUpstream(i, "server", e.target.value)}
                    placeholder="Server"
                    className="flex-1 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    value={u.port || ""}
                    onChange={(e) =>
                      updateUpstream(i, "port", Number(e.target.value))
                    }
                    placeholder="Port"
                    className="w-24 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    value={u.weight}
                    onChange={(e) =>
                      updateUpstream(i, "weight", Number(e.target.value))
                    }
                    placeholder="Weight"
                    className="w-20 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {upstreams.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeUpstream(i)}
                      className="text-red-500 hover:text-red-700 px-2"
                    >
                      X
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addUpstream}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                + Add Upstream
              </button>
            </div>

            <div>
              <label htmlFor="balanceMethod" className="block text-sm font-medium mb-1">
                Balance Method
              </label>
              <select
                id="balanceMethod"
                name="balanceMethod"
                defaultValue={item?.balanceMethod ?? "round_robin"}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="round_robin">Round Robin</option>
                <option value="weighted">Weighted</option>
                <option value="least_conn">Least Connections</option>
                <option value="ip_hash">IP Hash</option>
                <option value="random">Random</option>
              </select>
            </div>

            <div>
              <label htmlFor="groupId" className="block text-sm font-medium mb-1">
                Group
              </label>
              <select
                id="groupId"
                name="groupId"
                defaultValue={item?.groupId ?? ""}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">No Group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="webhookUrl" className="block text-sm font-medium mb-1">
                Webhook URL
              </label>
              <input
                id="webhookUrl"
                name="webhookUrl"
                type="url"
                defaultValue={item?.webhookUrl ?? ""}
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
              {item ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
