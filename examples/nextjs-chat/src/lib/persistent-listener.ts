import { createClient } from "redis";

/**
 * Configuration for a persistent listener.
 */
export interface PersistentListenerConfig {
  /** Default duration in milliseconds */
  defaultDurationMs: number;
  /** Maximum duration in milliseconds */
  maxDurationMs: number;
  /** Unique name for this listener type (used for Redis channel) */
  name: string;
  /** Redis URL for cross-instance coordination (optional) */
  redisUrl?: string;
}

/**
 * Options passed to the listener function.
 */
export interface ListenerOptions {
  /** Signal that fires when the listener should stop */
  abortSignal: AbortSignal;
  /** Duration this listener should run */
  durationMs: number;
  /** Unique ID for this listener instance */
  listenerId: string;
}

/**
 * Creates a persistent listener manager for serverless environments.
 *
 * Features:
 * - Cross-instance coordination via Redis pub/sub
 * - When a new listener starts, existing listeners on other instances shut down
 *
 * @example
 * ```ts
 * const listener = createPersistentListener({
 *   name: "discord-gateway",
 *   redisUrl: process.env.REDIS_URL,
 *   defaultDurationMs: 600_000,
 *   maxDurationMs: 600_000,
 * });
 *
 * export async function GET(request: Request) {
 *   return listener.start(request, {
 *     afterTask: (task) => after(() => task),
 *     run: async ({ abortSignal, durationMs }) => {
 *       // Your long-running logic here
 *       return new Response("OK");
 *     },
 *   });
 * }
 * ```
 */
export function createPersistentListener(config: PersistentListenerConfig) {
  const { name, redisUrl, defaultDurationMs, maxDurationMs } = config;
  const redisChannel = `persistent-listener:${name}:control`;

  return {
    /**
     * Start the persistent listener.
     */
    async start(
      request: Request,
      options: {
        /** Function to schedule background tasks (e.g., Next.js `after`) */
        afterTask: (task: Promise<unknown>) => void;
        /** The actual listener logic to run */
        run: (opts: ListenerOptions) => Promise<Response>;
        /** Optional: get duration from request (default: query param `duration`) */
        getDuration?: (request: Request) => number | undefined;
      }
    ): Promise<Response> {
      const { afterTask, run, getDuration } = options;

      // Generate unique listener ID
      const listenerId = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      console.log(`[${name}] Starting listener: ${listenerId}`);

      // Parse duration from request
      const requestedDuration = getDuration
        ? getDuration(request)
        : (() => {
            const url = new URL(request.url);
            const param = url.searchParams.get("duration");
            return param ? Number.parseInt(param, 10) : undefined;
          })();
      const durationMs = Math.min(
        requestedDuration ?? defaultDurationMs,
        maxDurationMs
      );

      // Set up abort controller for cross-instance coordination
      const abortController = new AbortController();

      // Set up Redis pub/sub to shut down listeners on other instances
      if (redisUrl) {
        afterTask(
          this.setupRedisPubSub(
            redisUrl,
            redisChannel,
            listenerId,
            durationMs,
            abortController
          )
        );
      }

      try {
        const response = await run({
          abortSignal: abortController.signal,
          listenerId,
          durationMs,
        });

        console.log(`[${name}] Listener ${listenerId} completed`);
        return response;
      } catch (error) {
        console.error(`[${name}] Error in listener:`, error);
        return new Response(
          JSON.stringify({
            error: `Failed to run ${name} listener`,
            message: error instanceof Error ? error.message : String(error),
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    },

    /**
     * Set up Redis pub/sub for cross-instance coordination.
     * When a new listener starts, it signals existing listeners to shut down.
     */
    async setupRedisPubSub(
      redisUrl: string,
      channel: string,
      listenerId: string,
      durationMs: number,
      abortController: AbortController
    ): Promise<void> {
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();

      try {
        await Promise.all([pubClient.connect(), subClient.connect()]);

        // Subscribe to shutdown signals from other instances
        await subClient.subscribe(channel, (message) => {
          // Ignore our own startup message
          if (message === listenerId) {
            return;
          }

          console.log(
            `[${name}] ${listenerId} received shutdown signal from ${message}`
          );
          abortController.abort();
        });

        // Publish that we're starting (shuts down listeners on other instances)
        await pubClient.publish(channel, listenerId);
        console.log(`[${name}] Published startup signal: ${listenerId}`);

        // Keep subscription alive until abort or timeout
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, durationMs + 5000);
          abortController.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true }
          );
        });
      } catch (error) {
        console.error(`[${name}] Redis pub/sub error:`, error);
      } finally {
        await subClient.unsubscribe(channel).catch(() => {});
        await Promise.all([
          pubClient.quit().catch(() => {}),
          subClient.quit().catch(() => {}),
        ]);
        console.log(`[${name}] ${listenerId} pub/sub cleanup complete`);
      }
    },
  };
}
