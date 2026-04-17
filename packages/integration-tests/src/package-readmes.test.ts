import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractTypeScriptBlocks,
  findPackageReadmes,
  IMPORT_PACKAGE_REGEX,
  VALID_PACKAGE_README_IMPORTS,
} from "./documentation-test-utils";

describe("Package README code examples", () => {
  const packageReadmes = findPackageReadmes();

  for (const { path: readmePath, name: readmeName } of packageReadmes) {
    const pkgName = basename(readmePath.replace("/README.md", ""));

    it(`${pkgName} README should have TypeScript examples with valid syntax`, () => {
      const readme = readFileSync(readmePath, "utf-8");
      const codeBlocks = extractTypeScriptBlocks(readme);

      if (codeBlocks.length === 0) {
        return;
      }

      for (const block of codeBlocks) {
        const openBraces = (block.match(/{/g) || []).length;
        const closeBraces = (block.match(/}/g) || []).length;
        const openParens = (block.match(/\(/g) || []).length;
        const closeParens = (block.match(/\)/g) || []).length;

        expect(
          openBraces,
          `${readmeName}: Mismatched braces in code block`
        ).toBe(closeBraces);
        expect(
          openParens,
          `${readmeName}: Mismatched parentheses in code block`
        ).toBe(closeParens);

        const importMatches = block.match(/from ["']([^"']+)["']/g) || [];
        for (const importMatch of importMatches) {
          const pkg = importMatch.match(IMPORT_PACKAGE_REGEX)?.[1];
          if (pkg && !pkg.startsWith(".") && !pkg.startsWith("@/")) {
            const isValid =
              VALID_PACKAGE_README_IMPORTS.includes(pkg) ||
              pkg.startsWith("node:");
            expect(
              isValid,
              `${readmeName}: Unknown import "${pkg}" in code block`
            ).toBe(true);
          }
        }
      }
    });
  }
});
