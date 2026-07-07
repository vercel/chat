import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Return the first existing template directory from a candidate list.
 *
 * @param candidates - Candidate template directories.
 * @returns Existing template directory.
 * @throws Error when none of the candidates exist.
 */
export function resolveTemplateDir(candidates: readonly string[]): string {
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `Could not find create-chat-sdk template directory. Checked: ${candidates.join(", ")}`
    );
  }
  return found;
}

/**
 * Resolve the packaged template directory.
 *
 * @returns Absolute template directory path.
 */
export const templateDir = (): string => {
  const candidates = [
    // Bundled CLI: dist/index.js.
    path.resolve(dirname, "..", "_template"),
    // Unbundled source/tests: src/scaffold/template.ts.
    path.resolve(dirname, "..", "..", "_template"),
  ];

  return resolveTemplateDir(candidates);
};
