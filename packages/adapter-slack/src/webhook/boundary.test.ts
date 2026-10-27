import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `from "x"` clauses of import and export statements, side-effect imports,
// and dynamic `import("x")`.
const IMPORT_SPECIFIER =
  /\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm;
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every module the webhook subpath reaches, following relative imports
 * (type-only included, since they shape the published declarations), and the
 * package specifiers they import.
 */
async function importGraph(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (files.has(file)) {
      return;
    }
    files.add(file);
    const source = await readFile(file, { encoding: "utf8" });
    for (const [, fromClause, sideEffect, dynamic] of source.matchAll(
      IMPORT_SPECIFIER
    )) {
      const specifier = fromClause ?? sideEffect ?? dynamic;
      if (!specifier.startsWith(".")) {
        packages.add(specifier);
        continue;
      }
      const base = resolve(dirname(file), specifier);
      const target = [`${base}.ts`, `${base}/index.ts`].find((candidate) =>
        existsSync(candidate)
      );
      if (!target) {
        throw new Error(`Unresolved import ${specifier} in ${file}`);
      }
      await visit(target);
    }
  };
  await visit(resolve(SOURCE_ROOT, entry));
  return {
    files: [...files].map((file) => relative(SOURCE_ROOT, file)).sort(),
    packages: [...packages].sort(),
  };
}

describe("webhook import boundary", () => {
  it("reaches only runtime-free modules", async () => {
    const graph = await importGraph("webhook/index.ts");

    // The runtime-free mentions subpath is the only package import. The full
    // adapter, `chat`, root `@chat-adapter/shared`, the Slack SDKs, and
    // `node:crypto` are all outside the boundary.
    expect(graph.packages).toStrictEqual(["@chat-adapter/shared/mentions"]);
    expect(graph.files).toStrictEqual([
      "event.ts",
      "format/index.ts",
      "mention.ts",
      "webhook/index.ts",
      "webhook/parse.ts",
      "webhook/types.ts",
      "webhook/utils.ts",
      "webhook/verify.ts",
    ]);
  });
});
