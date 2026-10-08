import type { CatalogAdapter } from "../../types";

export const cloudflareAgents = {
  author: "Cloudflare",
  description:
    "Cloudflare Agents state adapter for Chat SDK. Stores subscriptions, locks, queues, and history in Durable Object SQLite via ChatSdkStateAgent sub-agents.",
  env: {
    config: ["parent", "agent", "name", "shardKey", "keyShard"],
    notes:
      "No environment variables are required. State is stored in Durable Object SQLite via ChatSdkStateAgent sub-agents; add the parent Agent to your Durable Object migration and re-export ChatSdkStateAgent from the Worker entry point.",
  },
  factoryExport: "createChatSdkState",
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
  group: "vendor-official",
  name: "Cloudflare Agents",
  packageName: "agents",
  peerDeps: [],
  readme: "https://github.com/cloudflare/agents",
  slug: "cloudflare-agents",
  type: "state",
} as const satisfies CatalogAdapter;
