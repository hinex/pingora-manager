import { useState, useEffect } from "react";
import { Form, useActionData } from "react-router";
import { toast } from "sonner";
import { LocationsTab } from "./LocationsTab";
import { SslTab } from "./SslTab";
import { AdvancedTab } from "./AdvancedTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { X, Plus } from "lucide-react";
import { LABEL_COLORS, type LabelItem } from "~/components/LabelsModal";

export interface LocationFormData {
  path: string;
  matchType: "prefix" | "exact" | "regex";
  type: "proxy" | "static" | "redirect";
  upstreams: Array<{ server: string; port: number; weight: number }>;
  balanceMethod: string;
  staticDir: string;
  cacheExpires: string;
  forwardScheme: string;
  forwardDomain: string;
  forwardPath: string;
  preservePath: boolean;
  statusCode: number;
  headers: Record<string, string>;
  accessListId: number | null;
}

export interface StreamPortFormData {
  port: number | null;
  protocol: "tcp" | "udp";
  upstreams: Array<{ server: string; port: number; weight: number }>;
  balanceMethod: string;
}

export interface HostFormData {
  domains: string[];
  groupId: number | null;
  enabled: boolean;
  labelIds: number[];
  sslType: string;
  sslCertPath: string;
  sslKeyPath: string;
  sslForceHttps: boolean;
  hsts: boolean;
  http2: boolean;
  locations: LocationFormData[];
  streamPorts: StreamPortFormData[];
  webhookUrl: string;
  advancedYaml: string;
}

export const defaultLocation: LocationFormData = {
  path: "/",
  matchType: "prefix",
  type: "proxy",
  upstreams: [],
  balanceMethod: "round_robin",
  staticDir: "",
  cacheExpires: "",
  forwardScheme: "https",
  forwardDomain: "",
  forwardPath: "/",
  preservePath: true,
  statusCode: 301,
  headers: {},
  accessListId: null,
};

const defaultFormData: HostFormData = {
  domains: [],
  groupId: null,
  enabled: true,
  labelIds: [],
  sslType: "none",
  sslCertPath: "",
  sslKeyPath: "",
  sslForceHttps: false,
  hsts: true,
  http2: true,
  locations: [{ ...defaultLocation }],
  streamPorts: [],
  webhookUrl: "",
  advancedYaml: "",
};

interface HostFormProps {
  initialData?: Partial<HostFormData>;
  groups: Array<{ id: number; name: string }>;
  labels: LabelItem[];
  accessLists: Array<{ id: number; name: string }>;
  submitLabel: string;
}

