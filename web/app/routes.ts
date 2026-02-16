import { type RouteConfig, route, index, layout, prefix } from "@react-router/dev/routes";

export default [
  index("./routes/home.tsx"),
  route("login", "./routes/login.tsx"),
  route("logout", "./routes/logout.tsx"),
  route("api/logs", "./routes/api/logs.tsx"),
  route("api/test-upstream", "./routes/api/test-upstream.tsx"),

  layout("./routes/admin/layout.tsx", [
    ...prefix("admin", [
      index("./routes/admin/dashboard.tsx"),
      route("hosts", "./routes/admin/hosts/index.tsx"),
      route("hosts/new", "./routes/admin/hosts/new.tsx"),
      route("hosts/:id/edit", "./routes/admin/hosts/edit.tsx"),
      route("ssl", "./routes/admin/ssl.tsx"),
      route("access-lists", "./routes/admin/access-lists.tsx"),
      route("error-pages", "./routes/admin/error-pages.tsx"),
      route("default-page", "./routes/admin/default-page.tsx"),
      route("logs", "./routes/admin/logs.tsx"),
      route("health", "./routes/admin/health.tsx"),
      route("audit-log", "./routes/admin/audit-log.tsx"),
      route("users", "./routes/admin/users.tsx"),
      route("settings", "./routes/admin/settings.tsx"),
      route("change-password", "./routes/admin/change-password.tsx"),
    ]),
  ]),
  route("admin/setup", "./routes/admin/setup.tsx"),
] satisfies RouteConfig;
