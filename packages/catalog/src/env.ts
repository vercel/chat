import type { EnvVar } from "./types";

export const env = (
  key: string,
  description: string,
  options: { aliases?: readonly string[]; secret?: boolean } = {}
): EnvVar => ({
  ...(options.aliases ? { aliases: options.aliases } : {}),
  description,
  key,
  secret: options.secret ?? false,
});

// Readability marker for non-secret URL variables; behavior intentionally
// matches env().
export const urlEnv = (
  key: string,
  description: string,
  options: { aliases?: readonly string[] } = {}
): EnvVar => env(key, description, options);

export const secretEnv = (
  key: string,
  description: string,
  options: { aliases?: readonly string[] } = {}
): EnvVar => env(key, description, { ...options, secret: true });

export const redisUrlEnv = urlEnv(
  "REDIS_URL",
  "Redis connection URL used when a client is not provided."
);

export const postgresUrlEnv = urlEnv(
  "POSTGRES_URL",
  "Postgres connection URL used when a client is not provided.",
  { aliases: ["DATABASE_URL"] }
);
