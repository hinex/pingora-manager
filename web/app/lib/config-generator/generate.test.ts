import { describe, it, expect, vi } from "vitest";

// Mock the db module so importing generate.ts doesn't open a real SQLite database
vi.mock("~/lib/db/connection", () => ({ db: {} }));
vi.mock("~/lib/db/schema", () => ({}));

import {
  buildProxyHostConfig,
  buildStaticHostConfig,
  buildRedirectConfig,
  buildStreamConfig,
  buildGlobalConfig,
} from "./generate";

describe("buildProxyHostConfig", () => {
  const host = {
    id: 1,
    groupId: 5,
    domains: ["example.com", "www.example.com"],
    sslType: "letsencrypt",
    sslForceHttps: true,
    sslCertPath: "/etc/letsencrypt/live/example.com/fullchain.pem",
    sslKeyPath: "/etc/letsencrypt/live/example.com/privkey.pem",
    upstreams: [{ server: "10.0.0.1", port: 8080, weight: 1 }],
    balanceMethod: "round_robin",
    locations: [{ path: "/", matchType: "prefix", type: "proxy" }],
    hsts: true,
    http2: true,
    advancedYaml: null,
    enabled: true,
  } as any;

  it("maps domains array and camelCase fields to snake_case", () => {
    const cfg = buildProxyHostConfig(host);
    expect(cfg.domains).toEqual(["example.com", "www.example.com"]);
    expect(cfg.group_id).toBe(5);
    expect(cfg.balance_method).toBe("round_robin");
    expect(cfg.advanced_yaml).toBeNull();
  });

  it("maps SSL fields into nested object", () => {
    const cfg = buildProxyHostConfig(host);
    expect(cfg.ssl).toEqual({
      type: "letsencrypt",
      force_https: true,
      cert_path: "/etc/letsencrypt/live/example.com/fullchain.pem",
      key_path: "/etc/letsencrypt/live/example.com/privkey.pem",
    });
  });
});

describe("buildStaticHostConfig", () => {
  const host = {
    id: 2,
    groupId: null,
    domains: ["static.example.com"],
    sslType: "none",
    sslForceHttps: false,
    sslCertPath: null,
    sslKeyPath: null,
    staticDir: "/var/www/html",
    cacheExpires: "30d",
    hsts: false,
    http2: true,
    advancedYaml: null,
    enabled: true,
  } as any;

  it("creates a single static location from staticDir and cacheExpires", () => {
    const cfg = buildStaticHostConfig(host);
    expect(cfg.locations).toHaveLength(1);
    expect(cfg.locations[0]).toEqual({
      path: "/",
      matchType: "prefix",
      type: "static",
      staticDir: "/var/www/html",
      cacheExpires: "30d",
    });
  });

  it("sets upstreams to empty array and balance_method to round_robin", () => {
    const cfg = buildStaticHostConfig(host);
    expect(cfg.upstreams).toEqual([]);
    expect(cfg.balance_method).toBe("round_robin");
  });

  it("maps SSL and common fields correctly", () => {
    const cfg = buildStaticHostConfig(host);
    expect(cfg.domains).toEqual(["static.example.com"]);
    expect(cfg.ssl.type).toBe("none");
    expect(cfg.hsts).toBe(false);
    expect(cfg.http2).toBe(true);
    expect(cfg.enabled).toBe(true);
  });
});

describe("buildRedirectConfig", () => {
  const redirect = {
    id: 10,
    domains: ["old.com"],
    forwardScheme: "https",
    forwardDomain: "new.com",
    forwardPath: "/landing",
    preservePath: false,
    statusCode: 302,
    sslType: "none",
    enabled: true,
  } as any;

  it("maps camelCase to snake_case", () => {
    const cfg = buildRedirectConfig(redirect);
    expect(cfg.forward_scheme).toBe("https");
    expect(cfg.forward_domain).toBe("new.com");
    expect(cfg.forward_path).toBe("/landing");
    expect(cfg.preserve_path).toBe(false);
    expect(cfg.status_code).toBe(302);
    expect(cfg.ssl_type).toBe("none");
  });
});

