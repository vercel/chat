import { createServer, type Server } from "node:http";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  Chat,
  type ConcurrencyStrategy,
  ConsoleLogger,
  type Thread,
} from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSignedSlackRequest,
  createWaitUntilTracker,
} from "./replay-test-utils";
import { SLACK_SIGNING_SECRET } from "./slack-utils";

const tokens = { T_A: "xoxb-local-A", T_B: "xoxb-local-B" };
const identity = "slack:C_SHARED:1800000000.000100";

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("Slack installation concurrency isolation", () => {
  let server: Server;
  let address: string;
  let requests: Array<{
    method: string;
    token: string;
    parameters: URLSearchParams;
  }>;
  let cleanup: Array<() => Promise<void>>;
  let releases: Array<() => void>;
  let tasks: ReturnType<typeof createWaitUntilTracker>[];

  beforeEach(async () => {
    requests = [];
    cleanup = [];
    releases = [];
    tasks = [];
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const parameters = new URLSearchParams(Buffer.concat(chunks).toString());
      const token =
        request.headers.authorization?.replace("Bearer ", "") ??
        parameters.get("token") ??
        "";
      const method = request.url?.slice(1) ?? "";
      requests.push({ method, token, parameters });
      const team = token === tokens.T_B ? "T_B" : "T_A";
      let result: Record<string, unknown>;
      if (method === "users.info") {
        result = {
          ok: true,
          user: {
            id: parameters.get("user"),
            name: team,
            profile: { display_name: team },
          },
        };
      } else if (method === "conversations.history") {
        result = {
          ok: true,
          messages: [
            {
              type: "message",
              ts: "1800000000.000100",
              text: `canary-${team}`,
            },
          ],
        };
      } else if (method === "chat.postMessage") {
        result = {
          ok: true,
          ts: "1800000000.000999",
          channel: "C_SHARED",
          message: { ts: "1800000000.000999", text: parameters.get("text") },
        };
      } else {
        result = { ok: false, error: "unexpected_method" };
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const endpoint = server.address();
    if (!endpoint || typeof endpoint === "string") {
      throw new Error("Missing localhost address");
    }
    address = `http://127.0.0.1:${endpoint.port}/`;
  });

  afterEach(async () => {
    for (const release of releases) {
      release();
    }
    for (const tracker of tasks) {
      await tracker.waitForAll();
    }
    for (const shutdown of cleanup) {
      await shutdown();
    }
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  async function setup(
    strategy: ConcurrencyStrategy = "queue",
    lockScope: "thread" | "channel" = "thread",
    state = createMemoryState(),
    enterprise = false,
    maximum = 1
  ) {
    const adapter = createSlackAdapter({
      signingSecret: SLACK_SIGNING_SECRET,
      apiUrl: address,
      logger: new ConsoleLogger("silent"),
      agentView: true,
    });
    const chat = new Chat({
      adapters: { slack: adapter },
      state,
      userName: "bot",
      concurrency: { strategy, debounceMs: 15, maxConcurrent: maximum },
      lockScope,
      logger: "silent",
    });
    await chat.initialize();
    cleanup.push(() => chat.shutdown());
    if (enterprise) {
      await adapter.setInstallation("E_ORG", {
        botToken: tokens.T_A,
        botUserId: "U_BOT",
      });
    } else {
      for (const [team, token] of Object.entries(tokens)) {
        await adapter.setInstallation(team, {
          botToken: token,
          botUserId: "U_BOT",
        });
      }
    }
    let sequence = 0;
    async function deliver(
      team: keyof typeof tokens,
      options: { timestamp?: string; thread?: string; origin?: string } = {}
    ) {
      sequence++;
      const timestamp =
        options.timestamp ??
        `1800000000.${String(sequence + 200).padStart(6, "0")}`;
      const tracker = createWaitUntilTracker();
      tasks.push(tracker);
      const payload = {
        type: "event_callback",
        team_id: options.origin ?? team,
        is_ext_shared_channel: true,
        event_id: `event-${team}-${sequence}`,
        authorizations: [
          {
            enterprise_id: enterprise ? "E_ORG" : null,
            team_id: team,
            user_id: "U_BOT",
            is_bot: true,
            is_enterprise_install: enterprise,
          },
        ],
        event: {
          type: "message",
          team: options.origin ?? team,
          channel: "C_SHARED",
          channel_type: "channel",
          user: `U_${team}`,
          text: `${team}-${sequence}`,
          ts: timestamp,
          thread_ts: options.thread ?? "1800000000.000100",
        },
      };
      const response = await chat.webhooks.slack(
        createSignedSlackRequest(JSON.stringify(payload)),
        { waitUntil: tracker.waitUntil }
      );
      if (response.status !== 200) {
        throw new Error(`Webhook rejected with ${response.status}`);
      }
      return tracker;
    }
    return { chat, adapter, state, deliver };
  }

  for (const strategy of [
    "queue",
    "debounce",
    "burst",
    "drop",
    "concurrent",
  ] as const) {
    for (const lockScope of ["thread", "channel"] as const) {
      it(`${strategy} keeps ${lockScope} handlers on their own installation`, async () => {
        const { chat, adapter, state, deliver } = await setup(
          strategy,
          lockScope
        );
        const locks = vi.spyOn(state, "acquireLock");
        const blocked = gate();
        releases.push(blocked.release);
        const observations: Array<{
          text: string;
          canary: string | undefined;
          user: string | undefined;
        }> = [];
        chat.onNewMessage(async (thread, message) => {
          const history = await adapter.webClient.conversations.history({
            channel: "C_PRIVATE",
          });
          const user = await adapter.getUser("U_CANARY");
          observations.push({
            text: message.text,
            canary: history.messages?.[0]?.text,
            user: user?.fullName,
          });
          await thread.post(message.text);
          if (message.text.startsWith("T_A")) {
            await blocked.promise;
          }
        });
        const first = await deliver("T_A");
        await vi.waitFor(() => expect(observations).toHaveLength(1));
        const second = await deliver("T_B", {
          origin: "T_A",
          ...(lockScope === "channel" ? { thread: "1800000000.000101" } : {}),
        });
        if (strategy === "concurrent") {
          await vi.waitFor(() => expect(observations).toHaveLength(2));
        } else {
          await vi.waitFor(() => expect(locks).toHaveBeenCalledTimes(2));
        }
        blocked.release();
        await first.waitForAll();
        await second.waitForAll();
        expect(observations).toEqual([
          { text: "T_A-1", canary: "canary-T_A", user: "T_A" },
          { text: "T_B-2", canary: "canary-T_B", user: "T_B" },
        ]);
        expect(
          requests
            .filter((request) => request.method === "chat.postMessage")
            .map((request) => request.token)
        ).toEqual([tokens.T_A, tokens.T_B]);
      });
    }
  }

  it("deduplicates per installation even when timestamps and channels match", async () => {
    const { chat, deliver } = await setup();
    const handler = vi.fn();
    chat.onNewMessage(handler);
    const timestamp = "1800000000.000200";
    await (await deliver("T_A", { timestamp })).waitForAll();
    await (await deliver("T_B", { timestamp })).waitForAll();
    await (await deliver("T_A", { timestamp })).waitForAll();
    expect(handler.mock.calls.map(([, message]) => message.text)).toEqual([
      "T_A-1",
      "T_B-2",
    ]);
  });

  for (const strategy of ["queue", "debounce", "burst"] as const) {
    it(`${strategy} preserves same-installation batching after JSON serialization`, async () => {
      const { chat, state, deliver } = await setup(strategy);
      const enqueue = state.enqueue.bind(state);
      vi.spyOn(state, "enqueue").mockImplementation((key, entry, size) =>
        enqueue(
          key,
          { ...entry, message: JSON.parse(JSON.stringify(entry.message)) },
          size
        )
      );
      const blocked = gate();
      releases.push(blocked.release);
      const observations: Array<{ text: string; skipped: string[] }> = [];
      chat.onNewMessage(async (_thread, message, context) => {
        observations.push({
          text: message.text,
          skipped: context?.skipped.map((entry) => entry.text) ?? [],
        });
        if (observations.length === 1) {
          await blocked.promise;
        }
      });
      const first = await deliver("T_A");
      await vi.waitFor(() => expect(observations).toHaveLength(1));
      await (await deliver("T_A")).waitForAll();
      await (await deliver("T_A")).waitForAll();
      blocked.release();
      await first.waitForAll();
      expect(observations).toEqual([
        { text: "T_A-1", skipped: [] },
        { text: "T_A-3", skipped: ["T_A-2"] },
      ]);
    });
  }

  for (const remote of [false, true]) {
    it(`isolates ${remote ? "cross-instance" : "local"} turn cancellation`, async () => {
      const { chat, adapter, state, deliver } = await setup(
        "concurrent",
        "thread",
        createMemoryState(),
        false,
        Number.POSITIVE_INFINITY
      );
      const canceller = remote
        ? await setup("concurrent", "thread", state)
        : { chat, adapter };
      const markers = vi.spyOn(state, "set");
      const blocked = gate();
      releases.push(blocked.release);
      const threads = new Map<string, Thread>();
      chat.onNewMessage(async (thread, message) => {
        threads.set(message.text, thread);
        await blocked.promise;
      });
      const first = await deliver("T_A");
      const second = await deliver("T_B");
      await vi.waitFor(() => expect(threads.size).toBe(2));
      const marker = markers.mock.calls.find(
        ([key]) => key.startsWith("active-turn:") && key.includes("T_B")
      )?.[0];
      if (!marker) {
        throw new Error("Missing workspace turn marker");
      }
      await canceller.adapter.withBotToken(
        tokens.T_A,
        async () => {
          await expect(
            canceller.chat.abortTurn(marker.slice("active-turn:".length))
          ).rejects.toThrow("Adapter");
        },
        { installationId: "T_A" }
      );
      expect(threads.get("T_B-2")?.signal.aborted).toBe(false);
      await canceller.adapter.withBotToken(
        tokens.T_A,
        () => canceller.chat.abortTurn(identity),
        { installationId: "T_A" }
      );
      await vi.waitFor(() =>
        expect(threads.get("T_A-1")?.signal.aborted).toBe(true)
      );
      expect(threads.get("T_B-2")?.signal.aborted).toBe(false);
      await canceller.adapter.withBotToken(
        tokens.T_B,
        () => canceller.chat.abortTurn(identity),
        { installationId: "T_B" }
      );
      await vi.waitFor(() =>
        expect(threads.get("T_B-2")?.signal.aborted).toBe(true)
      );
      blocked.release();
      await first.waitForAll();
      await second.waitForAll();
    });
  }

  it("shares one thread across workspaces in an org-wide installation", async () => {
    const { chat, adapter, deliver } = await setup(
      "queue",
      "thread",
      createMemoryState(),
      true
    );
    const blocked = gate();
    releases.push(blocked.release);
    const observations: string[] = [];
    const threads = new Map<string, Thread>();
    chat.onNewMessage(async (thread, message) => {
      observations.push(message.text);
      threads.set(message.text, thread);
      if (message.text.startsWith("T_A")) {
        await blocked.promise;
      }
    });
    const first = await deliver("T_A");
    await vi.waitFor(() => expect(observations).toHaveLength(1));
    await (await deliver("T_B")).waitForAll();
    expect(observations).toEqual(["T_A-1"]);
    await adapter.withBotToken(tokens.T_A, () => chat.abortTurn(identity), {
      installationId: "E_ORG",
    });
    await vi.waitFor(() =>
      expect(threads.get("T_A-1")?.signal.aborted).toBe(true)
    );
    blocked.release();
    await first.waitForAll();
    expect(observations).toEqual(["T_A-1", "T_B-2"]);
  });

  it("fails closed when multi-workspace cancellation lacks installation context", async () => {
    const { chat } = await setup();
    await expect(chat.abortTurn(identity)).rejects.toThrow(
      "No installation context"
    );
  });

  for (const strategy of ["debounce", "burst"] as const) {
    it(`${strategy} does not supersede another installation's pending message`, async () => {
      const { chat, deliver } = await setup(strategy);
      const observations: string[] = [];
      chat.onNewMessage(async (thread, message) => {
        observations.push(message.text);
        await thread.post(message.text);
      });
      const first = await deliver("T_A");
      const second = await deliver("T_B");
      await first.waitForAll();
      await second.waitForAll();
      expect([...observations].sort()).toEqual(["T_A-1", "T_B-2"]);
    });
  }
});
