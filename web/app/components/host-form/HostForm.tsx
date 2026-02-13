import { useState, useEffect } from "react";
import { Form, useActionData } from "react-router";
import { toast } from "sonner";
import { UpstreamsTab } from "./UpstreamsTab";
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
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";
import { X, Globe, HardDrive, ArrowRightLeft, Radio } from "lucide-react";
import { LABEL_COLORS, type LabelItem } from "~/components/LabelsModal";

export interface HostFormData {
  type: "proxy" | "static" | "redirect" | "stream";
  domains: string[];
  groupId: number | null;
  enabled: boolean;
  labelIds: number[];

  // SSL
  sslType: string;
  sslCertPath: string;
  sslKeyPath: string;
  sslForceHttps: boolean;
  hsts: boolean;
  http2: boolean;

  // Proxy fields
  upstreams: Array<{ server: string; port: number; weight: number }>;
  balanceMethod: string;
  locations: Array<{
    path: string;
    matchType: string;
    type: string;
    upstreams?: Array<{ server: string; port: number; weight: number }>;
    staticDir?: string;
    cacheExpires?: string;
    accessListId?: number;
    headers?: Record<string, string>;
  }>;

  // Static fields
  staticDir: string;
  cacheExpires: string;

  // Redirect fields
  forwardScheme: string;
  forwardDomain: string;
  forwardPath: string;
  preservePath: boolean;
  statusCode: number;

  // Stream fields
  incomingPort: number | null;
  protocol: string;

  // Common
  webhookUrl: string;
  advancedYaml: string;
}

interface HostFormProps {
  initialData?: Partial<HostFormData>;
  groups: Array<{ id: number; name: string }>;
  labels: LabelItem[];
  submitLabel: string;
}

const defaultFormData: HostFormData = {
  type: "proxy",
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

  upstreams: [],
  balanceMethod: "round_robin",
  locations: [],

  staticDir: "",
  cacheExpires: "",

  forwardScheme: "https",
  forwardDomain: "",
  forwardPath: "/",
  preservePath: true,
  statusCode: 301,

  incomingPort: null,
  protocol: "tcp",

  webhookUrl: "",
  advancedYaml: "",
};

const HOST_TYPES = [
  { value: "proxy" as const, label: "Proxy", icon: Globe },
  { value: "static" as const, label: "Static", icon: HardDrive },
  { value: "redirect" as const, label: "Redirect", icon: ArrowRightLeft },
  { value: "stream" as const, label: "Stream", icon: Radio },
];

