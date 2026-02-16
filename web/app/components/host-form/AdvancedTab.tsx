import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import type { StreamPortFormData } from "./HostForm";

interface AdvancedTabProps {
  webhookUrl: string;
  setWebhookUrl: (url: string) => void;
  advancedYaml: string;
  setAdvancedYaml: (yaml: string) => void;
  streamPorts: StreamPortFormData[];
  setStreamPorts: (ports: StreamPortFormData[]) => void;
}

export function AdvancedTab({
  webhookUrl,
  setWebhookUrl,
  advancedYaml,
  setAdvancedYaml,
  streamPorts,
  setStreamPorts,
}: AdvancedTabProps) {
  const addStreamPort = () => {
    setStreamPorts([
      ...streamPorts,
      { port: null, protocol: "tcp", upstreams: [], balanceMethod: "round_robin" },
    ]);
  };

  const removeStreamPort = (index: number) => {
    setStreamPorts(streamPorts.filter((_, i) => i !== index));
  };

  const updateStreamPort = (index: number, partial: Partial<StreamPortFormData>) => {
    const updated = [...streamPorts];
    updated[index] = { ...updated[index], ...partial };
    setStreamPorts(updated);
  };

  const addStreamUpstream = (spIndex: number) => {
    const sp = streamPorts[spIndex];
    updateStreamPort(spIndex, {
      upstreams: [...sp.upstreams, { server: "", port: 80, weight: 1 }],
    });
  };

  const removeStreamUpstream = (spIndex: number, upIndex: number) => {
    const sp = streamPorts[spIndex];
    updateStreamPort(spIndex, {
      upstreams: sp.upstreams.filter((_, i) => i !== upIndex),
    });
  };

  const updateStreamUpstream = (
    spIndex: number,
    upIndex: number,
    field: string,
    value: string | number
  ) => {
    const sp = streamPorts[spIndex];
    const upstreams = [...sp.upstreams];
    upstreams[upIndex] = { ...upstreams[upIndex], [field]: value };
    updateStreamPort(spIndex, { upstreams });
  };

  return (
    <div className="space-y-6">
      {/* Stream Ports Section */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <div>
            <Label className="text-base font-medium">Stream Ports</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              TCP/UDP port forwarding, separate from HTTP locations
            </p>
          </div>
          <Button variant="outline" size="sm" type="button" onClick={addStreamPort}>
            <Plus className="mr-2 h-4 w-4" />
            Add Stream Port
          </Button>
        </div>

        {streamPorts.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No stream ports configured. Stream ports allow TCP/UDP forwarding to upstream servers.
          </div>
        ) : (
          <div className="space-y-4">
            {streamPorts.map((sp, spIndex) => (
              <div key={spIndex} className="rounded-md border p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">
                    Stream Port {spIndex + 1}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="h-7 w-7 p-0"
                    onClick={() => removeStreamPort(spIndex)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs mb-1">Port</Label>
                    <Input
                      type="number"
                      value={sp.port ?? ""}
                      onChange={(e) =>
                        updateStreamPort(spIndex, {
                          port: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      min={1}
                      max={65535}
                      placeholder="8080"
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1">Protocol</Label>
                    <select
                      value={sp.protocol}
                      onChange={(e) =>
                        updateStreamPort(spIndex, {
                          protocol: e.target.value as "tcp" | "udp",
                        })
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs mb-1">Balance Method</Label>
                    <select
                      value={sp.balanceMethod}
                      onChange={(e) =>
                        updateStreamPort(spIndex, { balanceMethod: e.target.value })
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
                </div>

                {/* Stream port upstreams */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label className="text-xs">Upstreams</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => addStreamUpstream(spIndex)}
                    >
                      <Plus className="mr-2 h-3 w-3" />
                      Add Upstream
                    </Button>
                  </div>

                  {sp.upstreams.length === 0 ? (
                    <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                      No upstreams configured. Add at least one upstream.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sp.upstreams.map((upstream, upIndex) => (
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
                              onClick={() => removeStreamUpstream(spIndex, upIndex)}
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
                                  updateStreamUpstream(spIndex, upIndex, "server", e.target.value)
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
                                  updateStreamUpstream(spIndex, upIndex, "port", Number(e.target.value))
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
                                  updateStreamUpstream(spIndex, upIndex, "weight", Number(e.target.value))
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
            ))}
          </div>
        )}
      </div>

      {/* Webhook URL */}
      <div>
        <Label className="mb-1">Webhook URL</Label>
        <Input
          type="text"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://example.com/webhook"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Optional webhook to notify when configuration changes
        </p>
      </div>

      {/* Advanced YAML */}
      <div>
        <Label className="mb-1">Advanced YAML Configuration</Label>
        <Textarea
          value={advancedYaml}
          onChange={(e) => setAdvancedYaml(e.target.value)}
          rows={12}
          placeholder="# Custom Pingora directives in YAML format"
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Optional advanced configuration in YAML format for custom Pingora directives
        </p>
      </div>
    </div>
  );
}
