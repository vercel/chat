import { AuthenticationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vitest";
import { SlackAdapter } from "./index";

describe("concurrency scope", () => {
  it("preserves unscoped single-workspace keys", () => {
    const adapter = new SlackAdapter({
      signingSecret: "local",
      botToken: "xoxb-local",
    });
    expect(adapter.getConcurrencyScope()).toBeUndefined();
  });

  it("rejects missing multi-workspace context", () => {
    const adapter = new SlackAdapter({ signingSecret: "local" });
    expect(() => adapter.getConcurrencyScope()).toThrow(AuthenticationError);
  });

  it("keeps installation scopes stable across token rotation", () => {
    const adapter = new SlackAdapter({ signingSecret: "local" });
    const first = adapter.withBotToken(
      "xoxb-before",
      () => adapter.getConcurrencyScope(),
      { installationId: "T_A" }
    );
    const second = adapter.withBotToken(
      "xoxb-after",
      () => adapter.getConcurrencyScope(),
      { installationId: "T_A" }
    );
    expect(first).toBe(second);
    expect(first).not.toContain("xoxb");
  });

  it("separates installations", () => {
    const adapter = new SlackAdapter({ signingSecret: "local" });
    const organization = adapter.withBotToken(
      "xoxb-org",
      () => adapter.getConcurrencyScope(),
      { installationId: "E_ORG" }
    );
    const workspace = adapter.withBotToken(
      "xoxb-org",
      () => adapter.getConcurrencyScope(),
      { installationId: "T_A" }
    );
    expect(organization).not.toBe(workspace);
  });

  it("keeps single-workspace token overrides unscoped", () => {
    const adapter = new SlackAdapter({
      signingSecret: "local",
      botToken: "xoxb-default",
    });
    expect(
      adapter.withBotToken("xoxb-first", () => adapter.getConcurrencyScope())
    ).toBeUndefined();
    expect(
      adapter.withBotToken("xoxb-first", () => adapter.getConcurrencyScope(), {
        installationId: "T_A",
      })
    ).toBeUndefined();
    expect(adapter.getConcurrencyScope()).toBeUndefined();
  });

  it("isolates multi-workspace token-only overrides without exposing credentials", () => {
    const adapter = new SlackAdapter({ signingSecret: "local" });
    const first = adapter.withBotToken("xoxb-first", () =>
      adapter.getConcurrencyScope()
    );
    const repeated = adapter.withBotToken("xoxb-first", () =>
      adapter.getConcurrencyScope()
    );
    const second = adapter.withBotToken("xoxb-second", () =>
      adapter.getConcurrencyScope()
    );
    expect(first).toBeDefined();
    expect(first).toBe(repeated);
    expect(first).not.toBe(second);
    expect(first).not.toContain("xoxb-first");
    expect(second).not.toContain("xoxb-second");
    expect(() => adapter.getConcurrencyScope()).toThrow(AuthenticationError);
  });

  it("keeps nested installation scopes isolated", () => {
    const adapter = new SlackAdapter({ signingSecret: "local" });
    adapter.withBotToken(
      "xoxb-A",
      () => {
        const first = adapter.getConcurrencyScope();
        const second = adapter.withBotToken(
          "xoxb-B",
          () => adapter.getConcurrencyScope(),
          { installationId: "T_B" }
        );
        expect(second).not.toBe(first);
        expect(adapter.getConcurrencyScope()).toBe(first);
      },
      { installationId: "T_A" }
    );
    expect(() => adapter.getConcurrencyScope()).toThrow(AuthenticationError);
  });
});
