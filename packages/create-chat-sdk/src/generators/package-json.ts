import {
  CONNECT_PACKAGE,
  getAdapterConnectSpec,
  getCliScaffoldSpec,
} from "../catalog/index.js";
import type { ProjectConfig } from "../types.js";

/**
 * Mutable subset of the template `package.json` used by the generator.
 *
 * Unknown fields are preserved so the static template can evolve without
 * requiring this generator to model every package manifest field.
 */
interface TemplatePackageJson {
  dependencies?: Record<string, string>;
  description?: string;
  devDependencies?: Record<string, string>;
  name?: string;
  [key: string]: unknown;
}

const sortedRecord = (
  record: Record<string, string> | undefined
): Record<string, string> | undefined => {
  if (!record) {
    return;
  }
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
};

/**
 * Patch template `package.json` data with project metadata and dependencies.
 *
 * Generated projects depend on published packages, so adapter, peer, and extra
 * runtime dependencies are emitted as `"latest"` instead of workspace ranges.
 *
 * @param template - Parsed template package.json.
 * @param config - Resolved project configuration.
 * @returns New package.json data.
 */
export function generatePackageJson(
  template: TemplatePackageJson,
  config: ProjectConfig
): TemplatePackageJson {
  const dependencies = { ...(template.dependencies ?? {}) };
  const pkg: TemplatePackageJson = {
    ...template,
    dependencies,
    name: config.name,
  };

  if (config.description) {
    pkg.description = config.description;
  } else {
    pkg.description = undefined;
  }

  dependencies.chat = "latest";

  for (const adapter of [...config.platformAdapters, config.stateAdapter]) {
    dependencies[adapter.packageName] = "latest";
    // Official adapters declare their provider SDKs as normal dependencies, so
    // they install transitively and must not be duplicated in the app manifest.
    // Vendor-official catalog peerDeps come from the adapter's documented
    // install command (genuine peers the app must install itself).
    if (adapter.group === "vendor-official") {
      for (const peerDep of adapter.peerDeps) {
        dependencies[peerDep] = "latest";
      }
    }
    for (const extra of getCliScaffoldSpec(adapter.slug).extraDependencies ??
      []) {
      dependencies[extra] = "latest";
    }
  }

  // Connect helpers ship from @vercel/connect, which is not a dependency of any
  // adapter package, so the generated app must install it itself.
  const usesConnect =
    config.useConnect === true &&
    config.platformAdapters.some((adapter) =>
      getAdapterConnectSpec(adapter.slug)
    );
  if (usesConnect) {
    dependencies[CONNECT_PACKAGE] = "latest";
  }

  pkg.dependencies = sortedRecord(dependencies);
  pkg.devDependencies = sortedRecord(template.devDependencies);
  return pkg;
}
