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

  const redirectTo = user.mustChangePassword ? "/admin/change-password" : "/admin";

  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": createSessionCookie(token),
    },
  });
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2">Pingora Manager</h1>
        <p className="text-gray-500 mb-6 text-sm">Sign in to your account</p>

        {actionData?.error && (
          <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">
            {actionData.error}
          </div>
        )}

        <Form method="post" className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              name="email"
              required
              autoFocus
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              name="password"
              required
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-primary text-white py-2 rounded hover:bg-primary-dark disabled:opacity-50"
          >
            {isSubmitting ? "Signing in..." : "Sign In"}
          </button>
        </Form>
      </div>
    </div>
  );
}
