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
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Load Balancing Method
        </label>
        <select
          value={balanceMethod}
          onChange={(e) => setBalanceMethod(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2"
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
          <label className="block text-sm font-medium text-gray-700">
            Upstream Servers
          </label>
          <button
            type="button"
            onClick={addUpstream}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            + Add Upstream
          </button>
        </div>

        {upstreams.length === 0 ? (
          <div className="border border-gray-300 rounded p-4 text-center text-gray-500 text-sm">
            No upstreams configured. Click "Add Upstream" to add one.
          </div>
        ) : (
          <div className="space-y-3">
            {upstreams.map((upstream, index) => (
              <div
                key={index}
                className="border border-gray-300 rounded p-4 space-y-3"
              >
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">
                    Upstream {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeUpstream(index)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      Server
                    </label>
                    <input
                      type="text"
                      value={upstream.server}
                      onChange={(e) =>
                        updateUpstream(index, "server", e.target.value)
                      }
                      placeholder="192.168.1.10"
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      Port
                    </label>
                    <input
                      type="number"
                      value={upstream.port}
                      onChange={(e) =>
                        updateUpstream(index, "port", Number(e.target.value))
                      }
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      Weight
                    </label>
                    <input
                      type="number"
                      value={upstream.weight}
                      onChange={(e) =>
                        updateUpstream(index, "weight", Number(e.target.value))
                      }
                      min="1"
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
