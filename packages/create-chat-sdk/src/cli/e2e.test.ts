import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ADAPTER_NAMES, getAdapter, listEnvVars } from "chat/adapters";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCliCompatibleAdapter } from "../catalog/compatibility.js";
import { createProgram } from "./program.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tmpDir: string;

const projectName = (slug: string): string => `bot-${slug}`;

const readProjectFile = (name: string, filePath: string): string =>
  fs.readFileSync(path.join(tmpDir, name, filePath), "utf-8");

const runCli = async (name: string, adapters: readonly string[]) => {
  process.exitCode = undefined;
  const program = createProgram();
  await program.parseAsync([
    "node",
    "create-chat-sdk",
    name,
    "--adapter",
    ...adapters,
    "-yq",
    "--skip-install",
    "--no-git",
  ]);
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "create-chat-sdk-e2e-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CLI adapter matrix", () => {
  for (const slug of ADAPTER_NAMES) {
    const adapter = getAdapter(slug);
    if (!adapter) {
      throw new Error(`Missing catalog adapter: ${slug}`);
    }

    if (!isCliCompatibleAdapter(slug)) {
      continue;
    }

    it(`scaffolds ${slug}`, async () => {
      const name = projectName(slug);
      const adapters =
        adapter.type === "state" ? ["slack", slug] : [slug, "memory"];

      await runCli(name, adapters);
      expect(process.exitCode).toBeUndefined();

      const botTs = readProjectFile(name, "src/lib/bot.ts");
      const envExample = readProjectFile(name, ".env.example");
      const packageJson = JSON.parse(readProjectFile(name, "package.json")) as {
        dependencies?: Record<string, string>;
      };

      expect(botTs).toContain(adapter.factoryExport);
      expect(packageJson.dependencies?.[adapter.packageName]).toBe("latest");

      for (const envVar of listEnvVars(slug)) {
        expect(envExample).toContain(`${envVar.key}=`);
      }

      if (adapter.type === "platform") {
        expect(botTs).toContain(`${adapter.slug}:`);
      } else {
        expect(botTs).toContain(`state: ${adapter.factoryExport}`);
      }
    });
  }
});

describe("CLI Vercel Connect mode", () => {
  it("scaffolds Slack with Vercel Connect when --connect is passed", async () => {
    process.exitCode = undefined;
    const program = createProgram();
    await program.parseAsync([
      "node",
      "create-chat-sdk",
      "connect-bot",
      "--adapter",
      "slack",
      "memory",
      "--connect",
      "-yq",
      "--skip-install",
      "--no-git",
    ]);

    expect(process.exitCode).toBeUndefined();

    const botTs = readProjectFile("connect-bot", "src/lib/bot.ts");
    expect(botTs).toContain(
      'import { connectSlackAdapter } from "@vercel/connect/chat";'
    );
    expect(botTs).toContain(
      '...connectSlackAdapter(requireEnv("SLACK_CONNECTOR")),'
    );

    const packageJson = JSON.parse(
      readProjectFile("connect-bot", "package.json")
    ) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies?.["@vercel/connect"]).toBe("latest");

    const envExample = readProjectFile("connect-bot", ".env.example");
    expect(envExample).toContain("SLACK_CONNECTOR=");
    expect(envExample).not.toContain("SLACK_SIGNING_SECRET=");
  });
});

describe("CLI agent mode", () => {
  it("runs non-interactively when an agent environment is detected", async () => {
    vi.stubEnv("AI_AGENT", "cursor");
    process.exitCode = undefined;
    try {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "create-chat-sdk",
        "--adapter",
        "slack",
        "memory",
        "--skip-install",
        "--no-git",
        "--quiet",
      ]);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(process.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(tmpDir, "my-bot/package.json"))).toBe(true);
    expect(readProjectFile("my-bot", "src/lib/bot.ts")).toContain(
      "createSlackAdapter"
    );
  });
});
