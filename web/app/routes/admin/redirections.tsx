import type { Route } from "./+types/redirections";
import { useFetcher } from "react-router";
import { db } from "~/lib/db/connection";
import { redirections, hostGroups } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { requireEditor } from "~/lib/auth/middleware";
import { generateAllConfigs } from "~/lib/config-generator/generate";
import { reloadPingora } from "~/lib/signal/reload";
import { logAudit } from "~/lib/audit/log";
import { getSessionUser } from "~/lib/auth/session.server";

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
    const domains = JSON.parse(formData.get("domains") as string) as string[];
    const forwardScheme = formData.get("forwardScheme") as string;
    const forwardDomain = formData.get("forwardDomain") as string;
    const forwardPath = (formData.get("forwardPath") as string) || "/";
    const preservePath = formData.get("preservePath") === "true";
    const statusCode = Number(formData.get("statusCode")) || 301;
    const groupId = formData.get("groupId") ? Number(formData.get("groupId")) : null;
    const sslType = (formData.get("sslType") as string) || "none";

    if (!domains.length || !forwardDomain) {
      return { error: "Domains and forward domain are required" };
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
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Redirections</h1>
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Add Redirection
        </button>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No redirections configured yet.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Domains
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Target
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status Code
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
                <RedirectionRow
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
        <RedirectionModal
          item={editItem}
          groups={groups}
          onClose={() => setShowModal(false)}
        />
      )}
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
  const [showConfirm, setShowConfirm] = useState(false);

  const domains = item.domains as string[];
  const target = `${item.forwardScheme}://${item.forwardDomain}${item.forwardPath}`;

  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {domains.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {target}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {item.statusCode}
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
                Are you sure you want to delete this redirection?
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

function RedirectionModal({
  item,
  groups,
  onClose,
}: {
  item: (typeof redirections.$inferSelect) | null;
  groups: (typeof hostGroups.$inferSelect)[];
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";
  const [domains, setDomains] = useState<string[]>(
    item ? (item.domains as string[]) : [""]
  );

  const addDomain = () => setDomains([...domains, ""]);
  const removeDomain = (idx: number) =>
    setDomains(domains.filter((_, i) => i !== idx));
  const updateDomain = (idx: number, value: string) =>
    setDomains(domains.map((d, i) => (i === idx ? value : d)));

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const filteredDomains = domains.filter((d) => d.trim());
    form.set("domains", JSON.stringify(filteredDomains));
    form.set("intent", item ? "update" : "create");
    if (item) form.set("id", String(item.id));
    fetcher.submit(form, { method: "post" });
    setTimeout(onClose, 100);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">
          {item ? "Edit Redirection" : "Create Redirection"}
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Domains</label>
              {domains.map((d, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={d}
                    onChange={(e) => updateDomain(i, e.target.value)}
                    placeholder="example.com"
                    className="flex-1 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {domains.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDomain(i)}
                      className="text-red-500 hover:text-red-700 px-2"
                    >
                      X
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addDomain}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                + Add Domain
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="forwardScheme" className="block text-sm font-medium mb-1">
                  Scheme
                </label>
                <select
                  id="forwardScheme"
                  name="forwardScheme"
                  defaultValue={item?.forwardScheme ?? "https"}
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="http">http</option>
                  <option value="https">https</option>
                </select>
              </div>
              <div>
                <label htmlFor="statusCode" className="block text-sm font-medium mb-1">
                  Status Code
                </label>
                <select
                  id="statusCode"
                  name="statusCode"
                  defaultValue={item?.statusCode ?? 301}
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="301">301 (Permanent)</option>
                  <option value="302">302 (Temporary)</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="forwardDomain" className="block text-sm font-medium mb-1">
                Forward Domain
              </label>
              <input
                id="forwardDomain"
                name="forwardDomain"
                type="text"
                required
                defaultValue={item?.forwardDomain ?? ""}
                placeholder="example.com"
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="forwardPath" className="block text-sm font-medium mb-1">
                Forward Path
              </label>
              <input
                id="forwardPath"
                name="forwardPath"
                type="text"
                defaultValue={item?.forwardPath ?? "/"}
                placeholder="/"
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="preservePath"
                name="preservePath"
                type="checkbox"
                value="true"
                defaultChecked={item?.preservePath ?? true}
                className="rounded border-gray-300"
              />
              <label htmlFor="preservePath" className="text-sm font-medium">
                Preserve Path
              </label>
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
              <label htmlFor="sslType" className="block text-sm font-medium mb-1">
                SSL Type
              </label>
              <select
                id="sslType"
                name="sslType"
                defaultValue={item?.sslType ?? "none"}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="none">None</option>
                <option value="letsencrypt">Let's Encrypt</option>
                <option value="custom">Custom</option>
              </select>
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