describe("buildStreamConfig", () => {
  const stream = {
    id: 3,
    incomingPort: 3306,
    protocol: "tcp",
    upstreams: [{ server: "db.internal", port: 3306, weight: 1 }],
    balanceMethod: "least_conn",
    enabled: true,
  } as any;

  it("maps camelCase to snake_case", () => {
    const cfg = buildStreamConfig(stream);
    expect(cfg.incoming_port).toBe(3306);
    expect(cfg.balance_method).toBe("least_conn");
    expect(cfg.protocol).toBe("tcp");
    expect(cfg.upstreams).toHaveLength(1);
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

// ─── Security: malicious / edge-case inputs ──────────────

describe("buildProxyHostConfig edge cases", () => {
  it("handles XSS in domain names", () => {
    const host = {
      id: 1,
      groupId: null,
      domains: ["<script>alert(1)</script>.com"],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      upstreams: [],
      balanceMethod: "round_robin",
      locations: [],
      hsts: false,
      http2: false,
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildProxyHostConfig(host);
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
      upstreams: [],
      balanceMethod: "round_robin",
      locations: [],
      hsts: false,
      http2: false,
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildProxyHostConfig(host);
    // Builder is pure — it maps data, doesn't validate paths
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
      upstreams: [],
      balanceMethod: "round_robin",
      locations: [],
      hsts: false,
      http2: false,
      advancedYaml: null,
      enabled: false,
    } as any;
    const cfg = buildProxyHostConfig(host);
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
      upstreams: [],
      balanceMethod: "round_robin",
      locations: [],
      hsts: false,
      http2: false,
      advancedYaml: "malicious:\n  - command: rm -rf /",
      enabled: true,
    } as any;
    const cfg = buildProxyHostConfig(host);
    // Builder preserves the raw YAML string — Rust parser must sanitize
    expect(cfg.advanced_yaml).toContain("rm -rf /");
  });
});

describe("buildRedirectConfig edge cases", () => {
  it("handles open redirect attempt in forward_domain", () => {
    const redirect = {
      id: 1,
      domains: ["safe.com"],
      forwardScheme: "https",
      forwardDomain: "evil.com",
      forwardPath: "/phishing",
      preservePath: true,
      statusCode: 302,
      sslType: "none",
      enabled: true,
    } as any;
    const cfg = buildRedirectConfig(redirect);
    expect(cfg.forward_domain).toBe("evil.com");
    expect(cfg.forward_path).toBe("/phishing");
  });

  it("handles javascript: scheme in forward_scheme", () => {
    const redirect = {
      id: 1,
      domains: ["test.com"],
      forwardScheme: "javascript:",
      forwardDomain: "alert(1)",
      forwardPath: "",
      preservePath: false,
      statusCode: 301,
      sslType: "none",
      enabled: true,
    } as any;
    const cfg = buildRedirectConfig(redirect);
    // Builder maps as-is — validation is API layer responsibility
    expect(cfg.forward_scheme).toBe("javascript:");
  });

  it("handles invalid status codes", () => {
    const redirect = {
      id: 1,
      domains: ["test.com"],
      forwardScheme: "https",
      forwardDomain: "new.com",
      forwardPath: "/",
      preservePath: true,
      statusCode: 999,
      sslType: "none",
      enabled: true,
    } as any;
    const cfg = buildRedirectConfig(redirect);
    expect(cfg.status_code).toBe(999);
  });
});

describe("buildStreamConfig edge cases", () => {
  it("handles port 0", () => {
    const stream = {
      id: 1,
      incomingPort: 0,
      protocol: "tcp",
      upstreams: [],
      balanceMethod: "round_robin",
      enabled: true,
    } as any;
    const cfg = buildStreamConfig(stream);
    expect(cfg.incoming_port).toBe(0);
  });

  it("handles privileged port", () => {
    const stream = {
      id: 1,
      incomingPort: 22,
      protocol: "tcp",
      upstreams: [{ server: "attacker.com", port: 22, weight: 1 }],
      balanceMethod: "round_robin",
      enabled: true,
    } as any;
    const cfg = buildStreamConfig(stream);
    expect(cfg.incoming_port).toBe(22);
    expect(cfg.upstreams[0].server).toBe("attacker.com");
  });

  it("handles unknown protocol", () => {
    const stream = {
      id: 1,
      incomingPort: 8080,
      protocol: "sctp",
      upstreams: [],
      balanceMethod: "round_robin",
      enabled: true,
    } as any;
    const cfg = buildStreamConfig(stream);
    expect(cfg.protocol).toBe("sctp");
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
