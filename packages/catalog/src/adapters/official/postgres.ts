import { postgresUrlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const postgres = {
  beta: true,
  description:
    "Production state adapter using PostgreSQL for persistence and distributed locking.",
  env: {
    config: ["client", "keyPrefix", "autoCreateSchema"],
    credentialModes: [
      {
        label: "Connection URL",
        vars: [postgresUrlEnv],
      },
      {
        label: "Existing client",
        vars: [],
      },
    ],
  },
  factoryExport: "createPostgresState",
  features: {
    persistence: "yes",
    multiInstance: "yes",
    subscriptions: "yes",
    distributedLocking: "yes",
    keyValueCache: { status: "yes", label: "TTL" },
    lists: "yes",
    queues: "yes",
    keyPrefix: "yes",
  },
  group: "official",
  icon: "postgres",
  name: "PostgreSQL",
  packageName: "@chat-adapter/state-pg",
  peerDeps: ["pg"],
  readme: "https://github.com/vercel/chat/tree/main/packages/state-pg",
  slug: "postgres",
  type: "state",
} as const satisfies CatalogAdapter;
