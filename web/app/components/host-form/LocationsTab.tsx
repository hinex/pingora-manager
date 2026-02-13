import { useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";

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
        <Label>Location Blocks</Label>
        <Button variant="outline" size="sm" type="button" onClick={addLocation}>
          <Plus className="mr-2 h-4 w-4" />
          Add Location
        </Button>
      </div>

      {locations.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          No locations configured. The default upstream will be used.
        </div>
      ) : (
        <div className="space-y-3">
          {locations.map((location, locIndex) => (
            <div key={locIndex} className="rounded-md border">
              <div
                className="flex items-center justify-between px-4 py-3 bg-muted/50 cursor-pointer"
                onClick={() =>
                  setExpandedIndex(expandedIndex === locIndex ? null : locIndex)
                }
              >
                <div>
                  <span className="font-medium">
                    {location.path || "(empty path)"}
                  </span>
                  <span className="text-sm text-muted-foreground ml-2">
                    ({location.matchType} - {location.type})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLocation(locIndex);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  {expandedIndex === locIndex ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {expandedIndex === locIndex && (
                <div className="p-4 space-y-4 border-t">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs mb-1">Path</Label>
                      <Input
                        type="text"
                        value={location.path}
                        onChange={(e) =>
                          updateLocation(locIndex, "path", e.target.value)
                        }
                        placeholder="/"
                      />
                    </div>
                    <div>
                      <Label className="text-xs mb-1">Match Type</Label>
                      <select
                        value={location.matchType}
                        onChange={(e) =>
                          updateLocation(locIndex, "matchType", e.target.value)
                        }
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="prefix">Prefix</option>
                        <option value="exact">Exact</option>
                        <option value="regex">Regex</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs mb-1">Type</Label>
                      <select
                        value={location.type}
                        onChange={(e) =>
                          updateLocation(locIndex, "type", e.target.value)
                        }
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="proxy">Proxy</option>
                        <option value="static">Static</option>
                      </select>
                    </div>
                  </div>

                  {location.type === "proxy" && (
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <Label className="text-xs">
                          Upstreams (optional, uses default if empty)
                        </Label>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={() => addLocationUpstream(locIndex)}
                        >
                          <Plus className="mr-2 h-3 w-3" />
                          Add Upstream
                        </Button>
                      </div>

                      {location.upstreams && location.upstreams.length > 0 && (
                        <div className="space-y-2">
                          {location.upstreams.map((upstream, upIndex) => (
                            <div
                              key={upIndex}
                              className="rounded-md bg-muted/50 p-3 space-y-2"
                            >
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">
                                  Upstream {upIndex + 1}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  type="button"
                                  onClick={() =>
                                    removeLocationUpstream(locIndex, upIndex)
                                  }
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <Input
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
                                  className="text-xs"
                                />
                                <Input
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
                                  className="text-xs"
                                />
                                <Input
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
                                  className="text-xs"
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
                        <Label className="text-xs mb-1">Static Directory Path</Label>
                        <Input
                          type="text"
                          value={location.staticDir || ""}
                          onChange={(e) =>
                            updateLocation(locIndex, "staticDir", e.target.value)
                          }
                          placeholder="/var/www/html"
                        />
                      </div>
                      <div>
                        <Label className="text-xs mb-1">Cache Expires</Label>
                        <Input
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
