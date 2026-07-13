import {
  confirm,
  isCancel,
  log,
  multiselect,
  select,
  text,
} from "@clack/prompts";
import {
  getAdapterConnectSpec,
  getCliScaffoldSpec,
  listCliPlatformAdapters,
  listCliStateAdapters,
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
  connect?: boolean;
  description?: string;
  initializeGit?: boolean;
  install?: boolean;
  name?: string;
  packageManager?: PackageManager;
  quiet: boolean;
  selectedAdapters?: readonly string[];
  vendor?: boolean;
  yes: boolean;
}

const DEFAULT_PROJECT_NAME = "my-bot";

const selectedPlatformLabel = (config: ProjectConfig): string =>
  config.platformAdapters.map((adapter) => adapter.name).join(", ");

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
    const selected = await multiselect({
      message: "Select at least one platform adapter:",
      options: listCliPlatformAdapters(
        inputs.vendor ? "vendor-official" : "official"
      ).map((adapter) => ({
        label: adapter.name,
        value: adapter.slug,
      })),
      required: true,
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
          options: listCliStateAdapters().map((adapter) => ({
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

  // Any non-interactive path (yes mode or an explicit --adapter selection that
  // skips the platform prompt) must include a platform adapter; otherwise the
  // CLI would report success for a bot that cannot receive any event.
  const skipsAdapterPrompt = inputs.yes || Boolean(flaggedSelection);
  if (skipsAdapterPrompt && selection.platformAdapters.length === 0) {
    throw new Error(
      "Select at least one platform adapter. Pass --adapter with a platform (for example: --adapter slack)."
    );
  }

  const connectCapable = selection.platformAdapters.some((adapter) =>
    Boolean(getAdapterConnectSpec(adapter.slug))
  );
  let useConnect = false;
  if (inputs.connect) {
    useConnect = connectCapable;
    if (!(connectCapable || inputs.quiet)) {
      log.warning(
        "Ignoring --connect: Vercel Connect supports only the Slack, GitHub, and Linear adapters."
      );
    }
  } else if (!(inputs.yes || flaggedSelection) && connectCapable) {
    const authMode = await select({
      message: "How should adapters authenticate?",
      options: [
        {
          hint: "provider tokens and signing secrets via environment variables",
          label: "Provider secrets",
          value: "secrets",
        },
        {
          hint: "short-lived tokens from a Vercel Connect connector",
          label: "Vercel Connect",
          value: "connect",
        },
      ],
    });
    if (isCancel(authMode)) {
      return null;
    }
    useConnect = authMode === "connect";
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
    useConnect,
  };

  if (!inputs.quiet && flaggedSelection) {
    log.info(`Platform adapters: ${selectedPlatformLabel(config)}`);
    log.info(`State adapter: ${config.stateAdapter.name}`);
  }
  if (!inputs.quiet && useConnect) {
    log.info("Authentication: Vercel Connect");
  }
  if (
    !inputs.quiet &&
    config.platformAdapters.some((adapter) => adapter.slug === "discord")
  ) {
    log.warning(
      "Discord serverless Gateway deployment requires Vercel Pro or Enterprise."
    );
  }

  return config;
}
