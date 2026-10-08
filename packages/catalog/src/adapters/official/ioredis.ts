import type { CatalogAdapter } from "../../types";

export const ioredis = {
  beta: true,
  description: "Redis state adapter using ioredis, with Sentinel support.",
  env: {
    config: ["url or client", "keyPrefix"],
    notes: "Either a Redis URL or an existing ioredis client is required.",
  },
  factoryExport: "createIoRedisState",
  features: {
    persistence: "yes",
    multiInstance: "yes",
    subscriptions: "yes",
    distributedLocking: "yes",
    keyValueCache: "yes",
    automaticReconnect: "yes",
    cluster: "no",
    sentinel: "yes",
    keyPrefix: "yes",
  },
  group: "official",
  icon: "ioredis",
  name: "ioredis",
  packageName: "@chat-adapter/state-ioredis",
  peerDeps: ["ioredis"],
  readme: "https://github.com/vercel/chat/tree/main/packages/state-ioredis",
  slug: "ioredis",
  type: "state",
} as const satisfies CatalogAdapter;
