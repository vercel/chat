/**
 * Durable human-in-the-loop approvals for Chat SDK, built on Workflow SDK.
 *
 * `requestApproval()` must be called from inside a `"use workflow"` function.
 * It posts an interactive card with Approve/Deny buttons, suspends the
 * workflow until a user clicks (or an optional timeout elapses), finalizes
 * the card with the outcome, and returns the decision.
 *
 * Requires the `workflow` peer dependency and a registered Chat singleton
 * (`chat.registerSingleton()`) so threads can be revived across the
 * workflow/step boundary.
 *
 * @example
 * ```typescript
 * import { requestApproval } from "chat/workflow";
 *
 * export async function deployApproval(opts: { thread: Thread; version: string }) {
 *   "use workflow";
 *
 *   const { approved, user } = await requestApproval(opts.thread, {
 *     title: `Deploy ${opts.version}?`,
 *     fields: { Version: opts.version },
 *     timeout: "24h",
 *   });
 *
 *   if (approved) {
 *     await deploy(opts.version);
 *   }
 * }
 * ```
 */
import { createWebhook, sleep } from "workflow";
import type { CardElement } from "../cards";
import type { Thread } from "../types";
import {
  APPROVE_ACTION_ID,
  type ApprovalCardOptions,
  buildApprovalCard,
  buildResolvedCard,
  DENY_ACTION_ID,
} from "./approval-card";

export {
  APPROVE_ACTION_ID,
  type ApprovalCardOptions,
  buildApprovalCard,
  buildResolvedCard,
  DENY_ACTION_ID,
} from "./approval-card";

/** Durations accepted by `timeout`, e.g. `5000`, `"30m"`, `"24h"`. */
export type ApprovalTimeout =
  | number
  | `${number}${"ms" | "s" | "m" | "h" | "d"}`;

export interface RequestApprovalOptions extends ApprovalCardOptions {
  /**
   * User IDs allowed to decide. Clicks from anyone else post a notice to
   * the thread and the workflow keeps waiting. Omit to accept any user.
   */
  approvers?: string[];
  /**
   * How long to wait for a decision before giving up. When it elapses the
   * card is finalized as timed out and the result has `timedOut: true`.
   * Omit to wait indefinitely.
   */
  timeout?: ApprovalTimeout;
}

/** The user who clicked a button, from the action callback payload. */
export interface ApprovalUser {
  id: string;
  name?: string;
}

export interface ApprovalResult {
  /** True when the approve button was clicked */
  approved: boolean;
  /** True when `timeout` elapsed with no decision */
  timedOut: boolean;
  /** Who decided. Absent on timeout */
  user?: ApprovalUser;
}

/** Shape of the JSON body Chat SDK POSTs to a button's `callbackUrl`. */
interface ActionCallbackPayload {
  actionId?: string;
  messageId?: string;
  threadId?: string;
  type?: string;
  user?: { id?: string; name?: string };
  value?: string;
}

async function postApprovalCard(
  thread: Thread,
  card: CardElement
): Promise<string> {
  "use step";
  const sent = await thread.post(card);
  return sent.id;
}

async function finalizeApprovalCard(
  thread: Thread,
  messageId: string,
  card: CardElement
): Promise<void> {
  "use step";
  await thread.adapter.editMessage(thread.id, messageId, card);
}

async function postNotice(thread: Thread, markdown: string): Promise<void> {
  "use step";
  await thread.post({ markdown });
}

function describeUser(user: ApprovalUser): string {
  return user.name ? `@${user.name}` : user.id;
}

const TIMED_OUT = Symbol("timed-out");

/**
 * Post an approval card to a thread and suspend the workflow until a user
 * approves or denies, or the timeout elapses. Must run inside a
 * `"use workflow"` function.
 *
 * By default any authenticated user who clicks decides; pass `approvers` to
 * restrict who may approve (recommended for consequential actions).
 */
export async function requestApproval(
  thread: Thread,
  options: RequestApprovalOptions
): Promise<ApprovalResult> {
  using webhook = createWebhook();

  const messageId = await postApprovalCard(
    thread,
    buildApprovalCard(options, webhook.url)
  );

  const timeoutPromise = startTimeout(options.timeout);
  const clicks = webhook[Symbol.asyncIterator]();

  for (;;) {
    const next = await Promise.race([
      clicks.next(),
      ...(timeoutPromise ? [timeoutPromise] : []),
    ]);

    if (next === TIMED_OUT || next.done) {
      await finalizeApprovalCard(
        thread,
        messageId,
        buildResolvedCard(
          options,
          `Timed out after ${options.timeout} with no decision recorded.`
        )
      );
      return { approved: false, timedOut: true };
    }

    const payload = (await next.value
      .json()
      .catch(() => null)) as ActionCallbackPayload | null;
    const decision = parseDecision(payload);
    if (!decision) {
      // Not a recognizable button click (bad payload or foreign POST), so
      // keep waiting rather than resolving the approval on garbage input.
      continue;
    }

    if (options.approvers && !options.approvers.includes(decision.user.id)) {
      await postNotice(
        thread,
        `${describeUser(decision.user)} isn't authorized to decide "${options.title}".`
      );
      continue;
    }

    await finalizeApprovalCard(
      thread,
      messageId,
      buildResolvedCard(
        options,
        `${decision.approved ? "Approved" : "Denied"} by ${describeUser(decision.user)}.`
      )
    );
    return {
      approved: decision.approved,
      timedOut: false,
      user: decision.user,
    };
  }
}

function startTimeout(
  timeout: ApprovalTimeout | undefined
): Promise<typeof TIMED_OUT> | undefined {
  if (timeout === undefined) {
    return;
  }
  // sleep() is overloaded (number | duration-string | Date). The branches look
  // identical, but the typeof narrows the union so a single overload matches.
  // Calling sleep(number | string) with the union directly does not type-check.
  const sleeping =
    typeof timeout === "number" ? sleep(timeout) : sleep(timeout);
  return sleeping.then(() => TIMED_OUT);
}

function parseDecision(
  payload: ActionCallbackPayload | null
): { approved: boolean; user: ApprovalUser } | undefined {
  if (
    payload?.type !== "action" ||
    !payload.user?.id ||
    (payload.actionId !== APPROVE_ACTION_ID &&
      payload.actionId !== DENY_ACTION_ID)
  ) {
    return;
  }
  return {
    approved: payload.actionId === APPROVE_ACTION_ID,
    user: { id: payload.user.id, name: payload.user.name },
  };
}
