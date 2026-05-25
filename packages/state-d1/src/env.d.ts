/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}
