import { z } from "zod";
import type { ChatBinding } from "../types";
import type { ChatToolSpec } from "./spec";

// Spec factories carry explicit `ChatToolSpec<Input, Output>` return types so
// the framework wrappers (AI SDK, TanStack AI) inherit precise input and output
// types without surfacing framework internals in the emitted declarations.

const GET_USER_INPUT = z.object({
  userId: z
    .string()
    .describe("Platform-specific user id; the adapter is auto-detected"),
});

export const getUserSpec = (
  chat: ChatBinding,
  needsApproval = true
): ChatToolSpec<
  z.infer<typeof GET_USER_INPUT>,
  {
    userId: string;
    userName: string;
    fullName: string;
    email: string | undefined;
    isBot: boolean;
    avatarUrl: string | undefined;
  } | null
> => ({
  name: "getUser",
  description:
    "Look up profile information about a user by their platform-specific id (e.g. 'U123456' for Slack, '29:...' for Teams, 'users/123' for Google Chat). Returns null if the user is unknown.",
  inputSchema: GET_USER_INPUT,
  needsApproval,
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
