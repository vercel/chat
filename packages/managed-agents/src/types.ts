import type { Logger } from "chat";

// =============================================================================
// Driver events
// =============================================================================

/**
 * A best-effort text fragment for an in-progress agent message.
 *
 * Drivers emit these as tokens arrive. When the provider later sends the
 * complete message (see {@link AgentMessageEvent}), the complete text wins.
 */
export interface AgentTextDeltaEvent {
  /** Stable ID of the agent message this fragment belongs to. */
  messageId: string;
  text: string;
  type: "text-delta";
}

/**
 * The complete, authoritative text of one agent message.
 *
 * Optional: drivers whose providers only stream deltas can skip it.
 */
export interface AgentMessageEvent {
  /** Stable ID of the agent message. Matches earlier `text-delta` events. */
  messageId: string;
  text: string;
  type: "message";
}

/** Tool call lifecycle, rendered as task progress where the platform supports it. */
export interface AgentToolCallEvent {
  /** Stable ID of the tool call. */
  id: string;
  /** Tool name. Optional on completion; the first event's name is reused. */
  name?: string;
  status: "running" | "complete" | "error";
  type: "tool-call";
}

/** A tool waiting for human approval. */
export interface PendingToolApproval {
  /** Provider ID of the pending tool call. */
  id: string;
  /** Tool input, shown on the approval card. */
  input?: unknown;
  name: string;
}

/**
 * The agent paused until a human approves or denies one or more tool calls.
 * Ends the current turn.
 */
export interface AgentApprovalRequestEvent {
  /** Opaque ID passed back to {@link ManagedAgentDriver.respondToApproval}. */
  requestId: string;
  tools: PendingToolApproval[];
  type: "approval-request";
}

/** The turn reached a terminal state. Ends the current turn. */
export interface AgentTurnEndEvent {
  /**
   * Provider-specific reason when `reason` is `"stopped"`, such as
   * `"budget_reached"`. Safe to show to users.
   */
  detail?: string;
  reason: "complete" | "stopped" | "cancelled";
  type: "turn-end";
}

/** The provider session is gone and cannot continue. Ends the current turn. */
export interface AgentSessionEndedEvent {
  type: "session-ended";
}

/** Normalized events every driver produces for one turn. */
export type ManagedAgentEvent =
  | AgentTextDeltaEvent
  | AgentMessageEvent
  | AgentToolCallEvent
  | AgentApprovalRequestEvent
  | AgentTurnEndEvent
  | AgentSessionEndedEvent;

// =============================================================================
// Driver contract
// =============================================================================

/** Context for creating a provider session for a chat thread. */
export interface CreateSessionContext {
  /** Chat SDK thread ID, e.g. `slack:C123:1234.5678`. */
  threadId: string;
  /** Short title derived from the first message. */
  title: string;
}

/** Input for one user turn. */
export interface RunTurnInput {
  sessionId: string;
  /** Aborted when the platform or app stops the turn. Drivers should interrupt the provider run. */
  signal: AbortSignal;
  text: string;
}

/** Input for resolving a pending approval. */
export interface RespondToApprovalInput {
  approved: boolean;
  /** The `requestId` from the {@link AgentApprovalRequestEvent}. */
  requestId: string;
  sessionId: string;
  signal: AbortSignal;
}

/**
 * Connects one hosted agent provider to Chat SDK.
 *
 * A driver owns everything provider-specific: creating and validating
 * sessions, sending turns, and translating provider events into
 * {@link ManagedAgentEvent}s. The shared core owns everything chat-specific.
 */
export interface ManagedAgentDriver {
  /** Create a new provider session and return its ID. */
  createSession(context: CreateSessionContext): Promise<string>;
  /** Stable driver name, stored with each session ID, e.g. `"claude"`. */
  readonly name: string;
  /**
   * Resolve a pending approval and stream the rest of the turn.
   * Omit when the provider has no approval API.
   */
  respondToApproval?(
    input: RespondToApprovalInput
  ): AsyncIterable<ManagedAgentEvent>;
  /**
   * Return `true` when a stored session ID can be used for another turn.
   *
   * Return `false` for sessions that are missing, ended, or owned by a
   * different agent. Throw for transient failures so callers do not discard
   * a healthy session.
   */
  resumeSession(sessionId: string): Promise<boolean>;
  /** Send one user turn and stream its events until the turn ends. */
  runTurn(input: RunTurnInput): AsyncIterable<ManagedAgentEvent>;
}

// =============================================================================
// Managed agent
// =============================================================================

/** User-facing messages posted by the managed agent. */
export interface ManagedAgentMessages {
  /** Line that replaces the approval buttons once someone decides. */
  approvalResolved: (approved: boolean, userName: string) => string;
  /** Approval card title. */
  approvalTitle: string;
  /** Posted when the agent needs an approval the driver cannot handle. */
  approvalUnsupported: string;
  /** Approve button label. */
  approveLabel: string;
  /** Posted when the event stream drops before the turn finishes. */
  connectionLost: string;
  /** Deny button label. */
  denyLabel: string;
  /** Posted when the provider ends the session. */
  sessionEnded: string;
  /** Posted when a new session replaces one that is no longer available. */
  sessionLost: string;
  /** Posted when the provider stops the turn early. Receives the reason. */
  stopped: (detail: string | undefined) => string;
  /** Posted when a turn fails unexpectedly. */
  turnFailed: string;
}

/** Options for {@link createManagedAgent}. */
export interface ManagedAgentOptions {
  /** Provider driver, e.g. `createClaudeDriver(...)` or `createCursorDriver(...)`. */
  driver: ManagedAgentDriver;
  /** Logger for sanitized diagnostics. Message content is never logged. */
  logger?: Pick<Logger, "error" | "warn">;
  /** Override any user-facing message. */
  messages?: Partial<ManagedAgentMessages>;
  /** Thread state key that stores the session. Default: `"managedAgent"`. */
  stateKey?: string;
  /**
   * How Slack shows tool progress: `"timeline"` shows each tool call as a
   * card next to the text, `"plan"` groups them into one plan block.
   * Defaults to Slack's default (`"timeline"`). Other platforms ignore it.
   */
  taskDisplay?: "timeline" | "plan";
}

/** Session reference stored in thread state. */
export interface StoredSession {
  driver: string;
  /**
   * `requestId` of the approval the latest turn ended on. Cleared when a
   * button is clicked or another turn starts, so each card is answered once.
   */
  pendingApproval?: string;
  sessionId: string;
}
