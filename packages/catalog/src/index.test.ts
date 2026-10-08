import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { CatalogAdapter, EnvVar } from "./index";
import {
  ADAPTER_NAMES,
  ADAPTERS,
  COMMUNITY_ADAPTERS,
  getAdapter,
  getCatalogEntry,
  getFeatureCategories,
  getFeatureSupport,
  getSecretEnvVars,
  isAdapterSlug,
  listAdapters,
  listEnvVars,
  listPlatformAdapters,
  listStateAdapters,
  normalizeFeatureValue,
} from "./index";

const REPO_ROOT = join(import.meta.dirname, "../../..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

const OFFICIAL_ENV_PACKAGE_DIRS = [
  "adapter-discord",
  "adapter-gchat",
  "adapter-github",
  "adapter-gmail",
  "adapter-instagram",
  "adapter-linear",
  "adapter-messenger",
  "adapter-notion",
  "adapter-slack",
  "adapter-teams",
  "adapter-telegram",
  "adapter-twilio",
  "adapter-twitch",
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
const FACTORY_EXPORT_PATTERN = /^create\w+$/;
const BLOCK_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_PATTERN = /(^|[^:])\/\/.*$/gm;
const CHAT_ADAPTER_PACKAGE = /^@chat-adapter\//;
const REPO_README_PATTERN =
  /^https:\/\/github\.com\/vercel\/chat\/tree\/main\/packages\//;
const OFFICIAL_PEER_DEP_EXCLUSIONS = new Set(["chat", "@chat-adapter/shared"]);

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

  test("listPlatformAdapters returns only platform entries", () => {
    const platforms = listPlatformAdapters();
    expect(platforms.length).toBeGreaterThan(0);
    expect(platforms.every((adapter) => adapter.type === "platform")).toBe(
      true
    );
    expect(platforms.map((adapter) => adapter.slug)).toEqual(
      ADAPTER_NAMES.filter((slug) => ADAPTERS[slug].type === "platform")
    );
  });

  test("listStateAdapters returns only state entries", () => {
    const states = listStateAdapters();
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((adapter) => adapter.type === "state")).toBe(true);
    expect(states.map((adapter) => adapter.slug)).toEqual(
      ADAPTER_NAMES.filter((slug) => ADAPTERS[slug].type === "state")
    );
  });

  test("each entry declares a factory export", () => {
    for (const adapter of Object.values(ADAPTERS)) {
      expect(adapter.factoryExport, `${adapter.slug}: factoryExport`).toMatch(
        FACTORY_EXPORT_PATTERN
      );
    }
  });

  test("slugs are unique across official, vendor-official, and community", () => {
    const communitySlugs = Object.keys(COMMUNITY_ADAPTERS);
    for (const slug of communitySlugs) {
      expect(isAdapterSlug(slug), `${slug}: duplicated slug`).toBe(false);
    }
  });

  test("each community entry slug matches its key", () => {
    for (const [key, adapter] of Object.entries(COMMUNITY_ADAPTERS)) {
      expect(adapter.slug).toBe(key);
      expect(adapter.group).toBe("community");
    }
  });

  test("official adapters use @chat-adapter packages in this repo", () => {
    for (const adapter of Object.values(ADAPTERS)) {
      if (adapter.group !== "official") {
        continue;
      }
      expect(adapter.packageName).toMatch(CHAT_ADAPTER_PACKAGE);
      expect(adapter.readme).toMatch(REPO_README_PATTERN);
    }
  });

  test("vendor-official and community adapters declare an author", () => {
    for (const adapter of listAdapters({
      group: ["vendor-official", "community"],
    })) {
      expect(adapter.author, `${adapter.slug}: author`).toBeTruthy();
    }
  });

  test("features only use keys for the adapter type", () => {
    for (const adapter of listAdapters()) {
      const allowed = new Set(
        getFeatureCategories(adapter.type).flatMap((category) =>
          category.features.map((feature) => feature.key)
        )
      );
      for (const key of Object.keys(adapter.features)) {
        expect(
          allowed.has(key),
          `${adapter.slug}: unknown ${adapter.type} feature "${key}"`
        ).toBe(true);
      }
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

  test("official factory exports exist in package entry points", () => {
    for (const packageDir of OFFICIAL_ENV_PACKAGE_DIRS) {
      const slug = packageDirToSlug(packageDir);
      const adapter = getAdapter(slug);
      expect(adapter, `${slug}: missing catalog entry`).toBeDefined();

      const entrypoint = readFileSync(
        join(PACKAGES_DIR, packageDir, "src/index.ts"),
        "utf-8"
      );
      expect(
        entrypoint.includes(`export function ${adapter?.factoryExport}`),
        `${slug}: expected ${adapter?.factoryExport} export in ${packageDir}/src/index.ts`
      ).toBe(true);
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

describe("listAdapters", () => {
  test("returns every entry in listing order", () => {
    const slugs = listAdapters().map((adapter) => adapter.slug);
    expect(slugs).toEqual([
      ...Object.keys(ADAPTERS),
      ...Object.keys(COMMUNITY_ADAPTERS),
    ]);
    expect(slugs[0]).toBe("slack");
  });

  test("filters by group", () => {
    const community = listAdapters({ group: "community" });
    expect(community.length).toBe(Object.keys(COMMUNITY_ADAPTERS).length);
    expect(community.every((adapter) => adapter.group === "community")).toBe(
      true
    );
  });

  test("filters by several groups and type", () => {
    const states = listAdapters({
      group: ["official", "community"],
      type: "state",
    });
    expect(states.length).toBeGreaterThan(0);
    for (const adapter of states) {
      expect(adapter.type).toBe("state");
      expect(adapter.group).not.toBe("vendor-official");
    }
  });
});

describe("getCatalogEntry", () => {
  test("returns official and community entries", () => {
    expect(getCatalogEntry("slack")?.group).toBe("official");
    expect(getCatalogEntry("mattermost")?.group).toBe("community");
  });

  test("returns undefined for an unknown slug", () => {
    expect(getCatalogEntry("not-real")).toBeUndefined();
  });
});

describe("getFeatureSupport", () => {
  test("normalizes labeled support", () => {
    expect(getFeatureSupport("slack", "streaming")).toEqual({
      status: "yes",
      label: "Native",
    });
  });

  test("accepts a catalog entry", () => {
    expect(getFeatureSupport(getAdapter("slack"), "postMessage")).toEqual({
      status: "yes",
    });
  });

  test("treats undeclared features and unknown slugs as unsupported", () => {
    expect(getFeatureSupport("memory", "cluster")).toEqual({ status: "no" });
    expect(getFeatureSupport("not-real", "postMessage")).toEqual({
      status: "no",
    });
  });
});

describe("normalizeFeatureValue", () => {
  test("handles every authored shape", () => {
    expect(normalizeFeatureValue(undefined)).toEqual({ status: "no" });
    expect(normalizeFeatureValue("partial")).toEqual({ status: "partial" });
    expect(normalizeFeatureValue({ status: "yes", label: "TTL" })).toEqual({
      status: "yes",
      label: "TTL",
    });
  });
});

describe("listEnvVars for community adapters", () => {
  test("returns an empty array", () => {
    expect(listEnvVars("mattermost")).toEqual([]);
  });
});
