import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

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

  return dirName.slice("adapter-".length);
};

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
  if (name === "create-chat-sdk") {
    return `${CHAT_SDK_HOMEPAGE}/docs/create-chat-sdk`;
  }
  if (name === "@chat-adapter/catalog") {
    return `${CHAT_SDK_HOMEPAGE}/docs/adapter-catalog`;
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
        "@chat-adapter/instagram": [
          join(import.meta.dirname, "../../adapter-instagram/src/index.ts"),
        ],
        "@chat-adapter/notion": [
          join(import.meta.dirname, "../../adapter-notion/src/index.ts"),
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
