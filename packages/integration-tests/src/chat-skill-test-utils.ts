import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  ADAPTERS_JSON_PATH,
  CHAT_SKILL_PATH,
  PACKAGES_DIR,
  REPO_ROOT,
} from "./documentation-test-utils";

export interface AdapterCatalogEntry {
  comingSoon?: boolean;
  community?: boolean;
  name: string;
  packageName?: string;
  type: "platform" | "state";
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function invariant(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function hasPackageName(
  entry: AdapterCatalogEntry
): entry is AdapterCatalogEntry & { packageName: string } {
  return typeof entry.packageName === "string" && entry.packageName.length > 0;
}

export function isCommunityEntry(
  entry: AdapterCatalogEntry
): entry is AdapterCatalogEntry & { packageName: string } {
  return entry.community === true && hasPackageName(entry);
}

export function isOfficialPlatformEntry(
  entry: AdapterCatalogEntry
): entry is AdapterCatalogEntry & { packageName: string } {
  return (
    entry.type === "platform" &&
    !(entry.community || entry.comingSoon) &&
    hasPackageName(entry)
  );
}

export function isOfficialStateEntry(
  entry: AdapterCatalogEntry
): entry is AdapterCatalogEntry & { packageName: string } {
  return (
    entry.type === "state" &&
    !(entry.community || entry.comingSoon) &&
    hasPackageName(entry)
  );
}

export function isOfficialCatalogEntry(
  entry: AdapterCatalogEntry
): entry is AdapterCatalogEntry & { packageName: string } {
  return !(entry.community || entry.comingSoon) && hasPackageName(entry);
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
const PACKED_TARBALL_ENTRIES = new Map<string, string[]>();

const PACKAGE_DIRS_BY_NAME = loadPackageDirsByName();
export const ADAPTER_CATALOG =
  readJsonFile<AdapterCatalogEntry[]>(ADAPTERS_JSON_PATH);
export const CHAT_SKILL = readFileSync(CHAT_SKILL_PATH, "utf-8");

export function cleanupPackArtifacts(): void {
  rmSync(PACK_DEST_ROOT, { recursive: true, force: true });
}

export function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const headingLine = `### ${heading}`;
  const startIndex = lines.findIndex((line) => line.trim() === headingLine);

  invariant(startIndex !== -1, `Missing section "${heading}" in SKILL.md`);

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

export function extractMarkdownTableRows(section: string): string[][] {
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

export function extractBulletItems(section: string): string[] {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim().replace(/^`|`$/g, ""));
}

export function extractPublishedPaths(markdown: string): string[] {
  const paths = new Set<string>();

  for (const match of markdown.matchAll(/`(node_modules\/[^`\n]+)`/g)) {
    paths.add(match[1]);
  }

  for (const match of markdown.matchAll(/^node_modules\/[^\s#]+/gm)) {
    paths.add(match[0]);
  }

  return [...paths].sort();
}

export function parsePublishedPath(publishedPath: string): {
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
    if (!(DIRECT_PNPM_CLI_PATH && existsSync(DIRECT_PNPM_CLI_PATH))) {
      throw error;
    }

    return execFileSync(process.execPath, [DIRECT_PNPM_CLI_PATH, ...args], {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    });
  }
}

export function getPackedTarballEntries(packageName: string): string[] {
  const cached = PACKED_TARBALL_ENTRIES.get(packageName);
  if (cached) {
    return cached;
  }

  const packageDir = PACKAGE_DIRS_BY_NAME.get(packageName);
  invariant(packageDir, `Missing local package for ${packageName}`);

  const packDestDir = mkdtempSync(
    join(PACK_DEST_ROOT, `${packageName.replace(/[@/]/g, "-")}-`)
  );
  runPnpmCommand(["pack", "--pack-destination", packDestDir], packageDir);

  const tarballs = readdirSync(packDestDir).filter((file) =>
    file.endsWith(".tgz")
  );
  invariant(tarballs.length === 1, `Expected one tarball for ${packageName}`);

  const [tarball] = tarballs;
  invariant(tarball, `Expected one tarball for ${packageName}`);
  const tarballPath = join(packDestDir, tarball);
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

export function extractFactoryName(packageName: string): string {
  const packageDir = PACKAGE_DIRS_BY_NAME.get(packageName);
  invariant(packageDir, `Missing local package for ${packageName}`);

  const sourcePath = join(packageDir, "src/index.ts");
  invariant(
    existsSync(sourcePath),
    `Expected ${packageName} to have ${relative(REPO_ROOT, sourcePath)}`
  );

  const source = readFileSync(sourcePath, "utf-8");
  const factoryNames = [
    ...new Set(
      [...source.matchAll(/export function (create[A-Za-z0-9_]+)\(/g)].map(
        (match) => match[1]
      )
    ),
  ];

  invariant(
    factoryNames.length === 1,
    `${packageName} should export exactly one create* factory`
  );

  const [factoryName] = factoryNames;
  invariant(
    factoryName,
    `${packageName} should export exactly one create* factory`
  );

  return factoryName;
}
