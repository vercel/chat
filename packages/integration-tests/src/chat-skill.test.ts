import { afterAll, describe, expect, it } from "vitest";
import {
  ADAPTER_CATALOG,
  CHAT_SKILL,
  cleanupPackArtifacts,
  extractPublishedPaths,
  getPackedTarballEntries,
  invariant,
  isOfficialCatalogEntry,
  parsePublishedPath,
} from "./chat-skill-test-utils";

describe("skills/chat/SKILL.md", () => {
  afterAll(() => {
    cleanupPackArtifacts();
  });

  it("should only reference published-source paths", () => {
    const monorepoOnlyMarkers = [
      "packages/",
      "apps/docs/",
      "examples/nextjs-chat/",
      ".changeset/",
      ".github/",
    ];

    for (const marker of monorepoOnlyMarkers) {
      expect(
        CHAT_SKILL.includes(marker),
        `SKILL.md should not reference monorepo-only path "${marker}"`
      ).toBe(false);
    }
  });

  it("should reference published paths that exist", () => {
    const publishedPaths = extractPublishedPaths(CHAT_SKILL);

    expect(publishedPaths.length).toBeGreaterThan(0);

    for (const publishedPath of publishedPaths) {
      const parsedPath = parsePublishedPath(publishedPath);
      invariant(
        parsedPath,
        `Could not parse published path "${publishedPath}"`
      );

      const packedEntries = getPackedTarballEntries(parsedPath.packageName);
      const tarballRelativePath = parsedPath.relativePath
        ? `package/${parsedPath.relativePath}`
        : "package";
      const existsInTarball = parsedPath.relativePath
        ? packedEntries.includes(tarballRelativePath) ||
          packedEntries.some((entry) =>
            entry.startsWith(`${tarballRelativePath}/`)
          )
        : packedEntries.some((entry) => entry.startsWith("package/"));

      expect(
        existsInTarball,
        `Published path "${publishedPath}" should exist in the packed tarball for ${parsedPath.packageName}`
      ).toBe(true);
    }
  });

  it("should pack adapter and state packages with dist entrypoints", () => {
    const officialPackageNames = ADAPTER_CATALOG.filter(
      isOfficialCatalogEntry
    ).map((entry) => entry.packageName);

    for (const packageName of [
      ...officialPackageNames,
      "@chat-adapter/shared",
    ]) {
      const packedEntries = getPackedTarballEntries(packageName);

      expect(
        packedEntries.includes("package/dist/index.d.ts"),
        `${packageName} tarball should include package/dist/index.d.ts`
      ).toBe(true);
    }
  });

  it("should link to the adapters page instead of listing them inline", () => {
    expect(CHAT_SKILL).toContain("https://chat-sdk.dev/adapters");
  });
});
