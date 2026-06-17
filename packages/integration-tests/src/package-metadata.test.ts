import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findPublishedPackages,
  getExpectedHomepage,
  PRODUCTION_STATE_ADAPTER_KEYWORDS,
  SHARED_STATE_ADAPTER_KEYWORDS,
} from "./documentation-test-utils";

interface PackageJson {
  description?: string;
  homepage?: string;
  keywords?: string[];
  name: string;
  repository?: {
    directory?: string;
  };
}

const CHAT_SDK_HOMEPAGE_PATTERN = /^https:\/\/chat-sdk\.dev\//;
const CHAT_SDK_DESCRIPTION_PATTERN = /Chat SDK/i;

const publishedPackages = findPublishedPackages();

describe("Published npm package metadata", () => {
  it("discovers all non-private workspace packages", () => {
    expect(publishedPackages.length).toBeGreaterThanOrEqual(17);
  });

  for (const pkg of publishedPackages) {
    describe(pkg.name, () => {
      const packageJson = JSON.parse(
        readFileSync(pkg.packageJsonPath, "utf-8")
      ) as PackageJson;

      it("points homepage at chat-sdk.dev", () => {
        expect(
          packageJson.homepage,
          `${pkg.name}: missing homepage`
        ).toBeTruthy();
        expect(packageJson.homepage).toMatch(CHAT_SDK_HOMEPAGE_PATTERN);
      });

      it("homepage matches the package docs deep link", () => {
        expect(packageJson.homepage).toBe(
          getExpectedHomepage(pkg.dirName, pkg.name)
        );
      });

      it("description mentions Chat SDK", () => {
        expect(
          packageJson.description,
          `${pkg.name}: missing description`
        ).toBeTruthy();
        expect(packageJson.description).toMatch(CHAT_SDK_DESCRIPTION_PATTERN);
      });

      it("repository.directory matches the package folder", () => {
        expect(
          packageJson.repository?.directory,
          `${pkg.name}: missing repository.directory`
        ).toBe(`packages/${pkg.dirName}`);
      });
    });
  }
});

describe("State adapter npm keywords", () => {
  const statePackages = publishedPackages.filter((pkg) =>
    pkg.dirName.startsWith("state-")
  );
  const productionStatePackages = statePackages.filter(
    (pkg) => pkg.dirName !== "state-memory"
  );

  for (const pkg of statePackages) {
    describe(pkg.name, () => {
      const packageJson = JSON.parse(
        readFileSync(pkg.packageJsonPath, "utf-8")
      ) as PackageJson;

      for (const keyword of SHARED_STATE_ADAPTER_KEYWORDS) {
        it(`includes "${keyword}"`, () => {
          expect(
            packageJson.keywords,
            `${pkg.name}: missing keywords array`
          ).toBeTruthy();
          expect(packageJson.keywords).toContain(keyword);
        });
      }
    });
  }

  for (const pkg of productionStatePackages) {
    describe(`${pkg.name} production keywords`, () => {
      const packageJson = JSON.parse(
        readFileSync(pkg.packageJsonPath, "utf-8")
      ) as PackageJson;

      for (const keyword of PRODUCTION_STATE_ADAPTER_KEYWORDS) {
        it(`includes "${keyword}"`, () => {
          expect(packageJson.keywords).toContain(keyword);
        });
      }
    });
  }
});

describe("Core chat package metadata", () => {
  const chatPackage = publishedPackages.find((pkg) => pkg.name === "chat");

  it("exists in the published package set", () => {
    expect(chatPackage).toBeDefined();
  });

  it("uses the correct monorepo directory in repository metadata", () => {
    expect(chatPackage).toBeDefined();
    if (!chatPackage) {
      return;
    }

    const packageJson = JSON.parse(
      readFileSync(chatPackage.packageJsonPath, "utf-8")
    ) as PackageJson;
    expect(packageJson.repository?.directory).toBe("packages/chat");
  });
});
