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
import { createWebhook, FatalError, sleep } from "workflow";
import {
  deleteCallbackReceipt,
  isCallbackReceiptNonce,
  processCardCallbackUrls,
  readCallbackReceipt,
} from "../callback-url";
import type { CardElement } from "../cards";
import type { StateAdapter, Thread } from "../types";
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

/** The user who clicked a button, as verified by Chat SDK. */
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

interface ApprovalDecision {
  approved: boolean;
  user: ApprovalUser;
}

const UNSUPPORTED_THREAD_MESSAGE =
  "requestApproval() requires a thread created by Chat SDK so it can verify clicks against its state adapter";

type ThreadWithState = Thread & { getStateAdapter(): StateAdapter };

function hasStateAdapter(thread: Thread): thread is ThreadWithState {
  return (
    typeof (thread as { getStateAdapter?: unknown }).getStateAdapter ===
    "function"
  );
}

/**
 * Best-effort cleanup of a receipt the workflow has acted on. Single use is
 * enforced in the workflow, and receipts expire on their own, so a failed
 * delete must not fail or retry the step it runs in.
 */
async function discardReceipt(
  thread: Thread,
  nonce: string | undefined
): Promise<void> {
  if (!(nonce && hasStateAdapter(thread))) {
    return;
  }
  try {
    await deleteCallbackReceipt(thread.getStateAdapter(), nonce);
  } catch {
    // Ignored, see above.
  }
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
  card: CardElement,
  receipt?: string
): Promise<void> {
  "use step";
  await thread.adapter.editMessage(thread.id, messageId, card);
  await discardReceipt(thread, receipt);
}

async function rejectUnauthorizedClick(
  thread: Thread,
  messageId: string,
  pendingCard: CardElement,
  notice: string,
  receipt: string
): Promise<void> {
  "use step";
  // Callback tokens are single use, so this click spent its button. Re-arm
  // the card so an approver can still decide, without letting a failed edit
  // block the notice.
  try {
    if (hasStateAdapter(thread)) {
      const card = await processCardCallbackUrls(
        pendingCard,
        thread.getStateAdapter(),
        { id: thread.id, type: "thread" }
      );
      await thread.adapter.editMessage(thread.id, messageId, card);
    }
  } catch {
    // Ignored, see above.
  }
  await thread.post({ markdown: notice });
  await discardReceipt(thread, receipt);
}

/**
 * Resolve a click from the receipt Chat stored when it POSTed to the webhook.
 * Anyone holding the webhook URL can POST to it, so the body only supplies
 * the receipt nonce; the button and user come from server-side state. Reads
 * without consuming so a retry sees the same receipt.
 */
async function verifyDecision(
  thread: Thread,
  webhookUrl: string,
  nonce: string
): Promise<ApprovalDecision | null> {
  "use step";
  if (!hasStateAdapter(thread)) {
    throw new FatalError(UNSUPPORTED_THREAD_MESSAGE);
  }

  const receipt = await readCallbackReceipt(thread.getStateAdapter(), nonce, {
    url: webhookUrl,
    threadId: thread.id,
  });
  if (
    !receipt ||
    (receipt.actionId !== APPROVE_ACTION_ID &&
      receipt.actionId !== DENY_ACTION_ID)
  ) {
    return null;
  }
  return {
    approved: receipt.actionId === APPROVE_ACTION_ID,
    user: { id: receipt.user.id, name: receipt.user.name },
  };
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
 * Each click is verified against a receipt that Chat SDK stores in the
 * thread's state adapter before calling the workflow webhook, so the
 * decision and the deciding user come from the platform's verified action
 * event rather than the webhook request. Requests without a valid receipt,
 * and repeats of a receipt already seen, are ignored. By default any user
 * who clicks decides; pass `approvers` to restrict who may approve
 * (recommended for consequential actions).
 */
export async function requestApproval(
  thread: Thread,
  options: RequestApprovalOptions
): Promise<ApprovalResult> {
  if (!hasStateAdapter(thread)) {
    throw new Error(UNSUPPORTED_THREAD_MESSAGE);
  }

  using webhook = createWebhook();

  const pendingCard = buildApprovalCard(options, webhook.url);
  const messageId = await postApprovalCard(thread, pendingCard);

  const timeoutPromise = startTimeout(options.timeout);
  const clicks = webhook[Symbol.asyncIterator]();
  // Receipts are bound to this webhook's URL, and workflow code replays
  // deterministically, so this set alone makes each receipt single use.
  const seenReceipts = new Set<string>();

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

    const payload = (await next.value.json().catch(() => null)) as {
      receipt?: unknown;
    } | null;
    const nonce = payload?.receipt;
    if (!isCallbackReceiptNonce(nonce) || seenReceipts.has(nonce)) {
      continue;
    }
    seenReceipts.add(nonce);

    const decision = await verifyDecision(thread, webhook.url, nonce);
    if (!decision) {
      // No valid receipt (forged or foreign POST), so keep waiting rather
      // than resolving the approval on unverified input.
      continue;
    }

    if (options.approvers && !options.approvers.includes(decision.user.id)) {
      await rejectUnauthorizedClick(
        thread,
        messageId,
        pendingCard,
        `${describeUser(decision.user)} isn't authorized to decide "${options.title}".`,
        nonce
      );
      continue;
    }

    await finalizeApprovalCard(
      thread,
      messageId,
      buildResolvedCard(
        options,
        `${decision.approved ? "Approved" : "Denied"} by ${describeUser(decision.user)}.`
      ),
      nonce
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
