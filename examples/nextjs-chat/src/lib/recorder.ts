/**
 * Webhook and API call recorder for replay testing.
 *
 * This module is completely optional - if RECORDING_ENABLED is not set,
 * all recording functions are no-ops.
 *
 * Usage:
 *   1. Set RECORDING_ENABLED=true and optionally RECORDING_SESSION_ID
 *   2. Import { recorder, withRecording } from './recorder'
 *   3. Wrap webhook handling: await recorder.recordWebhook(platform, request)
 *   4. Retrieve logs: await recorder.getRecords()
 *
 * CLI to export recordings:
 *   pnpm --filter example-nextjs-chat exec tsx src/lib/recorder.ts [sessionId]
 */

import { createClient, type RedisClientType } from "redis";

export interface WebhookRecord {
  body: string;
  headers: Record<string, string>;
  method: string;
  platform: string;
  timestamp: number;
  type: "webhook";
  url: string;
}

export interface ApiCallRecord {
  args: unknown;
  error?: string;
  method: string;
  platform: string;
  response?: unknown;
  timestamp: number;
  type: "api-call";
}

export interface FetchRecord {
  durationMs: number;
  error?: string;
  method: string;
  requestBody?: string;
  requestHeaders?: Record<string, string>;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  status?: number;
  timestamp: number;
  type: "fetch";
  url: string;
}

export interface GatewayRecord {
  body: string;
  eventType: string;
  platform: string;
  timestamp: number;
  type: "gateway";
}

export type RecordEntry =
  | WebhookRecord
  | ApiCallRecord
  | FetchRecord
  | GatewayRecord;

// Headers that contain sensitive data - values will be redacted
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-refresh-token",
  "x-csrf-token",
  "x-xsrf-token",
]);

/**
 * Sanitize header values by redacting sensitive information.
 */
function sanitizeHeaderValue(key: string, value: string): string {
  if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
    // Keep first few chars for debugging (e.g., "Bearer ey...")
    const prefix = value.slice(0, 10);
    return `${prefix}...[REDACTED]`;
  }
  return value;
}

const RECORDING_TTL_SECONDS = 1 * 60 * 60; // 1 hour

const DEFAULT_FETCH_URL_PATTERNS: RegExp[] = [
  /graph\.microsoft\.com/,
  /\.slack\.com/,
  /chat\.googleapis\.com/,
];

class Recorder {
  private readonly redis: RedisClientType | null = null;
  private readonly sessionId: string;
  private readonly enabled: boolean;
  private connectPromise: Promise<void> | null = null;
  private originalFetch: typeof globalThis.fetch | null = null;
  private fetchUrlPatterns: RegExp[] = [];

  constructor() {
    this.enabled = process.env.RECORDING_ENABLED === "true";
    this.sessionId =
      process.env.RECORDING_SESSION_ID ||
      `session-${process.env.VERCEL_GIT_COMMIT_SHA || "local"}`;

    if (this.enabled && process.env.REDIS_URL) {
      this.redis = createClient({ url: process.env.REDIS_URL });
      this.redis.on("error", (err) =>
        console.error("[recorder] Redis error:", err)
      );
      console.log(`[recorder] Recording enabled, session: ${this.sessionId}`);
    }
  }

  private ensureConnected(): Promise<void> {
    if (!this.redis) {
      return Promise.resolve();
    }

    if (!this.connectPromise) {
      this.connectPromise = this.redis.connect().then(() => {});
    }
    return this.connectPromise;
  }

