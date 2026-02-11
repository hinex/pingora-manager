import type { Route } from "./+types/ssl";
import { db } from "~/lib/db/connection";
import { proxyHosts } from "~/lib/db/schema";
import { existsSync, readFileSync } from "fs";
import { useFetcher } from "react-router";
import { useState } from "react";
import { requireEditor } from "~/lib/auth/middleware";
import { eq } from "drizzle-orm";
import { generateAllConfigs } from "~/lib/config-generator/generate";
import { reloadPingora } from "~/lib/signal/reload";
import { requestCertificate } from "~/lib/acme/client";

function getCertExpiry(certPath: string): string | null {
  try {
    if (!existsSync(certPath)) return null;
    // Read PEM and extract notAfter via a simple regex on the base64 content
    // Since we can't use openssl, we'll just report if the file exists
    return "Certificate present";
  } catch {
    return null;
  }
}

export async function loader({}: Route.LoaderArgs) {
  const hosts = db.select().from(proxyHosts).all();
  const sslHosts = hosts
    .filter((h) => h.sslType !== "none")
    .map((h) => {
      const domains = h.domains as string[];
      const certStatus = h.sslCertPath ? getCertExpiry(h.sslCertPath) : null;
      return {
        id: h.id,
        domains,
        sslType: h.sslType,
        sslCertPath: h.sslCertPath,
        sslKeyPath: h.sslKeyPath,
        certStatus,
        enabled: h.enabled,
      };
    });

  return { sslHosts };
}

export async function action({ request }: Route.ActionArgs) {
  await requireEditor(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upload") {
    const id = Number(formData.get("id"));
    const certPath = formData.get("certPath") as string;
    const keyPath = formData.get("keyPath") as string;

    if (!certPath || !keyPath) {
      return { error: "Certificate and key paths are required" };
    }

    db.update(proxyHosts)
      .set({
        sslType: "custom",
        sslCertPath: certPath,
        sslKeyPath: keyPath,
        updatedAt: new Date(),
      })
      .where(eq(proxyHosts.id, id))
      .run();

    generateAllConfigs();
    reloadPingora();
  }

  if (intent === "request") {
    const id = Number(formData.get("id"));
    const host = db.select().from(proxyHosts).where(eq(proxyHosts.id, id)).get();
    if (!host) {
      return { error: "Host not found" };
    }

    const domains = host.domains as string[];
    const staging = formData.get("staging") === "true";
    const result = await requestCertificate(domains, staging);

    if (result.success && result.certPath && result.keyPath) {
      db.update(proxyHosts)
        .set({
          sslCertPath: result.certPath,
          sslKeyPath: result.keyPath,
          updatedAt: new Date(),
        })
        .where(eq(proxyHosts.id, id))
        .run();

      generateAllConfigs();
      reloadPingora();

      return { ok: true, certResult: result };
    }

    return { error: result.error, certResult: result };
  }

  return { ok: true };
}

export default function SSLPage({ loaderData }: Route.ComponentProps) {
  const { sslHosts } = loaderData;
  const [uploadModal, setUploadModal] = useState<number | null>(null);
  const requestFetcher = useFetcher();
  const isRequesting = requestFetcher.state !== "idle";
  const requestResult = requestFetcher.data as
    | { ok?: boolean; error?: string; certResult?: { success: boolean; error?: string } }
    | undefined;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">SSL Certificates</h1>
      </div>

      {requestResult?.error && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-yellow-800 mb-1">Certificate Request Result</h4>
          <pre className="text-sm text-yellow-700 whitespace-pre-wrap">{requestResult.error}</pre>
        </div>
      )}

      {requestResult?.ok && requestResult?.certResult?.success && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800">
            Certificate found and configured successfully. Pingora has been reloaded.
          </p>
        </div>
      )}

      {sslHosts.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No proxy hosts with SSL enabled.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Domains
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  SSL Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Certificate Path
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sslHosts.map((host) => (
                <tr key={host.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {host.domains.map((d, i) => (
                      <div key={i}>{d}</div>
                    ))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {host.sslType === "letsencrypt"
                      ? "Let's Encrypt"
                      : host.sslType === "custom"
                        ? "Custom"
                        : "None"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {host.sslCertPath || "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {host.certStatus ? (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                        {host.certStatus}
                      </span>
                    ) : (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">
                        No certificate file
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                    {host.sslType === "letsencrypt" && (
                      <requestFetcher.Form method="post" className="inline">
                        <input type="hidden" name="intent" value="request" />
                        <input type="hidden" name="id" value={String(host.id)} />
                        <button
                          type="submit"
                          className="text-green-600 hover:text-green-900 disabled:opacity-50"
                          disabled={isRequesting}
                        >
                          {isRequesting ? "Requesting..." : "Request Certificate"}
                        </button>
                      </requestFetcher.Form>
                    )}
                    <button
                      onClick={() => setUploadModal(host.id)}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      Upload Custom
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {uploadModal !== null && (
        <UploadModal
          hostId={uploadModal}
          onClose={() => setUploadModal(null)}
        />
      )}
    </div>
  );
}

function UploadModal({
  hostId,
  onClose,
}: {
  hostId: number;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">Upload Custom Certificate</h3>
        <fetcher.Form method="post" onSubmit={() => setTimeout(onClose, 100)}>
          <input type="hidden" name="intent" value="upload" />
          <input type="hidden" name="id" value={String(hostId)} />

          <div className="space-y-4">
            <div>
              <label htmlFor="certPath" className="block text-sm font-medium mb-1">
                Certificate Path
              </label>
              <input
                id="certPath"
                name="certPath"
                type="text"
                required
                placeholder="/etc/ssl/certs/example.crt"
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="keyPath" className="block text-sm font-medium mb-1">
                Key Path
              </label>
              <input
                id="keyPath"
                name="keyPath"
                type="text"
                required
                placeholder="/etc/ssl/private/example.key"
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}
