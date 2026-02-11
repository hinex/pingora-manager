import type { Route } from "./+types/default-page";
import { Form, useActionData, useNavigation } from "react-router";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

const DEFAULT_PAGE_DIR = "/data/default-page";
const DEFAULT_PAGE_PATH = `${DEFAULT_PAGE_DIR}/index.html`;

export async function loader({}: Route.LoaderArgs) {
  let content = "";
  try {
    if (existsSync(DEFAULT_PAGE_PATH)) {
      content = readFileSync(DEFAULT_PAGE_PATH, "utf-8");
    }
  } catch {
    // File doesn't exist yet
  }
  return { content };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const content = formData.get("content") as string;

  mkdirSync(DEFAULT_PAGE_DIR, { recursive: true });
  writeFileSync(DEFAULT_PAGE_PATH, content, "utf-8");

  return { saved: true };
}

export default function DefaultPageEditor({ loaderData }: Route.ComponentProps) {
  const { content } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Default Page</h1>

      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-gray-500 mb-4">
          This page is displayed when no proxy host matches the incoming request.
        </p>

        <Form method="post">
          <div className="mb-4">
            <label htmlFor="content" className="block text-sm font-medium mb-1">
              HTML Content
            </label>
            <textarea
              id="content"
              name="content"
              rows={24}
              defaultValue={content}
              className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="<!DOCTYPE html>&#10;<html>&#10;<head><title>Welcome</title></head>&#10;<body>&#10;  <h1>Welcome to Pingora Manager</h1>&#10;</body>&#10;</html>"
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : "Save"}
            </button>

            {actionData?.saved && (
              <span className="text-green-600 text-sm">Saved successfully.</span>
            )}
          </div>
        </Form>
      </div>
    </div>
  );
}
