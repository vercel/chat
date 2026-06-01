import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOCS_CONTENT_DIR,
  findDocsMdxFiles,
  REPO_ROOT,
} from "./documentation-test-utils";

const DOCS_DIR = join(DOCS_CONTENT_DIR, "docs");
const ADAPTERS_DIR = join(DOCS_CONTENT_DIR, "adapters");
const PROXY_PATH = join(REPO_ROOT, "apps/docs/proxy.ts");

// The markdown route handler (`/adapters.mdx/[[...slug]]`), the proxy `.md`
// rewrite, the per-page `sr-only` markdown links + `text/markdown` alternates,
// and the `llms.txt` section builder all assume these exact group directories.
const ADAPTER_GROUPS = ["official", "community", "vendor-official"] as const;

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---/;
const FIELD_LINE = /^([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/;
const NEWLINE = /\r?\n/;
const QUOTES = /^["']|["']$/g;
const MDX_EXTENSION = /\.mdx?$/;
const ADAPTER_MARKDOWN_URL =
  /^\/adapters\/(official|community|vendor-official)\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

const parseFrontmatter = (content: string): Record<string, string> => {
  const fields: Record<string, string> = {};
  const match = content.match(FRONTMATTER_BLOCK);
  if (!match) {
    return fields;
  }
  for (const line of match[1].split(NEWLINE)) {
    const fieldMatch = line.match(FIELD_LINE);
    if (fieldMatch) {
      const [, key, value] = fieldMatch;
      fields[key] = value.trim().replace(QUOTES, "");
    }
  }
  return fields;
};

describe("Docs pages power the llms.txt index", () => {
  const docs = findDocsMdxFiles(DOCS_DIR);

  it("discovers documentation pages", () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  for (const doc of docs) {
    describe(doc.name, () => {
      const fields = parseFrontmatter(readFileSync(doc.path, "utf-8"));

      it("has a title (used for <title>, OG title, and llms.txt label)", () => {
        expect(
          fields.title,
          `${doc.name}: missing frontmatter "title"`
        ).toBeTruthy();
      });

      it("has a description (used for metadata and the llms.txt entry)", () => {
        expect(
          fields.description,
          `${doc.name}: missing frontmatter "description"`
        ).toBeTruthy();
      });
    });
  }
});

describe("Adapter markdown URL scheme", () => {
  it("content groups match the route segments exactly", () => {
    const present = ADAPTER_GROUPS.filter(
      (group) => findDocsMdxFiles(join(ADAPTERS_DIR, group)).length > 0
    );
    expect([...present].sort()).toEqual([...ADAPTER_GROUPS].sort());
  });

  for (const group of ADAPTER_GROUPS) {
    describe(group, () => {
      const files = findDocsMdxFiles(join(ADAPTERS_DIR, group));

      it("contains at least one adapter", () => {
        expect(files.length).toBeGreaterThan(0);
      });

      for (const file of files) {
        const slug = basename(file.path).replace(MDX_EXTENSION, "");

        it(`${slug} maps to a well-formed markdown URL`, () => {
          const markdownPath = `/adapters/${group}/${slug}.md`;
          expect(markdownPath).toMatch(ADAPTER_MARKDOWN_URL);
        });
      }
    });
  }
});

describe("Adapter Accept-header markdown negotiation", () => {
  const proxy = readFileSync(PROXY_PATH, "utf-8");

  // `rewritePath().rewrite` returns `string | false`. With `??`, a `false`
  // result from the docs rewriter does NOT fall through to the adapters
  // rewriter, so `Accept: text/markdown` on an adapter page (e.g.
  // /adapters/official/slack) would keep serving HTML. It must use `||`.
  it("falls through to the adapters rewriter with `||`", () => {
    expect(proxy).toContain(
      "rewriteLLM(pathname) || rewriteAdaptersLLM(pathname)"
    );
  });

  it("does not regress to `??` for the rewriter fallback", () => {
    expect(proxy).not.toContain("rewriteLLM(pathname) ?? rewriteAdaptersLLM");
  });
});
