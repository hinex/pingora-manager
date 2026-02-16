import { describe, it, expect, vi } from "vitest";

// Mock the db module so importing generate.ts doesn't open a real SQLite database
vi.mock("~/lib/db/connection", () => ({ db: {} }));
vi.mock("~/lib/db/schema", () => ({}));

import { buildHostConfig, buildGlobalConfig } from "./generate";

describe("buildHostConfig (unified)", () => {
  it("maps a host with proxy locations", () => {
    const host = {
      id: 1,
      groupId: 5,
      domains: ["example.com"],
      sslType: "letsencrypt",
      sslForceHttps: true,
      sslCertPath: "/path/cert.pem",
      sslKeyPath: "/path/key.pem",
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
          headers: { "X-Custom": "value" },
          accessListId: 2,
        },
      ],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.id).toBe(1);
    expect(cfg.domains).toEqual(["example.com"]);
    expect(cfg.ssl.type).toBe("letsencrypt");
    expect(cfg.locations).toHaveLength(1);
    expect(cfg.locations[0].type).toBe("proxy");
    expect(cfg.locations[0].upstreams).toHaveLength(1);
    expect(cfg.locations[0].headers).toEqual({ "X-Custom": "value" });
    expect(cfg.locations[0].access_list_id).toBe(2);
    expect(cfg.stream_ports).toEqual([]);
  });

  it("maps a host with mixed locations (proxy + static + redirect)", () => {
    const host = {
      id: 2,
      groupId: null,
      domains: ["mysite.com"],
      sslType: "none",
      sslForceHttps: false,
      sslCertPath: null,
      sslKeyPath: null,
      hsts: false,
      http2: true,
      locations: [
        {
          path: "/",
          matchType: "prefix",
          type: "proxy",
          upstreams: [{ server: "127.0.0.1", port: 3000, weight: 1 }],
          balanceMethod: "round_robin",
          staticDir: "", cacheExpires: "",
          forwardScheme: "https", forwardDomain: "", forwardPath: "/",
          preservePath: true, statusCode: 301,
          headers: {}, accessListId: null,
        },
        {
          path: "/uploads",
          matchType: "prefix",
          type: "static",
          upstreams: [],
          balanceMethod: "round_robin",
          staticDir: "/var/uploads",
          cacheExpires: "30d",
          forwardScheme: "https", forwardDomain: "", forwardPath: "/",
          preservePath: true, statusCode: 301,
          headers: { "Cache-Control": "max-age=31536000" },
          accessListId: null,
        },
        {
          path: "/old",
          matchType: "exact",
          type: "redirect",
          upstreams: [],
          balanceMethod: "round_robin",
          staticDir: "", cacheExpires: "",
          forwardScheme: "https",
          forwardDomain: "newsite.com",
          forwardPath: "/new",
          preservePath: false,
          statusCode: 301,
          headers: {}, accessListId: null,
        },
      ],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.locations).toHaveLength(3);
    expect(cfg.locations[0].type).toBe("proxy");
    expect(cfg.locations[1].type).toBe("static");
    expect(cfg.locations[1].staticDir).toBe("/var/uploads");
    expect(cfg.locations[1].headers).toEqual({ "Cache-Control": "max-age=31536000" });
    expect(cfg.locations[2].type).toBe("redirect");
    expect(cfg.locations[2].forwardDomain).toBe("newsite.com");
  });

  it("maps a host with stream ports", () => {
    const host = {
      id: 3,
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
    expect(cfg.stream_ports).toHaveLength(1);
    expect(cfg.stream_ports[0].port).toBe(3306);
    expect(cfg.stream_ports[0].protocol).toBe("tcp");
    expect(cfg.stream_ports[0].upstreams).toHaveLength(1);
    expect(cfg.locations).toEqual([]);
  });

  it("maps SSL fields into nested object", () => {
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
      locations: [],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.ssl).toEqual({
      type: "letsencrypt",
      force_https: true,
      cert_path: "/etc/letsencrypt/live/example.com/fullchain.pem",
      key_path: "/etc/letsencrypt/live/example.com/privkey.pem",
    });
  });

  it("defaults missing location fields", () => {
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
        { path: "/", matchType: "prefix", type: "proxy" },
      ],
      streamPorts: [],
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    const loc = cfg.locations[0];
    expect(loc.upstreams).toEqual([]);
    expect(loc.balanceMethod).toBe("round_robin");
    expect(loc.staticDir).toBe("");
    expect(loc.forwardScheme).toBe("https");
    expect(loc.headers).toEqual({});
    expect(loc.access_list_id).toBeNull();
  });

  it("handles null locations and streamPorts", () => {
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
      locations: null,
      streamPorts: null,
      advancedYaml: null,
      enabled: true,
    } as any;
    const cfg = buildHostConfig(host);
    expect(cfg.locations).toEqual([]);
    expect(cfg.stream_ports).toEqual([]);
  });
});

// ─── Security: malicious / edge-case inputs ──────────────

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
    expect(cfg.ssl.cert_path).toBe("../../../etc/shadow");
    expect(cfg.ssl.key_path).toBe("../../../etc/shadow");
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
    expect(cfg.advanced_yaml).toContain("rm -rf /");
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

  it("ignores unknown settings keys", () => {
    const cfg = buildGlobalConfig({
      unknown_key: "value",
      global_webhook_url: "https://example.com",
    });
    expect(cfg.global_webhook_url).toBe("https://example.com");
    expect((cfg as any).unknown_key).toBeUndefined();
  });
});
