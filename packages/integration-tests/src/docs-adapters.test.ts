import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { runInNewContext } from "node:vm";
import type { WebhookOptions } from "chat";
import { ADAPTERS } from "chat/adapters";
import { ModuleKind, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  DOCS_CONTENT_DIR,
  extractTypeScriptBlocks,
  findDocsMdxFiles,
} from "./documentation-test-utils";

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

describe("Adapter webhook route examples", () => {
  it.each([
    "official/slack",
    "official/teams",
    "official/discord",
    "official/github",
    "official/linear",
    "vendor-official/agentphone",
    "community/webex",
  ])("keeps %s handlers alive after the response", async (path) => {
    const slug = basename(path);
    const content = readFileSync(join(ADAPTERS_DIR, `${path}.mdx`), "utf-8");
    const example = extractTypeScriptBlocks(content).find((block) =>
      block.includes(`webhooks.${slug}(`)
    );
    expect(example).toBeDefined();
    const { outputText } = transpileModule(example ?? "", {
      compilerOptions: { module: ModuleKind.CommonJS },
    });
    const after = vi.fn<(callback: () => Promise<unknown>) => void>();
    const task = new Promise(() => {});
    const response = new Response("OK");
    const webhook = vi.fn((_request: Request, options?: WebhookOptions) => {
      options?.waitUntil?.(task);
      return Promise.resolve(response);
    });
    const bot = { webhooks: { [slug]: webhook } };
    const exports: { POST?: (request: Request) => Promise<Response> } = {};
    runInNewContext(outputText, {
      exports,
      require: (specifier: string) => {
        if (specifier === "next/server") {
          return { after };
        }
        if (specifier === "@/lib/bot") {
          return { bot, chat: bot };
        }
        throw new Error(`Unexpected import: ${specifier}`);
      },
    });
    const request = new Request("https://example.com/webhook", {
      method: "POST",
    });
    expect(await exports.POST?.(request)).toBe(response);
    expect(webhook.mock.calls[0][0]).toBe(request);
    expect(after).toHaveBeenCalledOnce();
    expect(after.mock.calls[0][0]()).toBe(task);
  });
});

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
          `${adapter.fileName}: missing chat/adapters catalog entry`
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

describe("adapters.json registry", () => {
  const registry = JSON.parse(
    readFileSync(join(DOCS_CONTENT_DIR, "..", "adapters.json"), "utf-8")
  ) as Array<{
    description: string;
    name: string;
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
