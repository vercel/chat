import { redisUrlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const redis = {
  beta: true,
  description:
    "Production-ready state adapter using Redis for persistence and distributed locking.",
  env: {
    config: ["client", "keyPrefix"],
    credentialModes: [
      {
        label: "Connection URL",
        vars: [redisUrlEnv],
      },
      {
        label: "Existing client",
        vars: [],
      },
    ],
  },
  factoryExport: "createRedisState",
  features: {
    persistence: "yes",
    multiInstance: "yes",
    subscriptions: "yes",
    distributedLocking: "yes",
    keyValueCache: { status: "yes", label: "TTL" },
    automaticReconnect: "yes",
    keyPrefix: "yes",
  },
  group: "official",
  icon: "redis",
  name: "Redis",
  packageName: "@chat-adapter/state-redis",
  peerDeps: ["redis"],
  readme: "https://github.com/vercel/chat/tree/main/packages/state-redis",
  slug: "redis",
  type: "state",
} as const satisfies CatalogAdapter;
