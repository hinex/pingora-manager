import { useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Switch } from "~/components/ui/switch";
import { X } from "lucide-react";

interface GeneralTabProps {
  domains: string[];
  setDomains: (domains: string[]) => void;
  groupId: number | null;
  setGroupId: (groupId: number | null) => void;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  groups: Array<{ id: number; name: string }>;
}

export function GeneralTab({
  domains,
  setDomains,
  groupId,
  setGroupId,
  enabled,
  setEnabled,
  groups,
}: GeneralTabProps) {
  const [domainInput, setDomainInput] = useState("");

  const handleAddDomain = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const value = domainInput.trim();
      if (value && !domains.includes(value)) {
        setDomains([...domains, value]);
        setDomainInput("");
      }
    }
  };

  const removeDomain = (index: number) => {
    setDomains(domains.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="mb-1">Domains</Label>
        <div className="flex flex-wrap gap-2 mb-2">
          {domains.map((domain, index) => (
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

      <div>
        <Label className="mb-1">Group</Label>
        <select
          value={groupId ?? ""}
          onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}
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

      <div className="flex items-center gap-3">
        <Switch checked={enabled} onCheckedChange={setEnabled} />
        <Label>Enabled</Label>
      </div>
    </div>
  );
}
