import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "./types.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
}));

vi.mock("./prompts.js", () => ({
  runPrompts: vi.fn(),
}));

vi.mock("./scaffold.js", () => ({
  scaffold: vi.fn().mockResolvedValue(undefined),
}));

import { intro, note, outro } from "@clack/prompts";
import { buildAdapterList, createProgram } from "./cli.js";
import { runPrompts } from "./prompts.js";
import { scaffold } from "./scaffold.js";

let exitSpy: ReturnType<typeof vi.spyOn>;
let consoleSpy: ReturnType<typeof vi.spyOn>;

const fakeConfig: ProjectConfig = {
  name: "my-bot",
  description: "A bot",
  platformAdapters: [],
  stateAdapter: {
    name: "In-Memory",
    value: "memory",
    package: "@chat-adapter/state-memory",
    factoryFn: "createMemoryState",
    hint: "development only",
    envVars: [],
  },
  shouldInstall: false,
  packageManager: "npm",
};

beforeEach(() => {
  vi.clearAllMocks();
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  exitSpy.mockRestore();
  consoleSpy.mockRestore();
});

describe("buildAdapterList", () => {
  it("groups platform adapters by category", () => {
    const result = buildAdapterList();
    expect(result).toContain("Messaging Platforms:");
    expect(result).toContain("slack");
    expect(result).toContain("Developer Tools:");
    expect(result).toContain("github");
  });

  it("includes state adapters", () => {
    const result = buildAdapterList();
    expect(result).toContain("State:");
    expect(result).toContain("memory");
    expect(result).toContain("redis");
  });
});

describe("createProgram", () => {
  it("returns a Commander program", () => {
    const prog = createProgram();
    expect(prog.name()).toBe("create-bot");
  });

  describe("--help", () => {
    it("includes SDK description", () => {
      const prog = createProgram();
      const help = prog.helpInformation();
      expect(help).toContain("Chat SDK is a unified TypeScript SDK by Vercel");
    });

    it("lists available adapters", () => {
      const prog = createProgram();
      let helpText = "";
      prog.configureOutput({
        writeOut: (str) => {
          helpText += str;
        },
      });
      prog.outputHelp();
      expect(helpText).toContain("Available adapters:");
      expect(helpText).toContain("Messaging Platforms:");
      expect(helpText).toContain("State:");
    });

    it("shows examples", () => {
      const prog = createProgram();
      let helpText = "";
      prog.configureOutput({
        writeOut: (str) => {
          helpText += str;
        },
      });
      prog.outputHelp();
      expect(helpText).toContain("Examples:");
      expect(helpText).toContain("$ create-bot my-bot");
    });
  });

  describe("action — successful flow", () => {
    it("calls runPrompts and scaffold", async () => {
      vi.mocked(runPrompts).mockResolvedValueOnce(fakeConfig);
      const prog = createProgram();
      await prog.parseAsync(["node", "create-bot", "my-bot", "-yq"]);

      expect(runPrompts).toHaveBeenCalled();
      expect(scaffold).toHaveBeenCalledWith(fakeConfig, true, true);
    });

    it("shows intro, note, and outro when not quiet", async () => {
      vi.mocked(runPrompts).mockResolvedValueOnce(fakeConfig);
      const prog = createProgram();
      await prog.parseAsync(["node", "create-bot", "my-bot", "-y"]);

      expect(intro).toHaveBeenCalled();
      expect(note).toHaveBeenCalled();
      expect(outro).toHaveBeenCalledWith(expect.stringContaining("Done!"));
    });

    it("hides intro, note, and outro when quiet", async () => {
      vi.mocked(runPrompts).mockResolvedValueOnce(fakeConfig);
      const prog = createProgram();
      await prog.parseAsync(["node", "create-bot", "my-bot", "-yq"]);

      expect(intro).not.toHaveBeenCalled();
      expect(note).not.toHaveBeenCalled();
      expect(outro).not.toHaveBeenCalled();
    });

    it("defaults yes and quiet to false when not passed", async () => {
      vi.mocked(runPrompts).mockResolvedValueOnce(fakeConfig);
      const prog = createProgram();
      await prog.parseAsync(["node", "create-bot", "my-bot"]);

      expect(runPrompts).toHaveBeenCalledWith(
        expect.anything(),
        "my-bot",
        undefined,
        undefined,
        undefined,
        false,
        false
      );
    });

    it("passes flags to runPrompts", async () => {
      vi.mocked(runPrompts).mockResolvedValueOnce(fakeConfig);
      const prog = createProgram();
      await prog.parseAsync([
        "node",
        "create-bot",
        "my-bot",
        "-d",
        "desc",
        "--adapter",
        "slack",
        "redis",
        "--pm",
        "pnpm",
        "-yq",
      ]);

      expect(runPrompts).toHaveBeenCalledWith(
        expect.anything(),
        "my-bot",
        "desc",
        ["slack", "redis"],
        "pnpm",
        true,
        true
      );
    });
  });

  describe("action — cancelled flow", () => {
    it("calls process.exit when prompts return null", async () => {
      vi.mocked(runPrompts).mockResolvedValueOnce(null);
      const prog = createProgram();

      await expect(
        prog.parseAsync(["node", "create-bot", "my-bot", "-yq"])
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(scaffold).not.toHaveBeenCalled();
    });

    it("shows cancelled outro when not quiet", async () => {
      vi.mocked(runPrompts).mockResolvedValueOnce(null);
      const prog = createProgram();

      await expect(
        prog.parseAsync(["node", "create-bot", "my-bot", "-y"])
      ).rejects.toThrow("process.exit");
      expect(outro).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
    });

    it("skips cancelled outro when quiet", async () => {
      vi.mocked(runPrompts).mockResolvedValueOnce(null);
      const prog = createProgram();

      await expect(
        prog.parseAsync(["node", "create-bot", "my-bot", "-yq"])
      ).rejects.toThrow("process.exit");
      expect(outro).not.toHaveBeenCalled();
    });
  });
});
