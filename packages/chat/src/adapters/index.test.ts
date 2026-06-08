import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { CatalogAdapter, EnvVar } from "./index";
import {
  ADAPTER_NAMES,
  ADAPTERS,
  getAdapter,
  getSecretEnvVars,
  isAdapterSlug,
  listEnvVars,
} from "./index";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const ADAPTERS_JSON_PATH = join(REPO_ROOT, "apps/docs/adapters.json");

const OFFICIAL_ENV_PACKAGE_DIRS = [
  "adapter-discord",
  "adapter-gchat",
  "adapter-github",
  "adapter-linear",
  "adapter-messenger",
  "adapter-slack",
  "adapter-teams",
  "adapter-telegram",
  "adapter-twilio",
  "adapter-web",
  "adapter-whatsapp",
  "state-ioredis",
  "state-memory",
  "state-pg",
  "state-redis",
] as const;

const IGNORED_RUNTIME_ENV_KEYS = new Set([
  "AWS_EXECUTION_ENV",
  "AWS_LAMBDA_FUNCTION_NAME",
  "FUNCTIONS_WORKER_RUNTIME",
  "K_SERVICE",
  "NETLIFY",
  "NODE_ENV",
  "VERCEL",
]);

const PROCESS_ENV_PATTERN =
  /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g;
