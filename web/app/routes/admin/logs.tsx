import type { Route } from "./+types/logs";
import { db } from "~/lib/db/connection";
import { proxyHosts } from "~/lib/db/schema";
import { useState, useEffect, useCallback } from "react";

export async function loader({}: Route.LoaderArgs) {
  const hosts = db.select().from(proxyHosts).all();
  return {
    hosts: hosts.map((h) => ({
      id: h.id,
      domains: h.domains as string[],
    })),
  };
}

export default function LogsPage({ loaderData }: Route.ComponentProps) {
  const { hosts } = loaderData;
  const [selectedHost, setSelectedHost] = useState("");
  const [tab, setTab] = useState<"access" | "error">("access");
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!selectedHost) {
      setLines([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/logs?hostId=${selectedHost}&type=${tab}&lines=100`
      );
      const data = await res.json();
      setLines(data.lines ?? []);
    } catch {
      setLines([]);
    }
  }, [selectedHost, tab]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const filteredLines = filter
    ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Logs</h1>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-wrap gap-4 mb-4">
          <div>
            <label htmlFor="host" className="block text-sm font-medium mb-1">
              Host
            </label>
            <select
              id="host"
              value={selectedHost}
              onChange={(e) => setSelectedHost(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a host</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.domains.join(", ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Log Type</label>
            <div className="flex border border-gray-300 rounded overflow-hidden">
              <button
                onClick={() => setTab("access")}
                className={`px-4 py-2 text-sm ${
                  tab === "access"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Access
              </button>
              <button
                onClick={() => setTab("error")}
                className={`px-4 py-2 text-sm ${
                  tab === "error"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Error
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="filter" className="block text-sm font-medium mb-1">
              Filter
            </label>
            <input
              id="filter"
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search logs..."
              className="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-300"
              />
              Auto-refresh (5s)
            </label>
          </div>

          <div className="flex items-end">
            <button
              onClick={fetchLogs}
              className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="bg-gray-900 text-green-400 rounded p-4 font-mono text-xs overflow-x-auto max-h-[600px] overflow-y-auto">
          {filteredLines.length === 0 ? (
            <div className="text-gray-500">
              {selectedHost
                ? "No log entries found."
                : "Select a host to view logs."}
            </div>
          ) : (
            filteredLines.map((line, i) => (
              <div key={i} className="whitespace-pre hover:bg-gray-800">
                {line}
              </div>
            ))
          )}
        </div>

        <div className="mt-2 text-sm text-gray-500">
          Showing {filteredLines.length} of {lines.length} lines
        </div>
      </div>
    </div>
  );
}
