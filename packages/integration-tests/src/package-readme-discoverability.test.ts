import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_SDK_GUIDES_URL,
  CHAT_SDK_HOMEPAGE,
  findPublishedPackages,
  getExpectedHomepage,
  getOfficialPlatformAdapterSlug,
  getOfficialPlatformOgImageUrl,
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
      it("has a README", () => {
        expect(
          pkg.readmePath,
          `${pkg.name}: missing packages/${pkg.dirName}/README.md`
        ).toBeTruthy();
      });

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

      it("links to chat-sdk.dev", () => {
        expect(readme).toContain(CHAT_SDK_HOMEPAGE);
      });

      const platformSlug = getOfficialPlatformAdapterSlug(pkg.dirName);
      const isOfficialStateAdapter = pkg.dirName.startsWith("state-");

      if (platformSlug) {
        it("includes a hero banner linked to the official adapter docs", () => {
          const docsUrl = getExpectedHomepage(pkg.dirName, pkg.name);
          expect(
            readme.startsWith("[!["),
            `${pkg.name}: README should start with a hero banner`
          ).toBe(true);
          expect(readme).toContain(getOfficialPlatformOgImageUrl(platformSlug));
          expect(readme).toContain(`](${docsUrl})`);
        });
      }

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
        it("includes Documentation and Guides links near the top", () => {
          const intro = readme.split("\n## ")[0] ?? readme;
          expect(intro, `${pkg.name}: missing Documentation link`).toContain(
            "Documentation:"
          );
          expect(
            intro,
            `${pkg.name}: missing chat-sdk.dev docs link`
          ).toContain(getExpectedHomepage(pkg.dirName, pkg.name));
          expect(intro, `${pkg.name}: missing Guides link`).toContain(
            CHAT_SDK_GUIDES_URL
          );
        });
      }

      it("includes an AI Coding Agents section", () => {
        expect(readme).toContain("## AI Coding Agents");
      });

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

  it("includes an AI Coding Agents section", () => {
    expect(readme).toContain("## AI Coding Agents");
  });

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
