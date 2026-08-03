import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionsElement, CardElement, TextElement } from "../cards";
import type { SentMessage, Thread } from "../types";

// Controllable stand-ins for the workflow primitives. `requestApproval` only
// touches createWebhook/sleep, so the module mock keeps tests in-process
// without the workflow compiler.
const clickQueue: Request[] = [];
let clickWaiters: ((req: Request) => void)[] = [];
let disposed = false;
let sleepResolvers: (() => void)[] = [];

function emitClick(payload: unknown): void {
  const request = new Request("https://example.com/webhook", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const waiter = clickWaiters.shift();
  if (waiter) {
    waiter(request);
  } else {
    clickQueue.push(request);
  }
}

function elapseTimeout(): void {
  for (const resolve of sleepResolvers) {
    resolve();
  }
  sleepResolvers = [];
}

vi.mock("workflow", () => ({
  createWebhook: () => ({
    url: "https://example.com/webhook/token-1",
    token: "token-1",
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<Request>> {
          const queued = clickQueue.shift();
          if (queued) {
            return Promise.resolve({ done: false, value: queued });
          }
          return new Promise((resolve) => {
            clickWaiters.push((value) => resolve({ done: false, value }));
          });
        },
      };
    },
    [Symbol.dispose]() {
      disposed = true;
    },
  }),
  sleep: () =>
    new Promise<void>((resolve) => {
      sleepResolvers.push(resolve);
    }),
}));

import {
  APPROVE_ACTION_ID,
  buildApprovalCard,
  buildResolvedCard,
  DENY_ACTION_ID,
  requestApproval,
} from "./index";

function createFakeThread() {
  const post = vi.fn(
    async () => ({ id: "card-msg-1" }) as unknown as SentMessage
  );
  const editMessage = vi.fn(async () => ({}));
  const thread = {
    id: "slack:C123:1700000000.000100",
    adapter: { editMessage },
    post,
  } as unknown as Thread;
  return { thread, post, editMessage };
}

function click(actionId: string, user = { id: "U_ALICE", name: "alice" }) {
  emitClick({
    type: "action",
    actionId,
    user,
    threadId: "slack:C123:1700000000.000100",
    messageId: "card-msg-1",
  });
}

function cardTexts(card: CardElement): string[] {
  return card.children
    .filter((child): child is TextElement => child.type === "text")
    .map((child) => child.content);
}

function cardActions(card: CardElement): ActionsElement | undefined {
  return card.children.find(
    (child): child is ActionsElement => child.type === "actions"
  );
}

beforeEach(() => {
  clickQueue.length = 0;
  clickWaiters = [];
  sleepResolvers = [];
  disposed = false;
});

describe("buildApprovalCard", () => {
  it("renders title, body, fields, and callback buttons", () => {
    const card = buildApprovalCard(
      {
        title: "Deploy v1.2.3?",
        subtitle: "Requested by alice",
        description: "Rolls out to production.",
        fields: { Version: "v1.2.3", Region: "iad1" },
      },
      "https://example.com/webhook/t"
    );

    expect(card.title).toBe("Deploy v1.2.3?");
    expect(card.subtitle).toBe("Requested by alice");
    expect(cardTexts(card)).toEqual([
      "Rolls out to production.",
      "**Version:** v1.2.3\n**Region:** iad1",
    ]);

    const actions = cardActions(card);
    expect(actions?.children).toHaveLength(2);
    const [approve, deny] = actions?.children ?? [];
    expect(approve).toMatchObject({
      type: "button",
      id: APPROVE_ACTION_ID,
      label: "Approve",
      style: "primary",
      callbackUrl: "https://example.com/webhook/t",
    });
    expect(deny).toMatchObject({
      type: "button",
      id: DENY_ACTION_ID,
      label: "Deny",
      style: "danger",
      callbackUrl: "https://example.com/webhook/t",
    });
  });

  it("honors custom button labels", () => {
    const card = buildApprovalCard(
      { title: "Ship it?", approveLabel: "Ship", denyLabel: "Abort" },
      "https://example.com/webhook/t"
    );
    const labels = cardActions(card)?.children.map((el) =>
      el.type === "button" ? el.label : undefined
    );
    expect(labels).toEqual(["Ship", "Abort"]);
  });
});

