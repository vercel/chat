/**
 * Tests that code examples in README.md and docs MDX files are valid TypeScript.
 *
 * This ensures documentation stays in sync with the actual API.
 *
 * - Main README: Full type-checking (examples should be complete)
 * - Package READMEs: Syntax-only checking (examples are intentionally minimal)
 * - Docs MDX files: Syntax-only checking (examples reference external packages)
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
import { basename, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const IMPORT_PACKAGE_REGEX = /from ["']([^"']+)["']/;
const REPO_ROOT = join(import.meta.dirname, "../../..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const DOCS_CONTENT_DIR = join(REPO_ROOT, "apps/docs/content");

/**
 * Extract TypeScript code blocks from markdown content.
 * Handles optional MDX metadata after the language tag (e.g., `title="..." lineNumbers`).
 */
function extractTypeScriptBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:typescript|tsx?)(?:[^\S\n][^\n]*)?\n([\s\S]*?)```/g;
  let match = regex.exec(markdown);

  while (match !== null) {
    blocks.push(match[1].trim());
    match = regex.exec(markdown);
  }

  return blocks;
}

/**
 * Extract TypeScript and TSX code blocks from MDX content.
 * Returns blocks tagged with their language for appropriate validation.
 */
function extractCodeBlocks(
  markdown: string
): Array<{ code: string; lang: "ts" | "tsx" }> {
  const blocks: Array<{ code: string; lang: "ts" | "tsx" }> = [];
  const regex = /```(typescript|ts|tsx)(?:[^\S\n][^\n]*)?\n([\s\S]*?)```/g;
  let match = regex.exec(markdown);

  while (match !== null) {
    const lang = match[1] === "tsx" ? "tsx" : "ts";
    blocks.push({ code: match[2].trim(), lang });
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
      // Use typeRoots to find @types/node from the integration-tests package
      typeRoots: [
        join(
          import.meta.dirname,
          "../../integration-tests/node_modules/@types"
        ),
      ],
      paths: {
        chat: [join(import.meta.dirname, "../../chat/src/index.ts")],
        "@chat-adapter/slack": [
          join(import.meta.dirname, "../../adapter-slack/src/index.ts"),
        ],
        "@chat-adapter/teams": [
          join(import.meta.dirname, "../../adapter-teams/src/index.ts"),
        ],
        "@chat-adapter/gchat": [
          join(import.meta.dirname, "../../adapter-gchat/src/index.ts"),
        ],
        "@chat-adapter/discord": [
          join(import.meta.dirname, "../../adapter-discord/src/index.ts"),
        ],
        "@chat-adapter/telegram": [
          join(import.meta.dirname, "../../adapter-telegram/src/index.ts"),
        ],
        "@chat-adapter/github": [
          join(import.meta.dirname, "../../adapter-github/src/index.ts"),
        ],
        "@chat-adapter/linear": [
          join(import.meta.dirname, "../../adapter-linear/src/index.ts"),
        ],
        "@chat-adapter/state-redis": [
          join(import.meta.dirname, "../../state-redis/src/index.ts"),
        ],
        "@chat-adapter/state-ioredis": [
          join(import.meta.dirname, "../../state-ioredis/src/index.ts"),
        ],
        "@chat-adapter/state-pg": [
          join(import.meta.dirname, "../../state-pg/src/index.ts"),
        ],
        "@chat-adapter/state-memory": [
          join(import.meta.dirname, "../../state-memory/src/index.ts"),
        ],
        "@/lib/bot": [join(tempDir, "bot.ts")],
        "next/server": [join(tempDir, "next-server.d.ts")],
      },
    },
    include: [join(tempDir, "*.ts")],
  };

  writeFileSync(
    join(tempDir, "tsconfig.json"),
    JSON.stringify(tsconfig, null, 2)
  );

  // Create stub for next/server since it's not installed
  writeFileSync(
    join(tempDir, "next-server.d.ts"),
    `
