/**
 * Tests that code examples in README.md and docs MDX files are valid TypeScript.
 *
 * This ensures documentation stays in sync with the actual API.
 *
 * - Main README: Full type-checking (examples should be complete)
 * - Package READMEs: Syntax-only checking (examples are intentionally minimal)
 * - Docs MDX files: Syntax-only checking (examples reference external packages)
 */

import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const IMPORT_PACKAGE_REGEX = /from ["']([^"']+)["']/;
const REPO_ROOT = join(import.meta.dirname, "../../..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const DOCS_CONTENT_DIR = join(REPO_ROOT, "apps/docs/content");
const ADAPTERS_JSON_PATH = join(REPO_ROOT, "apps/docs/adapters.json");
const CHAT_SKILL_PATH = join(REPO_ROOT, "skills/chat/SKILL.md");
const ROOT_PACKAGE_JSON = readJsonFile<{ packageManager?: string }>(
  join(REPO_ROOT, "package.json")
);
const PNPM_VERSION = ROOT_PACKAGE_JSON.packageManager?.startsWith("pnpm@")
  ? ROOT_PACKAGE_JSON.packageManager.slice("pnpm@".length)
  : null;
const DIRECT_PNPM_CLI_PATH = PNPM_VERSION
  ? join(
      homedir(),
      ".cache/node/corepack/v1/pnpm",
      PNPM_VERSION,
      "bin/pnpm.cjs"
    )
  : null;
const PACK_DEST_ROOT = mkdtempSync(join(tmpdir(), "pnpm-pack-check-"));

interface AdapterCatalogEntry {
  name: string;
  type: "platform" | "state";
  packageName?: string;
  community?: boolean;
  comingSoon?: boolean;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function loadPackageDirsByName(): Map<string, string> {
  const packageDirs = new Map<string, string>();

  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = join(PACKAGES_DIR, entry.name, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = readJsonFile<{ name?: string }>(packageJsonPath);
    if (packageJson.name) {
      packageDirs.set(packageJson.name, join(PACKAGES_DIR, entry.name));
    }
  }

  return packageDirs;
}

function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const headingLine = `### ${heading}`;
  const startIndex = lines.findIndex((line) => line.trim() === headingLine);

  expect(startIndex, `Missing section "${heading}" in SKILL.md`).not.toBe(-1);

  const sectionLines: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("### ") || line.startsWith("## ")) {
      break;
    }
    sectionLines.push(line);
  }

  return sectionLines.join("\n").trim();
}

function extractMarkdownTableRows(section: string): string[][] {
  const tableLines = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));

  if (tableLines.length < 3) {
    return [];
  }

  return tableLines.slice(2).map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ""))
  );
}

function extractBulletItems(section: string): string[] {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim().replace(/^`|`$/g, ""));
}

