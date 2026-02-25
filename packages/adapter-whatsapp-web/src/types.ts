import type { Logger } from "chat";

export interface WhatsAppAdapterConfig {
  logger: Logger;
  userName?: string;
  sessionPath?: string;
  puppeteerOptions?: Record<string, unknown>;
}

export interface WhatsAppThreadId {
  chatId: string;
}