describe("buildResolvedCard", () => {
  it("keeps the body but replaces buttons with the outcome", () => {
    const card = buildResolvedCard(
      { title: "Deploy?", fields: { Version: "v1" } },
      "Approved by @alice."
    );
    expect(cardActions(card)).toBeUndefined();
    expect(cardTexts(card)).toEqual(["**Version:** v1", "Approved by @alice."]);
  });
});

describe("requestApproval", () => {
  it("resolves approved with the clicking user and finalizes the card", async () => {
    const { thread, post, editMessage } = createFakeThread();
    const pending = requestApproval(thread, { title: "Deploy?" });

    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
    const postedCard = post.mock.calls[0]?.[0] as unknown as CardElement;
    expect(cardActions(postedCard)?.children).toHaveLength(2);

    click(APPROVE_ACTION_ID);
    await expect(pending).resolves.toEqual({
      approved: true,
      timedOut: false,
      user: { id: "U_ALICE", name: "alice" },
    });

    expect(editMessage).toHaveBeenCalledWith(
      thread.id,
      "card-msg-1",
      expect.objectContaining({ type: "card", title: "Deploy?" })
    );
    const resolvedCard = editMessage.mock
      .calls[0]?.[2] as unknown as CardElement;
    expect(cardActions(resolvedCard)).toBeUndefined();
    expect(cardTexts(resolvedCard)).toContain("Approved by @alice.");
    expect(disposed).toBe(true);
  });

  it("resolves denied on the deny button", async () => {
    const { thread, editMessage } = createFakeThread();
    const pending = requestApproval(thread, { title: "Deploy?" });

    click(DENY_ACTION_ID, { id: "U_BOB", name: "bob" });
    await expect(pending).resolves.toEqual({
      approved: false,
      timedOut: false,
      user: { id: "U_BOB", name: "bob" },
    });
    const resolvedCard = editMessage.mock
      .calls[0]?.[2] as unknown as CardElement;
    expect(cardTexts(resolvedCard)).toContain("Denied by @bob.");
  });

  it("times out when the sleep wins the race", async () => {
    const { thread, post, editMessage } = createFakeThread();
    const pending = requestApproval(thread, {
      title: "Deploy?",
      timeout: "24h",
    });

    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(sleepResolvers.length).toBeGreaterThan(0));
    elapseTimeout();

    await expect(pending).resolves.toEqual({ approved: false, timedOut: true });
    const resolvedCard = editMessage.mock
      .calls[0]?.[2] as unknown as CardElement;
    expect(cardTexts(resolvedCard)).toContain(
      "Timed out after 24h with no decision recorded."
    );
    expect(disposed).toBe(true);
  });

  it("ignores clicks from users outside approvers and posts a notice", async () => {
    const { thread, post } = createFakeThread();
    const pending = requestApproval(thread, {
      title: "Deploy?",
      approvers: ["U_ALICE"],
    });

    click(APPROVE_ACTION_ID, { id: "U_MALLORY", name: "mallory" });
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith({
        markdown: `@mallory isn't authorized to decide "Deploy?".`,
      })
    );

    click(DENY_ACTION_ID, { id: "U_ALICE", name: "alice" });
    await expect(pending).resolves.toEqual({
      approved: false,
      timedOut: false,
      user: { id: "U_ALICE", name: "alice" },
    });
  });

  it("keeps waiting on unrecognizable payloads", async () => {
    const { thread } = createFakeThread();
    const pending = requestApproval(thread, { title: "Deploy?" });

    emitClick({ hello: "world" });
    emitClick({
      type: "action",
      actionId: "something-else",
      user: { id: "U" },
    });

    click(APPROVE_ACTION_ID);
    await expect(pending).resolves.toMatchObject({ approved: true });
  });
});
