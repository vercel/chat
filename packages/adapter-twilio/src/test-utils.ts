import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// With verbatimModuleSyntax, only statement-level `import type` and
// `export type` are erased. `import { type A } from "x"` still loads "x" at
// runtime, so it is matched like any other import.
const FROM_SPECIFIER_REGEX =
  /(?<![\w$.])(?:import|export)(\s+type\b(?!\s+from\b))?(?:\s|[\w$*,{}]|\/\/[^\n]*\n|\/\*(?:[^*]|\*(?!\/))*\*\/)*?from\s*["'`]([^"'`]+)["'`]/g;
const SIDE_EFFECT_SPECIFIER_REGEX = /(?<![\w$.])import\s*["'`]([^"'`]+)["'`]/g;
const DYNAMIC_IMPORT_REGEX = /(?<![\w$.])import\s*\(\s*([^)]*?)\s*\)/g;
const STRING_LITERAL_REGEX = /^["'`]([^"'`$]+)["'`]$/;

interface ImportGraph {
  /** Bare specifier to the sorted files that import it. */
  bare: Record<string, string[]>;
  /** Every file reached from the entry, relative to `root`, sorted. */
  files: string[];
}

function runtimeSpecifiers(source: string, file: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(FROM_SPECIFIER_REGEX)) {
    if (!match[1]) {
      specifiers.push(match[2]);
    }
  }
  for (const match of source.matchAll(SIDE_EFFECT_SPECIFIER_REGEX)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT_REGEX)) {
    const literal = STRING_LITERAL_REGEX.exec(match[1]);
    if (!literal) {
      throw new Error(
        `Cannot follow non-literal dynamic import "${match[0]}" in ${file}`
      );
    }
    specifiers.push(literal[1]);
  }
  return specifiers;
}

async function resolveRelative(
  specifier: string,
  importer: string
): Promise<string> {
  const base = resolve(dirname(importer), specifier);
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) {
    const stats = await stat(candidate).catch(() => null);
    if (stats?.isFile()) {
      return candidate;
    }
  }
  throw new Error(`Cannot resolve "${specifier}" imported by ${importer}`);
}

export async function walkImportGraph(
  entry: string,
  root: string
): Promise<ImportGraph> {
  const bare = new Map<string, Set<string>>();
  const visited = new Set<string>();
  const queue = [entry];

  for (const file of queue) {
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);
    const name = relative(root, file);
    const source = await readFile(file, "utf8");
    for (const specifier of runtimeSpecifiers(source, name)) {
      if (specifier.startsWith(".")) {
        queue.push(await resolveRelative(specifier, file));
        continue;
      }
      const importers = bare.get(specifier) ?? new Set<string>();
      importers.add(name);
      bare.set(specifier, importers);
    }
  }

  return {
    bare: Object.fromEntries(
      [...bare.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([specifier, importers]) => [specifier, [...importers].sort()])
    ),
    files: [...visited].map((file) => relative(root, file)).sort(),
  };
}

/** Absolute path of the package `src` directory. */
export const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));