export function HostForm({
  initialData,
  groups,
  labels,
  accessLists,
  submitLabel,
}: HostFormProps) {
  const actionData = useActionData<{ error?: string }>();

  useEffect(() => {
    if (actionData?.error) {
      toast.error(actionData.error);
    }
  }, [actionData]);

  const [activeTab, setActiveTab] = useState("general");
  const [formData, setFormData] = useState<HostFormData>({
    ...defaultFormData,
    ...initialData,
  });
  const [domainInput, setDomainInput] = useState("");

  const update = (partial: Partial<HostFormData>) =>
    setFormData((prev) => ({ ...prev, ...partial }));

  const handleAddDomain = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addDomainFromInput();
    }
  };

  const addDomainFromInput = () => {
    const value = domainInput.trim();
    if (value && !formData.domains.includes(value)) {
      update({ domains: [...formData.domains, value] });
      setDomainInput("");
    }
  };

  const removeDomain = (index: number) => {
    update({ domains: formData.domains.filter((_, i) => i !== index) });
  };

  const toggleLabel = (labelId: number) => {
    update({
      labelIds: formData.labelIds.includes(labelId)
        ? formData.labelIds.filter((id) => id !== labelId)
        : [...formData.labelIds, labelId],
    });
  };

  const showSsl = formData.domains.length > 0 || formData.sslType !== "none";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // At least one location or stream port required
    if (formData.locations.length === 0 && formData.streamPorts.length === 0) {
      e.preventDefault();
      toast.error("At least one location or stream port is required");
      setActiveTab("locations");
      return;
    }

    // Domains required if there are HTTP locations
    if (formData.locations.length > 0 && formData.domains.length === 0) {
      e.preventDefault();
      toast.error("At least one domain is required when locations are configured");
      setActiveTab("general");
      return;
    }

    // Per-location validation
    for (let i = 0; i < formData.locations.length; i++) {
      const loc = formData.locations[i];
      if (loc.type === "proxy" && loc.upstreams.length === 0) {
        e.preventDefault();
        toast.error(`Location "${loc.path}": at least one upstream is required for proxy type`);
        setActiveTab("locations");
        return;
      }
      if (loc.type === "static" && !loc.staticDir?.trim()) {
        e.preventDefault();
        toast.error(`Location "${loc.path}": static directory path is required`);
        setActiveTab("locations");
        return;
      }
      if (loc.type === "redirect" && !loc.forwardDomain?.trim()) {
        e.preventDefault();
        toast.error(`Location "${loc.path}": forward domain is required for redirect type`);
        setActiveTab("locations");
        return;
      }
    }

    // Per-stream-port validation
    for (let i = 0; i < formData.streamPorts.length; i++) {
      const sp = formData.streamPorts[i];
      if (!sp.port || sp.port < 1 || sp.port > 65535) {
        e.preventDefault();
        toast.error(`Stream port ${i + 1}: port must be between 1 and 65535`);
        setActiveTab("advanced");
        return;
      }
      if (sp.upstreams.length === 0) {
        e.preventDefault();
        toast.error(`Stream port ${sp.port}: at least one upstream is required`);
        setActiveTab("advanced");
        return;
      }
    }

    if (formData.sslType === "custom") {
      if (!formData.sslCertPath || !formData.sslKeyPath) {
        e.preventDefault();
        toast.error("Please provide both certificate and key paths for custom SSL");
        setActiveTab("ssl");
        return;
      }
    }
  };

  // Build available tabs
  const tabs: Array<{ value: string; label: string }> = [
    { value: "general", label: "General" },
    { value: "locations", label: "Locations" },
  ];
  if (showSsl) tabs.push({ value: "ssl", label: "SSL" });
  tabs.push({ value: "advanced", label: "Advanced" });

  // Reset tab if current tab is no longer visible
  useEffect(() => {
    if (!tabs.find((t) => t.value === activeTab)) {
      setActiveTab("general");
    }
  }, [formData.domains.length, formData.sslType]);

  return (
    <Form method="post" onSubmit={handleSubmit}>
      <input type="hidden" name="formData" value={JSON.stringify(formData)} />

      <Card>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="border-b border-border px-4">
            <TabsList className="bg-transparent">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <CardContent className="p-6">
            {/* General Tab */}
            <TabsContent value="general" className="mt-0">
              <div className="space-y-4">
                {/* Domains */}
                <div>
                  <Label className="mb-1">Domains</Label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {formData.domains.map((domain, index) => (
                      <Badge key={index} variant="secondary" className="gap-1">
                        {domain}
                        <button type="button" onClick={() => removeDomain(index)}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value)}
                      onKeyDown={handleAddDomain}
                      placeholder="example.com"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={addDomainFromInput}
                      disabled={!domainInput.trim()}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Group */}
                <div>
                  <Label className="mb-1">Group</Label>
                  <select
                    value={formData.groupId ?? ""}
                    onChange={(e) => update({ groupId: e.target.value ? Number(e.target.value) : null })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">No Group</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Labels */}
                {labels.length > 0 && (
                  <div>
                    <Label className="mb-1">Labels</Label>
                    <div className="flex flex-wrap gap-2">
                      {labels.map((label) => {
                        const colorDef = LABEL_COLORS.find((c) => c.value === label.color);
                        const isSelected = formData.labelIds.includes(label.id);
                        return (
                          <button
                            key={label.id}
                            type="button"
                            onClick={() => toggleLabel(label.id)}
                            className={cn(
                              "px-2 py-1 rounded text-xs font-medium border-2 transition-colors",
                              colorDef?.bg,
                              isSelected ? "border-foreground" : "border-transparent opacity-60"
                            )}
                          >
                            {label.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Enabled */}
                <div className="flex items-center gap-3">
                  <Switch checked={formData.enabled} onCheckedChange={(enabled) => update({ enabled })} />
                  <Label>Enabled</Label>
                </div>
              </div>
            </TabsContent>

            {/* Locations Tab */}
            <TabsContent value="locations" className="mt-0">
              <LocationsTab
                locations={formData.locations}
                setLocations={(locations) => update({ locations })}
                accessLists={accessLists}
              />
            </TabsContent>

            {/* SSL Tab */}
            {showSsl && (
              <TabsContent value="ssl" className="mt-0">
                <SslTab
                  sslType={formData.sslType}
                  setSslType={(sslType) => update({ sslType })}
                  sslCertPath={formData.sslCertPath}
                  setSslCertPath={(sslCertPath) => update({ sslCertPath })}
                  sslKeyPath={formData.sslKeyPath}
                  setSslKeyPath={(sslKeyPath) => update({ sslKeyPath })}
                  sslForceHttps={formData.sslForceHttps}
                  setSslForceHttps={(sslForceHttps) => update({ sslForceHttps })}
                  http2={formData.http2}
                  setHttp2={(http2) => update({ http2 })}
                  hsts={formData.hsts}
                  setHsts={(hsts) => update({ hsts })}
                />
              </TabsContent>
            )}

            {/* Advanced Tab */}
            <TabsContent value="advanced" className="mt-0">
              <AdvancedTab
                webhookUrl={formData.webhookUrl}
                setWebhookUrl={(webhookUrl) => update({ webhookUrl })}
                advancedYaml={formData.advancedYaml}
                setAdvancedYaml={(advancedYaml) => update({ advancedYaml })}
                streamPorts={formData.streamPorts}
                setStreamPorts={(streamPorts) => update({ streamPorts })}
              />
            </TabsContent>
          </CardContent>
        </Tabs>
        <div className="border-t border-border px-6 py-4 flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={() => window.history.back()}>
            Cancel
          </Button>
          <Button type="submit">{submitLabel}</Button>
        </div>
      </Card>
    </Form>
  );
}
