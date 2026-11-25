import { describe, expect, it } from "vitest";
import { layoutFallbackCard } from "../../tests/src/layout-fallback.fixture";
import { cardToDiscordPayload } from "./cards";
import { DiscordContentFormat } from "./types";

describe("portable section layout fallbacks", () => {
  for (const contentFormat of [
    DiscordContentFormat.Embeds,
    DiscordContentFormat.ComponentsV2,
  ]) {
    it.each([
      "columns",
      "carousel",
    ] as const)(`preserves %s text and controls in ${contentFormat}`, (layout) => {
      const output = cardToDiscordPayload(layoutFallbackCard(layout, true), {
        contentFormat,
      });
      expect(output).toEqual(
        cardToDiscordPayload(layoutFallbackCard(undefined, true), {
          contentFormat,
        })
      );
      const payload = JSON.stringify(output);
      for (const content of [
        "First column",
        "First details",
        "Second column",
        "approve",
        "v1",
        "https://example.com/docs",
      ]) {
        expect(payload).toContain(content);
      }
      if (contentFormat === DiscordContentFormat.ComponentsV2) {
        expect(payload).toContain("priority");
        expect(payload).toContain("region");
      }
      expect(payload.indexOf("First column")).toBeLessThan(
        payload.indexOf("Second column")
      );
    });
  }
});
