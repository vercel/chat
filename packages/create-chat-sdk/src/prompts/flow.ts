import {
  confirm,
  groupMultiselect,
  isCancel,
  log,
  select,
  text,
} from "@clack/prompts";
import { listStateAdapters } from "chat/adapters";
import {
  getCliScaffoldSpec,
  listCliPlatformAdapters,
} from "../catalog/index.js";
import { resolveAdapterSelection } from "../catalog/selection.js";
import type { PackageManager, ProjectConfig } from "../types.js";
import { detectPackageManager, validatePackageName } from "./validate.js";

/**
 * Values resolved from CLI flags before interactive prompts run.
 *
 * `yes` mode accepts defaults and uses `my-bot` when no project name is
 * supplied. `initializeGit` defaults to `true` and maps to the generated
 * config's `shouldInitializeGit` field.
 */
interface PromptInputs {
  description?: string;
  initializeGit?: boolean;
  install?: boolean;
  name?: string;
  packageManager?: PackageManager;
  quiet: boolean;
  selectedAdapters?: readonly string[];
  yes: boolean;
}

const groupLabel = (group: "official" | "vendor-official"): string =>
  group === "official" ? "Official" : "Vendor-official";

const DEFAULT_PROJECT_NAME = "my-bot";

const selectedPlatformLabel = (config: ProjectConfig): string =>
  config.platformAdapters.map((adapter) => adapter.name).join(", ") || "none";

/**
 * Resolve CLI inputs and interactive prompt answers to a project config.
 *
 * @param inputs - Initial values from CLI flags.
 * @returns Project config, or `null` when the user cancels.
 */
export async function runPrompts(
  inputs: PromptInputs
): Promise<ProjectConfig | null> {
  const rawName =
    inputs.name ??
    (inputs.yes
      ? DEFAULT_PROJECT_NAME
      : await text({
          message: "Project name:",
          placeholder: DEFAULT_PROJECT_NAME,
          validate: validatePackageName,
        }));
  if (isCancel(rawName)) {
    return null;
  }

  const name = rawName.trim();
  const nameError = validatePackageName(name);
  if (nameError) {
    throw new Error(nameError);
  }

  const rawDescription =
    inputs.description ??
    (inputs.yes
      ? ""
      : await text({
          defaultValue: "",
          message: "Description:",
          placeholder: "A Chat SDK bot",
        }));
  if (isCancel(rawDescription)) {
    return null;
  }

  const flaggedSelection = inputs.selectedAdapters?.length
    ? resolveAdapterSelection(inputs.selectedAdapters)
    : undefined;

  let platformValues: readonly string[];
  if (flaggedSelection) {
    platformValues = flaggedSelection.platformAdapters.map(
      (adapter) => adapter.slug
    );
  } else if (inputs.yes) {
    platformValues = [];
  } else {
    const groups = Object.fromEntries(
      ["official", "vendor-official"].map((group) => [
        groupLabel(group as "official" | "vendor-official"),
        listCliPlatformAdapters(group as "official" | "vendor-official").map(
          (adapter) => ({
            label: adapter.name,
            value: adapter.slug,
          })
        ),
      ])
    );
    const selected = await groupMultiselect({
      message: "Select platform adapters:",
      options: groups,
      required: false,
    });
    if (isCancel(selected)) {
      return null;
    }
    platformValues = selected;
  }

  let selection = flaggedSelection;
  if (!selection) {
    const stateSlug = inputs.yes
      ? "memory"
      : await select({
          message: "Select state adapter:",
          options: listStateAdapters().map((adapter) => ({
            hint: getCliScaffoldSpec(adapter.slug).stateHint,
            label: adapter.name,
            value: adapter.slug,
          })),
        });
    if (isCancel(stateSlug)) {
      return null;
    }
    selection = resolveAdapterSelection([...platformValues, stateSlug]);
  }

  const shouldInstall =
    inputs.install ??
    (inputs.yes
      ? true
      : await confirm({
          initialValue: true,
          message: "Install dependencies?",
        }));
  if (isCancel(shouldInstall)) {
    return null;
  }

  const config: ProjectConfig = {
    description: String(rawDescription || ""),
    name,
    packageManager:
      inputs.packageManager ??
      detectPackageManager(process.env.npm_config_user_agent),
    platformAdapters: selection.platformAdapters,
    shouldInstall,
    shouldInitializeGit: inputs.initializeGit ?? true,
    stateAdapter: selection.stateAdapter,
  };

  if (!inputs.quiet && flaggedSelection) {
    log.info(`Platform adapters: ${selectedPlatformLabel(config)}`);
    log.info(`State adapter: ${config.stateAdapter.name}`);
  }

  return config;
}
