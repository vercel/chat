import { intro, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { runPrompts } from "../prompts/flow.js";
import { scaffold } from "../scaffold/run.js";
import type { PackageManager } from "../types.js";

interface RunCliOptions {
  /**
   * Authenticate Connect-capable adapters with Vercel Connect.
   */
  connect?: boolean;
  description?: string;
  /**
   * Coding agent name when detection (not an explicit flag) enabled yes mode.
   */
  detectedAgent?: string;
  force: boolean;
  initializeGit: boolean;
  install?: boolean;
  name?: string;
  packageManager?: PackageManager;
  quiet: boolean;
  selectedAdapters?: readonly string[];
  vendor?: boolean;
  yes: boolean;
}

/**
 * Run the create-chat-sdk command after Commander has parsed flags.
 *
 * @param options - Parsed CLI options.
 */
export async function runCli(options: RunCliOptions): Promise<void> {
  if (!options.quiet) {
    console.log();
    intro(pc.bgCyan(pc.black(" create-chat-sdk ")));
    if (options.detectedAgent) {
      log.info(
        `Coding agent detected (${options.detectedAgent}): using non-interactive defaults. Pass --interactive to use prompts.`
      );
    }
  }

  try {
    const config = await runPrompts({
      connect: options.connect,
      description: options.description,
      initializeGit: options.initializeGit,
      install: options.install,
      name: options.name,
      packageManager: options.packageManager,
      quiet: options.quiet,
      selectedAdapters: options.selectedAdapters,
      vendor: options.vendor,
      yes: options.yes,
    });

    if (!config) {
      if (!options.quiet) {
        outro(pc.gray("Cancelled."));
      }
      process.exitCode = 0;
      return;
    }

    const completed = await scaffold(config, {
      force: options.force,
      quiet: options.quiet,
      yes: options.yes,
    });
    if (!completed) {
      if (!options.quiet) {
        outro(pc.gray("Cancelled."));
      }
      process.exitCode = 0;
      return;
    }

    if (process.exitCode && process.exitCode !== 0) {
      return;
    }

    if (!options.quiet) {
      const nextSteps = config.useConnect
        ? [
            `cd ${config.name}`,
            "vercel link",
            "vercel env pull .env.local",
            "# set your connector UIDs (see .env.example)",
            `${config.packageManager} run dev`,
          ]
        : [
            `cd ${config.name}`,
            "cp .env.example .env.local",
            `${config.packageManager} run dev`,
          ];
      note(nextSteps.join("\n"), "Next steps");

      outro(
        `${pc.green("Done!")} Visit ${pc.cyan("https://chat-sdk.dev/docs")} for the docs. Use the Chat SDK skill for agent guidance.`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.quiet) {
      console.error(message);
    } else {
      outro(pc.red(message));
    }
    process.exitCode = 1;
  }
}
