/**
 * Event handling for WhatsApp adapter.
 */

import type { Adapter, ChatInstance, Logger } from "chat";
import { defaultEmojiResolver, Message } from "chat";
import type WAWebJS from "whatsapp-web.js";
import { createAttachmentFromMessage } from "./attachments";
import type { WhatsAppFormatConverter } from "./markdown";
import type { WhatsAppThreadId } from "./types";

export interface EventHandlerContext {
  chat: ChatInstance | null;
  logger: Logger;
  formatConverter: WhatsAppFormatConverter;
  botUserId: string | undefined;
  allowedNumbers: Set<string>;
  blockedNumbers: Set<string>;
  allowedGroups: Set<string>;
  requireMentionInGroups: boolean;
  encodeThreadId: (data: WhatsAppThreadId) => string;
  adapter: Adapter;
}

function isGroupChat(chatId: string): boolean {
  return chatId.endsWith("@g.us");
}

/**
 * Handle incoming WhatsApp message.
 */
export async function handleIncomingMessage(
  message: WAWebJS.Message,
  ctx: EventHandlerContext
): Promise<void> {
  if (!ctx.chat) {
    ctx.logger.warn("Chat instance not initialized, ignoring message");
    return;
  }

  const senderId = message.author || message.from;
  const chatId = message.from;
  const isGroup = isGroupChat(chatId);

  if (ctx.blockedNumbers.has(senderId)) {
    ctx.logger.debug("Ignoring message from blocked number", { senderId });
    return;
  }

  if (ctx.allowedNumbers.size > 0 && !ctx.allowedNumbers.has(senderId)) {
    ctx.logger.debug("Ignoring message from non-allowed number", { senderId });
    return;
  }

  if (isGroup && ctx.allowedGroups.size > 0 && !ctx.allowedGroups.has(chatId)) {
    ctx.logger.debug("Ignoring message from non-allowed group", { chatId });
    return;
  }

  const isMention = await checkIfMentioned(message, ctx.botUserId);
  if (isGroup && ctx.requireMentionInGroups && !isMention) {
    ctx.logger.debug("Ignoring group message without @mention", {
      chatId,
      messageId: message.id._serialized,
    });
    return;
  }

  const threadId = ctx.encodeThreadId({ chatId });

  ctx.logger.info("WhatsApp: message received", {
    messageId: message.id._serialized,
    hasMedia: message.hasMedia,
    type: message.type,
  });

  const contact = await message.getContact();
  const isMe = message.fromMe;

  const chatMessage = new Message({
    id: message.id._serialized,
    threadId,
    text: ctx.formatConverter.extractPlainText(message.body),
    formatted: ctx.formatConverter.toAst(message.body),
    raw: message,
    author: {
      userId: contact.id._serialized,
      userName:
        contact.pushname || contact.name || contact.id.user || "unknown",
      fullName:
        contact.name || contact.pushname || contact.id.user || "unknown",
      isBot: false,
      isMe,
    },
    metadata: {
      dateSent: new Date(message.timestamp * 1000),
      edited: false,
    },
    attachments: message.hasMedia
      ? [createAttachmentFromMessage(message, ctx.logger)]
      : [],
    isMention,
  });

  ctx.logger.info("WhatsApp: passing to SDK handler", {
    messageId: message.id._serialized,
  });

  ctx.chat.processMessage(ctx.adapter, threadId, chatMessage);
}

/**
 * Check if bot is mentioned in the message.
 */
async function checkIfMentioned(
  message: WAWebJS.Message,
  botUserId: string | undefined
): Promise<boolean> {
  if (!botUserId) return false;
  const mentions = await message.getMentions();
  return mentions.some((m) => m.id._serialized === botUserId);
}

/**
 * Handle WhatsApp reaction event.
 */
export async function handleReaction(
  reaction: WAWebJS.Reaction,
  ctx: EventHandlerContext
): Promise<void> {
  if (!ctx.chat) return;

  const senderId = reaction.senderId;
  const chatId = reaction.id.remote;
  const isGroup = isGroupChat(chatId);

  if (ctx.blockedNumbers.has(senderId)) {
    ctx.logger.debug("Ignoring reaction from blocked number", { senderId });
    return;
  }

  if (ctx.allowedNumbers.size > 0 && !ctx.allowedNumbers.has(senderId)) {
    ctx.logger.debug("Ignoring reaction from non-allowed number", { senderId });
    return;
  }

  if (isGroup && ctx.allowedGroups.size > 0 && !ctx.allowedGroups.has(chatId)) {
    ctx.logger.debug("Ignoring reaction from non-allowed group", { chatId });
    return;
  }

  const threadId = ctx.encodeThreadId({ chatId });
  const rawEmoji = reaction.reaction;
  const normalizedEmoji = defaultEmojiResolver.fromGChat(rawEmoji);
  const added = !!reaction.reaction;

  const reactionEvent = {
    adapter: ctx.adapter,
    threadId,
    messageId: reaction.msgId._serialized,
    emoji: normalizedEmoji,
    rawEmoji,
    added,
    user: {
      userId: reaction.senderId,
      userName: reaction.senderId,
      fullName: reaction.senderId,
      isBot: false,
      isMe: reaction.senderId === ctx.botUserId,
    },
    raw: reaction,
  };

  ctx.chat.processReaction(reactionEvent);
}
