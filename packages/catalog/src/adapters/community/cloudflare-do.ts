import type { CommunityAdapter } from "../../types";

export const cloudflareDo = {
  author: "dcartertwo",
  description:
    "Cloudflare Durable Objects state adapter with SQLite-backed persistence, distributed locking, and caching.",
  features: {
    persistence: "yes",
    multiInstance: "yes",
    subscriptions: "yes",
    distributedLocking: "yes",
    keyValueCache: "yes",
    lists: "yes",
    queues: "yes",
    automaticReconnect: "yes",
    cluster: { status: "partial", label: "Sharding" },
    sentinel: "no",
    keyPrefix: { status: "yes", label: "shardKey" },
  },
  group: "community",
  name: "Cloudflare Durable Objects",
  packageName: "chat-state-cloudflare-do",
  readme:
    "https://github.com/dcartertwo/chat-state-cloudflare-do/tree/13ebf545b302b7c8fdabf7de9c5de678e047ce5e",
  slug: "cloudflare-do",
  type: "state",
} as const satisfies CommunityAdapter;
