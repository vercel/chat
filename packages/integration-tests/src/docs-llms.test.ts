import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOCS_CONTENT_DIR,
  findDocsMdxFiles,
  REPO_ROOT,
} from "./documentation-test-utils";

const DOCS_DIR = join(DOCS_CONTENT_DIR, "docs");
const PROXY_PATH = join(REPO_ROOT, "apps/docs/proxy.ts");

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---/;
const FIELD_LINE = /^([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/;
const NEWLINE = /\r?\n/;
const QUOTES = /^["']|["']$/g;
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

describe("Adapter Accept-header markdown negotiation", () => {
  const proxy = readFileSync(PROXY_PATH, "utf-8");

  // The geistdocs proxy resolves `.md` URLs, `Accept: text/markdown`
  // negotiation, and AI-agent rewrites from the `markdownRoutes` mappings.
  // Docs and adapters use different markdown route handlers, so both
  // families must be mapped explicitly — dropping either one silently
  // serves HTML to markdown-preferring clients.
  it("maps the docs family to the docs markdown route", () => {
    expect(proxy).toContain(
      '{ from: "/docs/*path", to: "/[lang]/llms.mdx/*path" }'
    );
  });

  it("maps the adapters family to the adapters markdown route", () => {
    expect(proxy).toContain(
      '{ from: "/adapters/*path", to: "/[lang]/adapters.mdx/*path" }'
    );
  });
});
