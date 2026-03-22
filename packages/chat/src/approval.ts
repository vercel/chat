/**
 * Human-in-the-loop approval system for Chat SDK.
 *
 * Provides `thread.requestApproval()` (Layer 1) and `thread.runAgent()` (Layer 2):
 *
 * **Layer 1 — `requestApproval()`**
 * Posts a rich approval Card with Approve/Deny buttons, persists the pending
 * approval in the StateAdapter (survives server restarts), and returns a Promise
 * that resolves when the user clicks a button.
 *
 * **Layer 2 — `runAgent()`**
 * Runs an AI SDK agent, automatically handles `needsApproval` tool calls by
 * posting approval cards via `requestApproval()`, and resumes the agent with
 * the user's decision. Loops until the agent finishes.
 *
 * @example Layer 1 — `requestApproval()`
 * ```tsx
 * const { approved, user } = await thread.requestApproval({
 *   title: "Transfer Money",
 *   fields: { Amount: "$500", To: "acct_123" },
 * });
 * ```
 *
 * @example Layer 2 — `runAgent()`
 * ```tsx
 * const result = await thread.runAgent(agent, {
 *   prompt: history,
 *   approvalCard: (toolCall) => ({
 *     title: `🔒 Confirm ${toolCall.toolName}`,
 *     fields: toolCall.input,
 *   }),
 * });
 * await thread.post(result.fullStream);
 * ```
 *
 * @module
 */

import type { CardChild, CardElement } from "./cards";
import { Actions, Button, Card, Divider, Field, Fields, Text } from "./cards";
import type { SerializedMessage } from "./message";
import type { SerializedThread } from "./thread";
import type { ActionEvent, Author, StateAdapter } from "./types";

// ============================================================================
// Constants
// ============================================================================

/** Prefix for approval action IDs on buttons */
export const APPROVAL_PREFIX = "__approval";

/** Key prefix for pending approvals in the StateAdapter */
const APPROVAL_STATE_KEY_PREFIX = "pending-approval:";

/** Default TTL for pending approvals (24 hours) */
const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Types — requestApproval (Layer 1)
// ============================================================================

/** Options for building an approval card */
export interface ApprovalCardOptions {
  /** Custom approve button label @default "Approve" */
  approveLabel?: string;
  /** Additional card children inserted before the action buttons */
  children?: CardChild[];
  /** Custom deny button label @default "Deny" */
  denyLabel?: string;
  /** Optional description text shown below the title */
  description?: string;
  /** Key-value fields to display (e.g. `{ Amount: "$500", To: "acct_123" }`) */
  fields?: Record<string, string>;
  /** Unique ID for this approval (typically toolCallId or a UUID) */
  id: string;
  /** Card title */
  title: string;
}

/** Full options for `thread.requestApproval()` */
export interface RequestApprovalOptions extends ApprovalCardOptions {
  /**
   * Arbitrary metadata to persist alongside the approval.
   * Useful for storing context needed to resume agent execution after a restart.
   *
   * @example
   * ```ts
   * await thread.requestApproval({
   *   id: toolCall.toolCallId,
   *   title: "Transfer Money",
   *   metadata: { toolName: "transferMoney", args: toolCall.args, history },
   * });
   * ```
   */
  metadata?: Record<string, unknown>;
  /**
   * TTL for the pending approval in the state adapter.
   * After this time the approval is considered expired.
   * @default 86_400_000 (24 hours)
   */
  ttlMs?: number;
  /**
   * Update the card after the user responds to show the decision.
   * @default true
   */
  updateCard?: boolean;
}

/** Result returned when a user responds to an approval card */
export interface ApprovalResult {
  /** Whether the user approved or denied */
  approved: boolean;
  /** The approval ID (matches the `id` passed to `requestApproval`) */
  id: string;
  /** The metadata passed to `requestApproval` (if any) */
  metadata?: Record<string, unknown>;
  /** Optional reason for the decision (forwarded to AI SDK as `reason` on tool-approval-response) */
  reason?: string;
  /** The user who responded */
  user: Author;
}

// ============================================================================
// Types — onApprovalResponse (restart recovery)
// ============================================================================

/**
 * Event emitted when an approval response arrives after a server restart.
 * The in-memory promise from `requestApproval()` is gone, so this handler
 * gives the developer a chance to resume the agent or workflow.
 */
export interface ApprovalResponseEvent {
  /** Whether the user approved */
  approved: boolean;
  /** The full action event from the platform */
  event: ActionEvent;
  /** The approval ID */
  id: string;
  /** The metadata stored with the original `requestApproval()` call */
  metadata?: Record<string, unknown>;
  /** The user who clicked the button */
  user: Author;
}

/** Handler for approval responses that arrive after a server restart */
export type ApprovalResponseHandler = (
  event: ApprovalResponseEvent
) => void | Promise<void>;

// ============================================================================
// Types — runAgent (Layer 2)
// ============================================================================

