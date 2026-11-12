import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { walkImportGraph } from "./test-utils";

describe("import graph walker", () => {
  let fixtureDir: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "twilio-import-graph-"));
    await mkdir(join(fixtureDir, "nested"));
    const files: Record<string, string> = {
      "entry.js":
        'import {\n  a,\n  b\n} from "./chunk-a.js";\nexport { a, b };\n',
      "chunk-a.js":
        'export*from"./chunk-b.js";import{c}from"./nested";export const a = 1, b = c;\n',
      "chunk-b.js": "import './chunk-c.js';\nexport const z = 1;\n",
      "chunk-c.js":
        'const lazy = () => import("./chunk-d.js");\nexport { lazy };\n',
      "chunk-d.js": [
        "import leaked from 'chat';",
        'import * as shared from "@chat-adapter/shared";',
        'import "node:fs";',
        'export { y } from "re-exported";',
        'export * as ns from "namespace-re-exported";',
        'const later = await import("dynamic");',
        "const template = await import(`template`);",
        'import { type Kept } from "inline-type";',
        'import {\n  lineCommented, // note\n} from "line-commented";',
        'import { /* note */ blockCommented } from "block-commented";',
        'import type { Erased } from "erased-import-type";',
        'export type { Erased } from "erased-export-type";',
        'export type * from "erased-export-type-star";',
        "export function from() { return leaked; }",
        "",
      ].join("\n"),
      "nested/index.ts": 'import"side-effect";\nexport const c = 2;\n',
      "missing-relative.js": 'import "./does-not-exist.js";\n',
      "non-literal.js": "const load = (name) => import(name);\n",
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(fixtureDir, name), content);
    }
  });

  afterAll(async () => {
    await rm(fixtureDir, { force: true, recursive: true });
  });

  it("follows every relative import form and reports every bare specifier", async () => {
    const graph = await walkImportGraph(
      join(fixtureDir, "entry.js"),
      fixtureDir
    );

    expect(graph.files).toEqual([
      "chunk-a.js",
      "chunk-b.js",
      "chunk-c.js",
      "chunk-d.js",
      "entry.js",
      "nested/index.ts",
    ]);
    expect(graph.bare).toEqual({
      "@chat-adapter/shared": ["chunk-d.js"],
      "block-commented": ["chunk-d.js"],
      chat: ["chunk-d.js"],
      dynamic: ["chunk-d.js"],
      "inline-type": ["chunk-d.js"],
      "line-commented": ["chunk-d.js"],
      "namespace-re-exported": ["chunk-d.js"],
      "node:fs": ["chunk-d.js"],
      "re-exported": ["chunk-d.js"],
      "side-effect": ["nested/index.ts"],
      template: ["chunk-d.js"],
    });
  });

  it("rejects when a relative import has no file behind it", async () => {
    await expect(
      walkImportGraph(join(fixtureDir, "missing-relative.js"), fixtureDir)
    ).rejects.toThrow('Cannot resolve "./does-not-exist.js"');
  });

  it("rejects when a dynamic import cannot be followed", async () => {
    await expect(
      walkImportGraph(join(fixtureDir, "non-literal.js"), fixtureDir)
    ).rejects.toThrow("non-literal dynamic import");
  });

  it("rejects when the entry file is missing", async () => {
    await expect(
      walkImportGraph(join(fixtureDir, "absent.js"), fixtureDir)
    ).rejects.toThrow("ENOENT");
  });
});
