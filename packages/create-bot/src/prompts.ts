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

const VALID_PKG_NAME = /^[a-z0-9@._-]+$/i;

function resolveAdapterFlags(adapters: AdaptersConfig, values: string[]) {
  const platforms: PlatformAdapter[] = [];
  let state: StateAdapter | undefined;
  const unknown: string[] = [];

  for (const v of values) {
    const platform = adapters.platformAdapters.find((a) => a.value === v);
    if (platform) {
      platforms.push(platform);
      continue;
    }
    const s = adapters.stateAdapters.find((a) => a.value === v);
    if (s) {
      if (state) {
        log.warn(`Multiple state adapters passed; using "${s.value}"`);
      }
      state = s;
      continue;
    }
    unknown.push(v);
  }

  if (unknown.length > 0) {
    log.warn(`Unknown adapter(s): ${unknown.join(", ")}`);
  }

  return { platforms, state };
}

export async function runPrompts(
  adapters: AdaptersConfig,
  initialName?: string,
  initialDescription?: string,
  initialAdapters?: string[],
  initialPm?: PackageManager,
  yes = false,
  quiet = false
): Promise<ProjectConfig | null> {
  const name =
    initialName ??
    (await text({
      message: "Project name:",
      placeholder: "my-bot",
      validate: (value) => {
        if (!value.trim()) {
          return "Project name is required";
        }
        if (!VALID_PKG_NAME.test(value)) {
          return "Invalid package name";
        }
      },
    }));
  if (isCancel(name)) {
    return null;
  }

  let description: string;

  if (initialDescription != null) {
    description = initialDescription;
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

  if (flagged?.platforms.length) {
    selectedPlatforms = flagged.platforms;
    if (!quiet) {
      log.info(
        `Platform adapters: ${selectedPlatforms.map((a) => a.name).join(", ")}`
      );
    }
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

  let shouldInstall = true;

  if (!yes) {
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
