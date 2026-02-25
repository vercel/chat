import type { Logger } from "chat";

export interface WhatsAppAdapterConfig {
  logger: Logger;
  userName?: string;
  sessionPath?: string;
  puppeteerOptions?: Record<string, unknown>;
  /** If set, only process messages from these numbers (e.g. "34689396755" or "34689396755@c.us") */
  allowedNumbers?: string[];
  /** If set, never process messages from these numbers */
  blockedNumbers?: string[];
  /** If set, only process messages from these group IDs (e.g. "123456789-1234567890@g.us"). DMs are unaffected. */
  allowedGroups?: string[];
  /** In group chats, only process messages that @mention the bot. DMs are unaffected. */
  requireMentionInGroups?: boolean;
}

export interface WhatsAppThreadId {
  chatId: string;
}
