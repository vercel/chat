import {
  type ActionEvent,
  Actions,
  Button,
  Card,
  type CardChild,
  type CardElement,
  CardText,
  ConsoleLogger,
  type Message,
  type MessageContext,
  type SentMessage,
  type StreamChunk,
  StreamingPlan,
  type Thread,
} from "chat";
import { type TurnOutcome, toChatStream } from "./render";
import type {
  ManagedAgentDriver,
  ManagedAgentEvent,
  ManagedAgentMessages,
  ManagedAgentOptions,
  PendingToolApproval,
  StoredSession,
} from "./types";

/** Action ID of the approval card's approve button. */
export const APPROVE_ACTION_ID = "managed-agents:approve";
/** Action ID of the approval card's deny button. */
export const DENY_ACTION_ID = "managed-agents:deny";

const DEFAULT_STATE_KEY = "managedAgent";
const TITLE_MAX = 60;
const TOOL_INPUT_MAX = 500;

const DEFAULT_MESSAGES: ManagedAgentMessages = {
  approvalResolved: (approved, userName) =>
    `${approved ? "Approved" : "Denied"} by ${userName}.`,
  approvalTitle: "Approval needed",
  approvalUnsupported:
    "The agent asked for an approval this bot can't handle. Update the agent's tool permissions, then start a new thread.",
  approveLabel: "Approve",
  connectionLost:
    "I lost my connection to the agent, but it may still be working. Check back in a minute or two before resending.",
  denyLabel: "Deny",
  sessionEnded:
    "This agent session is no longer available. Start a new thread to continue.",
  sessionLost:
    "Earlier context for this thread is no longer available, so I'm starting a fresh session.",
  stopped: (detail) =>
    detail
      ? `The agent stopped early (${detail}). Please try again.`
      : "The agent stopped early. Please try again.",
  turnFailed: "Something went wrong while running the agent. Please try again.",
};

/** Connects a hosted agent provider to Chat SDK threads. */
export interface ManagedAgent {
  /** Action IDs to register with `bot.onAction` for approval buttons. */
  readonly actionIds: readonly string[];
  /** The driver this agent uses. */
  readonly driver: ManagedAgentDriver;
  /**
   * Handle an approval button click. Ignores actions it does not own.
   *
   * @example
   * ```ts
   * bot.onAction([...agent.actionIds], (event) => agent.handleAction(event));
   * ```
   */
  handleAction(event: ActionEvent): Promise<void>;
  /**
   * Send a message to the thread's agent session and stream the reply.
   *
   * Creates a session on first use and stores its ID in thread state. With
   * the `queue` concurrency strategy, messages that arrived while the agent
   * was busy (`context.skipped`) are sent with the latest message.
   */
  reply<TState>(
    thread: Thread<TState>,
    message: Message,
    context?: MessageContext
  ): Promise<void>;
  /** Forget the thread's session. The next reply starts a new one. */
  resetSession<TState>(thread: Thread<TState>): Promise<void>;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function errorLabel(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

function isStoredSession(value: unknown): value is StoredSession {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredSession).driver === "string" &&
    typeof (value as StoredSession).sessionId === "string"
  );
}

function messageText(messages: Message[]): string {
  return messages
    .filter((m) => !m.author.isMe)
    .map((m) => m.text.trim())
    .filter((text) => text !== "")
    .join("\n\n");
}

function formatTools(tools: PendingToolApproval[]): string {
  return tools
    .map((tool) => {
      if (tool.input === undefined) {
        return `**${tool.name}**`;
      }
      let input: string;
      try {
        input = JSON.stringify(tool.input, null, 2) ?? String(tool.input);
      } catch {
        input = String(tool.input);
      }
      return `**${tool.name}**\n\`\`\`\n${truncate(input, TOOL_INPUT_MAX)}\n\`\`\``;
    })
    .join("\n\n");
}

async function* prepend<T>(
  first: T,
  rest: AsyncIterator<T>
): AsyncGenerator<T> {
  yield first;
  yield* { [Symbol.asyncIterator]: () => rest };
}

/**
 * Create a managed agent that runs one provider session per chat thread.
 *
 * @param options - Driver, messages, and state settings.
 * @returns A {@link ManagedAgent} to call from Chat SDK handlers.
 *
 * @example
 * ```ts
 * import { createManagedAgent } from "@chat-adapter/managed-agents";
 * import { createClaudeDriver } from "@chat-adapter/managed-agents/claude";
 *
 * const agent = createManagedAgent({
 *   driver: createClaudeDriver(),
 * });
 *
 * bot.onNewMention(async (thread, message, context) => {
 *   await thread.subscribe();
 *   await agent.reply(thread, message, context);
 * });
 * bot.onSubscribedMessage((thread, message, context) =>
 *   agent.reply(thread, message, context)
 * );
 * bot.onAction([...agent.actionIds], (event) => agent.handleAction(event));
 * ```
 */
