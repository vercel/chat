import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_SDK_GUIDES_URL,
  CHAT_SDK_HOMEPAGE,
  findPublishedPackages,
  getExpectedHomepage,
  getOfficialPlatformAdapterSlug,
  REPO_ROOT,
} from "./documentation-test-utils";

const publishedPackages = findPublishedPackages();
const NPM_PACKAGE_CALLOUT =
  /> npm package: \[`([^`]+)`\]\(https:\/\/www\.npmjs\.com\/package\//;
const CREATE_CHAT_SDK_COMMAND = "npx create-chat-sdk@latest";
const ADAPTERS_DIRECTORY_URL = `${CHAT_SDK_HOMEPAGE}/adapters`;

const getNpmPackageCallout = (readme: string) =>
  readme.match(NPM_PACKAGE_CALLOUT)?.[1];

describe("Published package README discoverability", () => {
  for (const pkg of publishedPackages) {
    describe(pkg.name, () => {
      if (!pkg.readmePath) {
        return;
      }

      const readme = readFileSync(pkg.readmePath, "utf-8");

      it("includes an npm package callout matching package.json name", () => {
        expect(
          getNpmPackageCallout(readme),
          `${pkg.name}: missing npm callout`
        ).toBe(pkg.name);
      });

      const platformSlug = getOfficialPlatformAdapterSlug(pkg.dirName);
      const isOfficialStateAdapter = pkg.dirName.startsWith("state-");

      if (platformSlug || isOfficialStateAdapter) {
        it("documents CLI scaffolding and links to the adapters directory", () => {
          expect(
            readme,
            `${pkg.name}: missing create-chat-sdk command`
          ).toContain(CREATE_CHAT_SDK_COMMAND);
          expect(
            readme,
            `${pkg.name}: missing adapters directory link`
          ).toContain(ADAPTERS_DIRECTORY_URL);
        });
      }

      if (pkg.name !== "@chat-adapter/tests") {
        it("includes documentation and guides links", () => {
          expect(
            readme,
            `${pkg.name}: missing chat-sdk.dev docs link`
          ).toContain(getExpectedHomepage(pkg.dirName, pkg.name));
          expect(readme, `${pkg.name}: missing Guides link`).toContain(
            CHAT_SDK_GUIDES_URL
          );
        });
      }

      it("documents the Chat SDK skill install command", () => {
        expect(readme).toContain("npx skills add vercel/chat");
      });

      it("links to llms.txt and llms-full.txt", () => {
        expect(readme).toContain(`${CHAT_SDK_HOMEPAGE}/llms.txt`);
        expect(readme).toContain(`${CHAT_SDK_HOMEPAGE}/llms-full.txt`);
      });
    });
  }
});

describe("Root README discoverability", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");

  it("documents the Chat SDK skill install command", () => {
    expect(readme).toContain("npx skills add vercel/chat");
  });

  it("links to llms.txt and llms-full.txt", () => {
    expect(readme).toContain(`${CHAT_SDK_HOMEPAGE}/llms.txt`);
    expect(readme).toContain(`${CHAT_SDK_HOMEPAGE}/llms-full.txt`);
  });

  it("links to the docs site", () => {
    expect(readme).toContain(`${CHAT_SDK_HOMEPAGE}/docs`);
  });
});
