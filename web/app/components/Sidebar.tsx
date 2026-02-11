import { NavLink } from "react-router";
import { useUIStore } from "~/store/ui";

const navItems = [
  { to: "/admin", label: "Dashboard", icon: "grid" },
  { to: "/admin/proxy-hosts", label: "Proxy Hosts", icon: "server" },
  { to: "/admin/groups", label: "Groups", icon: "folder" },
  { to: "/admin/redirections", label: "Redirections", icon: "arrow-right" },
  { to: "/admin/streams", label: "Streams", icon: "activity" },
  { to: "/admin/ssl", label: "SSL Certificates", icon: "lock" },
  { to: "/admin/access-lists", label: "Access Lists", icon: "shield" },
  { to: "/admin/error-pages", label: "Error Pages", icon: "alert-triangle" },
  { to: "/admin/default-page", label: "Default Page", icon: "file-text" },
  { to: "/admin/static", label: "Static Directories", icon: "hard-drive" },
  { to: "/admin/logs", label: "Logs", icon: "terminal" },
  { to: "/admin/health", label: "Health Dashboard", icon: "heart" },
  { to: "/admin/audit-log", label: "Audit Log", icon: "list" },
  { to: "/admin/users", label: "Users", icon: "users" },
  { to: "/admin/settings", label: "Settings", icon: "settings" },
];

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  return (
    <aside
      className={`bg-sidebar text-white h-screen fixed left-0 top-0 overflow-y-auto transition-all ${
        sidebarOpen ? "w-64" : "w-16"
      }`}
    >
      <div className="p-4 border-b border-sidebar-hover">
        <h1 className={`font-bold ${sidebarOpen ? "text-lg" : "text-xs text-center"}`}>
          {sidebarOpen ? "Pingora Manager" : "PM"}
        </h1>
      </div>
      <nav className="mt-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/admin"}
            className={({ isActive }) =>
              `flex items-center px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-primary text-white"
                  : "text-gray-300 hover:bg-sidebar-hover"
              }`
            }
          >
            <span className={sidebarOpen ? "ml-2" : "mx-auto text-xs"}>
              {sidebarOpen ? item.label : item.label.charAt(0)}
            </span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