const RESOLVE_TWILIO_CREDENTIAL_PATTERN =
  /resolveTwilioCredential\([\s\S]*?["']([A-Z][A-Z0-9_]*)["']\s*\)/g;
const BLOCK_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_PATTERN = /(^|[^:])\/\/.*$/gm;
const OFFICIAL_PEER_DEP_EXCLUSIONS = new Set(["chat", "@chat-adapter/shared"]);

interface RegistryEntry {
  community?: boolean;
  description: string;
  name: string;
  packageName: string;
  slug: string;
  type: "platform" | "state";
  vendorOfficial?: boolean;
}

const registry = JSON.parse(
  readFileSync(ADAPTERS_JSON_PATH, "utf-8")
) as RegistryEntry[];

const catalogRegistryEntries = registry.filter(
  (entry) => !entry.community || entry.vendorOfficial
);

const allEnvNames = (vars: readonly EnvVar[]): Set<string> => {
  const names = new Set<string>();
  for (const envVar of vars) {
    names.add(envVar.key);
    for (const alias of envVar.aliases ?? []) {
      names.add(alias);
    }
  }
  return names;
};

const stripComments = (source: string): string =>
  source.replace(BLOCK_COMMENT_PATTERN, "").replace(LINE_COMMENT_PATTERN, "$1");

const sourceFiles = (dir: string): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
};

const sourceEnvKeys = (packageDir: string): string[] => {
  const srcDir = join(PACKAGES_DIR, packageDir, "src");
  if (!existsSync(srcDir)) {
    return [];
  }
  const keys = new Set<string>();
  for (const filePath of sourceFiles(srcDir)) {
    if (filePath.endsWith(".test.ts")) {
      continue;
    }
    const source = stripComments(readFileSync(filePath, "utf-8"));
    for (const match of source.matchAll(PROCESS_ENV_PATTERN)) {
      const key = match[1] ?? match[2];
      if (key && !IGNORED_RUNTIME_ENV_KEYS.has(key)) {
        keys.add(key);
      }
    }
    for (const match of source.matchAll(RESOLVE_TWILIO_CREDENTIAL_PATTERN)) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
};

const packageDependencies = (packageDir: string): Record<string, string> => {
  const packageJson = JSON.parse(
    readFileSync(join(PACKAGES_DIR, packageDir, "package.json"), "utf-8")
  ) as { dependencies?: Record<string, string> };
  return packageJson.dependencies ?? {};
};

const packageDirToSlug = (dirName: string): string => {
  if (dirName === "adapter-gchat") {
    return "google-chat";
  }
  if (dirName === "state-pg") {
    return "postgres";
  }
  if (dirName.startsWith("adapter-")) {
    return dirName.slice("adapter-".length);
  }
  return dirName.slice("state-".length);
};

describe("adapters catalog", () => {
  test("each entry slug matches its key", () => {
    for (const [key, adapter] of Object.entries(ADAPTERS)) {
      expect(adapter.slug).toBe(key);
    }
  });

  test("ADAPTER_NAMES is sorted and complete", () => {
    expect([...ADAPTER_NAMES]).toEqual(Object.keys(ADAPTERS).sort());
  });

  test("catalog slugs match official and vendor-official registry entries", () => {
    expect([...ADAPTER_NAMES]).toEqual(
      catalogRegistryEntries.map((entry) => entry.slug).sort()
    );
  });

  test("catalog metadata matches adapters.json", () => {
    for (const adapter of Object.values(ADAPTERS)) {
      const entry = registry.find(
        (candidate) => candidate.slug === adapter.slug
      );
      expect(
        entry,
        `${adapter.slug}: missing adapters.json entry`
      ).toBeDefined();
      expect(adapter.name).toBe(entry?.name);
      expect(adapter.description).toBe(entry?.description);
      expect(adapter.packageName).toBe(entry?.packageName);
      expect(adapter.type).toBe(entry?.type);
      expect(adapter.group).toBe(
        entry?.vendorOfficial ? "vendor-official" : "official"
      );
    }
  });

  test("official source process.env keys are declared", () => {
    for (const packageDir of OFFICIAL_ENV_PACKAGE_DIRS) {
      const slug = packageDirToSlug(packageDir);
      const declared = allEnvNames(listEnvVars(slug));
      for (const key of sourceEnvKeys(packageDir)) {
        expect(
          declared.has(key),
          `${slug}: expected ${key} from ${packageDir} source in env spec`
        ).toBe(true);
      }
    }
  });

  test("official catalog env keys are backed by source reads", () => {
    for (const packageDir of OFFICIAL_ENV_PACKAGE_DIRS) {
      const slug = packageDirToSlug(packageDir);
      const sourceKeys = new Set(sourceEnvKeys(packageDir));
      for (const key of allEnvNames(listEnvVars(slug))) {
        expect(
          sourceKeys.has(key),
          `${slug}: declared ${key} in env spec but did not find a source read`
        ).toBe(true);
      }
    }
  });

  test("official peer deps match package dependencies that consumers install", () => {
    for (const packageDir of OFFICIAL_ENV_PACKAGE_DIRS) {
      const slug = packageDirToSlug(packageDir);
      const adapter = getAdapter(slug);
      expect(adapter, `${slug}: missing catalog entry`).toBeDefined();

      const expectedPeerDeps = Object.entries(packageDependencies(packageDir))
        .filter(([name, version]) => {
          if (version === "workspace:*") {
            return false;
          }
          return !OFFICIAL_PEER_DEP_EXCLUSIONS.has(name);
        })
        .map(([name]) => name)
        .sort();

      expect(
        [...(adapter?.peerDeps ?? [])].sort(),
        `${slug}: peerDeps should match non-workspace runtime dependencies`
      ).toEqual(expectedPeerDeps);
    }
  });
});

describe("getAdapter", () => {
  test("returns the entry for a known slug", () => {
    const slack: CatalogAdapter = getAdapter("slack");
    expect(slack.slug).toBe("slack");
  });

  test("returns undefined for an unknown slug", () => {
    expect(getAdapter("not-real")).toBeUndefined();
  });
});

describe("isAdapterSlug", () => {
  test("narrows known slugs", () => {
    expect(isAdapterSlug("slack")).toBe(true);
    expect(isAdapterSlug("not-real")).toBe(false);
  });
});

describe("listEnvVars", () => {
  test("returns an empty array for unknown slugs", () => {
    expect(listEnvVars("not-real")).toEqual([]);
  });

  test("flattens and de-duplicates credential mode vars", () => {
    const signingSecrets = listEnvVars("slack").filter(
      (envVar) => envVar.key === "SLACK_SIGNING_SECRET"
    );
    expect(signingSecrets).toHaveLength(1);
  });

  test("includes aliases", () => {
    const postgresNames = allEnvNames(listEnvVars("postgres"));
    expect(postgresNames.has("POSTGRES_URL")).toBe(true);
    expect(postgresNames.has("DATABASE_URL")).toBe(true);
  });
});

describe("getSecretEnvVars", () => {
  test("returns only secret vars", () => {
    const secrets = getSecretEnvVars("linear");
    expect(secrets.length).toBeGreaterThan(0);
    expect(secrets.every((envVar) => envVar.secret)).toBe(true);
  });

  test("returns an empty array when the adapter has no secrets", () => {
    expect(getSecretEnvVars("memory")).toEqual([]);
  });
});
