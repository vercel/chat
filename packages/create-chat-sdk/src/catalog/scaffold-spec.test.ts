import { listEnvVars } from "chat/adapters";
import { describe, expect, it } from "vitest";
import { CLI_SCAFFOLD_SPEC } from "./scaffold-spec.js";

/**
 * Env vars the generated bot.ts reads even though the adapter package never
 * reads them itself, so the catalog intentionally omits them (the catalog only
 * documents env vars backed by package source reads).
 */
const SPEC_ONLY_ENV_NAMES: Record<string, readonly string[]> = {
  ioredis: ["REDIS_URL"],
};

describe("CLI_SCAFFOLD_SPEC", () => {
  it("only references env vars documented in the adapter catalog", () => {
    for (const [slug, spec] of Object.entries(CLI_SCAFFOLD_SPEC)) {
      if (spec.invocation.kind !== "object") {
        continue;
      }
      const documented = new Set<string>(SPEC_ONLY_ENV_NAMES[slug] ?? []);
      for (const envVar of listEnvVars(slug)) {
        documented.add(envVar.key);
        for (const alias of envVar.aliases ?? []) {
          documented.add(alias);
        }
      }
      for (const property of spec.invocation.properties) {
        if (property.value.kind !== "env") {
          continue;
        }
        expect(
          documented.has(property.value.name),
          `${slug}: generated bot.ts reads ${property.value.name}, which the chat/adapters catalog does not document for this adapter — update the spec or the catalog`
        ).toBe(true);
      }
    }
  });
});
