import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout";
import { getSessionUser } from "~/lib/auth/session.server";
import { Sidebar } from "~/components/Sidebar";
import { useUIStore } from "~/store/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getSessionUser(request);
  if (!user) throw redirect("/login");
  return { user };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className={`transition-all ${sidebarOpen ? "ml-64" : "ml-16"}`}>
        <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
          <button
            onClick={toggleSidebar}
            className="text-gray-500 hover:text-gray-700"
          >
            {sidebarOpen ? "<<" : ">>"}
          </button>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{loaderData.user.email}</span>
            <form method="post" action="/logout">
              <button
                type="submit"
                className="text-sm text-red-600 hover:text-red-800"
              >
                Logout
              </button>
            </form>
          </div>
        </header>
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
