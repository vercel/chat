import { createMockAdapter, createMockState } from "@chat-adapter/tests";
import { type ActionEvent, Chat, type Message, type Thread } from "chat";
import { describe, expectTypeOf, it } from "vitest";
import { type ClaudeDriverOptions, createClaudeDriver } from "./claude/index";
import { type CursorDriverOptions, createCursorDriver } from "./cursor/index";
import {
  createManagedAgent,
  type ManagedAgent,
  type ManagedAgentDriver,
  type ManagedAgentEvent,
  type ManagedAgentOptions,
} from "./index";
import { createOpenAIDriver, type OpenAIDriverOptions } from "./openai/index";

declare const driver: ManagedAgentDriver;

describe("public API types", () => {
  it("plugs into Chat handlers with custom thread state", () => {
    interface MyState {
      plan: "free" | "pro";
    }
    const bot = new Chat<
      { slack: ReturnType<typeof createMockAdapter> },
      MyState
    >({
      adapters: { slack: createMockAdapter() },
      state: createMockState(),
      userName: "bot",
    });
    const agent = createManagedAgent({ driver });

    bot.onNewMention((thread, message, context) =>
      agent.reply(thread, message, context)
    );
    bot.onSubscribedMessage((thread, message, context) =>
      agent.reply(thread, message, context)
    );
    bot.onAction([...agent.actionIds], (event) => agent.handleAction(event));

    expectTypeOf(agent.reply<MyState>)
      .parameter(0)
      .toEqualTypeOf<Thread<MyState>>();
    expectTypeOf(agent.reply).parameter(1).toEqualTypeOf<Message>();
    expectTypeOf(agent.handleAction).parameter(0).toEqualTypeOf<ActionEvent>();
    expectTypeOf(agent.actionIds).toEqualTypeOf<readonly string[]>();
  });

  it("keeps the driver event union closed", () => {
    expectTypeOf<ManagedAgentEvent["type"]>().toEqualTypeOf<
      | "text-delta"
      | "message"
      | "tool-call"
      | "approval-request"
      | "turn-end"
      | "session-ended"
    >();
  });

  it("makes approvals optional for drivers", () => {
    const minimal: ManagedAgentDriver = {
      createSession: () => Promise.resolve("s"),
      name: "minimal",
      resumeSession: () => Promise.resolve(true),
      async *runTurn() {
        yield { reason: "complete", type: "turn-end" };
      },
    };
    expectTypeOf(minimal.respondToApproval).toEqualTypeOf<
      ManagedAgentDriver["respondToApproval"]
    >();
    expectTypeOf(
      createManagedAgent({ driver: minimal })
    ).toEqualTypeOf<ManagedAgent>();
  });

  it("types managed agent options", () => {
    expectTypeOf<ManagedAgentOptions["taskDisplay"]>().toEqualTypeOf<
      "timeline" | "plan" | undefined
    >();
    // @ts-expect-error driver is required
    createManagedAgent({});
  });

  it("lets the Claude driver read every option from the environment", () => {
    expectTypeOf(createClaudeDriver).toBeCallableWith();
    expectTypeOf<ClaudeDriverOptions>().toEqualTypeOf<
      Partial<ClaudeDriverOptions>
    >();
    expectTypeOf(createClaudeDriver()).toEqualTypeOf<ManagedAgentDriver>();
  });

  it("requires agent options for the Cursor driver", () => {
    // @ts-expect-error agent options are required
    createCursorDriver();
    expectTypeOf<CursorDriverOptions["send"]>().not.toHaveProperty("onDelta");
    expectTypeOf(
      createCursorDriver({ agent: { cloud: { repos: [] } } })
    ).toEqualTypeOf<ManagedAgentDriver>();
  });

  it("lets the OpenAI driver read its agent from the environment", () => {
    expectTypeOf(createOpenAIDriver).toBeCallableWith();
    expectTypeOf<OpenAIDriverOptions>().toEqualTypeOf<
      Partial<OpenAIDriverOptions>
    >();
    expectTypeOf(
      createOpenAIDriver({ environment: { type: "openai_hosted" } })
    ).toEqualTypeOf<ManagedAgentDriver>();
    // @ts-expect-error unknown environment types are rejected
    createOpenAIDriver({ environment: { type: "cloud" } });
  });
});
