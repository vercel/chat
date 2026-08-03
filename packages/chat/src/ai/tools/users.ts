import { type Tool, tool } from "ai";
import { z } from "zod";
import type { ChatBinding } from "../types";

// The explicit `Tool<Input, Output>` return type keeps the emitted
// declarations on types exported from `ai`. Relying on inference would
// surface `ai` internals (e.g. `ExecutableTool` from
// `@ai-sdk/provider-utils`) that consumers cannot resolve.

const GET_USER_INPUT = z.object({
  userId: z
    .string()
    .describe("Platform-specific user id; the adapter is auto-detected"),
});

export const getUser = (
  chat: ChatBinding
): Tool<
  z.infer<typeof GET_USER_INPUT>,
  {
    userId: string;
    userName: string;
    fullName: string;
    email: string | undefined;
    isBot: boolean;
    avatarUrl: string | undefined;
  } | null
> =>
  tool({
    description:
      "Look up profile information about a user by their platform-specific id (e.g. 'U123456' for Slack, '29:...' for Teams, 'users/123' for Google Chat). Returns null if the user is unknown.",
    inputSchema: GET_USER_INPUT,
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
