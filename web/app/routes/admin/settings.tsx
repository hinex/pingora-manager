import type { Route } from "./+types/settings";
import { Form, useActionData, useNavigation } from "react-router";
import { db } from "~/lib/db/connection";
import { settings } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "~/lib/auth/middleware";
import { generateAllConfigs } from "~/lib/config-generator/generate";
import { reloadPingora } from "~/lib/signal/reload";
import { logAudit } from "~/lib/audit/log";

const SETTING_KEYS = [
  "global_webhook_url",
  "watchdog_interval_ms",
  "audit_retention_days",
  "health_retention_days",
] as const;

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const allSettings = db.select().from(settings).all();
  const settingsMap = Object.fromEntries(
    allSettings.map((s) => [s.key, s.value ?? ""])
  );
  return { settings: settingsMap };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUser = await requireAdmin(request);
  const formData = await request.formData();
  const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";

  const changedSettings: Record<string, string> = {};

  for (const key of SETTING_KEYS) {
    const value = (formData.get(key) as string) ?? "";
    const existing = db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .get();

    if (existing) {
      if (existing.value !== value) {
        changedSettings[key] = value;
      }
      db.update(settings)
        .set({ value })
        .where(eq(settings.key, key))
        .run();
    } else {
      changedSettings[key] = value;
      db.insert(settings).values({ key, value }).run();
    }
  }

  logAudit({
    userId: currentUser.userId,
    action: "update",
    entity: "settings",
    details: changedSettings,
    ipAddress,
  });

  generateAllConfigs();
  reloadPingora();

  return { saved: true };
}

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const { settings: currentSettings } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="bg-white rounded-lg shadow p-6">
        {actionData && "saved" in actionData && actionData.saved && (
          <div className="bg-green-50 text-green-700 p-3 rounded mb-4 text-sm">
            Settings saved and config reloaded.
          </div>
        )}

        <Form method="post" className="space-y-6">
          <div>
            <label
              htmlFor="global_webhook_url"
              className="block text-sm font-medium mb-1"
            >
              Global Webhook URL
            </label>
            <input
              id="global_webhook_url"
              name="global_webhook_url"
              type="url"
              defaultValue={currentSettings.global_webhook_url ?? ""}
              placeholder="https://hooks.example.com/..."
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Called on all config changes if set.
            </p>
          </div>

          <div>
            <label
              htmlFor="watchdog_interval_ms"
              className="block text-sm font-medium mb-1"
            >
              Watchdog Interval (ms)
            </label>
            <input
              id="watchdog_interval_ms"
              name="watchdog_interval_ms"
              type="number"
              min={1000}
              defaultValue={currentSettings.watchdog_interval_ms ?? "30000"}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              How often the watchdog checks upstream health (default: 30000).
            </p>
          </div>

          <div>
            <label
              htmlFor="audit_retention_days"
              className="block text-sm font-medium mb-1"
            >
              Audit Log Retention (days)
            </label>
            <input
              id="audit_retention_days"
              name="audit_retention_days"
              type="number"
              min={1}
              defaultValue={currentSettings.audit_retention_days ?? "90"}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Audit log entries older than this are pruned (default: 90).
            </p>
          </div>

          <div>
            <label
              htmlFor="health_retention_days"
              className="block text-sm font-medium mb-1"
            >
              Health Check Retention (days)
            </label>
            <input
              id="health_retention_days"
              name="health_retention_days"
              type="number"
              min={1}
              defaultValue={currentSettings.health_retention_days ?? "7"}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Health check records older than this are pruned (default: 7).
            </p>
          </div>

          <div className="pt-4 border-t">
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
