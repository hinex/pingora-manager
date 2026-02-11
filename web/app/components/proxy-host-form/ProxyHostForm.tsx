import { useState } from "react";
import { Form } from "react-router";
import { GeneralTab } from "./GeneralTab";
import { UpstreamsTab } from "./UpstreamsTab";
import { LocationsTab } from "./LocationsTab";
import { SslTab } from "./SslTab";
import { AdvancedTab } from "./AdvancedTab";

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
  const [activeTab, setActiveTab] = useState<
    "general" | "upstreams" | "locations" | "ssl" | "advanced"
  >("general");

  const [formData, setFormData] = useState<ProxyHostFormData>({
    ...defaultFormData,
    ...initialData,
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // Validation
    if (formData.domains.length === 0) {
      e.preventDefault();
      alert("Please add at least one domain");
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
          alert("Please configure at least one default upstream, or ensure all proxy locations have upstreams");
          setActiveTab("upstreams");
          return;
        }
      } else if (formData.locations.length === 0) {
        e.preventDefault();
        alert("Please configure at least one upstream");
        setActiveTab("upstreams");
        return;
      }
    }

    if (formData.sslType === "custom") {
      if (!formData.sslCertPath || !formData.sslKeyPath) {
        e.preventDefault();
        alert("Please provide both certificate and key paths for custom SSL");
        setActiveTab("ssl");
        return;
      }
    }
  };

  const tabs = [
    { id: "general" as const, label: "General" },
    { id: "upstreams" as const, label: "Upstreams" },
    { id: "locations" as const, label: "Locations" },
    { id: "ssl" as const, label: "SSL" },
    { id: "advanced" as const, label: "Advanced" },
  ];

  return (
    <Form method="post" onSubmit={handleSubmit}>
      <input type="hidden" name="formData" value={JSON.stringify(formData)} />

      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  activeTab === tab.id
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === "general" && (
            <GeneralTab
              domains={formData.domains}
              setDomains={(domains) => setFormData({ ...formData, domains })}
              groupId={formData.groupId}
              setGroupId={(groupId) => setFormData({ ...formData, groupId })}
              enabled={formData.enabled}
              setEnabled={(enabled) => setFormData({ ...formData, enabled })}
              groups={groups}
            />
          )}

          {activeTab === "upstreams" && (
            <UpstreamsTab
              upstreams={formData.upstreams}
              setUpstreams={(upstreams) => setFormData({ ...formData, upstreams })}
              balanceMethod={formData.balanceMethod}
              setBalanceMethod={(balanceMethod) =>
                setFormData({ ...formData, balanceMethod })
              }
            />
          )}

          {activeTab === "locations" && (
            <LocationsTab
              locations={formData.locations}
              setLocations={(locations) => setFormData({ ...formData, locations })}
            />
          )}

          {activeTab === "ssl" && (
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
          )}

          {activeTab === "advanced" && (
            <AdvancedTab
              webhookUrl={formData.webhookUrl}
              setWebhookUrl={(webhookUrl) => setFormData({ ...formData, webhookUrl })}
              advancedYaml={formData.advancedYaml}
              setAdvancedYaml={(advancedYaml) =>
                setFormData({ ...formData, advancedYaml })
              }
            />
          )}
        </div>

        <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </Form>
  );
}
