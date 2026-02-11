import { useState, useEffect } from "react";
import { Form, useActionData } from "react-router";
import { toast } from "sonner";
import { GeneralTab } from "./GeneralTab";
import { UpstreamsTab } from "./UpstreamsTab";
import { LocationsTab } from "./LocationsTab";
import { SslTab } from "./SslTab";
import { AdvancedTab } from "./AdvancedTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";

export interface ProxyHostFormData {
  domains: string[];
  groupId: number | null;
  enabled: boolean;
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
  sslType: string;
  sslCertPath: string;
  sslKeyPath: string;
  sslForceHttps: boolean;
  hsts: boolean;
  http2: boolean;
  webhookUrl: string;
  advancedYaml: string;
}

interface ProxyHostFormProps {
  initialData?: Partial<ProxyHostFormData>;
  groups: Array<{ id: number; name: string }>;
  submitLabel: string;
}

const defaultFormData: ProxyHostFormData = {
  domains: [],
  groupId: null,
  enabled: true,
  upstreams: [],
  balanceMethod: "round_robin",
  locations: [],
  sslType: "none",
  sslCertPath: "",
  sslKeyPath: "",
  sslForceHttps: false,
  hsts: true,
  http2: true,
  webhookUrl: "",
  advancedYaml: "",
};

export function ProxyHostForm({
  initialData,
  groups,
  submitLabel,
}: ProxyHostFormProps) {
  const actionData = useActionData<{ error?: string }>();

  useEffect(() => {
    if (actionData?.error) {
      toast.error(actionData.error);
    }
  }, [actionData]);

  const [activeTab, setActiveTab] = useState<
    "general" | "upstreams" | "locations" | "ssl" | "advanced"
  >("general");

  const [formData, setFormData] = useState<ProxyHostFormData>({
    ...defaultFormData,
    ...initialData,
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (formData.domains.length === 0) {
      e.preventDefault();
      toast.error("Please add at least one domain");
      setActiveTab("general");
      return;
    }

    if (formData.upstreams.length === 0) {
      const hasProxyLocations = formData.locations.some((loc) => loc.type === "proxy");
      if (hasProxyLocations) {
        const allLocationsHaveUpstreams = formData.locations
          .filter((loc) => loc.type === "proxy")
          .every((loc) => loc.upstreams && loc.upstreams.length > 0);

        if (!allLocationsHaveUpstreams) {
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

    if (formData.sslType === "custom") {
      if (!formData.sslCertPath || !formData.sslKeyPath) {
        e.preventDefault();
        toast.error("Please provide both certificate and key paths for custom SSL");
        setActiveTab("ssl");
        return;
      }
    }
  };

  return (
    <Form method="post" onSubmit={handleSubmit}>
      <input type="hidden" name="formData" value={JSON.stringify(formData)} />
      <Card>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <div className="border-b border-border px-4">
            <TabsList className="bg-transparent">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="upstreams">Upstreams</TabsTrigger>
              <TabsTrigger value="locations">Locations</TabsTrigger>
              <TabsTrigger value="ssl">SSL</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>
          </div>
          <CardContent className="p-6">
            <TabsContent value="general" className="mt-0">
              <GeneralTab
                domains={formData.domains}
                setDomains={(domains) => setFormData({ ...formData, domains })}
                groupId={formData.groupId}
                setGroupId={(groupId) => setFormData({ ...formData, groupId })}
                enabled={formData.enabled}
                setEnabled={(enabled) => setFormData({ ...formData, enabled })}
                groups={groups}
              />
            </TabsContent>

            <TabsContent value="upstreams" className="mt-0">
              <UpstreamsTab
                upstreams={formData.upstreams}
                setUpstreams={(upstreams) => setFormData({ ...formData, upstreams })}
                balanceMethod={formData.balanceMethod}
                setBalanceMethod={(balanceMethod) =>
                  setFormData({ ...formData, balanceMethod })
                }
              />
            </TabsContent>

            <TabsContent value="locations" className="mt-0">
              <LocationsTab
                locations={formData.locations}
                setLocations={(locations) => setFormData({ ...formData, locations })}
              />
            </TabsContent>

            <TabsContent value="ssl" className="mt-0">
              <SslTab
                sslType={formData.sslType}
                setSslType={(sslType) => setFormData({ ...formData, sslType })}
                sslCertPath={formData.sslCertPath}
                setSslCertPath={(sslCertPath) => setFormData({ ...formData, sslCertPath })}
                sslKeyPath={formData.sslKeyPath}
                setSslKeyPath={(sslKeyPath) => setFormData({ ...formData, sslKeyPath })}
                sslForceHttps={formData.sslForceHttps}
                setSslForceHttps={(sslForceHttps) =>
                  setFormData({ ...formData, sslForceHttps })
                }
                http2={formData.http2}
                setHttp2={(http2) => setFormData({ ...formData, http2 })}
                hsts={formData.hsts}
                setHsts={(hsts) => setFormData({ ...formData, hsts })}
              />
            </TabsContent>

            <TabsContent value="advanced" className="mt-0">
              <AdvancedTab
                webhookUrl={formData.webhookUrl}
                setWebhookUrl={(webhookUrl) => setFormData({ ...formData, webhookUrl })}
                advancedYaml={formData.advancedYaml}
                setAdvancedYaml={(advancedYaml) =>
                  setFormData({ ...formData, advancedYaml })
                }
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
