import { describe, it, expect, vi } from "vitest";

// Mock the db module so importing generate.ts doesn't open a real SQLite database
vi.mock("~/lib/db/connection", () => ({ db: {} }));
vi.mock("~/lib/db/schema", () => ({}));

import {
  buildHostConfig,
  buildGlobalConfig,
} from "./generate";

describe("buildHostConfig", () => {
  it("maps a host with proxy locations", () => {
    const host = {
      id: 1,
      groupId: 5,
      domains: ["example.com", "www.example.com"],
      sslType: "letsencrypt",
      sslForceHttps: true,
      sslCertPath: "/etc/letsencrypt/live/example.com/fullchain.pem",
      sslKeyPath: "/etc/letsencrypt/live/example.com/privkey.pem",
      hsts: true,
      http2: true,
      locations: [
        {
          path: "/",
          matchType: "prefix",
          type: "proxy",
          upstreams: [{ server: "10.0.0.1", port: 8080, weight: 1 }],
          balanceMethod: "round_robin",
          staticDir: "",
          cacheExpires: "",
          forwardScheme: "https",
          forwardDomain: "",
          forwardPath: "/",
          preservePath: true,
          statusCode: 301,
          headers: { "X-Forwarded-For": "$remote_addr" },
          accessListId: 3,
        },
      ],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;

    const cfg = buildHostConfig(host);

    expect(cfg.domains).toEqual(["example.com", "www.example.com"]);
    expect(cfg.group_id).toBe(5);
    expect(cfg.ssl).toEqual({
      type: "letsencrypt",
      force_https: true,
      cert_path: "/etc/letsencrypt/live/example.com/fullchain.pem",
      key_path: "/etc/letsencrypt/live/example.com/privkey.pem",
    });
    expect(cfg.hsts).toBe(true);
    expect(cfg.http2).toBe(true);
    expect(cfg.locations).toHaveLength(1);
    expect(cfg.locations[0]).toEqual({
      path: "/",
      matchType: "prefix",
      type: "proxy",
      upstreams: [{ server: "10.0.0.1", port: 8080, weight: 1 }],
      balanceMethod: "round_robin",
      staticDir: "",
      cacheExpires: "",
      forwardScheme: "https",
      forwardDomain: "",
      forwardPath: "/",
      preservePath: true,
      statusCode: 301,
      headers: { "X-Forwarded-For": "$remote_addr" },
      access_list_id: 3,
    });
    expect(cfg.stream_ports).toEqual([]);
    expect(cfg.advanced_yaml).toBeNull();
    expect(cfg.enabled).toBe(true);
  });

  it("maps a host with mixed locations (proxy + static + redirect)", () => {
    const host = {
      id: 2,
      groupId: null,
      domains: ["multi.example.com"],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: true,
      locations: [
        {
          path: "/api",
          matchType: "prefix",
          type: "proxy",
          upstreams: [{ server: "10.0.0.2", port: 3000, weight: 1 }],
          balanceMethod: "least_conn",
          staticDir: "",
          cacheExpires: "",
          forwardScheme: "https",
          forwardDomain: "",
          forwardPath: "/",
          preservePath: true,
          statusCode: 301,
          headers: {},
          accessListId: null,
        },
        {
          path: "/assets",
          matchType: "prefix",
          type: "static",
          upstreams: [],
          balanceMethod: "round_robin",
          staticDir: "/var/www/static",
          cacheExpires: "30d",
          forwardScheme: "https",
          forwardDomain: "",
          forwardPath: "/",
          preservePath: true,
          statusCode: 301,
          headers: {},
          accessListId: null,
        },
        {
          path: "/old",
          matchType: "exact",
          type: "redirect",
          upstreams: [],
          balanceMethod: "round_robin",
          staticDir: "",
          cacheExpires: "",
          forwardScheme: "https",
          forwardDomain: "new.example.com",
          forwardPath: "/new",
          preservePath: false,
          statusCode: 302,
          headers: {},
          accessListId: null,
        },
      ],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;

    const cfg = buildHostConfig(host);

    expect(cfg.locations).toHaveLength(3);

    // Proxy location
    expect(cfg.locations[0].type).toBe("proxy");
    expect(cfg.locations[0].path).toBe("/api");
    expect(cfg.locations[0].upstreams).toHaveLength(1);
    expect(cfg.locations[0].balanceMethod).toBe("least_conn");

    // Static location
    expect(cfg.locations[1].type).toBe("static");
    expect(cfg.locations[1].path).toBe("/assets");
    expect(cfg.locations[1].staticDir).toBe("/var/www/static");
    expect(cfg.locations[1].cacheExpires).toBe("30d");

    // Redirect location
    expect(cfg.locations[2].type).toBe("redirect");
    expect(cfg.locations[2].path).toBe("/old");
    expect(cfg.locations[2].matchType).toBe("exact");
    expect(cfg.locations[2].forwardScheme).toBe("https");
    expect(cfg.locations[2].forwardDomain).toBe("new.example.com");
    expect(cfg.locations[2].forwardPath).toBe("/new");
    expect(cfg.locations[2].preservePath).toBe(false);
    expect(cfg.locations[2].statusCode).toBe(302);
  });

  it("maps a host with stream ports", () => {
    const host = {
      id: 3,
      groupId: null,
      domains: ["stream.example.com"],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [],
      streamPorts: [
        {
          port: 3306,
          protocol: "tcp",
          upstreams: [{ server: "db.internal", port: 3306, weight: 1 }],
          balanceMethod: "least_conn",
        },
      ],
      advancedYaml: null,
      enabled: true,
    } as any;

    const cfg = buildHostConfig(host);

    expect(cfg.locations).toEqual([]);
    expect(cfg.stream_ports).toHaveLength(1);
    expect(cfg.stream_ports[0]).toEqual({
      port: 3306,
      protocol: "tcp",
      upstreams: [{ server: "db.internal", port: 3306, weight: 1 }],
      balance_method: "least_conn",
    });
  });

  it("applies defaults for missing optional location fields", () => {
    const host = {
      id: 4,
      groupId: null,
      domains: ["minimal.example.com"],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [
        {
          path: "/",
          matchType: "prefix",
          type: "proxy",
          // All optional fields omitted
        },
      ],
      streamPorts: null,
      advancedYaml: null,
      enabled: true,
    } as any;

    const cfg = buildHostConfig(host);

    expect(cfg.locations[0].upstreams).toEqual([]);
    expect(cfg.locations[0].balanceMethod).toBe("round_robin");
    expect(cfg.locations[0].staticDir).toBe("");
    expect(cfg.locations[0].cacheExpires).toBe("");
    expect(cfg.locations[0].forwardScheme).toBe("https");
    expect(cfg.locations[0].forwardDomain).toBe("");
    expect(cfg.locations[0].forwardPath).toBe("/");
    expect(cfg.locations[0].preservePath).toBe(true);
    expect(cfg.locations[0].statusCode).toBe(301);
    expect(cfg.locations[0].headers).toEqual({});
    expect(cfg.locations[0].access_list_id).toBeNull();
    expect(cfg.stream_ports).toEqual([]);
  });
});

describe("buildGlobalConfig", () => {
  it("returns default values with empty settings", () => {
    const cfg = buildGlobalConfig({});
    expect(cfg.listen).toEqual({ http: 80, https: 443, admin: 81 });
    expect(cfg.admin_upstream).toBe("127.0.0.1:3001");
    expect(cfg.global_webhook_url).toBe("");
  });

  it("uses global_webhook_url from settings when provided", () => {
    const cfg = buildGlobalConfig({
      global_webhook_url: "https://hooks.example.com/notify",
    });
    expect(cfg.global_webhook_url).toBe("https://hooks.example.com/notify");
  });
});

// --- Security: malicious / edge-case inputs ---

describe("buildHostConfig edge cases", () => {
  it("handles XSS in domain names", () => {
    const host = {
      id: 1,
      groupId: null,
      domains: ["<script>alert(1)</script>.com"],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    // Should pass through as-is (YAML serialization handles escaping)
    expect(cfg.domains[0]).toBe("<script>alert(1)</script>.com");
  });

  it("handles path traversal in SSL cert path", () => {
    const host = {
      id: 1,
      groupId: null,
      domains: ["test.com"],
      sslType: "custom",
      sslForceHttps: true,
      sslCertPath: "../../../etc/shadow",
      sslKeyPath: "../../../etc/shadow",
      hsts: false,
      http2: false,
      locations: [],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    // Builder is pure -- it maps data, doesn't validate paths
    // Validation must happen at the API/form level
    expect(cfg.ssl.cert_path).toBe("../../../etc/shadow");
    expect(cfg.ssl.key_path).toBe("../../../etc/shadow");
  });

  it("handles empty domains array", () => {
    const host = {
      id: 1,
      groupId: null,
      domains: [],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [],
      streamPorts: [],
      advancedYaml: null,
      enabled: false,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.domains).toEqual([]);
    expect(cfg.enabled).toBe(false);
  });

  it("handles YAML injection in advancedYaml", () => {
    const host = {
      id: 1,
      groupId: null,
      domains: ["test.com"],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [],
      streamPorts: [],
      advancedYaml: "malicious:\n  - command: rm -rf /",
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    // Builder preserves the raw YAML string -- Rust parser must sanitize
    expect(cfg.advanced_yaml).toContain("rm -rf /");
  });

  it("handles open redirect attempt in location forward_domain", () => {
    const host = {
      id: 1,
      groupId: null,
      domains: ["safe.com"],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [
        {
          path: "/",
          matchType: "prefix",
          type: "redirect",
          forwardScheme: "https",
          forwardDomain: "evil.com",
          forwardPath: "/phishing",
          preservePath: true,
          statusCode: 302,
        },
      ],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.locations[0].forwardDomain).toBe("evil.com");
    expect(cfg.locations[0].forwardPath).toBe("/phishing");
  });

  it("handles javascript: scheme in location forwardScheme", () => {
    const host = {
      id: 1,
      groupId: null,
      domains: ["test.com"],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [
        {
          path: "/",
          matchType: "prefix",
          type: "redirect",
          forwardScheme: "javascript:",
          forwardDomain: "alert(1)",
          forwardPath: "",
          preservePath: false,
          statusCode: 301,
        },
      ],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    // Builder maps as-is -- validation is API layer responsibility
    expect(cfg.locations[0].forwardScheme).toBe("javascript:");
  });

  it("handles invalid status codes in location", () => {
    const host = {
      id: 1,
      groupId: null,
      domains: ["test.com"],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [
        {
          path: "/",
          matchType: "prefix",
          type: "redirect",
          forwardScheme: "https",
          forwardDomain: "new.com",
          forwardPath: "/",
          preservePath: true,
          statusCode: 999,
        },
      ],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.locations[0].statusCode).toBe(999);
  });

  it("handles stream port 0", () => {
    const host = {
      id: 1,
      groupId: null,
      domains: [],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [],
      streamPorts: [
        { port: 0, protocol: "tcp", upstreams: [], balanceMethod: "round_robin" },
      ],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.stream_ports[0].port).toBe(0);
  });

  it("handles privileged stream port", () => {
    const host = {
      id: 1,
      groupId: null,
      domains: [],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [],
      streamPorts: [
        {
          port: 22,
          protocol: "tcp",
          upstreams: [{ server: "attacker.com", port: 22, weight: 1 }],
          balanceMethod: "round_robin",
        },
      ],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.stream_ports[0].port).toBe(22);
    expect(cfg.stream_ports[0].upstreams[0].server).toBe("attacker.com");
  });

  it("handles unknown stream protocol", () => {
    const host = {
      id: 1,
      groupId: null,
      domains: [],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: false,
      locations: [],
      streamPorts: [
        { port: 8080, protocol: "sctp", upstreams: [], balanceMethod: "round_robin" },
      ],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.stream_ports[0].protocol).toBe("sctp");
  });
});

describe("buildGlobalConfig edge cases", () => {
  it("ignores unknown settings keys", () => {
    const cfg = buildGlobalConfig({
      unknown_key: "value",
      global_webhook_url: "https://example.com",
    });
    expect(cfg.global_webhook_url).toBe("https://example.com");
    // Unknown keys are not present in output
    expect((cfg as any).unknown_key).toBeUndefined();
  });

  it("handles XSS in webhook URL", () => {
    const cfg = buildGlobalConfig({
      global_webhook_url: "javascript:alert(document.cookie)",
    });
    expect(cfg.global_webhook_url).toBe("javascript:alert(document.cookie)");
  });

  it("handles SSRF target in webhook URL", () => {
    const cfg = buildGlobalConfig({
      global_webhook_url: "http://169.254.169.254/latest/meta-data/",
    });
    // Builder just maps; SSRF protection must be at the HTTP call layer
    expect(cfg.global_webhook_url).toBe("http://169.254.169.254/latest/meta-data/");
  });
});
