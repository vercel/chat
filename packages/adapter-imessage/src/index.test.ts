import { afterEach, describe, expect, it, vi } from "vitest";
import { createiMessageAdapter, iMessageAdapter } from "./index";

describe("iMessageAdapter", () => {
  it("should have the correct name", () => {
    const adapter = new iMessageAdapter({ local: true });
    expect(adapter.name).toBe("imessage");
  });

  it("should use default userName", () => {
    const adapter = new iMessageAdapter({ local: true });
    expect(adapter.userName).toBe("iMessage Bot");
  });

  it("should accept custom userName", () => {
    const adapter = new iMessageAdapter({
      local: true,
      userName: "Custom Bot",
    });
    expect(adapter.userName).toBe("Custom Bot");
  });

  it("should store local mode config", () => {
    const adapter = new iMessageAdapter({ local: true });
    expect(adapter.local).toBe(true);
    expect(adapter.serverUrl).toBeUndefined();
    expect(adapter.apiKey).toBeUndefined();
  });

  it("should store local mode config with optional serverUrl", () => {
    const adapter = new iMessageAdapter({
      local: true,
      serverUrl: "http://localhost:1234",
    });
    expect(adapter.local).toBe(true);
    expect(adapter.serverUrl).toBe("http://localhost:1234");
  });

  it("should store remote mode config", () => {
    const adapter = new iMessageAdapter({
      local: false,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    expect(adapter.local).toBe(false);
    expect(adapter.serverUrl).toBe("https://example.com");
    expect(adapter.apiKey).toBe("test-key");
  });
});

describe("createiMessageAdapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should default to local mode", () => {
    const adapter = createiMessageAdapter();
    expect(adapter.local).toBe(true);
  });

  it("should use remote mode when local is false", () => {
    const adapter = createiMessageAdapter({
      local: false,
      serverUrl: "https://example.com",
      apiKey: "test-key",
    });
    expect(adapter.local).toBe(false);
    expect(adapter.serverUrl).toBe("https://example.com");
    expect(adapter.apiKey).toBe("test-key");
  });

  it("should read IMESSAGE_LOCAL env var", () => {
    vi.stubEnv("IMESSAGE_LOCAL", "false");
    vi.stubEnv("IMESSAGE_SERVER_URL", "https://env.example.com");
    vi.stubEnv("IMESSAGE_API_KEY", "env-key");

    const adapter = createiMessageAdapter();
    expect(adapter.local).toBe(false);
    expect(adapter.serverUrl).toBe("https://env.example.com");
    expect(adapter.apiKey).toBe("env-key");
  });

  it("should throw when remote mode is missing serverUrl", () => {
    expect(() => createiMessageAdapter({ local: false })).toThrow(
      "serverUrl is required when local is false"
    );
  });

  it("should throw when remote mode is missing apiKey", () => {
    expect(() =>
      createiMessageAdapter({
        local: false,
        serverUrl: "https://example.com",
      })
    ).toThrow("apiKey is required when local is false");
  });

  it("should prefer config values over env vars", () => {
    vi.stubEnv("IMESSAGE_SERVER_URL", "https://env.example.com");
    vi.stubEnv("IMESSAGE_API_KEY", "env-key");

    const adapter = createiMessageAdapter({
      local: false,
      serverUrl: "https://config.example.com",
      apiKey: "config-key",
    });
    expect(adapter.serverUrl).toBe("https://config.example.com");
    expect(adapter.apiKey).toBe("config-key");
  });

  it("should read IMESSAGE_SERVER_URL and IMESSAGE_API_KEY for local mode", () => {
    vi.stubEnv("IMESSAGE_SERVER_URL", "http://localhost:5678");
    vi.stubEnv("IMESSAGE_API_KEY", "local-key");

    const adapter = createiMessageAdapter({ local: true });
    expect(adapter.local).toBe(true);
    expect(adapter.serverUrl).toBe("http://localhost:5678");
    expect(adapter.apiKey).toBe("local-key");
  });
});
