import { Command, InvalidArgumentError, Option } from "commander";
import {
  listCliPlatformAdapters,
  listCliStateAdapters,
} from "../catalog/index.js";
import { isPackageManager } from "../prompts/validate.js";
import type { PackageManager } from "../types.js";
import { determineAgent } from "./agent.js";
import { runCli } from "./run.js";

const parsePackageManager = (value: string): PackageManager => {
  if (isPackageManager(value)) {
    return value;
  }
  throw new InvalidArgumentError("expected npm, yarn, pnpm, or bun");
};

/**
 * Build the adapter list shown in CLI help.
 *
 * @returns Formatted adapter help text.
 */
export function buildAdapterList(): string {
  const lines: string[] = [];
  for (const group of ["official", "vendor-official"] as const) {
    const values = listCliPlatformAdapters(group).map(
      (adapter) => adapter.slug
    );
    lines.push(
      `  ${group === "official" ? "Official" : "Vendor-official"}: ${values.join(", ")}`
    );
  }
  lines.push(
    `  State: ${listCliStateAdapters()
      .map((adapter) => adapter.slug)
      .join(", ")}`
  );
  return lines.join("\n");
}

/**
 * Create the Commander program for create-chat-sdk.
 *
 * @returns Configured command program.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("create-chat-sdk")
    .description(
      [
        "Scaffold a new Chat SDK bot project.",
        "",
        "Chat SDK is a unified TypeScript SDK by Vercel for building chat bots",
        "across Slack, Teams, Google Chat, Discord, WhatsApp, and more.",
        "Docs: https://chat-sdk.dev/docs",
      ].join("\n")
    )
    .argument("[name]", "name of the project")
    .option("-d, --description <text>", "project description")
    .option(
      "--adapter <values...>",
      "platform or state adapters to include (skips interactive adapter prompts)"
    )
    .addOption(
      new Option(
        "--vendor",
        "list vendor-official adapters in the interactive prompt"
      ).conflicts(["adapter", "yes"])
    )
    .option(
      "--connect",
      "authenticate Slack, GitHub, and Linear adapters with Vercel Connect"
    )
    .option(
      "--pm <manager>",
      "package manager to use (npm, yarn, pnpm, bun)",
      parsePackageManager
    )
    .option("-y, --yes", "skip prompts and accept defaults")
    .option(
      "--interactive",
      "always prompt, even when a coding agent environment is detected"
    )
    .option("-f, --force", "overwrite generated files in an existing directory")
    .option("-s, --skip-install", "skip dependency installation")
    .option("--no-git", "skip git repository initialization")
    .option("-q, --quiet", "suppress non-essential output")
    .addHelpText(
      "after",
      [
        "",
        "Available adapters:",
        buildAdapterList(),
        "",
        "Examples:",
        "  $ create-chat-sdk my-bot",
        "  $ create-chat-sdk my-bot -d 'My awesome bot' --adapter slack teams redis",
        "  $ create-chat-sdk --adapter discord telegram postgres",
        "",
      ].join("\n")
    )
    .action(
      async (
        name: string | undefined,
        opts: {
          adapter?: string[];
          connect?: boolean;
          description?: string;
          force?: boolean;
          git?: boolean;
          interactive?: boolean;
          pm?: PackageManager;
          quiet?: boolean;
          skipInstall?: boolean;
          vendor?: boolean;
          yes?: boolean;
        }
      ) => {
        const detectionApplies =
          opts.yes !== true &&
          opts.interactive !== true &&
          opts.vendor !== true;
        const agentResult = detectionApplies ? await determineAgent() : null;
        const detectedAgent = agentResult?.isAgent
          ? agentResult.agent.name
          : undefined;
        await runCli({
          connect: opts.connect === true,
          description: opts.description,
          detectedAgent,
          force: opts.force ?? false,
          initializeGit: opts.git !== false,
          install: opts.skipInstall ? false : undefined,
          name,
          packageManager: opts.pm,
          quiet: opts.quiet ?? false,
          selectedAdapters: opts.adapter,
          vendor: opts.vendor === true,
          yes: opts.yes === true || detectedAgent !== undefined,
        });
      }
    );

  return program;
}
