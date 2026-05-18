import { tool } from "ai";
import { z } from "zod";
import type { ChatBinding } from "../types";

export const getUser = (chat: ChatBinding) =>
  tool({
    description:
      "Look up profile information about a user by their platform-specific id (e.g. 'U123456' for Slack, '29:...' for Teams, 'users/123' for Google Chat). Returns null if the user is unknown.",
    inputSchema: z.object({
      userId: z
        .string()
        .describe("Platform-specific user id; the adapter is auto-detected"),
    }),
    execute: async ({ userId }) => {
      const user = await chat.getUser(userId);
      if (!user) {
        return null;
      }
      return {
        userId: user.userId,
        userName: user.userName,
        fullName: user.fullName,
        email: user.email,
        isBot: user.isBot,
        avatarUrl: user.avatarUrl,
      };
    },
  });
