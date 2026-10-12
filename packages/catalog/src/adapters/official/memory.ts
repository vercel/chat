import type { CatalogAdapter } from "../../types";

export const memory = {
  beta: true,
  description:
    "In-memory state adapter for development and testing environments.",
  env: {
    notes:
      "No environment variables are required. State is kept in the current process.",
  },
  factoryExport: "createMemoryState",
  features: {
    persistence: "no",
    multiInstance: "no",
    subscriptions: { status: "yes", label: "In-memory" },
    distributedLocking: { status: "partial", label: "Single process" },
    keyValueCache: { status: "yes", label: "In-memory" },
    keyPrefix: "no",
  },
  group: "official",
  icon: "memory",
  name: "Memory",
  packageName: "@chat-adapter/state-memory",
  peerDeps: [],
  readme: "https://github.com/vercel/chat/tree/main/packages/state-memory",
  slug: "memory",
  type: "state",
} as const satisfies CatalogAdapter;
