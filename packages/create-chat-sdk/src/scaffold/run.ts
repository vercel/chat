import fs from "node:fs";
import path from "node:path";
import { log, spinner } from "@clack/prompts";
import { execa } from "execa";
import { generateBotTs } from "../generators/bot.js";
import { generateEnvExample } from "../generators/env-example.js";
import { generateNextConfig } from "../generators/next-config.js";
import { generatePackageJson } from "../generators/package-json.js";
import { generateReadme } from "../generators/readme.js";
import {
  generateAuthStub,
  generateDiscordGatewayRoute,
  generateVercelJson,
  generateWebRoute,
  needsDiscordGateway,
  needsVercelJson,
  needsWebRoute,
} from "../generators/routes.js";
import type { ProjectConfig, ScaffoldOptions } from "../types.js";
import {
  copyDir,
  readProjectJson,
  removeProjectFile,
  writeProjectFile,
  writeProjectJson,
} from "./fs.js";
import { readState, type State, writeState } from "./state.js";
import { templateDir } from "./template.js";

/**
 * Create a project on disk from the resolved config.
 *
 * File generation failures are fatal and are re-thrown after stopping the
 * spinner. Git initialization and dependency installation failures are
 * non-fatal because the generated files are still usable; the CLI prints manual
 * follow-up commands for those steps.
 *
 * @param config - Project configuration.
 * @param options - Filesystem and output options.
 * @returns Whether scaffolding completed. `false` means the user cancelled.
 */
export async function scaffold(
  config: ProjectConfig,
  options: ScaffoldOptions
): Promise<boolean> {
  const projectDir = path.resolve(process.cwd(), config.name);

  if (
    fs.existsSync(projectDir) &&
    fs.readdirSync(projectDir).length > 0 &&
    !options.force
  ) {
    throw new Error(
      `Directory "${config.name}" already exists and is not empty. Re-run with --force to overwrite generated files.`
    );
  }

  const createSpinner = options.quiet ? null : spinner();
  createSpinner?.start("Creating project files");

  try {
    const previousState = readState(projectDir);
    const files: State["files"] = [];
    copyDir(templateDir(), projectDir);
    writeProjectFile(projectDir, ".env.example", generateEnvExample(config));
    writeProjectFile(projectDir, "next.config.ts", generateNextConfig(config));
    writeProjectFile(projectDir, "README.md", generateReadme(config));
    writeProjectFile(projectDir, "src/lib/bot.ts", generateBotTs(config));

    // Conditional files are written when their adapter is selected and removed
    // otherwise, so a `--force` re-run with a different selection does not leave
    // stale routes behind.
    if (needsWebRoute(config)) {
      files.push("src/app/api/chat/route.ts", "src/lib/auth-stub.ts");
      writeProjectFile(
        projectDir,
        "src/app/api/chat/route.ts",
        generateWebRoute()
      );
      writeProjectFile(projectDir, "src/lib/auth-stub.ts", generateAuthStub());
    } else if (
      previousState.files.includes("src/app/api/chat/route.ts") ||
      previousState.files.includes("src/lib/auth-stub.ts")
    ) {
      removeProjectFile(projectDir, "src/app/api/chat/route.ts");
      removeProjectFile(projectDir, "src/lib/auth-stub.ts");
    }

    if (needsDiscordGateway(config)) {
      files.push("src/app/api/discord/gateway/route.ts");
      writeProjectFile(
        projectDir,
        "src/app/api/discord/gateway/route.ts",
        generateDiscordGatewayRoute()
      );
    } else if (
      previousState.files.includes("src/app/api/discord/gateway/route.ts")
    ) {
      removeProjectFile(projectDir, "src/app/api/discord/gateway/route.ts");
    }

    if (needsVercelJson(config)) {
      files.push("vercel.json");
      writeProjectFile(projectDir, "vercel.json", generateVercelJson(config));
    } else if (previousState.files.includes("vercel.json")) {
      removeProjectFile(projectDir, "vercel.json");
    }

    const packageJson = readProjectJson<Record<string, unknown>>(
      projectDir,
      "package.json"
    );
    writeProjectJson(
      projectDir,
      "package.json",
      generatePackageJson(packageJson, config)
    );
    writeState(projectDir, files);
  } catch (error) {
    createSpinner?.stop("Failed to create project files.");
    throw error;
  }

  createSpinner?.stop("Project files created.");

  if (config.shouldInitializeGit) {
    const gitSpinner = options.quiet ? null : spinner();
    gitSpinner?.start("Initializing git repository");
    try {
      await execa("git", ["init"], {
        cwd: projectDir,
        stdio: "pipe",
      });
      gitSpinner?.stop("Git repository initialized.");
    } catch {
      gitSpinner?.stop("Failed to initialize git repository.");
      log.warning('Run "git init" manually in the project directory.');
    }
  }

  if (!config.shouldInstall) {
    return true;
  }

  const installSpinner = options.quiet ? null : spinner();
  installSpinner?.start(
    `Installing dependencies with ${config.packageManager}`
  );
  try {
    await execa(config.packageManager, ["install"], {
      cwd: projectDir,
      stdio: "pipe",
    });
    installSpinner?.stop("Dependencies installed.");
  } catch {
    installSpinner?.stop("Failed to install dependencies.");
    log.warning(
      `Run "${config.packageManager} install" manually in the project directory.`
    );
    // The generated files are still usable, so interactive runs stay successful
    // and only print the manual follow-up command. Non-interactive runs (-y,
    // quiet, CI, coding agents) must fail loudly so automation can detect that
    // the project is missing its dependencies.
    if (options.yes || options.quiet) {
      process.exitCode = 1;
    }
  }

  return true;
}
