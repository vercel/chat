import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import {
  type CallbackReceipt,
  createCallbackReceipt,
  decodeCallbackValue,
} from "../callback-url";
import type {
  ActionsElement,
  ButtonElement,
  CardElement,
  TextElement,
} from "../cards";
import { Chat } from "../chat";
import { clearChatSingleton } from "../chat-singleton";
import {
  createMockAdapter,
  createMockState,
  type MockStateAdapter,
  mockLogger,
} from "../mock-adapter";
import { ThreadImpl } from "../thread";
import type { SentMessage, Thread } from "../types";

// Controllable stand-ins for the workflow primitives. `requestApproval` only
// touches createWebhook/sleep/FatalError, so the module mock keeps tests in-process
// without the workflow compiler.
const clickQueue: Request[] = [];
let clickWaiters: ((req: Request) => void)[] = [];
// Counts how often requestApproval asked the webhook for the next request,
// which tells a test that the previous request was fully handled.
let nextCalls = 0;
let disposed = false;
let sleepResolvers: (() => void)[] = [];

function deliver(request: Request): void {
  const waiter = clickWaiters.shift();
  if (waiter) {
    waiter(request);
  } else {
    clickQueue.push(request);
  }
}

function emitClick(payload: unknown): void {
  deliver(
    new Request("https://example.com/webhook/token-1", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
}

function elapseTimeout(): void {
  for (const resolve of sleepResolvers) {
    resolve();
  }
  sleepResolvers = [];
}

vi.mock("workflow", () => ({
  FatalError: class FatalError extends Error {},
  createWebhook: () => ({
    url: "https://example.com/webhook/token-1",
    token: "token-1",
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<Request>> {
          nextCalls += 1;
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
  type RequestApprovalOptions,
  requestApproval,
} from "./index";

const WEBHOOK_URL = "https://example.com/webhook/token-1";
const THREAD_ID = "slack:C123:1700000000.000100";
const RECEIPT_KEY_PREFIX = "chat:callback-receipt:";
const ALICE = { id: "U_ALICE", name: "alice" };
const BOB = { id: "U_BOB", name: "bob" };
const MALLORY = { id: "U_MALLORY", name: "mallory" };
const CALLBACK_VALUE_PATTERN = /^__cb:/;
const NOT_CHAT_THREAD_ERROR = /requires a thread created by Chat SDK/;

let state: MockStateAdapter;

function createFakeThread() {
  const adapter = createMockAdapter("slack");
  const thread = new ThreadImpl({
    id: THREAD_ID,
    channelId: "slack:C123",
    adapter,
    stateAdapter: state,
  });
  const post = vi
    .spyOn(thread, "post")
    .mockImplementation(
      async () => ({ id: "card-msg-1" }) as unknown as SentMessage
    );
  const editMessage = adapter.editMessage as Mock;
  // Only verifyDecision and receipt cleanup read the state adapter, so its
  // call count shows whether a request reached a step.
  const getStateAdapter = vi.spyOn(thread, "getStateAdapter");
  return { thread, post, editMessage, getStateAdapter };
}

// What Chat stores for a verified click on the approval card.
function mintReceipt(
  overrides: Partial<CallbackReceipt> = {}
): Promise<string> {
  return createCallbackReceipt(state, {
    url: WEBHOOK_URL,
    actionId: APPROVE_ACTION_ID,
    user: ALICE,
    threadId: THREAD_ID,
    messageId: "card-msg-1",
    ...overrides,
  });
}

// What Chat POSTs to the webhook for a click; also what a forger can send.
function callbackBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "action",
    actionId: APPROVE_ACTION_ID,
    user: ALICE,
    threadId: THREAD_ID,
    messageId: "card-msg-1",
    ...overrides,
  };
}

// Mirrors what Chat does on a verified button click: store a receipt, then
// POST the callback body carrying its nonce.
async function click(
  actionId: string,
  user: { id: string; name?: string } = ALICE
): Promise<string> {
  const receipt = await mintReceipt({ actionId, user });
  emitClick(callbackBody({ actionId, user, receipt }));
  return receipt;
}

function receiptKey(nonce: string): string {
  return `${RECEIPT_KEY_PREFIX}${nonce}`;
}

function trackSettled(pending: Promise<unknown>): { settled: boolean } {
  const status = { settled: false };
  pending.then(
    () => {
      status.settled = true;
    },
    () => {
      status.settled = true;
    }
  );
  return status;
}

interface ApprovalRun {
  editMessage: Mock;
  status: { settled: boolean };
}

function startApproval(options: RequestApprovalOptions = { title: "Deploy?" }) {
  const fake = createFakeThread();
  const pending = requestApproval(fake.thread, options);
  return { ...fake, pending, status: trackSettled(pending) };
}

// Resolves once requestApproval has handled `send`'s request: either it went
// back to the webhook for another one, or it settled.
async function handle(run: ApprovalRun, send: () => void): Promise<void> {
  await vi.waitFor(() => {
    if (clickWaiters.length !== 1) {
      throw new Error("requestApproval is not waiting for a request");
    }
  });
  const before = nextCalls;
  send();
  await vi.waitFor(() => {
    if (nextCalls === before && !run.status.settled) {
      throw new Error("requestApproval has not handled the request");
    }
  });
}

const STILL_WAITING = {
  settled: false,
  finalized: false,
  rearmed: 0,
  disposed: false,
};

// Card edits that still carry buttons re-arm the pending card; edits without
// them finalize it.
function cardEdits(run: ApprovalRun, withButtons: boolean): CardElement[] {
  return run.editMessage.mock.calls
    .map(([, , card]) => card as CardElement)
    .filter((card) => (cardActions(card) !== undefined) === withButtons);
}

// Delivers a request and reports whether requestApproval acted on it.
async function sendForged(
  run: ApprovalRun,
  payload: unknown
): Promise<typeof STILL_WAITING> {
  await handle(run, () => emitClick(payload));
  return {
    settled: run.status.settled,
    finalized: cardEdits(run, false).length > 0,
    rearmed: cardEdits(run, true).length,
    disposed,
  };
}

// An unauthorized click re-arms the card once and leaves it pending.
const REARMED_ONCE = { ...STILL_WAITING, rearmed: 1 };

const APPROVED_BY_ALICE = {
  result: { approved: true, timedOut: false, user: ALICE },
  receiptLeft: false,
  resolvedCards: [["Approved by @alice."]],
};

// Delivers a legitimate approve click from alice, which proves the approval
// was still live after an ignored request.
async function approveAsAlice(
  run: ApprovalRun & { pending: Promise<unknown> }
): Promise<unknown> {
  const nonce = await mintReceipt();
  const editsBefore = run.editMessage.mock.calls.length;
  await handle(run, () => emitClick(callbackBody({ receipt: nonce })));
  if (!run.status.settled) {
    return { settled: false };
  }
  return {
    result: await run.pending,
    receiptLeft: state.cache.has(receiptKey(nonce)),
    // An authorized click must finalize the card, never re-arm it.
    resolvedCards: run.editMessage.mock.calls
      .slice(editsBefore)
      .map(([, , card]) =>
        cardActions(card as CardElement)
          ? "re-armed"
          : cardTexts(card as CardElement)
      ),
  };
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

function cardButtons(card: CardElement): ButtonElement[] {
  return (cardActions(card)?.children ?? []).filter(
    (child): child is ButtonElement => child.type === "button"
  );
}

beforeEach(() => {
  state = createMockState();
  clickQueue.length = 0;
  clickWaiters = [];
  nextCalls = 0;
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
    const { thread, post, editMessage, pending } = startApproval();

    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
    const postedCard = post.mock.calls[0]?.[0] as unknown as CardElement;
    expect(cardActions(postedCard)?.children).toHaveLength(2);

    const nonce = await click(APPROVE_ACTION_ID);
    await expect(pending).resolves.toEqual({
      approved: true,
      timedOut: false,
      user: ALICE,
    });

    expect(state.cache.has(receiptKey(nonce))).toBe(false);
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
    const { editMessage, pending } = startApproval();

    await click(DENY_ACTION_ID, BOB);
    await expect(pending).resolves.toEqual({
      approved: false,
      timedOut: false,
      user: BOB,
    });
    const resolvedCard = editMessage.mock
      .calls[0]?.[2] as unknown as CardElement;
    expect(cardTexts(resolvedCard)).toContain("Denied by @bob.");
  });

  it("times out when the sleep wins the race", async () => {
    const { post, editMessage, pending } = startApproval({
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

  it("posts a notice for users outside approvers and ignores a replay of their receipt", async () => {
    const run = startApproval({ title: "Deploy?", approvers: [ALICE.id] });
    const nonce = await mintReceipt({ user: MALLORY });
    const body = callbackBody({ user: MALLORY, receipt: nonce });

    expect(await sendForged(run, body)).toEqual(REARMED_ONCE);
    expect(run.post).toHaveBeenCalledTimes(2);
    expect(run.post).toHaveBeenLastCalledWith({
      markdown: `@mallory isn't authorized to decide "Deploy?".`,
    });
    expect(state.cache.has(receiptKey(nonce))).toBe(false);

    expect(await sendForged(run, body)).toEqual(REARMED_ONCE);
    expect(run.post).toHaveBeenCalledTimes(2);

    await click(DENY_ACTION_ID, ALICE);
    await expect(run.pending).resolves.toEqual({
      approved: false,
      timedOut: false,
      user: ALICE,
    });
  });

  it("re-arms the card with fresh callback tokens before posting the notice", async () => {
    const run = startApproval({ title: "Deploy?", approvers: [ALICE.id] });
    const nonce = await mintReceipt({ user: MALLORY });

    expect(
      await sendForged(run, callbackBody({ user: MALLORY, receipt: nonce }))
    ).toEqual(REARMED_ONCE);
    expect(run.editMessage).toHaveBeenCalledWith(
      THREAD_ID,
      "card-msg-1",
      expect.objectContaining({ type: "card", title: "Deploy?" })
    );
    const rearmed = run.editMessage.mock.calls[0]?.[2] as CardElement;
    const stored = cardButtons(rearmed).map((button) => {
      const { callbackToken } = decodeCallbackValue(button.value);
      return {
        id: button.id,
        callbackUrl: button.callbackUrl,
        stored: state.cache.get(`chat:callback:${callbackToken}`),
      };
    });
    expect(stored).toEqual(
      [APPROVE_ACTION_ID, DENY_ACTION_ID].map((id) => ({
        id,
        callbackUrl: undefined,
        stored: {
          actionId: id,
          url: WEBHOOK_URL,
          scope: { id: THREAD_ID, type: "thread" },
        },
      }))
    );

    const [rearmOrder] = run.editMessage.mock.invocationCallOrder;
    const noticeOrder = run.post.mock.invocationCallOrder[1];
    expect(rearmOrder).toBeLessThan(noticeOrder ?? 0);
  });

  it.each<[string, (run: ApprovalRun) => void, number]>([
    [
      "editing the card",
      (run) => {
        run.editMessage.mockRejectedValueOnce(new Error("edit failed"));
      },
      1,
    ],
    [
      "storing the new callback tokens",
      () => {
        (state.set as Mock).mockRejectedValueOnce(new Error("state down"));
      },
      0,
    ],
  ])("still posts the notice when re-arming fails at %s", async (_name, breakRearm, rearmed) => {
    const run = startApproval({ title: "Deploy?", approvers: [ALICE.id] });
    const nonce = await mintReceipt({ user: MALLORY });
    breakRearm(run);

    expect(
      await sendForged(run, callbackBody({ user: MALLORY, receipt: nonce }))
    ).toEqual({ ...STILL_WAITING, rearmed });
    expect(run.post).toHaveBeenCalledTimes(2);
    expect(run.post).toHaveBeenLastCalledWith({
      markdown: `@mallory isn't authorized to decide "Deploy?".`,
    });
    expect(state.cache.has(receiptKey(nonce))).toBe(false);

    expect(await approveAsAlice(run)).toEqual(APPROVED_BY_ALICE);
  });

  it("ignores a replayed receipt that could not be deleted and still resolves", async () => {
    const run = startApproval({ title: "Deploy?", approvers: [ALICE.id] });
    (state.delete as Mock).mockRejectedValue(new Error("state down"));
    const nonce = await mintReceipt({ user: MALLORY });
    const body = callbackBody({ user: MALLORY, receipt: nonce });

    expect(await sendForged(run, body)).toEqual(REARMED_ONCE);
    expect(run.post).toHaveBeenCalledTimes(2);
    expect(state.cache.has(receiptKey(nonce))).toBe(true);
    const stateReads = run.getStateAdapter.mock.calls.length;

    expect(await sendForged(run, body)).toEqual(REARMED_ONCE);
    expect(run.post).toHaveBeenCalledTimes(2);
    expect(run.getStateAdapter).toHaveBeenCalledTimes(stateReads);

    expect(await approveAsAlice(run)).toEqual({
      ...APPROVED_BY_ALICE,
      receiptLeft: true,
    });
  });

  // Every forged body names the allowlisted approver, so it would resolve
  // the approval if the body were trusted.
  it.each<[string, () => Promise<unknown>, number]>([
    ["a well-formed click with no receipt", async () => callbackBody(), 0],
    [
      "an unknown receipt nonce",
      async () => callbackBody({ receipt: crypto.randomUUID() }),
      1,
    ],
    [
      "a receipt nonce that is not a UUID",
      async () => {
        state.cache.set(receiptKey("forged"), {
          url: WEBHOOK_URL,
          actionId: APPROVE_ACTION_ID,
          user: ALICE,
          threadId: THREAD_ID,
        });
        return callbackBody({ receipt: "forged" });
      },
      0,
    ],
    [
      "a receipt that is not a string",
      async () => callbackBody({ receipt: 12_345 }),
      0,
    ],
  ])("ignores %s", async (_name, forge, stepCalls) => {
    const run = startApproval({ title: "Deploy?", approvers: [ALICE.id] });

    expect(await sendForged(run, await forge())).toEqual(STILL_WAITING);
    expect(run.post).toHaveBeenCalledOnce();
    expect(run.getStateAdapter).toHaveBeenCalledTimes(stepCalls);

    expect(await approveAsAlice(run)).toEqual(APPROVED_BY_ALICE);
  });

  it.each<[string, Partial<CallbackReceipt>]>([
    ["another webhook URL", { url: "https://example.com/webhook/token-2" }],
    ["another thread", { threadId: "slack:C999:1700000000.000200" }],
  ])("ignores a receipt minted for %s and leaves it unconsumed", async (_name, overrides) => {
    const run = startApproval();
    const nonce = await mintReceipt(overrides);

    expect(await sendForged(run, callbackBody({ receipt: nonce }))).toEqual(
      STILL_WAITING
    );
    expect(run.post).toHaveBeenCalledOnce();
    expect(state.cache.has(receiptKey(nonce))).toBe(true);

    expect(await approveAsAlice(run)).toEqual(APPROVED_BY_ALICE);
  });

  it("ignores a receipt for a button other than approve or deny", async () => {
    const run = startApproval();
    const nonce = await mintReceipt({ actionId: "something-else" });

    expect(await sendForged(run, callbackBody({ receipt: nonce }))).toEqual(
      STILL_WAITING
    );
    expect(run.post).toHaveBeenCalledOnce();
    expect(state.cache.has(receiptKey(nonce))).toBe(true);

    expect(await approveAsAlice(run)).toEqual(APPROVED_BY_ALICE);
  });

  it("checks approvers against the receipt user, not the body user", async () => {
    const run = startApproval({ title: "Deploy?", approvers: [ALICE.id] });
    const nonce = await mintReceipt({ user: MALLORY });

    expect(
      await sendForged(run, callbackBody({ user: ALICE, receipt: nonce }))
    ).toEqual(REARMED_ONCE);
    expect(run.post).toHaveBeenCalledTimes(2);
    expect(run.post).toHaveBeenLastCalledWith({
      markdown: `@mallory isn't authorized to decide "Deploy?".`,
    });

    expect(await approveAsAlice(run)).toEqual(APPROVED_BY_ALICE);
  });

  it("takes the decision and user from the receipt when the body disagrees", async () => {
    const { pending, editMessage } = startApproval();
    const nonce = await mintReceipt({ actionId: DENY_ACTION_ID, user: BOB });

    emitClick(
      callbackBody({ actionId: APPROVE_ACTION_ID, user: ALICE, receipt: nonce })
    );
    await expect(pending).resolves.toEqual({
      approved: false,
      timedOut: false,
      user: BOB,
    });
    const resolvedCard = editMessage.mock.calls[0]?.[2] as CardElement;
    expect(cardTexts(resolvedCard)).toContain("Denied by @bob.");
    expect(JSON.stringify(editMessage.mock.calls)).not.toContain("alice");
  });

  it("throws for threads not created by Chat SDK before posting the card", async () => {
    const editMessage = vi.fn();
    const post = vi.fn(async () => ({ id: "card-msg-1" }));
    const thread = {
      id: THREAD_ID,
      adapter: { editMessage },
      post,
    } as unknown as Thread;

    const pending = requestApproval(thread, { title: "Deploy?" });
    const status = trackSettled(pending);

    await vi.waitFor(() => {
      if (!status.settled && post.mock.calls.length === 0) {
        throw new Error("requestApproval neither threw nor posted");
      }
    });
    expect(post).not.toHaveBeenCalled();
    await expect(pending).rejects.toThrow(NOT_CHAT_THREAD_ERROR);
    expect(editMessage).not.toHaveBeenCalled();
    expect(nextCalls).toBe(0);
  });
});

describe("requestApproval through Chat", () => {
  afterEach(() => {
    clearChatSingleton();
    vi.unstubAllGlobals();
  });

  it("re-arms the card after a non-approver's click, lets the approver retry a failed click, and ignores a forged webhook POST", async () => {
    const adapter = createMockAdapter("slack");
    const chat = new Chat({
      userName: "testbot",
      adapters: { slack: adapter },
      state,
      logger: mockLogger,
    }).registerSingleton();
    await chat.webhooks.slack(
      new Request("http://test.com", { method: "POST" })
    );

    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(input).toBe(WEBHOOK_URL);
        deliver(new Request(WEBHOOK_URL, init));
        return new Response("ok");
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    // Workflow serializes the thread into each step; revive it the same way
    // so the receipt lookup goes through the registered singleton.
    const thread = ThreadImpl.fromJSON(
      (chat.thread(THREAD_ID) as ThreadImpl).toJSON()
    );
    const pending = requestApproval(thread, {
      title: "Deploy?",
      approvers: [ALICE.id],
    });
    const run = {
      editMessage: adapter.editMessage as Mock,
      status: trackSettled(pending),
    };

    await vi.waitFor(() => expect(adapter.postMessage).toHaveBeenCalledOnce());
    const [postedThreadId, postedCard] = (adapter.postMessage as Mock).mock
      .calls[0] as [string, CardElement];
    expect(postedThreadId).toBe(THREAD_ID);
    const [approve, deny] = cardButtons(postedCard);
    expect(approve?.id).toBe(APPROVE_ACTION_ID);
    expect(approve?.callbackUrl).toBeUndefined();
    expect(approve?.value).toMatch(CALLBACK_VALUE_PATTERN);

    expect(await sendForged(run, callbackBody({ messageId: "msg-1" }))).toEqual(
      STILL_WAITING
    );
    expect(adapter.postMessage).toHaveBeenCalledOnce();

    const clickApprove = (
      value: string | undefined,
      user: { id: string; name: string }
    ) =>
      chat.processAction(
        {
          actionId: APPROVE_ACTION_ID,
          value,
          user: {
            userId: user.id,
            userName: user.name,
            fullName: user.name,
            isBot: false,
            isMe: false,
          },
          messageId: "msg-1",
          threadId: THREAD_ID,
          adapter,
          raw: {},
        },
        undefined
      );
    const receiptKeys = () =>
      [...state.cache.keys()].filter((key) =>
        key.startsWith(RECEIPT_KEY_PREFIX)
      );

    let action: Promise<void> | undefined;
    await handle(run, () => {
      action = clickApprove(approve?.value, MALLORY);
    });
    await action;
    expect(run.status.settled).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(adapter.postMessage).toHaveBeenLastCalledWith(
      THREAD_ID,
      expect.objectContaining({
        markdown: `@mallory isn't authorized to decide "Deploy?".`,
      })
    );
    expect(receiptKeys()).toEqual([]);
    expect(run.editMessage).toHaveBeenCalledOnce();
    const rearmed = cardButtons(
      run.editMessage.mock.calls[0]?.[2] as CardElement
    );
    expect(rearmed.map((button) => button.id)).toEqual([
      APPROVE_ACTION_ID,
      DENY_ACTION_ID,
    ]);
    expect(rearmed[0]?.value).not.toBe(approve?.value);
    expect(rearmed[1]?.value).not.toBe(deny?.value);

    // Mallory's click spent the original Approve token.
    await clickApprove(approve?.value, ALICE);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(receiptKeys()).toEqual([]);

    // Alice's first click cannot store its receipt, so Chat skips the POST
    // and hands the token back; her retry of the same button goes through.
    const set = state.set as Mock;
    const storeSet = set.getMockImplementation();
    set.mockImplementation((key: string, ...rest: unknown[]) => {
      if (key.startsWith(RECEIPT_KEY_PREFIX)) {
        set.mockImplementation(storeSet);
        return Promise.reject(new Error("state down"));
      }
      return storeSet?.(key, ...rest);
    });
    await clickApprove(rearmed[0]?.value, ALICE);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(receiptKeys()).toEqual([]);
    expect(run.status.settled).toBe(false);
    expect(run.editMessage).toHaveBeenCalledOnce();

    await handle(run, () => {
      action = clickApprove(rearmed[0]?.value, ALICE);
    });
    await action;
    expect(run.status.settled).toBe(true);
    await expect(pending).resolves.toEqual({
      approved: true,
      timedOut: false,
      user: ALICE,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(receiptKeys()).toEqual([]);
    expect(run.editMessage).toHaveBeenCalledTimes(2);
    expect(run.editMessage).toHaveBeenLastCalledWith(
      THREAD_ID,
      "msg-1",
      expect.objectContaining({ type: "card", title: "Deploy?" })
    );
    const resolvedCard = run.editMessage.mock.calls[1]?.[2] as CardElement;
    expect(cardActions(resolvedCard)).toBeUndefined();
    expect(cardTexts(resolvedCard)).toContain("Approved by @alice.");
  });
});