function extractPublishedPaths(markdown: string): string[] {
  const paths = new Set<string>();

  for (const match of markdown.matchAll(/`(node_modules\/[^`\n]+)`/g)) {
    paths.add(match[1]);
  }

  for (const match of markdown.matchAll(/^node_modules\/[^\s#]+/gm)) {
    paths.add(match[0]);
  }

  return [...paths].sort();
}

function parsePublishedPath(publishedPath: string): {
  packageName: string;
  relativePath: string;
} | null {
  const normalizedPath = publishedPath.endsWith("/")
    ? publishedPath.slice(0, -1)
    : publishedPath;
  const parts = normalizedPath.split("/");

  if (parts[0] !== "node_modules") {
    return null;
  }

  if (parts[1]?.startsWith("@")) {
    if (!parts[2]) {
      return null;
    }

    return {
      packageName: `${parts[1]}/${parts[2]}`,
      relativePath: parts.slice(3).join("/"),
    };
  }

  if (!parts[1]) {
    return null;
  }

  return {
    packageName: parts[1],
    relativePath: parts.slice(2).join("/"),
  };
}

function runPnpmCommand(args: string[], cwd: string): string {
  try {
    return execFileSync("pnpm", args, {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch (error) {
    if (!DIRECT_PNPM_CLI_PATH || !existsSync(DIRECT_PNPM_CLI_PATH)) {
      throw error;
    }

    return execFileSync(process.execPath, [DIRECT_PNPM_CLI_PATH, ...args], {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    });
  }
}

const PACKED_TARBALL_ENTRIES = new Map<string, string[]>();

function getPackedTarballEntries(
  packageName: string,
  packageDirsByName: Map<string, string>
): string[] {
  const cached = PACKED_TARBALL_ENTRIES.get(packageName);
  if (cached) {
    return cached;
  }

  const packageDir = packageDirsByName.get(packageName);
  expect(packageDir, `Missing local package for ${packageName}`).toBeDefined();

  const packDestDir = mkdtempSync(
    join(PACK_DEST_ROOT, `${packageName.replace(/[@/]/g, "-")}-`)
  );
  runPnpmCommand(["pack", "--pack-destination", packDestDir], packageDir!);

  const tarballs = readdirSync(packDestDir).filter((file) => file.endsWith(".tgz"));
  expect(tarballs, `Expected one tarball for ${packageName}`).toHaveLength(1);

  const tarballPath = join(packDestDir, tarballs[0]);
  const entries = execFileSync("tar", ["-tf", tarballPath], {
    encoding: "utf-8",
    stdio: "pipe",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  PACKED_TARBALL_ENTRIES.set(packageName, entries);
  return entries;
}

function extractFactoryName(
  packageName: string,
  packageDirsByName: Map<string, string>
): string {
  const packageDir = packageDirsByName.get(packageName);
  expect(packageDir, `Missing local package for ${packageName}`).toBeDefined();

  const sourcePath = join(packageDir!, "src/index.ts");
  expect(
    existsSync(sourcePath),
    `Expected ${packageName} to have ${relative(REPO_ROOT, sourcePath)}`
  ).toBe(true);

  const source = readFileSync(sourcePath, "utf-8");
  const factoryNames = [
    ...new Set(
      [...source.matchAll(/export function (create[A-Za-z0-9_]+)\(/g)].map(
        (match) => match[1]
      )
    ),
  ];

  expect(
    factoryNames.length,
    `${packageName} should export exactly one create* factory`
  ).toBe(1);

  return factoryNames[0];
}

const PACKAGE_DIRS_BY_NAME = loadPackageDirsByName();
const ADAPTER_CATALOG = readJsonFile<AdapterCatalogEntry[]>(ADAPTERS_JSON_PATH);

process.on("exit", () => {
  rmSync(PACK_DEST_ROOT, { recursive: true, force: true });
});

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
function findDocsMdxFiles(dir: string): Array<{ path: string; name: string }> {
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

describe("skills/chat/SKILL.md", () => {
  const skill = readFileSync(CHAT_SKILL_PATH, "utf-8");

  it("should only reference published-source paths", () => {
    const monorepoOnlyMarkers = [
      "packages/",
      "apps/docs/",
      "examples/nextjs-chat/",
      ".changeset/",
      ".github/",
    ];

    for (const marker of monorepoOnlyMarkers) {
      expect(
        skill.includes(marker),
        `SKILL.md should not reference monorepo-only path "${marker}"`
      ).toBe(false);
    }
  });

  it("should reference published paths that exist", () => {
    const publishedPaths = extractPublishedPaths(skill);

    expect(publishedPaths.length).toBeGreaterThan(0);

    for (const publishedPath of publishedPaths) {
      const parsedPath = parsePublishedPath(publishedPath);
      expect(
        parsedPath,
        `Could not parse published path "${publishedPath}"`
      ).not.toBeNull();

      const packedEntries = getPackedTarballEntries(
        parsedPath!.packageName,
        PACKAGE_DIRS_BY_NAME
      );
      const tarballRelativePath = parsedPath!.relativePath
        ? `package/${parsedPath!.relativePath}`
        : "package";
      const existsInTarball = parsedPath!.relativePath
        ? packedEntries.includes(tarballRelativePath) ||
          packedEntries.some((entry) => entry.startsWith(`${tarballRelativePath}/`))
        : packedEntries.some((entry) => entry.startsWith("package/"));

      expect(
        existsInTarball,
        `Published path "${publishedPath}" should exist in the packed tarball for ${parsedPath!.packageName}`
      ).toBe(true);
    }
  });

  it("should pack adapter and state packages with dist entrypoints", () => {
    const officialPackageNames = ADAPTER_CATALOG.filter(
      (entry) => !entry.community && !entry.comingSoon && entry.packageName
    ).map((entry) => entry.packageName!);

    for (const packageName of [
      ...officialPackageNames,
      "@chat-adapter/shared",
    ]) {
      const packedEntries = getPackedTarballEntries(
        packageName,
        PACKAGE_DIRS_BY_NAME
      );

      expect(
        packedEntries.includes("package/dist/index.d.ts"),
        `${packageName} tarball should include package/dist/index.d.ts`
      ).toBe(true);
    }
  });

  it("should list all official platform adapters with correct factories", () => {
    const section = extractSection(skill, "Official platform adapters");
    const actualRows = extractMarkdownTableRows(section).map(
      ([name, packageName, factory]) => ({
        name,
        packageName,
        factory,
      })
    );

    const expectedRows = ADAPTER_CATALOG.filter(
      (entry) =>
        entry.type === "platform" &&
        !entry.community &&
        !entry.comingSoon &&
        entry.packageName
    ).map((entry) => ({
      name: entry.name,
      packageName: entry.packageName!,
      factory: extractFactoryName(entry.packageName!, PACKAGE_DIRS_BY_NAME),
    }));

    expect(actualRows).toEqual(expectedRows);
  });

  it("should list all official state adapters with correct factories", () => {
    const section = extractSection(skill, "Official state adapters");
    const actualRows = extractMarkdownTableRows(section).map(
      ([name, packageName, factory]) => ({
        name,
        packageName,
        factory,
      })
    );

    const expectedRows = ADAPTER_CATALOG.filter(
      (entry) =>
        entry.type === "state" &&
        !entry.community &&
        !entry.comingSoon &&
        entry.packageName
    ).map((entry) => ({
      name: entry.name,
      packageName: entry.packageName!,
      factory: extractFactoryName(entry.packageName!, PACKAGE_DIRS_BY_NAME),
    }));

    expect(actualRows).toEqual(expectedRows);
  });

  it("should list all community adapters", () => {
    const section = extractSection(skill, "Community adapters");
    const actualItems = extractBulletItems(section);
    const expectedItems = ADAPTER_CATALOG.filter(
      (entry) => entry.community && entry.packageName
    ).map((entry) => entry.packageName!);

    expect(actualItems).toEqual(expectedItems);
  });

  it("should list all coming-soon platform entries", () => {
    const section = extractSection(skill, "Coming-soon platform entries");
    const actualItems = extractBulletItems(section);
    const expectedItems = ADAPTER_CATALOG.filter(
      (entry) => entry.type === "platform" && entry.comingSoon
    ).map((entry) => entry.name);

    expect(actualItems).toEqual(expectedItems);
  });
});
