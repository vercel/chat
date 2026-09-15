import { z } from "zod";
import type { ChannelVisibility } from "../../types";
import type { ScopeGuard } from "../scope";
import type { ChatBinding } from "../types";
import type { ChatToolSpec } from "./spec";

// Spec factories carry explicit `ChatToolSpec<Input, Output>` return types so
// the framework wrappers (AI SDK, TanStack AI) inherit precise input and output
// types without surfacing framework internals in the emitted declarations.

const GET_CHANNEL_INFO_INPUT = z.object({
  channelId: z.string().describe("Full channel id including adapter prefix"),
});

export const getChannelInfoSpec = (
  chat: ChatBinding,
  guard?: ScopeGuard
): ChatToolSpec<
  z.infer<typeof GET_CHANNEL_INFO_INPUT>,
  {
    id: string;
    name: string | undefined;
    isDM: boolean;
    memberCount: number | undefined;
    channelVisibility: ChannelVisibility | undefined;
  }
> => ({
  name: "getChannelInfo",
  description:
    "Fetch metadata for a channel: name, member count, DM status, visibility, etc. Use to identify a channel before posting.",
  inputSchema: GET_CHANNEL_INFO_INPUT,
  execute: async ({ channelId }) => {
    guard?.(channelId);
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
