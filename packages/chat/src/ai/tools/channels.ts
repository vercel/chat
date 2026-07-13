import { type Tool, tool } from "ai";
import { z } from "zod";
import type { ChannelVisibility } from "../../types";
import type { ChatBinding } from "../types";

// The explicit `Tool<Input, Output>` return type keeps the emitted
// declarations on types exported from `ai`. Relying on inference would
// surface `ai` internals (e.g. `ExecutableTool` from
// `@ai-sdk/provider-utils`) that consumers cannot resolve.

const GET_CHANNEL_INFO_INPUT = z.object({
  channelId: z.string().describe("Full channel id including adapter prefix"),
});

export const getChannelInfo = (
  chat: ChatBinding
): Tool<
  z.infer<typeof GET_CHANNEL_INFO_INPUT>,
  {
    id: string;
    name: string | undefined;
    isDM: boolean;
    memberCount: number | undefined;
    channelVisibility: ChannelVisibility | undefined;
  }
> =>
  tool({
    description:
      "Fetch metadata for a channel: name, member count, DM status, visibility, etc. Use to identify a channel before posting.",
    inputSchema: GET_CHANNEL_INFO_INPUT,
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
