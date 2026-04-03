import { afterAll, describe, expect, it } from "vitest";
import {
  ADAPTER_CATALOG,
  CHAT_SKILL,
  cleanupPackArtifacts,
  extractBulletItems,
  extractFactoryName,
  extractMarkdownTableRows,
  extractPublishedPaths,
  extractSection,
  getPackedTarballEntries,
  invariant,
  isCommunityEntry,
  isOfficialCatalogEntry,
  isOfficialPlatformEntry,
  isOfficialStateEntry,
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

  it("should list all official platform adapters with correct factories", () => {
    const section = extractSection(CHAT_SKILL, "Official platform adapters");
    const actualRows = extractMarkdownTableRows(section).map(
      ([name, packageName, factory]) => ({
        name,
        packageName,
        factory,
      })
    );

    const expectedRows = ADAPTER_CATALOG.filter(isOfficialPlatformEntry).map(
      (entry) => ({
        name: entry.name,
        packageName: entry.packageName,
        factory: extractFactoryName(entry.packageName),
      })
    );

    expect(actualRows).toEqual(expectedRows);
  });

  it("should list all official state adapters with correct factories", () => {
    const section = extractSection(CHAT_SKILL, "Official state adapters");
    const actualRows = extractMarkdownTableRows(section).map(
      ([name, packageName, factory]) => ({
        name,
        packageName,
        factory,
      })
    );

    const expectedRows = ADAPTER_CATALOG.filter(isOfficialStateEntry).map(
      (entry) => ({
        name: entry.name,
        packageName: entry.packageName,
        factory: extractFactoryName(entry.packageName),
      })
    );

    expect(actualRows).toEqual(expectedRows);
  });

  it("should list all community adapters", () => {
    const section = extractSection(CHAT_SKILL, "Community adapters");
    const actualItems = extractBulletItems(section);
    const expectedItems = ADAPTER_CATALOG.filter(isCommunityEntry).map(
      (entry) => entry.packageName
    );

    expect(actualItems).toEqual(expectedItems);
  });

  it("should list all coming-soon platform entries", () => {
    const section = extractSection(CHAT_SKILL, "Coming-soon platform entries");
    const actualItems = extractBulletItems(section);
    const expectedItems = ADAPTER_CATALOG.filter(
      (entry) => entry.type === "platform" && entry.comingSoon
    ).map((entry) => entry.name);

    expect(actualItems).toEqual(expectedItems);
  });
});
