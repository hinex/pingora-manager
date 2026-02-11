interface SslTabProps {
  sslType: string;
  setSslType: (type: string) => void;
  sslCertPath: string;
  setSslCertPath: (path: string) => void;
  sslKeyPath: string;
  setSslKeyPath: (path: string) => void;
  sslForceHttps: boolean;
  setSslForceHttps: (force: boolean) => void;
  http2: boolean;
  setHttp2: (http2: boolean) => void;
  hsts: boolean;
  setHsts: (hsts: boolean) => void;
}

export function SslTab({
  sslType,
  setSslType,
  sslCertPath,
  setSslCertPath,
  sslKeyPath,
  setSslKeyPath,
  sslForceHttps,
  setSslForceHttps,
  http2,
  setHttp2,
  hsts,
  setHsts,
}: SslTabProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          SSL Type
        </label>
        <div className="space-y-2">
          <label className="flex items-center">
            <input
              type="radio"
              value="none"
              checked={sslType === "none"}
              onChange={(e) => setSslType(e.target.value)}
              className="mr-2"
            />
            <span className="text-sm">None</span>
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              value="letsencrypt"
              checked={sslType === "letsencrypt"}
              onChange={(e) => setSslType(e.target.value)}
              className="mr-2"
            />
            <span className="text-sm">Let's Encrypt (automatic)</span>
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              value="custom"
              checked={sslType === "custom"}
              onChange={(e) => setSslType(e.target.value)}
              className="mr-2"
            />
            <span className="text-sm">Custom Certificate</span>
          </label>
        </div>
      </div>

      {sslType === "custom" && (
        <div className="space-y-3 pl-6 border-l-2 border-blue-200">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Certificate Path
            </label>
            <input
              type="text"
              value={sslCertPath}
              onChange={(e) => setSslCertPath(e.target.value)}
              placeholder="/etc/ssl/certs/example.com.crt"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Private Key Path
            </label>
            <input
              type="text"
              value={sslKeyPath}
              onChange={(e) => setSslKeyPath(e.target.value)}
              placeholder="/etc/ssl/private/example.com.key"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
        </div>
      )}

      <div className="border-t pt-4 space-y-3">
        <div className="flex items-center">
          <label className="flex items-center cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={sslForceHttps}
                onChange={(e) => setSslForceHttps(e.target.checked)}
                className="sr-only"
              />
              <div
                className={`block w-14 h-8 rounded-full ${
                  sslForceHttps ? "bg-blue-600" : "bg-gray-300"
                }`}
              ></div>
              <div
                className={`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition ${
                  sslForceHttps ? "transform translate-x-6" : ""
                }`}
              ></div>
            </div>
            <span className="ml-3 text-sm font-medium text-gray-700">
              Force HTTPS (redirect HTTP to HTTPS)
            </span>
          </label>
        </div>

        <div className="flex items-center">
          <label className="flex items-center cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={http2}
                onChange={(e) => setHttp2(e.target.checked)}
                className="sr-only"
              />
              <div
                className={`block w-14 h-8 rounded-full ${
                  http2 ? "bg-blue-600" : "bg-gray-300"
                }`}
              ></div>
              <div
                className={`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition ${
                  http2 ? "transform translate-x-6" : ""
                }`}
              ></div>
            </div>
            <span className="ml-3 text-sm font-medium text-gray-700">
              Enable HTTP/2
            </span>
          </label>
        </div>

        <div className="flex items-center">
          <label className="flex items-center cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={hsts}
                onChange={(e) => setHsts(e.target.checked)}
                className="sr-only"
              />
              <div
                className={`block w-14 h-8 rounded-full ${
                  hsts ? "bg-blue-600" : "bg-gray-300"
                }`}
              ></div>
              <div
                className={`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition ${
                  hsts ? "transform translate-x-6" : ""
                }`}
              ></div>
            </div>
            <span className="ml-3 text-sm font-medium text-gray-700">
              Enable HSTS (HTTP Strict Transport Security)
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
