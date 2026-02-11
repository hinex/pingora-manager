import type { Route } from "./+types/error-pages";
import { Form, useActionData, useNavigation } from "react-router";
import { db } from "~/lib/db/connection";
import { proxyHosts, hostGroups } from "~/lib/db/schema";
import { useState } from "react";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "fs";

const ERROR_PAGES_DIR = "/data/error-pages";
const ERROR_CODES = ["404", "500", "502", "503"];

export async function loader({}: Route.LoaderArgs) {
  const groups = db.select().from(hostGroups).all();
  const hosts = db.select().from(proxyHosts).all();
  return { groups, hosts };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "load") {
    const scope = formData.get("scope") as string;
    const scopeId = formData.get("scopeId") as string;
    const code = formData.get("code") as string;

    const dir = getScopeDir(scope, scopeId);
    const filePath = `${dir}/${code}.html`;

    let content = "";
    try {
      if (existsSync(filePath)) {
        content = readFileSync(filePath, "utf-8");
      }
    } catch {
      // File doesn't exist yet
    }

    return { content, loaded: true };
  }

  if (intent === "save") {
    const scope = formData.get("scope") as string;
    const scopeId = formData.get("scopeId") as string;
    const code = formData.get("code") as string;
    const content = formData.get("content") as string;

    const dir = getScopeDir(scope, scopeId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${code}.html`, content, "utf-8");

    return { saved: true };
  }

  return {};
}

function getScopeDir(scope: string, scopeId: string): string {
  if (scope === "group") {
    return `${ERROR_PAGES_DIR}/group-${scopeId}`;
  }
  if (scope === "host") {
    return `${ERROR_PAGES_DIR}/host-${scopeId}`;
  }
  return `${ERROR_PAGES_DIR}/global`;
}

export default function ErrorPagesPage({ loaderData }: Route.ComponentProps) {
  const { groups, hosts } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [scope, setScope] = useState("global");
  const [scopeId, setScopeId] = useState("");
  const [code, setCode] = useState("404");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Update content when loaded from server
  if (actionData && "content" in actionData && actionData.loaded && !loaded) {
    setContent(actionData.content as string);
    setLoaded(true);
  }

  if (actionData && "saved" in actionData && actionData.saved) {
    // Content was saved
  }

  const handleLoad = () => {
    setLoaded(false);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Error Pages</h1>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <label htmlFor="scope" className="block text-sm font-medium mb-1">
              Scope
            </label>
            <select
              id="scope"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setScopeId("");
                setLoaded(false);
              }}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="global">Global</option>
              <option value="group">Group</option>
              <option value="host">Host</option>
            </select>
          </div>

          {scope === "group" && (
            <div>
              <label htmlFor="scopeId" className="block text-sm font-medium mb-1">
                Group
              </label>
              <select
                id="scopeId"
                value={scopeId}
                onChange={(e) => {
                  setScopeId(e.target.value);
                  setLoaded(false);
                }}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {scope === "host" && (
            <div>
              <label htmlFor="scopeId" className="block text-sm font-medium mb-1">
                Host
              </label>
              <select
                id="scopeId"
                value={scopeId}
                onChange={(e) => {
                  setScopeId(e.target.value);
                  setLoaded(false);
                }}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a host</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {(h.domains as string[]).join(", ")}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="code" className="block text-sm font-medium mb-1">
              Error Code
            </label>
            <select
              id="code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setLoaded(false);
              }}
              className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ERROR_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Form method="post" className="mb-4">
          <input type="hidden" name="intent" value="load" />
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="scopeId" value={scopeId} />
          <input type="hidden" name="code" value={code} />
          <button
            type="submit"
            onClick={handleLoad}
            disabled={isSubmitting || (scope !== "global" && !scopeId)}
            className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 disabled:opacity-50"
          >
            Load
          </button>
        </Form>

        <Form method="post">
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="scopeId" value={scopeId} />
          <input type="hidden" name="code" value={code} />

          <div className="mb-4">
            <label htmlFor="content" className="block text-sm font-medium mb-1">
              HTML Content
            </label>
            <textarea
              id="content"
              name="content"
              rows={20}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="<!DOCTYPE html>&#10;<html>&#10;<head><title>Error</title></head>&#10;<body>&#10;  <h1>Error</h1>&#10;</body>&#10;</html>"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || (scope !== "global" && !scopeId)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Save
          </button>

          {actionData && "saved" in actionData && actionData.saved && (
            <span className="ml-4 text-green-600 text-sm">Saved successfully.</span>
          )}
        </Form>
      </div>
    </div>
  );
}