  get isEnabled(): boolean {
    return this.enabled && this.redis !== null;
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  private get redisKey(): string {
    return `recording:${this.sessionId}`;
  }

  /**
   * Record an incoming webhook request.
   */
  async recordWebhook(platform: string, request: Request): Promise<void> {
    if (!(this.isEnabled && this.redis)) {
      return;
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const body = await request.clone().text();

    const record: WebhookRecord = {
      type: "webhook",
      timestamp: Date.now(),
      platform,
      method: request.method,
      url: request.url,
      headers,
      body,
    };

    await this.appendRecord(record);
  }

  /**
   * Record an outgoing API call.
   */
  async recordApiCall(
    platform: string,
    method: string,
    args: unknown,
    response?: unknown,
    error?: Error
  ): Promise<void> {
    if (!(this.isEnabled && this.redis)) {
      return;
    }

    let recordedResponse = response;
    if (recordedResponse && recordedResponse instanceof Response) {
      recordedResponse = await recordedResponse.clone().text();
    }

    const record: ApiCallRecord = {
      type: "api-call",
      timestamp: Date.now(),
      platform,
      method,
      args,
      response: recordedResponse,
      error: error?.message,
    };

    await this.appendRecord(record);
  }

  /**
   * Record a Gateway WebSocket event (e.g., Discord Gateway messages).
   */
  async recordGatewayEvent(
    platform: string,
    eventType: string,
    data: unknown
  ): Promise<void> {
    if (!(this.isEnabled && this.redis)) {
      return;
    }

    const record: GatewayRecord = {
      type: "gateway",
      timestamp: Date.now(),
      platform,
      eventType,
      body: JSON.stringify(data),
    };

    await this.appendRecord(record);
  }

  private async appendRecord(record: RecordEntry): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.ensureConnected();
      await this.redis.rPush(this.redisKey, JSON.stringify(record));
      await this.redis.expire(this.redisKey, RECORDING_TTL_SECONDS);
    } catch (err) {
      console.error("[recorder] Failed to record:", err);
    }
  }

  /**
   * Get all records for the current session.
   */
  async getRecords(sessionId?: string): Promise<RecordEntry[]> {
    if (!this.redis) {
      return [];
    }

    await this.ensureConnected();
    const key = sessionId ? `recording:${sessionId}` : this.redisKey;
    const entries = await this.redis.lRange(key, 0, -1);
    return entries.map((e) => JSON.parse(e) as RecordEntry);
  }

  /**
   * List all recording sessions.
   */
  async listSessions(): Promise<string[]> {
    if (!this.redis) {
      return [];
    }

    await this.ensureConnected();
    const keys = await this.redis.keys("recording:*");
    return keys.map((k) => k.replace("recording:", ""));
  }

  /**
   * Delete a recording session.
   */
  async deleteSession(sessionId?: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    await this.ensureConnected();
    const key = sessionId ? `recording:${sessionId}` : this.redisKey;
    await this.redis.del(key);
  }

  /**
   * Export records as JSON string.
   */
  async exportRecords(sessionId?: string): Promise<string> {
    const records = await this.getRecords(sessionId);
    return JSON.stringify(records, null, 2);
  }

  /**
   * Start recording fetch calls that match the given URL patterns.
   * This monkey-patches globalThis.fetch to intercept all HTTP calls.
   *
   * @param urlPatterns - Array of regex patterns to match URLs (default: Graph API)
   */
  startFetchRecording(
    urlPatterns: RegExp[] = DEFAULT_FETCH_URL_PATTERNS
  ): void {
    if (!this.isEnabled || this.originalFetch) {
      return;
    }

    this.fetchUrlPatterns = urlPatterns;
    this.originalFetch = globalThis.fetch;

    const self = this;
    globalThis.fetch = async function recordingFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      let url: string;
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else {
        url = input.url;
      }
      const method = init?.method || "GET";
      const startTime = Date.now();

      // Check if URL matches any pattern
      const shouldRecord = self.fetchUrlPatterns.some((pattern) =>
        pattern.test(url)
      );

      // Get original fetch (we know it's set because we checked in startFetchRecording)
      const originalFetch = self.originalFetch as typeof fetch;

      if (!shouldRecord) {
        return originalFetch(input, init);
      }

      let response: Response | undefined;
      let error: Error | undefined;

      try {
        response = await originalFetch(input, init);
        return response;
      } catch (err) {
        error = err as Error;
        throw err;
      } finally {
        const durationMs = Date.now() - startTime;

        // Clone response to read body without consuming it
        let responseBody: string | undefined;
        let responseHeaders: Record<string, string> | undefined;
        if (response) {
          try {
            const cloned = response.clone();
            responseBody = await cloned.text();
            const respHeaders: Record<string, string> = {};
            cloned.headers.forEach((value, key) => {
              respHeaders[key] = sanitizeHeaderValue(key, value);
            });
            responseHeaders = respHeaders;
          } catch {
            // Body might not be readable
          }
        }

        // Extract request headers
        let requestHeaders: Record<string, string> | undefined;
        if (init?.headers) {
          const reqHeaders: Record<string, string> = {};
          if (init.headers instanceof Headers) {
            init.headers.forEach((value, key) => {
              reqHeaders[key] = sanitizeHeaderValue(key, value);
            });
          } else if (Array.isArray(init.headers)) {
            for (const [key, value] of init.headers) {
              reqHeaders[key] = sanitizeHeaderValue(key, value);
            }
          } else {
            const headerObj = init.headers as Record<string, string>;
            for (const [key, value] of Object.entries(headerObj)) {
              reqHeaders[key] = sanitizeHeaderValue(key, value);
            }
          }
          requestHeaders = reqHeaders;
        }

        const record: FetchRecord = {
          type: "fetch",
          timestamp: Date.now(),
          method,
          url,
          requestHeaders,
          requestBody: typeof init?.body === "string" ? init.body : undefined,
          status: response?.status,
          responseHeaders,
          responseBody,
          error: error?.message,
          durationMs,
        };

        // Don't await - fire and forget to avoid slowing down requests
        self.appendRecord(record).catch(() => {});
      }
    };

