import { useState } from "react";

interface LocationUpstream {
  server: string;
  port: number;
  weight: number;
}

interface Location {
  path: string;
  matchType: string;
  type: string;
  upstreams?: LocationUpstream[];
  staticDir?: string;
  cacheExpires?: string;
  accessListId?: number;
  headers?: Record<string, string>;
}

interface LocationsTabProps {
  locations: Location[];
  setLocations: (locations: Location[]) => void;
}

export function LocationsTab({ locations, setLocations }: LocationsTabProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const addLocation = () => {
    setLocations([
      ...locations,
      {
        path: "/",
        matchType: "prefix",
        type: "proxy",
        upstreams: [],
      },
    ]);
    setExpandedIndex(locations.length);
  };

  const removeLocation = (index: number) => {
    setLocations(locations.filter((_, i) => i !== index));
    if (expandedIndex === index) setExpandedIndex(null);
  };

  const updateLocation = (index: number, field: string, value: any) => {
    const updated = [...locations];
    updated[index] = { ...updated[index], [field]: value };
    setLocations(updated);
  };

  const addLocationUpstream = (locIndex: number) => {
    const updated = [...locations];
    updated[locIndex] = {
      ...updated[locIndex],
      upstreams: [...(updated[locIndex].upstreams || []), { server: "", port: 80, weight: 1 }],
    };
    setLocations(updated);
  };

  const removeLocationUpstream = (locIndex: number, upstreamIndex: number) => {
    const updated = [...locations];
    updated[locIndex] = {
      ...updated[locIndex],
      upstreams: updated[locIndex].upstreams?.filter((_, i) => i !== upstreamIndex),
    };
    setLocations(updated);
  };

  const updateLocationUpstream = (
    locIndex: number,
    upstreamIndex: number,
    field: string,
    value: string | number
  ) => {
    const updated = [...locations];
    const upstreams = [...(updated[locIndex].upstreams || [])];
    upstreams[upstreamIndex] = { ...upstreams[upstreamIndex], [field]: value };
    updated[locIndex] = { ...updated[locIndex], upstreams };
    setLocations(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <label className="block text-sm font-medium text-gray-700">
          Location Blocks
        </label>
        <button
          type="button"
          onClick={addLocation}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          + Add Location
        </button>
      </div>

      {locations.length === 0 ? (
        <div className="border border-gray-300 rounded p-4 text-center text-gray-500 text-sm">
          No locations configured. The default upstream will be used.
        </div>
      ) : (
        <div className="space-y-3">
          {locations.map((location, locIndex) => (
            <div key={locIndex} className="border border-gray-300 rounded">
              <div
                className="bg-gray-50 px-4 py-3 flex justify-between items-center cursor-pointer"
                onClick={() =>
                  setExpandedIndex(expandedIndex === locIndex ? null : locIndex)
                }
              >
                <div>
                  <span className="font-medium text-gray-900">
                    {location.path || "(empty path)"}
                  </span>
                  <span className="text-sm text-gray-500 ml-2">
                    ({location.matchType} - {location.type})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLocation(locIndex);
                    }}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Remove
                  </button>
                  <span className="text-gray-400">
                    {expandedIndex === locIndex ? "▲" : "▼"}
                  </span>
                </div>
              </div>

              {expandedIndex === locIndex && (
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        Path
                      </label>
                      <input
                        type="text"
                        value={location.path}
                        onChange={(e) =>
                          updateLocation(locIndex, "path", e.target.value)
                        }
                        placeholder="/"
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        Match Type
                      </label>
                      <select
                        value={location.matchType}
                        onChange={(e) =>
                          updateLocation(locIndex, "matchType", e.target.value)
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      >
                        <option value="prefix">Prefix</option>
                        <option value="exact">Exact</option>
                        <option value="regex">Regex</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        Type
                      </label>
                      <select
                        value={location.type}
                        onChange={(e) =>
                          updateLocation(locIndex, "type", e.target.value)
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      >
                        <option value="proxy">Proxy</option>
                        <option value="static">Static</option>
                      </select>
                    </div>
                  </div>

                  {location.type === "proxy" && (
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-xs text-gray-600">
                          Upstreams (optional, uses default if empty)
                        </label>
                        <button
                          type="button"
                          onClick={() => addLocationUpstream(locIndex)}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          + Add Upstream
                        </button>
                      </div>

                      {location.upstreams && location.upstreams.length > 0 && (
                        <div className="space-y-2">
                          {location.upstreams.map((upstream, upIndex) => (
                            <div
                              key={upIndex}
                              className="bg-gray-50 p-3 rounded space-y-2"
                            >
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-600">
                                  Upstream {upIndex + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeLocationUpstream(locIndex, upIndex)
                                  }
                                  className="text-xs text-red-600 hover:text-red-800"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <input
                                  type="text"
                                  value={upstream.server}
                                  onChange={(e) =>
                                    updateLocationUpstream(
                                      locIndex,
                                      upIndex,
                                      "server",
                                      e.target.value
                                    )
                                  }
                                  placeholder="Server"
                                  className="border border-gray-300 rounded px-2 py-1 text-xs"
                                />
                                <input
                                  type="number"
                                  value={upstream.port}
                                  onChange={(e) =>
                                    updateLocationUpstream(
                                      locIndex,
                                      upIndex,
                                      "port",
                                      Number(e.target.value)
                                    )
                                  }
                                  placeholder="Port"
                                  className="border border-gray-300 rounded px-2 py-1 text-xs"
                                />
                                <input
                                  type="number"
                                  value={upstream.weight}
                                  onChange={(e) =>
                                    updateLocationUpstream(
                                      locIndex,
                                      upIndex,
                                      "weight",
                                      Number(e.target.value)
                                    )
                                  }
                                  placeholder="Weight"
                                  className="border border-gray-300 rounded px-2 py-1 text-xs"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {location.type === "static" && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Static Directory Path
                        </label>
                        <input
                          type="text"
                          value={location.staticDir || ""}
                          onChange={(e) =>
                            updateLocation(locIndex, "staticDir", e.target.value)
                          }
                          placeholder="/var/www/html"
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Cache Expires
                        </label>
                        <input
                          type="text"
                          value={location.cacheExpires || ""}
                          onChange={(e) =>
                            updateLocation(
                              locIndex,
                              "cacheExpires",
                              e.target.value
                            )
                          }
                          placeholder="1h"
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
