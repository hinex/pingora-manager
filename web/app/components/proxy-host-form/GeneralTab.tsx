import { useState } from "react";

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
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Domains
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {domains.map((domain, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm"
            >
              {domain}
              <button
                type="button"
                onClick={() => removeDomain(index)}
                className="text-blue-600 hover:text-blue-800"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          value={domainInput}
          onChange={(e) => setDomainInput(e.target.value)}
          onKeyDown={handleAddDomain}
          placeholder="Type domain and press Enter"
          className="w-full border border-gray-300 rounded px-3 py-2"
        />
        <p className="text-xs text-gray-500 mt-1">
          Press Enter to add each domain
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Group
        </label>
        <select
          value={groupId ?? ""}
          onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}
          className="w-full border border-gray-300 rounded px-3 py-2"
        >
          <option value="">No Group</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center">
        <label className="flex items-center cursor-pointer">
          <div className="relative">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="sr-only"
            />
            <div
              className={`block w-14 h-8 rounded-full ${
                enabled ? "bg-blue-600" : "bg-gray-300"
              }`}
            ></div>
            <div
              className={`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition ${
                enabled ? "transform translate-x-6" : ""
              }`}
            ></div>
          </div>
          <span className="ml-3 text-sm font-medium text-gray-700">
            Enabled
          </span>
        </label>
      </div>
    </div>
  );
}
