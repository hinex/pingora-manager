import { NavLink } from "react-router";
import {
  LayoutDashboard,
  Globe,
  ShieldCheck,
  Lock,
  AlertTriangle,
  FileText,
  Terminal,
  ScrollText,
  Users,
  Settings,
  Hexagon,
  Menu,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useUIStore } from "~/store/ui";
import { cn } from "~/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
} from "~/components/ui/sheet";
import { useState } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
    ],
  },
  {
    title: "Proxy",
    items: [
      { to: "/admin/hosts", label: "Hosts", icon: Globe },
    ],
  },
  {
    title: "Configuration",
    items: [
      { to: "/admin/ssl", label: "SSL Certificates", icon: ShieldCheck },
      { to: "/admin/access-lists", label: "Access Lists", icon: Lock },
      { to: "/admin/error-pages", label: "Error Pages", icon: AlertTriangle },
      { to: "/admin/default-page", label: "Default Page", icon: FileText },
    ],
  },
  {
    title: "Monitoring",
    items: [
      { to: "/admin/logs", label: "Logs", icon: Terminal },
      { to: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
    ],
  },
  {
    title: "System",
    items: [
      { to: "/admin/users", label: "Users", icon: Users },
      { to: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
];

function NavItemLink({
  item,
  collapsed,
  onClick,
}: {
  item: NavItem;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;

  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          collapsed && "justify-center px-0"
        )
      }
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span
        className={cn(
          "whitespace-nowrap transition-opacity duration-200",
          collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
        )}
      >
        {item.label}
      </span>
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

function SidebarContent({
  collapsed,
  onNavClick,
}: {
  collapsed: boolean;
  onNavClick?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3 py-2">
      {navSections.map((section) => (
        <div key={section.title} className="mb-1">
          {collapsed ? (
            <div className="my-2 border-t border-sidebar-border" />
          ) : (
            <h4 className="mb-1 mt-3 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-muted-foreground whitespace-nowrap overflow-hidden">
              {section.title}
            </h4>
          )}
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <NavItemLink
                key={item.to}
                item={item}
                collapsed={collapsed}
                onClick={onNavClick}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function BrandSection({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center border-b border-sidebar-border px-4 py-4 h-14 overflow-hidden",
        collapsed ? "justify-center" : "gap-3"
      )}
    >
      <Hexagon className="h-7 w-7 shrink-0 text-orange-500" />
      <span
        className={cn(
          "text-lg font-bold text-sidebar-foreground whitespace-nowrap transition-opacity duration-200",
          collapsed ? "opacity-0 w-0" : "opacity-100"
        )}
      >
        Pingora Manager
      </span>
    </div>
  );
}

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const collapsed = !sidebarOpen;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "h-screen fixed left-0 top-0 overflow-y-auto bg-sidebar border-r border-sidebar-border transition-[width] duration-200 ease-in-out z-30",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <BrandSection collapsed={collapsed} />
        <SidebarContent collapsed={collapsed} />
      </aside>
    </TooltipProvider>
  );
}

export function MobileSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sidebar-primary"
          aria-label="Open sidebar"
        >
          <Menu className="h-6 w-6" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 bg-sidebar p-0 border-sidebar-border [&>button:last-child]:hidden">
        <div className="flex items-center justify-between border-b border-sidebar-border px-4 h-14">
          <div className="flex items-center gap-3">
            <Hexagon className="h-7 w-7 shrink-0 text-orange-500" />
            <span className="text-lg font-bold text-sidebar-foreground">
              Pingora Manager
            </span>
          </div>
          <SheetClose asChild>
            <button
              type="button"
              className="rounded-md p-1 text-sidebar-muted-foreground hover:text-sidebar-foreground focus:outline-none"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          </SheetClose>
        </div>
        <SidebarContent collapsed={false} onNavClick={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
