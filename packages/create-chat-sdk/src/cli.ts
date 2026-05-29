import { intro, note, outro } from "@clack/prompts";
import { Command, InvalidArgumentError } from "commander";
import pc from "picocolors";
import adapters from "../adapters.json" with { type: "json" };
import { runPrompts } from "./prompts.js";
import { scaffold } from "./scaffold.js";
import type { AdaptersConfig, PackageManager, ProjectConfig } from "./types.js";

const config = adapters as AdaptersConfig;
const packageManagers = new Set(["npm", "yarn", "pnpm", "bun"]);

function parsePackageManager(value: string): PackageManager {
  if (packageManagers.has(value)) {
    return value as PackageManager;
  }
  throw new InvalidArgumentError("expected npm, yarn, pnpm, or bun");
}

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
      "platform or state adapters to include (skips interactive prompt)"
    )
    .option(
      "--pm <manager>",
      "package manager to use (npm, yarn, pnpm, bun)",
      parsePackageManager
    )
    .option("-y, --yes", "skip prompts and accept defaults")
    .option("--no-install", "skip dependency installation")
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
        "  $ create-chat-sdk my-bot",
        "  $ create-chat-sdk my-bot -d 'My awesome bot' --adapter slack teams redis",
        "  $ create-chat-sdk --adapter discord telegram pg",
        "",
      ].join("\n")
    )
    .action(
      async (
        name?: string,
        opts?: {
          description?: string;
          adapter?: string[];
          install?: boolean;
          pm?: PackageManager;
          yes?: boolean;
          quiet?: boolean;
        }
      ) => {
        const quiet = opts?.quiet ?? false;
        const yes = opts?.yes ?? false;
        const pm = opts?.pm;
        const install = opts?.install === false ? false : undefined;

        if (!quiet) {
          console.log();
          intro(pc.bgCyan(pc.black(" create-chat-sdk ")));
        }

        let result: ProjectConfig | null;
        try {
          result = await runPrompts(
            config,
            name,
            opts?.description,
            opts?.adapter,
            pm,
            install,
            yes,
            quiet
          );
        } catch (error) {
          if (!quiet) {
            const message =
              error instanceof Error ? error.message : String(error);
            outro(pc.red(message));
          }
          process.exit(1);
        }

        if (!result) {
          if (!quiet) {
            outro(pc.gray("Cancelled."));
          }
          process.exit(0);
        }

        try {
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
        } catch (error) {
          if (!quiet) {
            const message =
              error instanceof Error ? error.message : String(error);
            outro(pc.red(message));
          }
          process.exit(1);
        }
      }
    );

  return prog;
}
