import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { db } from "~/lib/db/connection";
import { users } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { createToken } from "~/lib/auth/jwt.server";
import {
  createSessionCookie,
  getSessionUser,
} from "~/lib/auth/session.server";
import { logAudit } from "~/lib/audit/log";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { Hexagon, Loader2 } from "lucide-react";

export function meta() {
  return [{ title: "Login — Pingora Manager" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getSessionUser(request);
  if (user) throw redirect("/admin");
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const user = db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (!user) {
    return { error: "Invalid credentials" };
  }

  const valid = await Bun.password.verify(password, user.password);
  if (!valid) {
    return { error: "Invalid credentials" };
  }

  const token = await createToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  logAudit({
    userId: user.id,
    action: "login",
    entity: "user",
    entityId: user.id,
    details: { email: user.email },
    ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
  });

  const redirectTo = user.mustChangePassword ? "/admin/setup" : "/admin";

  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": createSessionCookie(token, request),
    },
  });
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <Hexagon className="h-8 w-8 text-primary mx-auto" />
          <CardTitle>Pingora Manager</CardTitle>
          <CardDescription>Sign in to your account</CardDescription>
        </CardHeader>
        <CardContent>
          {actionData?.error && (
            <div className="bg-destructive/10 text-destructive border border-destructive/20 p-3 rounded-md mb-4 text-sm">
              {actionData.error}
            </div>
          )}

          <Form method="post" className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                name="email"
                required
                autoFocus
                placeholder="admin@example.com"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                name="password"
                required
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
