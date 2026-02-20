import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/chat",
  "packages/adapter-discord",
  "packages/adapter-gchat",
  "packages/adapter-github",
  "packages/adapter-linear",
  "packages/adapter-shared",
  "packages/adapter-slack",
  "packages/adapter-teams",
  "packages/state-ioredis",
  "packages/state-memory",
  "packages/state-redis",
]);
