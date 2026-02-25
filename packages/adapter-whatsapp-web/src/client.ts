/**
 * WhatsApp client initialization and lifecycle management.
 */

import type { Logger } from "chat";
import type WAWebJS from "whatsapp-web.js";

export interface ClientConfig {
  sessionPath: string;
  puppeteerOptions: Record<string, unknown>;
}

export interface ClientState {
  client: WAWebJS.Client | null;
  isReady: boolean;
  qrCode: string | null;
  botUserId: string | undefined;
}

export interface ClientCallbacks {
  onReady: (botUserId: string) => void;
  onDisconnected: () => void;
  onMessage: (message: WAWebJS.Message) => Promise<void>;
  onReaction: (reaction: WAWebJS.Reaction) => Promise<void>;
}

/**
 * Initialize the WhatsApp Web client.
 */
export async function initializeClient(
  config: ClientConfig,
  logger: Logger
): Promise<WAWebJS.Client> {
  const wa = await import("whatsapp-web.js");
  const mod = wa as unknown as {
    default?: typeof wa;
    Client?: unknown;
    LocalAuth?: new (opts?: { dataPath?: string }) => unknown;
  };
  const { Client, LocalAuth } = mod.default ?? mod;

  const client = new (Client as new (opts: unknown) => WAWebJS.Client)({
    authStrategy: new (
      LocalAuth as new (opts?: { dataPath?: string }) => unknown
    )({
      dataPath: config.sessionPath,
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      ...config.puppeteerOptions,
    },
  });

  logger.info("WhatsApp client created");
  return client;
}

/**
 * Set up event listeners on the WhatsApp client.
 */
export function setupClientEventListeners(
  client: WAWebJS.Client,
  callbacks: ClientCallbacks,
  logger: Logger
): { setQrCode: (qr: string | null) => void; setReady: (ready: boolean) => void } {
  let qrCode: string | null = null;
  let isReady = false;

  client.on("qr", (qr: string) => {
    qrCode = qr;
    logger.info(
      "WhatsApp QR code received. Scan with your phone to authenticate."
    );
  });

  client.on("authenticated", () => {
    logger.info("WhatsApp authenticated successfully");
  });

  client.on("auth_failure", (msg: string) => {
    logger.error("WhatsApp authentication failed", { error: msg });
  });

  client.on("ready", () => {
    isReady = true;
    const info = client.info;
    if (info) {
      callbacks.onReady(info.wid._serialized);
    }
    logger.info("WhatsApp client ready");
  });

  client.on("disconnected", (reason: string) => {
    isReady = false;
    callbacks.onDisconnected();
    logger.warn("WhatsApp disconnected", { reason });
  });

  client.on("message_create", async (message: WAWebJS.Message) => {
    if (message.fromMe) return;
    await callbacks.onMessage(message);
  });

  client.on("message_reaction", async (reaction: WAWebJS.Reaction) => {
    await callbacks.onReaction(reaction);
  });

  return {
    setQrCode: (qr: string | null) => {
      qrCode = qr;
    },
    setReady: (ready: boolean) => {
      isReady = ready;
    },
  };
}

/**
 * Dynamically import MessageMedia for sending files.
 */
export async function getMessageMediaClass(): Promise<
  new (
    mimetype: string,
    data: string,
    filename?: string
  ) => WAWebJS.MessageMedia
> {
  const wa = await import("whatsapp-web.js");
  const { MessageMedia } = (wa as unknown as { default?: typeof wa }).default ??
    wa;
  return MessageMedia as new (
    mimetype: string,
    data: string,
    filename?: string
  ) => WAWebJS.MessageMedia;
}
