import type { Route } from "./+types/access-lists";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { useFetcher } from "react-router";
import { db } from "~/lib/db/connection";
import { accessLists, accessListClients, accessListAuth } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { requireEditor } from "~/lib/auth/middleware";
import { generateAllConfigs } from "~/lib/config-generator/generate";
import { reloadPingora } from "~/lib/signal/reload";
import { logAudit } from "~/lib/audit/log";
import { getSessionUser } from "~/lib/auth/session.server";

export async function loader({}: Route.LoaderArgs) {
  const lists = db.select().from(accessLists).all();

  const enrichedLists = lists.map((list) => {
    const clients = db
      .select()
      .from(accessListClients)
      .where(eq(accessListClients.accessListId, list.id))
      .all();
    const auth = db
      .select()
      .from(accessListAuth)
      .where(eq(accessListAuth.accessListId, list.id))
      .all();
    return {
      ...list,
      clientCount: clients.length,
      authCount: auth.length,
      clients,
      auth,
    };
  });

  return { lists: enrichedLists };
}

export async function action({ request }: Route.ActionArgs) {
  await requireEditor(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const user = await getSessionUser(request);
  const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";

  if (intent === "create" || intent === "update") {
    const name = formData.get("name") as string;
    const satisfy = formData.get("satisfy") as string;
    const clientsJson = formData.get("clients") as string;
    const authJson = formData.get("auth") as string;

    if (!name) return { error: "Name is required" };

    const clients = JSON.parse(clientsJson || "[]") as Array<{
      address: string;
      directive: string;
    }>;
    const authEntries = JSON.parse(authJson || "[]") as Array<{
      username: string;
      password: string;
    }>;

    if (intent === "create") {
      const result = db
        .insert(accessLists)
        .values({
          name,
          satisfy: satisfy as "any" | "all",
          createdAt: new Date(),
        })
        .returning()
        .get();

      for (const client of clients) {
        if (client.address.trim()) {
          db.insert(accessListClients)
            .values({
              accessListId: result.id,
              address: client.address.trim(),
              directive: client.directive as "allow" | "deny",
            })
            .run();
        }
      }

      for (const auth of authEntries) {
        if (auth.username.trim() && auth.password.trim()) {
          db.insert(accessListAuth)
            .values({
              accessListId: result.id,
              username: auth.username.trim(),
              password: auth.password.trim(),
            })
            .run();
        }
      }

      logAudit({
        userId: user?.userId ?? null,
        action: "create",
        entity: "access_list",
        entityId: result.id,
        details: { name },
        ipAddress,
      });
    } else {
      const id = Number(formData.get("id"));

      db.update(accessLists)
        .set({ name, satisfy: satisfy as "any" | "all" })
        .where(eq(accessLists.id, id))
        .run();

      // Replace clients and auth
      db.delete(accessListClients)
        .where(eq(accessListClients.accessListId, id))
        .run();
      db.delete(accessListAuth)
        .where(eq(accessListAuth.accessListId, id))
        .run();

      for (const client of clients) {
        if (client.address.trim()) {
          db.insert(accessListClients)
            .values({
              accessListId: id,
              address: client.address.trim(),
              directive: client.directive as "allow" | "deny",
            })
            .run();
        }
      }

      for (const auth of authEntries) {
        if (auth.username.trim() && auth.password.trim()) {
          db.insert(accessListAuth)
            .values({
              accessListId: id,
              username: auth.username.trim(),
              password: auth.password.trim(),
            })
            .run();
        }
      }

      logAudit({
        userId: user?.userId ?? null,
        action: "update",
        entity: "access_list",
        entityId: id,
        details: { name },
        ipAddress,
      });
    }

    generateAllConfigs();
    reloadPingora();
    return { ok: true };
  } else if (intent === "delete") {
    const id = Number(formData.get("id"));
    db.delete(accessLists).where(eq(accessLists.id, id)).run();

    logAudit({
      userId: user?.userId ?? null,
      action: "delete",
      entity: "access_list",
      entityId: id,
      ipAddress,
    });

    generateAllConfigs();
    reloadPingora();
  }

  return { ok: true };
}

export default function AccessListsPage({ loaderData }: Route.ComponentProps) {
  const { lists } = loaderData;
  const [editList, setEditList] = useState<(typeof lists)[0] | null>(null);
  const [showForm, setShowForm] = useState(false);

  const openCreate = () => {
    setEditList(null);
    setShowForm(true);
  };

  const openEdit = (list: (typeof lists)[0]) => {
    setEditList(list);
    setShowForm(true);
  };

  if (showForm) {
    return (
      <AccessListForm
        list={editList}
        onBack={() => setShowForm(false)}
      />
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Access Lists</h1>
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Add Access List
        </button>
      </div>

      {lists.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No access lists configured yet.
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
                  Satisfy
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  IP Rules
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Auth Entries
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {lists.map((list) => (
                <AccessListRow
                  key={list.id}
                  list={list}
                  onEdit={() => openEdit(list)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AccessListRow({
  list,
  onEdit,
}: {
  list: {
    id: number;
    name: string;
    satisfy: string;
    clientCount: number;
    authCount: number;
  };
  onEdit: () => void;
}) {
  const deleteFetcher = useFetcher();
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
        {list.name}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
        {list.satisfy}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {list.clientCount}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {list.authCount}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
        <button onClick={onEdit} className="text-blue-600 hover:text-blue-900">
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
                Are you sure you want to delete the access list "{list.name}"?
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
                      { intent: "delete", id: String(list.id) },
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

function AccessListForm({
  list,
  onBack,
}: {
  list: {
    id: number;
    name: string;
    satisfy: string;
    clients: Array<{ id: number; address: string; directive: string }>;
    auth: Array<{ id: number; username: string; password: string }>;
  } | null;
  onBack: () => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  const [clients, setClients] = useState<Array<{ address: string; directive: string }>>(
    list?.clients.map((c) => ({ address: c.address, directive: c.directive })) ?? [
      { address: "", directive: "allow" },
    ]
  );

  const [authEntries, setAuthEntries] = useState<
    Array<{ username: string; password: string }>
  >(
    list?.auth.map((a) => ({ username: a.username, password: "" })) ?? [
      { username: "", password: "" },
    ]
  );

  const addClient = () =>
    setClients([...clients, { address: "", directive: "allow" }]);
  const removeClient = (idx: number) =>
    setClients(clients.filter((_, i) => i !== idx));

  const addAuth = () =>
    setAuthEntries([...authEntries, { username: "", password: "" }]);
  const removeAuth = (idx: number) =>
    setAuthEntries(authEntries.filter((_, i) => i !== idx));

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("clients", JSON.stringify(clients));
    form.set("auth", JSON.stringify(authEntries));
    form.set("intent", list ? "update" : "create");
    if (list) form.set("id", String(list.id));
    fetcher.submit(form, { method: "post" });
    setTimeout(onBack, 100);
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="text-gray-600 hover:text-gray-900"
        >
          &larr; Back
        </button>
        <h1 className="text-2xl font-bold">
          {list ? "Edit Access List" : "Create Access List"}
        </h1>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium mb-1">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  defaultValue={list?.name ?? ""}
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="satisfy" className="block text-sm font-medium mb-1">
                  Satisfy
                </label>
                <select
                  id="satisfy"
                  name="satisfy"
                  defaultValue={list?.satisfy ?? "any"}
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="any">Any</option>
                  <option value="all">All</option>
                </select>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">IP Rules</h3>
              {clients.map((client, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={client.address}
                    onChange={(e) =>
                      setClients(
                        clients.map((c, ci) =>
                          ci === i ? { ...c, address: e.target.value } : c
                        )
                      )
                    }
                    placeholder="192.168.1.0/24"
                    className="flex-1 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={client.directive}
                    onChange={(e) =>
                      setClients(
                        clients.map((c, ci) =>
                          ci === i ? { ...c, directive: e.target.value } : c
                        )
                      )
                    }
                    className="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                  </select>
                  {clients.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeClient(i)}
                      className="text-red-500 hover:text-red-700 px-2"
                    >
                      X
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addClient}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                + Add IP Rule
              </button>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">Basic Auth</h3>
              {authEntries.map((auth, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={auth.username}
                    onChange={(e) =>
                      setAuthEntries(
                        authEntries.map((a, ai) =>
                          ai === i ? { ...a, username: e.target.value } : a
                        )
                      )
                    }
                    placeholder="Username"
                    className="flex-1 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="password"
                    value={auth.password}
                    onChange={(e) =>
                      setAuthEntries(
                        authEntries.map((a, ai) =>
                          ai === i ? { ...a, password: e.target.value } : a
                        )
                      )
                    }
                    placeholder={list ? "Leave blank to keep" : "Password"}
                    className="flex-1 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {authEntries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeAuth(i)}
                      className="text-red-500 hover:text-red-700 px-2"
                    >
                      X
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addAuth}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                + Add Auth Entry
              </button>
            </div>
          </div>

          <div className="flex justify-end space-x-2 mt-6 pt-4 border-t">
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {list ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
