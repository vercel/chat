import {
  confirm,
  groupMultiselect,
  isCancel,
  log,
  select,
  text,
} from "@clack/prompts";
import type {
  AdaptersConfig,
  PackageManager,
  PlatformAdapter,
  ProjectConfig,
  StateAdapter,
} from "./types.js";

const PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function validatePackageName(value: string): string | undefined {
  const name = value.trim();
  if (!name) {
    return "Project name is required";
  }
  if (
    name.startsWith(".") ||
    name.startsWith("_") ||
    name.includes("..") ||
    !PACKAGE_NAME_PATTERN.test(name)
  ) {
    return "Use a valid npm package name, like my-bot or @acme/my-bot";
  }
}

function resolveAdapterFlags(adapters: AdaptersConfig, values: string[]) {
  const platforms: PlatformAdapter[] = [];
  const platformValues = new Set<string>();
  let state: StateAdapter | undefined;
  const unknown: string[] = [];

  for (const v of values) {
    const platform = adapters.platformAdapters.find((a) => a.value === v);
    if (platform) {
      if (!platformValues.has(platform.value)) {
        platformValues.add(platform.value);
        platforms.push(platform);
      }
      continue;
    }
    const s = adapters.stateAdapters.find((a) => a.value === v);
    if (s) {
      if (state) {
        throw new Error(
          `Choose one state adapter. Received "${state.value}" and "${s.value}"`
        );
      }
      state = s;
      continue;
    }
    unknown.push(v);
  }

  if (unknown.length > 0) {
    const available = [
      ...adapters.platformAdapters.map((a) => a.value),
      ...adapters.stateAdapters.map((a) => a.value),
    ].join(", ");
    throw new Error(
      `Unknown adapter value: ${unknown.join(", ")}. Available values: ${available}`
    );
  }

  return { platforms, state };
}

export async function runPrompts(
  adapters: AdaptersConfig,
  initialName?: string,
  initialDescription?: string,
  initialAdapters?: string[],
  initialPm?: PackageManager,
  initialInstall?: boolean,
  yes = false,
  quiet = false
): Promise<ProjectConfig | null> {
  const name = initialName
    ? initialName.trim()
    : await text({
        message: "Project name:",
        placeholder: "my-bot",
        validate: validatePackageName,
      });
  if (isCancel(name)) {
    return null;
  }
  const nameError = validatePackageName(name);
  if (nameError) {
    throw new Error(nameError);
  }

  let description: string;

  if (initialDescription != null) {
    description = initialDescription;
  } else if (yes) {
    description = "";
  } else {
    const result = await text({
      message: "Description:",
      placeholder: "A Chat SDK bot",
      defaultValue: "",
    });
    if (isCancel(result)) {
      return null;
    }
    description = result as string;
  }

  const flagged = initialAdapters?.length
    ? resolveAdapterFlags(adapters, initialAdapters)
    : undefined;

  let selectedPlatforms: PlatformAdapter[];

  if (flagged) {
    selectedPlatforms = flagged.platforms;
    if (!quiet) {
      log.info(
        `Platform adapters: ${selectedPlatforms.map((a) => a.name).join(", ") || "none"}`
      );
    }
  } else if (yes) {
    selectedPlatforms = [];
  } else {
    const categories = new Map<string, { label: string; value: string }[]>();
    for (const a of adapters.platformAdapters) {
      if (!categories.has(a.category)) {
        categories.set(a.category, []);
      }
      categories.get(a.category)?.push({ label: a.name, value: a.value });
    }

    const platformValues = await groupMultiselect({
      message: "Select platform adapters:",
      options: Object.fromEntries(categories),
      required: false,
    });
    if (isCancel(platformValues)) {
      return null;
    }

    selectedPlatforms = adapters.platformAdapters.filter((a) =>
      (platformValues as string[]).includes(a.value)
    );
  }

  let selectedState: StateAdapter;

  if (flagged?.state) {
    selectedState = flagged.state;
    if (!quiet) {
      log.info(`State adapter: ${selectedState.name}`);
    }
  } else if (yes) {
    const defaultState = adapters.stateAdapters[0];
    if (!defaultState) {
      throw new Error("No state adapters are available");
    }
    selectedState = defaultState;
    if (!quiet) {
      log.info(`State adapter: ${selectedState.name}`);
    }
  } else {
    const stateValue = await select({
      message: "Select state adapter:",
      options: adapters.stateAdapters.map((a) => ({
        label: a.name,
        value: a.value,
        hint: a.hint,
      })),
    });
    if (isCancel(stateValue)) {
      return null;
    }

    const found = adapters.stateAdapters.find((a) => a.value === stateValue);
    if (!found) {
      throw new Error(`Unknown state adapter: ${String(stateValue)}`);
    }
    selectedState = found;
  }

  let shouldInstall = initialInstall ?? true;

  if (initialInstall === undefined && !yes) {
    const result = await confirm({
      message: "Install dependencies?",
      initialValue: true,
    });
    if (isCancel(result)) {
      return null;
    }
    shouldInstall = result;
  }

  return {
    name: name as string,
    description: description || "",
    platformAdapters: selectedPlatforms,
    stateAdapter: selectedState,
    shouldInstall,
    packageManager: initialPm ?? detectPackageManager(),
  };
}

function detectPackageManager(): "npm" | "yarn" | "pnpm" | "bun" {
  const agent = process.env.npm_config_user_agent || "";
  if (agent.startsWith("pnpm")) {
    return "pnpm";
  }
  if (agent.startsWith("yarn")) {
    return "yarn";
  }
  if (agent.startsWith("bun")) {
    return "bun";
  }
  return "npm";
}
