import type { Route } from "./+types/settings";
import { Form, useActionData, useNavigation } from "react-router";
import { db } from "~/lib/db/connection";
import { settings } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "~/lib/auth/middleware";
import { generateAllConfigs } from "~/lib/config-generator/generate";
import { reloadPingora } from "~/lib/signal/reload";
import { logAudit } from "~/lib/audit/log";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const SETTING_KEYS = [
  "global_webhook_url",
  "watchdog_interval_ms",
  "audit_retention_days",
  "health_retention_days",
] as const;

export function meta() {
  return [{ title: "Settings — Pingora Manager" }];
}

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

  useEffect(() => {
    if (actionData && "saved" in actionData && actionData.saved) {
      toast.success("Settings saved and config reloaded.");
    }
  }, [actionData]);

  return (
    <div>
      <div className="flex items-center min-h-10 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-6">
            <div>
              <Label htmlFor="global_webhook_url">Global Webhook URL</Label>
              <Input
                id="global_webhook_url"
                name="global_webhook_url"
                type="url"
                defaultValue={currentSettings.global_webhook_url ?? ""}
                placeholder="https://hooks.example.com/..."
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Called on all config changes if set.
              </p>
            </div>

            <div>
              <Label htmlFor="watchdog_interval_ms">Watchdog Interval (ms)</Label>
              <Input
                id="watchdog_interval_ms"
                name="watchdog_interval_ms"
                type="number"
                min={1000}
                defaultValue={currentSettings.watchdog_interval_ms ?? "30000"}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                How often the watchdog checks upstream health (default: 30000).
              </p>
            </div>

            <div>
              <Label htmlFor="audit_retention_days">Audit Log Retention (days)</Label>
              <Input
                id="audit_retention_days"
                name="audit_retention_days"
                type="number"
                min={1}
                defaultValue={currentSettings.audit_retention_days ?? "90"}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Audit log entries older than this are pruned (default: 90).
              </p>
            </div>

            <div>
              <Label htmlFor="health_retention_days">Health Check Retention (days)</Label>
              <Input
                id="health_retention_days"
                name="health_retention_days"
                type="number"
                min={1}
                defaultValue={currentSettings.health_retention_days ?? "7"}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Health check records older than this are pruned (default: 7).
              </p>
            </div>

            <Separator />

            <div>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSubmitting ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
