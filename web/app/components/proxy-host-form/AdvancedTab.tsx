import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";

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