export function HostForm({
  initialData,
  groups,
  labels,
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
      const value = domainInput.trim();
      if (value && !formData.domains.includes(value)) {
        update({ domains: [...formData.domains, value] });
        setDomainInput("");
      }
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

  const showSsl = formData.type !== "stream";
  const showUpstreams = formData.type === "proxy" || formData.type === "stream";
  const showLocations = formData.type === "proxy";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // Domains required for all types except stream
    if (formData.type !== "stream" && formData.domains.length === 0) {
      e.preventDefault();
      toast.error("Please add at least one domain");
      setActiveTab("general");
      return;
    }

    // Type-specific validation
    if (formData.type === "proxy") {
      if (formData.upstreams.length === 0) {
        const hasProxyLocations = formData.locations.some((loc) => loc.type === "proxy");
        if (hasProxyLocations) {
          const allHaveUpstreams = formData.locations
            .filter((loc) => loc.type === "proxy")
            .every((loc) => loc.upstreams && loc.upstreams.length > 0);
          if (!allHaveUpstreams) {
            e.preventDefault();
            toast.error("Please configure at least one default upstream, or ensure all proxy locations have upstreams");
            setActiveTab("upstreams");
            return;
          }
        } else if (formData.locations.length === 0) {
          e.preventDefault();
          toast.error("Please configure at least one upstream");
          setActiveTab("upstreams");
          return;
        }
      }
    }

    if (formData.type === "static") {
      if (!formData.staticDir?.trim()) {
        e.preventDefault();
        toast.error("Static directory path is required");
        setActiveTab("general");
        return;
      }
    }

    if (formData.type === "redirect") {
      if (!formData.forwardDomain?.trim()) {
        e.preventDefault();
        toast.error("Forward domain is required");
        setActiveTab("general");
        return;
      }
    }

    if (formData.type === "stream") {
      if (!formData.incomingPort || formData.incomingPort < 1 || formData.incomingPort > 65535) {
        e.preventDefault();
        toast.error("Incoming port must be between 1 and 65535");
        setActiveTab("general");
        return;
      }
      if (formData.upstreams.length === 0) {
        e.preventDefault();
        toast.error("At least one upstream is required");
        setActiveTab("upstreams");
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

  // Build available tabs based on type
  const tabs: Array<{ value: string; label: string }> = [
    { value: "general", label: "General" },
  ];
  if (showUpstreams) tabs.push({ value: "upstreams", label: "Upstreams" });
  if (showLocations) tabs.push({ value: "locations", label: "Locations" });
  if (showSsl) tabs.push({ value: "ssl", label: "SSL" });
  tabs.push({ value: "advanced", label: "Advanced" });

  // Reset tab if current tab is no longer visible
  useEffect(() => {
    if (!tabs.find((t) => t.value === activeTab)) {
      setActiveTab("general");
    }
  }, [formData.type]);

  return (
    <Form method="post" onSubmit={handleSubmit}>
      <input type="hidden" name="formData" value={JSON.stringify(formData)} />

      {/* Type Selector */}
      <div className="flex gap-2 mb-6">
        {HOST_TYPES.map((ht) => {
          const Icon = ht.icon;
          return (
            <button
              key={ht.value}
              type="button"
              onClick={() => update({ type: ht.value })}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium transition-colors",
                formData.type === ht.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {ht.label}
            </button>
          );
        })}
      </div>

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
                {/* Domains — not for stream */}
                {formData.type !== "stream" && (
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
                    <Input
                      type="text"
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value)}
                      onKeyDown={handleAddDomain}
                      placeholder="Type domain and press Enter"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Press Enter to add each domain
                    </p>
                  </div>
                )}

                {/* Stream: Incoming Port + Protocol */}
                {formData.type === "stream" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="mb-1">Incoming Port</Label>
                      <Input
                        type="number"
                        value={formData.incomingPort ?? ""}
                        onChange={(e) => update({ incomingPort: e.target.value ? Number(e.target.value) : null })}
                        min={1}
                        max={65535}
                        placeholder="8080"
                      />
                    </div>
                    <div>
                      <Label className="mb-1">Protocol</Label>
                      <select
                        value={formData.protocol}
                        onChange={(e) => update({ protocol: e.target.value })}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Static: Directory + Cache */}
                {formData.type === "static" && (
                  <div className="space-y-3">
                    <div>
                      <Label className="mb-1">Static Directory Path</Label>
                      <Input
                        type="text"
                        value={formData.staticDir}
                        onChange={(e) => update({ staticDir: e.target.value })}
                        placeholder="/var/www/html"
                      />
                    </div>
                    <div>
                      <Label className="mb-1">Cache Expires</Label>
                      <Input
                        type="text"
                        value={formData.cacheExpires}
                        onChange={(e) => update({ cacheExpires: e.target.value })}
                        placeholder="30d, 1h, 3600s"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Duration format: 30d, 12h, 45m, 120s
                      </p>
                    </div>
                  </div>
                )}

                {/* Redirect: Forward settings */}
                {formData.type === "redirect" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-1">Scheme</Label>
                        <select
                          value={formData.forwardScheme}
                          onChange={(e) => update({ forwardScheme: e.target.value })}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <option value="http">http</option>
                          <option value="https">https</option>
                        </select>
                      </div>
                      <div>
                        <Label className="mb-1">Status Code</Label>
                        <select
                          value={formData.statusCode}
                          onChange={(e) => update({ statusCode: Number(e.target.value) })}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <option value="301">301 (Permanent)</option>
                          <option value="302">302 (Temporary)</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <Label className="mb-1">Forward Domain</Label>
                      <Input
                        type="text"
                        value={formData.forwardDomain}
                        onChange={(e) => update({ forwardDomain: e.target.value })}
                        placeholder="example.com"
                      />
                    </div>
                    <div>
                      <Label className="mb-1">Forward Path</Label>
                      <Input
                        type="text"
                        value={formData.forwardPath}
                        onChange={(e) => update({ forwardPath: e.target.value })}
                        placeholder="/"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="preservePath"
                        checked={formData.preservePath}
                        onCheckedChange={(checked) => update({ preservePath: checked === true })}
                      />
                      <Label htmlFor="preservePath" className="font-normal">
                        Preserve Path
                      </Label>
                    </div>
                  </div>
                )}

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

            {/* Upstreams Tab */}
            {showUpstreams && (
              <TabsContent value="upstreams" className="mt-0">
                <UpstreamsTab
                  upstreams={formData.upstreams}
                  setUpstreams={(upstreams) => update({ upstreams })}
                  balanceMethod={formData.balanceMethod}
                  setBalanceMethod={(balanceMethod) => update({ balanceMethod })}
                />
              </TabsContent>
            )}

            {/* Locations Tab */}
            {showLocations && (
              <TabsContent value="locations" className="mt-0">
                <LocationsTab
                  locations={formData.locations}
                  setLocations={(locations) => update({ locations })}
                />
              </TabsContent>
            )}

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
