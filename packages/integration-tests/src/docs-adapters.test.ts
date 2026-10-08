import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ADAPTERS, getCatalogEntry, listAdapters } from "@chat-adapter/catalog";
import { describe, expect, it } from "vitest";
import { DOCS_CONTENT_DIR, findDocsMdxFiles } from "./documentation-test-utils";

const ADAPTERS_DIR = join(DOCS_CONTENT_DIR, "adapters");
const VENDOR_DIR = join(ADAPTERS_DIR, "vendor-official");
const COMMUNITY_DIR = join(ADAPTERS_DIR, "community");
const OFFICIAL_DIR = join(ADAPTERS_DIR, "official");

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---/;
const FIELD_LINE = /^([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/;
const NEWLINE = /\r?\n/;
const CHAT_ADAPTER_PACKAGE = /^@chat-adapter\//;
const CHAT_STATE_ADAPTER_PACKAGE = /^@chat-adapter\/state-/;
const PACKAGE_INSTALL_PATTERN = /<PackageInstall package="([^"]+)" \/>/g;
const PACKAGE_INSTALL_PACKAGE_SEPARATOR = /\s+/;
const FEATURES_FIELD = /^features:/m;

interface Frontmatter {
  fields: Record<string, string>;
  raw: string;
}

const parseFrontmatter = (content: string): Frontmatter | null => {
  const match = content.match(FRONTMATTER_BLOCK);
  if (!match) {
    return null;
  }
  const fields: Record<string, string> = {};
  for (const line of match[1].split(NEWLINE)) {
    const fieldMatch = line.match(FIELD_LINE);
    if (fieldMatch) {
      const [, key, value] = fieldMatch;
      fields[key] = value.trim().replace(/^["']|["']$/g, "");
    }
  }
  return { raw: match[1], fields };
};

const REQUIRED_ADAPTER_FIELDS = [
  "title",
  "description",
  "packageName",
  "slug",
  "tagline",
  "type",
] as const;

const PLATFORM_OR_STATE = new Set(["platform", "state"]);

interface AdapterFile {
  body: string;
  fileName: string;
  filePath: string;
  frontmatter: Frontmatter;
  slug: string;
}

const loadAdapterMdx = (dir: string, group: string): AdapterFile[] => {
  const files = findDocsMdxFiles(dir).filter(
    ({ name }) => !name.endsWith("/meta.json")
  );

  return files.map(({ path, name }) => {
    const content = readFileSync(path, "utf-8");
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) {
      throw new Error(`${name}: missing YAML frontmatter (${group})`);
    }
    const slug = basename(path, ".mdx");
    return {
      filePath: path,
      fileName: name,
      slug,
      body: content.slice(content.indexOf("---", 3) + 3).trim(),
      frontmatter,
    };
  });
};

const packageInstallDeps = (adapter: AdapterFile): string[] => {
  const packageNames = new Set<string>();
  for (const match of adapter.body.matchAll(PACKAGE_INSTALL_PATTERN)) {
    for (const packageName of match[1].split(
      PACKAGE_INSTALL_PACKAGE_SEPARATOR
    )) {
      if (packageName) {
        packageNames.add(packageName);
      }
    }
  }
  packageNames.delete(adapter.frontmatter.fields.packageName);
  packageNames.delete("chat");
  for (const packageName of packageNames) {
    if (CHAT_STATE_ADAPTER_PACKAGE.test(packageName)) {
      packageNames.delete(packageName);
    }
  }
  return [...packageNames].sort();
};

describe("Adapter MDX frontmatter", () => {
  const allAdapters = [
    ...loadAdapterMdx(OFFICIAL_DIR, "official"),
    ...loadAdapterMdx(VENDOR_DIR, "vendor-official"),
    ...loadAdapterMdx(COMMUNITY_DIR, "community"),
  ];

  for (const adapter of allAdapters) {
    describe(adapter.fileName, () => {
      it("has all required frontmatter fields", () => {
        for (const field of REQUIRED_ADAPTER_FIELDS) {
          expect(
            adapter.frontmatter.fields[field],
            `${adapter.fileName}: missing required frontmatter field "${field}"`
          ).toBeTruthy();
        }
      });

      it("uses a valid `type` (platform or state)", () => {
        expect(PLATFORM_OR_STATE.has(adapter.frontmatter.fields.type)).toBe(
          true
        );
      });

      it("file basename matches the `slug` frontmatter field", () => {
        expect(adapter.frontmatter.fields.slug).toBe(adapter.slug);
      });
    });
  }
});

describe("Vendor-Official adapter MDX", () => {
  const vendorAdapters = loadAdapterMdx(VENDOR_DIR, "vendor-official");

  for (const adapter of vendorAdapters) {
    describe(adapter.fileName, () => {
      it("has vendorOfficial: true and community: true", () => {
        expect(adapter.frontmatter.fields.vendorOfficial).toBe("true");
        expect(adapter.frontmatter.fields.community).toBe("true");
      });

      it("declares an author", () => {
        expect(adapter.frontmatter.fields.author).toBeTruthy();
      });

      it("has mdxBody: true (hand-authored content)", () => {
        expect(adapter.frontmatter.fields.mdxBody).toBe("true");
      });

      it("renders the FeatureSupport matrix", () => {
        expect(adapter.body).toContain("<FeatureSupport />");
      });

      it("keeps catalog peerDeps aligned with PackageInstall extras", () => {
        const catalogEntry = ADAPTERS[adapter.slug as keyof typeof ADAPTERS];
        expect(
          catalogEntry,
          `${adapter.fileName}: missing @chat-adapter/catalog entry`
        ).toBeDefined();
        expect([...(catalogEntry?.peerDeps ?? [])].sort()).toEqual(
          packageInstallDeps(adapter)
        );
      });
    });
  }
});

describe("Community adapter MDX", () => {
  const communityAdapters = loadAdapterMdx(COMMUNITY_DIR, "community");

  it("contains only non-vendor community adapters", () => {
    for (const adapter of communityAdapters) {
      expect(adapter.frontmatter.fields.vendorOfficial).toBeUndefined();
    }
  });

  for (const adapter of communityAdapters) {
    describe(adapter.fileName, () => {
      it("has community: true", () => {
        expect(adapter.frontmatter.fields.community).toBe("true");
      });

      it("has mdxBody: true (hand-authored content)", () => {
        expect(adapter.frontmatter.fields.mdxBody).toBe("true");
      });

      it("renders the FeatureSupport matrix", () => {
        expect(adapter.body).toContain("<FeatureSupport />");
      });
    });
  }
});

describe("Official adapter MDX", () => {
  const officialAdapters = loadAdapterMdx(OFFICIAL_DIR, "official");

  for (const adapter of officialAdapters) {
    describe(adapter.fileName, () => {
      it("is not flagged as community or vendor-official", () => {
        expect(adapter.frontmatter.fields.community).toBeUndefined();
        expect(adapter.frontmatter.fields.vendorOfficial).toBeUndefined();
      });

      it("uses an @chat-adapter/* package", () => {
        expect(adapter.frontmatter.fields.packageName).toMatch(
          CHAT_ADAPTER_PACKAGE
        );
      });
    });
  }
});

describe("@chat-adapter/catalog parity", () => {
  const adapterFiles = [
    ...loadAdapterMdx(OFFICIAL_DIR, "official").map((adapter) => ({
      adapter,
      group: "official",
    })),
    ...loadAdapterMdx(VENDOR_DIR, "vendor-official").map((adapter) => ({
      adapter,
      group: "vendor-official",
    })),
    ...loadAdapterMdx(COMMUNITY_DIR, "community").map((adapter) => ({
      adapter,
      group: "community",
    })),
  ];

  it("lists exactly the adapters that have docs pages", () => {
    expect(
      listAdapters()
        .map((entry) => entry.slug)
        .sort()
    ).toEqual(adapterFiles.map(({ adapter }) => adapter.slug).sort());
  });

  for (const { adapter, group } of adapterFiles) {
    describe(adapter.fileName, () => {
      const entry = getCatalogEntry(adapter.slug);

      it("has a catalog entry in the matching group", () => {
        expect(
          entry,
          `${adapter.fileName}: no @chat-adapter/catalog entry for slug "${adapter.slug}"`
        ).toBeDefined();
        expect(entry?.group).toBe(group);
      });

      it("packageName matches the catalog", () => {
        expect(entry?.packageName).toBe(adapter.frontmatter.fields.packageName);
      });

      it("type matches the catalog", () => {
        expect(entry?.type).toBe(adapter.frontmatter.fields.type);
      });

      it("author matches the catalog", () => {
        const author = adapter.frontmatter.fields.author;
        if (group === "official") {
          expect(author).toBeUndefined();
          expect(entry?.author).toBeUndefined();
          return;
        }
        if (group === "vendor-official") {
          expect(author, `${adapter.fileName}: missing author`).toBeTruthy();
        }
        if (author) {
          expect(entry?.author).toBe(author);
        }
      });

      it("reads capabilities from the catalog, not frontmatter", () => {
        expect(adapter.frontmatter.raw).not.toMatch(FEATURES_FIELD);
      });
    });
  }
});
