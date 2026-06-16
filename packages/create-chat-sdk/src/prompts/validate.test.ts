import { describe, expect, it } from "vitest";
import {
  detectPackageManager,
  isPackageManager,
  validatePackageName,
} from "./validate.js";

describe("validatePackageName", () => {
  it("rejects empty and invalid names", () => {
    expect(validatePackageName(undefined)).toBe("Project name is required");
    expect(validatePackageName("")).toBe("Project name is required");
    expect(validatePackageName("   ")).toBe("Project name is required");
    expect(validatePackageName("bad name!")).toContain("valid npm package");
    expect(validatePackageName(".hidden")).toContain("valid npm package");
    expect(validatePackageName("_private")).toContain("valid npm package");
    expect(validatePackageName("bad..name")).toContain("valid npm package");
  });

  it("accepts valid names", () => {
    expect(validatePackageName("my-bot")).toBeUndefined();
  });

  it("rejects scoped names because the name doubles as the output directory", () => {
    expect(validatePackageName("@acme/my-bot")).toContain("unscoped");
  });
});

describe("package manager helpers", () => {
  it("narrows package managers", () => {
    expect(isPackageManager("pnpm")).toBe(true);
    expect(isPackageManager("pmpm")).toBe(false);
  });

  it("detects package managers from user-agent strings", () => {
    expect(detectPackageManager("pnpm/10")).toBe("pnpm");
    expect(detectPackageManager("yarn/4")).toBe("yarn");
    expect(detectPackageManager("bun/1")).toBe("bun");
    expect(detectPackageManager("npm/10")).toBe("npm");
    expect(detectPackageManager()).toBe("npm");
  });
});
