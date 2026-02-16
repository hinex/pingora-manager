import { useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Checkbox } from "~/components/ui/checkbox";
import { Plus, Trash2, ChevronDown, ChevronUp, X } from "lucide-react";
import { defaultLocation, type LocationFormData } from "./HostForm";

interface LocationsTabProps {
  locations: LocationFormData[];
  setLocations: (locations: LocationFormData[]) => void;
  accessLists: Array<{ id: number; name: string }>;
}

export function LocationsTab({ locations, setLocations, accessLists }: LocationsTabProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    locations.length > 0 ? 0 : null
  );

  const addLocation = () => {
    setLocations([...locations, { ...defaultLocation }]);
    setExpandedIndex(locations.length);
  };

  const removeLocation = (index: number) => {
    setLocations(locations.filter((_, i) => i !== index));
    if (expandedIndex === index) setExpandedIndex(null);
    else if (expandedIndex !== null && expandedIndex > index) {
      setExpandedIndex(expandedIndex - 1);
    }
  };

  const updateLocation = (index: number, partial: Partial<LocationFormData>) => {
    const updated = [...locations];
    updated[index] = { ...updated[index], ...partial };
    setLocations(updated);
  };

  const addUpstream = (locIndex: number) => {
    const loc = locations[locIndex];
    updateLocation(locIndex, {
      upstreams: [...loc.upstreams, { server: "", port: 80, weight: 1 }],
    });
  };

  const removeUpstream = (locIndex: number, upIndex: number) => {
    const loc = locations[locIndex];
    updateLocation(locIndex, {
      upstreams: loc.upstreams.filter((_, i) => i !== upIndex),
    });
  };

  const updateUpstream = (
    locIndex: number,
    upIndex: number,
    field: string,
    value: string | number
  ) => {
    const loc = locations[locIndex];
    const upstreams = [...loc.upstreams];
    upstreams[upIndex] = { ...upstreams[upIndex], [field]: value };
    updateLocation(locIndex, { upstreams });
  };

  const addHeader = (locIndex: number) => {
    const loc = locations[locIndex];
    const headers = { ...loc.headers, "": "" };
    updateLocation(locIndex, { headers });
  };

  const removeHeader = (locIndex: number, key: string) => {
    const loc = locations[locIndex];
    const headers = { ...loc.headers };
    delete headers[key];
    updateLocation(locIndex, { headers });
  };

  const updateHeaderKey = (locIndex: number, oldKey: string, newKey: string) => {
    const loc = locations[locIndex];
    const entries = Object.entries(loc.headers);
    const headers: Record<string, string> = {};
    for (const [k, v] of entries) {
      headers[k === oldKey ? newKey : k] = v;
    }
    updateLocation(locIndex, { headers });
  };

  const updateHeaderValue = (locIndex: number, key: string, value: string) => {
    const loc = locations[locIndex];
    updateLocation(locIndex, { headers: { ...loc.headers, [key]: value } });
  };

  const getLocationSummary = (loc: LocationFormData): string => {
    switch (loc.type) {
      case "proxy":
        return loc.upstreams.length > 0
          ? `${loc.upstreams.length} upstream${loc.upstreams.length !== 1 ? "s" : ""}`
          : "no upstreams";
      case "static":
        return loc.staticDir || "no directory";
      case "redirect":
        return loc.forwardDomain
          ? `-> ${loc.forwardScheme}://${loc.forwardDomain}`
          : "no target";
      default:
        return "";
    }
  };

  const typeBadgeVariant = (type: string) => {
    switch (type) {
      case "proxy":
        return "default" as const;
      case "static":
        return "secondary" as const;
      case "redirect":
        return "outline" as const;
      default:
        return "default" as const;
    }
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
          No locations configured. Click &quot;Add Location&quot; to add one.
        </div>
      ) : (
        <div className="space-y-3">
          {locations.map((location, locIndex) => (
            <div key={locIndex} className="rounded-md border">
              {/* Collapsed header */}
              <div
                className="flex items-center justify-between px-4 py-3 bg-muted/50 cursor-pointer"
                onClick={() =>
                  setExpandedIndex(expandedIndex === locIndex ? null : locIndex)
                }
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium font-mono text-sm">
                    {location.path || "/"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {location.matchType}
                  </span>
                  <Badge variant={typeBadgeVariant(location.type)} className="text-xs">
                    {location.type}
                  </Badge>
                  <span className="text-xs text-muted-foreground truncate">
                    {getLocationSummary(location)}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="h-7 w-7 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLocation(locIndex);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  {expandedIndex === locIndex ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Expanded content */}
              {expandedIndex === locIndex && (
                <div className="p-4 space-y-4 border-t">
                  {/* Row 1: Path + Match Type + Type */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs mb-1">Path</Label>
                      <Input
                        type="text"
                        value={location.path}
                        onChange={(e) =>
                          updateLocation(locIndex, { path: e.target.value })
                        }
                        placeholder="/"
                      />
                    </div>
                    <div>
                      <Label className="text-xs mb-1">Match Type</Label>
                      <select
                        value={location.matchType}
                        onChange={(e) =>
                          updateLocation(locIndex, {
                            matchType: e.target.value as LocationFormData["matchType"],
                          })
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
                          updateLocation(locIndex, {
                            type: e.target.value as LocationFormData["type"],
                          })
                        }
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="proxy">Proxy</option>
                        <option value="static">Static</option>
                        <option value="redirect">Redirect</option>
                      </select>
                    </div>
                  </div>

                  {/* Type-specific section: Proxy */}
                  {location.type === "proxy" && (
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs mb-1">Balance Method</Label>
                        <select
                          value={location.balanceMethod}
                          onChange={(e) =>
                            updateLocation(locIndex, { balanceMethod: e.target.value })
                          }
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <option value="round_robin">Round Robin</option>
                          <option value="weighted">Weighted</option>
                          <option value="least_conn">Least Connections</option>
                          <option value="ip_hash">IP Hash</option>
                          <option value="random">Random</option>
                        </select>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <Label className="text-xs">Upstreams</Label>
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={() => addUpstream(locIndex)}
                          >
                            <Plus className="mr-2 h-3 w-3" />
                            Add Upstream
                          </Button>
                        </div>

                        {location.upstreams.length === 0 ? (
                          <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                            No upstreams configured. Add at least one upstream for proxy locations.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {location.upstreams.map((upstream, upIndex) => (
                              <div
                                key={upIndex}
                                className="rounded-md bg-muted/50 p-3"
                              >
                                <div className="flex justify-between items-center mb-2">
                                  <span className="text-xs text-muted-foreground">
                                    Upstream {upIndex + 1}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    type="button"
                                    className="h-6 w-6 p-0"
                                    onClick={() => removeUpstream(locIndex, upIndex)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <Label className="text-xs mb-1">Server</Label>
                                    <Input
                                      type="text"
                                      value={upstream.server}
                                      onChange={(e) =>
                                        updateUpstream(locIndex, upIndex, "server", e.target.value)
                                      }
                                      placeholder="192.168.1.10"
                                      className="text-xs"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs mb-1">Port</Label>
                                    <Input
                                      type="number"
                                      value={upstream.port}
                                      onChange={(e) =>
                                        updateUpstream(locIndex, upIndex, "port", Number(e.target.value))
                                      }
                                      placeholder="80"
                                      className="text-xs"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs mb-1">Weight</Label>
                                    <Input
                                      type="number"
                                      value={upstream.weight}
                                      onChange={(e) =>
                                        updateUpstream(locIndex, upIndex, "weight", Number(e.target.value))
                                      }
                                      min={1}
                                      className="text-xs"
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Type-specific section: Static */}
                  {location.type === "static" && (
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs mb-1">Static Directory Path</Label>
                        <Input
                          type="text"
                          value={location.staticDir}
                          onChange={(e) =>
                            updateLocation(locIndex, { staticDir: e.target.value })
                          }
                          placeholder="/var/www/html"
                        />
                      </div>
                      <div>
                        <Label className="text-xs mb-1">Cache Expires</Label>
                        <Input
                          type="text"
                          value={location.cacheExpires}
                          onChange={(e) =>
                            updateLocation(locIndex, { cacheExpires: e.target.value })
                          }
                          placeholder="30d, 1h, 3600s"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Duration format: 30d, 12h, 45m, 120s
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Type-specific section: Redirect */}
                  {location.type === "redirect" && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs mb-1">Scheme</Label>
                          <select
                            value={location.forwardScheme}
                            onChange={(e) =>
                              updateLocation(locIndex, { forwardScheme: e.target.value })
                            }
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <option value="http">http</option>
                            <option value="https">https</option>
                          </select>
                        </div>
                        <div>
                          <Label className="text-xs mb-1">Status Code</Label>
                          <select
                            value={location.statusCode}
                            onChange={(e) =>
                              updateLocation(locIndex, { statusCode: Number(e.target.value) })
                            }
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <option value="301">301 (Permanent)</option>
                            <option value="302">302 (Temporary)</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs mb-1">Forward Domain</Label>
                        <Input
                          type="text"
                          value={location.forwardDomain}
                          onChange={(e) =>
                            updateLocation(locIndex, { forwardDomain: e.target.value })
                          }
                          placeholder="example.com"
                        />
                      </div>
                      <div>
                        <Label className="text-xs mb-1">Forward Path</Label>
                        <Input
                          type="text"
                          value={location.forwardPath}
                          onChange={(e) =>
                            updateLocation(locIndex, { forwardPath: e.target.value })
                          }
                          placeholder="/"
                        />
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`preservePath-${locIndex}`}
                          checked={location.preservePath}
                          onCheckedChange={(checked) =>
                            updateLocation(locIndex, { preservePath: checked === true })
                          }
                        />
                        <Label htmlFor={`preservePath-${locIndex}`} className="font-normal text-sm">
                          Preserve Path
                        </Label>
                      </div>
                    </div>
                  )}

                  {/* Headers section (always shown) */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <Label className="text-xs">Custom Headers</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => addHeader(locIndex)}
                      >
                        <Plus className="mr-2 h-3 w-3" />
                        Add Header
                      </Button>
                    </div>

                    {Object.keys(location.headers).length > 0 && (
                      <div className="space-y-2">
                        {Object.entries(location.headers).map(([key, value], hIndex) => (
                          <div key={hIndex} className="flex gap-2 items-center">
                            <Input
                              type="text"
                              value={key}
                              onChange={(e) => updateHeaderKey(locIndex, key, e.target.value)}
                              placeholder="Header name"
                              className="flex-1 text-xs"
                            />
                            <Input
                              type="text"
                              value={value}
                              onChange={(e) => updateHeaderValue(locIndex, key, e.target.value)}
                              placeholder="Header value"
                              className="flex-1 text-xs"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              className="h-7 w-7 p-0 flex-shrink-0"
                              onClick={() => removeHeader(locIndex, key)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Access List dropdown */}
                  <div>
                    <Label className="text-xs mb-1">Access List</Label>
                    <select
                      value={location.accessListId ?? ""}
                      onChange={(e) =>
                        updateLocation(locIndex, {
                          accessListId: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">None</option>
                      {accessLists.map((al) => (
                        <option key={al.id} value={al.id}>
                          {al.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
