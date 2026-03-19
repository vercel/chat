import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export const IMPORT_PACKAGE_REGEX = /from ["']([^"']+)["']/;
export const REPO_ROOT = join(import.meta.dirname, "../../..");
export const PACKAGES_DIR = join(REPO_ROOT, "packages");
export const DOCS_CONTENT_DIR = join(REPO_ROOT, "apps/docs/content");
export const ADAPTERS_JSON_PATH = join(REPO_ROOT, "apps/docs/adapters.json");
export const CHAT_SKILL_PATH = join(REPO_ROOT, "skills/chat/SKILL.md");

export const VALID_PACKAGE_README_IMPORTS = [
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

export const VALID_DOC_PACKAGES = [
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
  "next/server",
  "next",
  "hono",
  "ai",
  "@ai-sdk/anthropic",
  "@ai-sdk/openai",
  "@ai-sdk/gateway",
  "@vercel/sandbox",
  "@vercel/functions",
  "workflow",
  "workflow/next",
  "workflow/api",
  "redis",
  "ioredis",
  "pg",
  "postgres",
  "tsup",
  "vitest",
  "vitest/config",
  "bash-tool",
  "@octokit/rest",
  "chat-adapter-matrix",
];

export function extractTypeScriptBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:typescript|tsx?)(?:[^\S\n][^\n]*)?\n([\s\S]*?)```/g;
  let match = regex.exec(markdown);

  while (match !== null) {
    blocks.push(match[1].trim());
    match = regex.exec(markdown);
  }

  return blocks;
}

export function extractCodeBlocks(
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

export function createTempProject(codeBlocks: string[]): string {
  const tempDir = mkdtempSync(join(tmpdir(), "readme-test-"));
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
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

  writeFileSync(
    join(tempDir, "next-server.d.ts"),
    `
export function after(fn: () => unknown): void;
  `
  );

  const ephemeralDeclarations = `
declare const bot: import("chat").Chat;
declare const thread: import("chat").Thread;
declare const user: import("chat").Author;
declare const agent: {
  stream(opts: { prompt: unknown }): Promise<{ textStream: AsyncIterable<string> }>;
};
export {};
`;

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

export function findPackageReadmes(): Array<{ path: string; name: string }> {
  const readmes: Array<{ path: string; name: string }> = [];

  for (const pkg of readdirSync(PACKAGES_DIR)) {
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

export function findDocsMdxFiles(
  dir: string
): Array<{ path: string; name: string }> {
  const files: Array<{ path: string; name: string }> = [];

  if (!existsSync(dir)) {
    return files;
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
