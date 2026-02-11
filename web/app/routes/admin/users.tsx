import type { Route } from "./+types/users";
import { useFetcher } from "react-router";
import { db } from "~/lib/db/connection";
import { users } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { requireAdmin } from "~/lib/auth/middleware";
import { logAudit } from "~/lib/audit/log";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const allUsers = db.select().from(users).all();
  return {
    users: allUsers.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt,
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUser = await requireAdmin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";

  if (intent === "create") {
    const email = (formData.get("email") as string)?.trim();
    const name = (formData.get("name") as string)?.trim();
    const password = formData.get("password") as string;
    const role = formData.get("role") as string;

    if (!email || !name || !password) {
      return { error: "All fields are required" };
    }

    const hashedPassword = await Bun.password.hash(password, {
      algorithm: "argon2id",
    });

    const result = db.insert(users)
      .values({
        email,
        name,
        password: hashedPassword,
        role: role as "admin" | "editor" | "viewer",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .get();

    logAudit({
      userId: currentUser.userId,
      action: "create",
      entity: "user",
      entityId: result.id,
      details: { email, role },
      ipAddress,
    });
  } else if (intent === "update") {
    const id = Number(formData.get("id"));
    const email = (formData.get("email") as string)?.trim();
    const name = (formData.get("name") as string)?.trim();
    const password = formData.get("password") as string;
    const role = formData.get("role") as string;

    if (!email || !name) {
      return { error: "Email and name are required" };
    }

    const updateData: Record<string, unknown> = {
      email,
      name,
      role: role as "admin" | "editor" | "viewer",
      updatedAt: new Date(),
    };

    if (password) {
      updateData.password = await Bun.password.hash(password, {
        algorithm: "argon2id",
      });
    }

    db.update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .run();

    logAudit({
      userId: currentUser.userId,
      action: "update",
      entity: "user",
      entityId: id,
      details: { email, role },
      ipAddress,
    });
  } else if (intent === "delete") {
    const id = Number(formData.get("id"));

    if (id === currentUser.userId) {
      return { error: "You cannot delete your own account" };
    }

    db.delete(users).where(eq(users.id, id)).run();

    logAudit({
      userId: currentUser.userId,
      action: "delete",
      entity: "user",
      entityId: id,
      ipAddress,
    });
  }

  return { ok: true };
}

export default function UsersPage({ loaderData }: Route.ComponentProps) {
  const { users: userList } = loaderData;
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<(typeof userList)[0] | null>(null);

  const openCreate = () => {
    setEditUser(null);
    setShowModal(true);
  };

  const openEdit = (user: (typeof userList)[0]) => {
    setEditUser(user);
    setShowModal(true);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Users</h1>
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Add User
        </button>
      </div>

      {userList.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No users found.
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
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {userList.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  onEdit={() => openEdit(user)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <UserModal
          user={editUser}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    admin: "bg-red-100 text-red-800",
    editor: "bg-blue-100 text-blue-800",
    viewer: "bg-gray-100 text-gray-800",
  };

  return (
    <span
      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
        colors[role] ?? "bg-gray-100 text-gray-800"
      }`}
    >
      {role}
    </span>
  );
}

function UserRow({
  user,
  onEdit,
}: {
  user: {
    id: number;
    name: string;
    email: string;
    role: string;
    createdAt: Date;
  };
  onEdit: () => void;
}) {
  const deleteFetcher = useFetcher();
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
        {user.name}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {user.email}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <RoleBadge role={user.role} />
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {new Date(user.createdAt).toLocaleDateString()}
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
                Are you sure you want to delete user "{user.name}"?
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
                      { intent: "delete", id: String(user.id) },
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

function UserModal({
  user,
  onClose,
}: {
  user: { id: number; name: string; email: string; role: string } | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">
          {user ? "Edit User" : "Create User"}
        </h3>
        <fetcher.Form method="post" onSubmit={() => setTimeout(onClose, 100)}>
          <input type="hidden" name="intent" value={user ? "update" : "create"} />
          {user && <input type="hidden" name="id" value={String(user.id)} />}

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
                defaultValue={user?.name ?? ""}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                defaultValue={user?.email ?? ""}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">
                Password {user && "(leave blank to keep current)"}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required={!user}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="role" className="block text-sm font-medium mb-1">
                Role
              </label>
              <select
                id="role"
                name="role"
                defaultValue={user?.role ?? "viewer"}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
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
              {user ? "Update" : "Create"}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}
