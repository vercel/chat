import { tool } from "ai";
import { z } from "zod";
import type { ChatBinding } from "../types";

export const getChannelInfo = (chat: ChatBinding) =>
  tool({
    description:
      "Fetch metadata for a channel: name, member count, DM status, visibility, etc. Use to identify a channel before posting.",
    inputSchema: z.object({
      channelId: z
        .string()
        .describe("Full channel id including adapter prefix"),
    }),
    execute: async ({ channelId }) => {
      const channel = chat.channel(channelId);
      const info = await channel.fetchMetadata();
      return {
        id: info.id,
        name: info.name,
        isDM: info.isDM ?? false,
        memberCount: info.memberCount,
        channelVisibility: info.channelVisibility,
      };
    },
  });
