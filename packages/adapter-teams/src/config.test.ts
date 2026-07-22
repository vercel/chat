import { describe, expect, it, vi } from "vitest";
import { toAppOptions } from "./config";

describe("toAppOptions", () => {
  it("forwards a custom token factory to the Teams SDK", () => {
    const token = async (_scope: string | string[], _tenantId?: string) =>
      "custom-access-token";

    const options = toAppOptions({
      appId: "test-client-id",
      appTenantId: "test-tenant-id",
      token,
    });

    expect(options.token).toBe(token);
    expect(options.clientId).toBe("test-client-id");
    expect(options.tenantId).toBe("test-tenant-id");
  });

  it("omits clientSecret when a token factory is provided", () => {
    const options = toAppOptions({
      appId: "test-client-id",
      appPassword: "should-be-ignored",
      token: async () => "custom-access-token",
    });

    expect(options.clientSecret).toBeUndefined();
  });

  it("ignores TEAMS_APP_PASSWORD env var when a token factory is provided", () => {
    vi.stubEnv("TEAMS_APP_PASSWORD", "env-secret");
    try {
      const token = async () => "custom-access-token";

      const options = toAppOptions({
        appId: "test-client-id",
        token,
      });

      expect(options.clientSecret).toBeUndefined();
      expect(options.token).toBe(token);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("omits token when not provided", () => {
    const options = toAppOptions({
      appId: "test-client-id",
      appPassword: "test-secret",
    });

    expect(options.token).toBeUndefined();
    expect(options.clientSecret).toBe("test-secret");
  });
});
