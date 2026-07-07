import { threadIdContract } from "./thread-id-contract";

interface FakeThread {
  channel: string;
  thread: string;
}

const encode = (decoded: FakeThread): string =>
  `fake:${decoded.channel}:${decoded.thread}`;

const decode = (id: string): FakeThread => {
  const [, channel, thread] = id.split(":");
  return { channel, thread };
};

// Running the contract against a compliant fake codec exercises every
// assertion and proves the runner works.
threadIdContract<FakeThread>({
  name: "fake",
  encode,
  decode,
  cases: [
    { decoded: { channel: "C1", thread: "T1" }, encoded: "fake:C1:T1" },
    { decoded: { channel: "C2", thread: "T2" } },
  ],
  isDM: {
    fn: (id) => id.includes(":D"),
    dmThreadId: "fake:D1:T1",
    nonDmThreadId: "fake:C1:T1",
  },
});
