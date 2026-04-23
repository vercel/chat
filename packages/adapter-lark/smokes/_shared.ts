/**
 * Shared bootstrap for smoke scripts.
 *
 * Reads credentials from ./credentials.local.ts (gitignored) or LARK_APP_ID /
 * LARK_APP_SECRET env vars, creates a LarkAdapter + Chat wired with
 * MemoryStateAdapter, and returns them ready for handler registration.
 *
 * Also installs a SIGINT handler so Ctrl-C cleanly disconnects the WS.
 */
import { createMemoryState } from "@chat-adapter/state-memory";
import { createLarkChannel, LoggerLevel } from "@larksuiteoapi/node-sdk";
import { Chat, ConsoleLogger } from "chat";
import { createLarkAdapter, type LarkAdapter } from "../src/index";

async function loadSecrets(): Promise<{
  APP_ID?: string;
  APP_SECRET?: string;
}> {
  try {
    // @ts-expect-error — optional gitignored file
    return await import("./credentials.local.ts");
  } catch {
    return {};
  }
}

export interface SmokeContext {
  adapter: LarkAdapter;
  chat: Chat;
  logger: ConsoleLogger;
}

export async function buildChat(scenarioName: string): Promise<SmokeContext> {
  const local = await loadSecrets();
  const appId = local.APP_ID || process.env.LARK_APP_ID;
  const appSecret = local.APP_SECRET || process.env.LARK_APP_SECRET;
  if (!(appId && appSecret)) {
    console.error(
      "Missing credentials. Create smokes/credentials.local.ts with `export const APP_ID = '…'; export const APP_SECRET = '…';`, or export LARK_APP_ID / LARK_APP_SECRET env vars."
    );
    process.exit(1);
  }

  const logger = new ConsoleLogger("debug", scenarioName);

  const adapter = createLarkAdapter({
    appId,
    appSecret,
    logger,
    channelFactory: (opts) =>
      createLarkChannel({ ...opts, loggerLevel: LoggerLevel.info }),
  });

  const chat = new Chat({
    userName: process.env.LARK_BOT_USERNAME ?? "bot",
    adapters: { lark: adapter },
    state: createMemoryState(),
    logger: "info",
  });

  const shutdown = async () => {
    logger.info("shutting down...");
    try {
      await adapter.disconnect();
    } catch (err) {
      logger.error("disconnect error", err);
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { adapter, chat, logger };
}
