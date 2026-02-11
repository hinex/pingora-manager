import type { Route } from "./+types/audit-log";
import { Form, useSearchParams } from "react-router";
import { db } from "~/lib/db/connection";
import { auditLog, users } from "~/lib/db/schema";
import { desc, eq, and, gte, lte } from "drizzle-orm";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const actionFilter = url.searchParams.get("action") || "";
  const entityFilter = url.searchParams.get("entity") || "";
  const dateFrom = url.searchParams.get("dateFrom") || "";
  const dateTo = url.searchParams.get("dateTo") || "";

  const conditions = [];
  if (actionFilter) {
    conditions.push(eq(auditLog.action, actionFilter as any));
  }
  if (entityFilter) {
    conditions.push(eq(auditLog.entity, entityFilter));
  }
  if (dateFrom) {
    conditions.push(gte(auditLog.createdAt, new Date(dateFrom)));
  }
  if (dateTo) {
    const endDate = new Date(dateTo);
    endDate.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLog.createdAt, endDate));
  }

  const query =
    conditions.length > 0
      ? db
          .select()
          .from(auditLog)
          .where(and(...conditions))
          .orderBy(desc(auditLog.createdAt))
          .limit(200)
          .all()
      : db
          .select()
          .from(auditLog)
          .orderBy(desc(auditLog.createdAt))
          .limit(200)
          .all();

  const allUsers = db.select().from(users).all();
  const userMap = new Map(allUsers.map((u) => [u.id, u.email]));

  const entries = query.map((entry) => ({
    ...entry,
    userEmail: entry.userId ? userMap.get(entry.userId) ?? "Unknown" : "System",
  }));

  return { entries };
}

export default function AuditLogPage({ loaderData }: Route.ComponentProps) {
  const { entries } = loaderData;
  const [searchParams] = useSearchParams();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Audit Log</h1>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <Form method="get" className="flex flex-wrap gap-4 items-end">
          <div>
            <label htmlFor="action" className="block text-sm font-medium mb-1">
              Action
            </label>
            <select
              id="action"
              name="action"
              defaultValue={searchParams.get("action") ?? ""}
              className="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="login">Login</option>
              <option value="logout">Logout</option>
              <option value="reload">Reload</option>
            </select>
          </div>

          <div>
            <label htmlFor="entity" className="block text-sm font-medium mb-1">
              Entity
            </label>
            <input
              id="entity"
              name="entity"
              type="text"
              defaultValue={searchParams.get("entity") ?? ""}
              placeholder="e.g. proxy_host"
              className="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="dateFrom" className="block text-sm font-medium mb-1">
              From
            </label>
            <input
              id="dateFrom"
              name="dateFrom"
              type="date"
              defaultValue={searchParams.get("dateFrom") ?? ""}
              className="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="dateTo" className="block text-sm font-medium mb-1">
              To
            </label>
            <input
              id="dateTo"
              name="dateTo"
              type="date"
              defaultValue={searchParams.get("dateTo") ?? ""}
              className="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Filter
          </button>
        </Form>
      </div>

      {entries.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No audit log entries found.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Timestamp
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Entity
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Entity ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {entry.createdAt
                      ? new Date(entry.createdAt).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {entry.userEmail}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <ActionBadge action={entry.action} />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {entry.entity}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {entry.entityId ?? "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                    {entry.details ? JSON.stringify(entry.details) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    create: "bg-green-100 text-green-800",
    update: "bg-blue-100 text-blue-800",
    delete: "bg-red-100 text-red-800",
    login: "bg-purple-100 text-purple-800",
    logout: "bg-gray-100 text-gray-800",
    reload: "bg-yellow-100 text-yellow-800",
  };

  return (
    <span
      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
        colors[action] ?? "bg-gray-100 text-gray-800"
      }`}
    >
      {action}
    </span>
  );
}
