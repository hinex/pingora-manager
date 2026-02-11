import type { Route } from "./+types/change-password";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { db } from "~/lib/db/connection";
import { users } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "~/lib/auth/middleware";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAuth(request);
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const currentUser = await requireAuth(request);
  const formData = await request.formData();

  const currentPassword = formData.get("currentPassword") as string;
  const newPassword = formData.get("newPassword") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: "All fields are required" };
  }

  if (newPassword !== confirmPassword) {
    return { error: "New passwords do not match" };
  }

  if (newPassword.length < 8) {
    return { error: "New password must be at least 8 characters" };
  }

  const user = db
    .select()
    .from(users)
    .where(eq(users.id, currentUser.userId))
    .get();

  if (!user) {
    return { error: "User not found" };
  }

  const valid = await Bun.password.verify(currentPassword, user.password);
  if (!valid) {
    return { error: "Current password is incorrect" };
  }

  const hashedPassword = await Bun.password.hash(newPassword, {
    algorithm: "argon2id",
  });

  db.update(users)
    .set({
      password: hashedPassword,
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, currentUser.userId))
    .run();

  return redirect("/admin");
}

export default function ChangePasswordPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Change Password</h1>

      <div className="bg-white rounded-lg shadow p-6 max-w-md">
        {actionData && "error" in actionData && actionData.error && (
          <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">
            {actionData.error}
          </div>
        )}

        <Form method="post" className="space-y-4">
          <div>
            <label
              htmlFor="currentPassword"
              className="block text-sm font-medium mb-1"
            >
              Current Password
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="newPassword"
              className="block text-sm font-medium mb-1"
            >
              New Password
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              minLength={8}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium mb-1"
            >
              Confirm New Password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? "Changing..." : "Change Password"}
          </button>
        </Form>
      </div>
    </div>
  );
}
