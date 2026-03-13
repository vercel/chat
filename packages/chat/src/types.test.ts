import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function createTempProject(source: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), "chat-public-types-"));

  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      typeRoots: [join(import.meta.dirname, "../../../node_modules/@types")],
      paths: {
        chat: [join(import.meta.dirname, "index.ts")],
      },
    },
    include: [join(tempDir, "index.ts")],
  };

  writeFileSync(
    join(tempDir, "tsconfig.json"),
    JSON.stringify(tsconfig, null, 2)
  );
  writeFileSync(join(tempDir, "index.ts"), source);

  return tempDir;
}

describe("chat public types", () => {
  it("exposes Thread.toJSON() to consumers", () => {
    const tempDir = createTempProject(`
import type { SerializedThread, Thread } from "chat";

declare const thread: Thread<{ count: number }>;

const serialized: SerializedThread = thread.toJSON();

serialized satisfies SerializedThread;
`);

    try {
      execSync(`pnpm exec tsc --project ${tempDir}/tsconfig.json --noEmit`, {
        cwd: join(import.meta.dirname, ".."),
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string };
      const output = execError.stdout || execError.stderr || String(error);
      rmSync(tempDir, { recursive: true, force: true });

      expect.fail(
        "Consumer Thread.toJSON() type-check failed:\n\n" +
          output +
          "\n\nSnippet tested:\n" +
          'import type { SerializedThread, Thread } from "chat";\n' +
          "declare const thread: Thread<{ count: number }>;\n" +
          "const serialized: SerializedThread = thread.toJSON();\n"
      );
    }

    rmSync(tempDir, { recursive: true, force: true });
  });
});
