import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export const IMPORT_PACKAGE_REGEX = /from ["']([^"']+)["']/;
export const REPO_ROOT = join(import.meta.dirname, "../../..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
export const DOCS_CONTENT_DIR = join(REPO_ROOT, "apps/docs/content");
export const CHAT_SDK_HOMEPAGE = "https://chat-sdk.dev";
export const CHAT_SDK_GUIDES_URL = "https://vercel.com/kb/chat-sdk";

export interface PublishedPackage {
  dirName: string;
  name: string;
  packageJsonPath: string;
  readmePath?: string;
}

export const SHARED_STATE_ADAPTER_KEYWORDS = [
  "chat-sdk",
  "state",
  "state-adapter",
  "cache",
  "typescript",
  "vercel",
] as const;

export const PRODUCTION_STATE_ADAPTER_KEYWORDS = ["queues"] as const;

export const getOfficialPlatformAdapterSlug = (
  dirName: string
): string | undefined => {
  if (!dirName.startsWith("adapter-") || dirName === "adapter-shared") {
    return undefined;
  }

  return dirName === "adapter-gchat"
    ? "google-chat"
    : dirName.slice("adapter-".length);
};

export const getOfficialPlatformOgImageUrl = (slug: string): string =>
  `${CHAT_SDK_HOMEPAGE}/en/adapters/official/${slug}/og`;

export const getExpectedHomepage = (dirName: string, name: string): string => {
  if (name === "chat") {
    return `${CHAT_SDK_HOMEPAGE}/docs`;
  }
  if (name === "@chat-adapter/tests") {
    return `${CHAT_SDK_HOMEPAGE}/docs/testing`;
  }
  if (name === "@chat-adapter/shared") {
    return `${CHAT_SDK_HOMEPAGE}/docs/contributing/building`;
  }
  if (dirName.startsWith("state-")) {
    const slug =
      dirName === "state-pg" ? "postgres" : dirName.slice("state-".length);
    return `${CHAT_SDK_HOMEPAGE}/adapters/official/${slug}`;
  }
  if (dirName.startsWith("adapter-")) {
    const slug = getOfficialPlatformAdapterSlug(dirName);
    if (!slug) {
      throw new Error(
        `No homepage convention for package "${name}" (${dirName})`
      );
    }
    return `${CHAT_SDK_HOMEPAGE}/adapters/official/${slug}`;
  }
  throw new Error(`No homepage convention for package "${name}" (${dirName})`);
};

export const findPublishedPackages = (): PublishedPackage[] => {
  const packages: PublishedPackage[] = [];

  for (const dirName of readdirSync(PACKAGES_DIR)) {
    const packageJsonPath = join(PACKAGES_DIR, dirName, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      name: string;
      private?: boolean;
    };
    if (pkg.private) {
      continue;
    }

    const readmePath = join(PACKAGES_DIR, dirName, "README.md");
    packages.push({
      dirName,
      name: pkg.name,
      packageJsonPath,
      readmePath: existsSync(readmePath) ? readmePath : undefined,
    });
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name));
};

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
  "@chat-adapter/twilio",
  "@chat-adapter/messenger",
  "@chat-adapter/web",
  "@chat-adapter/web/react",
  "@chat-adapter/state-redis",
  "@chat-adapter/state-ioredis",
  "@chat-adapter/state-pg",
  "@chat-adapter/state-memory",
  "@chat-adapter/tests",
  "@chat-adapter/tests/matchers",
  "@chat-adapter/tests/setup",
  "vitest/config",
  "@ai-sdk/react",
  "ai",
  "react",
  "next/server",
  "redis",
  "ioredis",
  "pg",
  "postgres",
];

export const VALID_DOC_PACKAGES = [
  "chat",
  "chat/ai",
  "chat/adapters",
  "@chat-adapter/slack",
  "@chat-adapter/slack/api",
  "@chat-adapter/slack/blocks",
  "@chat-adapter/slack/format",
  "@chat-adapter/slack/webhook",
  "@chat-adapter/teams",
  "@chat-adapter/gchat",
  "@chat-adapter/discord",
  "@chat-adapter/telegram",
  "@chat-adapter/github",
  "@chat-adapter/linear",
  "@chat-adapter/whatsapp",
  "@chat-adapter/twilio",
  "@chat-adapter/twilio/api",
  "@chat-adapter/twilio/format",
  "@chat-adapter/twilio/voice",
  "@chat-adapter/twilio/webhook",
  "@chat-adapter/messenger",
  "@chat-adapter/web",
  "@chat-adapter/web/react",
  "@chat-adapter/state-redis",
  "@chat-adapter/state-ioredis",
  "@chat-adapter/state-pg",
  "@chat-adapter/state-memory",
  "@chat-adapter/shared",
  "@chat-adapter/tests",
  "@chat-adapter/tests/matchers",
  "@chat-adapter/tests/setup",
  "vitest/config",
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
  // Vendor-official + community adapters with hand-authored MDX
  "chat-adapter-matrix",
  "@beeper/chat-adapter-matrix",
  "chat-adapter-imessage",
  "@liveblocks/chat-sdk-adapter",
  "@resend/chat-sdk-adapter",
  "@veltdev/chat-sdk-adapter",
  "@zernio/chat-sdk-adapter",
  "@agentphone/chat-sdk-adapter",
  "@kapso/chat-adapter",
  "chat-adapter-baileys",
  "baileys",
  "chat-adapter-blooio",
  "chat-state-cloudflare-do",
  "chat-adapter-mattermost",
  "chat-state-mysql",
  "mysql2/promise",
  "chat-adapter-sendblue",
  "@bitbasti/chat-adapter-webex",
  "chat-adapter-zalo",
  "@larksuite/vercel-chat-adapter",
  "qrcode-terminal",
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
        "@chat-adapter/messenger": [
          join(import.meta.dirname, "../../adapter-messenger/src/index.ts"),
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
