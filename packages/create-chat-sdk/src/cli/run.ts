import { intro, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { runPrompts } from "../prompts/flow.js";
import { scaffold } from "../scaffold/run.js";
import type { PackageManager } from "../types.js";

interface RunCliOptions {
  description?: string;
  force: boolean;
  initializeGit: boolean;
  install?: boolean;
  name?: string;
  packageManager?: PackageManager;
  quiet: boolean;
  selectedAdapters?: readonly string[];
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
  }

  try {
    const config = await runPrompts({
      description: options.description,
      initializeGit: options.initializeGit,
      install: options.install,
      name: options.name,
      packageManager: options.packageManager,
      quiet: options.quiet,
      selectedAdapters: options.selectedAdapters,
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

    if (!options.quiet) {
      note(
        [
          `cd ${config.name}`,
          "cp .env.example .env.local",
          `${config.packageManager} run dev`,
        ].join("\n"),
        "Next steps"
      );

      outro(
        `${pc.green("Done!")} Visit ${pc.cyan("https://chat-sdk.dev/docs")} for the docs. Use the Chat SDK skill for agent guidance.`
      );
    }
  } catch (error) {
    if (!options.quiet) {
      const message = error instanceof Error ? error.message : String(error);
      outro(pc.red(message));
    }
    process.exitCode = 1;
  }
}
