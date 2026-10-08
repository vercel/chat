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
  PLATFORM_FEATURE_CATEGORIES,
  STATE_FEATURE_CATEGORIES,
} from "./index";

const REPO_ROOT = join(import.meta.dirname, "../../..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

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
const JS_EXTENSION = /\.js$/;
const BLOCK_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_PATTERN = /(^|[^:])\/\/.*$/gm;
const CHAT_ADAPTER_PACKAGE = /^@chat-adapter\//;
const ADAPTER_OR_STATE_PACKAGE_DIR = /^(adapter|state)-/;
const NON_ADAPTER_PACKAGE_DIRS = new Set(["adapter-shared"]);
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

interface WorkspacePackage {
  dependencies: Record<string, string>;
  dir: string;
  exports: Record<string, { import?: string }>;
  name: string;
  peerDependencies: Record<string, string>;
}

const WORKSPACE_PACKAGES: readonly WorkspacePackage[] = readdirSync(
  PACKAGES_DIR
)
  .filter((dir) => existsSync(join(PACKAGES_DIR, dir, "package.json")))
  .map((dir) => {
    const packageJson = JSON.parse(
      readFileSync(join(PACKAGES_DIR, dir, "package.json"), "utf-8")
    ) as Omit<Partial<WorkspacePackage>, "dir"> & { name: string };
    return {
      dependencies: packageJson.dependencies ?? {},
      dir,
      exports: packageJson.exports ?? {},
      name: packageJson.name,
      peerDependencies: packageJson.peerDependencies ?? {},
    };
  });

const ADAPTER_PACKAGES = WORKSPACE_PACKAGES.filter(
  (pkg) =>
    ADAPTER_OR_STATE_PACKAGE_DIR.test(pkg.dir) &&
    !NON_ADAPTER_PACKAGE_DIRS.has(pkg.dir)
);

const OFFICIAL_ADAPTERS: readonly CatalogAdapter[] = Object.values(
  ADAPTERS
).filter((adapter) => adapter.group === "official");

const workspacePackageFor = (adapter: CatalogAdapter): WorkspacePackage => {
  const pkg = WORKSPACE_PACKAGES.find(
    (candidate) => candidate.name === adapter.packageName
  );
  if (!pkg) {
    throw new Error(
      `${adapter.slug}: no workspace package named ${adapter.packageName}`
    );
  }
  return pkg;
};

const officialAdaptersIn = (pkg: WorkspacePackage): CatalogAdapter[] =>
  OFFICIAL_ADAPTERS.filter((adapter) => adapter.packageName === pkg.name);

/**
 * Resolve the source file behind a package export, following the tsup
 * convention that `./dist/<path>.js` is built from `src/<path>.ts`.
 */
const sourceEntryFor = (adapter: CatalogAdapter): string => {
  const pkg = workspacePackageFor(adapter);
  const subpath = adapter.importPath
    ? `.${adapter.importPath.slice(adapter.packageName.length)}`
    : ".";
  const built = pkg.exports[subpath]?.import;
  if (!built) {
    throw new Error(
      `${adapter.slug}: ${pkg.name} does not export "${subpath}"`
    );
  }
  return join(
    PACKAGES_DIR,
    pkg.dir,
    built.replace("./dist/", "src/").replace(JS_EXTENSION, ".ts")
  );
};

describe("adapters catalog", () => {
  test("each entry slug matches its key", () => {
    for (const [key, adapter] of Object.entries(ADAPTERS)) {
      expect(adapter.slug).toBe(key);
    }
  });

  test("ADAPTER_NAMES is sorted and complete", () => {
    for (let index = 1; index < ADAPTER_NAMES.length; index++) {
      expect(
        ADAPTER_NAMES[index - 1] < ADAPTER_NAMES[index],
        `${ADAPTER_NAMES[index - 1]} should sort before ${ADAPTER_NAMES[index]}`
      ).toBe(true);
    }
    expect(new Set(ADAPTER_NAMES)).toEqual(new Set(Object.keys(ADAPTERS)));
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

  test("official adapters point at packages and READMEs in this repo", () => {
    expect(OFFICIAL_ADAPTERS.length).toBeGreaterThan(0);
    for (const adapter of OFFICIAL_ADAPTERS) {
      const pkg = workspacePackageFor(adapter);
      expect(adapter.packageName).toMatch(CHAT_ADAPTER_PACKAGE);
      expect(adapter.readme).toBe(
        `https://github.com/vercel/chat/tree/main/packages/${pkg.dir}`
      );
      expect(
        existsSync(join(PACKAGES_DIR, pkg.dir, "README.md")),
        `${adapter.slug}: README.md missing in packages/${pkg.dir}`
      ).toBe(true);
    }
  });

  test("every adapter and state package in this repo is cataloged", () => {
    expect(ADAPTER_PACKAGES.length).toBeGreaterThan(0);
    for (const pkg of ADAPTER_PACKAGES) {
      expect(
        officialAdaptersIn(pkg).length,
        `${pkg.name}: no official catalog entry`
      ).toBeGreaterThan(0);
    }
  });

  test("vendor-official and community adapters declare an author", () => {
    const thirdParty = [
      ...Object.values(ADAPTERS).filter(
        (adapter) => adapter.group === "vendor-official"
      ),
      ...Object.values(COMMUNITY_ADAPTERS),
    ];
    expect(thirdParty.length).toBeGreaterThan(0);
    for (const adapter of thirdParty) {
      expect(adapter.author, `${adapter.slug}: author`).toBeTruthy();
    }
  });

  test("features only use keys for the adapter type", () => {
    const entries = [
      ...Object.values(ADAPTERS),
      ...Object.values(COMMUNITY_ADAPTERS),
    ];
    for (const adapter of entries) {
      expect(
        Object.keys(adapter.features).length,
        `${adapter.slug}: no features declared`
      ).toBeGreaterThan(0);
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

  // A package can host several adapters (for example `x` and `xchat` in
  // `@chat-adapter/x`), so env and dependency checks compare the package with
  // the union of its catalog entries.
  test("official source process.env keys are declared", () => {
    for (const pkg of ADAPTER_PACKAGES) {
      const declared = new Set(
        officialAdaptersIn(pkg).flatMap((adapter) => [
          ...allEnvNames(listEnvVars(adapter.slug)),
        ])
      );
      for (const key of sourceEnvKeys(pkg.dir)) {
        expect(
          declared.has(key),
          `${pkg.name}: expected ${key} from source in a catalog env spec`
        ).toBe(true);
      }
    }
  });

  test("official catalog env keys are backed by source reads", () => {
    for (const adapter of OFFICIAL_ADAPTERS) {
      const sourceKeys = new Set(
        sourceEnvKeys(workspacePackageFor(adapter).dir)
      );
      for (const key of allEnvNames(listEnvVars(adapter.slug))) {
        expect(
          sourceKeys.has(key),
          `${adapter.slug}: declared ${key} in env spec but did not find a source read`
        ).toBe(true);
      }
    }
  });

  test("official peer deps cover the packages consumers install", () => {
    for (const pkg of ADAPTER_PACKAGES) {
      const runtimeDeps = Object.entries(pkg.dependencies)
        .filter(
          ([name, version]) =>
            version !== "workspace:*" && !OFFICIAL_PEER_DEP_EXCLUSIONS.has(name)
        )
        .map(([name]) => name);
      const installable = new Set([
        ...runtimeDeps,
        ...Object.keys(pkg.peerDependencies),
      ]);

      for (const adapter of officialAdaptersIn(pkg)) {
        for (const dependency of runtimeDeps) {
          expect(
            adapter.peerDeps,
            `${adapter.slug}: missing runtime dependency ${dependency}`
          ).toContain(dependency);
        }
        for (const peerDep of adapter.peerDeps) {
          expect(
            installable.has(peerDep),
            `${adapter.slug}: ${peerDep} is not a dependency or peer dependency of ${pkg.name}`
          ).toBe(true);
        }
      }
    }
  });

  test("official factory exports are functions at their import path", async () => {
    for (const adapter of OFFICIAL_ADAPTERS) {
      const entry = sourceEntryFor(adapter);
      const module = (await import(entry)) as Record<string, unknown>;
      expect(
        typeof module[adapter.factoryExport],
        `${adapter.slug}: ${adapter.factoryExport} is not exported from ${
          adapter.importPath ?? adapter.packageName
        }`
      ).toBe("function");
    }
  }, 60_000);
});

describe("getAdapter", () => {
  test("returns the entry for a known slug", () => {
    expect(getAdapter("slack")).toBe(ADAPTERS.slack);
    expect(getAdapter("xchat")).toBe(ADAPTERS.xchat);
  });

  test("does not return community adapters", () => {
    expect(COMMUNITY_ADAPTERS.mattermost).toBeDefined();
    expect(getAdapter("mattermost")).toBeUndefined();
  });

  test("ignores inherited object keys", () => {
    expect(getAdapter("toString")).toBeUndefined();
    expect(isAdapterSlug("toString")).toBe(false);
    expect(listEnvVars("toString")).toEqual([]);
    expect(getCatalogEntry("toString")).toBeUndefined();
  });

  test("returns undefined for an unknown slug", () => {
    expect(getAdapter("not-real")).toBeUndefined();
  });
});

describe("isAdapterSlug", () => {
  test("accepts official and vendor-official slugs only", () => {
    expect(isAdapterSlug("slack")).toBe(true);
    expect(isAdapterSlug("kapso")).toBe(true);
    expect(isAdapterSlug("mattermost")).toBe(false);
    expect(isAdapterSlug("not-real")).toBe(false);
  });
});

describe("listEnvVars", () => {
  test("returns an empty array for unknown slugs", () => {
    expect(listEnvVars("not-real")).toEqual([]);
  });

  test("flattens required, credential-mode, and optional vars in order", () => {
    const { env } = ADAPTERS.slack;
    const modeKeys = env.credentialModes.flatMap((mode) =>
      mode.vars.map((envVar) => envVar.key)
    );
    const optionalKeys = env.optional.map((envVar) => envVar.key);
    // Precondition: Slack repeats the signing secret across credential modes,
    // so this test exercises de-duplication.
    expect(
      modeKeys.filter((key) => key === "SLACK_SIGNING_SECRET")
    ).toHaveLength(2);

    const keys = listEnvVars("slack").map((envVar) => envVar.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set([...modeKeys, ...optionalKeys]));
    const lastModeIndex = Math.max(...modeKeys.map((key) => keys.indexOf(key)));
    const firstOptionalIndex = Math.min(
      ...optionalKeys.map((key) => keys.indexOf(key))
    );
    expect(lastModeIndex).toBeLessThan(firstOptionalIndex);
  });

  test("lists required vars first", () => {
    const required = ADAPTERS.linear.env.required.map((envVar) => envVar.key);
    expect(required.length).toBeGreaterThan(0);
    const keys = listEnvVars("linear").map((envVar) => envVar.key);
    expect(keys.slice(0, required.length)).toEqual(required);
  });

  test("includes aliases", () => {
    const postgresNames = allEnvNames(listEnvVars("postgres"));
    expect(postgresNames.has("POSTGRES_URL")).toBe(true);
    expect(postgresNames.has("DATABASE_URL")).toBe(true);
  });
});

describe("getSecretEnvVars", () => {
  test("returns exactly the secret vars", () => {
    const all = listEnvVars("slack");
    // Precondition: Slack declares both secret and non-secret vars.
    expect(all.some((envVar) => envVar.secret)).toBe(true);
    expect(all.some((envVar) => !envVar.secret)).toBe(true);

    const secretKeys = getSecretEnvVars("slack").map((envVar) => envVar.key);
    expect(secretKeys).toContain("SLACK_BOT_TOKEN");
    expect(secretKeys).not.toContain("SLACK_CLIENT_ID");
    expect(secretKeys).toEqual(
      all.filter((envVar) => envVar.secret).map((envVar) => envVar.key)
    );
  });

  test("returns an empty array when the adapter has no secrets", () => {
    expect(getSecretEnvVars("memory")).toEqual([]);
  });
});

describe("listAdapters", () => {
  test("returns every entry, official and vendor-official first", () => {
    const entries = listAdapters();
    const slugs = entries.map((adapter) => adapter.slug);
    expect(slugs.slice(0, 3)).toEqual(["slack", "teams", "gchat"]);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(slugs)).toEqual(
      new Set([...Object.keys(ADAPTERS), ...Object.keys(COMMUNITY_ADAPTERS)])
    );
    const firstCommunity = entries.findIndex(
      (adapter) => adapter.group === "community"
    );
    expect(
      entries
        .slice(firstCommunity)
        .every((adapter) => adapter.group === "community")
    ).toBe(true);
  });

  test("returns the same objects as the keyed maps", () => {
    const entries = listAdapters();
    expect(entries.find((adapter) => adapter.slug === "slack")).toBe(
      ADAPTERS.slack
    );
    expect(entries.find((adapter) => adapter.slug === "mattermost")).toBe(
      COMMUNITY_ADAPTERS.mattermost
    );
  });

  test("filters by one group", () => {
    const slugs = listAdapters({ group: "community" }).map(
      (adapter) => adapter.slug
    );
    expect(new Set(slugs)).toEqual(new Set(Object.keys(COMMUNITY_ADAPTERS)));
  });

  test("filters by type", () => {
    const slugs = listAdapters({ type: "state" }).map(
      (adapter) => adapter.slug
    );
    expect(slugs).toEqual(
      expect.arrayContaining(["redis", "cloudflare-agents", "mysql"])
    );
    expect(slugs).not.toContain("slack");
  });

  test("combines several groups with a type", () => {
    const slugs = listAdapters({
      group: ["official", "community"],
      type: "state",
    }).map((adapter) => adapter.slug);
    // Official and community state adapters are kept.
    expect(slugs).toEqual(expect.arrayContaining(["redis", "mysql"]));
    // Vendor-official state adapters and platform adapters are dropped.
    expect(slugs).not.toContain("cloudflare-agents");
    expect(slugs).not.toContain("slack");
    expect(slugs).not.toContain("mattermost");
  });

  test("returns nothing for an empty group list", () => {
    expect(listAdapters({ group: [] })).toEqual([]);
  });
});

describe("getCatalogEntry", () => {
  test("returns official, vendor-official, and community entries", () => {
    expect(getCatalogEntry("slack")).toBe(ADAPTERS.slack);
    expect(getCatalogEntry("kapso")).toBe(ADAPTERS.kapso);
    expect(getCatalogEntry("mattermost")).toBe(COMMUNITY_ADAPTERS.mattermost);
  });

  test("returns undefined for an unknown slug", () => {
    expect(getCatalogEntry("not-real")).toBeUndefined();
  });
});

describe("getFeatureSupport", () => {
  test("returns the declared value for a labeled feature", () => {
    expect(ADAPTERS.slack.features.streaming).toEqual({
      status: "yes",
      label: "Native",
    });
    expect(getFeatureSupport("slack", "streaming")).toEqual({
      status: "yes",
      label: "Native",
    });
  });

  test("normalizes a bare status", () => {
    expect(ADAPTERS.slack.features.postMessage).toBe("yes");
    expect(getFeatureSupport(ADAPTERS.slack, "postMessage")).toEqual({
      status: "yes",
    });
  });

  test("looks up community adapters by slug", () => {
    const declared = COMMUNITY_ADAPTERS.blooio.features.addReactions;
    expect(declared).toEqual({ status: "yes", label: "Tapbacks" });
    expect(getFeatureSupport("blooio", "addReactions")).toEqual(declared);
  });

  test("treats undeclared features and unknown slugs as unsupported", () => {
    // Precondition: the memory adapter does not declare cluster support.
    expect(Object.hasOwn(ADAPTERS.memory.features, "cluster")).toBe(false);
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

describe("getFeatureCategories", () => {
  test("returns the categories for each adapter type", () => {
    expect(getFeatureCategories("platform")).toBe(PLATFORM_FEATURE_CATEGORIES);
    expect(getFeatureCategories("state")).toBe(STATE_FEATURE_CATEGORIES);
  });

  test("uses unique keys across platform and state categories", () => {
    const keys = [...PLATFORM_FEATURE_CATEGORIES, ...STATE_FEATURE_CATEGORIES]
      .flatMap((category) => category.features)
      .map((feature) => feature.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("listEnvVars for community adapters", () => {
  test("returns an empty array", () => {
    expect(COMMUNITY_ADAPTERS.mattermost).toBeDefined();
    expect(listEnvVars("mattermost")).toEqual([]);
  });
});
