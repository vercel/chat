import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DOCS_CONTENT_DIR,
  extractCodeBlocks,
  findDocsMdxFiles,
  IMPORT_PACKAGE_REGEX,
  VALID_DOC_PACKAGES,
} from "./documentation-test-utils";

describe("Docs MDX code examples", () => {
  const docFiles = findDocsMdxFiles(DOCS_CONTENT_DIR);

  for (const { path: filePath, name: fileName } of docFiles) {
    it(`${fileName} should have valid syntax in code blocks`, () => {
      const content = readFileSync(filePath, "utf-8");
      const codeBlocks = extractCodeBlocks(content);

      if (codeBlocks.length === 0) {
        return;
      }

      for (const { code: block, lang } of codeBlocks) {
        const importMatches = block.match(/from ["']([^"']+)["']/g) || [];
        for (const importMatch of importMatches) {
          const pkg = importMatch.match(IMPORT_PACKAGE_REGEX)?.[1];
          if (pkg && !pkg.startsWith(".") && !pkg.startsWith("@/")) {
            const isValid =
              VALID_DOC_PACKAGES.includes(pkg) || pkg.startsWith("node:");
            expect(
              isValid,
              `${fileName}: Unknown import "${pkg}" in ${lang} code block`
            ).toBe(true);
          }
        }
      }
    });
  }
});
