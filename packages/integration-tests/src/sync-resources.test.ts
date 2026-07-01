import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./documentation-test-utils";

interface Resource {
  description: string;
  href: string;
  title: string;
  type: "guide" | "template";
}

const CONFIG_PATH = "apps/docs/resources-edge-config.json";
const GUIDES_DIR = "packages/chat/resources/guides";
const TEMPLATES_FILE = "packages/chat/resources/templates.json";
const SKILL_FILE = "skills/chat/SKILL.md";
const SKILL_FILE_COPIES = [
  "apps/docs/public/.well-known/agent-skills/chat-sdk/SKILL.md",
  "apps/docs/public/AGENTS.md",
  "packages/create-chat-sdk/_template/.agents/skills/chat-sdk/SKILL.md",
  "packages/create-chat-sdk/_template/.claude/skills/chat-sdk/SKILL.md",
] as const;

const read = (path: string): string =>
  readFileSync(join(REPO_ROOT, path), "utf-8");

const slugFromHref = (href: string): string => {
  const segment = new URL(href).pathname.split("/").filter(Boolean).pop();
  if (!segment) {
    throw new Error(`Cannot derive slug from href: ${href}`);
  }
  return segment;
};

const { resources } = JSON.parse(read(CONFIG_PATH)) as {
  resources: Resource[];
};
const guides = resources.filter((r) => r.type === "guide");
const templates = resources.filter((r) => r.type === "template");

describe("resources-edge-config.json", () => {
  it("has no duplicate guide slugs", () => {
    const slugs = guides.map((g) => slugFromHref(g.href));
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("synced guide files", () => {
  it("has a non-empty markdown file for every configured guide", () => {
    for (const guide of guides) {
      const slug = slugFromHref(guide.href);
      const body = read(`${GUIDES_DIR}/${slug}.md`);
      expect(body.length).toBeGreaterThan(0);
    }
  });

  it("contains no guide files beyond those in the config", () => {
    const onDisk = readdirSync(join(REPO_ROOT, GUIDES_DIR))
      .filter((name) => name.endsWith(".md"))
      .sort();
    const expected = guides.map((g) => `${slugFromHref(g.href)}.md`).sort();
    expect(onDisk).toEqual(expected);
  });
});

describe("templates.json", () => {
  it("mirrors the templates from the config in order", () => {
    const payload = JSON.parse(read(TEMPLATES_FILE)) as {
      templates: { description: string; href: string; title: string }[];
    };
    const expected = templates.map(({ title, description, href }) => ({
      title,
      description,
      href,
    }));
    expect(payload.templates).toEqual(expected);
  });
});

describe("skill file copies", () => {
  const source = read(SKILL_FILE);

  for (const copyPath of SKILL_FILE_COPIES) {
    it(`${copyPath} is an exact copy of ${SKILL_FILE}`, () => {
      expect(read(copyPath)).toBe(source);
    });
  }

  it("lists every configured guide and template", () => {
    for (const guide of guides) {
      expect(source).toContain(`${slugFromHref(guide.href)}.md`);
    }
    for (const template of templates) {
      expect(source).toContain(template.title);
    }
  });
});