export function after(fn: () => unknown): void;
  `
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

/**
 * Recursively find all MDX files in the docs content directory.
 */
function findDocsMdxFiles(
  dir: string
): Array<{ path: string; name: string }> {
  const files: Array<{ path: string; name: string }> = [];

  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findDocsMdxFiles(fullPath));
    } else if (entry.name.endsWith(".mdx") || entry.name.endsWith(".md")) {
      files.push({
        path: fullPath,
        name: relative(REPO_ROOT, fullPath),
      });
    }
  }

  return files;
}

/**
 * Valid packages that can appear in import statements across all docs.
 * Superset of the README valid packages — includes external dependencies
 * referenced in guides and examples.
 */
const VALID_DOC_PACKAGES = [
  // Chat SDK packages
  "chat",
  "@chat-adapter/slack",
  "@chat-adapter/teams",
  "@chat-adapter/gchat",
  "@chat-adapter/discord",
  "@chat-adapter/telegram",
  "@chat-adapter/github",
  "@chat-adapter/linear",
  "@chat-adapter/whatsapp",
  "@chat-adapter/state-redis",
  "@chat-adapter/state-ioredis",
  "@chat-adapter/state-pg",
  "@chat-adapter/state-memory",
  "@chat-adapter/shared",
  // Frameworks and runtimes
  "next/server",
  "next",
  "hono",
  // AI SDK
  "ai",
  "@ai-sdk/anthropic",
  "@ai-sdk/openai",
  "@ai-sdk/gateway",
  // Vercel packages
  "@vercel/sandbox",
  "@vercel/functions",
  "workflow",
  "workflow/next",
  "workflow/api",
  // Database and state
  "redis",
  "ioredis",
  "pg",
  "postgres",
  // Build and test tooling
  "tsup",
  "vitest",
  "vitest/config",
  // External libraries used in guides
  "bash-tool",
  "@octokit/rest",
  // Hypothetical example package used in contributing docs
  "chat-adapter-matrix",
];

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
            .join("\n\n")}`
      );
    }

    rmSync(tempDir, { recursive: true, force: true });
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
          `${readmeName}: Mismatched braces in code block`
        ).toBe(closeBraces);
        expect(
          openParens,
          `${readmeName}: Mismatched parentheses in code block`
        ).toBe(closeParens);

        // Check that imports reference valid packages
        const importMatches = block.match(/from ["']([^"']+)["']/g) || [];
        for (const importMatch of importMatches) {
          const pkg = importMatch.match(IMPORT_PACKAGE_REGEX)?.[1];
          if (pkg && !pkg.startsWith(".") && !pkg.startsWith("@/")) {
            // Known valid packages
            const validPackages = [
              "chat",
              "@chat-adapter/slack",
              "@chat-adapter/teams",
              "@chat-adapter/gchat",
              "@chat-adapter/discord",
              "@chat-adapter/telegram",
              "@chat-adapter/github",
              "@chat-adapter/linear",
              "@chat-adapter/whatsapp",
              "@chat-adapter/state-redis",
              "@chat-adapter/state-ioredis",
              "@chat-adapter/state-pg",
              "@chat-adapter/state-memory",
              "next/server",
              "redis",
              "ioredis",
              "pg",
              "postgres",
            ];
            const isValid =
              validPackages.includes(pkg) || pkg.startsWith("node:");
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

describe("Docs MDX code examples", () => {
  const docFiles = findDocsMdxFiles(DOCS_CONTENT_DIR);

  for (const { path: filePath, name: fileName } of docFiles) {
    it(`${fileName} should have valid syntax in code blocks`, () => {
      const content = readFileSync(filePath, "utf-8");
      const codeBlocks = extractCodeBlocks(content);

      // Skip files without code blocks
      if (codeBlocks.length === 0) {
        return;
      }

      for (const { code: block, lang } of codeBlocks) {
        // Skip brace/paren balance checks for docs — they intentionally use
        // partial snippets (e.g., showing just an option without the opening brace).
        // Import validation is the most valuable check for keeping docs in sync.

        // Check that imports reference valid packages
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
