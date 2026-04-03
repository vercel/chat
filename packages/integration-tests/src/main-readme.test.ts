import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTempProject,
  extractTypeScriptBlocks,
  REPO_ROOT,
} from "./documentation-test-utils";

describe("Main README.md code examples", () => {
  const mainReadmePath = join(REPO_ROOT, "README.md");

  it("should contain valid TypeScript that type-checks", () => {
    const readme = readFileSync(mainReadmePath, "utf-8");
    const codeBlocks = extractTypeScriptBlocks(readme);
    expect(codeBlocks.length).toBeGreaterThan(0);

    const tempDir = createTempProject(codeBlocks);

    try {
      execSync(`pnpm exec tsc --project ${tempDir}/tsconfig.json --noEmit`, {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string };
      const output = execError.stdout || execError.stderr || String(error);

      expect.fail(
        `README.md TypeScript code blocks failed type-checking:\n\n${output}\n\n` +
          `Code blocks tested:\n${codeBlocks
            .map((block, index) => `--- Block ${index} ---\n${block}`)
            .join("\n\n")}`
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should have a bot definition example", () => {
    const readme = readFileSync(mainReadmePath, "utf-8");
    const codeBlocks = extractTypeScriptBlocks(readme);

    const hasBotDefinition = codeBlocks.some(
      (block) => block.includes("new Chat") && block.includes("adapters:")
    );

    expect(
      hasBotDefinition,
      "README should have a Chat instantiation example"
    ).toBe(true);
  });
});
