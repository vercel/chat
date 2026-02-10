/**
 * Tests that code examples in README.md files are valid TypeScript.
 *
 * This ensures documentation stays in sync with the actual API.
 *
 * - Main README: Full type-checking (examples should be complete)
 * - Package READMEs: Syntax-only checking (examples are intentionally minimal)
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "../../..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/**
 * Extract TypeScript code blocks from markdown content.
 */
function extractTypeScriptBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:typescript|ts)\n([\s\S]*?)```/g;
  let match = regex.exec(markdown);

  while (match !== null) {
    blocks.push(match[1].trim());
    match = regex.exec(markdown);
  }

  return blocks;
}

/**
 * Create a temporary directory with proper tsconfig and package setup
 * to type-check the code blocks.
 */
function createTempProject(codeBlocks: string[]): string {
  const tempDir = mkdtempSync(join(tmpdir(), "readme-test-"));

  // Create tsconfig.json that references the repo's packages
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      // Use typeRoots to find @types/node from the repo
      typeRoots: [join(REPO_ROOT, "node_modules/@types")],
      paths: {
        chat: [join(__dirname, "../../chat/src/index.ts")],
        "@chat-adapter/slack": [
          join(__dirname, "../../adapter-slack/src/index.ts"),
        ],
        "@chat-adapter/teams": [
          join(__dirname, "../../adapter-teams/src/index.ts"),
        ],
        "@chat-adapter/gchat": [
          join(__dirname, "../../adapter-gchat/src/index.ts"),
        ],
        "@chat-adapter/discord": [
          join(__dirname, "../../adapter-discord/src/index.ts"),
        ],
        "@chat-adapter/github": [
          join(__dirname, "../../adapter-github/src/index.ts"),
        ],
        "@chat-adapter/linear": [
          join(__dirname, "../../adapter-linear/src/index.ts"),
        ],
        "@chat-adapter/state-redis": [
          join(__dirname, "../../state-redis/src/index.ts"),
        ],
        "@chat-adapter/state-ioredis": [
          join(__dirname, "../../state-ioredis/src/index.ts"),
        ],
        "@chat-adapter/state-memory": [
          join(__dirname, "../../state-memory/src/index.ts"),
        ],
        "@/lib/bot": [join(tempDir, "bot.ts")],
        "next/server": [join(tempDir, "next-server.d.ts")],
      },
    },
    include: [join(tempDir, "*.ts")],
  };

  writeFileSync(
    join(tempDir, "tsconfig.json"),
    JSON.stringify(tsconfig, null, 2),
  );

  // Create stub for next/server since it's not installed
  writeFileSync(
    join(tempDir, "next-server.d.ts"),
    `
export function after(fn: () => unknown): void;
  `,
  );

  // Ephemeral declarations to inject into code blocks that need them
  const ephemeralDeclarations = `
