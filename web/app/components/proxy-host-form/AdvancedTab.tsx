interface AdvancedTabProps {
  webhookUrl: string;
  setWebhookUrl: (url: string) => void;
  advancedYaml: string;
  setAdvancedYaml: (yaml: string) => void;
}

export function AdvancedTab({
  webhookUrl,
  setWebhookUrl,
  advancedYaml,
  setAdvancedYaml,
}: AdvancedTabProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Webhook URL
        </label>
        <input
          type="text"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://example.com/webhook"
          className="w-full border border-gray-300 rounded px-3 py-2"
        />
        <p className="text-xs text-gray-500 mt-1">
          Optional webhook to notify when configuration changes
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Advanced YAML Configuration
        </label>
        <textarea
          value={advancedYaml}
          onChange={(e) => setAdvancedYaml(e.target.value)}
          rows={12}
          placeholder="# Custom Pingora directives in YAML format"
          className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
        />
        <p className="text-xs text-gray-500 mt-1">
          Optional advanced configuration in YAML format for custom Pingora directives
        </p>
      </div>
    </div>
  );
}