export function createManagedAgent(options: ManagedAgentOptions): ManagedAgent {
  const { driver } = options;
  const stateKey = options.stateKey ?? DEFAULT_STATE_KEY;
  const messages: ManagedAgentMessages = {
    ...DEFAULT_MESSAGES,
    ...options.messages,
  };
  const logger =
    options.logger ?? new ConsoleLogger("warn", "chat-sdk:managed-agents");

  async function readSession<TState>(
    thread: Thread<TState>
  ): Promise<StoredSession | null> {
    const state = (await thread.state) as Record<string, unknown> | null;
    const stored = state?.[stateKey];
    return isStoredSession(stored) ? stored : null;
  }

  async function writeSession<TState>(
    thread: Thread<TState>,
    session: StoredSession | undefined
  ): Promise<void> {
    await thread.setState({ [stateKey]: session } as Partial<TState>);
  }

  async function ensureSession<TState>(
    thread: Thread<TState>,
    text: string
  ): Promise<string> {
    const stored = await readSession(thread);
    if (
      stored &&
      stored.driver === driver.name &&
      (await driver.resumeSession(stored.sessionId))
    ) {
      return stored.sessionId;
    }

    const sessionId = await driver.createSession({
      threadId: thread.id,
      title: truncate(text, TITLE_MAX),
    });
    await writeSession(thread, { driver: driver.name, sessionId });
    if (stored) {
      await thread.post(messages.sessionLost);
    }
    return sessionId;
  }

  function approvalCard(
    requestId: string,
    tools: PendingToolApproval[]
  ): CardElement {
    const children: CardChild[] = [];
    if (tools.length > 0) {
      children.push(CardText(formatTools(tools)));
    }
    children.push(
      Actions([
        Button({
          id: APPROVE_ACTION_ID,
          label: messages.approveLabel,
          style: "primary",
          value: requestId,
        }),
        Button({
          id: DENY_ACTION_ID,
          label: messages.denyLabel,
          style: "danger",
          value: requestId,
        }),
      ])
    );
    return Card({ title: messages.approvalTitle, children });
  }

  /**
   * Replace the streamed preview when the complete message diverged from it.
   *
   * An edit replaces the whole message, which would drop Slack task cards,
   * so a preview that already shows tool progress is kept. Previews are
   * prefixes of the complete text in almost every case.
   */
  async function reconcile<TState>(
    thread: Thread<TState>,
    outcome: TurnOutcome,
    sent: SentMessage | undefined
  ): Promise<void> {
    if (!outcome.mismatch || thread.signal.aborted) {
      return;
    }
    const text = outcome.finalText();
    if (!text) {
      return;
    }
    if (sent && !outcome.streamedTasks) {
      await sent.edit({ markdown: text });
      return;
    }
    logger.warn(
      `${driver.name} final message differs from its streamed preview; kept the preview`
    );
  }

  async function runTurn<TState>(
    thread: Thread<TState>,
    events: AsyncIterable<ManagedAgentEvent>
  ): Promise<void> {
    const { outcome, stream } = toChatStream(events);

    // Wait for the first chunk so a turn without output never posts an empty
    // streaming message.
    const first = await stream.next();
    if (!first.done) {
      const chunks = prepend<string | StreamChunk>(first.value, stream);
      let sent: SentMessage | undefined;
      if (options.taskDisplay) {
        // StreamingPlan carries stream options but returns no SentMessage.
        await thread.post(
          new StreamingPlan(chunks, { groupTasks: options.taskDisplay })
        );
      } else {
        sent = await thread.post(chunks);
      }
      await reconcile(thread, outcome, sent);
    }

    if (thread.signal.aborted) {
      return;
    }
    if (outcome.sessionEnded) {
      await writeSession(thread, undefined);
      await thread.post(messages.sessionEnded);
      return;
    }
    if (outcome.approval) {
      const { requestId, tools } = outcome.approval;
      await thread.post(
        driver.respondToApproval
          ? approvalCard(requestId, tools)
          : messages.approvalUnsupported
      );
      return;
    }
    if (!outcome.ended) {
      await thread.post(messages.connectionLost);
      return;
    }
    if (outcome.ended.reason === "stopped") {
      await thread.post(messages.stopped(outcome.ended.detail));
    }
  }

  async function guarded<TState>(
    thread: Thread<TState>,
    work: () => Promise<void>
  ): Promise<void> {
    try {
      await thread.startTyping();
    } catch {
      // Typing indicators are best-effort.
    }
    try {
      await work();
    } catch (error) {
      logger.error(`${driver.name} turn failed (${errorLabel(error)})`);
      if (!thread.signal.aborted) {
        await thread.post(messages.turnFailed).catch(() => undefined);
      }
    }
  }

  return {
    actionIds: [APPROVE_ACTION_ID, DENY_ACTION_ID],
    driver,

    async reply(thread, message, context) {
      const text = messageText([...(context?.skipped ?? []), message]);
      if (!text) {
        return;
      }
      await guarded(thread, async () => {
        const sessionId = await ensureSession(thread, text);
        await runTurn(
          thread,
          driver.runTurn({ sessionId, signal: thread.signal, text })
        );
      });
    },

    async handleAction(event) {
      if (
        event.actionId !== APPROVE_ACTION_ID &&
        event.actionId !== DENY_ACTION_ID
      ) {
        return;
      }
      const { thread, value: requestId } = event;
      if (!(thread && requestId && driver.respondToApproval)) {
        return;
      }
      const respond = driver.respondToApproval.bind(driver);
      const approved = event.actionId === APPROVE_ACTION_ID;

      const stored = await readSession(thread);
      if (!stored || stored.driver !== driver.name) {
        await thread.post(messages.sessionEnded);
        return;
      }

      const userName = event.user.fullName || event.user.userName;
      await event.adapter
        .editMessage(
          event.threadId,
          event.messageId,
          Card({
            title: messages.approvalTitle,
            children: [CardText(messages.approvalResolved(approved, userName))],
          })
        )
        .catch((error: unknown) => {
          logger.warn(`approval card update failed (${errorLabel(error)})`);
        });

      await guarded(thread, () =>
        runTurn(
          thread,
          respond({
            approved,
            requestId,
            sessionId: stored.sessionId,
            signal: thread.signal,
          })
        )
      );
    },

    async resetSession(thread) {
      await writeSession(thread, undefined);
    },
  };
}
