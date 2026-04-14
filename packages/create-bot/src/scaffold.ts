import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirm, isCancel, log, spinner } from "@clack/prompts";
import { execa } from "execa";
import { botTs } from "./templates.js";
import type { ProjectConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function readFile(projectDir: string, filePath: string): string {
  return fs.readFileSync(path.join(projectDir, filePath), "utf-8");
}

function writeFile(projectDir: string, filePath: string, content: string) {
  const fullPath = path.join(projectDir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function postProcessEnvExample(projectDir: string, config: ProjectConfig) {
  let content = readFile(projectDir, ".env.example").replace(
    "BOT_USERNAME=my-bot",
    `BOT_USERNAME=${config.name}`
  );

  for (const adapter of config.platformAdapters) {
    content += `\n# ${adapter.name}\n`;
    for (const env of adapter.envVars) {
      const suffix = env.required ? "" : " (optional)";
      content += `# ${env.description}${suffix}\n`;
      content += `${env.name}=\n`;
    }
  }

  if (config.stateAdapter.envVars.length > 0) {
    content += `\n# ${config.stateAdapter.name} State\n`;
    for (const env of config.stateAdapter.envVars) {
      content += `# ${env.description}\n`;
      content += `${env.name}=\n`;
    }
  }

  writeFile(projectDir, ".env.example", content);
}

function postProcessNextConfig(projectDir: string, config: ProjectConfig) {
  const externalPkgs = config.platformAdapters.flatMap(
    (a) => a.serverExternalPackages
  );
  if (externalPkgs.length === 0) {
    return;
  }

  const pkgList = externalPkgs.map((p) => `    "${p}",`).join("\n");
  const content = readFile(projectDir, "next.config.ts").replace(
    "const nextConfig: NextConfig = {};",
    `const nextConfig: NextConfig = {\n  serverExternalPackages: [\n${pkgList}\n  ],\n};`
  );
  writeFile(projectDir, "next.config.ts", content);
}

export async function scaffold(
  config: ProjectConfig,
  yes = false,
  quiet = false
) {
  const projectDir = path.resolve(process.cwd(), config.name);

  if (
    fs.existsSync(projectDir) &&
    fs.readdirSync(projectDir).length > 0 &&
    !yes
  ) {
    const shouldContinue = await confirm({
      message: `Directory "${config.name}" already exists and is not empty. Continue?`,
      initialValue: false,
    });
    if (!shouldContinue || isCancel(shouldContinue)) {
      process.exit(0);
    }
  }

  const s = quiet ? null : spinner();
  s?.start("Creating project files");

  const templateDir = path.resolve(__dirname, "..", "_template");
  copyDir(templateDir, projectDir);

  postProcessEnvExample(projectDir, config);
  postProcessNextConfig(projectDir, config);

  const pkgArgs = [`name=${config.name}`];
  if (config.description) {
    pkgArgs.push(`description=${config.description}`);
  }
  for (const adapter of config.platformAdapters) {
    pkgArgs.push(`dependencies.${adapter.package}=latest`);
  }
  pkgArgs.push(`dependencies.${config.stateAdapter.package}=latest`);
  await execa("npm", ["pkg", "set", ...pkgArgs], { cwd: projectDir });

  writeFile(projectDir, "src/lib/bot.ts", botTs(config));

  s?.stop("Project files created!");

  if (config.shouldInstall) {
    const installSpinner = quiet ? null : spinner();
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
    }
  }
}