    console.log(
      `[recorder] Fetch recording started for patterns: ${urlPatterns.map((p) => p.source).join(", ")}`
    );
  }

  /**
   * Stop recording fetch calls and restore original fetch.
   */
  stopFetchRecording(): void {
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
      console.log("[recorder] Fetch recording stopped");
    }
  }
}

// Singleton instance
export const recorder = new Recorder();

/**
 * Wrap an adapter to record its API calls.
 * Returns a proxy that intercepts method calls.
 */
export function withRecording<T extends object>(
  adapter: T,
  platform: string,
  methodsToRecord: string[]
): T {
  if (!recorder.isEnabled) {
    return adapter;
  }

  return new Proxy(adapter, {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (
        typeof value === "function" &&
        methodsToRecord.includes(prop as string)
      ) {
        return async (...args: unknown[]) => {
          let response: unknown;
          let error: Error | undefined;

          try {
            response = await value.apply(target, args);
            return response;
          } catch (err) {
            error = err as Error;
            throw err;
          } finally {
            await recorder.recordApiCall(
              platform,
              prop as string,
              args,
              response,
              error
            );
          }
        };
      }

      return value;
    },
  });
}

// CLI: Run this file directly to export recordings
// pnpm --filter example-nextjs-chat exec tsx src/lib/recorder.ts [sessionId]
async function main() {
  // Load .env.local for CLI usage
  try {
    const { config } = await import("dotenv");
    config({ path: ".env.local" });
  } catch {
    // dotenv not available, skip
  }
  const sessionId = process.argv[2];

  if (!process.env.REDIS_URL) {
    console.error("REDIS_URL environment variable is required");
    process.exit(1);
  }

  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();

  try {
    if (sessionId === "--list" || sessionId === "-l") {
      const keys = await redis.keys("recording:*");
      const sessions = keys.map((k) => k.replace("recording:", ""));
      console.log("Recording sessions:");
      for (const s of sessions) {
        const count = await redis.lLen(`recording:${s}`);
        console.log(`  ${s} (${count} entries)`);
      }
    } else if (sessionId === "--help" || sessionId === "-h" || !sessionId) {
      console.log(`
Usage: tsx src/lib/recorder.ts [command|sessionId]

Commands:
  --list, -l     List all recording sessions
  --help, -h     Show this help
  <sessionId>    Export records for a specific session as JSON

Environment:
  REDIS_URL      Redis connection URL (required)
`);
    } else {
      const entries = await redis.lRange(`recording:${sessionId}`, 0, -1);
      if (entries.length === 0) {
        console.error(`No records found for session: ${sessionId}`);
        process.exit(1);
      }
      const records = entries.map((e) => JSON.parse(e));
      console.log(JSON.stringify(records, null, 2));
    }
  } finally {
    await redis.quit();
  }
}

// Run CLI if executed directly
const isMainModule = typeof require !== "undefined" && require.main === module;
const isDirectRun = process.argv[1]?.includes("recorder");
if (isMainModule || isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
