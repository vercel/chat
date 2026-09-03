import { afterEach, describe, expect, it } from "vitest";
import { authorizePreviewBranchRequest } from "./authorization";
import { parseAllowedPreviewBranchUrl } from "./preview-branch";

const previousSecret = process.env.PREVIEW_BRANCH_SECRET;
const previousHosts = process.env.PREVIEW_BRANCH_ALLOWED_HOSTS;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  process.env[name] = value;
}

afterEach(() => {
  restore("PREVIEW_BRANCH_SECRET", previousSecret);
  restore("PREVIEW_BRANCH_ALLOWED_HOSTS", previousHosts);
});

describe("preview branch boundary", () => {
  it("allows only trusted HTTPS origins", () => {
    Reflect.deleteProperty(process.env, "PREVIEW_BRANCH_ALLOWED_HOSTS");

    expect(
      parseAllowedPreviewBranchUrl("https://chat-example.vercel.app/path")
        ?.origin
    ).toBe("https://chat-example.vercel.app");
    expect(
      parseAllowedPreviewBranchUrl("https://chat-example.vercel.app.evil.test")
    ).toBeNull();
    expect(
      parseAllowedPreviewBranchUrl("http://chat-example.vercel.app")
    ).toBeNull();
    expect(
      parseAllowedPreviewBranchUrl("https://user@chat-example.vercel.app")
    ).toBeNull();
    expect(
      parseAllowedPreviewBranchUrl("https://chat-example.vercel.app:8443")
    ).toBeNull();
  });

  it("uses configured hosts as an exact allowlist", () => {
    process.env.PREVIEW_BRANCH_ALLOWED_HOSTS = "preview.example.com";

    expect(
      parseAllowedPreviewBranchUrl("https://preview.example.com/path")?.origin
    ).toBe("https://preview.example.com");
    expect(
      parseAllowedPreviewBranchUrl("https://child.preview.example.com")
    ).toBeNull();
  });

  it("fails closed when the management secret is absent or incorrect", () => {
    Reflect.deleteProperty(process.env, "PREVIEW_BRANCH_SECRET");
    expect(
      authorizePreviewBranchRequest(
        new Request("https://example.com", {
          headers: { authorization: "Bearer test-secret" },
        })
      )?.status
    ).toBe(503);

    process.env.PREVIEW_BRANCH_SECRET = "test-secret";
    expect(
      authorizePreviewBranchRequest(new Request("https://example.com"))?.status
    ).toBe(401);
    expect(
      authorizePreviewBranchRequest(
        new Request("https://example.com", {
          headers: { authorization: "Bearer wrong-secret" },
        })
      )?.status
    ).toBe(401);
  });

  it("accepts the exact management secret", () => {
    process.env.PREVIEW_BRANCH_SECRET = "test-secret";

    expect(
      authorizePreviewBranchRequest(
        new Request("https://example.com", {
          headers: { authorization: "Bearer test-secret" },
        })
      )
    ).toBeNull();
  });
});
