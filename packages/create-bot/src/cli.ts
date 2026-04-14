import { intro, note, outro } from "@clack/prompts";
import { Command } from "commander";
import pc from "picocolors";
import adapters from "../adapters.json" with { type: "json" };
import { runPrompts } from "./prompts.js";
import { scaffold } from "./scaffold.js";
import type { AdaptersConfig, PackageManager } from "./types.js";

const config = adapters as AdaptersConfig;

export function buildAdapterList(): string {
  const categories = new Map<string, string[]>();
  for (const a of config.platformAdapters) {
    if (!categories.has(a.category)) {
      categories.set(a.category, []);
    }
    categories.get(a.category)?.push(a.value);
  }

  const lines: string[] = [];
  for (const [category, values] of categories) {
    lines.push(`  ${category}: ${values.join(", ")}`);
  }
  lines.push(`  State: ${config.stateAdapters.map((a) => a.value).join(", ")}`);
  return lines.join("\n");
}

export function createProgram() {
  const prog = new Command();

  prog
    .name("create-bot")
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
      "platform or state adapters to include (skips interactive prompt)"
    )
    .option("--pm <manager>", "package manager to use (npm, yarn, pnpm, bun)")
    .option("-y, --yes", "skip confirmation prompts (accept defaults)")
    .option("-q, --quiet", "suppress non-essential output")
    .option("--no-color", "disable color output (respects NO_COLOR)")
    .addHelpText(
      "after",
      [
        "",
        "Available adapters:",
        buildAdapterList(),
        "",
        "Examples:",
        "  $ create-bot my-bot",
        "  $ create-bot my-bot -d 'My awesome bot' --adapter slack teams redis",
        "  $ create-bot --adapter discord telegram pg",
        "",
      ].join("\n")
    )
    .action(
      async (
        name?: string,
        opts?: {
          description?: string;
          adapter?: string[];
          pm?: string;
          yes?: boolean;
          quiet?: boolean;
        }
      ) => {
        const quiet = opts?.quiet ?? false;
        const yes = opts?.yes ?? false;
        const pm = opts?.pm as PackageManager | undefined;

        if (!quiet) {
          console.log();
          intro(pc.bgCyan(pc.black(" create-bot ")));
        }

        const result = await runPrompts(
          config,
          name,
          opts?.description,
          opts?.adapter,
          pm,
          yes,
          quiet
        );
        if (!result) {
          if (!quiet) {
            outro(pc.gray("Cancelled."));
          }
          process.exit(0);
        }

        await scaffold(result, yes, quiet);

        if (!quiet) {
          note(
            [
              `cd ${result.name}`,
              "cp .env.example .env.local",
              `${result.packageManager} run dev`,
            ].join("\n"),
            "Next steps"
          );

          outro(
            `${pc.green("Done!")} Visit ${pc.cyan("https://chat-sdk.dev/docs")} for the docs.`
          );
        }
      }
    );

  return prog;
}
