import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

interface Upstream {
  server: string;
  port: number;
  weight: number;
}

interface UpstreamsTabProps {
  upstreams: Upstream[];
  setUpstreams: (upstreams: Upstream[]) => void;
  balanceMethod: string;
  setBalanceMethod: (method: string) => void;
}

export function UpstreamsTab({
  upstreams,
  setUpstreams,
  balanceMethod,
  setBalanceMethod,
}: UpstreamsTabProps) {
  const addUpstream = () => {
    setUpstreams([...upstreams, { server: "", port: 80, weight: 1 }]);
  };

  const removeUpstream = (index: number) => {
    setUpstreams(upstreams.filter((_, i) => i !== index));
  };

  const updateUpstream = (index: number, field: keyof Upstream, value: string | number) => {
    const updated = [...upstreams];
    updated[index] = { ...updated[index], [field]: value };
    setUpstreams(updated);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="mb-1">Load Balancing Method</Label>
        <select
          value={balanceMethod}
          onChange={(e) => setBalanceMethod(e.target.value)}
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
          <Label>Upstream Servers</Label>
          <Button variant="outline" size="sm" type="button" onClick={addUpstream}>
            <Plus className="mr-2 h-4 w-4" />
            Add Upstream
          </Button>
        </div>

        {upstreams.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No upstreams configured. Click "Add Upstream" to add one.
          </div>
        ) : (
          <div className="space-y-3">
            {upstreams.map((upstream, index) => (
              <Card key={index} className="p-4">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-medium">
                    Upstream {index + 1}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => removeUpstream(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs mb-1">Server</Label>
                    <Input
                      type="text"
                      value={upstream.server}
                      onChange={(e) =>
                        updateUpstream(index, "server", e.target.value)
                      }
                      placeholder="192.168.1.10"
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1">Port</Label>
                    <Input
                      type="number"
                      value={upstream.port}
                      onChange={(e) =>
                        updateUpstream(index, "port", Number(e.target.value))
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1">Weight</Label>
                    <Input
                      type="number"
                      value={upstream.weight}
                      onChange={(e) =>
                        updateUpstream(index, "weight", Number(e.target.value))
                      }
                      min={1}
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