/**
 * Callback to customize the approval card for a specific tool call.
 * Return the card options (title, fields, description, etc.).
 */
export type ApprovalCardCallback = (toolCall: {
  input: Record<string, unknown>;
  toolCallId: string;
  toolName: string;
}) => Omit<ApprovalCardOptions, "id">;

/**
 * Options for `thread.runAgent()`.
 */
export interface RunAgentOptions {
  /**
   * Customize the approval card for each tool call that needs approval.
   * Receives the tool call and returns card options.
   *
   * @default Generates a card with the tool name as title and args as fields.
   *
   * @example
   * ```ts
   * approvalCard: (toolCall) => ({
   *   title: `Confirm ${toolCall.toolName}`,
   *   description: "This action requires your approval.",
   *   fields: { Amount: toolCall.input.amount },
   * })
   * ```
   */
  approvalCard?: ApprovalCardCallback;
  /** Conversation history / prompt to send to the agent */
  prompt: unknown;
  /**
   * Additional options passed through to `agent.generate()`.
   */
  [key: string]: unknown;
}

/**
 * Minimal agent interface for `thread.runAgent()`.
 * Compatible with AI SDK's `ToolLoopAgent` without importing it.
 */
export interface AgentLike {
  generate(options: {
    messages?: unknown[];
    prompt?: unknown;
    [key: string]: unknown;
  }): Promise<AgentResultLike>;
}

/**
 * Minimal agent result interface.
 * Compatible with AI SDK's `generate()` result shape.
 */
export interface AgentResultLike {
  /** Content parts — may include `tool-approval-request` parts */
  content: Array<{ type: string; [key: string]: unknown }>;
  /** The full stream for streaming to the client */
  fullStream?: AsyncIterable<unknown>;
  /** The response messages for resuming the agent */
  response: { messages: unknown[] };
  /** The final text output */
  text?: string | Promise<string>;
  [key: string]: unknown;
}

// ============================================================================
// Types — State Persistence
// ============================================================================

/** Internal state persisted in the StateAdapter for each pending approval */
export interface StoredApproval {
  /** Adapter name for rehydration */
  adapterName: string;
  /** Timestamp when the approval was created */
  createdAt: string;
  /** Key-value fields from the card (for card update after restart) */
  fields?: Record<string, string>;
  /** The approval ID */
  id: string;
  /** Developer-supplied metadata */
  metadata?: Record<string, unknown>;
  /** Serialized SentMessage for updating the card after restart */
  sentMessage?: SerializedMessage;
  /** Serialized thread for rehydration after restart */
  thread: SerializedThread;
  /** Card title (for card update after restart) */
  title: string;
  /** Whether to update the card after the decision */
  updateCard: boolean;
}

// ============================================================================
// Card Builders
// ============================================================================

/**
 * Build an approval card element.
 *
 * Uses deterministic action IDs (`__approval:{id}:approve` / `__approval:{id}:deny`)
 * so the Chat SDK can automatically intercept button clicks without any
 * manual `onAction` registration.
 */
export function buildApprovalCard(options: ApprovalCardOptions): CardElement {
  const children: CardChild[] = [];

  if (options.description) {
    children.push(Text(options.description));
  }

  if (options.fields && Object.keys(options.fields).length > 0) {
    children.push(
      Fields(
        Object.entries(options.fields).map(([label, value]) =>
          Field({ label, value: String(value) })
        )
      )
    );
  }

  if (options.children) {
    children.push(...options.children);
  }

  children.push(Divider());
  children.push(
    Actions([
      Button({
        id: `${APPROVAL_PREFIX}:${options.id}:approve`,
        label: options.approveLabel ?? "Approve",
        style: "primary",
      }),
      Button({
        id: `${APPROVAL_PREFIX}:${options.id}:deny`,
        label: options.denyLabel ?? "Deny",
        style: "danger",
      }),
    ])
  );

  return Card({ title: options.title, children });
}

/**
 * Build a card to replace the approval card after the user responds.
 */
export function buildResolvedCard(
  title: string,
  approved: boolean,
  user: Author,
  fields?: Record<string, string>
): CardElement {
  const status = approved ? "✅ Approved" : "❌ Denied";
  const userName = user.userName ?? user.fullName ?? "a user";
  const children: CardChild[] = [Text(`${status} by ${userName}`)];

  if (fields && Object.keys(fields).length > 0) {
    children.push(
      Fields(
        Object.entries(fields).map(([label, value]) =>
          Field({ label, value: String(value) })
        )
      )
    );
  }

  return Card({ title: `${status} — ${title}`, children });
}

/**
 * Build a card for when an approval request has expired.
 */
export function buildExpiredCard(title: string): CardElement {
  return Card({
    title: `⏰ Expired — ${title}`,
    children: [Text("This approval request has expired. Please try again.")],
  });
}

// ============================================================================
// Action ID Parsing
// ============================================================================

