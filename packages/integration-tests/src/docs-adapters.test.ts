import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
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

  it("contains exactly the expected adapters", () => {
    expect(vendorAdapters.map((a) => a.slug).sort()).toEqual(
      [
        "agentphone",
        "imessage",
        "lark",
        "liveblocks",
        "matrix",
        "resend",
        "zernio",
      ].sort()
    );
  });

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

describe("adapters.json registry", () => {
  const registry = JSON.parse(
    readFileSync(join(DOCS_CONTENT_DIR, "..", "adapters.json"), "utf-8")
  ) as Array<{
    slug: string;
    type: "platform" | "state";
    packageName: string;
    community?: boolean;
    vendorOfficial?: boolean;
    author?: string;
  }>;

  const vendorAdapters = loadAdapterMdx(VENDOR_DIR, "vendor-official");
  const communityAdapters = loadAdapterMdx(COMMUNITY_DIR, "community");

  for (const adapter of [...vendorAdapters, ...communityAdapters]) {
    describe(adapter.fileName, () => {
      const entry = registry.find((e) => e.slug === adapter.slug);

      it("has a matching adapters.json entry", () => {
        expect(
          entry,
          `${adapter.fileName}: no entry in adapters.json for slug "${adapter.slug}"`
        ).toBeDefined();
      });

      it("packageName matches adapters.json", () => {
        expect(entry?.packageName).toBe(adapter.frontmatter.fields.packageName);
      });

      it("type matches adapters.json", () => {
        expect(entry?.type).toBe(adapter.frontmatter.fields.type);
      });

      it("vendorOfficial flag matches adapters.json", () => {
        const inMdx = adapter.frontmatter.fields.vendorOfficial === "true";
        const inRegistry = entry?.vendorOfficial === true;
        expect(inMdx).toBe(inRegistry);
      });

      it("community flag matches adapters.json", () => {
        const inMdx = adapter.frontmatter.fields.community === "true";
        const inRegistry = entry?.community === true;
        expect(inMdx).toBe(inRegistry);
      });
    });
  }
});
