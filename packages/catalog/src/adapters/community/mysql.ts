import type { CommunityAdapter } from "../../types";

export const mysql = {
  author: "DivyanshGolyan",
  description:
    "Community MySQL state adapter with persistence, distributed locking, caching, lists, and queues.",
  features: {
    persistence: "yes",
    multiInstance: "yes",
    subscriptions: "yes",
    distributedLocking: "yes",
    keyValueCache: "yes",
    lists: "yes",
    queues: "yes",
    automaticReconnect: "yes",
    cluster: "no",
    sentinel: "no",
    keyPrefix: "yes",
  },
  group: "community",
  name: "MySQL",
  packageName: "chat-state-mysql",
  readme:
    "https://github.com/DivyanshGolyan/chat-state-mysql/tree/26502f2c43e2aee16b0b58f2066a81e01b2c289b",
  slug: "mysql",
  type: "state",
} as const satisfies CommunityAdapter;