/**
 * Check if an action ID matches the approval pattern and extract the decision.
 * Returns `null` if the action ID is not an approval action.
 *
 * @example
 * ```ts
 * parseApprovalAction("__approval:txn_123:approve")
 * // => { id: "txn_123", approved: true }
 *
 * parseApprovalAction("some_other_action")
 * // => null
 * ```
 */
export function parseApprovalAction(
  actionId: string
): { id: string; approved: boolean } | null {
  const prefix = `${APPROVAL_PREFIX}:`;
  if (!actionId.startsWith(prefix)) {
    return null;
  }
  // Extract decision from the last segment, ID is everything in between.
  // This supports IDs containing colons (e.g. "tool:call_abc").
  const rest = actionId.slice(prefix.length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon === -1 || lastColon === 0) {
    return null;
  }
  const id = rest.slice(0, lastColon);
  const decision = rest.slice(lastColon + 1);
  if (decision !== "approve" && decision !== "deny") {
    return null;
  }
  return { id, approved: decision === "approve" };
}

/**
 * Quick boolean check: is this action ID an approval action?
 */
export function isApprovalActionId(actionId: string): boolean {
  return actionId.startsWith(`${APPROVAL_PREFIX}:`);
}

// ============================================================================
// State Persistence Helpers
// ============================================================================

function approvalStateKey(id: string): string {
  return `${APPROVAL_STATE_KEY_PREFIX}${id}`;
}

/**
 * Persist a pending approval in the state adapter.
 */
export async function storePendingApproval(
  stateAdapter: StateAdapter,
  approval: StoredApproval,
  ttlMs: number = DEFAULT_APPROVAL_TTL_MS
): Promise<void> {
  await stateAdapter.set(approvalStateKey(approval.id), approval, ttlMs);
}

/**
 * Retrieve and delete a pending approval from the state adapter.
 * Returns `null` if not found (expired or already consumed).
 * The delete-on-read prevents double-processing from double-clicks.
 */
export async function consumePendingApproval(
  stateAdapter: StateAdapter,
  id: string
): Promise<StoredApproval | null> {
  const key = approvalStateKey(id);
  const stored = await stateAdapter.get<StoredApproval>(key);
  if (stored) {
    await stateAdapter.delete(key);
  }
  return stored;
}

// ============================================================================
// In-Memory Promise Registry
// ============================================================================

/**
 * Registry for in-memory approval promise resolvers.
 *
 * When `thread.requestApproval()` is called, it registers a resolver here.
 * When the button click arrives in the same process, we resolve the promise
 * directly — no state adapter round-trip needed.
 *
 * If the server restarted between posting the card and the button click,
 * this map is empty and the Chat class falls back to the `onApprovalResponse`
 * handler using the persisted `StoredApproval`.
 */
export class ApprovalRegistry {
  private readonly pending = new Map<
    string,
    {
      resolve: (result: ApprovalResult) => void;
      reject: (error: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * Register a pending approval and return a Promise that resolves
   * when the user clicks Approve or Deny (in the same process).
   */
  register(id: string, ttlMs: number): Promise<ApprovalResult> {
    // Clean up any existing entry for the same ID
    this.remove(id);

    return new Promise<ApprovalResult>((resolve, reject) => {
      const timer =
        ttlMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Approval request "${id}" timed out`));
            }, ttlMs)
          : undefined;

      this.pending.set(id, { resolve, reject, timer });
    });
  }

  /**
   * Resolve a pending approval. Returns `true` if the promise was found
   * and resolved (same process), `false` if not found (restart case).
   */
  resolve(id: string, result: ApprovalResult): boolean {
    const entry = this.pending.get(id);
    if (!entry) {
      return false;
    }

    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    this.pending.delete(id);
    entry.resolve(result);
    return true;
  }

  /**
   * Remove a pending approval without resolving it.
   */
  remove(id: string): void {
    const entry = this.pending.get(id);
    if (entry) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
      this.pending.delete(id);
    }
  }

  /**
   * Check if an approval is pending in memory.
   */
  has(id: string): boolean {
    return this.pending.has(id);
  }
}

// ============================================================================
// Default Approval Card Builder
// ============================================================================

/**
 * Default `approvalCard` callback used by `thread.runAgent()` when
 * the developer doesn't provide a custom one.
 *
 * Uses the tool name as title and stringifies the input as fields.
 */
export function defaultApprovalCard(toolCall: {
  input: Record<string, unknown>;
  toolCallId: string;
  toolName: string;
}): Omit<ApprovalCardOptions, "id"> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(toolCall.input)) {
    if (value === null || value === undefined) {
      fields[key] = "—";
    } else if (typeof value === "object") {
      fields[key] = JSON.stringify(value);
    } else {
      fields[key] = String(value);
    }
  }

  return {
    title: `🔒 ${toolCall.toolName}`,
    fields,
  };
}