declare const bot: import("chat").Chat;
declare const thread: import("chat").Thread;
declare const user: import("chat").Author;
declare const agent: {
  stream(opts: { prompt: unknown }): Promise<{ textStream: AsyncIterable<string> }>;
};
export {};
`;

  // Write each code block as a separate file
  codeBlocks.forEach((code, index) => {
    let filename: string;
    let processedCode = code;

    if (code.includes("export const bot = new Chat")) {
      filename = "bot.ts";
    } else if (code.includes("export async function POST")) {
      filename = "route.ts";
      processedCode = code.replace("@/lib/bot", "./bot");
    } else {
      filename = `block-${index}.ts`;
      // Inject ephemeral declarations for blocks that:
      // - Import from "chat" but don't define their own bot/thread
      // - Or use thread/user variables without imports (e.g., snippet examples)
      const needsDeclarations =
        (code.includes('from "chat"') &&
          !code.includes("export const bot") &&
          !code.includes("const bot = new Chat")) ||
        (code.includes("thread.") && !code.includes('from "chat"'));
      if (needsDeclarations) {
        processedCode = ephemeralDeclarations + code;
      }
    }

    writeFileSync(join(tempDir, filename), processedCode);
  });

  return tempDir;
}

/**
 * Find all README.md files in packages directory.
 */
function findPackageReadmes(): Array<{ path: string; name: string }> {
  const readmes: Array<{ path: string; name: string }> = [];

  const packages = readdirSync(PACKAGES_DIR);
  for (const pkg of packages) {
    const readmePath = join(PACKAGES_DIR, pkg, "README.md");
    if (existsSync(readmePath)) {
      readmes.push({
        path: readmePath,
        name: `packages/${pkg}/README.md`,
      });
    }
  }

  return readmes;
}

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
      rmSync(tempDir, { recursive: true, force: true });

      expect.fail(
        `README.md TypeScript code blocks failed type-checking:\n\n${output}\n\n` +
          `Code blocks tested:\n${codeBlocks
            .map((b, i) => `--- Block ${i} ---\n${b}`)
            .join("\n\n")}`,
      );
    }

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should have at least a bot definition and route handler", () => {
    const readme = readFileSync(mainReadmePath, "utf-8");
    const codeBlocks = extractTypeScriptBlocks(readme);

    const hasBotDefinition = codeBlocks.some(
      (block) => block.includes("new Chat") && block.includes("adapters:"),
    );
    const hasRouteHandler = codeBlocks.some((block) =>
      block.includes("export async function POST"),
    );

    expect(
      hasBotDefinition,
      "README should have a Chat instantiation example",
    ).toBe(true);
    expect(hasRouteHandler, "README should have a POST handler example").toBe(
      true,
    );
  });
});

describe("Package README code examples", () => {
  const packageReadmes = findPackageReadmes();

  for (const { path: readmePath, name: readmeName } of packageReadmes) {
    const pkgName = basename(readmePath.replace("/README.md", ""));

    it(`${pkgName} README should have TypeScript examples with valid syntax`, () => {
      const readme = readFileSync(readmePath, "utf-8");
      const codeBlocks = extractTypeScriptBlocks(readme);

      // Skip READMEs without TypeScript blocks (e.g., integration-tests)
      if (codeBlocks.length === 0) {
        return;
      }

      // Verify each block has valid TypeScript syntax (not full type-checking)
      // by checking for common syntax errors
      for (const block of codeBlocks) {
        // Check for obviously broken syntax
        const openBraces = (block.match(/{/g) || []).length;
        const closeBraces = (block.match(/}/g) || []).length;
        const openParens = (block.match(/\(/g) || []).length;
        const closeParens = (block.match(/\)/g) || []).length;

        expect(
          openBraces,
          `${readmeName}: Mismatched braces in code block`,
        ).toBe(closeBraces);
        expect(
          openParens,
          `${readmeName}: Mismatched parentheses in code block`,
        ).toBe(closeParens);

        // Check that imports reference valid packages
        const importMatches = block.match(/from ["']([^"']+)["']/g) || [];
        for (const importMatch of importMatches) {
          const pkg = importMatch.match(/from ["']([^"']+)["']/)?.[1];
          if (pkg && !pkg.startsWith(".") && !pkg.startsWith("@/")) {
            // Known valid packages
            const validPackages = [
              "chat",
              "@chat-adapter/slack",
              "@chat-adapter/teams",
              "@chat-adapter/gchat",
              "@chat-adapter/discord",
              "@chat-adapter/github",
              "@chat-adapter/linear",
              "@chat-adapter/state-redis",
              "@chat-adapter/state-ioredis",
              "@chat-adapter/state-memory",
              "next/server",
              "redis",
              "ioredis",
            ];
            const isValid =
              validPackages.includes(pkg) || pkg.startsWith("node:");
            expect(
              isValid,
              `${readmeName}: Unknown import "${pkg}" in code block`,
            ).toBe(true);
          }
        }
      }
    });
  }
});
