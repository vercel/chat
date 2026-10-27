import { describe, expect, it } from "vitest";
import { collectContractTests, getCase } from "./contract-harness";
import type { ThreadIdContractDescriptor } from "./thread-id-contract";

interface FakeThread {
  channel: string;
  thread: string;
}

const descriptor: ThreadIdContractDescriptor<FakeThread> = {
  name: "fake",
  encode: (decoded) => `fake:${decoded.channel}:${decoded.thread}`,
  decode: (id) => {
    const [, channel, thread] = id.split(":");
    return { channel, thread };
  },
  cases: [
    { decoded: { channel: "C1", thread: "T1" }, encoded: "fake:C1:T1" },
    { decoded: { channel: "C2", thread: "T2" } },
  ],
  isDM: {
    fn: (id) => id.includes(":D"),
    dmThreadId: "fake:D1:T1",
    nonDmThreadId: "fake:C1:T1",
  },
};

const PREFIX = "prefixes encoded thread ids with the adapter name";
const ROUND_TRIP = "round-trips decode(encode(x))";
const PINNED = "matches pinned encoded strings";
const DM = "distinguishes DM from non-DM threads";

function collect(overrides: Partial<ThreadIdContractDescriptor<FakeThread>>) {
  return collectContractTests(
    () => import("./thread-id-contract"),
    ({ threadIdContract }) => threadIdContract({ ...descriptor, ...overrides })
  );
}

describe("threadIdContract", () => {
  it("passes every case for a compliant codec", async () => {
    const tests = await collect({});
    expect([...tests.keys()]).toEqual([PREFIX, ROUND_TRIP, PINNED, DM]);
    for (const run of tests.values()) {
      await run();
    }
  });

  it("fails when encoded ids lack the adapter prefix", async () => {
    const tests = await collect({
      encode: (decoded) => `other:${decoded.channel}:${decoded.thread}`,
    });
    await expect(getCase(tests, PREFIX)()).rejects.toThrow(
      'expected "other:C1:T1" to start with "fake:"'
    );
  });

  it("fails when decode loses information", async () => {
    const tests = await collect({
      decode: (id) => ({ channel: id.split(":")[1], thread: "" }),
    });
    await expect(getCase(tests, ROUND_TRIP)()).rejects.toThrow();
  });

  it("fails when an encoded id drifts from its pinned string", async () => {
    const tests = await collect({
      cases: [{ decoded: { channel: "C1", thread: "T1" }, encoded: "fake:C1" }],
    });
    await expect(getCase(tests, PINNED)()).rejects.toThrow();
  });

  it("fails when isDM misclassifies a thread", async () => {
    const tests = await collect({
      isDM: {
        fn: () => true,
        dmThreadId: "fake:D1:T1",
        nonDmThreadId: "fake:C1:T1",
      },
    });
    await expect(getCase(tests, DM)()).rejects.toThrow();
  });

  it("does not register the pinned-string case when nothing is pinned", async () => {
    const tests = await collect({
      cases: [{ decoded: { channel: "C1", thread: "T1" } }],
    });
    expect(tests.has(PINNED)).toBe(false);
  });

  it("rejects a descriptor with no cases", async () => {
    await expect(collect({ cases: [] })).rejects.toThrow(
      "threadIdContract(fake): pass at least one case"
    );
  });
});
